/**
 * VaultZero — relational schema & constraints (the SQL-equivalent layer).
 *
 * Google Sheets enforces nothing, so every write path checks these rules before it writes:
 * the web app (appendRow / updateRows / deleteRow / upsertBySourceRef in Code.gs). The
 * Coin / Tradebook importers live in a separate Apps Script project and write ONLY through
 * upsertBySourceRef, so they hit the same constraints, write lock and id sequences.
 *
 *   PRIMARY KEY   id — numeric, unique, assigned by the server as MAX(id)+1, immutable
 *   UNIQUE        the natural keys below. A blank value is NULL and never collides (as in
 *                 SQL), except keys marked nullsEqual (hidden_items: '' = "all accounts").
 *   FOREIGN KEY   child.col → parent.id, plus two polymorphic refs (manual_prices.asset_id,
 *                 hidden_items.ref). ON DELETE RESTRICT; hidden_items rows CASCADE.
 *   CHECK         enum lists, booleans, real dates, subcategory belongs to the right category
 *   NOT NULL      required columns
 *   SERVER-ONLY   snapshots / snapshot_lines: written only by the monthly snapshot job
 *                 (gas/snapshot.gs) — the web app refuses every insert / update / delete.
 *
 * checkConstraints() — read-only audit of the whole database against this schema.
 * Writes are only accepted for tables listed here (StockIQ's tabs are not, by design).
 */

