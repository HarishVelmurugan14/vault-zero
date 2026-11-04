/**
 * VaultZero — Import equity/debt transactions from a Zerodha Tradebook CSV into a
 * chosen VaultZero account (Self, Thulasi, Harini, …).
 *
 * ⚠️ LIVES IN THE TRADEBOOK APPS SCRIPT PROJECT (bound to the Tradebook sheet), together with
 * import_from_coin.gs — NOT in the VaultZero project. It READS VaultZero directly (fund lists)
 * but WRITES only through the VaultZero web app (action upsertBySourceRef), so every row
 * passes VaultZero's constraints, write lock and id sequence (gas/schema.gs there).
 *
 * ONE-TIME SETUP (in this project): run setVaultZeroApiToken('<the same API key the app uses>').
 *
 * HOW TO USE:
 *   1. Paste one tradebook CSV into the "Tradebook" (or "Sheet1") tab (A1, incl. header)
 *   2. Run importTradebook()  → prompts which account,
 *      or run importTradebook_Self() / _Thulasi() / _Harini().
 *   3. Clear the tab, paste the next CSV, run again.
 *
 * WHY per-account: a transaction's account is derived from its fund_id
 * (fund → fund.account_id), so each account needs its OWN fund rows in VaultZero.
 *
 * PER-PERSON FUND LISTS: each account has its own ISIN → fund map below
 * (ISIN_TO_FUND_A3 = Thulasi, ISIN_TO_FUND_A4 = Harini, …). To add a fund:
 *   1. In the VaultZero app, switch to that person and add the fund.
 *   2. Copy the new row's `id` from equity_funds / debt_hybrid_funds.
 *   3. Add  'ISIN': { id: <that id>, name: '...' }  to that person's map.
 * Safety check: an id must belong to THAT account, or the row is skipped — so a
 * typo can never drop Thulasi's trades into your account.
 *
 * Shortcut: a fund Self also holds can be left out of a person's map — the importer
 * matches it automatically by scheme `code` against that person's own fund rows.
 *
 * Upsert key: source_ref (UNIQUE) = the broker order_id — account 1 uses it raw, every
 * other account `order_id-a<accountId>`, so two people's demats reusing an order_id stay
 * distinct. Existing → financial fields updated (notes/created_at kept); new → inserted
 * with a fresh VaultZero id. ⚠️ Never import the same trades into two accounts.
 */

// ── ISIN catalog = Self's funds (account 1). Also reused by import_from_coin.gs ──
const ISIN_TO_FUND = {
  'INF966L01986': { id: 1,  name: 'Quant ELSS Tax Saver' },
  'INF200K01UM9': { id: 2,  name: 'SBI ELSS Tax Saver' },
  'INF740K01OK1': { id: 3,  name: 'DSP ELSS Tax Saver' },
  'INF179K01XQ0': { id: 4,  name: 'HDFC Mid Cap' },
  'INF277K011O1': { id: 5,  name: 'Tata Small Cap' },
  'INF109K016L0': { id: 6,  name: 'ICICI Large Cap' },
  'INF109KC12U0': { id: 7,  name: 'ICICI LargeMidcap 250 Index' },
  'INF879O01027': { id: 8,  name: 'Parag Parikh Flexi Cap' },
  'INF179K01UT0': { id: 9,  name: 'HDFC Flexi Cap' },
  'INF843K01AO4': { id: 10, name: 'Edelweiss Mid Cap' },
  'INF959L01FP2': { id: 11, name: 'Navi Nifty 50 Index' },
  'INF204K01K15': { id: 12, name: 'Nippon India Small Cap' },
};
const DEBT_ISIN_TO_FUND = {
  'INF109K01T04': { id: 1, name: 'ICICI Prudential Ultra Short Term' },
  'INF204K01YH3': { id: 2, name: 'Nippon India Ultra Short Duration' },
  'INF174K01LC6': { id: 3, name: 'Kotak Arbitrage' },
  'INF109K016O4': { id: 4, name: 'ICICI Prudential Equity Arbitrage' },
  'INF109K01Q49': { id: 5, name: 'ICICI Liquid' },
  'INF846K01CX4': { id: 6, name: 'Axis Liquid' },
  'INF205K01KR8': { id: 7, name: 'Invesco India Arbitrage' },
};

// ── Account 3 (Thulasi) — her own funds (ids from her rows in VaultZero) ────────
const ISIN_TO_FUND_A3 = {
  // 'INF879O01027': { id: 31, name: 'Parag Parikh Flexi Cap' },
};
const DEBT_ISIN_TO_FUND_A3 = {
  // 'INF109K01Q49': { id: 11, name: 'ICICI Liquid' },
};

