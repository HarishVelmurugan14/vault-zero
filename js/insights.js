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

const INSIGHT_FILTERS = {
  catName:   '',
  subcatName:'',
  assetKey:  '',   // "streamIdx|assetId"
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
      Object.keys(INSIGHT_FILTERS).forEach(k => INSIGHT_FILTERS[k] = '');
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

function buildFilterBar(filterArea, rawData, chartsArea) {
  filterArea.innerHTML = '';

  const bar = document.createElement('div');
  bar.className = 'insights-filter-bar';

  // ── Category
  const catSel = makeFilterGroup('Category', 'icat');
  catSel.select.innerHTML = '<option value="">All Categories</option>';
  const catNames = [...new Set(rawData.map(e => e.catName))];
  catNames.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    if (INSIGHT_FILTERS.catName === c) o.selected = true;
    catSel.select.appendChild(o);
  });

  // ── Subcategory
  const subcatSel = makeFilterGroup('Subcategory', 'isubcat');

  // ── Asset
  const assetSel = makeFilterGroup('Asset', 'iasset');

  // ── Year
  const yearSel = makeFilterGroup('Year', 'iyear');
  yearSel.select.innerHTML = '<option value="">All Years</option>';
  const allYears = getAllYears(rawData);
  allYears.forEach(y => {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    if (INSIGHT_FILTERS.year === y) o.selected = true;
    yearSel.select.appendChild(o);
  });

  // ── From month-year
  const fromGroup = makeMonthGroup('From', 'ifrom', INSIGHT_FILTERS.fromMonth);

  // ── To month-year
  const toGroup = makeMonthGroup('To', 'ito', INSIGHT_FILTERS.toMonth);

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
    Object.keys(INSIGHT_FILTERS).forEach(k => INSIGHT_FILTERS[k] = '');
    buildFilterBar(filterArea, rawData, chartsArea);
    redrawCharts(chartsArea, rawData);
  });
  clearWrap.appendChild(clearSpacer);
  clearWrap.appendChild(clearBtn);

  bar.appendChild(catSel.group);
  bar.appendChild(subcatSel.group);
  bar.appendChild(assetSel.group);
  bar.appendChild(yearSel.group);
  bar.appendChild(fromGroup);
  bar.appendChild(toGroup);
  bar.appendChild(clearWrap);
  filterArea.appendChild(bar);

  // Populate cascades on load
  populateSubcats(subcatSel.select, assetSel.select, rawData);
  populateAssets(assetSel.select, rawData);

  // ── Wire events ──────────────────────────────────────────

  catSel.select.addEventListener('change', () => {
    INSIGHT_FILTERS.catName    = catSel.select.value;
    INSIGHT_FILTERS.subcatName = '';
    INSIGHT_FILTERS.assetKey   = '';
    populateSubcats(subcatSel.select, assetSel.select, rawData);
    populateAssets(assetSel.select, rawData);
    redrawCharts(chartsArea, rawData);
  });

  subcatSel.select.addEventListener('change', () => {
    INSIGHT_FILTERS.subcatName = subcatSel.select.value;
    INSIGHT_FILTERS.assetKey   = '';
    populateAssets(assetSel.select, rawData);
    redrawCharts(chartsArea, rawData);
  });

  assetSel.select.addEventListener('change', () => {
    INSIGHT_FILTERS.assetKey = assetSel.select.value;
    redrawCharts(chartsArea, rawData);
  });

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

function populateSubcats(subcatSel, assetSel, rawData) {
  subcatSel.innerHTML = '<option value="">All Subcategories</option>';
  const catFilter = INSIGHT_FILTERS.catName;
  const subcats = new Set();

  rawData.forEach(entry => {
    if (catFilter && entry.catName !== catFilter) return;
    entry.assets.forEach(a => {
      const s = SUBCAT_NAMES[a.subcategory_id];
      if (s) subcats.add(s);
    });
  });

  [...subcats].sort().forEach(s => {
    const o = document.createElement('option');
    o.value = s; o.textContent = s;
    if (INSIGHT_FILTERS.subcatName === s) o.selected = true;
    subcatSel.appendChild(o);
  });

  subcatSel.disabled = subcats.size === 0;
}

