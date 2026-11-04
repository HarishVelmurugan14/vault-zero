/**
 * VaultZero — one-off DATA cleanup + migration to the relational model (Nov 2026).
 *
 *   1. cleanupVaultZeroDryRun()  — logs every change it WOULD make. Writes nothing.
 *   2. cleanupVaultZeroApply()   — makes a backup copy of the spreadsheet, then applies,
 *                                  then audits the result with checkConstraints() rules.
 *
 * Scope: VaultZero tables only. StockIQ's SCREENER_* and _GF_SCRATCH tabs are never read,
 * edited or deleted — that app stays as-is (legacy).
 *
 * What it does:
 *   A. Deletes retired tabs   — the SIP structure (budgets / events / reasons) and US Equity
 *                               (IndMoney). Real SIP *purchases* live in equity_transactions /
 *                               debt_hybrid_transactions and are NOT touched.
 *   B. Retires categories (IndMoney, both SIP) + their subcategories; restructures Debt &
 *      Hybrid by SEBI fund type (moves funds, drops the emptied subcategories); retires
 *      account 2 and its rows — refusing if any of them still carries transactions.
 *   C. Cleans hidden_items    — rows pointing at anything removed + exact duplicates.
 *   D. Renumbers duplicate ids in leaf tables (tables whose ids no other table references).
 *   E. Converts TEXT dates    — e.g. "Mon Jun 01 2026 00:00:00 GMT+0530 (India Standard Time)".
 *   F. Renames subcategories  — VZC_SUBCATEGORY_RENAMES.
 *   G. Drops retired columns  — debt_hybrid_funds.purpose.
 *   H. Range-scheme ids       — categories 1–9 in bucket order; subcategory = category×100 + n.
 *                               Matched by NAME, and every reference is remapped (assets,
 *                               subcategories.category_id, hidden_items refs).
 *   I. Adds source_ref        — equity/debt transactions: the broker order id moves into its
 *                               own UNIQUE column (filled from today's id); importers upsert on it.
 *   J. Seeds id sequences     — so a deleted id (e.g. account 2) is never handed out again.
 *   K. Sorts rows by id       — categories / subcategories read in range order in the sheet.
 *
 * Re-running is a no-op: every step matches on names/ids that no longer exist after a run.
 * Depends on getSpreadsheet() (Code.gs) and the constraint layer (schema.gs).
 * Keep js/data.js (CATEGORIES, SUBCAT_NAMES) in sync with VZC_ID_PLAN.
 */

// ── Config ───────────────────────────────────────────────────────────────────

const VZC_RETIRED_TABS = [
  'equity_sip_budget', 'equity_sip_events', 'equity_sip_reasons',
  'debt_sip_budget', 'debt_sip_events', 'debt_sip_reasons',
  'us_eq_indmoney_assets', 'us_eq_indmoney_transactions',
];
// Matched by NAME — after the renumber, ids 3/8/9 belong to live categories.
const VZC_RETIRED_CATEGORY_NAMES = ['US Equity (IndMoney)', 'Indian EQ MF SIP', 'Debt & Hybrid MF SIP'];
const VZC_RETIRED_HIDDEN_KINDS = ['sip_reason', 'sip_type'];
// Matched by id AND name — a future account that reuses nothing is never touched.
const VZC_RETIRED_ACCOUNTS = [{ id: 2, name: 'Oppurtunity' }];

// Debt & Hybrid → SEBI fund type. Funds are moved first, then the emptied subcategories go.
const VZC_SUBCATEGORY_MOVES = {
  debt_hybrid_funds: { 12: 10, 15: 11 },           // Yearly Bills → Ultra Short, Oppurtunity → Arbitrage
};
const VZC_RETIRED_SUBCATEGORIES = [{ id: 12, name: 'Yearly Bills' }, { id: 15, name: 'Oppurtunity Fund' }];

// Keyed by the CURRENT (pre-renumber) subcategory id.
const VZC_SUBCATEGORY_RENAMES = {
  10: 'Ultra Short Duration',    // was 'Commitment Fund'   (ICICI Ultra Short + Nippon Ultra Short)
  11: 'Arbitrage',               // was 'Safety Fund'       (Kotak + ICICI Equity + Invesco Arbitrage)
  13: 'Liquid',                  // was 'Monthly Emergency' (Axis Liquid + ICICI Liquid)
  22: 'Large Cap',               // Indian Equity Stocks — was generic 'Long Term Holding'
  23: 'Mid & Small Cap',         // Indian Equity Stocks — was 'Short Term Benefits'
  26: 'Land & Plots',            // Real Estate          — was 'Long Term Holding'
  28: 'Majors (BTC & ETH)',      // Cryptocurrency       — was 'Long Term Holding'
  // 'Digital' / 'Physical' must NOT be renamed: resolveStream() matches on those names.
};

