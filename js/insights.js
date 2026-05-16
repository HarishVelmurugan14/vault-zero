// VaultZero — Insights & Analytics

let _insightsCache = null;
let _insightsCharts = [];

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

function drawCharts(chartsArea, rawData) {
  const filtered = applyFilters(rawData);
  const agg = aggregateInsights(filtered);

  chartsArea.innerHTML = '';

  chartsArea.appendChild(buildSummaryCards(agg));

  const donutRow = document.createElement('div');
  donutRow.className = 'insights-grid-2';
  donutRow.appendChild(makeChartCard('Portfolio by Bucket', 'chart-bucket'));
  donutRow.appendChild(makeChartCard('Portfolio by Category', 'chart-category'));
  chartsArea.appendChild(donutRow);

  chartsArea.appendChild(makeChartCard('Monthly Investment', 'chart-monthly', true));
  chartsArea.appendChild(makeChartCard('Yearly Summary', 'chart-yearly', true));

  const midRow = document.createElement('div');
  midRow.className = 'insights-grid-2';
  midRow.appendChild(makeChartCard('Top 10 Holdings', 'chart-top-holdings'));
  midRow.appendChild(makeChartCard('Realized P&L by Category', 'chart-pnl'));
  chartsArea.appendChild(midRow);

  chartsArea.appendChild(makeChartCard('Cumulative Net Investment', 'chart-cumulative', true));

  if (typeof Chart !== 'undefined') {
    Chart.defaults.color = '#8b90a8';
    Chart.defaults.borderColor = 'rgba(46,50,72,0.6)';
    Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    Chart.defaults.font.size = 12;
  }

  requestAnimationFrame(() => {
    drawBucketChart(agg.byBucket);
    drawCategoryChart(agg.byCategory);
    drawMonthlyChart(agg.byMonth);
    drawYearlyChart(agg.byYear);
    drawTopHoldingsChart(agg.topHoldings);
    drawPnLChart(agg.byCategory);
    drawCumulativeChart(agg.allMonthlyNet);
  });
}

// ── Data Fetching ─────────────────────────────────────────────────────────────

