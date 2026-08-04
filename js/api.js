// VaultZero — API layer (Google Apps Script calls)

// ── API token (stored in localStorage) ───────────────────────────────────────
const AUTH = {
  TOKEN_KEY: 'vz_api_token',
  get()        { return localStorage.getItem(this.TOKEN_KEY) || ''; },
  set(token)   { localStorage.setItem(this.TOKEN_KEY, token); },
  clear()      { localStorage.removeItem(this.TOKEN_KEY); },
};

const API = {
  async get(sheet, { limit = CONFIG.PAGE_SIZE, offset = 0, filters = {} } = {}) {
    const params = new URLSearchParams({
      sheet,
      limit,
      offset,
      filters: JSON.stringify(filters),
      token: AUTH.get(),
    });
    const res = await fetch(`${CONFIG.APPS_SCRIPT_URL}?${params}`);
    if (!res.ok) throw new Error(`GET ${sheet} failed: ${res.status}`);
    const data = await res.json();
    if (data.error === 'unauthorized') { showTokenModal(); throw new Error('unauthorized'); }
    return data;
  },

  async insert(sheet, row) {
    return this._post({ action: 'insert', sheet, row });
  },

  async update(sheet, id, row) {
    return this._post({ action: 'update', sheet, id, row });
  },

  async batchUpdate(sheet, rows) {
    return this._post({ action: 'batchUpdate', sheet, rows });
  },

  async delete(sheet, id) {
    return this._post({ action: 'delete', sheet, id });
  },

  async _post(payload) {
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ ...payload, token: AUTH.get() }),
    });
    if (!res.ok) throw new Error(`POST failed: ${res.status}`);
    const data = await res.json();
    if (data.error === 'unauthorized') { showTokenModal(); throw new Error('unauthorized'); }
    if (data.error) throw new Error(data.error);
    return data;
  },

  // Fetch all assets for a given stream (for name dropdown)
  async getAssets(stream) {
    return this.get(stream.assetTable, { limit: 500, filters: { is_active: true } });
  },

  // Fetch subcategories for a category
  async getSubcategories(categoryId) {
    return this.get('subcategories', { limit: 100, filters: { category_id: categoryId } });
  },

  // Fetch transactions for history page
  async getTransactions(stream, filters = {}, offset = 0) {
    return this.get(stream.txnTable, { limit: CONFIG.PAGE_SIZE, offset, filters });
  },

  // Insert a new asset record
  async createAsset(stream, assetData) {
    assetData.is_active = true;
    return this.insert(stream.assetTable, assetData);
  },

  // Insert a new transaction
  async createTransaction(stream, txnData) {
    return this.insert(stream.txnTable, txnData);
  },

  // Update manual price entry
  async updateManualPrice(assetType, assetId, pricePerUnit, priceDate) {
    return this.insert('manual_prices', {
      asset_type: assetType,
      asset_id: assetId,
      price_per_unit: pricePerUnit,
      price_date: priceDate,
    });
  },
};

// Simple in-memory cache for asset dropdowns (cleared on new asset)
const CACHE = {
  _store: {},
  key: (table, filters) => table + JSON.stringify(filters),
  get(table, filters) { return this._store[this.key(table, filters)]; },
  set(table, filters, data) { this._store[this.key(table, filters)] = data; },
  clear(table) {
    Object.keys(this._store).forEach(k => { if (k.startsWith(table)) delete this._store[k]; });
  },
};

async function fetchAssetsCached(stream) {
  const cached = CACHE.get(stream.assetTable, { is_active: true });
  if (cached) return cached;
  const data = await API.getAssets(stream);
  CACHE.set(stream.assetTable, { is_active: true }, data.rows);
  return data.rows;
}

