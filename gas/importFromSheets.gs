// VaultZero — Import from existing Google Sheets
// Run importFromExistingSheets() once from Apps Script

const VAULT_ID = '1R4yXbxb6YgXh-rDqnnw3iWOZe2ABcYMD96iN5hvDi5A';

const SOURCE = {
  mf:       { id: '15hPRAV_z7adtXpGXZozk3bmOOjevDZRN6v38fxX1EO8', tab: 'IN MF'     },
  debtMf:   { id: '15hPRAV_z7adtXpGXZozk3bmOOjevDZRN6v38fxX1EO8', tab: 'IN LMF'    },
  inStocks: { id: '1pBSGDnNE6juZaFaURq3dJ6NYUPaprovo7eR-3SnxmR4', tab: 'Indian EQ' },
  usStocks: { id: '1pBSGDnNE6juZaFaURq3dJ6NYUPaprovo7eR-3SnxmR4', tab: 'US EQ'     },
  crypto:   { id: '1pBSGDnNE6juZaFaURq3dJ6NYUPaprovo7eR-3SnxmR4', tab: 'CrC'       },
  pmDigital:{ id: '1ayyWNVQxkBdeSqJ-QYFS2B6P6kafViRuLclNJqza9Ew', tab: 'Digital'   },
  pmPhysical:{ id: '1ayyWNVQxkBdeSqJ-QYFS2B6P6kafViRuLclNJqza9Ew', tab: 'Physical' },
  realEstate:{ id: '1Op7AeRKeybvmOBPeMPMzsgmZXh8rAG1Eo2_w6p5PsK4', tab: 'Assets'  },
};

// Subcategory name → ID (seeded by setupAllSheets)
const SUBCAT_MAP = {
  'large cap': 1, 'mid cap': 2, 'small cap': 3, 'flexi cap': 4,
  'elss': 5, 'index': 6, 'sectoral': 7,
  'liquid': 8, 'overnight': 9,
  'ultra short term': 10, 'ultra short term mf': 10,
  'money market': 11, 'short duration': 12, 'medium duration': 13,
  'dynamic bond': 14, 'arbitrage': 15, 'credit risk': 16,
  'balanced advantage': 17, 'conservative hybrid': 18, 'equity savings': 19,
};