async function fetchAllInsightsData() {
  const ENTRIES = [
    { catId: 1, catName: 'Indian EQ MF',               bucketId: 1, stream: STREAMS.equity_mf },
    { catId: 2, catName: 'Indian Equity Stocks',       bucketId: 1, stream: STREAMS.indian_stocks },
    { catId: 3, catName: 'US Equity Stocks',            bucketId: 1, stream: STREAMS.us_stocks },
    { catId: 4, catName: 'Real Estate',                 bucketId: 1, stream: STREAMS.real_estate },
    { catId: 5, catName: 'Debt & Hybrid MF',            bucketId: 2, stream: STREAMS.debt_hybrid_mf },
    { catId: 6, catName: 'Precious Metals (Digital)',   bucketId: 3, stream: STREAMS.precious_metals_digital },
    { catId: 6, catName: 'Precious Metals (Physical)',  bucketId: 3, stream: STREAMS.precious_metals_physical },
    { catId: 7, catName: 'Cryptocurrency',               bucketId: 3, stream: STREAMS.crypto },
  ];

  return Promise.all(ENTRIES.map(async entry => {
    const [assetsRes, txnsRes] = await Promise.all([
      API.get(entry.stream.assetTable, { limit: 500 }),
      API.get(entry.stream.txnTable,   { limit: 5000 }),
    ]);
    return { ...entry, assets: assetsRes.rows || [], txns: txnsRes.rows || [] };
  }));
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

  return { netCost: totalCost, realizedPnL, totalBought, totalSold };
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function aggregateInsights(filteredData) {
  let totalInvested = 0, totalRedeemed = 0, totalRealizedPnL = 0;
  const byCategory    = {};
  const byBucket      = {};
  const byMonth       = {};
  const byYear        = {};
  const allMonthlyNet = {};
  const topHoldings   = [];

  filteredData.forEach(entry => {
    const { catName, bucketId, stream, assets, txns } = entry;
    const bucket = BUCKETS.find(b => b.id === bucketId);

    if (!byCategory[catName]) byCategory[catName] = { netCost: 0, realizedPnL: 0, totalBought: 0, totalSold: 0 };
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

      byCategory[catName].netCost      += m.netCost;
      byCategory[catName].realizedPnL  += m.realizedPnL;
      byCategory[catName].totalBought  += m.totalBought;
      byCategory[catName].totalSold    += m.totalSold;
      byBucket[bucketId].netCost       += m.netCost;
      totalInvested    += m.totalBought;
      totalRedeemed    += m.totalSold;
      totalRealizedPnL += m.realizedPnL;

      if (m.netCost > 100 && asset) {
        topHoldings.push({ name: asset[stream.assetNameCol], catName, netCost: m.netCost });
      }

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

  return {
    totalInvested, totalRedeemed, totalRealizedPnL, netInvested,
    byCategory, byBucket, byMonth, byYear,
    topHoldings: topHoldings.slice(0, 10),
    allMonthlyNet,
  };
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function buildSummaryCards(agg) {
  const section  = document.createElement('div');
  section.className = 'summary-cards';

  const pnlSign  = agg.totalRealizedPnL >= 0 ? '+' : '';
  const pnlClass = agg.totalRealizedPnL >= 0 ? 'positive' : 'negative';

  [
    { label: 'Total Invested',  value: '₹' + formatINR(agg.totalInvested),                         sub: 'Lifetime purchases',     accent: '#4f46e5' },
    { label: 'Net Invested',    value: '₹' + formatINR(agg.netInvested),                           sub: 'Current cost basis',     accent: '#0891b2' },
    { label: 'Realized P&L',   value: pnlSign + '₹' + formatINR(Math.abs(agg.totalRealizedPnL)), sub: 'From sell transactions', accent: agg.totalRealizedPnL >= 0 ? '#22c55e' : '#ef4444', cls: pnlClass },
    { label: 'Total Redeemed',  value: '₹' + formatINR(agg.totalRedeemed),                        sub: 'Lifetime sell proceeds', accent: '#d97706' },
  ].forEach(c => {
    const card = document.createElement('div');
    card.className = 'summary-card';
    card.style.setProperty('--card-accent', c.accent);
    card.innerHTML = `
      <div class="summary-card-label">${c.label}</div>
      <div class="summary-card-value ${c.cls || ''}">${c.value}</div>
      <div class="summary-card-sub">${c.sub}</div>
    `;
    section.appendChild(card);
  });

  return section;
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

const CAT_COLORS    = ['#4f46e5','#7c3aed','#2563eb','#0891b2','#059669','#d97706','#dc2626','#db2777'];
const BUCKET_COLORS = ['#4f46e5','#0891b2','#d97706'];

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

function emptyCard(canvasId, msg) {
  const wrap = document.getElementById(canvasId)?.closest('.chart-card');
  if (wrap) {
    wrap.querySelector('.chart-canvas-wrap').innerHTML = `<p class="chart-empty">${msg}</p>`;
  }
}

// ── Bucket donut ──────────────────────────────────────────────────────────────

function drawBucketChart(byBucket) {
  const entries = Object.entries(byBucket).filter(([, v]) => v.netCost > 0);
  if (!entries.length) return emptyCard('chart-bucket', 'No data for selected filters.');
  newChart('chart-bucket', {
    type: 'doughnut',
    data: {
      labels: entries.map(([, v]) => v.name),
      datasets: [{ data: entries.map(([, v]) => Math.round(v.netCost)), backgroundColor: BUCKET_COLORS, borderColor: '#0f1117', borderWidth: 3, hoverOffset: 10 }],
    },
    options: {
      cutout: '68%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#8b90a8', padding: 14, usePointStyle: true } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmtCurrency(ctx.raw)}` } },
      },
    },
  });
}

// ── Category donut ────────────────────────────────────────────────────────────

function drawCategoryChart(byCategory) {
  const entries = Object.entries(byCategory).filter(([, v]) => v.netCost > 0);
  if (!entries.length) return emptyCard('chart-category', 'No data for selected filters.');
  newChart('chart-category', {
    type: 'doughnut',
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{ data: entries.map(([, v]) => Math.round(v.netCost)), backgroundColor: CAT_COLORS.slice(0, entries.length), borderColor: '#0f1117', borderWidth: 3, hoverOffset: 10 }],
    },
    options: {
      cutout: '68%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#8b90a8', padding: 12, font: { size: 11 }, usePointStyle: true } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmtCurrency(ctx.raw)}` } },
      },
    },
  });
}

// ── Monthly bar ───────────────────────────────────────────────────────────────

