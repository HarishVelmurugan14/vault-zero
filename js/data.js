// VaultZero — Stream definitions, field configs, validation rules

const BUCKETS = [
  { id: 1, name: 'Wealth Builder', icon: '📈', color: '#4f46e5' },
  { id: 2, name: 'Safety Net', icon: '🛡️', color: '#0891b2' },
  { id: 3, name: 'Hedge & Opportunities', icon: '⚡', color: '#d97706' },
];

// Fallback only — overwritten from the `subcategories` sheet at boot. Keep in sync
// with that sheet (and with VZC_ID_PLAN in gas/cleanup_vaultzero.gs).
// Range scheme: subcategory id = category id × 100 + n.
const SUBCAT_NAMES = {
  101: 'Large Cap', 102: 'Mid Cap', 103: 'Small Cap', 104: 'Flexi Cap', 105: 'ELSS', 106: 'Index',  // 1 Indian EQ MF
  201: 'Large Cap', 202: 'Mid & Small Cap',                                                    // 2 Indian Equity Stocks
  301: 'ETF', 302: 'Stocks',                                                                   // 3 US Equity
  401: 'Land & Plots',                                                                         // 4 Real Estate
  501: 'Liquid', 502: 'Ultra Short Duration', 503: 'Arbitrage',                                // 5 Debt & Hybrid (SEBI type)
  801: 'Digital', 802: 'Physical',                                                             // 8 Precious Metals (names drive resolveStream)
  901: 'Majors (BTC & ETH)',                                                                   // 9 Cryptocurrency
};

// Categories — range scheme: ids 1–9 in bucket order (Wealth Builder 1–4, Safety Net 5–7,
// Hedge 8–9). Must match the `categories` sheet.
// hasSubcategories: true = show subcategory drill-down in History
const CATEGORIES = [
  { id: 1, bucket_id: 1, name: 'Indian EQ Mutual Fund',     stream: 'equity_mf',       hasSubcategories: true  },
  { id: 2, bucket_id: 1, name: 'Indian Equity Stocks',      stream: 'indian_stocks',   hasSubcategories: true  },
  { id: 3, bucket_id: 1, name: 'US Equity',                 stream: 'us_equity_ibkr',  hasSubcategories: true  },
  { id: 4, bucket_id: 1, name: 'Real Estate',               stream: 'real_estate',     hasSubcategories: true  },
  { id: 5, bucket_id: 2, name: 'Debt & Hybrid Mutual Fund', stream: 'debt_hybrid_mf',  hasSubcategories: true  },
  { id: 6, bucket_id: 2, name: 'EPF',                       stream: 'epf',             hasSubcategories: false },
  { id: 7, bucket_id: 2, name: 'Bank Accounts',             stream: 'bank_accounts',   hasSubcategories: false },
  { id: 8, bucket_id: 3, name: 'Precious Metals',           stream: 'precious_metals', hasSubcategories: true  },
  { id: 9, bucket_id: 3, name: 'Cryptocurrency',            stream: 'crypto',          hasSubcategories: true  },
];

// ── Fund scope, mandate & benchmarks (Insights) ───────────────────────────────

// The "fund" Insights reports on: market-traded growth assets only. Debt / arbitrage / liquid
// funds, EPF, bank, real estate and uninvested US cash (snapshot asset_table 'us_cash') are
// outside every number.
const FUND_SCOPE = [1, 2, 3, 8, 9];   // Indian EQ MF, Indian Equity Stocks, US Equity, Precious Metals, Crypto
const FUND_EXCLUDED_TABLES = ['us_cash'];

// Sleeves group the in-scope categories.
const SLEEVES = [
  { key: 'india',  label: 'Indian equity',   cats: [1, 2] },
  { key: 'metals', label: 'Precious metals', cats: [8] },
  { key: 'us',     label: 'US equity',       cats: [3] },
  { key: 'crypto', label: 'Crypto',          cats: [9] },
];

