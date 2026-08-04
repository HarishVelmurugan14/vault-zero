// VaultZero — Insights & Analytics

// ── XIRR (Newton-Raphson) ─────────────────────────────────────────────────────

function computeXIRR(cashflows) {
  if (!cashflows || cashflows.length < 2) return null;
  const sorted = [...cashflows].sort((a, b) => a.date - b.date);
  const t0 = sorted[0].date;
  let rate = 0.1;
  for (let iter = 0; iter < 200; iter++) {
    let f = 0, df = 0;
    for (const cf of sorted) {
      const t = (cf.date - t0) / (365.25 * 86400000);
      const d = Math.pow(1 + rate, t);
      f  += cf.amount / d;
      df -= t * cf.amount / (d * (1 + rate));
    }
    if (Math.abs(df) < 1e-12) break;
    const delta = f / df;
    rate -= delta;
    if (Math.abs(delta) < 1e-7) break;
  }
  return isFinite(rate) && rate > -1 && rate < 100 ? rate : null;
}

function fmtXIRR(r) {
  return r !== null ? (r * 100).toFixed(1) + '%' : '—';
}

let _insightsCache = null;
let _insightsCharts = [];
let _manualPricesMap = {};
let _usAux = { wires: [], repats: [], income: [] };

const INSIGHT_FILTERS = {
  catNames:    [],
  subcatNames: [],
  assetKeys:   [],   // ["streamIdx|assetId", …]
  year:      '',
  fromMonth: '',   // YYYY-MM
  toMonth:   '',   // YYYY-MM
};

// ── Entry point ───────────────────────────────────────────────────────────────

async function renderInsights() {
  const container = document.getElementById('insights-content');
  const header    = document.getElementById('insights-header');

  if (header) {
    header.innerHTML = '';
    const h2 = document.createElement('h2');
    h2.textContent = 'Insights';
    const btn = document.createElement('button');
    btn.className = 'btn-outline btn-sm';
    btn.textContent = '↻ Refresh';
    btn.addEventListener('click', () => {
      _insightsCache = null;
      _manualPricesMap = {};
      LSC.clear('insights');
      resetInsightFilters();
      renderInsights();
    });
    header.appendChild(h2);
    header.appendChild(btn);
  }

  container.innerHTML = `
    <div class="insights-loading">
      <div class="spinner"></div>
      <p>Crunching your portfolio…</p>
    </div>`;

  try {
    if (!_insightsCache) _insightsCache = await fetchAllInsightsData();
    _insightsCharts.forEach(c => { try { c.destroy(); } catch (_) {} });
    _insightsCharts = [];
    renderInsightsPage(container, _insightsCache);
  } catch (err) {
    container.innerHTML = `<div class="insights-empty">Failed to load: ${err.message}</div>`;
  }
}

// ── Page layout ───────────────────────────────────────────────────────────────

function renderInsightsPage(container, rawData) {
  container.innerHTML = '';

  // Filter bar area
  const filterArea = document.createElement('div');
  filterArea.id = 'insights-filter-area';
  container.appendChild(filterArea);

  // Charts area
  const chartsArea = document.createElement('div');
  chartsArea.id = 'insights-charts-area';
  container.appendChild(chartsArea);

  buildFilterBar(filterArea, rawData, chartsArea);
  drawCharts(chartsArea, rawData);
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function resetInsightFilters() {
  INSIGHT_FILTERS.catNames    = [];
  INSIGHT_FILTERS.subcatNames = [];
  INSIGHT_FILTERS.assetKeys   = [];
  INSIGHT_FILTERS.year        = '';
  INSIGHT_FILTERS.fromMonth   = '';
  INSIGHT_FILTERS.toMonth     = '';
}

function buildFilterBar(filterArea, rawData, chartsArea) {
  filterArea.innerHTML = '';

  const bar = document.createElement('div');
  bar.className = 'insights-filter-bar';

  // Wrap a multi-select in a labeled filter group
  const msGroup = (label, ms) => {
    const group = document.createElement('div');
    group.className = 'insights-filter-group';
    const lbl = document.createElement('div');
    lbl.className = 'insights-filter-label';
    lbl.textContent = label;
    group.appendChild(lbl);
    group.appendChild(ms.wrapper);
    return group;
  };

  // Option builders (cascade off the current selections)
  const catOptions = [...new Set(rawData.map(e => e.catName))].map(c => ({ value: c, label: c }));
  const subcatOptions = () => {
    const cats = INSIGHT_FILTERS.catNames;
    const set = new Set();
    rawData.forEach(e => {
      if (cats.length && !cats.includes(e.catName)) return;
      e.assets.forEach(a => { const s = SUBCAT_NAMES[a.subcategory_id]; if (s) set.add(s); });
    });
    return [...set].sort().map(s => ({ value: s, label: s }));
  };
  const assetOptions = () => {
    const cats = INSIGHT_FILTERS.catNames, subs = INSIGHT_FILTERS.subcatNames;
    const seen = new Set(), opts = [];
    rawData.forEach((e, idx) => {
      if (cats.length && !cats.includes(e.catName)) return;
      e.assets.forEach(a => {
        if (subs.length && !subs.includes(SUBCAT_NAMES[a.subcategory_id] || '')) return;
        const name = a[e.stream.assetNameCol] || '';
        if (!name || seen.has(name)) return;
        seen.add(name);
        opts.push({ value: `${idx}|${a.id}`, label: name });
      });
    });
    return opts;
  };

  const catMS = makeMultiSelect('All Categories', catOptions, () => {
    INSIGHT_FILTERS.catNames = catMS.getSelected();
    INSIGHT_FILTERS.subcatNames = [];
    INSIGHT_FILTERS.assetKeys   = [];
    subcatMS.clear(); subcatMS.setOptions(subcatOptions());
    assetMS.clear();  assetMS.setOptions(assetOptions());
    redrawCharts(chartsArea, rawData);
  });
  const subcatMS = makeMultiSelect('All Subcategories', subcatOptions(), () => {
    INSIGHT_FILTERS.subcatNames = subcatMS.getSelected();
    INSIGHT_FILTERS.assetKeys   = [];
    assetMS.clear(); assetMS.setOptions(assetOptions());
    redrawCharts(chartsArea, rawData);
  });
  const assetMS = makeMultiSelect('All Assets', assetOptions(), () => {
    INSIGHT_FILTERS.assetKeys = assetMS.getSelected();
    redrawCharts(chartsArea, rawData);
  });

  // ── Year
  const yearSel = makeFilterGroup('Year', 'iyear');
  yearSel.select.innerHTML = '<option value="">All Years</option>';
  getAllYears(rawData).forEach(y => {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    if (INSIGHT_FILTERS.year === y) o.selected = true;
    yearSel.select.appendChild(o);
  });

  const fromGroup = makeMonthGroup('From', 'ifrom', INSIGHT_FILTERS.fromMonth);
  const toGroup   = makeMonthGroup('To', 'ito', INSIGHT_FILTERS.toMonth);

  // ── Clear
  const clearWrap = document.createElement('div');
  clearWrap.className = 'insights-filter-group';
  const clearSpacer = document.createElement('div');
  clearSpacer.className = 'insights-filter-label';
  clearSpacer.innerHTML = '&nbsp;';
  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn-secondary btn-sm insights-clear-btn';
  clearBtn.textContent = '✕ Clear';
  clearBtn.addEventListener('click', () => {
    resetInsightFilters();
    buildFilterBar(filterArea, rawData, chartsArea);
    redrawCharts(chartsArea, rawData);
  });
  clearWrap.appendChild(clearSpacer);
  clearWrap.appendChild(clearBtn);

  bar.appendChild(msGroup('Category', catMS));
  bar.appendChild(msGroup('Subcategory', subcatMS));
  bar.appendChild(msGroup('Asset', assetMS));
  bar.appendChild(yearSel.group);
  bar.appendChild(fromGroup);
  bar.appendChild(toGroup);
  bar.appendChild(clearWrap);
  filterArea.appendChild(bar);

  // ── Wire year / month events ─────────────────────────────
  yearSel.select.addEventListener('change', () => {
    const y = yearSel.select.value;
    INSIGHT_FILTERS.year = y;
    if (y) {
      INSIGHT_FILTERS.fromMonth = `${y}-01`;
      INSIGHT_FILTERS.toMonth   = `${y}-12`;
      fromGroup.querySelector('input').value = INSIGHT_FILTERS.fromMonth;
      toGroup.querySelector('input').value   = INSIGHT_FILTERS.toMonth;
    } else {
      INSIGHT_FILTERS.fromMonth = '';
      INSIGHT_FILTERS.toMonth   = '';
      fromGroup.querySelector('input').value = '';
      toGroup.querySelector('input').value   = '';
    }
    redrawCharts(chartsArea, rawData);
  });

  fromGroup.querySelector('input').addEventListener('change', e => {
    INSIGHT_FILTERS.fromMonth = e.target.value;
    INSIGHT_FILTERS.year = '';
    yearSel.select.value = '';
    redrawCharts(chartsArea, rawData);
  });

  toGroup.querySelector('input').addEventListener('change', e => {
    INSIGHT_FILTERS.toMonth = e.target.value;
    INSIGHT_FILTERS.year = '';
    yearSel.select.value = '';
    redrawCharts(chartsArea, rawData);
  });
}

function makeFilterGroup(label, id) {
  const group = document.createElement('div');
  group.className = 'insights-filter-group';
  const lbl = document.createElement('div');
  lbl.className = 'insights-filter-label';
  lbl.textContent = label;
  const select = document.createElement('select');
  select.id = id;
  select.className = 'holdings-filter-select';
  group.appendChild(lbl);
  group.appendChild(select);
  return { group, select };
}

function makeMonthGroup(label, id, val) {
  const group = document.createElement('div');
  group.className = 'insights-filter-group';
  const lbl = document.createElement('div');
  lbl.className = 'insights-filter-label';
  lbl.textContent = label;
  const input = document.createElement('input');
  input.type = 'month';
  input.id = id;
  input.className = 'holdings-filter-select insights-month-input';
  if (val) input.value = val;
  group.appendChild(lbl);
  group.appendChild(input);
  return group;
}

function getAllYears(rawData) {
  const years = new Set();
  rawData.forEach(entry => {
    entry.txns.forEach(t => {
      const y = (t.txn_date || '').substring(0, 4);
      if (y) years.add(y);
    });
  });
  return [...years].sort();
}

// ── Filter application ────────────────────────────────────────────────────────

function applyFilters(rawData) {
  const { catNames, subcatNames, assetKeys, fromMonth, toMonth } = INSIGHT_FILTERS;

  // Parse assetKeys → entryIdx → Set(assetId)
  const assetByEntry = {};
  assetKeys.forEach(k => {
    const [i, id] = k.split('|');
    (assetByEntry[i] = assetByEntry[i] || new Set()).add(id);
  });
  const hasAssetFilter = assetKeys.length > 0;

  return rawData
    .map((entry, idx) => {
      // Hidden category — excluded everywhere
      if (HIDDEN.isCat(entry.catId)) return null;

      // Category filter (multi)
      if (catNames.length && !catNames.includes(entry.catName)) return null;

      // Asset filter restricts to entries whose assets were picked
      if (hasAssetFilter && !(String(idx) in assetByEntry)) return null;

      // Filter assets — by account, then drop hidden assets / hidden subcategories
      let assets = entry.assets.filter(a =>
        ACCOUNTS.matches(a.account_id) &&
        !HIDDEN.isAsset(entry.stream.assetTable, a.id) && !HIDDEN.isSub(a.subcategory_id));
      if (subcatNames.length) {
        assets = assets.filter(a => subcatNames.includes(SUBCAT_NAMES[a.subcategory_id] || ''));
      }
      if (hasAssetFilter) {
        const ids = assetByEntry[String(idx)];
        assets = assets.filter(a => ids.has(String(a.id)));
      }
      // US equity can carry cash (from a wire) before any asset exists — keep it.
      if (!assets.length && !entry.stream.usEquity) return null;

      const allowedAssetIds = new Set(assets.map(a => String(a.id)));

      // Filter transactions
      const txns = entry.txns.filter(t => {
        const aid = String(t[entry.stream.assetIdCol]);
        if (!allowedAssetIds.has(aid)) return false;
        const m = (t.txn_date || '').substring(0, 7);
        if (fromMonth && m && m < fromMonth) return false;
        if (toMonth && m && m > toMonth) return false;
        return true;
      });

      return { ...entry, assets, txns };
    })
    .filter(Boolean);
}

// ── Chart redraw ──────────────────────────────────────────────────────────────

function redrawCharts(chartsArea, rawData) {
  _insightsCharts.forEach(c => { try { c.destroy(); } catch (_) {} });
  _insightsCharts = [];
  drawCharts(chartsArea, rawData);
}


function makeReportCard(title, divId, fullWidth = false) {
  const card = document.createElement('div');
  card.className = 'chart-card' + (fullWidth ? ' chart-card-full' : '');
  card.innerHTML = `
    <div class="chart-card-title">${title}</div>
    <div id="${divId}"></div>
  `;
  return card;
}

const INSIGHT_TABS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'allocation',  label: 'Allocation' },
  { id: 'performance', label: 'Performance' },
  { id: 'funds',       label: 'Funds' },
  { id: 'risk',        label: 'Risk' },
  { id: 'tax',         label: 'Tax' },
];
let _insightsActiveTab = 'overview';