// ── Visibility (show/hide) — hidden categories, subcategories, assets ──────────
// Hidden items are excluded from Log, History, Holdings, Insights and all sums.
// Asset ref format: "assetTable|assetId". Category/subcategory ref = the id.
const HIDDEN = {
  cats:   new Set(),
  subs:   new Set(),
  assets: new Set(),
  _loaded: false,

  async load(force = false) {
    if (this._loaded && !force) return;
    try {
      const res = await API.get('hidden_items', { limit: 5000 });
      this.cats = new Set(); this.subs = new Set(); this.assets = new Set();
      (res.rows || []).forEach(r => {
        const ref = String(r.ref);
        if (r.kind === 'category')         this.cats.add(ref);
        else if (r.kind === 'subcategory') this.subs.add(ref);
        else if (r.kind === 'asset')       this.assets.add(ref);
      });
    } catch (_) { /* sheet may not exist yet — treat as nothing hidden */ }
    this._loaded = true;
  },

  assetKey(table, id) { return `${table}|${id}`; },
  isCat(id)           { return this.cats.has(String(id)); },
  isSub(id)           { return this.subs.has(String(id)); },
  isAsset(table, id)  { return this.assets.has(`${table}|${id}`); },
  isHidden(kind, ref) {
    return kind === 'category' ? this.isCat(ref) : kind === 'subcategory' ? this.isSub(ref) : this.assets.has(String(ref));
  },

  async hide(kind, ref, name) {
    ref = String(ref);
    await API.insert('hidden_items', { kind, ref, name: name || '' });
    (kind === 'category' ? this.cats : kind === 'subcategory' ? this.subs : this.assets).add(ref);
    this._clearCaches();
  },

  async unhide(kind, ref) {
    ref = String(ref);
    try {
      const res = await API.get('hidden_items', { limit: 5000, filters: { kind, ref } });
      for (const row of (res.rows || [])) await API.delete('hidden_items', row.id);
    } catch (_) {}
    (kind === 'category' ? this.cats : kind === 'subcategory' ? this.subs : this.assets).delete(ref);
    this._clearCaches();
  },

  _clearCaches() {
    if (typeof _holdingsAllRows !== 'undefined') _holdingsAllRows = null;
    if (typeof _insightsCache  !== 'undefined') _insightsCache  = null;
    try { LSC.clear('insights', 'holdings'); } catch (_) {}
  },
};

// ── Batch read (single request for Insights / Holdings) ────────────────────────
API.batchGet = async function(sheets, limit = 5000) {
  const params = new URLSearchParams({ action: 'batchGet', sheets: sheets.join(','), limit, token: AUTH.get() });
  const res = await fetch(`${CONFIG.APPS_SCRIPT_URL}?${params}`);
  if (!res.ok) throw new Error('batchGet failed: ' + res.status);
  const data = await res.json();
  if (data.error === 'unauthorized') { showTokenModal(); throw new Error('unauthorized'); }
  if (data.error) throw new Error(data.error);
  return data;
};

// ── localStorage cache with 30-minute TTL ──────────────────────────────────────
// Build a map of "asset_type|asset_id" → latest price from manual_prices rows
function buildManualPricesMap(rows) {
  const latest = {};
  rows.forEach(r => {
    const key = `${r.asset_type}|${String(r.asset_id)}`;
    const d = new Date(r.price_date);
    if (!latest[key] || d > new Date(latest[key].date)) {
      latest[key] = { price: parseFloat(r.price_per_unit), date: r.price_date };
    }
  });
  const result = {};
  Object.entries(latest).forEach(([k, { price }]) => { result[k] = price; });
  return result;
}

const LSC = {
  TTL: 30 * 60 * 1000,
  get(key) {
    try {
      const raw = localStorage.getItem('vz_' + key);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      return (Date.now() - ts) < this.TTL ? data : null;
    } catch (_) { return null; }
  },
  set(key, data) {
    try { localStorage.setItem('vz_' + key, JSON.stringify({ data, ts: Date.now() })); } catch (_) {}
  },
  clear(...keys) {
    keys.forEach(k => { try { localStorage.removeItem('vz_' + k); } catch (_) {} });
  },
};