// H. Target ids, by category name → { id, subs: { subcategory name: id } }.
const VZC_ID_PLAN = {
  'Indian EQ Mutual Fund':     { id: 1, subs: { 'Large Cap': 101, 'Mid Cap': 102, 'Small Cap': 103,
                                                'Flexi Cap': 104, 'ELSS': 105, 'Index': 106 } },
  'Indian Equity Stocks':      { id: 2, subs: { 'Large Cap': 201, 'Mid & Small Cap': 202 } },
  'US Equity':                 { id: 3, subs: { 'ETF': 301, 'Stocks': 302 } },
  'Real Estate':               { id: 4, subs: { 'Land & Plots': 401 } },
  'Debt & Hybrid Mutual Fund': { id: 5, subs: { 'Liquid': 501, 'Ultra Short Duration': 502, 'Arbitrage': 503 } },
  'EPF':                       { id: 6, subs: {} },
  'Bank Accounts':             { id: 7, subs: {} },
  'Precious Metals':           { id: 8, subs: { 'Digital': 801, 'Physical': 802 } },
  'Cryptocurrency':            { id: 9, subs: { 'Majors (BTC & ETH)': 901 } },
};

// I. New columns: inserted after `after`, filled from `fillFrom` (as text).
const VZC_ADD_COLUMNS = [
  { table: 'equity_transactions',      column: 'source_ref', after: 'id', fillFrom: 'id' },
  { table: 'debt_hybrid_transactions', column: 'source_ref', after: 'id', fillFrom: 'id' },
];

// K. Reference tables kept physically sorted by id (row order has no meaning to the app).
const VZC_SORT_TABLES = ['categories', 'subcategories'];

const VZC_RETIRED_COLUMNS = [
  { table: 'debt_hybrid_funds', column: 'purpose' },
];

// Asset table → its transaction table + FK column (used to prove a retired row is unused).
const VZC_ASSET_TXNS = {
  equity_funds:                   ['equity_transactions', 'fund_id'],
  debt_hybrid_funds:              ['debt_hybrid_transactions', 'fund_id'],
  indian_equity_stocks_assets:    ['indian_equity_stocks_transactions', 'asset_id'],
  us_equity_assets:               ['us_equity_transactions', 'asset_id'],
  precious_metal_etf_assets:      ['precious_metal_etf_transactions', 'asset_id'],
  precious_metal_physical_assets: ['precious_metal_physical_transactions', 'asset_id'],
  crypto_assets:                  ['crypto_transactions', 'asset_id'],
  real_estate_assets:             ['real_estate_transactions', 'asset_id'],
  us_wires:                       ['us_equity_transactions', 'wire_id'],
  epf_assets:                     null,
  bank_assets:                    null,
  us_repatriations:               null,
  us_income:                      null,
};

// Tables whose `id` no other table points at — duplicates here can be safely renumbered.
const VZC_LEAF_TABLES = [
  'equity_transactions', 'debt_hybrid_transactions', 'indian_equity_stocks_transactions',
  'us_equity_transactions', 'precious_metal_etf_transactions', 'precious_metal_physical_transactions',
  'crypto_transactions', 'real_estate_transactions', 'us_repatriations', 'us_income',
  'hidden_items', 'manual_prices',
];
// Referenced by other tables — duplicate ids are only REPORTED (renumbering would break links).
const VZC_PARENT_TABLES = [
  'buckets', 'categories', 'subcategories', 'accounts',
  'equity_funds', 'debt_hybrid_funds', 'indian_equity_stocks_assets', 'us_equity_assets',
  'precious_metal_etf_assets', 'precious_metal_physical_assets', 'crypto_assets', 'real_estate_assets',
  'epf_assets', 'bank_assets', 'us_wires',
];
// Asset tables that carry a subcategory_id.
const VZC_ASSET_TABLES_WITH_SUBCAT = [
  'equity_funds', 'debt_hybrid_funds', 'indian_equity_stocks_assets', 'us_equity_assets',
  'precious_metal_etf_assets', 'precious_metal_physical_assets', 'crypto_assets', 'real_estate_assets',
];
const VZC_DATE_COLS = ['txn_date', 'effective_date', 'wire_date', 'repat_date', 'income_date', 'price_date'];