function populateAssets(assetSel, rawData) {
  assetSel.innerHTML = '<option value="">All Assets</option>';
  const catFilter    = INSIGHT_FILTERS.catName;
  const subcatFilter = INSIGHT_FILTERS.subcatName;
  const seen = new Set();

  rawData.forEach((entry, idx) => {
    if (catFilter && entry.catName !== catFilter) return;
    entry.assets.forEach(a => {
      if (subcatFilter) {
        const s = SUBCAT_NAMES[a.subcategory_id] || '';
        if (s !== subcatFilter) return;
      }
      const name = a[entry.stream.assetNameCol] || '';
      if (!name || seen.has(name)) return;
      seen.add(name);
      const key = `${idx}|${a.id}`;
      const o = document.createElement('option');
      o.value = key; o.textContent = name;
      if (INSIGHT_FILTERS.assetKey === key) o.selected = true;
      assetSel.appendChild(o);
    });
  });

  assetSel.disabled = seen.size === 0;
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
  const { catName, subcatName, assetKey, fromMonth, toMonth } = INSIGHT_FILTERS;

  // Parse assetKey → { entryIdx, assetId }
  let assetEntryIdx = null, assetId = null;
  if (assetKey) {
    const [i, id] = assetKey.split('|');
    assetEntryIdx = parseInt(i);
    assetId = id;
  }

  return rawData
    .map((entry, idx) => {
      // Category filter
      if (catName && entry.catName !== catName) return null;

      // Asset filter (restrict to a specific entry's asset)
      if (assetEntryIdx !== null && idx !== assetEntryIdx) return null;

      // Filter assets
      let assets = entry.assets;
      if (subcatName) {
        assets = assets.filter(a => (SUBCAT_NAMES[a.subcategory_id] || '') === subcatName);
      }
      if (assetId) {
        assets = assets.filter(a => String(a.id) === String(assetId));
      }
      if (!assets.length) return null;

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

function makeSectionHeader(title, color) {
  const section = document.createElement('div');
  section.className = 'insights-section';
  section.innerHTML = `
    <div class="insights-section-header">
      <div class="insights-section-dot" style="--sd-color:${color}"></div>
      <div class="insights-section-title">${title}</div>
    </div>
  `;
  return section;
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

  // Hero + Metric Strip
  chartsArea.appendChild(buildPortfolioHero(agg));
  chartsArea.appendChild(buildMetricStrip(agg));

  // ── ALLOCATION ────────────────────────────────────────────
  const allocSection = makeSectionHeader('Allocation', '#f59e0b');
  const allocRow1 = document.createElement('div');
  allocRow1.className = 'insights-grid-2';
  allocRow1.appendChild(makeChartCard('Portfolio by Bucket', 'chart-bucket'));
  allocRow1.appendChild(makeChartCard('Portfolio by Category', 'chart-category'));
  allocSection.appendChild(allocRow1);
  const allocRow2 = document.createElement('div');
  allocRow2.className = 'insights-grid-2';
  allocRow2.appendChild(makeChartCard('Portfolio by Subcategory', 'chart-subcat'));
  allocRow2.appendChild(makeChartCard('Allocation by Current Value', 'chart-alloc-cv'));
  allocSection.appendChild(allocRow2);
  chartsArea.appendChild(allocSection);

  // ── PERFORMANCE ───────────────────────────────────────────
  const perfSection = makeSectionHeader('Performance', '#0891b2');
  perfSection.appendChild(makeReportCard('Stream-wise P&L', 'report-stream-table', true));
  perfSection.appendChild(makeChartCard('Portfolio Growth', 'chart-cumulative', true));
  const perfRow = document.createElement('div');
  perfRow.className = 'insights-grid-2';
  perfRow.appendChild(makeChartCard('Monthly Investment', 'chart-monthly'));
  perfRow.appendChild(makeChartCard('Yearly Summary', 'chart-yearly'));
  perfSection.appendChild(perfRow);
  chartsArea.appendChild(perfSection);

  // ── RISK & LIQUIDITY ──────────────────────────────────────
  const riskSection = makeSectionHeader('Risk & Liquidity', '#d97706');
  riskSection.appendChild(makeReportCard('Liquidity Ladder', 'report-liquidity', true));
  const riskRow = document.createElement('div');
  riskRow.className = 'insights-grid-2';
  riskRow.appendChild(makeChartCard('Currency Exposure', 'chart-currency'));
  riskRow.appendChild(makeChartCard('Equity Cap Split (Actual vs Target)', 'chart-capsplit'));
  riskSection.appendChild(riskRow);
  const riskRow2 = document.createElement('div');
  riskRow2.className = 'insights-grid-2';
  riskRow2.appendChild(makeChartCard('Top 10 Holdings', 'chart-top-holdings'));
  riskRow2.appendChild(makeChartCard('Realized P&L by Category', 'chart-pnl'));
  riskSection.appendChild(riskRow2);
  chartsArea.appendChild(riskSection);

  // ── TAX INTELLIGENCE ──────────────────────────────────────
  const taxSection = makeSectionHeader('Tax Intelligence', '#a855f7');
  taxSection.appendChild(makeReportCard('Estimated Tax Liability', 'report-tax-table', true));
  chartsArea.appendChild(taxSection);

  requestAnimationFrame(() => {
    drawBucketChart(agg.byBucket);
    drawCategoryChart(agg.byCategory);
    drawSubcatChart(agg.bySubcat);
    drawAllocCvChart(agg.byCategory);
    drawStreamTable('report-stream-table', agg);
    drawCumulativeChart(agg.allMonthlyNet, agg.totalCurrentValue);
    drawMonthlyChart(agg.byMonth);
    drawYearlyChart(agg.byYear);
    drawLiquidityLadder('report-liquidity', agg.byCategory, agg.netInvested);
    drawCurrencyChart('chart-currency', agg.byCategory);
    drawCapSplitChart('chart-capsplit', agg.bySubcat);
    drawTopHoldingsChart(agg.topHoldings);
    drawPnLChart(agg.byCategory);
    drawTaxTable('report-tax-table', agg.byCategory);
  });
}

// ── Data Fetching ─────────────────────────────────────────────────────────────

const ENTRIES = [
  { catId: 1, catName: 'Indian EQ MF',              bucketId: 1, stream: STREAMS.equity_mf,               subcatName: null },
  { catId: 2, catName: 'Indian Equity Stocks',      bucketId: 1, stream: STREAMS.indian_stocks,            subcatName: null },
  { catId: 3, catName: 'US Equity Stocks',           bucketId: 1, stream: STREAMS.us_stocks,                subcatName: null },
  { catId: 4, catName: 'Real Estate',                bucketId: 1, stream: STREAMS.real_estate,              subcatName: null },
  { catId: 5, catName: 'Debt & Hybrid MF',           bucketId: 2, stream: STREAMS.debt_hybrid_mf,           subcatName: null },
  { catId: 6, catName: 'Precious Metals (Digital)',  bucketId: 3, stream: STREAMS.precious_metals_digital,  subcatName: 'Digital' },
  { catId: 6, catName: 'Precious Metals (Physical)', bucketId: 3, stream: STREAMS.precious_metals_physical, subcatName: 'Physical' },
  { catId: 7, catName: 'Cryptocurrency',              bucketId: 3, stream: STREAMS.crypto,                   subcatName: null },
  { catId: 8, catName: 'Indian EQ MF SIP',           bucketId: 1, stream: STREAMS.equity_sip,               subcatName: null },
  { catId: 9, catName: 'Debt & Hybrid MF SIP',       bucketId: 2, stream: STREAMS.debt_hybrid_sip,          subcatName: null },
];

async function fetchAllInsightsData() {
  const cached = LSC.get('insights');
  if (cached) {
    _manualPricesMap = cached.manualPrices || {};
    return cached.entries;
  }

  let data;
  const allSheets = [...new Set(ENTRIES.flatMap(e => [e.stream.assetTable, e.stream.txnTable])), 'manual_prices'];

  try {
    const res = await API.batchGet(allSheets);
    _manualPricesMap = buildManualPricesMap(res['manual_prices']?.rows || []);
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
  }

  LSC.set('insights', { entries: data, manualPrices: _manualPricesMap });
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
  const byMonth       = {};
  const byYear        = {};
  const allMonthlyNet = {};
  const topHoldings   = [];
  const allCashflows  = [];

  filteredData.forEach(entry => {
    const { catName, bucketId, subcatName, stream, assets, txns } = entry;
    const bucket = BUCKETS.find(b => b.id === bucketId);

    if (!byCategory[catName]) byCategory[catName] = { netCost: 0, realizedPnL: 0, totalBought: 0, totalSold: 0, cashflows: [], firstBuyDate: null };
    if (!byBucket[bucketId])  byBucket[bucketId]  = { name: bucket?.name || '', netCost: 0 };

    const assetMap = {};
    assets.forEach(a => { assetMap[String(a.id)] = a; });

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
        topHoldings.push({ name: asset[stream.assetNameCol], catName, netCost: m.netCost, currentValue: curVal });
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
    byCategory, byBucket, bySubcat, byMonth, byYear,
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
  'US Equity Stocks':          '🇺🇸',
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
  { label: '3-5 Days', color: '#3b82f6', cats: ['Indian EQ MF', 'Debt & Hybrid MF', 'US Equity Stocks', 'Precious Metals (Digital)'] },
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
  'US Equity Stocks':          'USD',
  'Cryptocurrency':            'Crypto',
  'Indian EQ MF SIP':          'INR',
  'Debt & Hybrid MF SIP':      'INR',
};

const TAX_CONFIG = {
  'Indian EQ MF':              { ltcgMonths: 12, ltcgRate: 0.10, stcgRate: 0.15 },
  'Indian Equity Stocks':      { ltcgMonths: 12, ltcgRate: 0.10, stcgRate: 0.15 },
  'US Equity Stocks':          { ltcgMonths: 24, ltcgRate: 0.20, stcgRate: 0.30 },
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
  const labels = topHoldings.map(h => h.name.length > 22 ? h.name.substring(0, 20) + '…' : h.name);
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
        tooltip: { callbacks: { title: ctx => topHoldings[ctx[0].dataIndex].name, label: ctx => ` ${fmtCurrency(ctx.raw)}` } },
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

// ── Cumulative line ───────────────────────────────────────────────────────────

function drawCumulativeChart(allMonthlyNet, totalCurrentValue) {
  const months = Object.keys(allMonthlyNet).sort();
  if (!months.length) return emptyCard('chart-cumulative', 'No transactions in selected period.');
  let running = 0;
  const cumData = months.map(m => { running += allMonthlyNet[m]; return Math.round(running); });

  const datasets = [{
    label: 'Cost Basis',
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

  if (totalCurrentValue > 0) {
    const cvData = months.map((_, i) => i === months.length - 1 ? Math.round(totalCurrentValue) : null);
    datasets.push({
      label: 'Portfolio Value',
      data: cvData,
      borderColor: '#22c55e',
      backgroundColor: 'transparent',
      borderWidth: 0,
      pointRadius: months.map((_, i) => i === months.length - 1 ? 8 : 0),
      pointHoverRadius: 10,
      pointBackgroundColor: '#22c55e',
      pointBorderColor: '#111111',
      pointBorderWidth: 2,
      spanGaps: false,
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
