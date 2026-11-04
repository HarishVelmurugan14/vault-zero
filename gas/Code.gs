// VaultZero — Google Apps Script Backend
// Deploy as Web App: Execute as Me, Anyone can access

const SS_ID = '1R4yXbxb6YgXh-rDqnnw3iWOZe2ABcYMD96iN5hvDi5A';

function getSpreadsheet() {
  return SpreadsheetApp.openById(SS_ID);
}

// ── Token gate ────────────────────────────────────────────────────────────────
// Run TEST_setApiToken('your-secret-key') once from the GAS editor to enable.
// Pass '' to remove the gate.

function checkToken(token) {
  const stored = PropertiesService.getScriptProperties().getProperty('api_token');
  if (!stored) return true;            // gate not set — allow all
  return String(token || '').trim() === stored;
}

function TEST_setApiToken(token) {
  const props = PropertiesService.getScriptProperties();
  if (token) {
    props.setProperty('api_token', String(token).trim());
    Logger.log('api_token set');
    return { set: true };
  }
  props.deleteProperty('api_token');
  Logger.log('api_token cleared');
  return { set: false };
}

function doGet(e) {
  try {
    if (!checkToken(e.parameter.token)) return respond({ error: 'unauthorized' });

    // Batch read: ?action=batchGet&sheets=table1,table2,...&limit=5000
    if (e.parameter.action === 'batchGet') {
      const sheets = e.parameter.sheets.split(',');
      const limit  = parseInt(e.parameter.limit) || 5000;
      const result = {};
      sheets.forEach(s => { result[s] = readSheet(s, limit, 0, {}); });
      return respond(result);
    }

    const sheet = e.parameter.sheet;
    const limit = parseInt(e.parameter.limit) || 10;
    const offset = parseInt(e.parameter.offset) || 0;
    const filters = e.parameter.filters ? JSON.parse(e.parameter.filters) : {};

    if (!sheet) return respond({ error: 'sheet parameter required' }, 400);

    const data = readSheet(sheet, limit, offset, filters);
    return respond(data);
  } catch (err) {
    return respond({ error: err.message }, 500);
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const { action, sheet, row, id, rows } = payload;

    if (!checkToken(payload.token)) return respond({ error: 'unauthorized' });

    if (!sheet) return respond({ error: 'sheet required' }, 400);
    // Only VaultZero tables (gas/schema.gs) are writable — StockIQ / staging tabs are not.
    if (!VZ_SCHEMA[sheet]) return respond({ error: 'writes are not allowed to "' + sheet + '"' }, 400);

    if (action === 'insert') {
      const newId = appendRow(sheet, row);
      return respond({ id: newId });
    }

    if (action === 'update') {
      updateRows(sheet, [{ id, data: row }]);
      return respond({ success: true });
    }

    if (action === 'batchUpdate') {
      updateRows(sheet, rows);          // all rows validated before any is written
      return respond({ success: true });
    }

    if (action === 'delete') {
      deleteRow(sheet, id);
      return respond({ success: true });
    }

    // Used by the Coin / Tradebook importers (separate Apps Script project) so every
    // write to VaultZero goes through this one constrained, locked path.
    if (action === 'upsertBySourceRef') {
      return respond(upsertBySourceRef(sheet, rows));
    }

    return respond({ error: 'unknown action' }, 400);
  } catch (err) {
    return respond({ error: err.message }, 500);
  }
}

function readSheet(sheetName, limit, offset, filters) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { rows: [], total: 0 };

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { rows: [], total: 0 };

  const headers = data[0];
  let rows = data.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = r[i]);
    return obj;
  });

  // Apply filters
  Object.keys(filters).forEach(key => {
    rows = rows.filter(r => String(r[key]) === String(filters[key]));
  });

  const total = rows.length;

  // For transactions: sort by txn_date desc, then paginate
  if (sheetName.includes('transaction')) {
    rows = rows.sort((a, b) => new Date(b.txn_date) - new Date(a.txn_date));
  }

  rows = rows.slice(offset, offset + limit);
  return { rows, total };
}

