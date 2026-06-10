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

    if (action === 'insert') {
      const newId = appendRow(sheet, row);
      return respond({ id: newId });
    }

    if (action === 'update') {
      updateRow(sheet, id, row);
      return respond({ success: true });
    }

    if (action === 'batchUpdate') {
      rows.forEach(r => updateRow(sheet, r.id, r.data));
      return respond({ success: true });
    }

    if (action === 'delete') {
      deleteRow(sheet, id);
      return respond({ success: true });
    }

    if (action === 'seed') {
      seedSheet(sheet, row);
      return respond({ success: true });
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

function appendRow(sheetName, row) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // Auto-increment id
  const lastRow = sheet.getLastRow();
  const newId = lastRow <= 1 ? 1 : sheet.getRange(lastRow, 1).getValue() + 1;
  row.id = newId;
  row.created_at = new Date().toISOString();

  const rowData = headers.map(h => row[h] !== undefined ? row[h] : '');
  sheet.appendRow(rowData);
  const newRowNum = sheet.getLastRow();
  writePriceFormula(sheet, sheetName, headers, newRowNum);
  return newId;
}

function updateRow(sheetName, id, updates) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');

  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] == id) {
      headers.forEach((h, j) => {
        if (updates[h] !== undefined) {
          sheet.getRange(i + 1, j + 1).setValue(updates[h]);
        }
      });
      return;
    }
  }
  throw new Error('Row not found: id=' + id);
}

function deleteRow(sheetName, id) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  const data = sheet.getDataRange().getValues();
  const idCol = data[0].indexOf('id');

  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] == id) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
  throw new Error('Row not found: id=' + id);
}

function seedSheet(sheetName, headers) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
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
  'us_equity_stocks_assets':     { codeCol: 'ticker', priceCol: 'current_price', formulaType: 'direct_usd' },
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
}

// Run once to add goal_id column to existing debt_hybrid_transactions sheet
function migrateAddGoalColumn() {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName('debt_hybrid_transactions');
  if (!sheet || sheet.getLastRow() === 0) { Logger.log('Sheet not found or empty'); return; }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.includes('goal_id')) { Logger.log('goal_id already exists'); return; }
  // Insert goal_id before the last column (created_at)
  const lastCol = headers.length;
  sheet.insertColumnBefore(lastCol);
  sheet.getRange(1, lastCol).setValue('goal_id');
  Logger.log('goal_id column added at col ' + lastCol);
}