const VZ_SCHEMA = {
  buckets:       { notNull: ['name'], unique: [['name']] },
  categories:    { notNull: ['bucket_id', 'name'], unique: [['name']], fk: { bucket_id: 'buckets' } },
  subcategories: { notNull: ['category_id', 'name'], unique: [['category_id', 'name']], fk: { category_id: 'categories' } },
  accounts:      { notNull: ['name'], unique: [['name']], bool: ['is_active'] },

  // Assets: one row per (account, natural key); subcategory must belong to the given category.
  // Category ids follow the range scheme (1–9 in bucket order; subcategory = category×100 + n).
  equity_funds:                   vzAsset_(1,    'fund_name',    ['code'], null, [['account_id', 'isin']]),
  debt_hybrid_funds:              vzAsset_(5,    'fund_name',    ['code'], null, [['account_id', 'isin']]),
  indian_equity_stocks_assets:    vzAsset_(2,    'company_name', ['ticker'], { strategy: ['Long Term', 'Dividend', 'Short Term'] }),
  us_equity_assets:               vzAsset_(3,    'name',         ['ticker'], { asset_type: ['ETF', 'STOCK'] }),
  precious_metal_etf_assets:      vzAsset_(8,    'name',         ['code']),
  precious_metal_physical_assets: vzAsset_(8,    'name',         ['name'],   { metal_type: ['Gold', 'Silver'], form: ['Coin', 'Bar', 'Jewellery'] }),
  crypto_assets:                  vzAsset_(9,    'name',         ['ticker']),
  real_estate_assets:             vzAsset_(4,    'name',         ['name'],   { unit_of_measure: ['Cents', 'Sq.ft', 'Acres', 'Sq.m'] }),
  epf_assets:                     vzAsset_(null, 'account_name', ['account_name'], null, [['account_id']]),   // one EPF per account
  bank_assets:                    vzAsset_(null, 'account_name', ['account_name'], { account_type: ['Savings', 'Current', 'FD', 'RD'] }),

  // Transactions. source_ref = the broker's order id (UNIQUE) — the importers' upsert key.
  equity_transactions:                  vzTxn_('fund_id',  'equity_funds',                   ['Buy', 'Sell'], { sourceRef: true }),
  debt_hybrid_transactions:             vzTxn_('fund_id',  'debt_hybrid_funds',              ['Buy', 'Sell'], { sourceRef: true }),
  indian_equity_stocks_transactions:    vzTxn_('asset_id', 'indian_equity_stocks_assets',    ['Buy', 'Sell']),
  us_equity_transactions:               vzTxn_('asset_id', 'us_equity_assets',               ['BUY', 'SELL'], { fk: { wire_id: 'us_wires' } }),
  precious_metal_etf_transactions:      vzTxn_('asset_id', 'precious_metal_etf_assets',      ['Buy', 'Sell']),
  precious_metal_physical_transactions: vzTxn_('asset_id', 'precious_metal_physical_assets', ['Buy', 'Sell']),
  crypto_transactions:                  vzTxn_('asset_id', 'crypto_assets',                  ['Buy', 'Sell']),
  real_estate_transactions:             vzTxn_('asset_id', 'real_estate_assets',             ['Buy', 'Sell']),
  // EPF passbook entries, per account (each account has one EPF — epf_assets):
  // Contribution = your + employer EPF share; Interest = the yearly credit.
  epf_transactions: Object.assign(vzTxn_('account_id', 'accounts', ['Contribution', 'Interest', 'Withdrawal']),
                                  { notNull: ['account_id', 'txn_type', 'txn_date', 'amount'] }),

  us_wires:         { notNull: ['account_id', 'wire_date'], fk: { account_id: 'accounts' }, dates: ['wire_date'],
                      enums: { status: ['received', 'sent'] } },   // payment_reference repeats (IBKR's account text) — not a key
  us_repatriations: { notNull: ['account_id', 'repat_date'], fk: { account_id: 'accounts' }, dates: ['repat_date'],
                      enums: { status: ['received', 'sent'] } },
  us_income:        { notNull: ['account_id', 'income_type', 'income_date'], fk: { account_id: 'accounts' },
                      dates: ['income_date'], enums: { income_type: ['Dividend', 'Interest'] } },

  // A price log — several entries per asset are expected, so no unique key here.
  manual_prices: { notNull: ['asset_type', 'asset_id', 'price_date'], dates: ['price_date'],
                   enums: { asset_type: ['physical_precious_metal', 'real_estate'] },
                   poly: { asset_id: { by: 'asset_type', map: { physical_precious_metal: 'precious_metal_physical_assets',
                                                                real_estate: 'real_estate_assets' } } } },
  // UI hide preferences. account_id '' = every account. ref → category / subcategory / "table|id".
  hidden_items: { notNull: ['kind', 'ref'], fk: { account_id: 'accounts' },
                  enums: { kind: ['category', 'subcategory', 'asset'] },
                  unique: [{ cols: ['account_id', 'kind', 'ref'], nullsEqual: true }], hiddenRef: true },

  // Monthly snapshots — immutable history (gas/snapshot.gs). Lines copy the asset name and
  // carry NO foreign key to the asset tables on purpose: a past month must survive the asset
  // being sold, edited or deleted later.
  // snapshot_date is TEXT 'yyyy-mm-01' (never a Date cell), so a spreadsheet timezone change can't relabel months.
  snapshots:      { notNull: ['month', 'snapshot_date', 'source'], unique: [['month']],          // one per month
                    patterns: { month: '^\\d{4}-\\d{2}$', snapshot_date: '^\\d{4}-\\d{2}-\\d{2}$' },   // as-of day: any day
                    enums: { source: ['backfill', 'manual'] }, serverOnly: true },
  snapshot_lines: { notNull: ['snapshot_id', 'snapshot_date', 'category_id', 'asset_table', 'asset_id', 'asset_name',
                              'invested_value', 'current_value', 'price_source'],
                    fk: { snapshot_id: 'snapshots' }, unique: [['snapshot_id', 'asset_table', 'asset_id']],
                    patterns: { snapshot_date: '^\\d{4}-\\d{2}-\\d{2}$', price_date: '^\\d{4}-\\d{2}-\\d{2}$' },
                    enums: { price_source: ['sheet', 'amfi', 'yahoo', 'manual', 'cost', 'epf'] }, serverOnly: true },
};