function drawCharts(chartsArea, rawData) {
  const filtered = applyFilters(rawData);
  const agg = aggregateInsights(filtered);

  chartsArea.innerHTML = '';
  if (typeof Chart !== 'undefined') {
    Chart.defaults.color = '#525252';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';
    Chart.defaults.font.family = "Inter, -apple-system, BlinkMacSystemFont, sans-serif";
    Chart.defaults.font.size = 11;
  }

  chartsArea.appendChild(buildPortfolioHero(agg));
  chartsArea.appendChild(buildMetricStrip(agg));

  // Secondary nav (sub-tabs)
  const nav = document.createElement('div');
  nav.className = 'insights-subnav';
  const tabContent = document.createElement('div');
  tabContent.id = 'insights-tab-content';

  INSIGHT_TABS.forEach(t => {
    const b = document.createElement('button');
    b.className = 'insights-subnav-tab' + (t.id === _insightsActiveTab ? ' active' : '');
    b.textContent = t.label;
    b.addEventListener('click', () => {
      if (_insightsActiveTab === t.id) return;
      _insightsActiveTab = t.id;
      nav.querySelectorAll('.insights-subnav-tab').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderInsightsTab(tabContent, agg, filtered, rawData);
    });
    nav.appendChild(b);
  });

  chartsArea.appendChild(nav);
  chartsArea.appendChild(tabContent);
  renderInsightsTab(tabContent, agg, filtered, rawData);
}

function enhanceReportTables(container) {
  container.querySelectorAll('.report-table').forEach(t => {
    if (t.closest('#report-stream-table')) return;   // has its own sort
    makeTableSortable(t);
  });
}

function renderInsightsTab(container, agg, filtered, rawData) {
  _insightsCharts.forEach(c => { try { c.destroy(); } catch (_) {} });
  _insightsCharts = [];
  container.innerHTML = '';

  const row2 = () => { const d = document.createElement('div'); d.className = 'insights-grid-2'; return d; };
  const tab  = _insightsActiveTab;

  if (tab === 'overview') {
    container.appendChild(buildHealthCheck(agg, filtered, rawData));
    container.appendChild(makeChartCard('Portfolio Growth', 'chart-cumulative', true));
    const r = row2();
    r.appendChild(makeChartCard('Portfolio by Bucket', 'chart-bucket'));
    r.appendChild(makeChartCard('Portfolio by Category', 'chart-category'));
    container.appendChild(r);
    requestAnimationFrame(() => {
      drawCumulativeChart(agg.allMonthlyNet, agg.totalCurrentValue);
      drawBucketChart(agg.byBucket);
      drawCategoryChart(agg.byCategory);
    });

  } else if (tab === 'allocation') {
    const r1 = row2();
    r1.appendChild(makeChartCard('Portfolio by Subcategory', 'chart-subcat'));
    r1.appendChild(makeChartCard('Allocation by Current Value', 'chart-alloc-cv'));
    container.appendChild(r1);
    container.appendChild(makeReportCard('Core vs Satellite', 'report-core-sat', true));
    container.appendChild(makeReportCard('Composition by Category', 'report-comp-cat', true));
    container.appendChild(makeReportCard('Subcategory Composition (within category)', 'report-comp-subcat', true));
    const r2 = row2();
    r2.appendChild(makeChartCard('Currency Exposure', 'chart-currency'));
    r2.appendChild(makeChartCard('Equity Cap Split (Actual vs Target)', 'chart-capsplit'));
    container.appendChild(r2);
    requestAnimationFrame(() => {
      drawSubcatChart(agg.bySubcat);
      drawAllocCvChart(agg.byCategory);
      drawCoreSatellite('report-core-sat', agg);
      drawCategoryComposition('report-comp-cat', agg);
      drawSubcatComposition('report-comp-subcat', agg);
      drawCurrencyChart('chart-currency', agg.byCategory);
      drawCapSplitChart('chart-capsplit', agg.bySubcat);
      enhanceReportTables(container);
    });

  } else if (tab === 'performance') {
    container.appendChild(makeReportCard('Stream-wise P&L', 'report-stream-table', true));
    container.appendChild(makeChartCard('Rolling XIRR Trend', 'chart-xirr-trend', true));
    container.appendChild(makeChartCard('Profit by Investment Year (Vintage)', 'chart-vintage', true));
    const r = row2();
    r.appendChild(makeChartCard('Monthly Investment', 'chart-monthly'));
    r.appendChild(makeChartCard('Yearly Summary', 'chart-yearly'));
    container.appendChild(r);
    container.appendChild(makeReportCard('Monthly Contributions', 'report-monthly-table', true));
    requestAnimationFrame(() => {
      drawStreamTable('report-stream-table', agg);
      drawXirrTrend('chart-xirr-trend', filtered);
      drawVintageChart('chart-vintage', filtered);
      drawMonthlyChart(agg.byMonth);
      drawYearlyChart(agg.byYear);
      drawMonthlyTable('report-monthly-table', agg);
      enhanceReportTables(container);
    });

  } else if (tab === 'funds') {
    container.appendChild(makeReportCard('Indian EQ Mutual Funds — Per-Fund P&L (FIFO)', 'report-mf-detail', true));
    container.appendChild(makeChartCard('Realized P&L by Category', 'chart-pnl', true));
    requestAnimationFrame(() => {
      drawMFReport('report-mf-detail', rawData);
      drawPnLChart(agg.byCategory);
      enhanceReportTables(container);
    });

  } else if (tab === 'risk') {
    container.appendChild(makeReportCard('Liquidity Ladder', 'report-liquidity', true));
    container.appendChild(makeChartCard('Top 10 Holdings', 'chart-top-holdings', true));
    requestAnimationFrame(() => {
      drawLiquidityLadder('report-liquidity', agg.byCategory, agg.netInvested);
      drawTopHoldingsChart(agg.topHoldings);
    });

  } else if (tab === 'tax') {
    container.appendChild(makeReportCard('Estimated Tax Liability', 'report-tax-table', true));
    requestAnimationFrame(() => {
      drawTaxTable('report-tax-table', agg.byCategory);
      enhanceReportTables(container);
    });
  }
}

// ── Data Fetching ─────────────────────────────────────────────────────────────

const ENTRIES = [
  { catId: 1, catName: 'Indian EQ MF',              bucketId: 1, stream: STREAMS.equity_mf,               subcatName: null },
  { catId: 2, catName: 'Indian Equity Stocks',      bucketId: 1, stream: STREAMS.indian_stocks,            subcatName: null },
  { catId: 3, catName: 'US Equity (IndMoney)',           bucketId: 1, stream: STREAMS.us_stocks,                subcatName: null },
  { catId: 4, catName: 'Real Estate',                bucketId: 1, stream: STREAMS.real_estate,              subcatName: null },
  { catId: 5, catName: 'Debt & Hybrid MF',           bucketId: 2, stream: STREAMS.debt_hybrid_mf,           subcatName: null },
  { catId: 6, catName: 'Precious Metals (Digital)',  bucketId: 3, stream: STREAMS.precious_metals_digital,  subcatName: 'Digital' },
  { catId: 6, catName: 'Precious Metals (Physical)', bucketId: 3, stream: STREAMS.precious_metals_physical, subcatName: 'Physical' },
  { catId: 7, catName: 'Cryptocurrency',              bucketId: 3, stream: STREAMS.crypto,                   subcatName: null },
  { catId: 8,  catName: 'Indian EQ MF SIP',     bucketId: 1, stream: STREAMS.equity_sip,      subcatName: null },
  { catId: 9,  catName: 'Debt & Hybrid MF SIP', bucketId: 2, stream: STREAMS.debt_hybrid_sip, subcatName: null },
  { catId: 10, catName: 'EPF',                  bucketId: 2, stream: STREAMS.epf,              subcatName: null },
  { catId: 11, catName: 'Bank Accounts',         bucketId: 2, stream: STREAMS.bank_accounts,   subcatName: null },
  { catId: 12, catName: 'US Equity',             bucketId: 1, stream: STREAMS.us_equity_ibkr,  subcatName: null },
];

async function fetchAllInsightsData() {
  await HIDDEN.load();
  await ACCOUNTS.load();
  const cached = LSC.get('insights');
  if (cached) {
    _manualPricesMap = cached.manualPrices || {};
    _usAux = cached.usAux || { wires: [], repats: [], income: [] };
    return cached.entries;
  }

  let data;
  const allSheets = [...new Set(ENTRIES.flatMap(e => [e.stream.assetTable, e.stream.txnTable, ...(e.stream.auxTables || [])]).filter(Boolean)), 'manual_prices'];

  try {
    const res = await API.batchGet(allSheets);
    _manualPricesMap = buildManualPricesMap(res['manual_prices']?.rows || []);
    _usAux = { wires: res['us_wires']?.rows || [], repats: res['us_repatriations']?.rows || [], income: res['us_income']?.rows || [] };
    data = ENTRIES.map(entry => ({
      ...entry,
      assets: res[entry.stream.assetTable]?.rows || [],
      txns:   res[entry.stream.txnTable]?.rows   || [],
    }));
  } catch (_) {}

  if (!data) {
    const results = await Promise.allSettled(ENTRIES.map(async entry => {
      const [a, t] = await Promise.allSettled([
        API.get(entry.stream.assetTable, { limit: 500 }),
        API.get(entry.stream.txnTable,   { limit: 5000 }),
      ]);
      return {
        ...entry,
        assets: a.status === 'fulfilled' ? (a.value.rows || []) : [],
        txns:   t.status === 'fulfilled' ? (t.value.rows  || []) : [],
      };
    }));
    data = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    try {
      const mpRes = await API.get('manual_prices', { limit: 1000 });
      _manualPricesMap = buildManualPricesMap(mpRes.rows || []);
    } catch (_) {}
    try {
      const [w, r, inc] = await Promise.allSettled([
        API.get('us_wires', { limit: 1000 }),
        API.get('us_repatriations', { limit: 1000 }),
        API.get('us_income', { limit: 1000 }),
      ]);
      _usAux = {
        wires:  w.status   === 'fulfilled' ? (w.value.rows   || []) : [],
        repats: r.status   === 'fulfilled' ? (r.value.rows   || []) : [],
        income: inc.status === 'fulfilled' ? (inc.value.rows || []) : [],
      };
    } catch (_) {}
  }

  LSC.set('insights', { entries: data, manualPrices: _manualPricesMap, usAux: _usAux });
  return data;
}

// ── Amount helpers ────────────────────────────────────────────────────────────

function getAmtINR(stream, txn) {
  if (stream.amountCol) return parseFloat(txn[stream.amountCol] || 0);
  return parseFloat(txn.quantity || 0) * parseFloat(txn.price_per_unit || 0)
       + parseFloat(txn.registration_cost || 0)
       + parseFloat(txn.other_expenses || 0);
}

function getQtyVal(txn) {
  const u = parseFloat(txn.units);
  if (!isNaN(u) && u > 0) return u;
  return parseFloat(txn.quantity || 0);
}

// ── P&L: average cost method ──────────────────────────────────────────────────