// Every write takes the script lock (one writer at a time) and is checked against the
// constraints in schema.gs before anything touches the sheet.
function withWriteLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function appendRow(sheetName, row) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  return withWriteLock_(() => {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    // PRIMARY KEY: next value of the table's sequence (never reuses a deleted id), assigned
    // here — never by the client.
    const idCol = headers.indexOf('id');
    const lastRow = sheet.getLastRow();
    let maxId = 0;
    if (idCol >= 0 && lastRow > 1) {
      sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues().forEach(r => {
        const v = Number(r[0]);
        if (isFinite(v) && v > maxId) maxId = v;
      });
    }
    const newId = vzNextId_(sheetName, maxId);
    row.id = newId;
    row.created_at = new Date().toISOString();

    const rowData = headers.map(h => row[h] !== undefined ? row[h] : '');
    const stored = {};
    headers.forEach((h, i) => { stored[h] = rowData[i]; });
    vzAssertRow_(vzCtx_(ss), sheetName, stored, null);

    sheet.appendRow(vzCoerceDates_(sheetName, headers.map(h => String(h).trim()), [rowData], ss.getSpreadsheetTimeZone())[0]);
    const newRowNum = sheet.getLastRow();
    writePriceFormula(sheet, sheetName, headers, newRowNum);
    SpreadsheetApp.flush();   // commit before the next waiting insert reads MAX(id)
    return newId;
  });
}

// updates: [{ id, data }]. Validates every merged row first; writes only if all pass.
function updateRows(sheetName, updates) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  withWriteLock_(() => {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const ctx = vzCtx_(ss);
    const writes = [];

    (updates || []).forEach(u => {
      const rowIdx = data.findIndex((r, i) => i > 0 && vzKey_(r[idCol]) === vzKey_(u.id));
      if (rowIdx < 0) throw new Error('Row not found: id=' + u.id);
      const fields = u.data || {};
      if (fields.id !== undefined && vzKey_(fields.id) !== vzKey_(u.id)) throw new Error('id is immutable (id=' + u.id + ')');
      const merged = {};
      headers.forEach((h, j) => { merged[h] = fields[h] !== undefined ? fields[h] : data[rowIdx][j]; });
      vzAssertRow_(ctx, sheetName, merged, u.id);
      ctx.replace(sheetName, u.id, merged);
      headers.forEach((h, j) => {
        if (h === 'id' || fields[h] === undefined) return;
        const v = vzCoerceDates_(sheetName, [String(h).trim()], [[fields[h]]], ss.getSpreadsheetTimeZone())[0][0];
        writes.push([rowIdx + 1, j + 1, v]);
      });
    });

    writes.forEach(([r, c, v]) => sheet.getRange(r, c).setValue(v));
    SpreadsheetApp.flush();
  });
}