// ── Entry points ─────────────────────────────────────────────────────────────

function cleanupVaultZeroDryRun() {
  const ss = getSpreadsheet();
  const plan = vzcBuildPlan_(ss);
  vzcReport_('DRY RUN — nothing was changed', plan);
}

function cleanupVaultZeroApply() {
  const lock = LockService.getScriptLock();   // the same write lock the app & importers use
  lock.waitLock(30000);
  try {
    const ss = getSpreadsheet();
    const plan = vzcBuildPlan_(ss);
    if (plan.blockers.length) {
      vzcReport_('ABORTED — fix the blockers first. Nothing was changed', plan);
      return;
    }
    if (!vzcHasWork_(plan)) {
      plan.constraints = vzCheckAll_(ss);
      vzcReport_('Nothing to do — VaultZero is already clean', plan);
      return;
    }

    const stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HHmm');
    const backup = ss.copy('VaultZero backup — before cleanup ' + stamp);
    plan.backupUrl = backup.getUrl();

    // 1. Cell edits first — they address ORIGINAL row/column numbers. Batched: one read and
    //    one write per (tab, column). Only the edited columns are written — never formula columns.
    const tz = ss.getSpreadsheetTimeZone();
    const cols = {};                                   // "table|col" → { table, col, cells: {row: value}, fmt }
    const put = (table, col, row, value, fmt) => {
      const k = table + '|' + col;
      (cols[k] = cols[k] || { table, col, cells: {}, fmt: null }).cells[row] = value;
      if (fmt) cols[k].fmt = fmt;
    };
    plan.dateFixes.forEach(f => put(f.table, f.col, f.row, Utilities.parseDate(f.iso, tz, 'yyyy-MM-dd'), f.numberFormat));
    plan.idFixes.forEach(f => put(f.table, f.col, f.row, f.newId));
    plan.moves.forEach(m => put(m.table, m.col, m.row, m.to));
    plan.renames.forEach(r => put(r.table, r.col, r.row, r.to));
    plan.idRemaps.forEach(r => put(r.table, r.col, r.row, r.to));
    Object.keys(cols).forEach(k => {
      const c = cols[k], sh = ss.getSheetByName(c.table), n = sh.getLastRow() - 1;
      const range = sh.getRange(2, c.col, n, 1);
      const vals = range.getValues();
      Object.keys(c.cells).forEach(row => { vals[Number(row) - 2][0] = c.cells[row]; });
      range.setValues(vals);
      if (c.fmt) range.setNumberFormat(c.fmt);
    });

    // 2. Row deletions, bottom-up, one call per contiguous run of rows.
    const bySheet = {};
    plan.rowDeletes.forEach(d => (bySheet[d.table] = bySheet[d.table] || []).push(d.row));
    Object.keys(bySheet).forEach(t => {
      const sh = ss.getSheetByName(t);
      const rs = bySheet[t].sort((a, b) => b - a);
      for (let i = 0; i < rs.length; ) {
        let j = i;
        while (j + 1 < rs.length && rs[j + 1] === rs[j] - 1) j++;
        sh.deleteRows(rs[j], i === j ? 1 : rs[i] - rs[j] + 1);   // rs[j] is the run's top row
        i = j + 1;
      }
    });

    // 3. Column deletions, then column additions (headers looked up fresh each time).
    const headersOf = sh => sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
    plan.colDeletes.forEach(c => {
      const sh = ss.getSheetByName(c.table);
      const idx = headersOf(sh).indexOf(c.column);
      if (idx >= 0) sh.deleteColumn(idx + 1);
    });
    plan.addColumns.forEach(c => {
      const sh = ss.getSheetByName(c.table);
      const headers = headersOf(sh);
      if (headers.indexOf(c.column) >= 0) return;
      const after = headers.indexOf(c.after);
      sh.insertColumnAfter(after + 1);
      const col = after + 2;
      sh.getRange(1, col).setValue(c.column);
      const n = sh.getLastRow() - 1;
      if (n > 0) {
        const src = sh.getRange(2, headers.indexOf(c.fillFrom) + 1 + (headers.indexOf(c.fillFrom) > after ? 1 : 0), n, 1).getValues();
        const target = sh.getRange(2, col, n, 1);
        target.setNumberFormat('@');                         // stored as TEXT (order ids are keys)
        target.setValues(src.map(r => [vzcId_(r[0])]));
      }
    });

    // 4. Tab deletions last.
    plan.tabDeletes.forEach(name => {
      vzcAssertVaultZeroTab_(name);
      const sh = ss.getSheetByName(name);
      if (sh) ss.deleteSheet(sh);
    });

    // 5. Sort reference tables by id (values only — these tabs hold no formulas).
    plan.sorts.forEach(t => {
      const sh = ss.getSheetByName(t);
      const n = sh.getLastRow() - 1;
      if (n < 2) return;
      const idIdx = headersOf(sh).indexOf('id');
      const range = sh.getRange(2, 1, n, sh.getLastColumn());
      range.setValues(range.getValues().sort((a, b) => Number(a[idIdx]) - Number(b[idIdx])));
    });

    // 6. Sequences: never hand out an id that existed before this run.
    Object.keys(plan.origMaxIds).forEach(t => vzBumpSequence_(t, plan.origMaxIds[t]));

    SpreadsheetApp.flush();
    plan.postCheck = vzcBuildPlan_(ss);        // re-scan: should report nothing left to do
    plan.constraints = vzCheckAll_(ss);        // full PK / UNIQUE / FK / CHECK / NOT NULL audit
    vzcReport_('APPLIED', plan);
  } finally {
    lock.releaseLock();
  }
}