function vzAsset_(categoryId, nameCol, keyCols, enums, extraUnique) {
  return {
    notNull: ['account_id', nameCol].concat(categoryId ? ['subcategory_id'] : []),
    unique:  [['account_id'].concat(keyCols)].concat(extraUnique || []),
    fk:      categoryId ? { account_id: 'accounts', subcategory_id: 'subcategories' } : { account_id: 'accounts' },
    subcategoryOf: categoryId,
    bool:    ['is_active'],
    enums:   enums || {},
  };
}

function vzTxn_(fkCol, parent, txnTypes, opts) {
  opts = opts || {};
  return {
    notNull: [fkCol, 'txn_type', 'txn_date'],
    fk:      Object.assign({ [fkCol]: parent }, opts.fk || {}),
    enums:   { txn_type: txnTypes },
    dates:   ['txn_date'],
    unique:  opts.sourceRef ? [['source_ref']] : [],
  };
}

// ── PRIMARY KEY sequence (like SQL AUTO_INCREMENT: a deleted id is never reused) ──
// Call only while holding the script write lock. currentMax = MAX(id) in the sheet now.
function vzNextId_(table, currentMax) {
  const props = PropertiesService.getScriptProperties();
  const key = 'vz_seq_' + table;
  const next = Math.max(Number(props.getProperty(key)) || 0, Number(currentMax) || 0) + 1;
  props.setProperty(key, String(next));
  return next;
}

// A run of ids for a bulk write with ONE property read + ONE write (Script Properties have a
// daily quota, and each call is slow). Call commit() after the rows are written.
function vzIdBlock_(table, currentMax) {
  const props = PropertiesService.getScriptProperties();
  const key = 'vz_seq_' + table;
  let last = Math.max(Number(props.getProperty(key)) || 0, Number(currentMax) || 0);
  return { next() { return ++last; }, commit() { props.setProperty(key, String(last)); } };
}

// A range write (getRange(...).setValues) cannot go past the sheet's grid — appendRow grows it,
// setValues does not. Make sure rows up to `lastRow` exist before writing a block.
function vzEnsureRows_(sh, lastRow) {
  const max = sh.getMaxRows();
  if (lastRow > max) sh.insertRowsAfter(max, lastRow - max);
}

// Raise a table's sequence so ids up to `n` are never handed out again.
function vzBumpSequence_(table, n) {
  const props = PropertiesService.getScriptProperties();
  const key = 'vz_seq_' + table;
  if ((Number(props.getProperty(key)) || 0) < n) props.setProperty(key, String(n));
}

// ── Read context (each table read at most once per execution) ────────────────