function computeAssetMetrics(stream, txns) {
  const sorted = [...txns].sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));
  let totalCost = 0, totalQty = 0, realizedPnL = 0, totalBought = 0, totalSold = 0;

  sorted.forEach(t => {
    const amt = getAmtINR(stream, t);
    const qty = getQtyVal(t);
    if (t.txn_type === 'Buy') {
      totalCost   += amt;
      totalQty    += qty;
      totalBought += amt;
    } else if (t.txn_type === 'Sell' && totalQty > 0) {
      const avgCost  = totalCost / totalQty;
      const costSold = avgCost * Math.min(qty, totalQty);
      realizedPnL   += amt - costSold;
      totalQty       = Math.max(0, totalQty - qty);
      totalCost      = avgCost * totalQty;
      totalSold     += amt;
    }
  });

  return { netCost: totalCost, realizedPnL, totalBought, totalSold, currentQty: totalQty };
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function aggregateInsights(filteredData) {
  let totalInvested = 0, totalRedeemed = 0, totalRealizedPnL = 0;
  let totalCurrentValue = 0, totalUnrealizedPnL = 0;
  const byCategory    = {};
  const byBucket      = {};
  const bySubcat      = {};
  const byCatSubcat   = {};   // catName → { subcatName → { netCost, currentValue } }
  const byMonth       = {};
  const byYear        = {};
  const allMonthlyNet = {};
  const topHoldings   = [];
  const allCashflows  = [];

  const addCatSub = (cat, sub, nc, cv) => {
    if (!byCatSubcat[cat]) byCatSubcat[cat] = {};
    if (!byCatSubcat[cat][sub]) byCatSubcat[cat][sub] = { netCost: 0, currentValue: 0 };
    byCatSubcat[cat][sub].netCost      += nc;
    byCatSubcat[cat][sub].currentValue += cv;
  };

  filteredData.forEach(entry => {
    const { catName, bucketId, subcatName, stream, assets, txns } = entry;
    const bucket = BUCKETS.find(b => b.id === bucketId);

    if (!byCategory[catName]) byCategory[catName] = { netCost: 0, realizedPnL: 0, totalBought: 0, totalSold: 0, cashflows: [], firstBuyDate: null };
    if (!byBucket[bucketId])  byBucket[bucketId]  = { name: bucket?.name || '', netCost: 0 };

    const assetMap = {};
    assets.forEach(a => { assetMap[String(a.id)] = a; });

    // ── staticBalance streams (EPF, Bank) — read balance directly, no P&L ──
    if (stream.staticBalance) {
      assets
        .filter(a => String(a.is_active).toUpperCase() === 'TRUE')
        .forEach(a => {
          const balance = parseFloat(a[stream.currentBalanceCol] || 0);
          if (!balance) return;
          byCategory[catName].netCost      += balance;
          byCategory[catName].currentValue  = (byCategory[catName].currentValue || 0) + balance;
          byBucket[bucketId].netCost       += balance;
          byBucket[bucketId].currentValue   = (byBucket[bucketId].currentValue || 0) + balance;
          totalCurrentValue += balance;
        });
      return; // skip transaction-based logic for this stream
    }

    // ── US Equity (IBKR) — INR cost basis from wires; current value via INR price ──
    if (stream.usEquity) {
      const byAsset = {};
      txns.forEach(t => {
        const aid = String(t[stream.assetIdCol]);
        if (!byAsset[aid]) byAsset[aid] = { buyUnits: 0, buyCostINR: 0, netQty: 0, txns: [] };
        const u = parseFloat(t.units || 0);
        if (String(t.txn_type).toUpperCase() === 'BUY') {
          byAsset[aid].buyUnits   += u;
          byAsset[aid].buyCostINR += parseFloat(t[stream.costBasisCol] || 0);
          byAsset[aid].netQty     += u;
        } else {
          byAsset[aid].netQty -= u;
        }
        byAsset[aid].txns.push(t);
      });

      Object.entries(byAsset).forEach(([aid, d]) => {
        const asset = assetMap[aid];
        if (d.buyUnits <= 0 || d.netQty <= 0) return;
        const netCost   = d.netQty * (d.buyCostINR / d.buyUnits);
        const priceINR  = parseFloat(asset?.[stream.currentPriceCol] || 0);
        const curVal    = priceINR > 0 ? d.netQty * priceINR : 0;
        const unrealPnL = curVal > 0 ? curVal - netCost : 0;

        const resolvedSubcat = SUBCAT_NAMES[asset?.subcategory_id] || catName;
        if (!bySubcat[resolvedSubcat]) bySubcat[resolvedSubcat] = { netCost: 0, currentValue: 0 };
        bySubcat[resolvedSubcat].netCost      += netCost;
        bySubcat[resolvedSubcat].currentValue += curVal;
        addCatSub(catName, resolvedSubcat, netCost, curVal);

        byCategory[catName].netCost       += netCost;
        byCategory[catName].currentValue   = (byCategory[catName].currentValue  || 0) + curVal;
        byCategory[catName].unrealizedPnL  = (byCategory[catName].unrealizedPnL || 0) + unrealPnL;
        byBucket[bucketId].netCost        += netCost;
        byBucket[bucketId].currentValue    = (byBucket[bucketId].currentValue || 0) + curVal;
        totalInvested      += d.buyCostINR;
        totalCurrentValue  += curVal;
        totalUnrealizedPnL += unrealPnL;

        if (netCost > 100 && asset) {
          topHoldings.push({ name: asset[stream.assetNameCol], catName, account: asset.account_id, netCost, currentValue: curVal });
        }

        // INR cashflows for XIRR + monthly/yearly invested (buys only; USD stays in broker)
        d.txns.forEach(t => {
          if (String(t.txn_type).toUpperCase() !== 'BUY') return;
          const inr = parseFloat(t[stream.costBasisCol] || 0);
          const dt  = new Date(t.txn_date);
          if (isNaN(dt) || !inr) return;
          const cf = { amount: -inr, date: dt };
          byCategory[catName].cashflows.push(cf);
          allCashflows.push({ ...cf });
          if (!byCategory[catName].firstBuyDate || dt < byCategory[catName].firstBuyDate) {
            byCategory[catName].firstBuyDate = dt;
          }
          const month = (t.txn_date || '').substring(0, 7);
          const year  = (t.txn_date || '').substring(0, 4);
          if (month) { if (!byMonth[month]) byMonth[month] = { invested: 0, redeemed: 0 }; byMonth[month].invested += inr; allMonthlyNet[month] = (allMonthlyNet[month] || 0) + inr; }
          if (year)  { if (!byYear[year])   byYear[year]   = { invested: 0, redeemed: 0 }; byYear[year].invested  += inr; }
        });
      });

      // ── Derived US cash line (snapshot, no P&L) — account-filtered ──
      const cashUsd = usEquityCashUsd(
        txns,
        (_usAux.wires  || []).filter(w => ACCOUNTS.matches(w.account_id)),
        (_usAux.repats || []).filter(r => ACCOUNTS.matches(r.account_id)),
        (_usAux.income || []).filter(i => ACCOUNTS.matches(i.account_id)));
      if (Math.abs(cashUsd) > 0.01) {
        const cashInr = cashUsd * usEquityLiveRate(assets, _usAux.wires, stream);
        byCategory[catName].netCost      += cashInr;
        byCategory[catName].currentValue  = (byCategory[catName].currentValue || 0) + cashInr;
        byBucket[bucketId].netCost       += cashInr;
        byBucket[bucketId].currentValue   = (byBucket[bucketId].currentValue || 0) + cashInr;
        if (!bySubcat['Cash']) bySubcat['Cash'] = { netCost: 0, currentValue: 0 };
        bySubcat['Cash'].netCost      += cashInr;
        bySubcat['Cash'].currentValue += cashInr;
        addCatSub(catName, 'Cash', cashInr, cashInr);
        totalCurrentValue += cashInr;
      }
      return;
    }

    const txnsByAsset = {};
    txns.forEach(t => {
      const aid = String(t[stream.assetIdCol]);
      if (!txnsByAsset[aid]) txnsByAsset[aid] = [];
      txnsByAsset[aid].push(t);
    });

    Object.entries(txnsByAsset).forEach(([assetId, assetTxns]) => {
      const asset = assetMap[assetId];
      const m = computeAssetMetrics(stream, assetTxns);

      // Current market value — price is always INR (GAS formula handles FX for USD assets)
      let priceINR = 0;
      if (stream.currentPriceCol) {
        priceINR = parseFloat(asset?.[stream.currentPriceCol] || 0);
      } else if (stream.manualPriceType) {
        if (asset?.price_fetch_way === 'formula') {
          priceINR = parseFloat(asset?.['current_price'] || 0);
        } else {
          priceINR = _manualPricesMap[`${stream.manualPriceType}|${assetId}`] || 0;
        }
      }
      const curVal    = priceINR && m.currentQty > 0 ? m.currentQty * priceINR : 0;
      const unrealPnL = curVal > 0 ? curVal - m.netCost : 0;

      const resolvedSubcat = subcatName || SUBCAT_NAMES[asset?.subcategory_id] || catName;
      if (!bySubcat[resolvedSubcat]) bySubcat[resolvedSubcat] = { netCost: 0, currentValue: 0 };
      bySubcat[resolvedSubcat].netCost      += m.netCost;
      bySubcat[resolvedSubcat].currentValue += curVal;
      addCatSub(catName, resolvedSubcat, m.netCost, curVal);

      byCategory[catName].netCost        += m.netCost;
      byCategory[catName].realizedPnL    += m.realizedPnL;
      byCategory[catName].totalBought    += m.totalBought;
      byCategory[catName].totalSold      += m.totalSold;
      byCategory[catName].currentValue   = (byCategory[catName].currentValue  || 0) + curVal;
      byCategory[catName].unrealizedPnL  = (byCategory[catName].unrealizedPnL || 0) + unrealPnL;
      byBucket[bucketId].netCost         += m.netCost;
      byBucket[bucketId].currentValue    = (byBucket[bucketId].currentValue || 0) + curVal;
      totalInvested      += m.totalBought;
      totalRedeemed      += m.totalSold;
      totalRealizedPnL   += m.realizedPnL;
      totalCurrentValue  += curVal;
      totalUnrealizedPnL += unrealPnL;

      if (m.netCost > 100 && asset) {
        topHoldings.push({ name: asset[stream.assetNameCol], catName, account: asset.account_id, netCost: m.netCost, currentValue: curVal });
      }

      // Collect cashflows for XIRR
      assetTxns.forEach(t => {
        const d = new Date(t.txn_date);
        if (isNaN(d)) return;
        const cf = { amount: t.txn_type === 'Buy' ? -getAmtINR(stream, t) : getAmtINR(stream, t), date: d };
        byCategory[catName].cashflows.push(cf);
        allCashflows.push({ ...cf });
        if (t.txn_type === 'Buy') {
          if (!byCategory[catName].firstBuyDate || d < byCategory[catName].firstBuyDate) {
            byCategory[catName].firstBuyDate = d;
          }
        }
      });

      assetTxns.forEach(t => {
        const amt   = getAmtINR(stream, t);
        const month = (t.txn_date || '').substring(0, 7);
        const year  = (t.txn_date || '').substring(0, 4);
        const sign  = t.txn_type === 'Buy' ? 1 : -1;
        if (month) {
          if (!byMonth[month]) byMonth[month] = { invested: 0, redeemed: 0 };
          t.txn_type === 'Buy' ? (byMonth[month].invested += amt) : (byMonth[month].redeemed += amt);
          allMonthlyNet[month] = (allMonthlyNet[month] || 0) + sign * amt;
        }
        if (year) {
          if (!byYear[year]) byYear[year] = { invested: 0, redeemed: 0 };
          t.txn_type === 'Buy' ? (byYear[year].invested += amt) : (byYear[year].redeemed += amt);
        }
      });
    });
  });

  topHoldings.sort((a, b) => b.netCost - a.netCost);
  const netInvested = Object.values(byCategory).reduce((s, c) => s + c.netCost, 0);

  // Compute per-category XIRR (add terminal current-value cashflow at today)
  const today = new Date();
  Object.entries(byCategory).forEach(([, cat]) => {
    const cfs = [...cat.cashflows];
    if (cat.currentValue > 0) cfs.push({ amount: cat.currentValue, date: today });
    cat.xirr = computeXIRR(cfs);
  });

  // Overall XIRR
  const allCfs = [...allCashflows];
  if (totalCurrentValue > 0) allCfs.push({ amount: totalCurrentValue, date: today });
  const overallXIRR = computeXIRR(allCfs);

  return {
    totalInvested, totalRedeemed, totalRealizedPnL, netInvested,
    totalCurrentValue, totalUnrealizedPnL, overallXIRR,
    byCategory, byBucket, bySubcat, byCatSubcat, byMonth, byYear,
    topHoldings: topHoldings.slice(0, 10),
    allMonthlyNet,
  };
}

// ── Portfolio Hero ────────────────────────────────────────────────────────────

function buildPortfolioHero(agg) {
  const hasPrices = agg.totalCurrentValue > 0;
  const heroVal   = hasPrices ? fmtCurrency(agg.totalCurrentValue) : fmtCurrency(agg.netInvested);
  const heroLabel = hasPrices ? 'Portfolio Value' : 'Cost Basis';
  const pnl       = agg.totalUnrealizedPnL;
  const pnlSign   = pnl >= 0 ? '+' : '';
  const pnlCls    = pnl >= 0 ? 'positive' : 'negative';
  const pnlPct    = agg.netInvested > 0 ? (pnl / agg.netInvested * 100).toFixed(1) : '0.0';

  const hero = document.createElement('div');
  hero.className = 'portfolio-hero';
  hero.innerHTML = `
    <div class="portfolio-hero-label">${heroLabel}</div>
    <div class="portfolio-hero-value">${heroVal}</div>
    <div class="portfolio-hero-meta">
      <div class="portfolio-hero-meta-item">Invested <span>${fmtCurrency(agg.netInvested)}</span></div>
      ${hasPrices ? `<div class="portfolio-hero-meta-item">Unrealized <span class="${pnlCls}">${pnlSign}${fmtCurrency(pnl)} (${pnlSign}${pnlPct}%)</span></div>` : ''}
      ${agg.overallXIRR !== null ? `<div class="portfolio-hero-meta-item">XIRR <span class="${agg.overallXIRR >= 0 ? 'positive' : 'negative'}">${fmtXIRR(agg.overallXIRR)}</span></div>` : ''}
      ${agg.totalRealizedPnL !== 0 ? `<div class="portfolio-hero-meta-item">Realized <span class="${agg.totalRealizedPnL >= 0 ? 'positive' : 'negative'}">${agg.totalRealizedPnL >= 0 ? '+' : ''}${fmtCurrency(agg.totalRealizedPnL)}</span></div>` : ''}
    </div>
  `;
  return hero;
}

// ── Metric Strip ──────────────────────────────────────────────────────────────

function buildMetricStrip(agg) {
  const hasPrices = agg.totalCurrentValue > 0;
  const pnl       = agg.totalUnrealizedPnL;
  const pnlSign   = pnl >= 0 ? '+' : '';
  const pnlCls    = hasPrices ? (pnl >= 0 ? 'positive' : 'negative') : '';

  const metrics = [
    { icon: '💰', label: 'Net Invested',    value: fmtCurrency(agg.netInvested),                                                                                   color: '#f59e0b' },
    { icon: '📈', label: 'Current Value',   value: hasPrices ? fmtCurrency(agg.totalCurrentValue) : '—',                                                          color: '#0891b2' },
    { icon: '🎯', label: 'Overall XIRR',    value: fmtXIRR(agg.overallXIRR),  cls: agg.overallXIRR !== null ? (agg.overallXIRR >= 0 ? 'positive' : 'negative') : '', color: '#7c3aed' },
    { icon: '⚡', label: 'Unrealized P&L',  value: hasPrices ? `${pnlSign}${fmtCurrency(pnl)}` : '—',  cls: pnlCls,                                               color: pnl >= 0 ? '#22c55e' : '#ef4444' },
  ];

  const strip = document.createElement('div');
  strip.className = 'metric-strip';
  metrics.forEach(m => {
    const card = document.createElement('div');
    card.className = 'metric-card';
    card.style.setProperty('--mc-color', m.color);
    card.innerHTML = `
      <span class="metric-card-icon">${m.icon}</span>
      <div class="metric-card-value ${m.cls || ''}">${m.value}</div>
      <div class="metric-card-label">${m.label}</div>
    `;
    strip.appendChild(card);
  });
  return strip;
}

// ── Report constants ──────────────────────────────────────────────────────────