function importFromExistingSheets() {
  const vault = SpreadsheetApp.openById(VAULT_ID);
  const now   = new Date().toISOString();

  // ── Helpers ────────────────────────────────────────────────────────────────

  function readSource(src) {
    const ss    = SpreadsheetApp.openById(src.id);
    const sheet = ss.getSheetByName(src.tab);
    if (!sheet) throw new Error('Tab not found: ' + src.tab + ' in ' + src.id);
    const data  = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).trim());
    return data.slice(1)
      .filter(r => r.some(c => c !== ''))
      .map(r => {
        const obj = {};
        headers.forEach((h, i) => obj[h] = r[i]);
        return obj;
      });
  }

  function getVaultSheet(name) {
    const s = vault.getSheetByName(name);
    if (!s) throw new Error('VaultZero sheet not found: ' + name);
    return s;
  }

  function nextId(sheet) {
    const last = sheet.getLastRow();
    if (last <= 1) return 1;
    return sheet.getRange(last, 1).getValue() + 1;
  }

  function appendRow(sheet, headers, row) {
    const id = nextId(sheet);
    row.id = id;
    row.created_at = now;
    sheet.appendRow(headers.map(h => row[h] !== undefined ? row[h] : ''));
    return id;
  }

  function parseDate(val) {
    if (!val) return '';
    if (val instanceof Date) return Utilities.formatDate(val, 'UTC', 'yyyy-MM-dd');
    const s = String(val).trim();
    const d = new Date(s);
    if (!isNaN(d)) return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
    return s;
  }

  function txnType(val) {
    const v = String(val).toLowerCase().trim();
    if (v === 'sell' || v === 'exit') return 'Sell';
    return 'Buy';
  }

  function subcatId(name) {
    return SUBCAT_MAP[String(name).toLowerCase().trim()] || '';
  }

  function num(v) {
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  }

  // Deduplicate assets: returns existing id or creates new one
  function getOrCreateAsset(assetSheet, headers, keyCol, keyVal, newRow) {
    const data = assetSheet.getLastRow() > 1
      ? assetSheet.getRange(2, 1, assetSheet.getLastRow() - 1, headers.length).getValues()
      : [];
    const keyIdx = headers.indexOf(keyCol);
    const existing = data.find(r => String(r[keyIdx]).trim() === String(keyVal).trim());
    if (existing) return existing[0]; // return id
    return appendRow(assetSheet, headers, newRow);
  }

  // ── 1. INDIAN EQ MUTUAL FUND ───────────────────────────────────────────────

  Logger.log('Importing Indian EQ MF...');
  const mfRows = readSource(SOURCE.mf);
  const fundSheet = getVaultSheet('equity_funds');
  const fundHeaders = fundSheet.getRange(1, 1, 1, fundSheet.getLastColumn()).getValues()[0];
  const txnSheet = getVaultSheet('equity_transactions');
  const txnHeaders = txnSheet.getRange(1, 1, 1, txnSheet.getLastColumn()).getValues()[0];

  mfRows.forEach(r => {
    const fundId = getOrCreateAsset(fundSheet, fundHeaders, 'code', r['Code'], {
      subcategory_id: subcatId(r['Sub Category']),
      fund_name: r['Name'],
      fund_house: extractFundHouse(r['Name']),
      code: r['Code'],
      is_active: true,
    });
    appendRow(txnSheet, txnHeaders, {
      fund_id: fundId,
      txn_type: txnType(r['Action'] || r['Tags']),
      txn_date: parseDate(r['Date']),
      units: num(r['Quantity']),
      nav: num(r['NAV']),
      amount: num(r['Invested']),
      notes: '',
    });
  });
  Logger.log('✅ EQ MF: ' + mfRows.length + ' transactions');

  // ── 2. DEBT & HYBRID MF ────────────────────────────────────────────────────

  Logger.log('Importing Debt/Hybrid MF...');
  const debtRows = readSource(SOURCE.debtMf);
  const dFundSheet = getVaultSheet('debt_hybrid_funds');
  const dFundHeaders = dFundSheet.getRange(1, 1, 1, dFundSheet.getLastColumn()).getValues()[0];
  const dTxnSheet = getVaultSheet('debt_hybrid_transactions');
  const dTxnHeaders = dTxnSheet.getRange(1, 1, 1, dTxnSheet.getLastColumn()).getValues()[0];

  debtRows.forEach(r => {
    const fundId = getOrCreateAsset(dFundSheet, dFundHeaders, 'code', r['Code'], {
      subcategory_id: subcatId(r['Sub Category']),
      fund_name: r['Name'],
      fund_house: extractFundHouse(r['Name']),
      code: r['Code'],
      purpose: '',
      is_active: true,
    });
    appendRow(dTxnSheet, dTxnHeaders, {
      fund_id: fundId,
      txn_type: txnType(r['Action'] || r['Tags']),
      txn_date: parseDate(r['Date']),
      units: num(r['Quantity']),
      nav: num(r['NAV']),
      amount: num(r['Invested']),
      notes: '',
    });
  });
  Logger.log('✅ Debt MF: ' + debtRows.length + ' transactions');

  // ── 3. INDIAN EQUITY STOCKS ────────────────────────────────────────────────

  Logger.log('Importing Indian EQ Stocks...');
  const inRows = readSource(SOURCE.inStocks);
  const inASheet = getVaultSheet('indian_equity_stocks_assets');
  const inAHeaders = inASheet.getRange(1, 1, 1, inASheet.getLastColumn()).getValues()[0];
  const inTSheet = getVaultSheet('indian_equity_stocks_transactions');
  const inTHeaders = inTSheet.getRange(1, 1, 1, inTSheet.getLastColumn()).getValues()[0];

  inRows.forEach(r => {
    const ticker = String(r['Investment'] || r['Code'] || '').trim();
    const assetId = getOrCreateAsset(inASheet, inAHeaders, 'ticker', ticker, {
      subcategory_id: '',
      company_name: r['Name'],
      ticker: ticker,
      strategy: 'Long Term',
      is_active: true,
    });
    appendRow(inTSheet, inTHeaders, {
      asset_id: assetId,
      txn_type: txnType(r['Action'] || r['Tags']),
      txn_date: parseDate(r['Date']),
      quantity: num(r['Quantity']),
      price_per_share: num(r['Per Share Price']),
      amount: num(r['Invested']),
      notes: '',
    });
  });
  Logger.log('✅ Indian Stocks: ' + inRows.length + ' transactions');

  // ── 4. US EQUITY STOCKS ────────────────────────────────────────────────────

  Logger.log('Importing US EQ Stocks...');
  const usRows = readSource(SOURCE.usStocks);
  const usASheet = getVaultSheet('us_equity_stocks_assets');
  const usAHeaders = usASheet.getRange(1, 1, 1, usASheet.getLastColumn()).getValues()[0];
  const usTSheet = getVaultSheet('us_equity_stocks_transactions');
  const usTHeaders = usTSheet.getRange(1, 1, 1, usTSheet.getLastColumn()).getValues()[0];

  usRows.forEach(r => {
    const ticker = String(r['Investment'] || r['Code'] || '').trim();
    const assetId = getOrCreateAsset(usASheet, usAHeaders, 'ticker', ticker, {
      subcategory_id: '',
      company_name: r['Name'],
      ticker: ticker,
      strategy: 'Long Term',
      is_active: true,
    });
    const amtUsd = num(r['Amount'] || r['Per Share Price'] * r['Quantity']);
    const amtInr = num(r['IN Invested']);
    const convRate = amtUsd > 0 ? parseFloat((amtInr / amtUsd).toFixed(4)) : 0;
    appendRow(usTSheet, usTHeaders, {
      asset_id: assetId,
      txn_type: txnType(r['Action'] || r['Tags']),
      txn_date: parseDate(r['Date']),
      quantity: num(r['Quantity']),
      price_per_share_usd: num(r['Per Share Price']),
      amount_usd: amtUsd,
      conv_rate: convRate,
      amount_inr: amtInr,
      notes: '',
    });
  });
  Logger.log('✅ US Stocks: ' + usRows.length + ' transactions');

  // ── 5. CRYPTOCURRENCY ──────────────────────────────────────────────────────

  Logger.log('Importing Crypto...');
  const crRows = readSource(SOURCE.crypto);
  const crASheet = getVaultSheet('crypto_assets');
  const crAHeaders = crASheet.getRange(1, 1, 1, crASheet.getLastColumn()).getValues()[0];
  const crTSheet = getVaultSheet('crypto_transactions');
  const crTHeaders = crTSheet.getRange(1, 1, 1, crTSheet.getLastColumn()).getValues()[0];

  crRows.forEach(r => {
    const ticker = String(r['Investment'] || r['Code'] || '').trim();
    const assetId = getOrCreateAsset(crASheet, crAHeaders, 'ticker', ticker, {
      subcategory_id: '',
      name: r['Name'],
      ticker: ticker,
      is_active: true,
    });
    appendRow(crTSheet, crTHeaders, {
      asset_id: assetId,
      txn_type: txnType(r['Action'] || r['Tags']),
      txn_date: parseDate(r['Date']),
      quantity: num(r['Quantity']),
      price_usd: num(r['Per Share Price']),
      amount_usd: num(r['Amount']),
      conv_rate: num(r['Conv Rate']),
      amount_inr: num(r['IN Invested']),
      notes: '',
    });
  });
  Logger.log('✅ Crypto: ' + crRows.length + ' transactions');

  // ── 6. PRECIOUS METALS — DIGITAL ──────────────────────────────────────────

  Logger.log('Importing Precious Metals Digital...');
  const pmDRows = readSource(SOURCE.pmDigital);
  const pmDASheet = getVaultSheet('precious_metal_etf_assets');
  const pmDAHeaders = pmDASheet.getRange(1, 1, 1, pmDASheet.getLastColumn()).getValues()[0];
  const pmDTSheet = getVaultSheet('precious_metal_etf_transactions');
  const pmDTHeaders = pmDTSheet.getRange(1, 1, 1, pmDTSheet.getLastColumn()).getValues()[0];

  pmDRows.forEach(r => {
    const code = String(r['Code'] || '').trim();
    const assetId = getOrCreateAsset(pmDASheet, pmDAHeaders, 'code', code, {
      subcategory_id: 20,
      name: r['Name'],
      code: code,
      is_active: true,
    });
    appendRow(pmDTSheet, pmDTHeaders, {
      asset_id: assetId,
      txn_type: txnType(r['Action'] || r['Tags']),
      txn_date: parseDate(r['Date']),
      units: num(r['Quantity']),
      price_per_unit: num(r['NAV']),
      amount: num(r['Invested']),
      notes: '',
    });
  });
  Logger.log('✅ PM Digital: ' + pmDRows.length + ' transactions');

  // ── 7. PRECIOUS METALS — PHYSICAL ─────────────────────────────────────────

  Logger.log('Importing Precious Metals Physical...');
  const pmPRows = readSource(SOURCE.pmPhysical);
  const pmPASheet = getVaultSheet('precious_metal_physical_assets');
  const pmPAHeaders = pmPASheet.getRange(1, 1, 1, pmPASheet.getLastColumn()).getValues()[0];
  const pmPTSheet = getVaultSheet('precious_metal_physical_transactions');
  const pmPTHeaders = pmPTSheet.getRange(1, 1, 1, pmPTSheet.getLastColumn()).getValues()[0];

  pmPRows.forEach(r => {
    const name = String(r['Name'] || '').trim();
    const assetId = getOrCreateAsset(pmPASheet, pmPAHeaders, 'name', name, {
      subcategory_id: 21,
      name: name,
      metal_type: name.toLowerCase().includes('silver') ? 'Silver' : 'Gold',
      form: name.toLowerCase().includes('jewel') ? 'Jewellery' : name.toLowerCase().includes('bar') ? 'Bar' : 'Coin',
      is_active: true,
    });
    appendRow(pmPTSheet, pmPTHeaders, {
      asset_id: assetId,
      txn_type: txnType(r['Action'] || r['Tags']),
      txn_date: parseDate(r['Date']),
      quantity: num(r['Quantity']),
      price_per_unit: num(r['NAV']),
      amount: num(r['Invested']),
      notes: '',
    });
  });
  Logger.log('✅ PM Physical: ' + pmPRows.length + ' transactions');

  // ── 8. REAL ESTATE ─────────────────────────────────────────────────────────

  Logger.log('Importing Real Estate...');
  const reRows = readSource(SOURCE.realEstate);
  const reASheet = getVaultSheet('real_estate_assets');
  const reAHeaders = reASheet.getRange(1, 1, 1, reASheet.getLastColumn()).getValues()[0];
  const reTSheet = getVaultSheet('real_estate_transactions');
  const reTHeaders = reTSheet.getRange(1, 1, 1, reTSheet.getLastColumn()).getValues()[0];

  reRows.forEach(r => {
    const name = String(r['Name'] || '').trim();
    const unit  = String(r['Unit'] || 'Cents').trim();
    const assetId = getOrCreateAsset(reASheet, reAHeaders, 'name', name, {
      subcategory_id: '',
      name: name,
      location: extractLocation(name),
      unit_of_measure: mapUnit(unit),
      is_active: true,
    });
    appendRow(reTSheet, reTHeaders, {
      asset_id: assetId,
      txn_type: txnType(r['Action'] || r['Tags']),
      txn_date: parseDate(r['Date']),
      quantity: num(r['Quantity']),
      price_per_unit: num(r['NAV']),
      registration_cost: num(r['Registration']),
      other_expenses: num(r['Other Expenses']),
      notes: '',
    });
  });
  Logger.log('✅ Real Estate: ' + reRows.length + ' transactions');

  Logger.log('🎉 Import complete!');
}

// ── Utility functions ────────────────────────────────────────────────────────

function extractFundHouse(name) {
  if (!name) return '';
  const words = String(name).split(' ');
  return words.slice(0, 2).join(' ');
}

function extractLocation(name) {
  if (!name) return '';
  const parts = String(name).split('|');
  return parts[0].trim();
}

function mapUnit(unit) {
  const u = String(unit).toLowerCase().trim();
  if (u === 'cents' || u === 'cent') return 'Cents';
  if (u.includes('sq.ft') || u.includes('sqft')) return 'Sq.ft';
  if (u.includes('acre')) return 'Acres';
  if (u.includes('sq.m') || u.includes('sqm')) return 'Sq.m';
  return 'Cents';
}