function vzCtx_(ss) {
  const cache = {};
  return {
    ss,
    table(name) {
      if (!cache[name]) {
        const sh = ss.getSheetByName(name);
        if (!sh || sh.getLastRow() < 1) { cache[name] = { headers: [], rows: [] }; return cache[name]; }
        const data = sh.getDataRange().getValues();
        const headers = data[0].map(h => String(h).trim());
        const rows = data.slice(1)
          .filter(r => r.some(v => v !== '' && v !== null))
          .map(r => { const o = {}; headers.forEach((h, i) => { o[h] = r[i]; }); return o; });
        cache[name] = { headers, rows };
      }
      return cache[name];
    },
    ids(name) {
      const t = this.table(name);
      if (!t.idSet) t.idSet = new Set(t.rows.map(r => vzKey_(r.id)));
      return t.idSet;
    },
    // UNIQUE index: Map(normalised key → [ids]) per (table, cols) — O(1) lookups, built on first use.
    uidx(name, cols, nullsEqual) {
      const t = this.table(name);
      const k = cols.join('|') + (nullsEqual ? '|=' : '');
      t.uidx = t.uidx || {};
      if (!t.uidx[k]) {
        const m = new Map();
        t.rows.forEach(r => vzIdxPut_(m, vzUKey_(r, cols, nullsEqual), vzKey_(r.id)));
        t.uidx[k] = { m, cols, nullsEqual };
      }
      return t.uidx[k].m;
    },
    add(name, row) {                        // keep the cache true while a batch is written
      const t = this.table(name);
      t.rows.push(row);
      if (t.idSet) t.idSet.add(vzKey_(row.id));
      Object.values(t.uidx || {}).forEach(ix => vzIdxPut_(ix.m, vzUKey_(row, ix.cols, ix.nullsEqual), vzKey_(row.id)));
    },
    replace(name, id, row) {
      const t = this.table(name);
      const i = t.rows.findIndex(r => vzKey_(r.id) === vzKey_(id));
      if (i < 0) return;
      Object.values(t.uidx || {}).forEach(ix => {
        const old = vzUKey_(t.rows[i], ix.cols, ix.nullsEqual);
        if (old !== null && ix.m.has(old)) ix.m.set(old, ix.m.get(old).filter(x => x !== vzKey_(id)));
        vzIdxPut_(ix.m, vzUKey_(row, ix.cols, ix.nullsEqual), vzKey_(row.id));
      });
      if (t.idSet) { t.idSet.delete(vzKey_(id)); t.idSet.add(vzKey_(row.id)); }   // a replacement may carry a new id
      t.rows[i] = row;
    },
  };
}

// 3, 3.0 and "3" compare equal; blanks become ''.
function vzKey_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  const s = String(v).trim();
  const n = Number(s);
  return s !== '' && isFinite(n) ? String(n) : s;
}

function vzBlank_(v) { return v === null || v === undefined || String(v).trim() === ''; }

// Normalised UNIQUE key for a row (null when a column is blank and blanks don't collide).
function vzUKey_(row, cols, nullsEqual) {
  if (!nullsEqual && cols.some(c => vzBlank_(row[c]))) return null;
  return cols.map(c => vzKey_(row[c]).toLowerCase()).join('|');
}

function vzIdxPut_(m, key, id) {
  if (key === null) return;
  if (!m.has(key)) m.set(key, []);
  m.get(key).push(id);
}

function vzIsDate_(v) {
  if (v instanceof Date) return !isNaN(v.getTime());
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v.trim()) && !isNaN(new Date(v.trim()).getTime());
}

// headers + value array → { header: value }
function vzRowObj_(headers, arr) {
  const o = {};
  headers.forEach((h, i) => { o[h] = arr[i]; });
  return o;
}

// Before writing: turn 'yyyy-mm-dd' strings in the table's date columns into real Date
// cells (midnight in the sheet's timezone), so stored dates never depend on Sheets
// guessing at a string. rows = arrays aligned to headers. Returns new arrays.
function vzCoerceDates_(table, headers, rows, tz) {
  const idx = ((VZ_SCHEMA[table] || {}).dates || []).map(c => headers.indexOf(c)).filter(i => i >= 0);
  if (!idx.length) return rows;
  return rows.map(r => {
    const out = r.slice();
    idx.forEach(i => {
      const v = out[i];
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) out[i] = Utilities.parseDate(v.trim(), tz, 'yyyy-MM-dd');
    });
    return out;
  });
}

// ── Row validation ───────────────────────────────────────────────────────────

