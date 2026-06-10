// VaultZero — Stream definitions, field configs, validation rules

const BUCKETS = [
  { id: 1, name: 'Wealth Builder', icon: '📈', color: '#4f46e5' },
  { id: 2, name: 'Safety Net', icon: '🛡️', color: '#0891b2' },
  { id: 3, name: 'Hedge & Opportunities', icon: '⚡', color: '#d97706' },
];

const SUBCAT_NAMES = {
  1: 'Large Cap', 2: 'Mid Cap', 3: 'Small Cap', 4: 'Flexi Cap',
  5: 'ELSS', 6: 'Index', 7: 'Sectoral',
  8: 'Liquid', 9: 'Overnight', 10: 'Ultra Short Term', 11: 'Money Market',
  12: 'Short Duration', 13: 'Medium Duration', 14: 'Dynamic Bond',
  15: 'Arbitrage', 16: 'Credit Risk', 17: 'Balanced Advantage',
  18: 'Conservative Hybrid', 19: 'Equity Savings',
  20: 'Digital', 21: 'Physical',
};

// Categories keyed by bucket_id
// hasSubcategories: true = show subcategory drill-down in History
const CATEGORIES = [
  { id: 1, bucket_id: 1, name: 'Indian EQ Mutual Fund', stream: 'equity_mf', hasSubcategories: true },
  { id: 2, bucket_id: 1, name: 'Indian Equity Stocks', stream: 'indian_stocks', hasSubcategories: true },
  { id: 3, bucket_id: 1, name: 'US Equity Stocks', stream: 'us_stocks', hasSubcategories: true },
  { id: 4, bucket_id: 1, name: 'Real Estate', stream: 'real_estate', hasSubcategories: true },
  { id: 5, bucket_id: 2, name: 'Debt & Hybrid Mutual Fund', stream: 'debt_hybrid_mf', hasSubcategories: true },
  { id: 6, bucket_id: 3, name: 'Precious Metals', stream: 'precious_metals', hasSubcategories: true },
  { id: 7, bucket_id: 3, name: 'Cryptocurrency', stream: 'crypto', hasSubcategories: true },
  { id: 8, bucket_id: 1, name: 'Indian EQ MF — SIP',    stream: 'equity_sip',      hasSubcategories: false },
  { id: 9, bucket_id: 2, name: 'Debt & Hybrid MF — SIP', stream: 'debt_hybrid_sip', hasSubcategories: false },
  { id: 10, bucket_id: 2, name: 'EPF',           stream: 'epf',           hasSubcategories: false },
  { id: 11, bucket_id: 2, name: 'Bank Accounts',  stream: 'bank_accounts', hasSubcategories: false },
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
    goalTable: 'debt_goals',
    goalIdCol: 'goal_id',
    goalSubcategories: ['Commitment Fund', 'Yearly Bills'],
    cycleSubcategories: ['Yearly Bills'],
    cycleTable: 'bill_cycles',
    assetFields: [
      { id: 'subcategory_id', label: 'Subcategory', type: 'subcategory', required: true },
      { id: 'fund_name', label: 'Fund Name', type: 'text', required: true, placeholder: 'e.g. ICICI Pru Ultra Short Term' },
      { id: 'fund_house', label: 'Fund House', type: 'text', required: true },
      { id: 'code', label: 'Price Fetch Code', type: 'text', required: true },
      { id: 'purpose', label: 'Purpose', type: 'text', placeholder: 'e.g. Yearly Bills, Emergency' },
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

  us_stocks: {
    label: 'US Equity Stocks',
    currentPriceCol: 'current_price',
    amountCol: 'amount_inr',
    assetTable: 'us_equity_stocks_assets',
    txnTable: 'us_equity_stocks_transactions',
    assetIdCol: 'asset_id',
    assetNameCol: 'company_name',
    assetFields: [
      { id: 'subcategory_id', label: 'Subcategory', type: 'subcategory', required: true },
      { id: 'company_name', label: 'Company Name', type: 'text', required: true, placeholder: 'e.g. Alphabet Inc Class A' },
      { id: 'ticker', label: 'Ticker / Code', type: 'text', required: true, placeholder: 'e.g. GOOGL' },
      { id: 'strategy', label: 'Strategy', type: 'select', options: ['Long Term', 'Dividend', 'Short Term'], required: true },
    ],
    txnFields: [
      { id: 'txn_type', label: 'Type', type: 'select', options: ['Buy', 'Sell'], required: true },
      { id: 'txn_date', label: 'Date', type: 'date', required: true },
      { id: 'quantity', label: 'Shares', type: 'number', step: '0.00000001', required: true },
      { id: 'price_per_share_usd', label: 'Price per Share (USD)', type: 'number', step: '0.0001', required: true, triggers: 'amount_usd' },
      { id: 'amount_usd', label: 'Amount (USD)', type: 'number', step: '0.01', required: true, computed: 'quantity*price_per_share_usd' },
      { id: 'amount_inr', label: 'Amount (₹)', type: 'number', step: '0.01', required: true, triggers: 'conv_rate' },
      { id: 'conv_rate', label: 'Conv. Rate (auto)', type: 'number', step: '0.0001', readonly: true, computed: 'amount_inr/amount_usd' },
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

  equity_sip: {
    label: 'Indian EQ MF SIP',
    isSIPStream: true,
    currentPriceCol: 'current_nav',
    amountCol: 'amount',
    assetTable: 'equity_funds',
    assetIdCol: 'fund_id',
    assetNameCol: 'fund_name',
    sipBudgetTable: 'equity_sip_budget',
    sipEventsTable: 'equity_sip_events',
    sipReasonsTable: 'equity_sip_reasons',
    txnFields: [
      { id: 'txn_type', label: 'Type', type: 'select', options: ['SIP', 'SWP'], required: true },
      { id: 'txn_date', label: 'Date', type: 'date', required: true },
      { id: 'amount', label: 'Amount (₹)', type: 'number', step: '0.01', required: true },
      { id: 'nav', label: 'NAV (₹)', type: 'number', step: '0.0001', required: true, triggers: 'units' },
      { id: 'units', label: 'Units', type: 'number', step: '0.000001', required: true, computed: 'amount/nav' },
      { id: 'notes', label: 'Notes', type: 'text' },
    ],
    sipEventFields: [
      { id: 'fund_id', label: 'Fund', type: 'fund-select', required: true },
      { id: 'event_type', label: 'Type', type: 'select',
        options: ['Monthly SIP', 'Rebalance SIP', 'Rebalance SWP', 'Redeem SWP', 'STOP'],
        required: true },
      { id: 'amount', label: 'Amount (₹/month)', type: 'number', step: '0.01', required: true },
      { id: 'sip_date', label: 'SIP Day of Month (1–28)', type: 'number', step: '1', placeholder: '5' },
      { id: 'effective_date', label: 'Effective Date', type: 'date', required: true },
      { id: 'reason', label: 'Reason', type: 'select', options: ['Regular', 'Rebalance', 'Redeem'], required: true },
    ],
  },

  debt_hybrid_sip: {
    label: 'Debt & Hybrid MF SIP',
    isSIPStream: true,
    currentPriceCol: 'current_nav',
    amountCol: 'amount',
    assetTable: 'debt_hybrid_funds',
    assetIdCol: 'fund_id',
    assetNameCol: 'fund_name',
    sipBudgetTable: 'debt_sip_budget',
    sipEventsTable: 'debt_sip_events',
    sipReasonsTable: 'debt_sip_reasons',
    txnFields: [
      { id: 'txn_type', label: 'Type', type: 'select', options: ['SIP', 'SWP'], required: true },
      { id: 'txn_date', label: 'Date', type: 'date', required: true },
      { id: 'amount', label: 'Amount (₹)', type: 'number', step: '0.01', required: true },
      { id: 'nav', label: 'NAV (₹)', type: 'number', step: '0.0001', required: true, triggers: 'units' },
      { id: 'units', label: 'Units', type: 'number', step: '0.000001', required: true, computed: 'amount/nav' },
      { id: 'notes', label: 'Notes', type: 'text' },
    ],
    sipEventFields: [
      { id: 'fund_id', label: 'Fund', type: 'fund-select', required: true },
      { id: 'event_type', label: 'Type', type: 'select',
        options: ['Monthly SIP', 'Rebalance SIP', 'Rebalance SWP', 'Redeem SWP', 'STOP'],
        required: true },
      { id: 'amount', label: 'Amount (₹/month)', type: 'number', step: '0.01', required: true },
      { id: 'sip_date', label: 'SIP Day of Month (1–28)', type: 'number', step: '1', placeholder: '5' },
      { id: 'effective_date', label: 'Effective Date', type: 'date', required: true },
      { id: 'reason', label: 'Reason', type: 'select', options: ['Regular', 'Rebalance', 'Redeem'], required: true },
    ],
  },

  epf: {
    label: 'EPF',
    staticBalance: true,
    currentBalanceCol: 'current_balance',
    assetTable: 'epf_assets', txnTable: null,
    assetIdCol: 'id', assetNameCol: 'account_name',
    assetFields: [
      { id: 'account_name',    label: 'Account Name',        type: 'text',   required: true, placeholder: 'e.g. Zoho EPF' },
      { id: 'uan',             label: 'UAN',                  type: 'text',   placeholder: '101596118819' },
      { id: 'current_balance', label: 'Current Balance (₹)',  type: 'number', step: '0.01', required: true },
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
  fields.forEach(f => {
    if (f.required && (values[f.id] === undefined || values[f.id] === '')) {
      errors.push(`${f.label} is required`);
    }
    if (f.type === 'number' && values[f.id] !== '' && isNaN(parseFloat(values[f.id]))) {
      errors.push(`${f.label} must be a number`);
    }
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