const CAT_ICONS = {
  'Indian EQ MF':              '📊',
  'Indian Equity Stocks':      '📈',
  'US Equity (IndMoney)':      '🏦',
  'US Equity':                 '🇺🇸',
  'Real Estate':               '🏠',
  'Debt & Hybrid MF':          '🛡️',
  'Precious Metals (Digital)': '✨',
  'Precious Metals (Physical)':'🥇',
  'Cryptocurrency':            '₿',
  'Indian EQ MF SIP':          '🔄',
  'Debt & Hybrid MF SIP':      '🔄',
};

const LIQUIDITY_TIERS = [
  { label: 'Instant',  color: '#8b5cf6', cats: ['Cryptocurrency'] },
  { label: '1 Day',    color: '#22c55e', cats: ['Indian Equity Stocks'] },
  { label: '3-5 Days', color: '#3b82f6', cats: ['Indian EQ MF', 'Debt & Hybrid MF', 'US Equity (IndMoney)', 'US Equity', 'Precious Metals (Digital)'] },
  { label: 'Weeks',    color: '#f59e0b', cats: ['Precious Metals (Physical)'] },
  { label: 'Months+',  color: '#ef4444', cats: ['Real Estate'] },
];

const CURRENCY_MAP = {
  'Indian EQ MF':              'INR',
  'Indian Equity Stocks':      'INR',
  'Debt & Hybrid MF':          'INR',
  'Precious Metals (Digital)': 'INR',
  'Precious Metals (Physical)':'INR',
  'Real Estate':               'INR',
  'US Equity (IndMoney)':      'USD',
  'US Equity':                 'USD',
  'Cryptocurrency':            'Crypto',
  'Indian EQ MF SIP':          'INR',
  'Debt & Hybrid MF SIP':      'INR',
};

const TAX_CONFIG = {
  'Indian EQ MF':              { ltcgMonths: 12, ltcgRate: 0.10, stcgRate: 0.15 },
  'Indian Equity Stocks':      { ltcgMonths: 12, ltcgRate: 0.10, stcgRate: 0.15 },
  'US Equity (IndMoney)':      { ltcgMonths: 24, ltcgRate: 0.20, stcgRate: 0.30 },
  'US Equity':                 { ltcgMonths: 24, ltcgRate: 0.20, stcgRate: 0.30 },
  'Debt & Hybrid MF':          { ltcgMonths: null, rate: 'income', note: 'Taxed as income' },
  'Precious Metals (Digital)': { ltcgMonths: 12, ltcgRate: 0.10, stcgRate: 0.15 },
  'Precious Metals (Physical)':{ ltcgMonths: 36, ltcgRate: 0.20, stcgRate: 0.30 },
  'Real Estate':               { ltcgMonths: 24, ltcgRate: 0.20, stcgRate: 0.30 },
  'Cryptocurrency':            { ltcgMonths: null, rate: 0.30, note: 'Flat 30%' },
  'Indian EQ MF SIP':          { ltcgMonths: 12, ltcgRate: 0.10, stcgRate: 0.15 },
  'Debt & Hybrid MF SIP':      { ltcgMonths: null, rate: 'income', note: 'Taxed as income' },
};

// ── Stream-wise P&L table ─────────────────────────────────────────────────────

function drawStreamTable(divId, agg) {
  const wrap = document.getElementById(divId);
  if (!wrap) return;

  const cols = [
    { key: 'name',       label: 'Stream' },
    { key: 'invested',   label: 'Invested' },
    { key: 'current',    label: 'Current Value' },
    { key: 'gain',       label: 'Gain ₹' },
    { key: 'gainPct',    label: 'Gain %' },
    { key: 'xirr',       label: 'XIRR' },
  ];

  let sortKey = 'invested', sortDir = -1;

  function rows() {
    const data = Object.entries(agg.byCategory).map(([name, cat]) => ({
      name,
      invested:  cat.netCost,
      current:   cat.currentValue || 0,
      gain:      cat.currentValue ? cat.currentValue - cat.netCost : null,
      gainPct:   cat.currentValue && cat.netCost > 0 ? (cat.currentValue - cat.netCost) / cat.netCost * 100 : null,
      xirr:      cat.xirr,
    }));
    data.sort((a, b) => {
      const av = a[sortKey] ?? -Infinity, bv = b[sortKey] ?? -Infinity;
      return (av < bv ? -1 : av > bv ? 1 : 0) * sortDir;
    });
    return data;
  }

  function fmt(v, type) {
    if (v === null || v === undefined) return '<span style="color:var(--text-muted)">—</span>';
    if (type === 'currency') return fmtCurrency(v);
    if (type === 'pct') {
      const cls = v >= 0 ? 'positive' : 'negative';
      return `<span class="${cls}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
    }
    if (type === 'pnl') {
      const cls = v >= 0 ? 'positive' : 'negative';
      return `<span class="${cls}">${v >= 0 ? '+' : ''}${fmtCurrency(v)}</span>`;
    }
    if (type === 'xirr') {
      if (v === null) return '<span style="color:var(--text-muted)">—</span>';
      const cls = v >= 0 ? 'positive' : 'negative';
      return `<span class="${cls}">${fmtXIRR(v)}</span>`;
    }
    return String(v);
  }

  function render() {
    const data = rows();
    const totalInv = data.reduce((s, r) => s + r.invested, 0);
    const totalCur = data.reduce((s, r) => s + r.current, 0);
    const totalGain = totalCur > 0 ? totalCur - totalInv : null;

    let html = `<div class="report-table-wrap"><table class="report-table"><thead><tr>`;
    cols.forEach(c => {
      const cls = c.key === sortKey ? (sortDir > 0 ? 'sort-asc' : 'sort-desc') : '';
      html += `<th class="${cls}" data-key="${c.key}">${c.label}</th>`;
    });
    html += '</tr></thead><tbody>';

    data.forEach(r => {
      const icon = CAT_ICONS[r.name] || '';
      html += `<tr>
        <td><span class="stream-icon">${icon}</span>${r.name}</td>
        <td>${fmt(r.invested, 'currency')}</td>
        <td>${r.current > 0 ? fmtCurrency(r.current) : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>${fmt(r.gain, 'pnl')}</td>
        <td>${fmt(r.gainPct, 'pct')}</td>
        <td>${fmt(r.xirr, 'xirr')}</td>
      </tr>`;
    });

    html += `</tbody><tfoot><tr class="total-row">
      <td>Total</td>
      <td>${fmtCurrency(totalInv)}</td>
      <td>${totalCur > 0 ? fmtCurrency(totalCur) : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${fmt(totalGain, 'pnl')}</td>
      <td>${totalGain !== null && totalInv > 0 ? fmt(totalGain / totalInv * 100, 'pct') : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${fmt(agg.overallXIRR, 'xirr')}</td>
    </tr></tfoot></table></div>`;

    wrap.innerHTML = html;

    wrap.querySelectorAll('th[data-key]').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.key;
        if (sortKey === k) sortDir *= -1;
        else { sortKey = k; sortDir = -1; }
        render();
      });
    });
  }

  render();
}

// ── Generic click-to-sort for any .report-table ──────────────────────────────
// Reads a cell's data-sort attr if present, else parses its text as a number
// (₹, %, +/− and commas stripped), falling back to case-insensitive text.
// Rows with class .total-row stay pinned at the bottom.
function makeTableSortable(table) {
  if (!table || !table.tHead || !table.tBodies[0]) return;
  const tbody = table.tBodies[0];
  const ths = [...table.tHead.rows[0].cells];

  const cellVal = (cell) => {
    if (!cell) return -Infinity;
    if (cell.dataset.sort !== undefined && cell.dataset.sort !== '') {
      const n = parseFloat(cell.dataset.sort);
      return isNaN(n) ? cell.dataset.sort.toLowerCase() : n;
    }
    const txt = (cell.textContent || '').trim();
    if (txt === '' || txt === '—') return -Infinity;
    const num = parseFloat(txt.replace(/[₹,%+\s]/g, '').replace(/−/g, '-'));
    return isNaN(num) ? txt.toLowerCase() : num;
  };

  ths.forEach((th, col) => {
    if (!(th.textContent || '').trim()) return;   // skip blank columns (e.g. % bar)
    th.addEventListener('click', () => {
      const asc = !th.classList.contains('sort-asc');
      ths.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
      th.classList.add(asc ? 'sort-asc' : 'sort-desc');

      // Collapse any open drill-down rows so they aren't orphaned by re-sorting
      tbody.querySelectorAll('.mf-drill').forEach(r => r.remove());
      tbody.querySelectorAll('.mf-fund-row.expanded').forEach(r => r.classList.remove('expanded'));

      const rows   = [...tbody.rows];
      const totals = rows.filter(r => r.classList.contains('total-row'));
      const data   = rows.filter(r => !r.classList.contains('total-row'));
      data.sort((ra, rb) => {
        const a = cellVal(ra.cells[col]), b = cellVal(rb.cells[col]);
        if (a < b) return asc ? -1 : 1;
        if (a > b) return asc ? 1 : -1;
        return 0;
      });
      data.forEach(r => tbody.appendChild(r));
      totals.forEach(r => tbody.appendChild(r));
    });
  });
}

// ── Composition % tables ──────────────────────────────────────────────────────

function _compVal(x) { return (x && x.currentValue > 0) ? x.currentValue : (x && x.netCost) || 0; }

// Category-wise composition: each category's share of the whole portfolio.
function drawCategoryComposition(divId, agg) {
  const wrap = document.getElementById(divId);
  if (!wrap) return;
  const rows = Object.entries(agg.byCategory)
    .map(([name, c]) => ({ name, val: _compVal(c) }))
    .filter(r => r.val > 0)
    .sort((a, b) => b.val - a.val);
  const total = rows.reduce((s, r) => s + r.val, 0);
  if (!total) { wrap.innerHTML = '<p class="chart-empty">No data.</p>'; return; }

  let html = `<div class="report-table-wrap"><table class="report-table"><thead><tr>
    <th style="text-align:left">Category</th><th>Value</th><th>% of Portfolio</th><th></th>
  </tr></thead><tbody>`;
  rows.forEach(r => {
    const pct = r.val / total * 100;
    html += `<tr>
      <td>${CAT_ICONS[r.name] ? `<span class="stream-icon">${CAT_ICONS[r.name]}</span>` : ''}${r.name}</td>
      <td>${fmtCurrency(r.val)}</td>
      <td>${pct.toFixed(1)}%</td>
      <td style="width:130px"><div class="comp-bar"><div class="comp-bar-fill" style="width:${Math.min(100, pct).toFixed(1)}%"></div></div></td>
    </tr>`;
  });
  html += `<tr class="total-row"><td>Total</td><td>${fmtCurrency(total)}</td><td>100%</td><td></td></tr>`;
  html += `</tbody></table></div>`;
  wrap.innerHTML = html;
}

// Within each category, the subcategory composition (only multi-subcat categories).
function drawSubcatComposition(divId, agg) {
  const wrap = document.getElementById(divId);
  if (!wrap) return;
  const cats = Object.entries(agg.byCatSubcat || {})
    .map(([cat, subs]) => {
      const rows = Object.entries(subs)
        .map(([sub, v]) => ({ sub, val: _compVal(v) }))
        .filter(r => r.val > 0)
        .sort((a, b) => b.val - a.val);
      return { cat, rows, total: rows.reduce((s, r) => s + r.val, 0) };
    })
    .filter(c => c.rows.length > 1 && c.total > 0)
    .sort((a, b) => b.total - a.total);

  if (!cats.length) { wrap.innerHTML = '<p class="chart-empty">No multi-subcategory data.</p>'; return; }

  let html = '';
  cats.forEach(c => {
    html += `<div class="comp-group"><div class="comp-group-title">${CAT_ICONS[c.cat] ? `<span class="stream-icon">${CAT_ICONS[c.cat]}</span>` : ''}${c.cat}</div>
      <div class="report-table-wrap"><table class="report-table"><thead><tr>
        <th style="text-align:left">Subcategory</th><th>Value</th><th>% of category</th><th></th>
      </tr></thead><tbody>`;
    c.rows.forEach(r => {
      const pct = r.val / c.total * 100;
      html += `<tr>
        <td>${r.sub}</td><td>${fmtCurrency(r.val)}</td><td>${pct.toFixed(1)}%</td>
        <td style="width:130px"><div class="comp-bar"><div class="comp-bar-fill" style="width:${Math.min(100, pct).toFixed(1)}%"></div></div></td>
      </tr>`;
    });
    html += `</tbody></table></div></div>`;
  });
  wrap.innerHTML = html;
}

// Amount contributed per month (invested / redeemed / net), newest first.
function drawMonthlyTable(divId, agg) {
  const wrap = document.getElementById(divId);
  if (!wrap) return;
  const months = Object.keys(agg.byMonth).sort((a, b) => b.localeCompare(a));
  if (!months.length) { wrap.innerHTML = '<p class="chart-empty">No transactions.</p>'; return; }

  let html = `<div class="report-table-wrap"><table class="report-table"><thead><tr>
    <th style="text-align:left">Month</th><th>Invested</th><th>Redeemed</th><th>Net</th>
  </tr></thead><tbody>`;
  let tInv = 0, tRed = 0;
  months.forEach(m => {
    const inv = agg.byMonth[m].invested || 0, red = agg.byMonth[m].redeemed || 0, net = inv - red;
    tInv += inv; tRed += red;
    html += `<tr>
      <td data-sort="${m}">${monthLabel(m)}</td>
      <td>${fmtCurrency(inv)}</td>
      <td>${red > 0 ? fmtCurrency(red) : '—'}</td>
      <td class="${net >= 0 ? 'positive' : 'negative'}">${net >= 0 ? '+' : '-'}${fmtCurrency(Math.abs(net))}</td>
    </tr>`;
  });
  const tNet = tInv - tRed;
  html += `<tr class="total-row"><td>Total</td><td>${fmtCurrency(tInv)}</td><td>${tRed > 0 ? fmtCurrency(tRed) : '—'}</td>
    <td class="${tNet >= 0 ? 'positive' : 'negative'}">${tNet >= 0 ? '+' : '-'}${fmtCurrency(Math.abs(tNet))}</td></tr>`;
  html += `</tbody></table></div>`;
  wrap.innerHTML = html;
}

// ── Liquidity Ladder ──────────────────────────────────────────────────────────

function drawLiquidityLadder(divId, byCategory, totalInvested) {
  const wrap = document.getElementById(divId);
  if (!wrap) return;

  const ladder = document.createElement('div');
  ladder.className = 'liquidity-ladder';

  LIQUIDITY_TIERS.forEach(tier => {
    const tierTotal = tier.cats.reduce((s, c) => s + (byCategory[c]?.netCost || 0), 0);
    if (tierTotal < 1) return;
    const pct = totalInvested > 0 ? (tierTotal / totalInvested * 100).toFixed(1) : '0.0';
    const presentCats = tier.cats.filter(c => byCategory[c]?.netCost > 0).join(', ');

    const row = document.createElement('div');
    row.className = 'liquidity-tier';
    row.style.setProperty('--lt-color', tier.color);
    row.innerHTML = `
      <div class="liquidity-tier-label">${tier.label}</div>
      <div class="liquidity-tier-streams">${presentCats}</div>
      <div class="liquidity-tier-amount">${fmtCurrency(tierTotal)}</div>
      <div class="liquidity-tier-pct">${pct}%</div>
    `;
    ladder.appendChild(row);
  });

  if (!ladder.children.length) {
    ladder.innerHTML = '<p class="chart-empty">No allocation data.</p>';
  }

  wrap.appendChild(ladder);
}

// ── Currency Exposure pie ─────────────────────────────────────────────────────

function drawCurrencyChart(canvasId, byCategory) {
  const grouped = {};
  Object.entries(byCategory).forEach(([name, cat]) => {
    const currency = CURRENCY_MAP[name] || 'INR';
    grouped[currency] = (grouped[currency] || 0) + cat.netCost;
  });
  const entries = Object.entries(grouped).filter(([, v]) => v > 0);
  if (!entries.length) return emptyCard(canvasId, 'No allocation data.');

  const colors = { INR: '#f59e0b', USD: '#22c55e', Crypto: '#a855f7' };
  newChart(canvasId, {
    type: 'pie',
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{ data: entries.map(([, v]) => Math.round(v)), backgroundColor: entries.map(([k]) => colors[k] || '#7c3aed'), borderColor: '#111111', borderWidth: 2, hoverOffset: 8 }],
    },
    options: pieOptions(),
  });
}

// ── Equity Cap Split bar ──────────────────────────────────────────────────────

function drawCapSplitChart(canvasId, bySubcat) {
  const capCats = ['Large Cap', 'Mid Cap', 'Small Cap'];
  const equityTotal = capCats.reduce((s, c) => s + (bySubcat[c]?.netCost || 0), 0);
  if (equityTotal < 1) return emptyCard(canvasId, 'No equity mutual fund subcategory data.');

  const actual  = capCats.map(c => equityTotal > 0 ? (bySubcat[c]?.netCost || 0) / equityTotal * 100 : 0);
  const targets = [47, 35, 17];
  const colors  = ['#f59e0b', '#a855f7', '#0ea5e9'];

  newChart(canvasId, {
    type: 'bar',
    data: {
      labels: capCats,
      datasets: [
        { label: 'Actual %',  data: actual.map(v => parseFloat(v.toFixed(1))),  backgroundColor: colors.map(c => c + 'cc'), borderRadius: 4 },
        { label: 'Target %',  data: targets, backgroundColor: colors.map(c => c + '44'), borderRadius: 4, borderColor: colors, borderWidth: 1 },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        datalabels: { display: false },
        legend: { position: 'top', labels: { color: '#8b90a8', padding: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%` } },
      },
      scales: {
        x: { ticks: { color: '#525252', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false } },
        y: { ticks: { color: '#525252', callback: v => v + '%', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false }, beginAtZero: true, max: 70 },
      },
    },
  });
}