function drawMonthlyChart(byMonth) {
  const months = Object.keys(byMonth).sort().slice(-24);
  if (!months.length) return emptyCard('chart-monthly', 'No transactions in selected period.');
  newChart('chart-monthly', {
    type: 'bar',
    data: {
      labels: months.map(monthLabel),
      datasets: [
        { label: 'Invested', data: months.map(m => Math.round(byMonth[m]?.invested || 0)), backgroundColor: 'rgba(79,70,229,0.85)', borderRadius: 4 },
        { label: 'Redeemed', data: months.map(m => Math.round(byMonth[m]?.redeemed || 0)), backgroundColor: 'rgba(239,68,68,0.75)', borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top', labels: { color: '#8b90a8', padding: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtCurrency(ctx.raw)}` } },
      },
      scales: {
        x: { ticks: { color: '#8b90a8', maxRotation: 45 }, grid: { color: 'rgba(46,50,72,0.5)' } },
        y: { ticks: { color: '#8b90a8', callback: fmtAxis }, grid: { color: 'rgba(46,50,72,0.5)' }, beginAtZero: true },
      },
    },
  });
}

// ── Yearly bar ────────────────────────────────────────────────────────────────

function drawYearlyChart(byYear) {
  const years = Object.keys(byYear).sort();
  if (!years.length) return emptyCard('chart-yearly', 'No transactions in selected period.');
  newChart('chart-yearly', {
    type: 'bar',
    data: {
      labels: years,
      datasets: [
        { label: 'Invested', data: years.map(y => Math.round(byYear[y]?.invested || 0)), backgroundColor: 'rgba(79,70,229,0.85)', borderRadius: 6 },
        { label: 'Redeemed', data: years.map(y => Math.round(byYear[y]?.redeemed || 0)), backgroundColor: 'rgba(239,68,68,0.75)', borderRadius: 6 },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top', labels: { color: '#8b90a8', padding: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtCurrency(ctx.raw)}` } },
      },
      scales: {
        x: { ticks: { color: '#8b90a8' }, grid: { color: 'rgba(46,50,72,0.5)' } },
        y: { ticks: { color: '#8b90a8', callback: fmtAxis }, grid: { color: 'rgba(46,50,72,0.5)' }, beginAtZero: true },
      },
    },
  });
}

// ── Top holdings ──────────────────────────────────────────────────────────────

function drawTopHoldingsChart(topHoldings) {
  if (!topHoldings.length) return emptyCard('chart-top-holdings', 'No holdings for selected filters.');
  const labels = topHoldings.map(h => h.name.length > 22 ? h.name.substring(0, 20) + '…' : h.name);
  newChart('chart-top-holdings', {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Net Invested', data: topHoldings.map(h => Math.round(h.netCost)), backgroundColor: CAT_COLORS[0], borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: ctx => topHoldings[ctx[0].dataIndex].name, label: ctx => ` ${fmtCurrency(ctx.raw)}` } },
      },
      scales: {
        x: { ticks: { color: '#8b90a8', callback: fmtAxis }, grid: { color: 'rgba(46,50,72,0.5)' }, beginAtZero: true },
        y: { ticks: { color: '#8b90a8' }, grid: { display: false } },
      },
    },
  });
}

// ── Realized P&L ──────────────────────────────────────────────────────────────

function drawPnLChart(byCategory) {
  const entries = Object.entries(byCategory).filter(([, v]) => Math.abs(v.realizedPnL) > 1);
  if (!entries.length) return emptyCard('chart-pnl', 'No realized P&L yet — sell transactions will appear here.');
  const values = entries.map(([, v]) => Math.round(v.realizedPnL));
  newChart('chart-pnl', {
    type: 'bar',
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{ label: 'Realized P&L', data: values, backgroundColor: values.map(v => v >= 0 ? 'rgba(34,197,94,0.8)' : 'rgba(239,68,68,0.8)'), borderRadius: 4 }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw >= 0 ? '+' : ''}${fmtCurrency(ctx.raw)}` } },
      },
      scales: {
        x: { ticks: { color: '#8b90a8', maxRotation: 30 }, grid: { color: 'rgba(46,50,72,0.5)' } },
        y: { ticks: { color: '#8b90a8', callback: v => (v < 0 ? '-' : '') + fmtAxis(Math.abs(v)) }, grid: { color: 'rgba(46,50,72,0.5)' } },
      },
    },
  });
}

// ── Cumulative line ───────────────────────────────────────────────────────────

function drawCumulativeChart(allMonthlyNet) {
  const months = Object.keys(allMonthlyNet).sort();
  if (!months.length) return emptyCard('chart-cumulative', 'No transactions in selected period.');
  let running = 0;
  const cumData = months.map(m => { running += allMonthlyNet[m]; return Math.round(running); });
  newChart('chart-cumulative', {
    type: 'line',
    data: {
      labels: months.map(monthLabel),
      datasets: [{
        label: 'Net Invested',
        data: cumData,
        borderColor: '#4f46e5',
        backgroundColor: 'rgba(79,70,229,0.1)',
        fill: true,
        tension: 0.35,
        pointRadius: months.length > 30 ? 0 : 4,
        pointHoverRadius: 6,
        borderWidth: 2.5,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` Net Invested: ${fmtCurrency(ctx.raw)}` } },
      },
      scales: {
        x: { ticks: { color: '#8b90a8', maxTicksLimit: 14 }, grid: { color: 'rgba(46,50,72,0.5)' } },
        y: { ticks: { color: '#8b90a8', callback: fmtAxis }, grid: { color: 'rgba(46,50,72,0.5)' }, beginAtZero: true },
      },
    },
  });
}
