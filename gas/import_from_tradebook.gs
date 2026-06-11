/**
 * VaultZero — Import equity/debt transactions from Zerodha Tradebook CSV (one at a time)
 *
 * HOW TO USE:
 *   1. Paste one tradebook CSV into the "Tradebook" tab (A1, including header)
 *   2. Run importFromTradebook()
 *   3. Clear the Tradebook tab, paste the next CSV, run again
 *
 * Unique key: order_id. Existing → row updated (financial fields only, preserving
 * goal_id/notes/created_at); new → inserted. Header-aware: rows are written by
 * matching each sheet's actual header names, so adding columns never misaligns data.
 */

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
  'INF109K01Q49': null, // ICICI Liquid — skip (not in debt_hybrid_funds)
};

function importFromTradebook() {
  const ss          = vaultSpreadsheet_();
  const tradebookSh = ss.getSheetByName('Tradebook');
  const eqSheet     = ss.getSheetByName('equity_transactions');
  const debtSheet   = ss.getSheetByName('debt_hybrid_transactions');

  if (!tradebookSh) { notify_('Sheet "Tradebook" not found.'); return; }
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
    const managed = { id: orderId, txn_type: txnType, txn_date: dateStr, units: qty, nav: price, amount };

    const eqFund = ISIN_TO_FUND[isin];
    if (eqFund) {
      managed.fund_id = eqFund.id;
      pushUpsert(eq, eqIdToRow, orderId, eqFund.id, managed, dateMs);
      continue;
    }
    if (isin in DEBT_ISIN_TO_FUND) {
      const debtFund = DEBT_ISIN_TO_FUND[isin];
      if (!debtFund) { skipped.push({ line: i + 1, symbol, isin, reason: 'Not in debt_hybrid_funds — skipped' }); continue; }
      managed.fund_id = debtFund.id;
      pushUpsert(debt, debtIdToRow, orderId, debtFund.id, managed, dateMs);
      continue;
    }
    skipped.push({ line: i + 1, symbol, isin, reason: 'ISIN not mapped — fund may predate VaultZero tracking' });
  }

  upsertRows(eqSheet, eq.toUpdate, eq.toInsert);
  upsertRows(debtSheet, debt.toUpdate, debt.toInsert);

  const skipLines = skipped.length
    ? '\n\nSkipped:\n' + skipped.slice(0, 8).map(s => `• Line ${s.line}: ${s.symbol} — ${s.reason}`).join('\n') +
      (skipped.length > 8 ? `\n… and ${skipped.length - 8} more` : '')
    : '';
  notify_(
    `✅  Done\n\nequity_transactions\n  Inserted : ${eq.toInsert.length}   Updated : ${eq.toUpdate.length}\n\n` +
    `debt_hybrid_transactions\n  Inserted : ${debt.toInsert.length}   Updated : ${debt.toUpdate.length}\n\nSkipped : ${skipped.length}` + skipLines
  );
}

// ── Shared helpers (used by import_from_coin.gs too) ──────────────────────────

// Build an upsert entry. Inserts add notes/created_at defaults; updates carry only
// the managed (financial) fields so any other columns are preserved.
function pushUpsert(bucket, idToRow, orderId, fundId, managed, dateMs, notes) {
  if (idToRow[orderId]) {
    bucket.toUpdate.push({ sheetRow: idToRow[orderId], fields: managed });
  } else {
    bucket.toInsert.push({
      dateMs, fundId,
      fields: Object.assign({}, managed, { notes: notes || '', created_at: new Date() }),
    });
  }
}

// VaultZero spreadsheet — works whether the script is container-bound or standalone.
function vaultSpreadsheet_() {
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) {}
  return SpreadsheetApp.openById('1R4yXbxb6YgXh-rDqnnw3iWOZe2ABcYMD96iN5hvDi5A');
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