// ── Planning (read-only) ─────────────────────────────────────────────────────

function vzcBuildPlan_(ss) {
  const tz = ss.getSpreadsheetTimeZone();
  const memo = {};
  const read = name => (memo[name] = memo[name] || vzcRead_(ss, name));   // each tab read once
  const plan = { tabDeletes: [], rowDeletes: [], idFixes: [], dateFixes: [], moves: [], renames: [],
                 idRemaps: [], colDeletes: [], addColumns: [], dupParents: [], unparseableDates: [],
                 sorts: [], blockers: [], origMaxIds: {} };
  const deleting = {};                                   // "table|row" → true
  const deletedAssetRefs = new Set();                    // "table|id" of asset rows being deleted
  const markDelete = (table, row, why) => {
    if (deleting[table + '|' + row]) return;
    deleting[table + '|' + row] = true;
    plan.rowDeletes.push({ table, row, why });
  };
  const retiredTabs = new Set(VZC_RETIRED_TABS);

  // Highest id per table today — seeds the sequences (J).
  VZC_LEAF_TABLES.concat(VZC_PARENT_TABLES).forEach(t => {
    let max = 0;
    read(t).rows.forEach(r => { const v = Number(r.get('id')); if (isFinite(v) && v > max) max = v; });
    plan.origMaxIds[t] = max;
  });

  // A. Retired tabs
  VZC_RETIRED_TABS.forEach(name => {
    vzcAssertVaultZeroTab_(name);
    if (ss.getSheetByName(name)) plan.tabDeletes.push(name);
  });

  // B1. Retired categories (by name) + every subcategory to retire
  const cats = read('categories');
  const retiredCats = new Set();
  cats.rows.forEach(r => {
    if (VZC_RETIRED_CATEGORY_NAMES.indexOf(String(r.get('name'))) >= 0) {
      retiredCats.add(vzcId_(r.get('id')));
      markDelete('categories', r.row, 'retired category "' + r.get('name') + '"');
    }
  });
  const subs = read('subcategories');
  const retiredSubs = new Set();
  const explicitSub = r => VZC_RETIRED_SUBCATEGORIES.some(x =>
    String(x.id) === vzcId_(r.get('id')) && x.name === String(r.get('name')));
  subs.rows.forEach(r => {
    const id = vzcId_(r.get('id'));
    const why = retiredCats.has(vzcId_(r.get('category_id'))) ? 'of a retired category'
              : explicitSub(r) ? 'emptied by the Debt & Hybrid restructure' : null;
    if (why) { retiredSubs.add(id); markDelete('subcategories', r.row, 'subcategory ' + id + ' "' + r.get('name') + '" ' + why); }
  });

  // B2. Retired accounts (id AND name) — delete their rows only if nothing depends on them
  const retiredAccts = new Set();
  read('accounts').rows.forEach(r => {
    if (VZC_RETIRED_ACCOUNTS.some(a => String(a.id) === vzcId_(r.get('id')) && a.name === String(r.get('name')))) {
      retiredAccts.add(vzcId_(r.get('id')));
      markDelete('accounts', r.row, 'retired account "' + r.get('name') + '"');
    }
  });
  Object.keys(VZC_ASSET_TXNS).forEach(t => {
    const tab = read(t);
    if (!tab.exists || tab.col('account_id') < 0) return;
    const link = VZC_ASSET_TXNS[t];
    const usedIds = new Set();
    if (link) read(link[0]).rows.forEach(x => usedIds.add(vzcId_(x.get(link[1]))));
    tab.rows.forEach(r => {
      if (!retiredAccts.has(vzcId_(r.get('account_id')))) return;
      const id = vzcId_(r.get('id'));
      const label = t + ' id ' + id + ' "' + (r.get('fund_name') || r.get('name') || r.get('company_name') || r.get('account_name') || '') + '"';
      if (usedIds.has(id)) { plan.blockers.push(label + ' belongs to the retired account but ' + link[0] + ' still references it'); return; }
      markDelete(t, r.row, label + ' of the retired account (no transactions)');
      deletedAssetRefs.add(t + '|' + id);
    });
  });

  // B3. Debt & Hybrid restructure: move funds, then check nothing is left in a retired subcategory
  Object.keys(VZC_SUBCATEGORY_MOVES).forEach(t => {
    const map = VZC_SUBCATEGORY_MOVES[t];
    const tab = read(t);
    tab.rows.forEach(r => {
      const from = vzcId_(r.get('subcategory_id'));
      if (map[from] === undefined || !retiredSubs.has(from) || deleting[t + '|' + r.row]) return;
      plan.moves.push({ table: t, row: r.row, col: tab.col('subcategory_id') + 1, from, to: map[from],
                        name: r.get('fund_name') || r.get('name') || '' });
    });
  });
  const moved = new Set(plan.moves.map(m => m.table + '|' + m.row));
  VZC_ASSET_TABLES_WITH_SUBCAT.forEach(t => {
    read(t).rows.forEach(r => {
      if (deleting[t + '|' + r.row] || moved.has(t + '|' + r.row)) return;
      if (retiredSubs.has(vzcId_(r.get('subcategory_id')))) {
        plan.blockers.push(t + ' id ' + vzcId_(r.get('id')) + ' is filed under retired subcategory ' + vzcId_(r.get('subcategory_id')));
      }
    });
  });

  // C. hidden_items: refs to removed things, then exact duplicates among the survivors
  const hid = read('hidden_items');
  const seen = {};
  hid.rows.forEach(r => {
    const kind = String(r.get('kind') || '');
    const ref  = String(r.get('ref') || '');
    const acct = vzcId_(r.get('account_id'));
    const refKey = ref.split('|')[0] + '|' + vzcId_(ref.split('|')[1]);
    let why = null;
    if (retiredAccts.has(acct))                                          why = 'hide scoped to the retired account';
    else if (VZC_RETIRED_HIDDEN_KINDS.indexOf(kind) >= 0)                why = 'retired kind ' + kind;
    else if (kind === 'category'    && retiredCats.has(vzcId_(ref)))     why = 'hides retired category ' + vzcId_(ref);
    else if (kind === 'subcategory' && retiredSubs.has(vzcId_(ref)))     why = 'hides retired subcategory ' + vzcId_(ref);
    else if (kind === 'asset' && retiredTabs.has(ref.split('|')[0]))     why = 'hides asset in deleted tab ' + ref;
    else if (kind === 'asset' && deletedAssetRefs.has(refKey))           why = 'hides deleted asset ' + ref;
    if (why) { markDelete('hidden_items', r.row, why); return; }
    const key = acct + '|' + kind + '|' + ref;
    if (seen[key]) markDelete('hidden_items', r.row, 'duplicate of row ' + seen[key] + ' (' + key + ')');
    else seen[key] = r.row;
  });

  // D. Duplicate ids — renumber in leaf tables, report in parent tables
  VZC_LEAF_TABLES.concat(VZC_PARENT_TABLES).forEach(t => {
    const tab = read(t);
    if (!tab.exists || tab.col('id') < 0) return;
    const isLeaf = VZC_LEAF_TABLES.indexOf(t) >= 0;
    let maxId = plan.origMaxIds[t] || 0;
    const firstRow = {};
    tab.rows.forEach(r => {
      const id = vzcId_(r.get('id'));
      if (id === '' || deleting[t + '|' + r.row]) return;
      if (!firstRow[id]) { firstRow[id] = r.row; return; }
      if (isLeaf) {
        plan.idFixes.push({ table: t, row: r.row, col: tab.col('id') + 1, oldId: id, newId: ++maxId, keptRow: firstRow[id] });
        plan.origMaxIds[t] = maxId;
      } else {
        plan.dupParents.push(t + ' id ' + id + ' at rows ' + firstRow[id] + ' & ' + r.row + ' (manual fix — other tables reference it)');
      }
    });
  });

  // E. Text dates → real dates (all kept VaultZero tables)
  VZC_LEAF_TABLES.concat(VZC_PARENT_TABLES).forEach(t => {
    if (retiredTabs.has(t)) return;
    const tab = read(t);
    if (!tab.exists) return;
    VZC_DATE_COLS.forEach(colName => {
      const c = tab.col(colName);
      if (c < 0) return;
      let fmt = null;                                    // copy the format of a real date cell
      tab.rows.some(r => {
        if (r.values[c] instanceof Date) { fmt = tab.sheet.getRange(r.row, c + 1).getNumberFormat(); return true; }
        return false;
      });
      if (!fmt || fmt === '@' || fmt === 'General') fmt = 'yyyy-mm-dd';
      tab.rows.forEach(r => {
        const v = r.values[c];
        if (typeof v !== 'string' || v.trim() === '' || deleting[t + '|' + r.row]) return;
        const iso = vzcParseTextDate_(v, tz);
        if (iso) plan.dateFixes.push({ table: t, row: r.row, col: c + 1, colName, from: v, iso, numberFormat: fmt });
        else     plan.unparseableDates.push(t + ' row ' + r.row + ' ' + colName + ' = "' + v + '"');
      });
    });
  });

  // F. Subcategory renames (+ keep hidden_items' name snapshot in step — cosmetic)
  const finalSubName = {};                               // current sub id → name after this run
  const subRenamed = {};
  subs.rows.forEach(r => {
    const id = vzcId_(r.get('id'));
    if (deleting['subcategories|' + r.row]) return;
    const to = VZC_SUBCATEGORY_RENAMES[id];
    finalSubName[id] = to || String(r.get('name'));
    if (to && String(r.get('name')) !== to) {
      plan.renames.push({ table: 'subcategories', row: r.row, col: subs.col('name') + 1, from: r.get('name'), to });
      subRenamed[id] = to;
    }
  });
  hid.rows.forEach(r => {
    if (String(r.get('kind')) !== 'subcategory' || deleting['hidden_items|' + r.row]) return;
    const to = subRenamed[vzcId_(r.get('ref'))];
    if (to && String(r.get('name')) !== to) plan.renames.push({ table: 'hidden_items', row: r.row, col: hid.col('name') + 1, from: r.get('name'), to });
  });

  // G. Retired columns
  VZC_RETIRED_COLUMNS.forEach(c => {
    if (read(c.table).col(c.column) >= 0) plan.colDeletes.push(c);
  });

  // H. Range-scheme ids, matched by NAME (so a re-run maps every row onto itself)
  const catNew = {}, catName = {}, subNew = {};
  cats.rows.forEach(r => {
    if (deleting['categories|' + r.row]) return;
    const old = vzcId_(r.get('id')), name = String(r.get('name'));
    catName[old] = name;
    const tgt = VZC_ID_PLAN[name];
    if (!tgt) { plan.blockers.push('category "' + name + '" (id ' + old + ') has no slot in VZC_ID_PLAN'); return; }
    catNew[old] = String(tgt.id);
    if (old !== String(tgt.id)) plan.idRemaps.push({ table: 'categories', row: r.row, col: cats.col('id') + 1, to: tgt.id,
                                                     what: 'category "' + name + '" id ' + old + ' → ' + tgt.id });
  });
  subs.rows.forEach(r => {
    if (deleting['subcategories|' + r.row]) return;
    const old = vzcId_(r.get('id')), oldCat = vzcId_(r.get('category_id'));
    const name = finalSubName[old];
    const tgt = VZC_ID_PLAN[catName[oldCat]];
    const newId = tgt && tgt.subs[name];
    if (!newId) { plan.blockers.push('subcategory "' + name + '" (id ' + old + ', category ' + oldCat + ') has no slot in VZC_ID_PLAN'); return; }
    subNew[old] = String(newId);
    if (old !== String(newId)) plan.idRemaps.push({ table: 'subcategories', row: r.row, col: subs.col('id') + 1, to: newId,
                                                    what: 'subcategory "' + name + '" id ' + old + ' → ' + newId });
    if (catNew[oldCat] && catNew[oldCat] !== oldCat) {
      plan.idRemaps.push({ table: 'subcategories', row: r.row, col: subs.col('category_id') + 1, to: Number(catNew[oldCat]),
                           what: 'subcategory "' + name + '" category_id ' + oldCat + ' → ' + catNew[oldCat] });
    }
  });
  [['category', catNew], ['subcategory', subNew]].forEach(([kind, map]) => {   // no two rows may land on one id
    const used = {};
    Object.keys(map).forEach(o => { if (used[map[o]]) plan.blockers.push(kind + ' ids ' + used[map[o]] + ' and ' + o + ' both map to ' + map[o]); used[map[o]] = o; });
  });
  const moveAt = {};
  plan.moves.forEach(m => { moveAt[m.table + '|' + m.row] = m; });
  VZC_ASSET_TABLES_WITH_SUBCAT.forEach(t => {
    const tab = read(t);
    tab.rows.forEach(r => {
      if (deleting[t + '|' + r.row]) return;
      const m = moveAt[t + '|' + r.row];
      if (m) { if (subNew[String(m.to)]) m.to = Number(subNew[String(m.to)]); return; }   // move straight to the final id
      const old = vzcId_(r.get('subcategory_id'));
      if (!old || retiredSubs.has(old)) return;
      if (subNew[old] === undefined) { plan.blockers.push(t + ' id ' + vzcId_(r.get('id')) + ' uses unknown subcategory ' + old); return; }
      if (subNew[old] !== old) plan.idRemaps.push({ table: t, row: r.row, col: tab.col('subcategory_id') + 1, to: Number(subNew[old]),
                                                     what: t + ' id ' + vzcId_(r.get('id')) + ' subcategory_id ' + old + ' → ' + subNew[old] });
    });
  });
  hid.rows.forEach(r => {
    if (deleting['hidden_items|' + r.row]) return;
    const kind = String(r.get('kind')), ref = vzcId_(r.get('ref'));
    const map = kind === 'category' ? catNew : kind === 'subcategory' ? subNew : null;
    if (map && map[ref] && map[ref] !== ref) {
      plan.idRemaps.push({ table: 'hidden_items', row: r.row, col: hid.col('ref') + 1, to: map[ref],
                           what: 'hidden_items ' + kind + ' ref ' + ref + ' → ' + map[ref] });
    }
  });

  // K. Will the reference tables be in id order once the remaps above are applied?
  [['categories', cats, catNew], ['subcategories', subs, subNew]].forEach(([t, tab, map]) => {
    if (VZC_SORT_TABLES.indexOf(t) < 0) return;
    const finalIds = tab.rows.filter(r => !deleting[t + '|' + r.row])
      .map(r => Number(map[vzcId_(r.get('id'))] || r.get('id')));
    if (finalIds.some((v, i) => i > 0 && v < finalIds[i - 1])) plan.sorts.push(t);
  });

  // I. New columns
  VZC_ADD_COLUMNS.forEach(c => {
    const tab = read(c.table);
    if (tab.exists && tab.col(c.column) < 0) plan.addColumns.push(c);
  });

  return plan;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Read a whole tab once. rows[].row is the 1-based sheet row; get(col) reads by header.
function vzcRead_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 1) return { exists: !!sheet, sheet, rows: [], col: () => -1 };
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const col = h => headers.indexOf(h);
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i].every(v => v === '' || v === null)) continue;
    const values = data[i];
    rows.push({ row: i + 1, values, get: h => (col(h) >= 0 ? values[col(h)] : undefined) });
  }
  return { exists: true, sheet, rows, col };
}