// ── Tax Liability Table ───────────────────────────────────────────────────────

function drawTaxTable(divId, byCategory) {
  const wrap = document.getElementById(divId);
  if (!wrap) return;

  const today = new Date();
  let hasData = false;
  let html = `<div class="report-table-wrap"><table class="report-table"><thead><tr>
    <th>Category</th><th>Unrealized Gain</th><th>First Buy</th><th>Holding Period</th><th>Type</th><th>Est. Tax</th>
  </tr></thead><tbody>`;

  Object.entries(byCategory).forEach(([name, cat]) => {
    const gain = cat.currentValue ? cat.currentValue - cat.netCost : null;
    if (!gain || gain <= 0) return;
    const cfg = TAX_CONFIG[name];
    if (!cfg) return;

    const firstBuy = cat.firstBuyDate;
    const holdMonths = firstBuy ? Math.floor((today - firstBuy) / (30.44 * 86400000)) : null;
    const holdLabel = holdMonths !== null ? `${holdMonths}m` : '—';

    let type = '—', estTax = null;

    if (cfg.rate === 'income') {
      type    = 'Income tax';
      estTax  = null;
    } else if (cfg.ltcgMonths === null) {
      type   = `Flat ${(cfg.rate * 100).toFixed(0)}%`;
      estTax = gain * cfg.rate;
    } else if (holdMonths !== null) {
      const isLTCG = holdMonths >= cfg.ltcgMonths;
      type    = isLTCG ? 'LTCG' : 'STCG';
      estTax  = gain * (isLTCG ? cfg.ltcgRate : cfg.stcgRate);
    } else {
      type = 'Unknown';
    }

    const taxCls = estTax !== null ? 'negative' : '';
    html += `<tr>
      <td><span class="stream-icon">${CAT_ICONS[name] || ''}</span>${name}</td>
      <td class="positive">+${fmtCurrency(gain)}</td>
      <td>${firstBuy ? firstBuy.toLocaleDateString('en-IN', { month:'short', year:'2-digit' }) : '—'}</td>
      <td>${holdLabel}</td>
      <td>${type}</td>
      <td class="${taxCls}">${estTax !== null ? fmtCurrency(estTax) : cfg.note || '—'}</td>
    </tr>`;
    hasData = true;
  });

  if (!hasData) {
    wrap.innerHTML = '<p class="chart-empty">No unrealized gains to estimate tax on.</p>';
    return;
  }

  html += `</tbody></table></div>
  <p class="report-disclaimer">Estimated only. Consult a tax professional. Does not account for indexation or ₹1L LTCG exemption on equity.</p>`;
  wrap.innerHTML = html;
}

// ── Chart card wrapper ────────────────────────────────────────────────────────

function makeChartCard(title, canvasId, fullWidth = false) {
  const card = document.createElement('div');
  card.className = 'chart-card' + (fullWidth ? ' chart-card-full' : '');
  card.innerHTML = `
    <div class="chart-card-title">${title}</div>
    <div class="chart-canvas-wrap"><canvas id="${canvasId}"></canvas></div>
  `;
  return card;
}

// ── Chart utilities ───────────────────────────────────────────────────────────

const CAT_COLORS    = ['#f59e0b','#a855f7','#22c55e','#0ea5e9','#fb923c','#ec4899','#ef4444','#14b8a6'];
const BUCKET_COLORS = ['#a855f7','#0ea5e9','#f59e0b'];

function fmtAxis(v) {
  const abs = Math.abs(v);
  if (abs >= 10000000) return (v / 10000000).toFixed(1) + 'Cr';
  if (abs >= 100000)   return (v / 100000).toFixed(1) + 'L';
  if (abs >= 1000)     return (v / 1000).toFixed(0) + 'K';
  return String(Math.round(v));
}

function fmtCurrency(v) {
  return '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function newChart(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  const chart = new Chart(canvas, config);
  _insightsCharts.push(chart);
  return chart;
}

function monthLabel(m) {
  const [y, mo] = m.split('-');
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

function emptyCard(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  const wrap = el.closest('.chart-card');
  if (!wrap) return;
  const cw = wrap.querySelector('.chart-canvas-wrap');
  if (cw) cw.innerHTML = `<p class="chart-empty">${msg}</p>`;
  else el.innerHTML = `<p class="chart-empty">${msg}</p>`;
}

// ── Pie chart helpers ─────────────────────────────────────────────────────────

function pieOptions(legendSize = 11) {
  return {
    plugins: {
      datalabels: {
        formatter: (value, ctx) => {
          const sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
          const pct = (value / sum * 100).toFixed(1);
          return parseFloat(pct) >= 4 ? pct + '%' : '';
        },
        color: '#fff',
        font: { size: 11, weight: '700' },
      },
      legend: { position: 'bottom', labels: { color: '#8b90a8', padding: 12, font: { size: legendSize }, usePointStyle: true } },
      tooltip: {
        callbacks: {
          label: ctx => {
            const sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
            const pct = (ctx.raw / sum * 100).toFixed(1);
            return ` ${ctx.label}: ${fmtCurrency(ctx.raw)} (${pct}%)`;
          },
        },
      },
    },
  };
}

// ── Bucket pie ────────────────────────────────────────────────────────────────

function drawBucketChart(byBucket) {
  const entries = Object.entries(byBucket).filter(([, v]) => v.netCost > 0);
  if (!entries.length) return emptyCard('chart-bucket', 'No data for selected filters.');
  newChart('chart-bucket', {
    type: 'pie',
    data: {
      labels: entries.map(([, v]) => v.name),
      datasets: [{ data: entries.map(([, v]) => Math.round(v.netCost)), backgroundColor: BUCKET_COLORS, borderColor: '#111111', borderWidth: 2, hoverOffset: 8 }],
    },
    options: pieOptions(),
  });
}

// ── Category pie ──────────────────────────────────────────────────────────────

function drawCategoryChart(byCategory) {
  const entries = Object.entries(byCategory).filter(([, v]) => v.netCost > 0);
  if (!entries.length) return emptyCard('chart-category', 'No data for selected filters.');
  newChart('chart-category', {
    type: 'pie',
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{ data: entries.map(([, v]) => Math.round(v.netCost)), backgroundColor: CAT_COLORS.slice(0, entries.length), borderColor: '#111111', borderWidth: 2, hoverOffset: 8 }],
    },
    options: pieOptions(),
  });
}

// ── Subcategory pie ───────────────────────────────────────────────────────────

function drawSubcatChart(bySubcat) {
  const entries = Object.entries(bySubcat)
    .filter(([, v]) => v.netCost > 0)
    .sort((a, b) => b[1].netCost - a[1].netCost);
  if (!entries.length) return emptyCard('chart-subcat', 'No data for selected filters.');
  const allColors = [...CAT_COLORS, ...BUCKET_COLORS, '#6366f1', '#10b981', '#f97316'];
  newChart('chart-subcat', {
    type: 'pie',
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{ data: entries.map(([, v]) => Math.round(v.netCost)), backgroundColor: allColors.slice(0, entries.length), borderColor: '#111111', borderWidth: 2, hoverOffset: 8 }],
    },
    options: pieOptions(),
  });
}

// ── Allocation by current value pie ──────────────────────────────────────────

function drawAllocCvChart(byCategory) {
  const entries = Object.entries(byCategory).filter(([, v]) => (v.currentValue || 0) > 0);
  if (!entries.length) return emptyCard('chart-alloc-cv', 'No price data yet — add prices to see current value split.');
  newChart('chart-alloc-cv', {
    type: 'pie',
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{ data: entries.map(([, v]) => Math.round(v.currentValue)), backgroundColor: CAT_COLORS.slice(0, entries.length), borderColor: '#111111', borderWidth: 2, hoverOffset: 8 }],
    },
    options: pieOptions(),
  });
}

// ── Monthly bar ───────────────────────────────────────────────────────────────

function drawMonthlyChart(byMonth) {
  const months = Object.keys(byMonth).sort().slice(-24);
  if (!months.length) return emptyCard('chart-monthly', 'No transactions in selected period.');
  const GRID = 'rgba(255,255,255,0.05)';
  const TICK = '#525252';
  newChart('chart-monthly', {
    type: 'bar',
    data: {
      labels: months.map(monthLabel),
      datasets: [
        { label: 'Invested', data: months.map(m => Math.round(byMonth[m]?.invested || 0)),
          backgroundColor: 'rgba(245,158,11,0.82)', borderRadius: { topLeft: 6, topRight: 6 }, borderSkipped: 'bottom', categoryPercentage: 0.65, barPercentage: 0.85 },
        { label: 'Redeemed', data: months.map(m => Math.round(byMonth[m]?.redeemed || 0)),
          backgroundColor: 'rgba(239,68,68,0.72)', borderRadius: { topLeft: 6, topRight: 6 }, borderSkipped: 'bottom', categoryPercentage: 0.65, barPercentage: 0.85 },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        datalabels: { display: false },
        legend: { position: 'top', labels: { color: TICK, padding: 14, usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtCurrency(ctx.raw)}` } },
      },
      scales: {
        x: { ticks: { color: TICK, maxRotation: 45, font: { size: 10 } }, grid: { color: GRID, drawBorder: false } },
        y: { ticks: { color: TICK, callback: fmtAxis, font: { size: 10 } }, grid: { color: GRID, drawBorder: false }, beginAtZero: true },
      },
    },
  });
}

// ── Yearly bar ────────────────────────────────────────────────────────────────

function drawYearlyChart(byYear) {
  const years = Object.keys(byYear).sort();
  if (!years.length) return emptyCard('chart-yearly', 'No transactions in selected period.');
  const GRID = 'rgba(255,255,255,0.05)';
  const TICK = '#525252';
  newChart('chart-yearly', {
    type: 'bar',
    data: {
      labels: years,
      datasets: [
        { label: 'Invested', data: years.map(y => Math.round(byYear[y]?.invested || 0)),
          backgroundColor: 'rgba(245,158,11,0.82)', borderRadius: { topLeft: 8, topRight: 8 }, borderSkipped: 'bottom', categoryPercentage: 0.55, barPercentage: 0.85 },
        { label: 'Redeemed', data: years.map(y => Math.round(byYear[y]?.redeemed || 0)),
          backgroundColor: 'rgba(239,68,68,0.72)', borderRadius: { topLeft: 8, topRight: 8 }, borderSkipped: 'bottom', categoryPercentage: 0.55, barPercentage: 0.85 },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        datalabels: { display: false },
        legend: { position: 'top', labels: { color: TICK, padding: 14, usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtCurrency(ctx.raw)}` } },
      },
      scales: {
        x: { ticks: { color: TICK, font: { size: 11 } }, grid: { color: GRID, drawBorder: false } },
        y: { ticks: { color: TICK, callback: fmtAxis, font: { size: 10 } }, grid: { color: GRID, drawBorder: false }, beginAtZero: true },
      },
    },
  });
}

