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

  // Insert a new asset record (tagged with the current account)
  async createAsset(stream, assetData) {
    assetData.is_active = true;
    if (typeof ACCOUNTS !== 'undefined' && assetData.account_id === undefined) {
      assetData.account_id = ACCOUNTS.writeAccountId();
    }
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

// ── Accounts (family view) — assets belong to an account; view one or All ──────
const ACCOUNTS = {
  list: [],
  current: localStorage.getItem('vz_account') || 'all',   // 'all' or an account id (string)
  _loaded: false,

  async load(force = false) {
    if (this._loaded && !force) return;
    let rows = [];
    try {
      const res = await API.get('accounts', { limit: 200 });
      rows = res.rows || [];
    } catch (_) {}
    this.loadFrom(rows);
  },

  // Populate from already-fetched rows (used by the single boot batchGet)
  loadFrom(rows) {
    this.list = (rows || []).filter(a => String(a.is_active).toUpperCase() === 'TRUE');
    // If the stored current account no longer exists, fall back to All
    if (this.current !== 'all' && !this.list.some(a => String(a.id) === String(this.current))) {
      this.current = 'all';
    }
    this._loaded = true;
  },

  isAll()               { return this.current === 'all'; },
  matches(accountId)    { return this.isAll() || String(accountId) === String(this.current); },
  name(id)              { const a = this.list.find(x => String(x.id) === String(id)); return a ? a.name : ''; },
  currentName()         { return this.isAll() ? 'All Accounts' : (this.name(this.current) || 'Account'); },
  // Account to write new assets into (falls back to the first account when on 'All')
  writeAccountId()      { return this.isAll() ? (this.list[0] ? String(this.list[0].id) : '') : String(this.current); },

  setCurrent(id) {
    this.current = String(id);
    localStorage.setItem('vz_account', this.current);
    this._clearCaches();
  },

  async add(name) {
    const r = await API.insert('accounts', { name, is_active: true });
    await this.load(true);
    return r.id;
  },

  _clearCaches() {
    if (typeof _holdingsAllRows !== 'undefined') _holdingsAllRows = null;
    if (typeof _insightsCache  !== 'undefined') _insightsCache  = null;
    try { CACHE._store = {}; } catch (_) {}
    try { LSC.clear('insights', 'holdings'); } catch (_) {}
  },
};

// ── Visibility (show/hide) — hidden categories, subcategories, assets ──────────
// Hidden items are excluded from Log, History, Holdings, Insights and all sums.
// Asset ref format: "assetTable|assetId". Category/subcategory ref = the id.
// Account-aware: a hide has a scope — '' = global (applies to every account and
// the All view), or an account id = applies only when viewing that account.
const HIDDEN = {
  rows: [],   // { kind, ref, account }  (account '' = global)
  _loaded: false,

  async load(force = false) {
    if (this._loaded && !force) return;
    let rows = [];
    try {
      const res = await API.get('hidden_items', { limit: 5000 });
      rows = res.rows || [];
    } catch (_) {}
    this.loadFrom(rows);
  },

  // Populate from already-fetched rows (used by the single boot batchGet)
  loadFrom(rows) {
    this.rows = (rows || []).map(r => ({ kind: r.kind, ref: String(r.ref), account: String(r.account_id || '') }));
    this._loaded = true;
  },

  _scope() { return (typeof ACCOUNTS !== 'undefined' && !ACCOUNTS.isAll()) ? String(ACCOUNTS.current) : ''; },

  // Hidden now if a global hide exists, or an account-scoped hide for the current account.
  _hit(kind, ref) {
    ref = String(ref);
    const cur = (typeof ACCOUNTS !== 'undefined') ? String(ACCOUNTS.current) : 'all';
    return this.rows.some(r => r.kind === kind && r.ref === ref &&
      (r.account === '' || (cur !== 'all' && r.account === cur)));
  },

  assetKey(table, id) { return `${table}|${id}`; },
  isCat(id)           { return this._hit('category', id); },
  isSub(id)           { return this._hit('subcategory', id); },
  isAsset(table, id)  { return this._hit('asset', `${table}|${id}`); },

  async hide(kind, ref, name) {
    ref = String(ref);
    const account = this._scope();
    await API.insert('hidden_items', { account_id: account, kind, ref, name: name || '' });
    this.rows.push({ kind, ref, account });
    this._clearCaches();
  },

  async unhide(kind, ref) {
    ref = String(ref);
    const account = this._scope();
    try {
      const res = await API.get('hidden_items', { limit: 5000, filters: { kind, ref } });
      for (const row of (res.rows || [])) {
        if (String(row.account_id || '') === account) await API.delete('hidden_items', row.id);
      }
    } catch (_) {}
    this.rows = this.rows.filter(r => !(r.kind === kind && r.ref === ref && r.account === account));
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