// Normalise an id/ref for comparison: 3, 3.0 and "3" all → "3".
function vzcId_(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  const n = Number(s);
  return s !== '' && isFinite(n) ? String(n) : s;
}

// Text → 'yyyy-MM-dd' (or null). Handles ISO, DD/MM/YYYY (Coin) and JS Date.toString().
function vzcParseTextDate_(s, tz) {
  s = String(s).trim();
  const pad = x => ('0' + x).slice(-2);
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return m[1] + '-' + m[2] + '-' + m[3];
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {               // ISO instant → calendar day in sheet tz
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
  if ((m = s.match(/^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{1,2}) (\d{4})\b/))) {
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[1]);
    return mon < 0 ? null : m[3] + '-' + pad(mon + 1) + '-' + pad(m[2]);
  }
  return null;
}

// Hard stop: this script must never touch StockIQ's tabs.
function vzcAssertVaultZeroTab_(name) {
  if (/^screener/i.test(name) || name.charAt(0) === '_') {
    throw new Error('Refusing to touch non-VaultZero tab: ' + name);
  }
}

function vzcHasWork_(p) {
  return p.tabDeletes.length || p.rowDeletes.length || p.idFixes.length || p.dateFixes.length ||
         p.moves.length || p.renames.length || p.idRemaps.length || p.colDeletes.length || p.addColumns.length ||
         p.sorts.length;
}