// ── Top holdings ──────────────────────────────────────────────────────────────

function drawTopHoldingsChart(topHoldings) {
  if (!topHoldings.length) return emptyCard('chart-top-holdings', 'No holdings for selected filters.');
  // In All-Accounts view, suffix each bar with its owner so the same fund held in
  // two accounts reads as two distinct bars.
  const tagAcct = (typeof ACCOUNTS !== 'undefined' && ACCOUNTS.isAll() && ACCOUNTS.list.length > 1);
  const fullName = h => tagAcct && h.account && ACCOUNTS.name(h.account) ? `${h.name} · ${ACCOUNTS.name(h.account)}` : h.name;
  const labels = topHoldings.map(h => { const n = fullName(h); return n.length > 22 ? n.substring(0, 20) + '…' : n; });
  const GRID = 'rgba(255,255,255,0.05)';
  const TICK = '#525252';
  const barColors = topHoldings.map((_, i) => CAT_COLORS[i % CAT_COLORS.length] + 'cc');
  newChart('chart-top-holdings', {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Net Invested', data: topHoldings.map(h => Math.round(h.netCost)),
        backgroundColor: barColors,
        borderRadius: { topRight: 6, bottomRight: 6 }, borderSkipped: 'left',
        barPercentage: 0.75, categoryPercentage: 0.85 }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        datalabels: { display: false },
        legend: { display: false },
        tooltip: { callbacks: { title: ctx => fullName(topHoldings[ctx[0].dataIndex]), label: ctx => ` ${fmtCurrency(ctx.raw)}` } },
      },
      scales: {
        x: { ticks: { color: TICK, callback: fmtAxis, font: { size: 10 } }, grid: { color: GRID, drawBorder: false }, beginAtZero: true },
        y: { ticks: { color: '#a3a3a3', font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

// ── Realized P&L ──────────────────────────────────────────────────────────────

function drawPnLChart(byCategory) {
  const entries = Object.entries(byCategory).filter(([, v]) => Math.abs(v.realizedPnL) > 1);
  if (!entries.length) return emptyCard('chart-pnl', 'No realized P&L yet — sell transactions will appear here.');
  const values = entries.map(([, v]) => Math.round(v.realizedPnL));
  const GRID = 'rgba(255,255,255,0.05)';
  const TICK = '#525252';
  newChart('chart-pnl', {
    type: 'bar',
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{ label: 'Realized P&L', data: values,
        backgroundColor: values.map(v => v >= 0 ? 'rgba(34,197,94,0.78)' : 'rgba(239,68,68,0.75)'),
        borderRadius: { topLeft: 6, topRight: 6 }, borderSkipped: 'bottom',
        barPercentage: 0.7, categoryPercentage: 0.7 }],
    },
    options: {
      responsive: true,
      plugins: {
        datalabels: { display: false },
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw >= 0 ? '+' : ''}${fmtCurrency(ctx.raw)}` } },
      },
      scales: {
        x: { ticks: { color: TICK, maxRotation: 30, font: { size: 10 } }, grid: { color: GRID, drawBorder: false } },
        y: { ticks: { color: TICK, callback: v => (v < 0 ? '-' : '') + fmtAxis(Math.abs(v)), font: { size: 10 } }, grid: { color: GRID, drawBorder: false } },
      },
    },
  });
}

// ── Indian EQ MF Detailed Report — FIFO engine ───────────────────────────────

function computeFIFOMFMetrics(stream, txns, currentNAV) {
  const sorted = [...txns].sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));

  const lots       = [];   // { remaining: units, costPerUnit }
  let totalInvested  = 0;
  let totalWithdrawn = 0;
  let realizedPnL    = 0;
  const buyDates     = [];
  let firstDate      = null;
  let lastDate       = null;
  const cashflows    = [];
  let hasSells       = false;

  sorted.forEach(t => {
    const date  = new Date(t.txn_date);
    if (isNaN(date)) return;
    const units = parseFloat(t.units || 0);
    const nav   = parseFloat(t.nav   || 0);
    const amt   = getAmtINR(stream, t);

    if (!firstDate) firstDate = date;
    lastDate = date;

    if (t.txn_type === 'Buy') {
      const costPerUnit = units > 1e-6 ? amt / units : nav;
      lots.push({ remaining: units, costPerUnit });
      totalInvested += amt;
      buyDates.push(date);
      cashflows.push({ amount: -amt, date });

    } else {  // Sell / Redeem / SWP
      if (units < 1e-6) return;
      hasSells = true;
      const sellNavPerUnit = units > 1e-6 ? amt / units : nav;
      let toSell = units;
      totalWithdrawn += amt;
      cashflows.push({ amount: amt, date });

      while (toSell > 1e-6 && lots.length > 0) {
        const lot      = lots[0];
        const consumed = Math.min(lot.remaining, toSell);
        realizedPnL   += consumed * (sellNavPerUnit - lot.costPerUnit);
        lot.remaining -= consumed;
        toSell        -= consumed;
        if (lot.remaining < 1e-6) lots.shift();
      }
    }
  });

  const remainingUnits = lots.reduce((s, l) => s + l.remaining, 0);
  const remainingCost  = lots.reduce((s, l) => s + l.remaining * l.costPerUnit, 0);
  const isActive       = remainingUnits > 0.001;
  const currentValue   = isActive && currentNAV > 0 ? remainingUnits * currentNAV : 0;
  const unrealizedPnL  = currentValue > 0 ? currentValue - remainingCost : null;
  const unrealizedPct  = unrealizedPnL !== null && remainingCost > 0
    ? unrealizedPnL / remainingCost * 100 : null;

  const absoluteReturn = totalInvested > 0
    ? (currentValue + totalWithdrawn - totalInvested) / totalInvested * 100 : null;

  // XIRR: for active funds add today's value as terminal CF; inactive funds
  // already have the last sell as their terminal inflow — no addition needed.
  const xirrCfs = [...cashflows];
  if (isActive && currentValue > 0) {
    xirrCfs.push({ amount: currentValue, date: new Date() });
  }
  const xirr = computeXIRR(xirrCfs);

  // Months held: first buy → today (active) or last transaction date (inactive)
  const today   = new Date();
  const endDate = isActive ? today : lastDate;
  const monthsHeld = firstDate
    ? Math.floor((endDate - firstDate) / (30.44 * 86400000)) : null;

  // Avg buy cadence: holding window (first buy → endDate) ÷ number of buys.
  // Reflects how often you buy over the whole period, not just the span between
  // the first and last purchase — e.g. 2 buys held over 6 months → ~90 days.
  let avgDaysBetweenBuys = null;
  if (buyDates.length >= 2 && endDate) {
    avgDaysBetweenBuys = Math.round((endDate - buyDates[0]) / (buyDates.length * 86400000));
  }

  const { currentStreak, longestStreak } = computeSipStreaks(buyDates, today);

  return {
    totalInvested, totalWithdrawn, realizedPnL,
    remainingCost, remainingUnits, currentValue,
    unrealizedPnL, unrealizedPct, isActive,
    absoluteReturn, xirr,
    firstDate, lastDate, monthsHeld,
    avgDaysBetweenBuys, buyCount: buyDates.length, hasSells,
    currentStreak, longestStreak,
  };
}

// Consecutive-month SIP streaks. Buys are collapsed to one point per calendar
// month; two months are "consecutive" if within 45 days. currentStreak = the
// trailing run ending at the latest month (0 if the current month was missed,
// i.e. the last buy is >45 days ago). longestStreak = the longest run ever.
function computeSipStreaks(buyDates, today) {
  if (!buyDates.length) return { currentStreak: 0, longestStreak: 0 };
  // One representative (earliest) date per YYYY-MM, sorted ascending
  const byMonth = {};
  buyDates.forEach(d => {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!byMonth[key] || d < byMonth[key]) byMonth[key] = d;
  });
  const months = Object.values(byMonth).sort((a, b) => a - b);

  let longest = 1, run = 1;
  for (let i = 1; i < months.length; i++) {
    const gap = (months[i] - months[i - 1]) / 86400000;
    run = gap <= 45 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  // Missed the current month → current streak broken
  const daysSinceLast = (today - months[months.length - 1]) / 86400000;
  const currentStreak = daysSinceLast > 45 ? 0 : run;

  return { currentStreak, longestStreak: longest };
}

function buildMFReport(rawData) {
  const entry = rawData.find(e => e.catId === 1 && e.stream?.txnTable === 'equity_transactions');
  if (!entry || !entry.assets?.length) return [];

  const { stream, assets, txns } = entry;

  const assetMap = {};
  assets.forEach(a => { assetMap[String(a.id)] = a; });

  const txnsByAsset = {};
  txns.forEach(t => {
    const aid = String(t[stream.assetIdCol]);
    if (!txnsByAsset[aid]) txnsByAsset[aid] = [];
    txnsByAsset[aid].push(t);
  });

  const funds = [];
  Object.entries(txnsByAsset).forEach(([assetId, assetTxns]) => {
    const asset      = assetMap[assetId];
    if (!asset) return;
    const currentNAV = parseFloat(asset[stream.currentPriceCol] || 0);
    const m          = computeFIFOMFMetrics(stream, assetTxns, currentNAV);
    funds.push({ assetId, name: asset[stream.assetNameCol] || 'Unknown', account: asset.account_id, ...m });
  });

  funds.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.isActive
      ? b.currentValue - a.currentValue
      : b.totalInvested - a.totalInvested;
  });

  return funds;
}

function drawMFReport(divId, rawData) {
  const wrap = document.getElementById(divId);
  if (!wrap) return;

  const funds = buildMFReport(rawData);
  if (!funds.length) {
    wrap.innerHTML = '<p class="chart-empty">No equity mutual fund transactions yet.</p>';
    return;
  }

  function fmtDate(d) {
    if (!d) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
  }
  function fmtPct(v) {
    if (v === null || v === undefined) return '<span style="color:var(--text-muted)">—</span>';
    const cls = v >= 0 ? 'positive' : 'negative';
    return `<span class="${cls}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
  }
  function fmtPnL(v) {
    if (v === null || v === undefined) return '<span style="color:var(--text-muted)">—</span>';
    const cls = v >= 0 ? 'positive' : 'negative';
    return `<span class="${cls}">${v >= 0 ? '+' : ''}${fmtCurrency(v)}</span>`;
  }

  let html = `<div class="report-table-wrap">
  <table class="report-table mf-detail-table">
    <thead><tr>
      <th style="text-align:left">Fund</th>
      <th>Status</th>
      <th>Invested</th>
      <th>Current Value</th>
      <th>Unreal. P&amp;L ₹</th>
      <th>Unreal. %</th>
      <th>Total Invested</th>
      <th>Withdrawn</th>
      <th>Realized P&amp;L</th>
      <th>Abs. Return %</th>
      <th>XIRR</th>
      <th>First Buy</th>
      <th>Last Txn</th>
      <th>Months</th>
      <th>Avg Buy Gap</th>
      <th>SIP Streak</th>
      <th>Longest Streak</th>
    </tr></thead>
    <tbody>`;

  const showAcct = (typeof ACCOUNTS !== 'undefined' && ACCOUNTS.isAll() && ACCOUNTS.list.length > 1);
  funds.forEach(f => {
    const badge = f.isActive
      ? `<span class="mf-badge mf-badge-active">Active</span>`
      : `<span class="mf-badge mf-badge-inactive">Inactive</span>`;
    const acctTag = (showAcct && f.account && ACCOUNTS.name(f.account))
      ? ` <span class="ht-acct-tag">${ACCOUNTS.name(f.account)}</span>` : '';

    const investedDisp = f.isActive
      ? fmtCurrency(f.remainingCost)
      : `<span style="color:var(--text-muted)">₹0</span>`;

    const cvDisp = f.currentValue > 0
      ? fmtCurrency(f.currentValue)
      : `<span style="color:var(--text-muted)">—</span>`;

    const unrealPnL  = f.isActive ? fmtPnL(f.unrealizedPnL) : `<span style="color:var(--text-muted)">—</span>`;
    const unrealPct  = f.isActive ? fmtPct(f.unrealizedPct)  : `<span style="color:var(--text-muted)">—</span>`;

    const realPnL = f.hasSells
      ? fmtPnL(f.realizedPnL)
      : `<span style="color:var(--text-muted)">—</span>`;

    const xirrDisp = f.xirr !== null
      ? `<span class="${f.xirr >= 0 ? 'positive' : 'negative'}">${fmtXIRR(f.xirr)}</span>`
      : `<span style="color:var(--text-muted)">—</span>`;

    html += `<tr class="mf-fund-row" data-fund-id="${f.assetId}">
      <td title="${f.name}"><span class="mf-caret">▸</span>${f.name}${acctTag}</td>
      <td style="text-align:center">${badge}</td>
      <td>${investedDisp}</td>
      <td>${cvDisp}</td>
      <td>${unrealPnL}</td>
      <td>${unrealPct}</td>
      <td>${fmtCurrency(f.totalInvested)}</td>
      <td>${f.totalWithdrawn > 0 ? fmtCurrency(f.totalWithdrawn) : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${realPnL}</td>
      <td>${fmtPct(f.absoluteReturn)}</td>
      <td>${xirrDisp}</td>
      <td style="white-space:nowrap">${fmtDate(f.firstDate)}</td>
      <td style="white-space:nowrap">${fmtDate(f.lastDate)}</td>
      <td>${f.monthsHeld !== null ? f.monthsHeld + 'm' : '—'}</td>
      <td>${f.avgDaysBetweenBuys !== null ? f.avgDaysBetweenBuys + 'd' : '—'}</td>
      <td>${f.currentStreak > 0 ? `<span class="positive">${f.currentStreak}</span>` : '<span style="color:var(--text-muted)">0</span>'}</td>
      <td>${f.longestStreak || 0}</td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  wrap.innerHTML = html;

  // ── Drill-down: rolling SIP journey per fund ──
  const entry = rawData.find(e => e.catId === 1 && e.stream?.txnTable === 'equity_transactions');
  if (!entry) return;
  const txnsByAsset = {}, assetMap = {};
  entry.txns.forEach(t => {
    const aid = String(t[entry.stream.assetIdCol]);
    (txnsByAsset[aid] = txnsByAsset[aid] || []).push(t);
  });
  entry.assets.forEach(a => { assetMap[String(a.id)] = a; });

  wrap.querySelectorAll('.mf-fund-row').forEach(row => {
    row.addEventListener('click', () => {
      const next = row.nextElementSibling;
      if (next && next.classList.contains('mf-drill')) { next.remove(); row.classList.remove('expanded'); return; }
      wrap.querySelectorAll('.mf-drill').forEach(d => d.remove());
      wrap.querySelectorAll('.mf-fund-row.expanded').forEach(r => r.classList.remove('expanded'));

      const fid        = row.dataset.fundId;
      const txns       = txnsByAsset[fid] || [];
      const currentNAV = parseFloat(assetMap[fid]?.[entry.stream.currentPriceCol] || 0);
      const vint       = computeFundVintage(entry.stream, txns, currentNAV);
      const roll       = computeRollingSIP(entry.stream, txns);

      const dr     = document.createElement('tr');
      dr.className = 'mf-drill';
      dr.innerHTML = `<td colspan="${row.cells.length}">${renderFundVintage(vint)}${renderRollingSIP(roll)}</td>`;
      row.after(dr);
      row.classList.add('expanded');
    });
  });
}

// Reconstruct a fund's instalment-by-instalment SIP journey. Value at instalment N
// = units accumulated through the Nth buy × the NAV recorded on that buy.
function computeRollingSIP(stream, txns) {
  const buys = (txns || [])
    .filter(t => t.txn_type === 'Buy' && parseFloat(t.units || 0) > 0)
    .sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));
  const out = [];
  let cumUnits = 0, cumInv = 0;
  const cfs = [];
  const firstDate = buys.length ? buys[0].txn_date : null;
  buys.forEach((t, i) => {
    const units = parseFloat(t.units || 0);
    const nav   = parseFloat(t.nav || 0);
    const amt   = getAmtINR(stream, t);
    cumUnits += units; cumInv += amt;
    cfs.push({ amount: -amt, date: new Date(t.txn_date) });
    const value = nav > 0 ? cumUnits * nav : cumInv;
    const xirr  = computeXIRR([...cfs, { amount: value, date: new Date(t.txn_date) }]);
    out.push({
      n: i + 1, from: firstDate, to: t.txn_date,
      invested: cumInv, value, profit: value - cumInv,
      absReturn: cumInv > 0 ? (value - cumInv) / cumInv * 100 : 0, xirr,
    });
  });
  return out;
}

// Units still held (FIFO, sold units excluded) grouped by the year they were bought,
// valued at today's NAV — "what my money from each year is worth now".
function computeFundVintage(stream, txns, currentNAV) {
  const sorted = [...(txns || [])].sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));
  const lots = [];   // { units, costPerUnit, year }
  sorted.forEach(t => {
    const units = parseFloat(t.units || 0);
    if (units <= 0) return;
    if (t.txn_type === 'Buy') {
      const amt = getAmtINR(stream, t);
      lots.push({ units, costPerUnit: amt / units, year: (t.txn_date || '').substring(0, 4) });
    } else {
      let toSell = units;
      while (toSell > 1e-9 && lots.length) {
        const lot = lots[0];
        const c = Math.min(lot.units, toSell);
        lot.units -= c; toSell -= c;
        if (lot.units < 1e-9) lots.shift();
      }
    }
  });
  const byYear = {};
  lots.forEach(lot => {
    if (!byYear[lot.year]) byYear[lot.year] = { year: lot.year, units: 0, cost: 0 };
    byYear[lot.year].units += lot.units;
    byYear[lot.year].cost  += lot.units * lot.costPerUnit;
  });
  return Object.values(byYear).sort((a, b) => a.year.localeCompare(b.year)).map(v => {
    const currentValue = currentNAV > 0 ? v.units * currentNAV : 0;
    return { ...v, currentValue, profit: currentValue - v.cost, absReturn: v.cost > 0 ? (currentValue - v.cost) / v.cost * 100 : 0 };
  });
}

function renderFundVintage(vint) {
  if (!vint.length) return '<div class="mf-drill-wrap"><p class="chart-empty">No units currently held.</p></div>';
  let h = `<div class="mf-drill-wrap"><div class="mf-drill-title">Held units by buy-year · valued at today's NAV (sold units excluded)</div>
    <table class="report-table"><thead><tr>
      <th style="text-align:left">Buy Year</th><th>Units Held</th><th>Invested (held)</th><th>Current Value</th><th>Profit</th><th>Return</th>
    </tr></thead><tbody>`;
  vint.forEach(v => {
    const pc = v.profit >= 0 ? 'positive' : 'negative';
    h += `<tr>
      <td>${v.year}</td>
      <td>${v.units.toFixed(3)}</td>
      <td>${fmtCurrency(v.cost)}</td>
      <td>${fmtCurrency(v.currentValue)}</td>
      <td class="${pc}">${v.profit >= 0 ? '+' : '-'}${fmtCurrency(Math.abs(v.profit))}</td>
      <td class="${pc}">${v.absReturn >= 0 ? '+' : ''}${v.absReturn.toFixed(1)}%</td>
    </tr>`;
  });
  h += `</tbody></table></div>`;
  return h;
}

function renderRollingSIP(rows) {
  if (!rows.length) return '<div class="mf-drill-wrap"><p class="chart-empty">No buy instalments.</p></div>';
  const my = d => new Date(d).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  let h = `<div class="mf-drill-wrap"><div class="mf-drill-title">Rolling SIP journey · value uses the NAV recorded on each buy</div>
    <table class="report-table"><thead><tr>
      <th style="text-align:left">Instalment</th><th>Period</th><th>Invested</th><th>Value</th><th>Profit</th><th>Abs. Return</th><th>XIRR</th>
    </tr></thead><tbody>`;
  rows.forEach(r => {
    const pc = r.profit >= 0 ? 'positive' : 'negative';
    h += `<tr>
      <td>#${r.n}</td>
      <td>${my(r.from)} – ${my(r.to)}</td>
      <td>${fmtCurrency(r.invested)}</td>
      <td>${fmtCurrency(r.value)}</td>
      <td class="${pc}">${r.profit >= 0 ? '+' : '-'}${fmtCurrency(Math.abs(r.profit))}</td>
      <td class="${pc}">${r.absReturn >= 0 ? '+' : ''}${r.absReturn.toFixed(1)}%</td>
      <td>${r.xirr !== null ? `<span class="${r.xirr >= 0 ? 'positive' : 'negative'}">${fmtXIRR(r.xirr)}</span>` : '—'}</td>
    </tr>`;
  });
  h += `</tbody></table></div>`;
  return h;
}

// ── Cumulative line ───────────────────────────────────────────────────────────

function drawCumulativeChart(allMonthlyNet, totalCurrentValue) {
  const months = Object.keys(allMonthlyNet).sort();
  if (!months.length) return emptyCard('chart-cumulative', 'No transactions in selected period.');
  let running = 0;
  const cumData = months.map(m => { running += allMonthlyNet[m]; return Math.round(running); });

  const datasets = [{
    label: 'Invested (cost basis)',
    data: cumData,
    borderColor: '#f59e0b',
    backgroundColor: 'rgba(245,158,11,0.07)',
    fill: true,
    tension: 0.4,
    pointRadius: months.length > 30 ? 0 : 3,
    pointHoverRadius: 6,
    pointBackgroundColor: '#f59e0b',
    pointBorderColor: '#111111',
    pointBorderWidth: 2,
    borderWidth: 2.5,
  }];

  // Current value: only known as of today (no historical prices), so drawn as a
  // dashed reference line across the period with an emphasised endpoint. The gap
  // to the invested line = current unrealised gain/loss.
  if (totalCurrentValue > 0) {
    datasets.push({
      label: 'Current Value (today)',
      data: months.map(() => Math.round(totalCurrentValue)),
      borderColor: '#22c55e',
      backgroundColor: 'transparent',
      borderDash: [6, 4],
      borderWidth: 2,
      fill: false,
      tension: 0,
      pointRadius: months.map((_, i) => i === months.length - 1 ? 6 : 0),
      pointHoverRadius: 8,
      pointBackgroundColor: '#22c55e',
      pointBorderColor: '#111111',
      pointBorderWidth: 2,
    });
  }

  newChart('chart-cumulative', {
    type: 'line',
    data: {
      labels: months.map(monthLabel),
      datasets,
    },
    options: {
      responsive: true,
      plugins: {
        datalabels: { display: false },
        legend: { position: 'top', labels: { color: '#8b90a8', padding: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: ctx => ctx.raw !== null ? ` ${ctx.dataset.label}: ${fmtCurrency(ctx.raw)}` : null } },
      },
      scales: {
        x: { ticks: { color: '#525252', maxTicksLimit: 14, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false } },
        y: { ticks: { color: '#525252', callback: fmtAxis, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false }, beginAtZero: true },
      },
    },
  });
}

// ── Profit by Investment Year (vintage / cohort P&L) ──────────────────────────

// Resolve an asset's current price in INR (GAS formula, manual price, or formula col).
function resolvePriceINR(stream, asset, assetId) {
  if (stream.currentPriceCol) return parseFloat(asset?.[stream.currentPriceCol] || 0);
  if (stream.manualPriceType) {
    if (asset?.price_fetch_way === 'formula') return parseFloat(asset?.current_price || 0);
    return _manualPricesMap[`${stream.manualPriceType}|${assetId}`] || 0;
  }
  return 0;
}

// FIFO lots tagged with buy-year. Attributes realised P&L (on sells) and unrealised
// P&L (on remaining lots) to the year the money was invested.
function computeVintageProfit(filteredData) {
  const byYear = {};
  const add = (yr, k, v) => {
    if (!yr) return;
    (byYear[yr] = byYear[yr] || { invested: 0, currentValue: 0, realized: 0, unrealized: 0 })[k] += v;
  };

  filteredData.forEach(entry => {
    const { stream, assets, txns } = entry;
    if (stream.staticBalance) return;

    const assetMap = {};
    assets.forEach(a => { assetMap[String(a.id)] = a; });

    const byAsset = {};
    txns.forEach(t => {
      const aid = String(t[stream.assetIdCol]);
      (byAsset[aid] = byAsset[aid] || []).push(t);
    });

    Object.entries(byAsset).forEach(([aid, list]) => {
      const asset    = assetMap[aid];
      const priceINR = resolvePriceINR(stream, asset, aid);
      const sorted   = [...list].sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));
      const lots     = [];   // { units, costPerUnit (INR), year }

      sorted.forEach(t => {
        const isBuy = stream.usEquity ? String(t.txn_type).toUpperCase() === 'BUY' : t.txn_type === 'Buy';
        const units = stream.usEquity ? parseFloat(t.units || 0) : getQtyVal(t);
        if (!units || units <= 0) return;
        const yr = (t.txn_date || '').substring(0, 4);

        if (isBuy) {
          const costINR = stream.usEquity ? parseFloat(t[stream.costBasisCol] || 0) : getAmtINR(stream, t);
          lots.push({ units, costPerUnit: costINR / units, year: yr });
        } else {
          // Sell: FIFO consume. Realised P&L in INR only for rupee streams
          // (US equity sells settle in USD inside the broker — excluded here).
          const sellPerUnit = stream.usEquity ? null : getAmtINR(stream, t) / units;
          let toSell = units;
          while (toSell > 1e-9 && lots.length) {
            const lot = lots[0];
            const c   = Math.min(lot.units, toSell);
            if (sellPerUnit != null) add(lot.year, 'realized', c * (sellPerUnit - lot.costPerUnit));
            lot.units -= c;
            toSell    -= c;
            if (lot.units < 1e-9) lots.shift();
          }
        }
      });

      // Remaining lots → invested + unrealised, by vintage year
      lots.forEach(lot => {
        const cost = lot.units * lot.costPerUnit;
        add(lot.year, 'invested', cost);
        if (priceINR > 0) {
          const cv = lot.units * priceINR;
          add(lot.year, 'currentValue', cv);
          add(lot.year, 'unrealized', cv - cost);
        }
      });
    });
  });

  return byYear;
}

function drawVintageChart(canvasId, filteredData) {
  const byYear = computeVintageProfit(filteredData);
  const years = Object.keys(byYear).filter(Boolean).sort();
  if (!years.length) return emptyCard(canvasId, 'No investment history yet.');

  const realized   = years.map(y => Math.round(byYear[y].realized));
  const unrealized = years.map(y => Math.round(byYear[y].unrealized));
  const GRID = 'rgba(255,255,255,0.05)', TICK = '#525252';

  newChart(canvasId, {
    type: 'bar',
    data: {
      labels: years,
      datasets: [
        { label: 'Unrealized', data: unrealized, stack: 'pnl', borderRadius: 4,
          backgroundColor: unrealized.map(v => v >= 0 ? 'rgba(34,197,94,0.78)' : 'rgba(239,68,68,0.72)') },
        { label: 'Realized',   data: realized,   stack: 'pnl', borderRadius: 4,
          backgroundColor: realized.map(v => v >= 0 ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.42)') },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        datalabels: { display: false },
        legend: { position: 'top', labels: { color: TICK, usePointStyle: true, padding: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.raw >= 0 ? '+' : ''}${fmtCurrency(ctx.raw)}`,
            afterBody: items => {
              const d = byYear[items[0].label];
              const total = d.realized + d.unrealized;
              return [
                `Invested (still held): ${fmtCurrency(d.invested)}`,
                `Total P&L: ${total >= 0 ? '+' : ''}${fmtCurrency(total)}`,
              ];
            },
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: TICK, font: { size: 11 } }, grid: { color: GRID, drawBorder: false } },
        y: { stacked: true, ticks: { color: TICK, callback: v => (v < 0 ? '-' : '') + fmtAxis(Math.abs(v)), font: { size: 10 } }, grid: { color: GRID, drawBorder: false } },
      },
    },
  });
}

