/**
 * VaultZero — Import equity_transactions from Tradebook (one CSV at a time)
 *
 * HOW TO USE:
 *   1. Paste one tradebook CSV into the "Tradebook" sheet (A1, including header)
 *   2. Run importFromTradebook()
 *   3. Clear Tradebook sheet, paste next CSV, run again
 *
 * id = order_id from tradebook. Upsert logic:
 *   - If order_id already exists in equity_transactions → update that row
 *   - If not → insert new row
 */

// ════════════════════════════════════════════════════════════════════════════
//  CONFIG — ID of your VaultZero Google Sheet
//  Get it from the URL: docs.google.com/spreadsheets/d/<<THIS_PART>>/edit
// ════════════════════════════════════════════════════════════════════════════
const VAULTZERO_SHEET_ID = '1R4yXbxb6YgXh-rDqnnw3iWOZe2ABcYMD96iN5hvDi5A';

const ISIN_TO_FUND = {
  // ── Active funds ───────────────────────────────────────────────────────────
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
  // ── Exited funds (is_active=FALSE in equity_funds) ─────────────────────────
  'INF247L01445': { id: 13, name: 'Motilal Oswal Midcap' },
  'INF966L01AT0': { id: 14, name: 'Quant Large Cap' },
  'INF966L01689': { id: 15, name: 'Quant Small Cap' },
  'INF109KC1FX1': { id: 16, name: 'ICICI Prudential Bharat 22 FOF' },
  'INF174K01LT0': { id: 17, name: 'Kotak Emerging Equity' },
  'INF204K01XI3': { id: 18, name: 'Nippon India Large Cap' },
  'INF789FC12T1': { id: 19, name: 'UTI Nifty Next 50 Index' },
  'INF277KA1BM1': { id: 20, name: 'Tata Nifty500 Multicap Manufacturing Index' },
  'INF179KC1GC8': { id: 21, name: 'HDFC Nifty Midcap 150 Index' },
};

const DEBT_ISIN_TO_FUND = {
  'INF109K01T04': { id: 1, name: 'ICICI Prudential Ultra Short Term' },
  'INF204K01YH3': { id: 2, name: 'Nippon India Ultra Short Duration' },
  'INF174K01LC6': { id: 3, name: 'Kotak Arbitrage' },
  'INF109K016O4': { id: 4, name: 'ICICI Prudential Equity Arbitrage' },
  'INF109K01Q49': null, // ICICI Liquid — skip (not in debt_hybrid_funds)
};

const TXN_HEADER = ['id', 'fund_id', 'txn_type', 'txn_date', 'units', 'nav', 'amount', 'notes', 'created_at'];

