/**
 * VaultZero — Import equity/debt transactions from a Zerodha Tradebook CSV into a
 * chosen VaultZero account (Self, Oppurtunity, Mother, Future Wife, …).
 *
 * HOW TO USE:
 *   1. Paste one tradebook CSV into the "Tradebook" (or "Sheet1") tab (A1, incl. header)
 *   2. Run importTradebook()  → prompts which account,
 *      or run importTradebook_Self() / _Oppurtunity() / _Mother() / _FutureWife().
 *   3. Clear the tab, paste the next CSV, run again.
 *
 * WHY per-account: a transaction's account is derived from its fund_id
 * (fund → fund.account_id), so each account needs its OWN fund rows in VaultZero.
 *
 * PER-PERSON FUND LISTS: each account has its own ISIN → fund map below
 * (ISIN_TO_FUND_A3 = Mother, ISIN_TO_FUND_A4 = Future Wife, …). To add a fund:
 *   1. In the VaultZero app, switch to that person and add the fund.
 *   2. Copy the new row's `id` from equity_funds / debt_hybrid_funds.
 *   3. Add  'ISIN': { id: <that id>, name: '...' }  to that person's map.
 * Safety check: an id must belong to THAT account, or the row is skipped — so a
 * typo can never drop Mother's trades into your account.
 *
 * Shortcut: a fund Self also holds can be left out of a person's map — the importer
 * matches it automatically by scheme `code` against that person's own fund rows.
 *
 * Row ids: account 1 uses the raw order_id (preserves existing data); every other
 * account uses `order_id-a<accountId>`. That keeps rows unique when the same order
 * is mirrored (Oppurtunity) AND when two people's demats reuse the same order_id.
 *
 * ⚠️ Mirroring the same trades into two accounts (Self + Oppurtunity) DOUBLE-COUNTS
 * them in "All Accounts". Separate demats (Mother, Future Wife) don't have this issue.
 *
 * Header-aware upsert keyed on the (account-scoped) id: existing → updated
 * (financial fields only, preserving notes/created_at); new → inserted.
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

// ── Account 2 (Oppurtunity) — mirrors some of Self's funds ────────────────────
const ISIN_TO_FUND_A2 = {
  'INF959L01FP2': { id: 22, name: 'Navi Nifty 50 Index' },
  'INF879O01027': { id: 23, name: 'Parag Parikh Flexi Cap' },
  'INF843K01AO4': { id: 24, name: 'Edelweiss Mid Cap' },
  'INF204K01K15': { id: 25, name: 'Nippon India Small Cap' },
};
const DEBT_ISIN_TO_FUND_A2 = {};

// ── Account 3 (Mother) — her own funds (ids from her rows in VaultZero) ────────
const ISIN_TO_FUND_A3 = {
  // 'INF879O01027': { id: 31, name: 'Parag Parikh Flexi Cap' },
};
const DEBT_ISIN_TO_FUND_A3 = {
  // 'INF109K01Q49': { id: 11, name: 'ICICI Liquid' },
};

// ── Account 4 (Future Wife) — her own funds ───────────────────────────────────
const ISIN_TO_FUND_A4 = {
  // 'INF...': { id: 41, name: '...' },
};
const DEBT_ISIN_TO_FUND_A4 = {
  // 'INF...': { id: 21, name: '...' },
};

// Registry: account id → { name, equity, debt }. Add a block + a row per new account.
const ACCOUNT_MAPS = {
  1: { name: 'Self',        equity: ISIN_TO_FUND,    debt: DEBT_ISIN_TO_FUND },
  2: { name: 'Oppurtunity', equity: ISIN_TO_FUND_A2, debt: DEBT_ISIN_TO_FUND_A2 },
  3: { name: 'Mother',      equity: ISIN_TO_FUND_A3, debt: DEBT_ISIN_TO_FUND_A3 },
  4: { name: 'Future Wife', equity: ISIN_TO_FUND_A4, debt: DEBT_ISIN_TO_FUND_A4 },
};

// ── Run these ─────────────────────────────────────────────────────────────────
function importTradebook_Self()        { importTradebookForAccount(1); }
function importTradebook_Oppurtunity() { importTradebookForAccount(2); }
function importTradebook_Mother()      { importTradebookForAccount(3); }
function importTradebook_FutureWife()  { importTradebookForAccount(4); }
function importFromTradebook()         { importTradebookForAccount(1); }  // back-compat alias

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
  const eqSheet     = dataSS.getSheetByName('equity_transactions');
  const debtSheet   = dataSS.getSheetByName('debt_hybrid_transactions');

  if (!tradebookSh) { notify_('Paste the tradebook CSV into a "Tradebook" or "Sheet1" tab, then run again.'); return; }
  if (!eqSheet)     { notify_('Sheet "equity_transactions" not found.'); return; }
  if (!debtSheet)   { notify_('Sheet "debt_hybrid_transactions" not found.'); return; }

  ensureHeader(eqSheet);
  ensureHeader(debtSheet);

  const eqIdToRow   = buildIdMap(eqSheet);
  const debtIdToRow = buildIdMap(debtSheet);

  const rawData = tradebookSh.getDataRange().getValues();
  if (rawData.length < 2) { notify_('Tradebook sheet is empty.'); return; }

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

  // Account-scoped row id so the same order can live under multiple accounts.
  // Account 1 keeps the raw order_id (preserves existing Self rows).
  const idFor = oid => (String(accountId) === '1' ? oid : oid + '-a' + accountId);

  const eq   = { toInsert: [], toUpdate: [] };
  const debt = { toInsert: [], toUpdate: [] };
  const skipped = [];

  for (let i = 1; i < rawData.length; i++) {
    const row     = rawData[i].map(c => String(c).trim());
    const isin    = row[C.isin];
    const symbol  = row[C.symbol];
    const dateStr = row[C.date];
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
    const rowId   = idFor(orderId);
    const managed = { id: rowId, txn_type: txnType, txn_date: dateStr, units: qty, nav: price, amount };

    const eqFund = acct.equity[isin];
    if (eqFund) {
      managed.fund_id = eqFund.id;
      pushUpsert(eq, eqIdToRow, rowId, eqFund.id, managed, dateMs);
      continue;
    }
    const debtFund = acct.debt[isin];
    if (debtFund) {
      managed.fund_id = debtFund.id;
      pushUpsert(debt, debtIdToRow, rowId, debtFund.id, managed, dateMs);
      continue;
    }
    skipped.push({ line: i + 1, symbol, isin, reason: acct.unmappedReason(isin) });
  }

  upsertRows(eqSheet, eq.toUpdate, eq.toInsert);
  upsertRows(debtSheet, debt.toUpdate, debt.toInsert);

  const skipLines = skipped.length
    ? '\n\nSkipped:\n' + skipped.slice(0, 8).map(s => `• Line ${s.line}: ${s.symbol} — ${s.reason}`).join('\n') +
      (skipped.length > 8 ? `\n… and ${skipped.length - 8} more` : '')
    : '';
  notify_(
    `✅  Done — ${acct.name} (account ${accountId})\n\nequity_transactions\n  Inserted : ${eq.toInsert.length}   Updated : ${eq.toUpdate.length}\n\n` +
    `debt_hybrid_transactions\n  Inserted : ${debt.toInsert.length}   Updated : ${debt.toUpdate.length}\n\nSkipped : ${skipped.length}` + skipLines
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

// Build an upsert entry. Inserts add notes/created_at defaults; updates carry only
// the managed (financial) fields so any other columns are preserved.
function pushUpsert(bucket, idToRow, rowId, fundId, managed, dateMs, notes) {
  if (idToRow[rowId]) {
    bucket.toUpdate.push({ sheetRow: idToRow[rowId], fields: managed });
  } else {
    bucket.toInsert.push({
      dateMs, fundId,
      fields: Object.assign({}, managed, { notes: notes || '', created_at: new Date() }),
    });
  }
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

// The VaultZero database — always the same spreadsheet, regardless of where you run from.
function vaultDataSpreadsheet_() {
  return SpreadsheetApp.openById(VAULTZERO_ID_);
}

// Alert when a UI is available, otherwise log — so the function never crashes
// with "Cannot call SpreadsheetApp.getUi() from this context".
function notify_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function getHeaders(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
}

function ensureHeader(sheet) {
  if (String(sheet.getRange(1, 1).getValue()).trim() !== 'id') {
    throw new Error(`Sheet "${sheet.getName()}" is missing its header row (A1 should be 'id'). Run setupAllSheets first.`);
  }
}

function buildIdMap(sheet) {
  const data = sheet.getDataRange().getValues();
  const idToRow = {};
  for (let i = 1; i < data.length; i++) {
    const oid = String(data[i][0]).trim();
    if (oid) idToRow[oid] = i + 1;
  }
  return idToRow;
}

// Header-aware upsert. Update overwrites only managed fields (preserves goal_id/notes/created_at).
function upsertRows(sheet, toUpdate, toInsert) {
  const headers = getHeaders(sheet);
  const width = headers.length;

  for (const u of toUpdate) {
    const existing = sheet.getRange(u.sheetRow, 1, 1, width).getValues()[0];
    const merged = headers.map((h, i) => (u.fields[h] !== undefined ? u.fields[h] : existing[i]));
    sheet.getRange(u.sheetRow, 1, 1, width).setValues([merged]);
  }

  toInsert.sort((a, b) => a.dateMs - b.dateMs || a.fundId - b.fundId);
  for (const ins of toInsert) {
    sheet.appendRow(headers.map(h => (ins.fields[h] !== undefined ? ins.fields[h] : '')));
  }

  const dateCol = headers.indexOf('txn_date') + 1;
  const totalRows = sheet.getLastRow() - 1;
  if (dateCol > 0 && totalRows > 0) {
    sheet.getRange(2, dateCol, totalRows, 1).setNumberFormat('yyyy-mm-dd');
  }
}