// ── Health Check (rule-based advisory flags, Overview tab) ────────────────────

const XIRR_BENCHMARK = 0.12;   // assumed passive-index benchmark (Nifty ~TRI)

function buildHealthCheck(agg, filtered, rawData) {
  const flags = [];
  const cv = c => (c && c.currentValue > 0) ? c.currentValue : (c && c.netCost) || 0;
  const totalVal = agg.totalCurrentValue > 0 ? agg.totalCurrentValue : agg.netInvested;

  // XIRR vs benchmark
  if (agg.overallXIRR !== null) {
    const x = agg.overallXIRR;
    flags.push({
      level: x >= XIRR_BENCHMARK ? 'good' : (x >= XIRR_BENCHMARK - 0.03 ? 'warn' : 'bad'),
      text: `Overall XIRR ${fmtXIRR(x)} vs ~${(XIRR_BENCHMARK * 100).toFixed(0)}% index benchmark — ${x >= XIRR_BENCHMARK ? 'ahead of a passive index' : 'trailing a passive index'}.`,
    });
  }

  // Core vs Satellite
  const SATELLITE = new Set(['Cryptocurrency', 'US Equity', 'US Equity (IndMoney)']);
  let satVal = 0;
  Object.entries(agg.byCategory).forEach(([name, c]) => { if (SATELLITE.has(name)) satVal += cv(c); });
  satVal += cv(agg.bySubcat['Small Cap'] || {});
  const satPct = totalVal > 0 ? satVal / totalVal * 100 : 0;
  flags.push({
    level: satPct > 30 ? 'warn' : 'good',
    text: `Satellite/high-risk assets (crypto, small-cap, US) are ${satPct.toFixed(0)}% of the portfolio${satPct > 30 ? ' — above a ~30% comfort band' : ' — within a healthy band'}.`,
  });

  // (Cap-split vs 47/35/17 target intentionally omitted — user uses a custom split.)

  // Equity drift (Wealth Builder bucket, id 1)
  const equityPct = totalVal > 0 ? cv(agg.byBucket[1] || {}) / totalVal * 100 : 0;
  if (equityPct > 70) flags.push({ level: 'warn', text: `Equity (Wealth Builder) is ${equityPct.toFixed(0)}% — beyond a 70% drift limit; consider rebalancing.` });

  // Concentration (top 5 holdings)
  const top5 = (agg.topHoldings || []).slice(0, 5).reduce((s, h) => s + (h.currentValue > 0 ? h.currentValue : h.netCost), 0);
  const top5Pct = totalVal > 0 ? top5 / totalVal * 100 : 0;
  flags.push({
    level: top5Pct > 60 ? 'warn' : 'good',
    text: `Top 5 holdings = ${top5Pct.toFixed(0)}% of portfolio${top5Pct > 60 ? ' — concentration risk' : ' — reasonably diversified'}.`,
  });

  // Idle US cash
  const usCash = cv(agg.bySubcat['Cash'] || {});
  if (usCash > 1000) flags.push({ level: 'warn', text: `${fmtCurrency(usCash)} sitting as uninvested US cash — not yet deployed.` });

  // Best / worst vintage
  const vy = computeVintageProfit(filtered);
  const vyears = Object.keys(vy).filter(Boolean).map(y => ({ y, p: vy[y].realized + vy[y].unrealized }));
  if (vyears.length) {
    vyears.sort((a, b) => b.p - a.p);
    const best = vyears[0], worst = vyears[vyears.length - 1];
    flags.push({ level: 'good', text: `Best vintage: ${best.y} investments → ${best.p >= 0 ? '+' : ''}${fmtCurrency(best.p)} P&L.` });
    if (worst.y !== best.y) flags.push({ level: worst.p < 0 ? 'bad' : 'info', text: `Weakest vintage: ${worst.y} → ${worst.p >= 0 ? '+' : ''}${fmtCurrency(worst.p)} P&L.` });
  }

  // Underperforming active MF funds (XIRR < 8%)
  const laggards = buildMFReport(rawData).filter(f => f.isActive && f.xirr !== null && f.xirr < 0.08);
  if (laggards.length) {
    const names = laggards.slice(0, 3).map(f => f.name.split(' ').slice(0, 3).join(' ')).join(', ');
    flags.push({ level: 'warn', text: `${laggards.length} active fund${laggards.length > 1 ? 's' : ''} with XIRR under 8% (${names}${laggards.length > 3 ? '…' : ''}) — review vs benchmark.` });
  }

  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  flags.sort((a, b) => order[a.level] - order[b.level]);

  const card = document.createElement('div');
  card.className = 'chart-card chart-card-full';
  card.innerHTML = `<div class="chart-card-title">Health Check</div>
    <div class="healthcheck-list">
      ${flags.map(f => `<div class="hc-item hc-${f.level}"><span class="hc-dot"></span><span>${f.text}</span></div>`).join('')}
    </div>
    <p class="report-disclaimer">Heuristic checks against generic targets — not personalised advice. Benchmark is an assumed ${(XIRR_BENCHMARK * 100).toFixed(0)}% (no live index feed).</p>`;
  return card;
}