// Importer upsert keyed on source_ref (the broker order id).
// items: [{ fields: {...}, onInsert: {...} }] — `fields` are the managed columns written on
// both insert and update; `onInsert` (e.g. notes) only on insert. Existing rows keep their
// id / created_at; new rows get the next sequence id. Every row is validated before
// anything is written. Returns { inserted, updated }.
function upsertBySourceRef(sheetName, items) {
  const spec = VZ_SCHEMA[sheetName];
  if (!spec || !(spec.unique || []).some(u => (Array.isArray(u) ? u : u.cols).join() === 'source_ref')) {
    throw new Error('upsertBySourceRef only works on tables with a UNIQUE source_ref');
  }
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  return withWriteLock_(() => {
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).trim());
    const refCol = headers.indexOf('source_ref'), idCol = headers.indexOf('id');
    if (refCol < 0) throw new Error(sheetName + ' has no source_ref column — run cleanupVaultZeroApply() first.');
    const tz = ss.getSpreadsheetTimeZone();
    const ctx = vzCtx_(ss);

    const byRef = {};
    let maxId = 0;
    for (let i = 1; i < data.length; i++) {
      const k = vzKey_(data[i][refCol]);
      if (k) byRef[k] = i;
      const v = Number(data[i][idCol]);
      if (isFinite(v) && v > maxId) maxId = v;
    }

    const seen = {};
    const inserts = [];
    let updated = 0;
    (items || []).forEach(it => {
      const f = it.fields || {};
      const ref = vzKey_(f.source_ref);
      if (!ref) throw new Error('Constraint violation in ' + sheetName + ': source_ref is required');
      if (seen[ref]) throw new Error('Constraint violation in ' + sheetName + ': UNIQUE (source_ref) = (' + ref + ') appears twice in this import');
      seen[ref] = true;
      const rowIdx = byRef[ref];
      if (rowIdx !== undefined) {
        const merged = headers.map((h, j) => (h === 'id' || h === 'created_at' || f[h] === undefined) ? data[rowIdx][j] : f[h]);
        const obj = vzRowObj_(headers, merged);
        vzAssertRow_(ctx, sheetName, obj, obj.id);
        ctx.replace(sheetName, obj.id, obj);
        data[rowIdx] = merged;
        updated++;
      } else {
        maxId = vzNextId_(sheetName, maxId);
        const all = Object.assign({}, it.onInsert || {}, f, { id: maxId, created_at: new Date().toISOString() });
        const arr = headers.map(h => (all[h] !== undefined ? all[h] : ''));
        const obj = vzRowObj_(headers, arr);
        vzAssertRow_(ctx, sheetName, obj, null);
        ctx.add(sheetName, obj);
        inserts.push(arr);
      }
    });

    // One block write for updates (transaction tabs hold no formulas), one for inserts.
    if (updated) sheet.getRange(2, 1, data.length - 1, headers.length).setValues(vzCoerceDates_(sheetName, headers, data.slice(1), tz));
    if (inserts.length) sheet.getRange(sheet.getLastRow() + 1, 1, inserts.length, headers.length).setValues(vzCoerceDates_(sheetName, headers, inserts, tz));
    const dateCol = headers.indexOf('txn_date');
    if (dateCol >= 0 && sheet.getLastRow() > 1) sheet.getRange(2, dateCol + 1, sheet.getLastRow() - 1, 1).setNumberFormat('yyyy-mm-dd');
    SpreadsheetApp.flush();
    return { inserted: inserts.length, updated };
  });
}

// Back-compat single-row form.
function updateRow(sheetName, id, updates) { updateRows(sheetName, [{ id, data: updates }]); }

// ON DELETE RESTRICT: refuses while any row still references this one; hidden_items
// preferences that point at it are CASCADE-deleted.
function deleteRow(sheetName, id) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  withWriteLock_(() => {
    const data = sheet.getDataRange().getValues();
    const idCol = data[0].indexOf('id');
    const rowIdx = data.findIndex((r, i) => i > 0 && vzKey_(r[idCol]) === vzKey_(id));
    if (rowIdx < 0) throw new Error('Row not found: id=' + id);

    const ctx = vzCtx_(ss);
    const check = vzDeleteCheck_(ctx, sheetName, id);
    if (check.blockers.length) {
      throw new Error('Cannot delete ' + sheetName + ' id ' + id + ' — still referenced by ' + check.blockers.join(', '));
    }
    sheet.deleteRow(rowIdx + 1);

    if (sheetName !== 'hidden_items' && check.cascadeHiddenIds.length) {
      const hid = ss.getSheetByName('hidden_items');
      const hData = hid.getDataRange().getValues();
      const hIdCol = hData[0].indexOf('id');
      const doomed = new Set(check.cascadeHiddenIds.map(vzKey_));
      for (let i = hData.length - 1; i >= 1; i--) {
        if (doomed.has(vzKey_(hData[i][hIdCol]))) hid.deleteRow(i + 1);
      }
    }
    SpreadsheetApp.flush();
  });
}