// Target weights as entered; computeMandateWeights() renormalises each level to 100.
// Holdings within a sleeve are matched by name; a sleeve without a split has no holding targets.
const MANDATE = {
  sleeves: { india: 74, metals: 12, us: 7, crypto: 2 },
  holdings: {
    india: [
      { label: 'Edelweiss Mid Cap',      match: /edelweiss mid ?cap/i,             weight: 32 },
      { label: 'PPFAS Flexi Cap',        match: /parag parikh flexi|ppfas flexi/i, weight: 32 },
      { label: 'Navi Nifty 50',          match: /navi nifty 50/i,                  weight: 22 },
      { label: 'Tata Small Cap',         match: /tata small ?cap/i,                weight: 7 },
      { label: 'Nippon India Small Cap', match: /nippon india small ?cap/i,        weight: 7 },
    ],
    us: [
      { label: 'VOO',  match: /s&p 500|\bvoo\b/i,         weight: 60 },
      { label: 'QQQM', match: /nasdaq[ -]?100|\bqqqm\b/i, weight: 40 },
    ],
  },
};

// Total-return benchmark series (stored in the benchmark_prices sheet under these keys by
// gas/snapshot.gs). Each is an index-fund / ETF / FoF NAV or a dividend-adjusted close, in INR.
const BENCHMARKS = {
  nifty50:        { label: 'Nifty 50' },
  nifty100:       { label: 'Nifty 100' },
  nifty500:       { label: 'Nifty 500' },
  largemidcap250: { label: 'Nifty LargeMidcap 250' },
  midcap150:      { label: 'Nifty Midcap 150' },
  smallcap250:    { label: 'Nifty Smallcap 250' },
  gold:           { label: 'Gold' },
  silver:         { label: 'Silver' },
  voo:            { label: 'S&P 500 (VOO, INR)' },
  qqqm:           { label: 'Nasdaq 100 (QQQM, INR)' },
  btc:            { label: 'Bitcoin (INR)' },
};

// Holding → benchmark, by category and name; the first matching rule wins. Mutual funds match
// on their type words only, so a new kind of fund shows up as "no benchmark" instead of being
// compared with the wrong index. Index funds on a narrow / thematic index (Next 50, factor and
// sector indices) get bench: null on purpose — a broad parent index would show their index's own
// gap as skill. Order matters: "Large & Mid" before "Mid", "Nifty 500" never matches Nifty 50.
// Multi-cap uses Nifty 500 as the nearest stored series (its own index is Nifty 500 Multicap 50:25:25).
const BENCHMARK_MAP = [
  { cats: [1], match: /next 50|momentum|value 20|equal weight|alpha 50|low vol|manufacturing|bharat 22/i, bench: null },
  { cats: [1], match: /large ?(&|and)? ?mid ?cap/i,                      bench: 'largemidcap250' },
  { cats: [1], match: /nifty ?500|multi ?cap/i,                          bench: 'nifty500' },
  { cats: [1], match: /small ?cap/i,                                     bench: 'smallcap250' },
  { cats: [1], match: /mid ?cap|emerging equity/i,                       bench: 'midcap150' },
  { cats: [1], match: /large ?cap|bluechip/i,                            bench: 'nifty100' },
  { cats: [1], match: /\bnifty ?50\b(?!\d)/i,                            bench: 'nifty50' },
  { cats: [1], match: /flexi ?cap|elss|tax saver|focused|value|contra/i, bench: 'nifty500' },
  { cats: [2], match: /./,                                               bench: 'nifty50' },
  { cats: [3], match: /s&p 500|\bvoo\b/i,                                bench: 'voo' },
  { cats: [3], match: /nasdaq[ -]?100|\bqqqm?\b/i,                       bench: 'qqqm' },
  { cats: [8], match: /silver/i,                                         bench: 'silver' },
  { cats: [8], match: /gold/i,                                           bench: 'gold' },
  { cats: [9], match: /./,                                               bench: 'btc' },
];

