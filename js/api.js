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
    if (data.error) throw new Error(sheet + ': ' + data.error);   // a server error is never an empty table
    return data;
  },

  async insert(sheet, row, requestId) {
    return this._post({ action: 'insert', sheet, row, request_id: requestId || undefined });
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

  // invalidate: false only for writes that change nothing the app has cached (the monthly note).
  async _post(payload, { invalidate = true } = {}) {
    try {
      const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ ...payload, token: AUTH.get() }),
      });
      if (!res.ok) throw new Error(`POST failed: ${res.status}`);
      const data = await res.json();
      if (data.error === 'unauthorized') { showTokenModal(); throw new Error('unauthorized'); }
      if (data.error) throw new Error(data.error);
      return data;
    } finally {
      // Any write can change Holdings, Insights and the snapshot chart / panel — drop them all here,
      // even when the request failed (it may have saved part of its work, e.g. a Take snapshot
      // that logged your prices before a download failed).
      if (invalidate) {
        if (typeof _insightsCache !== 'undefined') _insightsCache = null;
        if (typeof _holdingsAllRows !== 'undefined') _holdingsAllRows = null;
        try { LSC.clear('insights', 'holdings'); } catch (_) {}
        if (typeof invalidateSnapshots === 'function') invalidateSnapshots();
        if (typeof _historyFull !== 'undefined') _historyFull = {};
      }
    }
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
  async createTransaction(stream, txnData, requestId) {
    return this.insert(stream.txnTable, txnData, requestId);
  },

  // Update manual price entry
  async updateManualPrice(assetType, assetId, pricePerUnit, priceDate, requestId) {
    return this.insert('manual_prices', {
      asset_type: assetType,
      asset_id: assetId,
      price_per_unit: pricePerUnit,
      price_date: priceDate,
    }, requestId);
  },
};

// Duplicate-save protection: one id per form submission, sent with the insert. Pressing Save again
// after an error resends the SAME id for the same values, so a save whose reply was lost is not
// written twice (the server remembers ids for 6 h). Changed values or a successful save → new id.
function requestIdFor(el, row) {
  if (!el.dataset.reqBase) el.dataset.reqBase = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const json = JSON.stringify(row);
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  return el.dataset.reqBase + ':' + (h >>> 0).toString(36);
}
function requestDone(el) { delete el.dataset.reqBase; }

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

// Every asset, active or not — past transactions (History, Recent) still need their names
async function fetchAllAssetsCached(stream) {
  const cached = CACHE.get(stream.assetTable, { all: true });
  if (cached) return cached;
  const data = await API.get(stream.assetTable, { limit: 1000000 });
  CACHE.set(stream.assetTable, { all: true }, data.rows);
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
    if (typeof invalidateSnapshots === 'function') invalidateSnapshots();
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

  // forceGlobal=true stores the hide with an empty account (applies to every view).
  async hide(kind, ref, name, forceGlobal = false) {
    ref = String(ref);
    const account = forceGlobal ? '' : this._scope();
    await API.insert('hidden_items', { account_id: account, kind, ref, name: name || '' });
    this.rows.push({ kind, ref, account });
    this._clearCaches();
  },

  async unhide(kind, ref, forceGlobal = false) {
    ref = String(ref);
    const account = forceGlobal ? '' : this._scope();
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
    if (typeof invalidateSnapshots === 'function') invalidateSnapshots();
    try { LSC.clear('insights', 'holdings'); } catch (_) {}
  },
};

// ── Batch read (single request for Insights / Holdings) ────────────────────────
API.batchGet = async function(sheets) {
  const params = new URLSearchParams({ action: 'batchGet', sheets: sheets.join(','), token: AUTH.get() });   // every row
  const res = await fetch(`${CONFIG.APPS_SCRIPT_URL}?${params}`);
  if (!res.ok) throw new Error('batchGet failed: ' + res.status);
  const data = await res.json();
  if (data.error === 'unauthorized') { showTokenModal(); throw new Error('unauthorized'); }
  if (data.error) throw new Error(data.error);
  Object.entries(data).forEach(([t, r]) => {           // never compute from a partial table
    if (r && Array.isArray(r.rows) && r.total > r.rows.length) throw new Error(t + ': only ' + r.rows.length + ' of ' + r.total + ' rows loaded');
  });
  return data;
};

// ── Monthly snapshots — read endpoints (gas/snapshot.gs) ───────────────
// action: 'snapshotData' ({ account }), 'snapshotLines' ({ date, account }) or 'snapshotForm' (no params).
API.snapshot = async function(action, params = {}) {
  const q = new URLSearchParams(Object.assign({ action, token: AUTH.get() }, params));
  const res = await fetch(`${CONFIG.APPS_SCRIPT_URL}?${q}`);
  if (!res.ok) throw new Error(action + ' failed: ' + res.status);
  const data = await res.json();
  if (data.error === 'unauthorized') { showTokenModal(); throw new Error('unauthorized'); }
  if (data.error) throw new Error(data.error);
  return data;
};

// "Take snapshot" (Insights): saves the manual prices and builds this month's snapshot (8th–14th).
API.takeSnapshot = function(prices) {
  return this._post({ action: 'takeSnapshot', prices });
};

// The Factsheet's monthly note, saved right after a Take snapshot (gas/snapshot.gs vzsSaveNote_).
API.saveManagerNote = function(month, account, note) {
  return this._post({ action: 'saveManagerNote', month, account, note }, { invalidate: false });
};

// That month's "What's happening" feed, saved with the note (gas/snapshot.gs vzsSavePatterns_).
API.savePatternHistory = function(month, account, rows) {
  return this._post({ action: 'savePatternHistory', month, account, rows }, { invalidate: false });
};

// ── localStorage cache with 30-minute TTL ──────────────────────────────────────
// Build a map of "asset_type|asset_id" → latest price from manual_prices rows
function buildManualPricesMap(rows) {
  const latest = {};
  const today = localYMD(new Date());
  rows.forEach(r => {
    if (localYMD(r.price_date) > today) return;          // a mistyped future date must not override every later price
    const key = `${r.asset_type}|${String(r.asset_id)}`;
    const d = new Date(r.price_date), id = Number(r.id) || 0;
    const cur = latest[key], cd = cur && new Date(cur.date);
    // Same date twice → the later entry (higher id) is the correction — same rule as gas/snapshot.gs.
    if (!cur || d > cd || (d.getTime() === cd.getTime() && id > cur.id)) {
      latest[key] = { price: parseFloat(r.price_per_unit), date: r.price_date, id };
    }
  });
  const result = {};
  Object.entries(latest).forEach(([k, { price }]) => { result[k] = price; });
  return result;
}

const LSC = {
  TTL: 30 * 60 * 1000,
  PREFIX: 'vz_v3_',   // bump when cached shapes/ids change (v2: range-scheme ids; v3: dates as calendar days)
  get(key) {
    try {
      const raw = localStorage.getItem(this.PREFIX + key);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      return (Date.now() - ts) < this.TTL ? data : null;
    } catch (_) { return null; }
  },
  set(key, data) {
    try { localStorage.setItem(this.PREFIX + key, JSON.stringify({ data, ts: Date.now() })); } catch (_) {}
  },
  clear(...keys) {
    keys.forEach(k => { try { localStorage.removeItem(this.PREFIX + k); } catch (_) {} });
  },
};
