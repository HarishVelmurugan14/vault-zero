// VaultZero — Bulk Import
// Run bulkImport() once from Apps Script to populate all historical data

function bulkImport() {
  const ss = SpreadsheetApp.openById('1R4yXbxb6YgXh-rDqnnw3iWOZe2ABcYMD96iN5hvDi5A');
  const now = new Date().toISOString();

  // ── Helper ──────────────────────────────────────────────────────────────────

  function insertRows(sheetName, rows) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) { Logger.log('Sheet not found: ' + sheetName); return {}; }
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idMap = {};
    rows.forEach((row, i) => {
      const lastRow = sheet.getLastRow();
      const id = lastRow <= 1 ? 1 : sheet.getRange(lastRow, 1).getValue() + 1;
      row.id = id;
      row.created_at = now;
      const rowData = headers.map(h => row[h] !== undefined ? row[h] : '');
      sheet.appendRow(rowData);
      if (row._key) idMap[row._key] = id;
    });
    Logger.log('Inserted ' + rows.length + ' rows into ' + sheetName);
    return idMap;
  }

  // ── 1. EQUITY MF FUNDS ──────────────────────────────────────────────────────
  // Subcategory IDs: Mid Cap=2, Small Cap=3, ELSS=5

  const fundIds = insertRows('equity_funds', [
    { _key: 'quant_elss',   subcategory_id: 5, fund_name: 'Quant ELSS Tax Saver Growth Option Direct Plan', fund_house: 'Quant',           code: 'QUAN_ELSS_TAX_KBGFAS', is_active: true },
    { _key: 'sbi_elss',     subcategory_id: 5, fund_name: 'SBI ELSS Tax Saver Fund Direct Growth',          fund_house: 'SBI',             code: 'SBI_ELSS_TAX_BOYDXZ',  is_active: true },
    { _key: 'dsp_elss',     subcategory_id: 5, fund_name: 'DSP ELSS Tax Saver Fund Direct Plan Growth',     fund_house: 'DSP',             code: 'DSP_ELSS_TAX_F8PE7V',  is_active: true },
    { _key: 'hdfc_midcap',  subcategory_id: 2, fund_name: 'HDFC Mid Cap Fund Direct Plan Growth Option',    fund_house: 'HDFC',            code: 'HDFC_MID_CAP_NRWMOV',  is_active: true },
    { _key: 'tata_smallcap',subcategory_id: 3, fund_name: 'Tata Small Cap Fund Direct Growth',              fund_house: 'Tata',            code: 'TATA_SMAL_CAP_7AMZ29', is_active: true },
  ]);

  // ── 2. EQUITY MF TRANSACTIONS ───────────────────────────────────────────────

  insertRows('equity_transactions', [
    { fund_id: fundIds['quant_elss'],    txn_type: 'Buy', txn_date: '2023-11-07', units: 59.840,    nav: 304.9436, amount: 18247.83 },
    { fund_id: fundIds['quant_elss'],    txn_type: 'Buy', txn_date: '2024-04-03', units: 19.720,    nav: 405.6558, amount: 7999.53  },
    { fund_id: fundIds['quant_elss'],    txn_type: 'Buy', txn_date: '2024-05-02', units: 19.292,    nav: 414.6692, amount: 7999.80  },
    { fund_id: fundIds['quant_elss'],    txn_type: 'Buy', txn_date: '2024-06-03', units: 15.963,    nav: 407.18,   amount: 6499.81  },
    { fund_id: fundIds['quant_elss'],    txn_type: 'Buy', txn_date: '2024-07-01', units: 14.670,    nav: 442.95,   amount: 6498.08  },
    { fund_id: fundIds['quant_elss'],    txn_type: 'Buy', txn_date: '2024-08-01', units: 14.259,    nav: 455.8394, amount: 6499.81  },
    { fund_id: fundIds['quant_elss'],    txn_type: 'Buy', txn_date: '2024-09-02', units: 14.393,    nav: 451.5946, amount: 6499.80  },
    { fund_id: fundIds['quant_elss'],    txn_type: 'Buy', txn_date: '2024-10-03', units: 14.651,    nav: 443.6417, amount: 6499.79  },
    { fund_id: fundIds['sbi_elss'],      txn_type: 'Buy', txn_date: '2024-10-28', units: 32.299,    nav: 464.3867, amount: 14999.23 },
    { fund_id: fundIds['dsp_elss'],      txn_type: 'Buy', txn_date: '2024-10-28', units: 99.625,    nav: 150.557,  amount: 14999.24 },
    { fund_id: fundIds['hdfc_midcap'],   txn_type: 'Buy', txn_date: '2024-10-28', units: 34.568,    nav: 202.488,  amount: 6999.61  },
    { fund_id: fundIds['hdfc_midcap'],   txn_type: 'Buy', txn_date: '2025-02-13', units: 7.984,     nav: 187.87,   amount: 1499.95  },
    { fund_id: fundIds['hdfc_midcap'],   txn_type: 'Buy', txn_date: '2025-03-03', units: 17.909,    nav: 178.67,   amount: 3199.80  },
    { fund_id: fundIds['hdfc_midcap'],   txn_type: 'Buy', txn_date: '2025-03-31', units: 16.993,    nav: 188.30,   amount: 3199.78  },
    { fund_id: fundIds['tata_smallcap'], txn_type: 'Buy', txn_date: '2024-06-03', units: 35.841,    nav: 37.66,    amount: 1349.77  },
    { fund_id: fundIds['tata_smallcap'], txn_type: 'Buy', txn_date: '2024-08-01', units: 55.071,    nav: 45.3938,  amount: 2499.88  },
    { fund_id: fundIds['tata_smallcap'], txn_type: 'Buy', txn_date: '2024-09-02', units: 53.237,    nav: 46.9574,  amount: 2499.87  },
    { fund_id: fundIds['tata_smallcap'], txn_type: 'Buy', txn_date: '2024-10-03', units: 52.027,    nav: 48.0496,  amount: 2499.88  },
  ]);

  // ── 3. DEBT & HYBRID MF FUNDS ───────────────────────────────────────────────
  // Subcategory IDs: Ultra Short Term=10

  const debtFundIds = insertRows('debt_hybrid_funds', [
    { _key: 'icici_ust', subcategory_id: 10, fund_name: 'ICICI Prudential Ultra Short Term Fund Direct Plan Growth', fund_house: 'ICICI Prudential', code: 'ICIC_PRU_ULTR_75ZN6A', purpose: '', is_active: true },
  ]);

  // ── 4. DEBT MF TRANSACTIONS ─────────────────────────────────────────────────

  insertRows('debt_hybrid_transactions', [
    { fund_id: debtFundIds['icici_ust'], txn_type: 'Buy',  txn_date: '2025-06-16', units: 1671.755, nav: 29.91,   amount: 50002.19  },
    { fund_id: debtFundIds['icici_ust'], txn_type: 'Buy',  txn_date: '2025-06-18', units: 5688.954, nav: 29.9207, amount: 170217.49 },
    { fund_id: debtFundIds['icici_ust'], txn_type: 'Sell', txn_date: '2025-07-10', units: 35.271,   nav: 30.06,   amount: 1060.25   },
    { fund_id: debtFundIds['icici_ust'], txn_type: 'Sell', txn_date: '2025-07-15', units: 473.947,  nav: 30.09,   amount: 14261.07  },
    { fund_id: debtFundIds['icici_ust'], txn_type: 'Sell', txn_date: '2025-07-15', units: 156.419,  nav: 30.09,   amount: 4706.65   },
  ]);

  // ── 5. PRECIOUS METALS — DIGITAL ETF ───────────────────────────────────────
  // Subcategory ID: Digital=20

  const etfIds = insertRows('precious_metal_etf_assets', [
    { _key: 'silver_etf', subcategory_id: 20, name: 'ICICI Prudential Silver ETF', code: 'SILVERIETF', is_active: true },
    { _key: 'gold_etf',   subcategory_id: 20, name: 'Kotak Gold ETF',              code: 'GOLD1',      is_active: true },
  ]);

  insertRows('precious_metal_etf_transactions', [
    { asset_id: etfIds['silver_etf'], txn_type: 'Buy', txn_date: '2025-05-12', units: 74, price_per_unit: 95.20,  amount: 7044.80 },
    { asset_id: etfIds['gold_etf'],   txn_type: 'Buy', txn_date: '2025-05-12', units: 44, price_per_unit: 78.79,  amount: 3466.76 },
    { asset_id: etfIds['silver_etf'], txn_type: 'Buy', txn_date: '2025-06-02', units: 35, price_per_unit: 98.47,  amount: 3446.45 },
    { asset_id: etfIds['gold_etf'],   txn_type: 'Buy', txn_date: '2025-06-02', units: 44, price_per_unit: 81.15,  amount: 3570.60 },
    { asset_id: etfIds['silver_etf'], txn_type: 'Buy', txn_date: '2025-07-07', units: 26, price_per_unit: 108.30, amount: 2815.80 },
    { asset_id: etfIds['gold_etf'],   txn_type: 'Buy', txn_date: '2025-07-07', units: 52, price_per_unit: 81.13,  amount: 4218.76 },
  ]);

  // ── 6. PRECIOUS METALS — PHYSICAL ──────────────────────────────────────────
  // Subcategory ID: Physical=21

  const physicalIds = insertRows('precious_metal_physical_assets', [
    { _key: 'gold_coin', subcategory_id: 21, name: 'Gold Coin', metal_type: 'Gold', form: 'Coin', is_active: true },
  ]);

  insertRows('precious_metal_physical_transactions', [
    { asset_id: physicalIds['gold_coin'], txn_type: 'Buy', txn_date: '2024-08-04',  quantity: 16, price_per_unit: 6470,  amount: 103520 },
    { asset_id: physicalIds['gold_coin'], txn_type: 'Buy', txn_date: '2024-11-05',  quantity: 8,  price_per_unit: 7355,  amount: 58840  },
    { asset_id: physicalIds['gold_coin'], txn_type: 'Buy', txn_date: '2024-12-25',  quantity: 8,  price_per_unit: 7100,  amount: 56800  },
    { asset_id: physicalIds['gold_coin'], txn_type: 'Buy', txn_date: '2025-09-01',  quantity: 8,  price_per_unit: 10050, amount: 80400  },
  ]);

  // ── 7. INDIAN EQUITY STOCKS ─────────────────────────────────────────────────

  const inStockIds = insertRows('indian_equity_stocks_assets', [
    { _key: 'ongc', subcategory_id: '', company_name: 'Oil and Natural Gas Corporation Ltd', ticker: 'ONGC', strategy: 'Long Term', is_active: true },
  ]);

  insertRows('indian_equity_stocks_transactions', [
    { asset_id: inStockIds['ongc'], txn_type: 'Buy', txn_date: '2023-08-23', quantity: 5, price_per_share: 175.75, amount: 878.75  },
    { asset_id: inStockIds['ongc'], txn_type: 'Buy', txn_date: '2023-08-30', quantity: 5, price_per_share: 175.85, amount: 879.25  },
    { asset_id: inStockIds['ongc'], txn_type: 'Buy', txn_date: '2023-09-06', quantity: 5, price_per_share: 184.55, amount: 922.75  },
    { asset_id: inStockIds['ongc'], txn_type: 'Buy', txn_date: '2023-09-13', quantity: 5, price_per_share: 182.85, amount: 914.25  },
    { asset_id: inStockIds['ongc'], txn_type: 'Buy', txn_date: '2023-09-20', quantity: 5, price_per_share: 188.15, amount: 940.75  },
  ]);

  // ── 8. US EQUITY STOCKS ─────────────────────────────────────────────────────

  const usStockIds = insertRows('us_equity_stocks_assets', [
    { _key: 'googl', subcategory_id: '', company_name: 'Alphabet Inc Class A', ticker: 'GOOGL', strategy: 'Long Term', is_active: true },
    { _key: 'aapl',  subcategory_id: '', company_name: 'Apple Inc',            ticker: 'AAPL',  strategy: 'Long Term', is_active: true },
    { _key: 'tsla',  subcategory_id: '', company_name: 'Tesla Inc',            ticker: 'TSLA',  strategy: 'Long Term', is_active: true },
  ]);

  insertRows('us_equity_stocks_transactions', [
    { asset_id: usStockIds['googl'], txn_type: 'Buy', txn_date: '2025-05-14', quantity: 0.24174268, price_per_share_usd: 164.97, amount_usd: 39.88,  conv_rate: 95.88, amount_inr: 3823.46 },
    { asset_id: usStockIds['aapl'],  txn_type: 'Buy', txn_date: '2025-05-14', quantity: 0.02828910, price_per_share_usd: 211.39, amount_usd: 5.98,   conv_rate: 95.87, amount_inr: 573.33  },
    { asset_id: usStockIds['tsla'],  txn_type: 'Buy', txn_date: '2025-05-14', quantity: 0.01650161, price_per_share_usd: 347.24, amount_usd: 5.73,   conv_rate: 95.88, amount_inr: 549.36  },
  ]);

  // ── 9. CRYPTOCURRENCY ───────────────────────────────────────────────────────

  const cryptoIds = insertRows('crypto_assets', [
    { _key: 'eth', subcategory_id: '', name: 'Ethereum', ticker: 'ETHUSD', is_active: true },
    { _key: 'btc', subcategory_id: '', name: 'Bitcoin',  ticker: 'BTCUSD', is_active: true },
  ]);

  insertRows('crypto_transactions', [
    { asset_id: cryptoIds['eth'], txn_type: 'Buy', txn_date: '2025-05-07', quantity: 0.00397390, price_usd: 1775.43,   amount_usd: 7.06,  conv_rate: 97.99, amount_inr: 691.81   },
    { asset_id: cryptoIds['btc'], txn_type: 'Buy', txn_date: '2025-05-07', quantity: 0.00015109, price_usd: 94806.40,  amount_usd: 14.32, conv_rate: 97.99, amount_inr: 1403.22  },
    { asset_id: cryptoIds['eth'], txn_type: 'Buy', txn_date: '2025-06-01', quantity: 0.00288505, price_usd: 2516.42,   amount_usd: 7.26,  conv_rate: 97.01, amount_inr: 704.29   },
    { asset_id: cryptoIds['btc'], txn_type: 'Buy', txn_date: '2025-06-01', quantity: 0.00014098, price_usd: 104555.30, amount_usd: 14.74, conv_rate: 97.01, amount_inr: 1429.93  },
  ]);

  // ── 10. REAL ESTATE ─────────────────────────────────────────────────────────

  const reIds = insertRows('real_estate_assets', [
    { _key: 're1', subcategory_id: '', name: 'Thiyagadurugam | 10 Cent Land',                          location: 'Thiyagadurugam', unit_of_measure: 'Cents', is_active: true },
    { _key: 're2', subcategory_id: '', name: 'Thiyagadurugam | Vignesh Jeeva Nagar Extension | Plot 15', location: 'Thiyagadurugam', unit_of_measure: 'Cents', is_active: true },
  ]);

  insertRows('real_estate_transactions', [
    { asset_id: reIds['re1'], txn_type: 'Buy', txn_date: '2024-08-04', quantity: 5,   price_per_unit: 250000, registration_cost: 0,     other_expenses: 0,     notes: '' },
    { asset_id: reIds['re2'], txn_type: 'Buy', txn_date: '2024-11-05', quantity: 4.5, price_per_unit: 303000, registration_cost: 40300, other_expenses: 11000, notes: '' },
  ]);

  Logger.log('✅ Bulk import complete!');
}