// Every constraint violation for `row` in `table`. selfId = the row's own id when it is an
// existing row (excluded from the UNIQUE scan), null for a new row.
function vzValidateRow_(ctx, table, row, selfId) {
  const spec = VZ_SCHEMA[table];
  if (!spec) return ['writes are not allowed to "' + table + '" (not a VaultZero table)'];
  const errs = [];
  const val = c => row[c];

  (spec.notNull || []).forEach(c => { if (vzBlank_(val(c))) errs.push(c + ' is required'); });

  Object.keys(spec.enums || {}).forEach(c => {
    if (!vzBlank_(val(c)) && spec.enums[c].indexOf(String(val(c))) < 0) {
      errs.push(c + ' = "' + val(c) + '" — must be one of ' + spec.enums[c].join(' / '));
    }
  });
  (spec.bool || []).forEach(c => {
    const v = val(c);
    if (!vzBlank_(v) && v !== true && v !== false && ['TRUE', 'FALSE'].indexOf(String(v).toUpperCase()) < 0) {
      errs.push(c + ' = "' + v + '" — must be TRUE or FALSE');
    }
  });
  Object.keys(spec.patterns || {}).forEach(c => {
    if (!vzBlank_(val(c)) && !(typeof val(c) === 'string' && new RegExp(spec.patterns[c]).test(val(c)))) {
      errs.push(c + ' = "' + val(c) + '" — must match ' + spec.patterns[c] + ' (stored as text)');
    }
  });
  (spec.dates || []).forEach(c => {
    if (!vzBlank_(val(c)) && !vzIsDate_(val(c))) errs.push(c + ' = "' + val(c) + '" — must be a real date (yyyy-mm-dd)');
  });

  Object.keys(spec.fk || {}).forEach(c => {
    if (!vzBlank_(val(c)) && !ctx.ids(spec.fk[c]).has(vzKey_(val(c)))) {
      errs.push(c + ' = ' + vzKey_(val(c)) + ' — no such row in ' + spec.fk[c]);
    }
  });
  Object.keys(spec.poly || {}).forEach(c => {
    const p = spec.poly[c];
    const parent = p.map[String(val(p.by))];
    if (parent && !vzBlank_(val(c)) && !ctx.ids(parent).has(vzKey_(val(c)))) {
      errs.push(c + ' = ' + vzKey_(val(c)) + ' — no such row in ' + parent);
    }
  });
  if (spec.subcategoryOf && !vzBlank_(val('subcategory_id'))) {
    const sub = ctx.table('subcategories').rows.find(s => vzKey_(s.id) === vzKey_(val('subcategory_id')));
    if (sub && vzKey_(sub.category_id) !== String(spec.subcategoryOf)) {
      errs.push('subcategory_id = ' + vzKey_(val('subcategory_id')) + ' belongs to category ' + vzKey_(sub.category_id) +
                ', not ' + spec.subcategoryOf);
    }
  }
  if (spec.hiddenRef && !vzBlank_(val('ref'))) {
    const kind = String(val('kind')), ref = String(val('ref'));
    if (kind === 'category'    && !ctx.ids('categories').has(vzKey_(ref)))    errs.push('ref = ' + ref + ' — no such category');
    if (kind === 'subcategory' && !ctx.ids('subcategories').has(vzKey_(ref))) errs.push('ref = ' + ref + ' — no such subcategory');
    if (kind === 'asset') {
      const parts = ref.split('|');
      if (!VZ_SCHEMA[parts[0]] || !ctx.ids(parts[0]).has(vzKey_(parts[1]))) errs.push('ref = ' + ref + ' — no such asset');
    }
  }

  (spec.unique || []).forEach(u => {
    const cols = Array.isArray(u) ? u : u.cols;
    const nullsEqual = !Array.isArray(u) && u.nullsEqual;
    const key = vzUKey_(row, cols, nullsEqual);
    if (key === null) return;                                         // NULL never collides
    const clash = (ctx.uidx(table, cols, nullsEqual).get(key) || []).find(id => id !== vzKey_(selfId));
    if (clash !== undefined) errs.push('UNIQUE (' + cols.join(', ') + ') = (' + cols.map(c => vzKey_(val(c))).join(', ') +
                                       ') already used by id ' + clash);
  });

  return errs;
}

function vzAssertRow_(ctx, table, row, selfId) {
  const errs = vzValidateRow_(ctx, table, row, selfId);
  if (errs.length) throw new Error('Constraint violation in ' + table + ': ' + errs.join('; '));
}