function respond(data, code) {
  const output = ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ── Market price — write GOOGLEFINANCE formula into asset table on insert ─────

const PRICE_COLUMN_CONFIG = {
  'equity_funds':                { codeCol: 'code',   priceCol: 'current_nav',   formulaType: 'mutf_in'    },
  'debt_hybrid_funds':           { codeCol: 'code',   priceCol: 'current_nav',   formulaType: 'mutf_in'    },
  'indian_equity_stocks_assets': { codeCol: 'ticker', priceCol: 'current_price', formulaType: 'direct'     },
  'us_equity_assets':            { codeCol: 'ticker', priceCol: 'current_price', formulaType: 'direct_usd', usdPriceCol: 'current_price_usd' },
  'precious_metal_etf_assets':   { codeCol: 'code',   priceCol: 'current_price', formulaType: 'nse'        },
  'crypto_assets':               { codeCol: 'ticker', priceCol: 'current_price', formulaType: 'crypto_usd' },
};

function writePriceFormula(sheet, sheetName, headers, rowNum) {
  const config = PRICE_COLUMN_CONFIG[sheetName];
  if (!config) return;
  const codeIdx  = headers.indexOf(config.codeCol);
  const priceIdx = headers.indexOf(config.priceCol);
  if (codeIdx < 0 || priceIdx < 0) return;
  const colLetter = String.fromCharCode(65 + codeIdx);
  let formula;
  switch (config.formulaType) {
    case 'mutf_in':
      formula = `=IFERROR(GOOGLEFINANCE("MUTF_IN:"&${colLetter}${rowNum},"closeyest"),0)`;
      break;
    case 'direct':
      formula = `=IFERROR(GOOGLEFINANCE(${colLetter}${rowNum},"closeyest"),0)`;
      break;
    case 'direct_usd':
      formula = `=IFERROR(GOOGLEFINANCE(${colLetter}${rowNum},"closeyest")*IFERROR(GOOGLEFINANCE("CURRENCY:USDINR"),83),0)`;
      break;
    case 'nse':
      formula = `=IFERROR(GOOGLEFINANCE("NSE:"&${colLetter}${rowNum},"closeyest"),0)`;
      break;
    case 'crypto_usd':
      formula = `=IFERROR(GOOGLEFINANCE("CURRENCY:"&${colLetter}${rowNum})*IFERROR(GOOGLEFINANCE("CURRENCY:USDINR"),83),0)`;
      break;
  }
  if (formula) sheet.getRange(rowNum, priceIdx + 1).setFormula(formula);

  // Optional second column holding the raw USD price (no FX conversion)
  if (config.usdPriceCol) {
    const usdIdx = headers.indexOf(config.usdPriceCol);
    if (usdIdx >= 0) {
      sheet.getRange(rowNum, usdIdx + 1)
        .setFormula(`=IFERROR(GOOGLEFINANCE(${colLetter}${rowNum},"closeyest"),0)`);
    }
  }
}

// Run once to remove the reverted Yearly-Bills goal/cycle artifacts:
// deletes the debt_goals + bill_cycles tabs and the goal_id column on
// debt_hybrid_transactions. Safe to run multiple times.
function cleanupGoalArtifacts() {
  const ss = getSpreadsheet();

  ['debt_goals', 'bill_cycles'].forEach(name => {
    const sh = ss.getSheetByName(name);
    if (sh) { ss.deleteSheet(sh); Logger.log('Deleted sheet: ' + name); }
    else    { Logger.log('Sheet not present: ' + name); }
  });

  const txn = ss.getSheetByName('debt_hybrid_transactions');
  if (txn && txn.getLastColumn() > 0) {
    const headers = txn.getRange(1, 1, 1, txn.getLastColumn()).getValues()[0];
    const idx = headers.indexOf('goal_id');
    if (idx >= 0) { txn.deleteColumn(idx + 1); Logger.log('Removed goal_id column (col ' + (idx + 1) + ')'); }
    else          { Logger.log('goal_id column not present'); }
  }
  Logger.log('Cleanup complete.');
}

// Run once to add multi-account support: creates the accounts sheet (seeds a
// default 'Self' account, id 1), adds account_id to every asset table (existing
// rows → account 1), and adds account_id to hidden_items (existing → global ''). Safe to re-run.
function migrateAddAccounts() {
  const ss = getSpreadsheet();

  let acc = ss.getSheetByName('accounts');
  if (!acc) { acc = ss.insertSheet('accounts'); acc.appendRow(['id', 'name', 'is_active', 'created_at']); }
  if (acc.getLastRow() <= 1) acc.appendRow([1, 'Self', true, new Date().toISOString()]);

  const tables = [
    'equity_funds', 'debt_hybrid_funds', 'indian_equity_stocks_assets',
    'precious_metal_etf_assets', 'precious_metal_physical_assets', 'crypto_assets', 'real_estate_assets',
    'epf_assets', 'bank_assets', 'us_equity_assets', 'us_wires', 'us_repatriations', 'us_income',
  ];
  tables.forEach(name => addAccountIdColumn_(ss, name, 1));

  // Ensure hidden_items exists (inserts need a pre-existing sheet) with account_id
  let hid = ss.getSheetByName('hidden_items');
  if (!hid) {
    hid = ss.insertSheet('hidden_items');
    hid.appendRow(['id', 'account_id', 'kind', 'ref', 'name', 'created_at']);
    Logger.log('hidden_items: created with account_id');
  } else {
    addAccountIdColumn_(ss, 'hidden_items', '');   // existing hides → global scope
  }

  Logger.log('Accounts migration complete.');
}

// Surgical: create/repair ONLY the hidden_items sheet (nothing else). Use this
// instead of setupAllSheets() so no unwanted tabs get created.
function ensureHiddenItemsSheet() {
  const ss = getSpreadsheet();
  const HEADERS = ['id', 'account_id', 'kind', 'ref', 'name', 'created_at'];
  let sh = ss.getSheetByName('hidden_items');
  if (!sh) {
    sh = ss.insertSheet('hidden_items');
    sh.appendRow(HEADERS);
    Logger.log('hidden_items: created');
    return;
  }
  if (sh.getLastRow() === 0) {            // exists but blank (no header row)
    sh.appendRow(HEADERS);
    Logger.log('hidden_items: header row added');
    return;
  }
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (headers.indexOf('account_id') < 0) {
    addAccountIdColumn_(ss, 'hidden_items', '');   // existing hides → global scope
  } else {
    Logger.log('hidden_items: already OK — nothing to do');
  }
}

// Insert an account_id column at position 2 (after id) and backfill existing rows.
function addAccountIdColumn_(ss, name, defaultVal) {
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() === 0) { Logger.log('skip (missing/empty): ' + name); return; }
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (headers.indexOf('account_id') >= 0) { Logger.log(name + ': account_id already present'); return; }
  sh.insertColumnAfter(1);
  sh.getRange(1, 2).setValue('account_id');
  const rows = sh.getLastRow() - 1;
  if (rows > 0 && defaultVal !== '') {
    sh.getRange(2, 2, rows, 1).setValues(Array.from({ length: rows }, () => [defaultVal]));
  }
  Logger.log(name + ': added account_id');
}