// ── Core vs Satellite allocation table ────────────────────────────────────────

function drawCoreSatellite(divId, agg) {
  const wrap = document.getElementById(divId);
  if (!wrap) return;
  const cv = c => (c && c.currentValue > 0) ? c.currentValue : (c && c.netCost) || 0;
  const SATELLITE = new Set(['Cryptocurrency', 'US Equity', 'US Equity (IndMoney)']);

  let core = 0, sat = 0;
  Object.entries(agg.byCategory).forEach(([name, c]) => {
    const v = cv(c);
    if (SATELLITE.has(name)) sat += v; else core += v;
  });
  const smallCap = cv(agg.bySubcat['Small Cap'] || {});   // reclassify small-cap as satellite
  core -= smallCap; sat += smallCap;

  const total = core + sat;
  if (total <= 0) { wrap.innerHTML = '<p class="chart-empty">No data.</p>'; return; }

  const rows = [
    { label: 'Core Wealth Accumulators', note: 'Large/Mid/Flexi/Index MF · Debt · Gold · Real Estate', val: Math.max(0, core) },
    { label: 'Satellite / Speculative',  note: 'Crypto · Small-cap · US equity',                         val: sat },
  ];
  let html = `<div class="report-table-wrap"><table class="report-table"><thead><tr>
    <th style="text-align:left">Bucket</th><th>Value</th><th>%</th><th></th></tr></thead><tbody>`;
  rows.forEach(r => {
    const pct = r.val / total * 100;
    html += `<tr>
      <td>${r.label}<div class="cs-note">${r.note}</div></td>
      <td>${fmtCurrency(r.val)}</td>
      <td>${pct.toFixed(1)}%</td>
      <td style="width:130px"><div class="comp-bar"><div class="comp-bar-fill" style="width:${Math.min(100, pct).toFixed(1)}%"></div></div></td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  wrap.innerHTML = html;
}

// ── Rolling XIRR trend ────────────────────────────────────────────────────────
// Monthly portfolio value is reconstructed by carrying forward the INR price
// recorded on each transaction (amount ÷ units); the current month uses the live
// price. Rupee streams only (US-equity USD & static balances excluded). Approximate.

function _pctOrNull(r) { return r !== null ? r * 100 : null; }

function _rollingXirr(cashflows, monthEnd, windowMonths, valueAt) {
  const start = new Date(monthEnd.getFullYear(), monthEnd.getMonth() - windowMonths + 1, 0);
  const startVal = valueAt(start, false);
  const cfs = [];
  if (startVal > 0) cfs.push({ amount: -startVal, date: start });
  cashflows.forEach(c => { if (c.date > start && c.date <= monthEnd) cfs.push({ amount: c.amount, date: c.date }); });
  const endVal = valueAt(monthEnd, false);
  if (endVal <= 0 || !cfs.length) return null;
  cfs.push({ amount: endVal, date: monthEnd });
  return _pctOrNull(computeXIRR(cfs));
}

function computeXirrTrend(filteredData) {
  const assets = [];       // { events:[{date,units,price}], curPriceINR }
  const cashflows = [];
  let minDate = null;

  filteredData.forEach(entry => {
    const { stream, assets: rows, txns } = entry;
    if (stream.usEquity || stream.staticBalance) return;
    const assetMap = {};
    rows.forEach(a => { assetMap[String(a.id)] = a; });
    const byAsset = {};
    txns.forEach(t => { const aid = String(t[stream.assetIdCol]); (byAsset[aid] = byAsset[aid] || []).push(t); });

    Object.entries(byAsset).forEach(([aid, list]) => {
      const sorted = list.filter(t => t.txn_date).sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));
      const events = [];
      sorted.forEach(t => {
        const units = getQtyVal(t); if (!units) return;
        const d = new Date(t.txn_date); if (isNaN(d)) return;
        const amt = getAmtINR(stream, t);
        if (!minDate || d < minDate) minDate = d;
        events.push({ date: d, units: t.txn_type === 'Buy' ? units : -units, price: units > 0 ? amt / units : 0 });
        cashflows.push({ date: d, amount: t.txn_type === 'Buy' ? -amt : amt });
      });
      if (events.length) assets.push({ events, curPriceINR: parseFloat(assetMap[aid]?.[stream.currentPriceCol] || 0) });
    });
  });

  if (!minDate || !assets.length) return { months: [], sinceInception: [], roll1: [], roll3: [] };

  const today = new Date();
  const months = [];
  let y = minDate.getFullYear(), m = minDate.getMonth();
  while (y < today.getFullYear() || (y === today.getFullYear() && m <= today.getMonth())) {
    months.push(new Date(y, m + 1, 0));
    if (++m > 11) { m = 0; y++; }
  }

  const valueAt = (monthEnd, isCurrent) => {
    let val = 0;
    assets.forEach(a => {
      let units = 0, lastPrice = 0;
      a.events.forEach(ev => { if (ev.date <= monthEnd) { units += ev.units; lastPrice = ev.price; } });
      if (units > 1e-9) val += units * ((isCurrent && a.curPriceINR > 0) ? a.curPriceINR : lastPrice);
    });
    return val;
  };

  const sinceInception = [], roll1 = [], roll3 = [];
  months.forEach((me, idx) => {
    const isCurrent = idx === months.length - 1;
    const cfsSI = cashflows.filter(c => c.date <= me).map(c => ({ amount: c.amount, date: c.date }));
    cfsSI.push({ amount: valueAt(me, isCurrent), date: me });
    sinceInception.push(_pctOrNull(computeXIRR(cfsSI)));
    roll1.push(idx >= 11 ? _rollingXirr(cashflows, me, 12, valueAt) : null);
    roll3.push(idx >= 35 ? _rollingXirr(cashflows, me, 36, valueAt) : null);
  });
  return { months, sinceInception, roll1, roll3 };
}

function drawXirrTrend(canvasId, filteredData) {
  const t = computeXirrTrend(filteredData);
  if (t.months.length < 2) return emptyCard(canvasId, 'Not enough history for an XIRR trend.');
  const labels = t.months.map(d => d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }));
  const mk = (label, data, color, dash) => ({
    label, data, borderColor: color, backgroundColor: 'transparent',
    borderWidth: 2, borderDash: dash || [], tension: 0.3, pointRadius: 0, pointHoverRadius: 5, spanGaps: true,
  });
  const datasets = [mk('Since inception', t.sinceInception, '#f59e0b')];
  if (t.roll1.some(v => v != null)) datasets.push(mk('1Y rolling', t.roll1, '#22c55e', [5, 4]));
  if (t.roll3.some(v => v != null)) datasets.push(mk('3Y rolling', t.roll3, '#818cf8', [2, 3]));

  newChart(canvasId, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        datalabels: { display: false },
        legend: { position: 'top', labels: { color: '#8b90a8', usePointStyle: true, padding: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => ctx.raw != null ? ` ${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%` : null } },
      },
      scales: {
        x: { ticks: { color: '#525252', maxTicksLimit: 14, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false } },
        y: { ticks: { color: '#525252', callback: v => v.toFixed(0) + '%', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false } },
      },
    },
  });
}