// ── Account 4 (Harini) — her own funds ─────────────────────────────────────────
const ISIN_TO_FUND_A4 = {
  // 'INF...': { id: 41, name: '...' },
};
const DEBT_ISIN_TO_FUND_A4 = {
  // 'INF...': { id: 21, name: '...' },
};

// Registry: account id → { name, equity, debt }. Add a block + a row per new account.
// The id must match the person's row in VaultZero's `accounts` tab (create it in the app first).
const ACCOUNT_MAPS = {
  1: { name: 'Self',    equity: ISIN_TO_FUND,    debt: DEBT_ISIN_TO_FUND },
  3: { name: 'Thulasi', equity: ISIN_TO_FUND_A3, debt: DEBT_ISIN_TO_FUND_A3 },
  4: { name: 'Harini',  equity: ISIN_TO_FUND_A4, debt: DEBT_ISIN_TO_FUND_A4 },
};

// ── Run these ─────────────────────────────────────────────────────────────────
function importTradebook_Self()    { importTradebookForAccount(1); }
function importTradebook_Thulasi() { importTradebookForAccount(3); }
function importTradebook_Harini()  { importTradebookForAccount(4); }
function importFromTradebook()     { importTradebookForAccount(1); }  // back-compat alias

// Asks which account (when a UI is available), else defaults to Self.
function importTradebook() {
  var accountId = 1;
  try {
    var ui = SpreadsheetApp.getUi();
    var res = ui.prompt('Import Tradebook', 'Which account?   ' + accountOptions_(), ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return;
    accountId = parseInt(res.getResponseText().trim(), 10);
  } catch (e) { /* headless — default to Self */ }
  importTradebookForAccount(accountId);
}

// Core importer for a given VaultZero account.
function importTradebookForAccount(accountId) {
  const dataSS = vaultDataSpreadsheet_();
  const acct   = resolveAccountMaps_(accountId, dataSS);
  if (!acct) { notify_('Unknown account ' + accountId + '. Choose one of: ' + accountOptions_() + '\n(Add new accounts to ACCOUNT_MAPS in import_from_tradebook.gs.)'); return; }

  const srcSS       = vaultSpreadsheet_();
  const tradebookSh = srcSS.getSheetByName('Tradebook') || srcSS.getSheetByName('Sheet1');
  if (!tradebookSh) { notify_('Paste the tradebook CSV into a "Tradebook" or "Sheet1" tab, then run again.'); return; }

  const rawData = tradebookSh.getDataRange().getValues();
  if (rawData.length < 2) { notify_('Tradebook sheet is empty.'); return; }
  const srcTz = srcSS.getSpreadsheetTimeZone();

  const headerRow = rawData[0].map(c => String(c).trim().toLowerCase());
  const C = {
    symbol:  headerRow.indexOf('symbol'),
    isin:    headerRow.indexOf('isin'),
    date:    headerRow.indexOf('trade_date'),
    type:    headerRow.indexOf('trade_type'),
    auction: headerRow.indexOf('auction'),
    qty:     headerRow.indexOf('quantity'),
    price:   headerRow.indexOf('price'),
    orderId: headerRow.indexOf('order_id'),
  };
  if (C.isin === -1 || C.date === -1 || C.orderId === -1) {
    notify_('Could not find required columns (isin, trade_date, order_id).');
    return;
  }

  // Account-scoped source_ref so the same order id can live under multiple accounts.
  // Account 1 keeps the raw order_id (matches existing Self rows).
  const refFor = oid => (String(accountId) === '1' ? oid : oid + '-a' + accountId);

  const eq = [], debt = [];
  const skipped = [];

  for (let i = 1; i < rawData.length; i++) {
    const row     = rawData[i].map(c => String(c).trim());
    const isin    = row[C.isin];
    const symbol  = row[C.symbol];
    const dateStr = cellDateISO_(rawData[i][C.date], srcTz) || row[C.date];
    const type    = (row[C.type] || '').toLowerCase();
    const auction = C.auction >= 0 ? (row[C.auction] || '').toLowerCase() : 'false';
    const qty     = parseFloat(row[C.qty]);
    const price   = parseFloat(row[C.price]);
    const orderId = row[C.orderId];

    if (!isin || !dateStr || !orderId) continue;
    if (auction === 'true') { skipped.push({ line: i + 1, symbol, isin, reason: 'Auction row' }); continue; }
    if (isNaN(qty) || isNaN(price) || qty <= 0 || price <= 0) {
      skipped.push({ line: i + 1, symbol, isin, reason: `Invalid qty=${row[C.qty]} or price=${row[C.price]}` });
      continue;
    }

    const txnType = type === 'sell' ? 'Sell' : 'Buy';
    const amount  = Math.round(qty * price * 100) / 100;
    const dateMs  = new Date(dateStr).getTime();
    const managed = { source_ref: refFor(orderId), txn_type: txnType, txn_date: dateStr, units: qty, nav: price, amount };

    const eqFund = acct.equity[isin];
    if (eqFund) {
      managed.fund_id = eqFund.id;
      pushUpsert(eq, eqFund.id, managed, dateMs);
      continue;
    }
    const debtFund = acct.debt[isin];
    if (debtFund) {
      managed.fund_id = debtFund.id;
      pushUpsert(debt, debtFund.id, managed, dateMs);
      continue;
    }
    skipped.push({ line: i + 1, symbol, isin, reason: acct.unmappedReason(isin) });
  }

  const eqRes   = vzApiUpsert_('equity_transactions', eq);
  const debtRes = vzApiUpsert_('debt_hybrid_transactions', debt);

  const skipLines = skipped.length
    ? '\n\nSkipped:\n' + skipped.slice(0, 8).map(s => `• Line ${s.line}: ${s.symbol} — ${s.reason}`).join('\n') +
      (skipped.length > 8 ? `\n… and ${skipped.length - 8} more` : '')
    : '';
  notify_(
    `✅  Done — ${acct.name} (account ${accountId})\n\nequity_transactions\n  Inserted : ${eqRes.inserted}   Updated : ${eqRes.updated}\n\n` +
    `debt_hybrid_transactions\n  Inserted : ${debtRes.inserted}   Updated : ${debtRes.updated}\n\nSkipped : ${skipped.length}` + skipLines
  );
}

// ── Account resolution (shared with import_from_coin.gs) ───────────────────────

// Full ISIN → { id, name } maps for one account: that account's own list first
// (each id verified to be one of ITS fund rows), then funds shared with Self are
// auto-matched by scheme `code`. Returns null for an unknown account.
function resolveAccountMaps_(accountId, dataSS) {
  const base = ACCOUNT_MAPS[accountId];
  if (!base) return null;
  const want = String(accountId);
  const out = { name: base.name, equity: {}, debt: {} };
  const bad = {};     // ISIN → reason, for list entries that failed the safety check
  const known = {};   // ISIN → { kind, code } for Self-catalog ISINs (auto-match candidates)

  [['equity', 'equity_funds', ISIN_TO_FUND], ['debt', 'debt_hybrid_funds', DEBT_ISIN_TO_FUND]].forEach(spec => {
    const kind = spec[0], table = spec[1], selfMap = spec[2], funds = readFundRows_(dataSS, table);
    const byId = {}, mineByCode = {};
    funds.forEach(f => {
      byId[f.id] = f;
      if (f.account === want && f.code) mineByCode[f.code] = f;
    });

    // 1) this account's own list — id must exist AND belong to this account
    const list = base[kind] || {};
    Object.keys(list).forEach(isin => {
      const id = String(list[isin].id), f = byId[id];
      if (!f)                    bad[isin] = `${base.name}'s list points to ${kind} fund id ${id}, which doesn't exist in ${table}`;
      else if (f.account !== want) bad[isin] = `${base.name}'s list points to fund id ${id}, but that fund belongs to account ${f.account} — fix the id`;
      else out[kind][isin] = { id: Number(id), name: list[isin].name || f.name };
    });

    // 2) funds shared with Self → match this account's fund by scheme code
    Object.keys(selfMap).forEach(isin => {
      const self = byId[String(selfMap[isin].id)];
      if (!self || !self.code) return;
      known[isin] = { kind: kind, code: self.code };
      if (out[kind][isin] || bad[isin]) return;
      const f = mineByCode[self.code];
      if (f) out[kind][isin] = { id: Number(f.id), name: f.name };
    });
  });

  out.unmappedReason = isin => bad[isin]
    || (known[isin]
      ? `${base.name} has no fund for this scheme yet — add it in VaultZero under ${base.name}`
      : `ISIN not in ${base.name}'s list — add it to ACCOUNT_MAPS[${accountId}]'s map in import_from_tradebook.gs`);
  return out;
}

function readFundRows_(ss, table) {
  const sh = ss.getSheetByName(table);
  if (!sh) return [];
  const v = sh.getDataRange().getValues();
  if (v.length < 2) return [];
  const h = v[0].map(x => String(x).trim());
  const iId = h.indexOf('id'), iAcc = h.indexOf('account_id'), iCode = h.indexOf('code'), iName = h.indexOf('fund_name');
  return v.slice(1).filter(r => String(r[iId]).trim() !== '').map(r => ({
    id:      String(r[iId]).trim().replace(/\.0$/, ''),
    account: iAcc >= 0 ? (String(r[iAcc]).trim().replace(/\.0$/, '') || '1') : '1',   // legacy blank = Self
    code:    iCode >= 0 ? String(r[iCode]).trim() : '',
    name:    iName >= 0 ? String(r[iName]).trim() : '',
  }));
}

function accountOptions_() {
  return Object.keys(ACCOUNT_MAPS).map(k => k + ' = ' + ACCOUNT_MAPS[k].name).join(',  ');
}

// ── Shared helpers (used by import_from_coin.gs too) ──────────────────────────

// Queue one row for the VaultZero upsert. `fields` are written on insert AND update;
// `onInsert` only on insert (so notes typed later in VaultZero are never overwritten).
function pushUpsert(list, fundId, managed, dateMs, notes) {
  list.push({ dateMs, fundId, fields: managed, onInsert: { notes: notes || '' } });
}

// VaultZero web app (same URL as js/config.js). Writes go through it — never directly.
const VZ_API_URL = 'https://script.google.com/macros/s/AKfycbwv8qssFUIA0aUDSDCrQ1CBWbVHM-Y0nFMO5ViruYshTJFJXuxYfu240Vb8MRsrIVPO/exec';

// Run once in this project: setVaultZeroApiToken('<the API key you use in the VaultZero app>')
function setVaultZeroApiToken(token) {
  PropertiesService.getScriptProperties().setProperty('VZ_API_TOKEN', String(token || '').trim());
  Logger.log('VZ_API_TOKEN ' + (token ? 'set' : 'cleared'));
}

// Send one table's rows to VaultZero. Rows are sent oldest-first so new ids follow trade
// order. VaultZero validates the whole batch: one bad row → nothing is written, and the
// constraint error is thrown here.
function vzApiUpsert_(table, list) {
  if (!list.length) return { inserted: 0, updated: 0 };
  list.sort((a, b) => a.dateMs - b.dateMs || a.fundId - b.fundId);
  const res = UrlFetchApp.fetch(VZ_API_URL, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      action: 'upsertBySourceRef',
      sheet: table,
      rows: list.map(x => ({ fields: x.fields, onInsert: x.onInsert })),
      token: PropertiesService.getScriptProperties().getProperty('VZ_API_TOKEN') || '',
    }),
  });
  let body;
  try { body = JSON.parse(res.getContentText()); }
  catch (e) { throw new Error('VaultZero returned a non-JSON response (HTTP ' + res.getResponseCode() + ')'); }
  if (body.error === 'unauthorized') throw new Error('VaultZero rejected the API key — run setVaultZeroApiToken(...) with the key the app uses.');
  if (body.error) throw new Error(table + ': ' + body.error);
  return body;
}

// A source sheet often auto-converts its date column to real Date cells. String()
// on those gives "Mon Jun 01 2026 00:00:00 GMT+0530 (India Standard Time)", which
// used to be written into txn_date as TEXT. Returns 'yyyy-MM-dd' for a Date cell
// (in the source sheet's timezone, so the calendar day is preserved), else null.
function cellDateISO_(cell, tz) {
  if (!(cell instanceof Date) || isNaN(cell.getTime())) return null;
  return Utilities.formatDate(cell, tz, 'yyyy-MM-dd');
}

const VAULTZERO_ID_ = '1R4yXbxb6YgXh-rDqnnw3iWOZe2ABcYMD96iN5hvDi5A';

// Where the CSV is pasted — the spreadsheet you're running from (active), else VaultZero.
function vaultSpreadsheet_() {
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) {}
  return SpreadsheetApp.openById(VAULTZERO_ID_);
}

// The VaultZero database — read-only from here (fund lists). Writes go via vzApiUpsert_.
function vaultDataSpreadsheet_() {
  return SpreadsheetApp.openById(VAULTZERO_ID_);
}

// Alert when a UI is available, otherwise log — so the function never crashes
// with "Cannot call SpreadsheetApp.getUi() from this context".
function notify_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}