// Run once: add cycle columns to debt_goals + create bill_cycles sheet (Yearly Bills cycle model)
function migrateAddCycleColumns() {
  const ss = getSpreadsheet();

  // 1. Add annual_amount, due_month, cycle_months to debt_goals (before target_amount)
  const goalsSheet = ss.getSheetByName('debt_goals');
  if (goalsSheet && goalsSheet.getLastRow() > 0) {
    const headers = goalsSheet.getRange(1, 1, 1, goalsSheet.getLastColumn()).getValues()[0];
    const newCols = ['annual_amount', 'due_month', 'cycle_months'];
    const missing = newCols.filter(c => !headers.includes(c));
    if (missing.length) {
      // Append to the end (simplest, order-independent — frontend maps by header name)
      let col = goalsSheet.getLastColumn() + 1;
      missing.forEach(c => { goalsSheet.getRange(1, col).setValue(c); col++; });
      Logger.log('debt_goals: added ' + missing.join(', '));
    } else {
      Logger.log('debt_goals: cycle columns already present');
    }
  } else {
    Logger.log('debt_goals sheet not found (run setupAllSheets first)');
  }

  // 2. Create bill_cycles sheet if missing
  let cycles = ss.getSheetByName('bill_cycles');
  if (!cycles) {
    cycles = ss.insertSheet('bill_cycles');
    cycles.appendRow(['id', 'goal_id', 'cycle_label', 'start_date', 'due_date', 'planned_amount',
                      'expected_monthly', 'first_cycle', 'paid_amount', 'paid_date', 'status', 'notes', 'created_at']);
    Logger.log('bill_cycles sheet created');
  } else {
    Logger.log('bill_cycles already exists');
  }
  Logger.log('Cycle migration complete.');
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

    equity_funds: ['id', 'subcategory_id', 'fund_name', 'fund_house', 'code', 'is_active', 'current_nav', 'created_at'],
    equity_transactions: ['id', 'fund_id', 'txn_type', 'txn_date', 'units', 'nav', 'amount', 'notes', 'created_at'],
    equity_sip_mandates: ['id', 'fund_id', 'platform', 'mandate_ref', 'created_at'],
    equity_sip_events: ['id', 'sip_mandate_id', 'event_type', 'effective_date', 'amount', 'sip_date', 'frequency', 'reason', 'created_at'],

    debt_hybrid_funds: ['id', 'subcategory_id', 'fund_name', 'fund_house', 'code', 'purpose', 'is_active', 'current_nav', 'created_at'],
    debt_hybrid_transactions: ['id', 'fund_id', 'txn_type', 'txn_date', 'units', 'nav', 'amount', 'goal_id', 'notes', 'created_at'],
    debt_goals: ['id', 'subcategory_id', 'name', 'default_amount', 'annual_amount', 'due_month', 'cycle_months', 'target_amount', 'is_active', 'notes', 'created_at'],
    bill_cycles: ['id', 'goal_id', 'cycle_label', 'start_date', 'due_date', 'planned_amount', 'expected_monthly', 'first_cycle', 'paid_amount', 'paid_date', 'status', 'notes', 'created_at'],
    debt_hybrid_sip_mandates: ['id', 'fund_id', 'platform', 'mandate_ref', 'created_at'],
    debt_hybrid_sip_events: ['id', 'sip_mandate_id', 'event_type', 'effective_date', 'amount', 'sip_date', 'frequency', 'reason', 'created_at'],

    indian_equity_stocks_assets: ['id', 'subcategory_id', 'company_name', 'ticker', 'strategy', 'is_active', 'current_price', 'created_at'],
    indian_equity_stocks_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'quantity', 'price_per_share', 'amount', 'notes', 'created_at'],

    us_equity_stocks_assets: ['id', 'subcategory_id', 'company_name', 'ticker', 'strategy', 'is_active', 'current_price', 'created_at'],
    us_equity_stocks_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'quantity', 'price_per_share_usd', 'amount_usd', 'conv_rate', 'amount_inr', 'notes', 'created_at'],

    precious_metal_etf_assets: ['id', 'subcategory_id', 'name', 'code', 'is_active', 'current_price', 'created_at'],
    precious_metal_etf_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'units', 'price_per_unit', 'amount', 'notes', 'created_at'],

    precious_metal_physical_assets: ['id', 'subcategory_id', 'name', 'metal_type', 'form', 'is_active', 'created_at'],
    precious_metal_physical_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'quantity', 'price_per_unit', 'amount', 'notes', 'created_at'],

    crypto_assets: ['id', 'subcategory_id', 'name', 'ticker', 'is_active', 'current_price', 'created_at'],
    crypto_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'quantity', 'price_usd', 'amount_usd', 'conv_rate', 'amount_inr', 'notes', 'created_at'],

    real_estate_assets: ['id', 'subcategory_id', 'name', 'location', 'unit_of_measure', 'is_active', 'created_at'],
    real_estate_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'quantity', 'price_per_unit', 'registration_cost', 'other_expenses', 'notes', 'created_at'],

    manual_prices: ['id', 'asset_type', 'asset_id', 'price_per_unit', 'price_date', 'created_at'],

    epf_assets:  ['id', 'account_name', 'uan', 'current_balance', 'is_active', 'created_at'],
    bank_assets: ['id', 'account_name', 'bank_name', 'account_type', 'current_balance', 'is_active', 'created_at'],
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
  const missingCats = [
    [1, 1, 'Indian EQ Mutual Fund',       '', now],
    [2, 1, 'Indian Equity Stocks',         '', now],
    [3, 1, 'US Equity Stocks',             '', now],
    [4, 1, 'Real Estate',                  '', now],
    [5, 2, 'Debt & Hybrid Mutual Fund',    '', now],
    [6, 3, 'Precious Metals',              '', now],
    [7, 3, 'Cryptocurrency',               '', now],
    [8, 1, 'Indian EQ MF SIP',             '', now],
    [9, 2, 'Debt & Hybrid MF SIP',         '', now],
    [10, 2, 'EPF',                          '', now],
    [11, 2, 'Bank Accounts',               '', now],
  ].filter(row => !allCatRows.includes(row[0]));
  missingCats.forEach(row => catSheet.appendRow(row));

  // Subcategories
  const subSheet = ss.getSheetByName('subcategories');
  if (subSheet.getLastRow() <= 1) {
    const now = new Date().toISOString();
    let id = 1;
    // Indian EQ MF (cat 1)
    ['Large Cap','Mid Cap','Small Cap','Flexi Cap','ELSS','Index','Sectoral'].forEach(n => subSheet.appendRow([id++, 1, n, now]));
    // Debt & Hybrid MF (cat 5)
    ['Liquid','Overnight','Ultra Short Term','Money Market','Short Duration','Medium Duration','Dynamic Bond','Arbitrage','Credit Risk','Balanced Advantage','Conservative Hybrid','Equity Savings'].forEach(n => subSheet.appendRow([id++, 5, n, now]));
    // Precious Metals (cat 6)
    subSheet.appendRow([id++, 6, 'Digital', now]);
    subSheet.appendRow([id++, 6, 'Physical', now]);
    // No subcategories for Indian Stocks (cat 2), US Stocks (cat 3), Real Estate (cat 4), Crypto (cat 7)
  }
}