// Run once in GAS editor to add price column + formulas to existing asset rows
function migrateAddPriceColumns() {
  const ss = getSpreadsheet();
  Object.entries(PRICE_COLUMN_CONFIG).forEach(([tableName, config]) => {
    const sheet = ss.getSheetByName(tableName);
    if (!sheet || sheet.getLastRow() === 0) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.includes(config.priceCol)) {
      Logger.log(tableName + ': ' + config.priceCol + ' already exists — writing formulas for empty rows');
      const priceIdx = headers.indexOf(config.priceCol);
      for (let r = 2; r <= sheet.getLastRow(); r++) {
        const existing = sheet.getRange(r, priceIdx + 1).getValue();
        if (!existing) writePriceFormula(sheet, tableName, headers, r);
      }
      return;
    }
    // Insert column before created_at (last column)
    const lastCol = headers.length;
    sheet.insertColumnBefore(lastCol);
    sheet.getRange(1, lastCol).setValue(config.priceCol);
    Logger.log(tableName + ': added ' + config.priceCol + ' at col ' + lastCol);
    const updatedHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (let r = 2; r <= sheet.getLastRow(); r++) {
      writePriceFormula(sheet, tableName, updatedHeaders, r);
    }
  });
  Logger.log('Migration complete.');
}

// Run this once to create all sheet tabs with correct headers
function setupAllSheets() {
  const sheets = {
    buckets: ['id', 'name', 'description', 'created_at'],
    categories: ['id', 'bucket_id', 'name', 'description', 'created_at'],
    subcategories: ['id', 'category_id', 'name', 'created_at'],

    equity_funds: ['id', 'account_id', 'subcategory_id', 'fund_name', 'fund_house', 'code', 'is_active', 'current_nav', 'created_at'],
    equity_transactions: ['id', 'source_ref', 'fund_id', 'txn_type', 'txn_date', 'units', 'nav', 'amount', 'notes', 'created_at'],

    debt_hybrid_funds: ['id', 'account_id', 'subcategory_id', 'fund_name', 'fund_house', 'code', 'is_active', 'current_nav', 'created_at'],
    debt_hybrid_transactions: ['id', 'source_ref', 'fund_id', 'txn_type', 'txn_date', 'units', 'nav', 'amount', 'notes', 'created_at'],

    indian_equity_stocks_assets: ['id', 'account_id', 'subcategory_id', 'company_name', 'ticker', 'strategy', 'is_active', 'current_price', 'created_at'],
    indian_equity_stocks_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'quantity', 'price_per_share', 'amount', 'notes', 'created_at'],

    // ── US Equity (IBKR) — wire-aware stream (additive) ──────────────────────
    us_wires: ['id', 'account_id', 'wire_date', 'payment_reference', 'inr_principal', 'commission', 'gst', 'correspondent_charge', 'inr_debited', 'usd_sent', 'usd_received', 'effective_rate', 'actual_rate', 'status', 'notes', 'created_at'],
    us_repatriations: ['id', 'account_id', 'repat_date', 'usd_withdrawn', 'ibkr_withdrawal_fee', 'correspondent_charge', 'inr_received', 'effective_rate_back', 'actual_rate_back', 'status', 'notes', 'created_at'],
    us_equity_assets: ['id', 'account_id', 'subcategory_id', 'ticker', 'name', 'asset_type', 'is_active', 'current_price_usd', 'current_price', 'created_at'],
    us_equity_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'units', 'price_per_share_usd', 'usd_amount', 'wire_id', 'inr_cost_basis', 'realized_pnl_usd', 'notes', 'created_at'],
    us_income: ['id', 'account_id', 'income_type', 'income_date', 'usd_amount', 'notes', 'created_at'],

    precious_metal_etf_assets: ['id', 'account_id', 'subcategory_id', 'name', 'code', 'is_active', 'current_price', 'created_at'],
    precious_metal_etf_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'units', 'price_per_unit', 'amount', 'notes', 'created_at'],

    precious_metal_physical_assets: ['id', 'account_id', 'subcategory_id', 'name', 'metal_type', 'form', 'is_active', 'created_at'],
    precious_metal_physical_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'quantity', 'price_per_unit', 'amount', 'notes', 'created_at'],

    crypto_assets: ['id', 'account_id', 'subcategory_id', 'name', 'ticker', 'is_active', 'current_price', 'created_at'],
    crypto_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'quantity', 'price_usd', 'amount_usd', 'conv_rate', 'amount_inr', 'notes', 'created_at'],

    real_estate_assets: ['id', 'account_id', 'subcategory_id', 'name', 'location', 'unit_of_measure', 'is_active', 'created_at'],
    real_estate_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'quantity', 'price_per_unit', 'registration_cost', 'other_expenses', 'notes', 'created_at'],

    manual_prices: ['id', 'asset_type', 'asset_id', 'price_per_unit', 'price_date', 'created_at'],

    epf_assets:  ['id', 'account_id', 'account_name', 'uan', 'current_balance', 'is_active', 'created_at'],
    bank_assets: ['id', 'account_id', 'account_name', 'bank_name', 'account_type', 'current_balance', 'is_active', 'created_at'],

    hidden_items: ['id', 'account_id', 'kind', 'ref', 'name', 'created_at'],
    accounts: ['id', 'name', 'is_active', 'created_at'],
  };

  Object.entries(sheets).forEach(([name, headers]) => {
    const ss = getSpreadsheet();
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  });

  seedReferenceData();
  Logger.log('All sheets created successfully.');
}

