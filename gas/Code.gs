// VaultZero — Google Apps Script Backend
// Deploy as Web App: Execute as Me, Anyone can access

const SS_ID = '1R4yXbxb6YgXh-rDqnnw3iWOZe2ABcYMD96iN5hvDi5A';

function getSpreadsheet() {
  return SpreadsheetApp.openById(SS_ID);
}

function doGet(e) {
  try {
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

// Run this once to create all sheet tabs with correct headers
function setupAllSheets() {
  const sheets = {
    buckets: ['id', 'name', 'description', 'created_at'],
    categories: ['id', 'bucket_id', 'name', 'description', 'created_at'],
    subcategories: ['id', 'category_id', 'name', 'created_at'],

    equity_funds: ['id', 'subcategory_id', 'fund_name', 'fund_house', 'code', 'is_active', 'created_at'],
    equity_transactions: ['id', 'fund_id', 'txn_type', 'txn_date', 'units', 'nav', 'amount', 'notes', 'created_at'],
    equity_sip_mandates: ['id', 'fund_id', 'platform', 'mandate_ref', 'created_at'],
    equity_sip_events: ['id', 'sip_mandate_id', 'event_type', 'effective_date', 'amount', 'sip_date', 'frequency', 'reason', 'created_at'],

    debt_hybrid_funds: ['id', 'subcategory_id', 'fund_name', 'fund_house', 'code', 'purpose', 'is_active', 'created_at'],
    debt_hybrid_transactions: ['id', 'fund_id', 'txn_type', 'txn_date', 'units', 'nav', 'amount', 'notes', 'created_at'],
    debt_hybrid_sip_mandates: ['id', 'fund_id', 'platform', 'mandate_ref', 'created_at'],
    debt_hybrid_sip_events: ['id', 'sip_mandate_id', 'event_type', 'effective_date', 'amount', 'sip_date', 'frequency', 'reason', 'created_at'],

    indian_equity_stocks_assets: ['id', 'subcategory_id', 'company_name', 'ticker', 'strategy', 'is_active', 'created_at'],
    indian_equity_stocks_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'quantity', 'price_per_share', 'amount', 'notes', 'created_at'],

    us_equity_stocks_assets: ['id', 'subcategory_id', 'company_name', 'ticker', 'strategy', 'is_active', 'created_at'],
    us_equity_stocks_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'quantity', 'price_per_share_usd', 'amount_usd', 'conv_rate', 'amount_inr', 'notes', 'created_at'],

    precious_metal_etf_assets: ['id', 'subcategory_id', 'name', 'code', 'is_active', 'created_at'],
    precious_metal_etf_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'units', 'price_per_unit', 'amount', 'notes', 'created_at'],

    precious_metal_physical_assets: ['id', 'subcategory_id', 'name', 'metal_type', 'form', 'is_active', 'created_at'],
    precious_metal_physical_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'quantity', 'price_per_unit', 'amount', 'notes', 'created_at'],

    crypto_assets: ['id', 'subcategory_id', 'name', 'ticker', 'is_active', 'created_at'],
    crypto_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'quantity', 'price_usd', 'amount_usd', 'conv_rate', 'amount_inr', 'notes', 'created_at'],

    real_estate_assets: ['id', 'subcategory_id', 'name', 'location', 'unit_of_measure', 'is_active', 'created_at'],
    real_estate_transactions: ['id', 'asset_id', 'txn_type', 'txn_date', 'quantity', 'price_per_unit', 'registration_cost', 'other_expenses', 'notes', 'created_at'],

    manual_prices: ['id', 'asset_type', 'asset_id', 'price_per_unit', 'price_date', 'created_at'],
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

  // Categories
  const catSheet = ss.getSheetByName('categories');
  if (catSheet.getLastRow() <= 1) {
    const now = new Date().toISOString();
    catSheet.appendRow([1, 1, 'Indian EQ Mutual Fund', '', now]);
    catSheet.appendRow([2, 1, 'Indian Equity Stocks', '', now]);
    catSheet.appendRow([3, 1, 'US Equity Stocks', '', now]);
    catSheet.appendRow([4, 1, 'Real Estate', '', now]);
    catSheet.appendRow([5, 2, 'Debt & Hybrid Mutual Fund', '', now]);
    catSheet.appendRow([6, 3, 'Precious Metals', '', now]);
    catSheet.appendRow([7, 3, 'Cryptocurrency', '', now]);
  }

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
