/**
 * VaultZero — Import equity/debt transactions from a Coin Order History CSV into a
 * chosen VaultZero account (Self, Oppurtunity, Mother, Future Wife, …).
 *
 * HOW TO USE:
 *   1. coin.zerodha.com → Orders → Download order history CSV
 *   2. Paste the CSV into the "Sheet1" tab of the VaultZero spreadsheet (A1, incl. header)
 *   3. Run importFromCoin()  → prompts which account,
 *      or run importFromCoin_Self() / _Oppurtunity() / _Mother() / _FutureWife().
 *   4. Clear Sheet1, paste the next CSV, run again.
 *
 * Only COMPLETE orders imported. Unique key: exchange_order_id.
 *
 * Fund lists are shared with the tradebook importer: each person's ISIN → fund map
 * lives in import_from_tradebook.gs (ISIN_TO_FUND_A3 = Mother, _A4 = Future Wife).
 * Same rules apply — an id must belong to that account (safety check), and funds
 * Self also holds are matched automatically by scheme `code`.
 *
 * Row ids: account 1 uses the raw exchange_order_id (preserves existing data); every
 * other account uses `exchange_order_id-a<accountId>`.
 *
 * ⚠️ Mirroring the same trades into two accounts (Self + Oppurtunity) DOUBLE-COUNTS
 * them in "All Accounts". Separate demats (Mother, Future Wife) don't have this issue.
 *
 * Reuses resolveAccountMaps_, accountOptions_, pushUpsert, ensureHeader, buildIdMap,
 * getHeaders, upsertRows, notify_, vaultSpreadsheet_, vaultDataSpreadsheet_ from
 * import_from_tradebook.gs (project-wide scope).
 *
 * Coin CSV columns: client_id, isin, scheme_name, plan, transaction_mode,
 * settlement_id, trade_date (DD/MM/YYYY), ordered_at, folio_number, amount,
 * units, nav, status, exchange_order_id, remarks, tag.
 */

// ── Run these ─────────────────────────────────────────────────────────────────
function importFromCoin_Self()        { importFromCoinForAccount(1); }
function importFromCoin_Oppurtunity() { importFromCoinForAccount(2); }
function importFromCoin_Mother()      { importFromCoinForAccount(3); }
function importFromCoin_FutureWife()  { importFromCoinForAccount(4); }

// Asks which account (when a UI is available), else defaults to Self.
function importFromCoin() {
  var accountId = 1;
  try {
    var ui = SpreadsheetApp.getUi();
    var res = ui.prompt('Import from Coin', 'Which account?   ' + accountOptions_(), ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return;
    accountId = parseInt(res.getResponseText().trim(), 10);
  } catch (e) { /* headless — default to Self */ }
  importFromCoinForAccount(accountId);
}

// Core importer for a given VaultZero account.
function importFromCoinForAccount(accountId) {
  const dataSS = vaultDataSpreadsheet_();
  const acct   = resolveAccountMaps_(accountId, dataSS);
  if (!acct) { notify_('Unknown account ' + accountId + '. Choose one of: ' + accountOptions_() + '\n(Add new accounts to ACCOUNT_MAPS in import_from_tradebook.gs.)'); return; }

  const sourceSh  = vaultSpreadsheet_().getSheetByName('Sheet1');
  const eqSheet   = dataSS.getSheetByName('equity_transactions');
  const debtSheet = dataSS.getSheetByName('debt_hybrid_transactions');

  if (!sourceSh)              { notify_('Sheet "Sheet1" not found.\nPaste your Coin CSV there, then run again.'); return; }
  if (!eqSheet || !debtSheet) { notify_('equity_transactions or debt_hybrid_transactions sheet not found.'); return; }

  ensureHeader(eqSheet);
  ensureHeader(debtSheet);

  const eqIdToRow   = buildIdMap(eqSheet);
  const debtIdToRow = buildIdMap(debtSheet);

  const rawData = sourceSh.getDataRange().getValues();
  if (rawData.length < 2) { notify_('Sheet1 is empty — paste your Coin CSV first.'); return; }

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
    notify_('Required columns not found (isin, exchange_order_id, trade_date).');
    return;
  }

  // Account-scoped row id so the same order can live under multiple accounts.
  // Account 1 keeps the raw exchange_order_id (preserves existing Self rows).
  const idFor = oid => (String(accountId) === '1' ? oid : oid + '-a' + accountId);

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
    const rowId     = idFor(orderId);
    const managed   = { id: rowId, txn_type: txnType, txn_date: dateISO, units, nav, amount: txnAmount };

    const eqFund = acct.equity[isin];
    if (eqFund) {
      managed.fund_id = eqFund.id;
      pushUpsert(eq, eqIdToRow, rowId, eqFund.id, managed, dateMs, remarks);
      continue;
    }
    const debtFund = acct.debt[isin];
    if (debtFund) {
      managed.fund_id = debtFund.id;
      pushUpsert(debt, debtIdToRow, rowId, debtFund.id, managed, dateMs, remarks);
      continue;
    }
    skipped.push({ line: i + 1, scheme: row[C.scheme], isin, reason: acct.unmappedReason(isin) });
  }

  upsertRows(eqSheet, eq.toUpdate, eq.toInsert);
  upsertRows(debtSheet, debt.toUpdate, debt.toInsert);

  const skipLines = skipped.length
    ? '\n\nSkipped:\n' + skipped.slice(0, 8).map(s => `• Line ${s.line}: ${s.scheme || s.isin} — ${s.reason}`).join('\n') +
      (skipped.length > 8 ? `\n… and ${skipped.length - 8} more` : '')
    : '';
  notify_(
    `✅  Done — ${acct.name} (account ${accountId})\n\nequity_transactions\n  Inserted : ${eq.toInsert.length}   Updated : ${eq.toUpdate.length}\n\n` +
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