function importFromTradebook() {
  const ss          = SpreadsheetApp.openById(VAULTZERO_SHEET_ID);
  const tradebookSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tradebook');
  const eqSheet     = ss.getSheetByName('equity_transactions');
  const debtSheet   = ss.getSheetByName('debt_hybrid_transactions');

  if (!tradebookSh) {
    SpreadsheetApp.getUi().alert('Sheet "Tradebook" not found.\nCreate it, paste your CSV data, then run again.');
    return;
  }
  if (!eqSheet) {
    SpreadsheetApp.getUi().alert('Sheet "equity_transactions" not found.');
    return;
  }
  if (!debtSheet) {
    SpreadsheetApp.getUi().alert('Sheet "debt_hybrid_transactions" not found.');
    return;
  }

  ensureHeader(eqSheet);
  ensureHeader(debtSheet);

  // ── Build order_id → sheet row maps ───────────────────────────────────────
  const eqIdToRow   = buildIdMap(eqSheet);
  const debtIdToRow = buildIdMap(debtSheet);

  // ── Parse Tradebook sheet ─────────────────────────────────────────────────
  const rawData = tradebookSh.getDataRange().getValues();
  if (rawData.length < 2) {
    SpreadsheetApp.getUi().alert('Tradebook sheet is empty — paste your CSV data first.');
    return;
  }

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
    SpreadsheetApp.getUi().alert(
      'Could not find required columns (isin, trade_date, order_id).\n' +
      'Make sure the header row is included and starts at A1.'
    );
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
    const type    = row[C.type].toLowerCase();
    const auction = row[C.auction].toLowerCase();
    const qty     = parseFloat(row[C.qty]);
    const price   = parseFloat(row[C.price]);
    const orderId = row[C.orderId];

    if (!isin || !dateStr || !orderId) continue;

    if (auction === 'true') {
      skipped.push({ line: i + 1, symbol, isin, reason: 'Auction row' });
      continue;
    }
    if (isNaN(qty) || isNaN(price) || qty <= 0 || price <= 0) {
      skipped.push({ line: i + 1, symbol, isin, reason: `Invalid qty=${row[C.qty]} or price=${row[C.price]}` });
      continue;
    }

    const txnType = type === 'sell' ? 'Sell' : 'Buy';
    const amount  = Math.round(qty * price * 100) / 100;
    const dateMs  = new Date(dateStr).getTime();

    // ── Equity fund? ───────────────────────────────────────────────────────
    const eqFund = ISIN_TO_FUND[isin];
    if (eqFund) {
      const rowData = [orderId, eqFund.id, txnType, dateStr, qty, price, amount, '', new Date()];
      eqIdToRow[orderId]
        ? eq.toUpdate.push({ sheetRow: eqIdToRow[orderId], rowData })
        : eq.toInsert.push({ dateMs, fundId: eqFund.id, rowData });
      continue;
    }

    // ── Debt / arbitrage fund? ─────────────────────────────────────────────
    if (isin in DEBT_ISIN_TO_FUND) {
      const debtFund = DEBT_ISIN_TO_FUND[isin];
      if (!debtFund) {
        // null entry = explicitly excluded (e.g. liquid fund not in table)
        skipped.push({ line: i + 1, symbol, isin, reason: 'Not in debt_hybrid_funds — skipped' });
        continue;
      }
      const rowData = [orderId, debtFund.id, txnType, dateStr, qty, price, amount, '', new Date()];
      debtIdToRow[orderId]
        ? debt.toUpdate.push({ sheetRow: debtIdToRow[orderId], rowData })
        : debt.toInsert.push({ dateMs, fundId: debtFund.id, rowData });
      continue;
    }

    // ── Unknown ISIN ───────────────────────────────────────────────────────
    skipped.push({ line: i + 1, symbol, isin, reason: 'ISIN not mapped — fund may have been exited before VaultZero tracking' });
  }

  // ── Write equity_transactions ──────────────────────────────────────────────
  upsertRows(eqSheet, eq.toUpdate, eq.toInsert);

  // ── Write debt_hybrid_transactions ────────────────────────────────────────
  upsertRows(debtSheet, debt.toUpdate, debt.toInsert);

  // ── Summary ────────────────────────────────────────────────────────────────
  const skipLines = skipped.length > 0
    ? '\n\nSkipped:\n' +
      skipped.slice(0, 8).map(s => `• Line ${s.line}: ${s.symbol} — ${s.reason}`).join('\n') +
      (skipped.length > 8 ? `\n… and ${skipped.length - 8} more` : '')
    : '';

  SpreadsheetApp.getUi().alert(
    `✅  Done\n\n` +
    `equity_transactions\n` +
    `  Inserted : ${eq.toInsert.length}   Updated : ${eq.toUpdate.length}\n\n` +
    `debt_hybrid_transactions\n` +
    `  Inserted : ${debt.toInsert.length}   Updated : ${debt.toUpdate.length}\n\n` +
    `Skipped : ${skipped.length}` +
    skipLines
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureHeader(sheet) {
  const firstCell = String(sheet.getRange(1, 1).getValue()).trim();
  if (firstCell !== 'id') {
    sheet.getRange(1, 1, 1, TXN_HEADER.length)
      .setValues([TXN_HEADER])
      .setFontWeight('bold')
      .setBackground('#f3f4f6');
  }
}

function buildIdMap(sheet) {
  const data    = sheet.getDataRange().getValues();
  const idToRow = {};
  for (let i = 1; i < data.length; i++) {
    const oid = String(data[i][0]).trim();
    if (oid) idToRow[oid] = i + 1;
  }
  return idToRow;
}

function upsertRows(sheet, toUpdate, toInsert) {
  for (const u of toUpdate) {
    sheet.getRange(u.sheetRow, 1, 1, TXN_HEADER.length).setValues([u.rowData]);
  }

  toInsert.sort((a, b) => a.dateMs - b.dateMs || a.fundId - b.fundId);
  for (const ins of toInsert) {
    sheet.appendRow(ins.rowData);
  }

  const totalRows = sheet.getLastRow() - 1;
  if (totalRows > 0) {
    sheet.getRange(2, 4, totalRows, 1).setNumberFormat('yyyy-mm-dd');
  }
}
