// VaultZero — API layer (Google Apps Script calls)

const API = {
  async get(sheet, { limit = CONFIG.PAGE_SIZE, offset = 0, filters = {} } = {}) {
    const params = new URLSearchParams({
      sheet,
      limit,
      offset,
      filters: JSON.stringify(filters),
    });
    const res = await fetch(`${CONFIG.APPS_SCRIPT_URL}?${params}`);
    if (!res.ok) throw new Error(`GET ${sheet} failed: ${res.status}`);
    return res.json();
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
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`POST failed: ${res.status}`);
    const data = await res.json();
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

// ── Batch read (single request for Insights / Holdings) ────────────────────────
API.batchGet = async function(sheets, limit = 5000) {
  const params = new URLSearchParams({ action: 'batchGet', sheets: sheets.join(','), limit });
  const res = await fetch(`${CONFIG.APPS_SCRIPT_URL}?${params}`);
  if (!res.ok) throw new Error('batchGet failed: ' + res.status);
  const data = await res.json();
  if (data.error) throw new Error(data.error); // old GAS returns error JSON with HTTP 200
  return data; // { tableName: { rows, total }, ... }
};

// ── localStorage cache with 30-minute TTL ──────────────────────────────────────
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