function seedReferenceData() {
  const ss = getSpreadsheet();

  // Default account
  const accSheet = ss.getSheetByName('accounts');
  if (accSheet && accSheet.getLastRow() <= 1) {
    accSheet.appendRow([1, 'Self', true, new Date().toISOString()]);
  }

  // Buckets
  const bucketsSheet = ss.getSheetByName('buckets');
  if (bucketsSheet.getLastRow() <= 1) {
    const now = new Date().toISOString();
    bucketsSheet.appendRow([1, 'Wealth Builder', 'Long-term growth investments', now]);
    bucketsSheet.appendRow([2, 'Safety Net', 'Stable, liquid investments', now]);
    bucketsSheet.appendRow([3, 'Hedge & Opportunities', 'Alternative assets and hedges', now]);
  }

  // Categories — additive: append any missing ids
  const catSheet = ss.getSheetByName('categories');
  const now = new Date().toISOString();
  const allCatRows = catSheet.getLastRow() > 1
    ? catSheet.getRange(2, 1, catSheet.getLastRow() - 1, 1).getValues().map(r => r[0])
    : [];
  // Range scheme: 1–9 in bucket order (Wealth Builder 1–4, Safety Net 5–7, Hedge 8–9).
  const missingCats = [
    [1, 1, 'Indian EQ Mutual Fund',       '', now],
    [2, 1, 'Indian Equity Stocks',         '', now],
    [3, 1, 'US Equity',                    '', now],
    [4, 1, 'Real Estate',                  '', now],
    [5, 2, 'Debt & Hybrid Mutual Fund',    '', now],
    [6, 2, 'EPF',                          '', now],
    [7, 2, 'Bank Accounts',                '', now],
    [8, 3, 'Precious Metals',              '', now],
    [9, 3, 'Cryptocurrency',               '', now],
  ].filter(row => !allCatRows.includes(row[0]));
  missingCats.forEach(row => catSheet.appendRow(row));

  // Subcategories — additive by id. id = category × 100 + n.
  const subSheet = ss.getSheetByName('subcategories');
  const subRows = subSheet.getLastRow() > 1
    ? subSheet.getRange(2, 1, subSheet.getLastRow() - 1, 1).getValues().map(r => Number(r[0]))
    : [];
  [
    [101, 1, 'Large Cap'], [102, 1, 'Mid Cap'], [103, 1, 'Small Cap'],
    [104, 1, 'Flexi Cap'], [105, 1, 'ELSS'],    [106, 1, 'Index'],
    [201, 2, 'Large Cap'], [202, 2, 'Mid & Small Cap'],
    [301, 3, 'ETF'],       [302, 3, 'Stocks'],
    [401, 4, 'Land & Plots'],
    [501, 5, 'Liquid'],    [502, 5, 'Ultra Short Duration'], [503, 5, 'Arbitrage'],
    [801, 8, 'Digital'],   [802, 8, 'Physical'],              // names drive resolveStream()
    [901, 9, 'Majors (BTC & ETH)'],
  ].filter(r => !subRows.includes(r[0]))
   .forEach(r => subSheet.appendRow([r[0], r[1], r[2], now]));
}