// Stream configurations — defines tables, asset form fields, transaction form fields
const STREAMS = {

  equity_mf: {
    label: 'Indian EQ Mutual Fund',
    currentPriceCol: 'current_nav',
    amountCol: 'amount',
    assetTable: 'equity_funds',
    txnTable: 'equity_transactions',
    assetIdCol: 'fund_id',
    assetNameCol: 'fund_name',
    assetFields: [
      { id: 'subcategory_id', label: 'Subcategory', type: 'subcategory', required: true },
      { id: 'fund_name', label: 'Fund Name', type: 'text', required: true, placeholder: 'e.g. PPFAS Flexi Cap' },
      { id: 'fund_house', label: 'Fund House', type: 'text', required: true, placeholder: 'e.g. Parag Parikh' },
      { id: 'code', label: 'Price Fetch Code', type: 'text', required: true, placeholder: 'e.g. QUAN_ELSS_TAX_KBGFAS' },
      { id: 'isin', label: 'ISIN', type: 'text', placeholder: 'e.g. INF879O01027 (for monthly snapshot history)' },
    ],
    txnFields: [
      { id: 'txn_type', label: 'Type', type: 'select', options: ['Buy', 'Sell'], required: true },
      { id: 'txn_date', label: 'Date', type: 'date', required: true },
      { id: 'units', label: 'Units', type: 'number', step: '0.000001', required: true },
      { id: 'nav', label: 'NAV (₹)', type: 'number', step: '0.0001', required: true, triggers: 'amount' },
      { id: 'amount', label: 'Amount (₹)', type: 'number', step: '0.01', required: true, computed: 'units*nav' },
      { id: 'notes', label: 'Notes', type: 'text' },
    ],
  },

  debt_hybrid_mf: {
    label: 'Debt & Hybrid Mutual Fund',
    currentPriceCol: 'current_nav',
    amountCol: 'amount',
    assetTable: 'debt_hybrid_funds',
    txnTable: 'debt_hybrid_transactions',
    assetIdCol: 'fund_id',
    assetNameCol: 'fund_name',
    assetFields: [
      { id: 'subcategory_id', label: 'Subcategory', type: 'subcategory', required: true },
      { id: 'fund_name', label: 'Fund Name', type: 'text', required: true, placeholder: 'e.g. ICICI Pru Ultra Short Term' },
      { id: 'fund_house', label: 'Fund House', type: 'text', required: true },
      { id: 'code', label: 'Price Fetch Code', type: 'text', required: true },
      { id: 'isin', label: 'ISIN', type: 'text', placeholder: 'e.g. INF109K01T04 (for monthly snapshot history)' },
    ],
    txnFields: [
      { id: 'txn_type', label: 'Type', type: 'select', options: ['Buy', 'Sell'], required: true },
      { id: 'txn_date', label: 'Date', type: 'date', required: true },
      { id: 'units', label: 'Units', type: 'number', step: '0.000001', required: true },
      { id: 'nav', label: 'NAV (₹)', type: 'number', step: '0.0001', required: true, triggers: 'amount' },
      { id: 'amount', label: 'Amount (₹)', type: 'number', step: '0.01', required: true, computed: 'units*nav' },
      { id: 'notes', label: 'Notes', type: 'text' },
    ],
  },

  indian_stocks: {
    label: 'Indian Equity Stocks',
    currentPriceCol: 'current_price',
    amountCol: 'amount',
    assetTable: 'indian_equity_stocks_assets',
    txnTable: 'indian_equity_stocks_transactions',
    assetIdCol: 'asset_id',
    assetNameCol: 'company_name',
    assetFields: [
      { id: 'subcategory_id', label: 'Subcategory', type: 'subcategory', required: true },
      { id: 'company_name', label: 'Company Name', type: 'text', required: true, placeholder: 'e.g. Reliance Industries Ltd' },
      { id: 'ticker', label: 'Ticker / Code', type: 'text', required: true, placeholder: 'e.g. RELIANCE' },
      { id: 'strategy', label: 'Strategy', type: 'select', options: ['Long Term', 'Dividend', 'Short Term'], required: true },
    ],
    txnFields: [
      { id: 'txn_type', label: 'Type', type: 'select', options: ['Buy', 'Sell'], required: true },
      { id: 'txn_date', label: 'Date', type: 'date', required: true },
      { id: 'quantity', label: 'Shares', type: 'number', step: '1', required: true },
      { id: 'price_per_share', label: 'Price per Share (₹)', type: 'number', step: '0.01', required: true, triggers: 'amount' },
      { id: 'amount', label: 'Amount (₹)', type: 'number', step: '0.01', required: true, computed: 'quantity*price_per_share' },
      { id: 'notes', label: 'Notes', type: 'text' },
    ],
  },

  // US Equity (IBKR) — wire-aware. USD equity inside the broker; INR cost basis
  // derived from the latest wire on or before each BUY. Custom log UI (usEquity).
  us_equity_ibkr: {
    label: 'US Equity',
    usEquity: true,
    currentPriceCol: 'current_price',   // INR per share (GOOGLEFINANCE direct_usd)
    costBasisCol: 'inr_cost_basis',     // INR cost on BUY rows
    assetTable: 'us_equity_assets',
    txnTable: 'us_equity_transactions',
    wireTable: 'us_wires',
    repatTable: 'us_repatriations',
    incomeTable: 'us_income',
    auxTables: ['us_wires', 'us_repatriations', 'us_income'],
    usdPriceCol: 'current_price_usd',   // raw USD price/share (for live-rate derivation)
    assetIdCol: 'asset_id',
    assetNameCol: 'name',
    assetFields: [
      { id: 'subcategory_id', label: 'Subcategory', type: 'subcategory', required: true },
      { id: 'ticker', label: 'Ticker', type: 'text', required: true, placeholder: 'e.g. VOO' },
      { id: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Vanguard S&P 500 ETF' },
      { id: 'asset_type', label: 'Type', type: 'select', options: ['ETF', 'STOCK'], required: true },
    ],
    // Buy/Sell handled by a custom form (renderUsEquityForm) — these fields document the shape.
    txnFields: [
      { id: 'txn_type', label: 'Type', type: 'select', options: ['BUY', 'SELL'], required: true },
      { id: 'txn_date', label: 'Date', type: 'date', required: true },
      { id: 'units', label: 'Units', type: 'number', step: '0.000001', required: true, triggers: 'usd_amount' },
      { id: 'price_per_share_usd', label: 'Price / Share ($)', type: 'number', step: '0.0001', required: true, triggers: 'usd_amount' },
      { id: 'usd_amount', label: 'USD Amount ($)', type: 'number', step: '0.01', required: true, computed: 'units*price_per_share_usd' },
      { id: 'notes', label: 'Notes', type: 'text' },
    ],
    // Wire form fields (currency in)
    wireFields: [
      { id: 'wire_date', label: 'Wire Date', type: 'date', required: true },
      { id: 'payment_reference', label: 'Payment Reference', type: 'text', placeholder: 'e.g. U20241815 Harish V' },
      { id: 'inr_principal', label: 'INR Principal (₹)', type: 'number', step: '0.01', required: true },
      { id: 'commission', label: 'Commission (₹)', type: 'number', step: '0.01' },
      { id: 'gst', label: 'GST (₹)', type: 'number', step: '0.01' },
      { id: 'correspondent_charge', label: 'Correspondent Charge (₹)', type: 'number', step: '0.01' },
      { id: 'usd_sent', label: 'USD Sent ($)', type: 'number', step: '0.01', required: true },
      { id: 'usd_received', label: 'USD Received ($)', type: 'number', step: '0.01', required: true },
      { id: 'status', label: 'Status', type: 'select', options: ['received', 'sent'] },
      { id: 'notes', label: 'Notes', type: 'text' },
    ],
    // Repatriation form fields (currency out)
    repatFields: [
      { id: 'repat_date', label: 'Repat Date', type: 'date', required: true },
      { id: 'usd_withdrawn', label: 'USD Withdrawn ($)', type: 'number', step: '0.01', required: true },
      { id: 'ibkr_withdrawal_fee', label: 'IBKR Withdrawal Fee ($)', type: 'number', step: '0.01' },
      { id: 'correspondent_charge', label: 'Correspondent Charge (₹)', type: 'number', step: '0.01' },
      { id: 'inr_received', label: 'INR Received (₹)', type: 'number', step: '0.01', required: true },
      { id: 'status', label: 'Status', type: 'select', options: ['received', 'sent'] },
      { id: 'notes', label: 'Notes', type: 'text' },
    ],
    // Income form fields (dividends / interest credited as USD cash)
    incomeFields: [
      { id: 'income_type', label: 'Type', type: 'select', options: ['Dividend', 'Interest'], required: true },
      { id: 'income_date', label: 'Date', type: 'date', required: true },
      { id: 'usd_amount', label: 'USD Amount ($)', type: 'number', step: '0.01', required: true },
      { id: 'notes', label: 'Notes', type: 'text' },
    ],
  },

  precious_metals_digital: {
    label: 'Precious Metals — Digital',
    currentPriceCol: 'current_price',
    amountCol: 'amount',
    assetTable: 'precious_metal_etf_assets',
    txnTable: 'precious_metal_etf_transactions',
    assetIdCol: 'asset_id',
    assetNameCol: 'name',
    assetFields: [
      { id: 'name', label: 'ETF Name', type: 'text', required: true, placeholder: 'e.g. Kotak Gold ETF' },
      { id: 'code', label: 'Price Fetch Code', type: 'text', required: true, placeholder: 'e.g. GOLD1' },
    ],
    txnFields: [
      { id: 'txn_type', label: 'Type', type: 'select', options: ['Buy', 'Sell'], required: true },
      { id: 'txn_date', label: 'Date', type: 'date', required: true },
      { id: 'units', label: 'Units', type: 'number', step: '0.001', required: true },
      { id: 'price_per_unit', label: 'Price per Unit (₹)', type: 'number', step: '0.0001', required: true, triggers: 'amount' },
      { id: 'amount', label: 'Amount (₹)', type: 'number', step: '0.01', required: true, computed: 'units*price_per_unit' },
      { id: 'notes', label: 'Notes', type: 'text' },
    ],
  },

  precious_metals_physical: {
    label: 'Precious Metals — Physical',
    currentPriceCol: null,
    manualPriceType: 'physical_precious_metal',
    amountCol: 'amount',
    assetTable: 'precious_metal_physical_assets',
    txnTable: 'precious_metal_physical_transactions',
    assetIdCol: 'asset_id',
    assetNameCol: 'name',
    assetFields: [
      { id: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Gold Coin' },
      { id: 'metal_type', label: 'Metal', type: 'select', options: ['Gold', 'Silver'], required: true },
      { id: 'form', label: 'Form', type: 'select', options: ['Coin', 'Bar', 'Jewellery'], required: true },
      { id: 'price_fetch_way', label: 'Price Source', type: 'select', options: ['manual', 'formula'], required: true },
    ],
    txnFields: [
      { id: 'txn_type', label: 'Type', type: 'select', options: ['Buy', 'Sell'], required: true },
      { id: 'txn_date', label: 'Date', type: 'date', required: true },
      { id: 'quantity', label: 'Weight (grams)', type: 'number', step: '0.001', required: true },
      { id: 'price_per_unit', label: 'Price per Gram (₹)', type: 'number', step: '0.01', required: true, triggers: 'amount' },
      { id: 'amount', label: 'Amount (₹)', type: 'number', step: '0.01', required: true, computed: 'quantity*price_per_unit' },
      { id: 'notes', label: 'Notes', type: 'text' },
    ],
    manualPrice: true,
    manualPriceLabel: 'Price per gram',
  },

  crypto: {
    label: 'Cryptocurrency',
    currentPriceCol: 'current_price',
    amountCol: 'amount_inr',
    assetTable: 'crypto_assets',
    txnTable: 'crypto_transactions',
    assetIdCol: 'asset_id',
    assetNameCol: 'name',
    assetFields: [
      { id: 'subcategory_id', label: 'Subcategory', type: 'subcategory', required: true },
      { id: 'name', label: 'Coin Name', type: 'text', required: true, placeholder: 'e.g. Ethereum' },
      { id: 'ticker', label: 'Ticker / Pair', type: 'text', required: true, placeholder: 'e.g. ETHUSD' },
    ],
    txnFields: [
      { id: 'txn_type', label: 'Type', type: 'select', options: ['Buy', 'Sell'], required: true },
      { id: 'txn_date', label: 'Date', type: 'date', required: true },
      { id: 'quantity', label: 'Quantity', type: 'number', step: '0.00000001', required: true },
      { id: 'price_usd', label: 'Price (USD)', type: 'number', step: '0.01', required: true, triggers: 'amount_usd' },
      { id: 'amount_usd', label: 'Amount (USD)', type: 'number', step: '0.01', required: true, computed: 'quantity*price_usd' },
      { id: 'conv_rate', label: 'Conv. Rate (USD/INR)', type: 'number', step: '0.01', required: true, triggers: 'amount_inr' },
      { id: 'amount_inr', label: 'Amount (₹)', type: 'number', step: '0.01', required: true, computed: 'amount_usd*conv_rate' },
      { id: 'notes', label: 'Notes', type: 'text' },
    ],
  },

  real_estate: {
    label: 'Real Estate',
    currentPriceCol: null,
    manualPriceType: 'real_estate',
    amountCol: null,
    assetTable: 'real_estate_assets',
    txnTable: 'real_estate_transactions',
    assetIdCol: 'asset_id',
    assetNameCol: 'name',
    assetFields: [
      { id: 'subcategory_id', label: 'Subcategory', type: 'subcategory', required: true },
      { id: 'name', label: 'Property Name', type: 'text', required: true, placeholder: 'e.g. Thiyagadurugam | 10 Cent Land' },
      { id: 'location', label: 'Location', type: 'text', placeholder: 'City / Area' },
      { id: 'unit_of_measure', label: 'Unit', type: 'select', options: ['Cents', 'Sq.ft', 'Acres', 'Sq.m'], required: true },
      { id: 'price_fetch_way', label: 'Price Source', type: 'select', options: ['manual', 'formula'], required: true },
    ],
    txnFields: [
      { id: 'txn_type', label: 'Type', type: 'select', options: ['Buy', 'Sell'], required: true },
      { id: 'txn_date', label: 'Date', type: 'date', required: true },
      { id: 'quantity', label: 'Area', type: 'number', step: '0.001', required: true },
      { id: 'price_per_unit', label: 'Price per Unit (₹)', type: 'number', step: '0.01', required: true },
      { id: 'registration_cost', label: 'Registration Cost (₹)', type: 'number', step: '0.01' },
      { id: 'other_expenses', label: 'Other Expenses (₹)', type: 'number', step: '0.01' },
      { id: 'notes', label: 'Notes', type: 'text' },
    ],
    manualPrice: true,
    manualPriceLabel: 'Price per unit',
  },

  // EPF: a balance (no units / prices — so it skips the P&L charts like Bank), built from its
  // passbook entries. Entries belong to an ACCOUNT (Self, …); each account has one EPF row in
  // epf_assets (name, UAN, typed balance — used until that account has entries).
  epf: {
    label: 'EPF',
    staticBalance: true,
    ledger: true,
    currentBalanceCol: 'current_balance',
    assetTable: 'epf_assets', txnTable: 'epf_transactions',
    assetIdCol: 'account_id',      // the entry's column …
    assetKeyCol: 'account_id',     // … matches this column of the EPF row (not its id)
    assetNameCol: 'account_name', amountCol: 'amount',
    assetFields: [
      { id: 'account_name',    label: 'Account Name',        type: 'text',   required: true, placeholder: 'e.g. Zoho EPF' },
      { id: 'uan',             label: 'UAN',                  type: 'text',   placeholder: '101596118819' },
      { id: 'current_balance', label: 'Balance (₹) — used until passbook entries are added', type: 'number', step: '0.01' },
    ],
    txnFields: [
      { id: 'txn_type', label: 'Type', type: 'select', options: ['Contribution', 'Interest', 'Withdrawal'], required: true },
      { id: 'txn_date', label: 'Date', type: 'date', required: true },
      { id: 'amount',   label: 'Amount (₹) — your + employer EPF share', type: 'number', step: '0.01', required: true },
      { id: 'notes',    label: 'Notes', type: 'text' },
    ],
  },

  bank_accounts: {
    label: 'Bank Accounts',
    staticBalance: true,
    currentBalanceCol: 'current_balance',
    assetTable: 'bank_assets', txnTable: null,
    assetIdCol: 'id', assetNameCol: 'account_name',
    assetFields: [
      { id: 'account_name',    label: 'Account Name',        type: 'text',   required: true, placeholder: 'e.g. HDFC Savings' },
      { id: 'bank_name',       label: 'Bank',                 type: 'text',   required: true },
      { id: 'account_type',    label: 'Type',  type: 'select', options: ['Savings', 'Current', 'FD', 'RD'], required: true },
      { id: 'current_balance', label: 'Current Balance (₹)', type: 'number', step: '0.01', required: true },
    ],
  },

};

// A sheet date as the calendar day 'yyyy-mm-dd'. The server sends days; older cached data has
// UTC instants ('2026-10-31T18:30:00.000Z' = 1 Nov IST) — read those in local time, never cut them.
function localYMD(v) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(v);
  if (isNaN(d)) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// …and as a local Date at midnight of that day (safe for display / day arithmetic in any timezone).
function localDate(v) {
  const s = localYMD(v);
  return s ? new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) : null;
}

// A transaction's day as a local Date (Invalid Date when missing) — use this, not new Date(),
// so day strings ('yyyy-mm-dd' = UTC midnight) compare correctly with local month-ends.
function txnDay(v) {
  return localDate(v) || new Date(NaN);
}

// The value a transaction's assetIdCol holds for this asset: its id, or (EPF) its account_id.
function assetKey(stream, asset) {
  return String(asset[stream.assetKeyCol || 'id']);
}

// Invested / value of a balance-type asset (EPF, Bank). A ledger stream (EPF) sums its entries —
// value = contributions + interest − withdrawals, invested = contributions − withdrawals (never
// below 0) — same rule as gas/snapshot.gs. Only an account with no entries at all (in allTxns, the
// unfiltered list) falls back to its typed current balance, as Bank always does.
function staticBalanceOf(stream, asset, txns, allTxns) {
  const key = assetKey(stream, asset);
  const mine = list => (list || []).filter(t => String(t[stream.assetIdCol]) === key);
  if (!stream.ledger || !mine(allTxns || txns).length) {
    const b = parseFloat(asset[stream.currentBalanceCol] || 0) || 0;
    return { invested: b, value: b };
  }
  let c = 0, i = 0, w = 0;
  mine(txns).forEach(t => {
    const amt = parseFloat(t.amount || 0) || 0;
    if (t.txn_type === 'Contribution') c += amt;
    else if (t.txn_type === 'Withdrawal') w += amt;
    else if (t.txn_type === 'Interest') i += amt;
  });
  return { invested: Math.max(0, c - w), value: c + i - w };
}

// ── Scope / mandate / benchmark helpers ───────────────────────────────────────

function isInFundScope(categoryId, assetTable) {
  return FUND_SCOPE.includes(Number(categoryId)) && !FUND_EXCLUDED_TABLES.includes(String(assetTable || ''));
}

function sleeveOf(categoryId) {
  return SLEEVES.find(s => s.cats.includes(Number(categoryId))) || null;
}

// Benchmark key for a holding (null = no rule matches, or one says it has none).
function benchmarkFor(categoryId, name) {
  const rule = BENCHMARK_MAP.find(r => r.cats.includes(Number(categoryId)) && r.match.test(String(name || '')));
  return rule ? rule.bench : null;
}

// MANDATE renormalised: sleeve % of the fund (sums to 100) and, per holding target, % of its
// sleeve and % of the fund.
function computeMandateWeights(mandate = MANDATE) {
  const sum = vals => vals.reduce((s, v) => s + v, 0);
  const sleeveTotal = sum(Object.values(mandate.sleeves));
  const sleeves = {};
  Object.keys(mandate.sleeves).forEach(k => { sleeves[k] = sleeveTotal > 0 ? mandate.sleeves[k] / sleeveTotal * 100 : 0; });
  const holdings = [];
  Object.keys(mandate.holdings || {}).forEach(k => {
    const list = mandate.holdings[k];
    const total = sum(list.map(h => h.weight));
    list.forEach(h => {
      const ofSleeve = total > 0 ? h.weight / total * 100 : 0;
      holdings.push({ sleeve: k, label: h.label, match: h.match, ofSleeve, ofFund: ofSleeve * (sleeves[k] || 0) / 100 });
    });
  });
  return { sleeves, holdings };
}

// Resolve stream for a category + subcategory
function resolveStream(category, subcategoryName) {
  const streamKey = category.stream;
  if (streamKey === 'precious_metals') {
    return subcategoryName === 'Digital' ? STREAMS.precious_metals_digital : STREAMS.precious_metals_physical;
  }
  return STREAMS[streamKey];
}

// Validate a transaction form row — returns array of error strings
function validateTxn(fields, values) {
  const errors = [];
  const tomorrow = localYMD(new Date(Date.now() + 86400000));
  fields.forEach(f => {
    const v = values[f.id];
    if (f.required && (v === undefined || v === '')) {
      errors.push(`${f.label} is required`);
      return;
    }
    if (v === undefined || v === '') return;
    if (f.type === 'number') {
      const n = parseFloat(v);
      if (isNaN(n)) errors.push(`${f.label} must be a number`);
      else if (n < 0) errors.push(`${f.label} can't be negative`);
      else if (n === 0 && (f.id === 'units' || f.id === 'quantity')) errors.push(`${f.label} must be more than 0`);   // a price / amount of 0 is fine (bonus shares)
    }
    if (f.type === 'date' && String(v) > tomorrow) errors.push(`${f.label} is in the future`);
  });
  return errors;
}

// Compute auto-calculated fields from field definitions
function computeFields(fields, values) {
  const result = { ...values };
  fields.forEach(f => {
    if (!f.computed) return;
    try {
      // Replace field ids with their numeric values
      let expr = f.computed;
      fields.forEach(other => {
        const val = parseFloat(result[other.id]) || 0;
        expr = expr.replaceAll(other.id, val);
      });
      result[f.id] = eval(expr);
    } catch (_) {}
  });
  return result;
}
