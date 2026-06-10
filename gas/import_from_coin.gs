/**
 * VaultZero — Import equity/debt transactions from Coin Order History CSV
 *
 * HOW TO USE:
 *   1. coin.zerodha.com → Orders → Download order history CSV
 *   2. Paste the CSV into the "Sheet1" tab of the VaultZero spreadsheet (A1, incl. header)
 *   3. Run importFromCoin()
 *   4. Clear Sheet1, paste next CSV, run again
 *
 * Only COMPLETE orders imported. Unique key: exchange_order_id.
 * Reuses ISIN_TO_FUND, DEBT_ISIN_TO_FUND, pushUpsert, ensureHeader, buildIdMap,
 * getHeaders, upsertRows from import_from_tradebook.gs (project-wide scope).
 *
 * Coin CSV columns: client_id, isin, scheme_name, plan, transaction_mode,
 * settlement_id, trade_date (DD/MM/YYYY), ordered_at, folio_number, amount,
 * units, nav, status, exchange_order_id, remarks, tag.
 */

function importFromCoin() {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSh  = ss.getSheetByName('Sheet1');
  const eqSheet   = ss.getSheetByName('equity_transactions');
  const debtSheet = ss.getSheetByName('debt_hybrid_transactions');

  if (!sourceSh)              { SpreadsheetApp.getUi().alert('Sheet "Sheet1" not found.\nPaste your Coin CSV there, then run again.'); return; }
  if (!eqSheet || !debtSheet) { SpreadsheetApp.getUi().alert('equity_transactions or debt_hybrid_transactions sheet not found.'); return; }

  ensureHeader(eqSheet);
  ensureHeader(debtSheet);

  const eqIdToRow   = buildIdMap(eqSheet);
  const debtIdToRow = buildIdMap(debtSheet);

  const rawData = sourceSh.getDataRange().getValues();
  if (rawData.length < 2) { SpreadsheetApp.getUi().alert('Sheet1 is empty — paste your Coin CSV first.'); return; }

  const h = rawData[0].map(c => String(c).trim().toLowerCase());
  const C = {
    isin:    h.indexOf('isin'),
    scheme:  h.indexOf('scheme_name'),
    mode:    h.indexOf('transaction_mode'),
    date:    h.indexOf('trade_date'),
    amount:  h.indexOf('amount'),
    units:   h.indexOf('units'),
    nav:     h.indexOf('nav'),
    status:  h.indexOf('status'),
    orderId: h.indexOf('exchange_order_id'),
    remarks: h.indexOf('remarks'),
  };
  if (C.isin === -1 || C.orderId === -1 || C.date === -1) {
    SpreadsheetApp.getUi().alert('Required columns not found (isin, exchange_order_id, trade_date).');
    return;
  }

  const eq   = { toInsert: [], toUpdate: [] };
  const debt = { toInsert: [], toUpdate: [] };
  const skipped = [];

  for (let i = 1; i < rawData.length; i++) {
    const row     = rawData[i].map(c => String(c).trim());
    const isin    = row[C.isin];
    const mode    = (row[C.mode] || '').toUpperCase();
    const dateRaw = row[C.date];
    const amount  = parseFloat(row[C.amount]);
    const units   = parseFloat(row[C.units]);
    const nav     = parseFloat(row[C.nav]);
    const status  = (row[C.status] || '').toUpperCase();
    const orderId = row[C.orderId];
    const remarks = C.remarks >= 0 ? row[C.remarks] : '';

    if (!isin || !orderId || !dateRaw) continue;
    if (status !== 'COMPLETE') {
      skipped.push({ line: i + 1, scheme: row[C.scheme], isin, reason: `Status: ${status || 'blank'}` });
      continue;
    }
    if (isNaN(units) || isNaN(nav) || units <= 0 || nav <= 0) {
      skipped.push({ line: i + 1, scheme: row[C.scheme], isin, reason: `Invalid units=${row[C.units]} or nav=${row[C.nav]}` });
      continue;
    }

    const txnType   = mode === 'SELL' ? 'Sell' : 'Buy';
    const txnAmount = isNaN(amount) || amount <= 0 ? Math.round(units * nav * 100) / 100 : amount;
    const dateISO   = parseCoinDate(dateRaw);
    const dateMs    = new Date(dateISO).getTime();
    const managed   = { id: orderId, txn_type: txnType, txn_date: dateISO, units, nav, amount: txnAmount };

    const eqFund = ISIN_TO_FUND[isin];
    if (eqFund) {
      managed.fund_id = eqFund.id;
      pushUpsert(eq, eqIdToRow, orderId, eqFund.id, managed, dateMs, remarks);
      continue;
    }
    if (isin in DEBT_ISIN_TO_FUND) {
      const debtFund = DEBT_ISIN_TO_FUND[isin];
      if (!debtFund) { skipped.push({ line: i + 1, scheme: row[C.scheme], isin, reason: 'Not in debt_hybrid_funds — skipped' }); continue; }
      managed.fund_id = debtFund.id;
      pushUpsert(debt, debtIdToRow, orderId, debtFund.id, managed, dateMs, remarks);
      continue;
    }
    skipped.push({ line: i + 1, scheme: row[C.scheme], isin, reason: 'ISIN not in map — add to ISIN_TO_FUND in import_from_tradebook.gs' });
  }

  upsertRows(eqSheet, eq.toUpdate, eq.toInsert);
  upsertRows(debtSheet, debt.toUpdate, debt.toInsert);

  const skipLines = skipped.length
    ? '\n\nSkipped:\n' + skipped.slice(0, 8).map(s => `• Line ${s.line}: ${s.scheme || s.isin} — ${s.reason}`).join('\n') +
      (skipped.length > 8 ? `\n… and ${skipped.length - 8} more` : '')
    : '';
  SpreadsheetApp.getUi().alert(
    `✅  Done\n\nequity_transactions\n  Inserted : ${eq.toInsert.length}   Updated : ${eq.toUpdate.length}\n\n` +
    `debt_hybrid_transactions\n  Inserted : ${debt.toInsert.length}   Updated : ${debt.toUpdate.length}\n\nSkipped : ${skipped.length}` + skipLines
  );
}

// Coin uses DD/MM/YYYY; VaultZero stores YYYY-MM-DD
function parseCoinDate(dateStr) {
  const parts = String(dateStr).split('/');
  if (parts.length !== 3) return dateStr;
  const [dd, mm, yyyy] = parts;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}
