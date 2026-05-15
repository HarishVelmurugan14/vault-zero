const STREAMS = [
  {
    id: 'equity_mf',
    label: 'Equity MF',
    icon: '📈',
    color: '#4f46e5',
    txnTypes: ['Buy', 'Sell', 'SIP', 'Switch In', 'Switch Out', 'Redemption'],
    fields: [
      { id: 'asset_name', label: 'Fund Name', type: 'text', required: true, placeholder: 'e.g. PPFAS Flexi Cap' },
      { id: 'folio_number', label: 'Folio Number', type: 'text', placeholder: 'Optional' },
      { id: 'units', label: 'Units', type: 'number', step: '0.001', required: true },
      { id: 'nav', label: 'NAV (₹)', type: 'number', step: '0.01', required: true },
      { id: 'amount_inr', label: 'Amount (₹)', type: 'number', step: '1', required: true, computed: true },
    ]
  },
  {
    id: 'debt_mf',
    label: 'Debt MF',
    icon: '🏦',
    color: '#0891b2',
    txnTypes: ['Buy', 'Sell', 'SIP', 'Switch In', 'Switch Out', 'Redemption'],
    fields: [
      { id: 'asset_name', label: 'Fund Name', type: 'text', required: true, placeholder: 'e.g. HDFC Short Term Debt' },
      { id: 'folio_number', label: 'Folio Number', type: 'text', placeholder: 'Optional' },
      { id: 'units', label: 'Units', type: 'number', step: '0.001', required: true },
      { id: 'nav', label: 'NAV (₹)', type: 'number', step: '0.01', required: true },
      { id: 'amount_inr', label: 'Amount (₹)', type: 'number', step: '1', required: true, computed: true },
    ]
  },
  {
    id: 'hybrid_mf',
    label: 'Hybrid MF',
    icon: '⚖️',
    color: '#7c3aed',
    txnTypes: ['Buy', 'Sell', 'SIP', 'Switch In', 'Switch Out', 'Redemption'],
    fields: [
      { id: 'asset_name', label: 'Fund Name', type: 'text', required: true, placeholder: 'e.g. ICICI Balanced Advantage' },
      { id: 'folio_number', label: 'Folio Number', type: 'text', placeholder: 'Optional' },
      { id: 'units', label: 'Units', type: 'number', step: '0.001', required: true },
      { id: 'nav', label: 'NAV (₹)', type: 'number', step: '0.01', required: true },
      { id: 'amount_inr', label: 'Amount (₹)', type: 'number', step: '1', required: true, computed: true },
    ]
  },
  {
    id: 'etf',
    label: 'ETF',
    icon: '📊',
    color: '#059669',
    txnTypes: ['Buy', 'Sell'],
    fields: [
      { id: 'asset_name', label: 'ETF Name', type: 'text', required: true, placeholder: 'e.g. Nifty 50 ETF' },
      { id: 'platform', label: 'Exchange', type: 'select', options: ['NSE', 'BSE'], required: true },
      { id: 'units', label: 'Units', type: 'number', step: '1', required: true },
      { id: 'price_per_unit', label: 'Price per Unit (₹)', type: 'number', step: '0.01', required: true },
      { id: 'amount_inr', label: 'Total Amount (₹)', type: 'number', step: '1', required: true, computed: true },
    ]
  },
  {
    id: 'fd',
    label: 'Fixed Deposit',
    icon: '🏛️',
    color: '#d97706',
    txnTypes: ['Open', 'Matured', 'Premature Closure', 'Interest Credit'],
    fields: [
      { id: 'asset_name', label: 'Bank / Institution', type: 'text', required: true, placeholder: 'e.g. SBI, HDFC' },
      { id: 'amount_inr', label: 'Principal Amount (₹)', type: 'number', step: '1', required: true },
      { id: 'interest_rate', label: 'Interest Rate (%)', type: 'number', step: '0.01', required: true },
      { id: 'maturity_date', label: 'Maturity Date', type: 'date' },
      { id: 'maturity_amount', label: 'Maturity Amount (₹)', type: 'number', step: '1', placeholder: 'Optional' },
    ]
  },
  {
    id: 'physical_gold',
    label: 'Physical Gold',
    icon: '🥇',
    color: '#b45309',
    txnTypes: ['Buy', 'Sell'],
    fields: [
      { id: 'asset_name', label: 'Form', type: 'select', options: ['Coin', 'Bar', 'Jewellery', 'Sovereign Gold Bond'], required: true },
      { id: 'purity', label: 'Purity', type: 'select', options: ['24K / 999', '22K / 916', '18K / 750', 'SGB'] },
      { id: 'weight_grams', label: 'Weight (grams)', type: 'number', step: '0.001', required: true },
      { id: 'price_per_gram', label: 'Price per Gram (₹)', type: 'number', step: '0.01', required: true },
      { id: 'amount_inr', label: 'Total Amount (₹)', type: 'number', step: '1', required: true, computed: true },
    ]
  },
  {
    id: 'real_estate',
    label: 'Real Estate',
    icon: '🏠',
    color: '#dc2626',
    txnTypes: ['Purchase', 'Sale', 'EMI Payment', 'Rental Income', 'Maintenance', 'Registration Cost'],
    fields: [
      { id: 'asset_name', label: 'Property Name / ID', type: 'text', required: true, placeholder: 'e.g. Flat 3B, Chennai' },
      { id: 'location', label: 'Location', type: 'text', placeholder: 'City / Area' },
      { id: 'area_sqft', label: 'Area (sq.ft)', type: 'number', step: '1', placeholder: 'Optional' },
      { id: 'amount_inr', label: 'Amount (₹)', type: 'number', step: '1', required: true },
    ]
  },
  {
    id: 'crypto',
    label: 'Crypto',
    icon: '₿',
    color: '#f59e0b',
    txnTypes: ['Buy', 'Sell', 'Transfer In', 'Transfer Out', 'Staking Reward'],
    fields: [
      { id: 'asset_name', label: 'Coin / Token', type: 'text', required: true, placeholder: 'e.g. BTC, ETH, SOL' },
      { id: 'platform', label: 'Exchange', type: 'select', options: ['WazirX', 'CoinDCX', 'Binance', 'Coinbase', 'Kraken', 'Other'] },
      { id: 'units', label: 'Quantity', type: 'number', step: '0.00000001', required: true },
      { id: 'price_per_unit', label: 'Price per Unit (₹)', type: 'number', step: '0.01', required: true },
      { id: 'amount_inr', label: 'Total Amount (₹)', type: 'number', step: '1', required: true, computed: true },
    ]
  },
  {
    id: 'international',
    label: 'International',
    icon: '🌐',
    color: '#0ea5e9',
    txnTypes: ['Buy', 'Sell', 'Dividend'],
    fields: [
      { id: 'asset_name', label: 'Stock / Fund Name', type: 'text', required: true, placeholder: 'e.g. Apple, S&P 500 ETF' },
      { id: 'platform', label: 'Platform', type: 'select', options: ['Vested', 'INDmoney', 'HDFC Securities', 'ICICI Direct', 'Other'] },
      { id: 'units', label: 'Units / Shares', type: 'number', step: '0.001', required: true },
      { id: 'price_per_unit', label: 'Price per Unit (USD)', type: 'number', step: '0.01', required: true },
      { id: 'exchange_rate', label: 'USD/INR Rate', type: 'number', step: '0.01', required: true, placeholder: 'e.g. 83.5' },
      { id: 'amount_inr', label: 'Total Amount (₹)', type: 'number', step: '1', required: true, computed: true },
    ]
  },
];