// ── Delete rules ─────────────────────────────────────────────────────────────

// Children that point at (table, id). RESTRICT unless every referencing row is a
// hidden_items preference — those are returned so the caller can CASCADE them.
function vzDeleteCheck_(ctx, table, id) {
  const key = vzKey_(id);
  const blockers = [];
  Object.keys(VZ_SCHEMA).forEach(child => {
    const spec = VZ_SCHEMA[child];
    Object.keys(spec.fk || {}).forEach(c => {
      if (spec.fk[c] !== table) return;
      const n = ctx.table(child).rows.filter(r => vzKey_(r[c]) === key).length;
      if (n) blockers.push(n + ' row(s) in ' + child + '.' + c);
    });
    Object.keys(spec.poly || {}).forEach(c => {
      const p = spec.poly[c];
      Object.keys(p.map).forEach(tag => {
        if (p.map[tag] !== table) return;
        const n = ctx.table(child).rows.filter(r => String(r[p.by]) === tag && vzKey_(r[c]) === key).length;
        if (n) blockers.push(n + ' row(s) in ' + child + '.' + c);
      });
    });
  });
  if (table === 'subcategories') {                     // subcategoryOf is a soft FK
    Object.keys(VZ_SCHEMA).forEach(t => {
      if (!VZ_SCHEMA[t].subcategoryOf) return;
      const n = ctx.table(t).rows.filter(r => vzKey_(r.subcategory_id) === key).length;
      if (n) blockers.push(n + ' row(s) in ' + t + '.subcategory_id');
    });
  }
  const cascade = ctx.table('hidden_items').rows.filter(r =>
    (table === 'categories'    && r.kind === 'category'    && vzKey_(r.ref) === key) ||
    (table === 'subcategories' && r.kind === 'subcategory' && vzKey_(r.ref) === key) ||
    (r.kind === 'asset' && String(r.ref).split('|')[0] === table && vzKey_(String(r.ref).split('|')[1]) === key) ||
    (table === 'accounts' && vzKey_(r.account_id) === key));
  return { blockers: [...new Set(blockers)], cascadeHiddenIds: cascade.map(r => r.id) };
}

// ── Whole-database audit ─────────────────────────────────────────────────────

function checkConstraints() {
  const report = vzCheckAll_(getSpreadsheet());
  const lines = ['VaultZero constraint check — ' + (report.violations.length ? report.violations.length + ' violation(s)' : 'clean ✓'), ''];
  report.violations.forEach(v => lines.push('  • ' + v));
  if (report.missingTables.length) lines.push('', 'Missing tables: ' + report.missingTables.join(', '));
  Logger.log(lines.join('\n'));
  try { SpreadsheetApp.getUi().alert(lines.slice(0, 40).join('\n')); } catch (e) { /* editor: log only */ }
  return report;
}

function vzCheckAll_(ss) {
  const ctx = vzCtx_(ss);
  const violations = [];
  const missingTables = [];
  Object.keys(VZ_SCHEMA).forEach(t => {
    if (!ss.getSheetByName(t)) { missingTables.push(t); return; }
    const tab = ctx.table(t);
    if (tab.headers.indexOf('id') < 0) { violations.push(t + ': no id column'); return; }
    const seen = {};
    tab.rows.forEach(r => {
      const id = vzKey_(r.id);
      if (id === '')                    violations.push(t + ': row with NULL id');
      else if (!isFinite(Number(id)))   violations.push(t + ' id ' + id + ': id must be numeric');
      else if (seen[id])                violations.push(t + ' id ' + id + ': duplicate PRIMARY KEY');
      seen[id] = true;
      vzValidateRow_(ctx, t, r, r.id).forEach(e => violations.push(t + ' id ' + id + ': ' + e));
    });
  });
  return { violations, missingTables };
}