function vzcReport_(title, p) {
  const lines = ['VaultZero cleanup — ' + title, ''];
  if (p.backupUrl) lines.push('Backup copy: ' + p.backupUrl, '');
  const CAP = 12;                                      // keep the log under Logger's size limit
  const section = (head, items) => {
    lines.push(head + ' (' + items.length + ')');
    items.slice(0, CAP).forEach(x => lines.push('  • ' + x));
    if (items.length > CAP) lines.push('  … and ' + (items.length - CAP) + ' more');
    lines.push('');
  };
  // Problems first, so a truncated log can never hide them.
  lines.push(p.blockers.length ? '⛔ BLOCKERS: ' + p.blockers.length + ' — nothing will be applied' : 'Blockers: none ✓');
  p.blockers.forEach(x => lines.push('  • ' + x));
  if (p.dupParents.length)       section('⚠ Duplicate ids in referenced tables (NOT changed)', p.dupParents);
  if (p.unparseableDates.length) section('⚠ Text dates that could not be parsed (NOT changed)', p.unparseableDates);
  if (p.postCheck)   lines.push('Post-check (re-plan): ' + (vzcHasWork_(p.postCheck) ? 'items remain — run the dry run again' : 'nothing left to do ✓'));
  if (p.constraints) {
    lines.push('Constraint check: ' + (p.constraints.violations.length ? p.constraints.violations.length + ' violation(s)' : 'clean ✓'));
    p.constraints.violations.slice(0, CAP).forEach(v => lines.push('  • ' + v));
  }
  lines.push('');
  section('A. Tabs to delete', p.tabDeletes);
  section('B/C. Rows to delete', p.rowDeletes.map(d => d.table + ' row ' + d.row + ' — ' + d.why));
  section('B. Subcategory moves', p.moves.map(m => m.table + ' row ' + m.row + ' "' + m.name + '": subcategory ' + m.from + ' → ' + m.to));
  section('D. Duplicate ids to renumber', p.idFixes.map(f => f.table + ' row ' + f.row + ': id ' + f.oldId + ' → ' + f.newId + ' (row ' + f.keptRow + ' keeps ' + f.oldId + ')'));
  section('E. Text dates to convert', p.dateFixes.map(f => f.table + ' row ' + f.row + ' ' + f.colName + ': "' + f.from + '" → ' + f.iso));
  section('F. Renames', p.renames.map(r => r.table + ' row ' + r.row + ': "' + r.from + '" → "' + r.to + '"'));
  section('G. Columns to delete', p.colDeletes.map(c => c.table + '.' + c.column));
  section('H. Id remaps (range scheme)', p.idRemaps.map(r => r.what));
  section('I. Columns to add', p.addColumns.map(c => c.table + '.' + c.column + ' (after ' + c.after + ', filled from ' + c.fillFrom + ')'));
  section('K. Tables to sort by id', p.sorts);

  Logger.log(lines.join('\n'));
  const summary = title + '\n\n' +
    (p.blockers.length ? '⛔ ' + p.blockers.length + ' blocker(s)' : 'Blockers: none ✓') + '\n\n' +
    'Tabs: ' + p.tabDeletes.length + '   Rows deleted: ' + p.rowDeletes.length +
    '   Funds moved: ' + p.moves.length + '\nIds renumbered: ' + p.idFixes.length +
    '   Id remaps: ' + p.idRemaps.length + '   Dates fixed: ' + p.dateFixes.length +
    '\nRenames: ' + p.renames.length + '   Columns −' + p.colDeletes.length + ' +' + p.addColumns.length +
    '   Sorted: ' + p.sorts.length +
    (p.constraints ? '\n\nConstraints: ' + (p.constraints.violations.length ? p.constraints.violations.length + ' violation(s)' : 'clean ✓') : '') +
    (p.backupUrl ? '\n\nBackup: ' + p.backupUrl : '') +
    '\n\nFull detail: View → Logs (Executions).';
  try { SpreadsheetApp.getUi().alert(summary); } catch (e) { /* run from editor — log only */ }
}
