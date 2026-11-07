// VaultZero — Insights & Analytics

// ── XIRR (Newton-Raphson) ─────────────────────────────────────────────────────

function computeXIRR(cashflows) {
  if (!cashflows || cashflows.length < 2) return null;
  const sorted = [...cashflows].sort((a, b) => a.date - b.date);
  const t0 = sorted[0].date;
  const npv = r => sorted.reduce((s, cf) => s + cf.amount / Math.pow(1 + r, (cf.date - t0) / (365.25 * 86400000)), 0);
  const newton = newtonXIRR(sorted, t0);
  if (newton !== null) return newton;
  // Fallback: bisection over (−99.99 %, +10,000 %) — Newton overshoots past −100 % for big losses.
  let lo = -0.9999, hi = 100, flo = npv(lo), fhi = npv(hi);
  if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-6 || hi - lo < 1e-9) return mid;
    if (flo * fm < 0) { hi = mid; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

function newtonXIRR(sorted, t0) {
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

// Chart colours follow the theme (CSS tokens --chart-*), read when a chart is drawn.
function CT() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, dflt) => (cs.getPropertyValue(name) || '').trim() || dflt;
  return { tick: v('--chart-tick', '#525252'), grid: v('--chart-grid', 'rgba(255,255,255,0.05)'),
           legend: v('--chart-legend', '#8b90a8'), label: v('--chart-label', '#9fb0a6'), name: v('--chart-name', '#a3a3a3'),
           surface: v('--chart-surface', '#111111') };
}

const isModernTheme = () => document.documentElement.getAttribute('data-theme') === 'modern';

// Series hues: the charts are written with Classic's palette; Modern swaps each one for its
// Apple system colour (alpha suffixes and rgba() forms included) on the chart's config.
// Neither side's values appear on the other, so the swap runs both ways unambiguously; neighbouring
// CAT_COLORS stay at least as far apart (CIELAB ΔE) as Classic's, so pie slices stay distinct.
const MODERN_HUES = {
  '#f59e0b': '#ff9f0a', '#22c55e': '#34c759', '#a855f7': '#af52de', '#ef4444': '#ff3b30',
  '#0ea5e9': '#32ade6', '#818cf8': '#7d7aff', '#7c3aed': '#7a4fe0', '#fb923c': '#ff7a45',
  '#f97316': '#ff6a00', '#ec4899': '#ff2d92', '#8b5cf6': '#bf5af2', '#64748b': '#8e8e93',
  '#6366f1': '#5856d6', '#3b82f6': '#007aff', '#14b8a6': '#00c7be', '#10b981': '#26c281',
  '#0891b2': '#0a84ff',
};
function hueMapper(toModern) {
  const hex = {}, rgb = {};
  const trip = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(',');
  Object.entries(MODERN_HUES).forEach(([c, m]) => {
    const [a, b] = toModern ? [c, m] : [m, c];
    hex[a] = b; rgb[trip(a)] = trip(b);
  });
  return s => {
    const t = s.trim().toLowerCase();
    if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(t)) { const m = hex[t.slice(0, 7)]; return m ? m + t.slice(7) : s; }
    const r = t.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
    if (r) { const m = rgb[`${r[1]},${r[2]},${r[3]}`]; if (m) return `rgba(${m},${r[4] !== undefined ? r[4] : 1})`; }
    return s;
  };
}

// Rewrite every colour string in a chart config with fn. Arrays are replaced, never edited,
// as they may be shared constants (e.g. CAT_COLORS); functions and DOM nodes are skipped.
function mapColours(o, fn, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 8) return;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === 'string') { const n = fn(v); if (n !== v) o[k] = n; }
    else if (Array.isArray(v)) {
      if (v.some(x => typeof x === 'string')) {
        const n = v.map(x => (typeof x === 'string' ? fn(x) : x));
        if (n.some((x, i) => x !== v[i])) o[k] = n;
      }
      v.forEach(x => { if (x && typeof x === 'object') mapColours(x, fn, depth + 1); });
    }
    else if (v && typeof v === 'object' && !(v instanceof Node)) mapColours(v, fn, depth + 1);
  }
}

// Chart.js defaults that follow the theme: text and grid colours, font, and (Modern) a light
// rounded tooltip. Classic gets Chart.js's own tooltip back.
let _tipDefaults = null;
function applyChartDefaults() {
  if (typeof Chart === 'undefined') return;
  const t = CT(), d = Chart.defaults;
  d.color = t.tick;
  d.borderColor = t.grid;
  d.font.family = getComputedStyle(document.body).fontFamily || "Inter, -apple-system, BlinkMacSystemFont, sans-serif";   // the theme's font
  d.font.size = 11;
  const tip = d.plugins && d.plugins.tooltip;
  if (!tip) return;
  const keys = ['backgroundColor', 'titleColor', 'bodyColor', 'borderColor', 'borderWidth', 'cornerRadius', 'padding', 'boxPadding', 'usePointStyle', 'caretSize'];
  if (!_tipDefaults) { _tipDefaults = {}; keys.forEach(k => { _tipDefaults[k] = tip[k]; }); }
  Object.assign(tip, _tipDefaults);
  if (isModernTheme()) {
    const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
    Object.assign(tip, { backgroundColor: v('--chart-tip-bg'), titleColor: v('--chart-tip-title'), bodyColor: v('--chart-tip-body'),
      borderColor: v('--chart-tip-border'), borderWidth: 1, cornerRadius: 12, padding: 12, boxPadding: 5, usePointStyle: true, caretSize: 0 });
  }
}

function fmtXIRR(r) {
  return r !== null ? (r * 100).toFixed(1) + '%' : '—';
}

let _insightsCache = null;
let _insightsCharts = [];
let _manualPricesMap = {};
let _usAux = { wires: [], repats: [], income: [] };
let _benchCheckDone = false;   // the "no benchmark" toast shows once per page load
let _insightsPartial = false;  // the last load missed tables (its own toast is showing)

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
      invalidateSnapshots();
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
    if (!_benchCheckDone && !_insightsPartial) {               // never cover the partial-load warning
      _benchCheckDone = true;
      const missing = computeUnbenchmarked(_insightsCache);
      if (missing.length) showToast('No benchmark for: ' + missing.join(', ') + ' — add a rule to BENCHMARK_MAP (js/data.js)', 'error');
    }
  } catch (err) {
    container.innerHTML = `<div class="insights-empty">Failed to load: ${err.message}</div>`;
  }
}

// Held, visible, in-scope assets that no BENCHMARK_MAP rule covers → their names.
function computeUnbenchmarked(rawData) {
  const names = [];
  (rawData || []).forEach(entry => {
    if (!isInFundScope(entry.catId) || HIDDEN.isCat(entry.catId)) return;
    const { stream } = entry;
    entry.assets.forEach(a => {
      if (String(a.is_active).toUpperCase() !== 'TRUE') return;
      if (HIDDEN.isAsset(stream.assetTable, a.id) || HIDDEN.isSub(a.subcategory_id)) return;
      const name = String(a[stream.assetNameCol] || '').trim();
      if (!benchmarkFor(entry.catId, name)) names.push(name || `${stream.assetTable} #${a.id}`);
    });
  });
  return names;
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
      const y = localYMD(t.txn_date).slice(0, 4);
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
      // US equity can carry cash (from a wire) before any asset exists — keep it, unless a
      // subcategory / asset filter is on (cash belongs to neither).
      if (!assets.length && !(entry.stream.usEquity && !subcatNames.length && !hasAssetFilter)) return null;

      const allowedAssetIds = new Set(assets.map(a => assetKey(entry.stream, a)));   // what txns point at

      // Transactions: each kept asset's full history (holdings / cost) and, with a date filter,
      // the window's activity (bought / sold / realized / monthly / XIRR).
      const assetTxns = entry.txns.filter(t => allowedAssetIds.has(String(t[entry.stream.assetIdCol])));
      const inWindow = (fromMonth || toMonth) ? (t => {
        const m = localYMD(t.txn_date).slice(0, 7);
        return !(fromMonth && m && m < fromMonth) && !(toMonth && m && m > toMonth);
      }) : null;
      const txns = inWindow ? assetTxns.filter(inWindow) : assetTxns;

      return { ...entry, assets, txns, assetTxns, inWindow, allTxns: entry.txns, allAssets: entry.assets,
               narrowed: !!(subcatNames.length || hasAssetFilter) };
    })
    .filter(Boolean);
}

// ── Chart redraw ──────────────────────────────────────────────────────────────

function redrawCharts(chartsArea, rawData) {
  _insightsCharts.forEach(c => { try { c.destroy(); } catch (_) {} });
  _insightsCharts = [];
  drawCharts(chartsArea, rawData);
}

// Theme changed: re-colour the charts already on screen in place — every CT() colour they
// were drawn with is swapped for the new theme's — so inputs, sort order and scroll stay put.
// (Each theme keeps its CT() values distinct, so the swap is unambiguous.)
let _ctDrawn = null;                                                   // the CT() the current charts used
function restyleInsightsCharts() {
  const to = CT(), from = _ctDrawn, modern = isModernTheme();
  applyChartDefaults();
  const map = {};
  if (from) Object.keys(to).forEach(k => { if (from[k] !== to[k]) map[from[k]] = to[k]; });
  // Walk the plain config, not c.options: reading through Chart.js's option resolver runs
  // scriptable options (e.g. the pie datalabels formatter) and can throw. A full update()
  // re-resolves shared element options (update('none') leaves them stale); animation is
  // switched off for it so the new colours land at once.
  _insightsCharts.forEach(c => {
    const hue = c._vzModern !== modern ? hueMapper(modern) : null;   // series hues, if the theme family changed
    const swap = s => { const n = map[s] !== undefined ? map[s] : s; return hue ? hue(n) : n; };
    c._vzModern = modern;
    try { mapColours(c.config.options, swap); } catch (_) {}
    try { (c.data.datasets || []).forEach(d => mapColours(d, swap)); } catch (_) {}
    try {
      const o = c.config.options, had = Object.prototype.hasOwnProperty.call(o, 'animation'), anim = o.animation;
      o.animation = false;
      c.update();
      if (had) o.animation = anim; else delete o.animation;
    } catch (_) {}
  });
  _ctDrawn = to;
}


// help: a GUIDE key (js/guide.js) — an ⓘ in the title opens its plain-English note.
function makeReportCard(title, divId, fullWidth = false, help = '') {
  const card = document.createElement('div');
  card.className = 'chart-card' + (fullWidth ? ' chart-card-full' : '');
  card.innerHTML = `
    <div class="chart-card-title">${title}${help ? buildHelpButton(GUIDE[help].title) : ''}</div>
    ${help ? buildHelpPanel(help) : ''}
    <div id="${divId}"></div>
  `;
  return card;
}

const INSIGHT_TABS = [
  { id: 'factsheet',   label: 'Factsheet' },
  { id: 'happening',   label: 'What\'s happening' },
  { id: 'trends',      label: 'Trends' },
  { id: 'attribution', label: 'Attribution' },
  { id: 'positions',   label: 'Positions' },
  { id: 'funds',       label: 'Funds' },
  { id: 'tax',         label: 'Tax' },
  { id: 'networth',    label: 'Net worth' },
  { id: 'guide',       label: 'Guide' },
];
let _insightsActiveTab = 'factsheet';

function drawCharts(chartsArea, rawData) {
  const filtered = applyFilters(rawData);
  const agg = aggregateInsights(filtered);

  chartsArea.innerHTML = '';
  if (typeof Chart !== 'undefined') {
    _ctDrawn = CT();
    applyChartDefaults();
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
      b.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      renderInsightsTab(tabContent, agg, filtered, rawData);
    });
    nav.appendChild(b);
  });

  chartsArea.appendChild(nav);
  // Where the tabs scroll sideways (Modern on phones): bring the active one back into view after
  // a redraw, and mark the end of the strip so its edge fade can drop.
  const markEnd = () => nav.classList.toggle('at-end', nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 2);
  nav.addEventListener('scroll', markEnd, { passive: true });
  requestAnimationFrame(() => {
    const a = nav.querySelector('.insights-subnav-tab.active');
    if (a && nav.scrollWidth > nav.clientWidth) {
      const off = a.getBoundingClientRect().left - nav.getBoundingClientRect().left;
      nav.scrollLeft += off - (nav.clientWidth - a.offsetWidth) / 2;
    }
    markEnd();
  });
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
  if (tab === 'factsheet') { renderFactsheetTab(container, rawData); return; }   // js/factsheet.js — snapshots, not the filters
  if (tab === 'happening') { renderHappeningTab(container, rawData); return; }   // js/happening.js — pattern feed
  if (tab === 'trends') { renderTrendsTab(container); return; }   // js/trends.js — holdings vs own benchmark
  if (tab === 'attribution') { renderAttributionTab(container); return; }   // js/attribution.js — same data
  if (tab === 'positions') { renderPositionsTab(container, rawData); return; }   // js/positions.js — + transactions
  if (tab === 'tax') { renderTaxTab(container, rawData); return; }   // js/tax.js — FIFO lots, current rules
  if (tab === 'guide') { renderGuideTab(container); return; }   // js/guide.js — what every number means

  if (tab === 'networth') {
    // Everything, not only the fund: EPF, bank, debt funds and land included; the filters apply.
    container.appendChild(makeChartCard('Portfolio Growth', 'chart-cumulative', true, 'nw_growth'));
    const r = row2();
    r.appendChild(makeChartCard('Portfolio by Bucket', 'chart-bucket', false, 'nw_split'));
    r.appendChild(makeChartCard('Portfolio by Category', 'chart-category', false, 'nw_split'));
    container.appendChild(r);
    const r2 = row2();
    r2.appendChild(makeChartCard('Currency Exposure', 'chart-currency', false, 'nw_currency'));
    r2.appendChild(makeChartCard('Yearly Summary', 'chart-yearly', false, 'nw_yearly'));
    container.appendChild(r2);
    container.appendChild(makeReportCard('Stream-wise P&L', 'report-stream-table', true, 'nw_streams'));
    container.appendChild(makeReportCard('Liquidity Ladder', 'report-liquidity', true, 'nw_liquidity'));
    requestAnimationFrame(() => {
      drawCumulativeChart(agg.allMonthlyNet, agg.xirrValue);         // same scope as the cost line (market assets)
      drawBucketChart(agg.byBucket);
      drawCategoryChart(agg.byCategory);
      drawCurrencyChart('chart-currency', agg.byCategory);
      drawYearlyChart(agg.byYear);
      drawStreamTable('report-stream-table', agg);
      drawLiquidityLadder('report-liquidity', agg.byCategory, agg.netInvested);
      enhanceReportTables(container);
    });

  } else if (tab === 'funds') {
    container.appendChild(makeReportCard('Indian EQ Mutual Funds — Per-Fund P&L (FIFO)', 'report-mf-detail', true, 'funds_mf'));
    container.appendChild(makeChartCard('Realized P&L by Category', 'chart-pnl', true, 'funds_realized'));
    requestAnimationFrame(() => {
      drawMFReport('report-mf-detail', filtered);                     // selected account, hides respected
      drawPnLChart(agg.byCategory);
      enhanceReportTables(container);
    });

  }
}

// ── Data Fetching ─────────────────────────────────────────────────────────────

const ENTRIES = [
  { catId: 1, catName: 'Indian EQ MF',              bucketId: 1, stream: STREAMS.equity_mf,               subcatName: null },
  { catId: 2, catName: 'Indian Equity Stocks',      bucketId: 1, stream: STREAMS.indian_stocks,            subcatName: null },
  { catId: 4, catName: 'Real Estate',                bucketId: 1, stream: STREAMS.real_estate,              subcatName: null },
  { catId: 5, catName: 'Debt & Hybrid MF',           bucketId: 2, stream: STREAMS.debt_hybrid_mf,           subcatName: null },
  { catId: 8, catName: 'Precious Metals (Digital)',  bucketId: 3, stream: STREAMS.precious_metals_digital,  subcatName: 'Digital' },
  { catId: 8, catName: 'Precious Metals (Physical)', bucketId: 3, stream: STREAMS.precious_metals_physical, subcatName: 'Physical' },
  { catId: 9, catName: 'Cryptocurrency',              bucketId: 3, stream: STREAMS.crypto,                   subcatName: null },
  { catId: 6, catName: 'EPF',                  bucketId: 2, stream: STREAMS.epf,              subcatName: null },
  { catId: 7, catName: 'Bank Accounts',         bucketId: 2, stream: STREAMS.bank_accounts,   subcatName: null },
  { catId: 3, catName: 'US Equity',             bucketId: 1, stream: STREAMS.us_equity_ibkr,  subcatName: null },
];

async function fetchAllInsightsData() {
  await HIDDEN.load();
  await ACCOUNTS.load();
  const cached = LSC.get('insights');
  _insightsPartial = false;
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

  let partial = false;
  if (!data) {
    const whole = r => r.status === 'fulfilled' && Array.isArray(r.value.rows) && !(r.value.total > r.value.rows.length);
    const results = await Promise.allSettled(ENTRIES.map(async entry => {
      const [a, t] = await Promise.allSettled([
        API.get(entry.stream.assetTable, { limit: 1000000 }),
        entry.stream.txnTable ? API.get(entry.stream.txnTable, { limit: 1000000 }) : Promise.resolve({ rows: [], total: 0 }),
      ]);
      if (!whole(a) || !whole(t)) partial = true;
      return {
        ...entry,
        assets: whole(a) ? (a.value.rows || []) : [],
        txns:   whole(t) ? (t.value.rows  || []) : [],
      };
    }));
    if (results.some(r => r.status !== 'fulfilled')) partial = true;
    data = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    try {
      const mpRes = await API.get('manual_prices', { limit: 1000000 });
      _manualPricesMap = buildManualPricesMap(mpRes.rows || []);
    } catch (_) {}
    try {
      const [w, r, inc] = await Promise.allSettled([
        API.get('us_wires', { limit: 1000000 }),
        API.get('us_repatriations', { limit: 1000000 }),
        API.get('us_income', { limit: 1000000 }),
      ]);
      _usAux = {
        wires:  w.status   === 'fulfilled' ? (w.value.rows   || []) : [],
        repats: r.status   === 'fulfilled' ? (r.value.rows   || []) : [],
        income: inc.status === 'fulfilled' ? (inc.value.rows || []) : [],
      };
    } catch (_) {}
  }

  _insightsPartial = partial;
  if (partial) showToast('Some tables failed to load — Insights may be incomplete (not cached; Refresh to retry)', 'error');
  else LSC.set('insights', { entries: data, manualPrices: _manualPricesMap, usAux: _usAux });   // never cache a partial view
  return data;
}

// ── Amount helpers ────────────────────────────────────────────────────────────

function getAmtINR(stream, txn) {
  if (stream.amountCol) return parseFloat(txn[stream.amountCol] || 0);
  // Real estate: costs add to what a buy cost you and come off what a sale brought in.
  const gross = parseFloat(txn.quantity || 0) * parseFloat(txn.price_per_unit || 0);
  const costs = parseFloat(txn.registration_cost || 0) + parseFloat(txn.other_expenses || 0);
  return txn.txn_type === 'Sell' ? gross - costs : gross + costs;
}

function getQtyVal(txn) {
  const u = parseFloat(txn.units);
  if (!isNaN(u) && u > 0) return u;
  return parseFloat(txn.quantity || 0);
}

// ── P&L: average cost method ──────────────────────────────────────────────────

// txns = the asset's FULL history (holdings and cost always come from all of it). inWindow(t),
// when a date filter is on, picks which buys / sells count as this period's activity (bought,
// sold, realized). A sell larger than what is held only counts the units actually held.
// sells: [{ txn, cost }] — the cost of the units each sell took out (for the growth chart).
function computeAssetMetrics(stream, txns, inWindow) {
  const isBuy = t => t.txn_type === 'Buy';
  const sorted = [...txns].sort((a, b) => (txnDay(a.txn_date) - txnDay(b.txn_date)) || (isBuy(b) - isBuy(a)));   // same day: buy first
  let totalCost = 0, totalQty = 0, realizedPnL = 0, totalBought = 0, totalSold = 0, oversold = false;
  const sells = [];

  sorted.forEach(t => {
    const amt = getAmtINR(stream, t);
    const qty = getQtyVal(t);
    const counts = !inWindow || inWindow(t);
    if (isBuy(t)) {
      totalCost += amt;
      totalQty  += qty;
      if (counts) totalBought += amt;
    } else if (t.txn_type === 'Sell') {
      if (totalQty <= 1e-9) { oversold = true; return; }
      const sold = Math.min(qty, totalQty);
      if (qty > totalQty + 1e-6) oversold = true;
      const avgCost  = totalCost / totalQty;
      const proceeds = qty > 0 ? amt * (sold / qty) : amt;
      if (counts) {
        realizedPnL += proceeds - avgCost * sold;
        totalSold   += proceeds;
        sells.push({ txn: t, cost: avgCost * sold, proceeds });
      }
      totalQty -= sold;
      totalCost = avgCost * totalQty;
      if (totalQty < 1e-6) { totalQty = 0; totalCost = 0; }
    }
  });

  return { netCost: totalCost, realizedPnL, totalBought, totalSold, currentQty: totalQty, oversold, sells };
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function aggregateInsights(filteredData) {
  let totalRealizedPnL = 0;
  let totalCurrentValue = 0, totalUnrealizedPnL = 0;
  const byCategory    = {};
  const byBucket      = {};
  const byYear        = {};
  const allMonthlyNet = {};
  const allCashflows  = [];
  const unpricedAssets = [], oversoldAssets = [];
  let xirrValue = 0;                    // value of the assets whose cashflows XIRR sees (not EPF / bank / US cash)
  const dateFiltered = filteredData.some(e => e.inWindow);

  filteredData.forEach(entry => {
    const { catName, bucketId, stream, assets, txns } = entry;
    const bucket = BUCKETS.find(b => b.id === bucketId);

    if (!byCategory[catName]) byCategory[catName] = { netCost: 0, realizedPnL: 0, totalBought: 0, totalSold: 0, cashflows: [], firstBuyDate: null };
    if (!byBucket[bucketId])  byBucket[bucketId]  = { name: bucket?.name || '', netCost: 0 };

    const assetMap = {};
    assets.forEach(a => { assetMap[String(a.id)] = a; });

    // ── staticBalance streams (EPF, Bank) — a balance, no P&L (EPF: from its entries) ──
    if (stream.staticBalance) {
      assets
        .filter(a => String(a.is_active).toUpperCase() === 'TRUE')
        .forEach(a => {
          const b = staticBalanceOf(stream, a, txns, entry.allTxns);        // month filter → only its entries
          if (Math.abs(b.value) < 0.005) return;                            // nothing in the account
          byCategory[catName].netCost      += b.invested;
          byCategory[catName].currentValue  = (byCategory[catName].currentValue || 0) + b.value;
          byBucket[bucketId].netCost       += b.invested;
          byBucket[bucketId].currentValue   = (byBucket[bucketId].currentValue || 0) + b.value;
          totalCurrentValue += b.value;
        });
      return; // skip transaction-based logic for this stream
    }

    // ── US Equity (IBKR) — INR cost basis from wires; current value via INR price ──
    if (stream.usEquity) {
      // Per asset, full history in date order (same day: BUY first), running average INR cost.
      // A SELL brings its USD back to the broker account: counted as money out of the holding
      // (an XIRR inflow) at today's USD→INR, with realized = that − the average cost it took out.
      const usRate = usEquityLiveRate(assets, _usAux.wires, stream);
      const isUsBuy = t => String(t.txn_type).toUpperCase() === 'BUY';
      const byAsset = {};
      [...(entry.assetTxns || txns)].sort((x, y) => (txnDay(x.txn_date) - txnDay(y.txn_date)) || (isUsBuy(y) - isUsBuy(x))).forEach(t => {
        const aid = String(t[stream.assetIdCol]);
        const d = byAsset[aid] = byAsset[aid] || { buyUnits: 0, buyCostINR: 0, netQty: 0, cost: 0, txns: [], sells: [] };
        const u = parseFloat(t.units || 0);
        if (isUsBuy(t)) {
          d.buyUnits += u; d.buyCostINR += parseFloat(t[stream.costBasisCol] || 0);
          d.netQty   += u; d.cost       += parseFloat(t[stream.costBasisCol] || 0);
        } else if (d.netQty <= 1e-9) {
          d.oversold = true;                                            // a sell of nothing held (a buy missing?)
        } else {
          if (u > d.netQty + 1e-6) d.oversold = true;
          const sold = Math.min(u, d.netQty), costOut = d.cost / d.netQty * sold;
          const proceeds = (parseFloat(t.usd_amount) || 0) * (u > 0 ? sold / u : 1) * usRate;
          d.sells.push({ txn: t, cost: costOut, proceeds });
          d.cost -= costOut; d.netQty -= sold;
          if (d.netQty < 1e-6) { d.netQty = 0; d.cost = 0; }
        }
        d.txns.push(t);
      });

      Object.entries(byAsset).forEach(([aid, d]) => {
        const asset = assetMap[aid];
        // Realized on this period's sells (even when the asset is now fully sold)
        d.sells.forEach(x => {
          if (entry.inWindow && !entry.inWindow(x.txn)) return;
          const r = x.proceeds - x.cost;
          byCategory[catName].realizedPnL += r; totalRealizedPnL += r;
          byCategory[catName].totalSold   += x.proceeds;
          const dt = txnDay(x.txn.txn_date);
          if (!isNaN(dt) && x.proceeds > 0) { byCategory[catName].cashflows.push({ amount: x.proceeds, date: dt }); allCashflows.push({ amount: x.proceeds, date: dt }); }
          const month = localYMD(x.txn.txn_date).slice(0, 7), year = localYMD(x.txn.txn_date).slice(0, 4);
          if (month) allMonthlyNet[month] = (allMonthlyNet[month] || 0) - x.cost;
          if (year)  { if (!byYear[year])   byYear[year]   = { invested: 0, redeemed: 0 }; byYear[year].redeemed  += x.proceeds; }
        });
        // INR cashflows for XIRR + monthly/yearly invested — every buy, also of a fully sold asset
        d.txns.forEach(t => {
          if (String(t.txn_type).toUpperCase() !== 'BUY') return;
          if (entry.inWindow && !entry.inWindow(t)) return;               // outside the date filter
          const inr = parseFloat(t[stream.costBasisCol] || 0);
          const dt  = txnDay(t.txn_date);
          if (isNaN(dt) || !inr) return;
          const cf = { amount: -inr, date: dt };
          byCategory[catName].cashflows.push(cf);
          allCashflows.push({ ...cf });
          byCategory[catName].totalBought += inr;   // every buy of the period, like the rupee streams
          if (!byCategory[catName].firstBuyDate || dt < byCategory[catName].firstBuyDate) {
            byCategory[catName].firstBuyDate = dt;
          }
          const month = localYMD(t.txn_date).slice(0, 7);
          const year  = localYMD(t.txn_date).slice(0, 4);
          if (month) allMonthlyNet[month] = (allMonthlyNet[month] || 0) + inr;
          if (year)  { if (!byYear[year])   byYear[year]   = { invested: 0, redeemed: 0 }; byYear[year].invested  += inr; }
        });
        if (d.oversold) oversoldAssets.push(asset ? asset[stream.assetNameCol] : aid);
        if (d.buyUnits <= 0 || d.netQty <= 1e-6) return;
        const netCost   = d.cost;                                       // running average
        const priceINR  = parseFloat(asset?.[stream.currentPriceCol] || 0);
        const unpriced  = !(priceINR > 0);                              // no live price → at cost, counted
        if (unpriced) unpricedAssets.push(asset ? asset[stream.assetNameCol] : aid);
        const curVal    = unpriced ? netCost : d.netQty * priceINR;
        const unrealPnL = unpriced ? 0 : curVal - netCost;

        byCategory[catName].netCost       += netCost;
        byCategory[catName].currentValue   = (byCategory[catName].currentValue  || 0) + curVal;
        byCategory[catName].unrealizedPnL  = (byCategory[catName].unrealizedPnL || 0) + unrealPnL;
        byBucket[bucketId].netCost        += netCost;
        byBucket[bucketId].currentValue    = (byBucket[bucketId].currentValue || 0) + curVal;
        totalCurrentValue  += curVal;
        totalUnrealizedPnL += unrealPnL;
        xirrValue          += curVal;
        byCategory[catName].xirrValue = (byCategory[catName].xirrValue || 0) + curVal;

      });

      // ── Derived US cash line (snapshot, no P&L) — account-filtered. Not shown under a date,
      // subcategory or asset filter: cash belongs to none of those, and wires − window buys is no balance.
      // Cash = the account's real USD balance: every buy / sell of the account, also of hidden assets.
      const acctIds = new Set((entry.allAssets || assets).filter(a => ACCOUNTS.matches(a.account_id)).map(a => String(a.id)));
      const cashUsd = (entry.inWindow || entry.narrowed) ? 0 : usEquityCashUsd(
        (entry.allTxns || txns).filter(t => acctIds.has(String(t[stream.assetIdCol]))),
        (_usAux.wires  || []).filter(w => ACCOUNTS.matches(w.account_id)),
        (_usAux.repats || []).filter(r => ACCOUNTS.matches(r.account_id)),
        (_usAux.income || []).filter(i => ACCOUNTS.matches(i.account_id)));
      if (Math.abs(cashUsd) > 0.01) {
        const cashInr = cashUsd * usEquityLiveRate(assets, _usAux.wires, stream);
        byCategory[catName].netCost      += cashInr;
        byCategory[catName].currentValue  = (byCategory[catName].currentValue || 0) + cashInr;
        byBucket[bucketId].netCost       += cashInr;
        byBucket[bucketId].currentValue   = (byBucket[bucketId].currentValue || 0) + cashInr;
        totalCurrentValue += cashInr;
      }
      return;
    }

    const txnsByAsset = {};
    (entry.assetTxns || txns).forEach(t => {                            // full history per asset
      const aid = String(t[stream.assetIdCol]);
      if (!txnsByAsset[aid]) txnsByAsset[aid] = [];
      txnsByAsset[aid].push(t);
    });

    Object.entries(txnsByAsset).forEach(([assetId, fullTxns]) => {
      const asset = assetMap[assetId];
      const m = computeAssetMetrics(stream, fullTxns, entry.inWindow);
      const assetTxns = entry.inWindow ? fullTxns.filter(entry.inWindow) : fullTxns;   // this period's activity
      if (m.oversold) oversoldAssets.push(asset ? asset[stream.assetNameCol] : assetId);

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
      // No live price (GOOGLEFINANCE #N/A → 0, no manual price yet) → value at cost and count it,
      // instead of silently dropping a held asset to ₹0 (the snapshot does the same).
      const unpriced  = m.currentQty > 0 && !(priceINR > 0);
      if (unpriced) unpricedAssets.push(asset ? asset[stream.assetNameCol] : assetId);
      const curVal    = m.currentQty > 0 ? (unpriced ? m.netCost : m.currentQty * priceINR) : 0;
      const unrealPnL = unpriced ? 0 : curVal - m.netCost;

      byCategory[catName].netCost        += m.netCost;
      byCategory[catName].realizedPnL    += m.realizedPnL;
      byCategory[catName].totalBought    += m.totalBought;
      byCategory[catName].totalSold      += m.totalSold;
      byCategory[catName].currentValue   = (byCategory[catName].currentValue  || 0) + curVal;
      byCategory[catName].unrealizedPnL  = (byCategory[catName].unrealizedPnL || 0) + unrealPnL;
      byBucket[bucketId].netCost         += m.netCost;
      byBucket[bucketId].currentValue    = (byBucket[bucketId].currentValue || 0) + curVal;
      totalRealizedPnL   += m.realizedPnL;
      totalCurrentValue  += curVal;
      totalUnrealizedPnL += unrealPnL;
      xirrValue          += curVal;                                     // market assets only (XIRR)
      byCategory[catName].xirrValue = (byCategory[catName].xirrValue || 0) + curVal;

      // Collect cashflows for XIRR — a sell counts only what the units actually held brought in
      const sellOf = new Map(m.sells.map(x => [x.txn, x]));
      assetTxns.forEach(t => {
        const d = txnDay(t.txn_date);
        if (isNaN(d)) return;
        if (t.txn_type !== 'Buy' && !sellOf.has(t)) return;             // a sell of nothing held
        const cf = { amount: t.txn_type === 'Buy' ? -getAmtINR(stream, t) : sellOf.get(t).proceeds, date: d };
        byCategory[catName].cashflows.push(cf);
        allCashflows.push({ ...cf });
        if (t.txn_type === 'Buy') {
          if (!byCategory[catName].firstBuyDate || d < byCategory[catName].firstBuyDate) {
            byCategory[catName].firstBuyDate = d;
          }
        }
      });

      const costOut = new Map(m.sells.map(x => [x.txn, x.cost]));       // a sell lowers cost by what it took out
      assetTxns.forEach(t => {
        const amt   = t.txn_type === 'Buy' ? getAmtINR(stream, t) : (sellOf.get(t) || {}).proceeds || 0;
        const month = localYMD(t.txn_date).slice(0, 7);
        const year  = localYMD(t.txn_date).slice(0, 4);
        if (month) {
          allMonthlyNet[month] = (allMonthlyNet[month] || 0) + (t.txn_type === 'Buy' ? amt : -(costOut.get(t) || 0));
        }
        if (year) {
          if (!byYear[year]) byYear[year] = { invested: 0, redeemed: 0 };
          t.txn_type === 'Buy' ? (byYear[year].invested += amt) : (byYear[year].redeemed += amt);
        }
      });
    });
  });

  const netInvested = Object.values(byCategory).reduce((s, c) => s + c.netCost, 0);

  // XIRR: cashflows + today's value of the SAME assets. EPF / bank balances and uninvested US cash
  // have no cashflows here, so their value would look like free profit — they are left out.
  // Under a date filter there is no opening value for the window, so no XIRR is shown.
  const today = new Date();
  Object.entries(byCategory).forEach(([, cat]) => {
    const cfs = [...cat.cashflows];
    if ((cat.xirrValue || 0) > 0) cfs.push({ amount: cat.xirrValue, date: today });
    cat.xirr = dateFiltered ? null : computeXIRR(cfs);
  });
  const allCfs = [...allCashflows];
  if (xirrValue > 0) allCfs.push({ amount: xirrValue, date: today });
  const overallXIRR = dateFiltered ? null : computeXIRR(allCfs);

  return {
    totalRealizedPnL, netInvested,
    totalCurrentValue, totalUnrealizedPnL, overallXIRR,
    byCategory, byBucket, byYear,
    allMonthlyNet, xirrValue, unpricedAssets, oversoldAssets, dateFiltered,
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
      ${agg.overallXIRR !== null ? `<div class="portfolio-hero-meta-item" title="Market assets only — EPF, bank and uninvested US cash have no cashflows to measure">XIRR <span class="${agg.overallXIRR >= 0 ? 'positive' : 'negative'}">${fmtXIRR(agg.overallXIRR)}</span></div>` : ''}
      ${agg.totalRealizedPnL !== 0 ? `<div class="portfolio-hero-meta-item">Realized <span class="${agg.totalRealizedPnL >= 0 ? 'positive' : 'negative'}">${agg.totalRealizedPnL >= 0 ? '+' : ''}${fmtCurrency(agg.totalRealizedPnL)}</span></div>` : ''}
    </div>
    ${agg.dateFiltered ? `<div class="portfolio-hero-note">Date filter: bought / sold / realized are for the period; holdings and value are today's. XIRR is hidden for a partial period.</div>` : ''}
    ${(agg.unpricedAssets || []).length ? `<div class="portfolio-hero-note">⚠ No live price for ${agg.unpricedAssets.length} holding(s) — valued at cost: ${agg.unpricedAssets.map(snapEsc).join(', ')}</div>` : ''}
    ${(agg.oversoldAssets || []).length ? `<div class="portfolio-hero-note">⚠ Sells larger than the recorded holding (a buy may be missing): ${agg.oversoldAssets.map(snapEsc).join(', ')}</div>` : ''}
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
  'US Equity':                 '🇺🇸',
  'Real Estate':               '🏠',
  'Debt & Hybrid MF':          '🛡️',
  'Precious Metals (Digital)': '✨',
  'Precious Metals (Physical)':'🥇',
  'Cryptocurrency':            '₿',
};

const LIQUIDITY_TIERS = [
  { label: 'Instant',  color: '#8b5cf6', cats: ['Bank Accounts', 'Cryptocurrency'] },
  { label: '1 Day',    color: '#22c55e', cats: ['Indian Equity Stocks'] },
  { label: '3-5 Days', color: '#3b82f6', cats: ['Indian EQ MF', 'Debt & Hybrid MF', 'US Equity', 'Precious Metals (Digital)'] },
  { label: 'Weeks',    color: '#f59e0b', cats: ['Precious Metals (Physical)'] },
  { label: 'Months+',  color: '#ef4444', cats: ['Real Estate'] },
  { label: 'Locked',   color: '#64748b', cats: ['EPF'] },              // retirement — withdrawals are restricted
];

const CURRENCY_MAP = {
  'Indian EQ MF':              'INR',
  'Indian Equity Stocks':      'INR',
  'Debt & Hybrid MF':          'INR',
  'Precious Metals (Digital)': 'INR',
  'Precious Metals (Physical)':'INR',
  'Real Estate':               'INR',
  'US Equity':                 'USD',
  'Cryptocurrency':            'Crypto',
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

// ── Liquidity Ladder ──────────────────────────────────────────────────────────

function drawLiquidityLadder(divId, byCategory, totalInvested) {
  const wrap = document.getElementById(divId);
  if (!wrap) return;

  const ladder = document.createElement('div');
  ladder.className = 'liquidity-ladder';

  // What you could get out = today's value (cost where there is no value), share of the tiers' sum.
  const valueOf = c => (byCategory[c] ? (byCategory[c].currentValue || byCategory[c].netCost || 0) : 0);
  const allTiers = LIQUIDITY_TIERS.reduce((s, t) => s + t.cats.reduce((a, c) => a + valueOf(c), 0), 0);
  LIQUIDITY_TIERS.forEach(tier => {
    const tierTotal = tier.cats.reduce((s, c) => s + valueOf(c), 0);
    if (tierTotal < 1) return;
    const pct = allTiers > 0 ? (tierTotal / allTiers * 100).toFixed(1) : '0.0';
    const presentCats = tier.cats.filter(c => valueOf(c) > 0).join(', ');

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
      datasets: [{ data: entries.map(([, v]) => Math.round(v)), backgroundColor: entries.map(([k]) => colors[k] || '#7c3aed'), borderColor: CT().surface, borderWidth: 2, hoverOffset: 8 }],
    },
    options: pieOptions(),
  });
}

// ── Chart card wrapper ────────────────────────────────────────────────────────

// help: a GUIDE key (js/guide.js) — an ⓘ in the title opens its plain-English note.
function makeChartCard(title, canvasId, fullWidth = false, help = '') {
  const card = document.createElement('div');
  card.className = 'chart-card' + (fullWidth ? ' chart-card-full' : '');
  card.innerHTML = `
    <div class="chart-card-title">${title}${help ? buildHelpButton(GUIDE[help].title) : ''}</div>
    ${help ? buildHelpPanel(help) : ''}
    <div class="chart-canvas-wrap"><canvas id="${canvasId}"></canvas></div>
  `;
  return card;
}

// ── Monthly snapshots (frozen history — gas/snapshot.gs) ─────────────────────
// Each month is recorded as of the day you take it here (any day; again later = replaced with that
// day's data). Once the next month starts it is locked, and later sells / edits / deletions never
// change it; a month never taken stays a gap (history months are as of month-end). Hidden items + account
// are applied server-side; the card's own filters (category → subcategory → asset, year → month,
// all multi-select) and the Monthly / Yearly view run here on the compact per-asset rows.

const SNAP_REDEPLOY = '📸 Snapshots need the new Apps Script version: Apps Script → Deploy → Manage deployments → ✏️ → Version: New version → Deploy, then reload.';
let _snapshotCache = {};         // account → snapshotData payload (this page session)
let _snapshotFormCache = null;   // snapshotForm: this month's window + manual prices to ask for
let _snapshotTakeMsg = '';        // result of the last "Take snapshot", shown after the panel redraws
let _snapshotLinesCache = {};    // account|date → snapshotLines
let _snapshotGen = 0;            // bumped on every invalidation; a reply from an older generation is not cached
let _snapshotDay = '';           // calendar day the caches belong to — the window opens / locks by date

// Called wherever the app drops its insights cache (Refresh, saves, hides, account changes).
function invalidateSnapshots() {
  _snapshotDay = new Date().toDateString();
  _snapshotGen++;
  _snapshotCache = {};
  _snapshotFormCache = null;
  _snapshotLinesCache = {};
}
const SNAP_UI = { view: 'month', chart: 'line', cats: [], subs: [], assets: [], years: [], months: [] };   // survives redraws

function snapshotCachesFresh() {
  if (_snapshotDay !== new Date().toDateString()) invalidateSnapshots();
}

function snapEsc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function snapDayLabel(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

// ── "Take snapshot" (any day): asks for the manual prices, then records this month as of today ──
function buildSnapshotTake() {
  const el = document.createElement('div');
  el.id = 'snapshot-take';
  el.style.display = 'none';
  return el;
}

async function drawSnapshotTake() {
  const el = document.getElementById('snapshot-take');
  if (!el) return;
  snapshotCachesFresh();
  let f = _snapshotFormCache;
  if (!f) {
    const gen = _snapshotGen;
    try { f = await API.snapshot('snapshotForm'); }
    catch (e) { if (el.isConnected) { el.className = 'snapshot-take'; el.style.display = ''; el.textContent = 'Snapshot panel unavailable: ' + e.message; } return; }
    if (!f || !f.month) {                                               // an Apps Script deployment without snapshot.gs
      if (el.isConnected) { el.className = 'snapshot-take'; el.style.display = ''; el.textContent = SNAP_REDEPLOY; }
      return;
    }
    if (gen === _snapshotGen) _snapshotFormCache = f;
  }
  if (!el.isConnected) return;
  el.className = 'snapshot-take';
  el.style.display = '';
  const month = monthLabel(f.month.slice(0, 7));
  const tagAcct = ACCOUNTS.list.length > 1;                            // the snapshot covers every account
  el.innerHTML = `
    <div class="snapshot-take-row">
      <div>
        <span class="snapshot-take-title"><span class="vz-emoji">📸</span> ${snapEsc(month)} snapshot</span>
        <span class="snapshot-take-muted">${f.taken
          ? `· taken as of ${snapEsc(snapDayLabel(f.taken.date))} · value ${fmtCurrency(f.taken.value)}${tagAcct ? ' (all accounts)' : ''}`
          : '· not taken yet'}</span>
      </div>
      <button type="button" class="btn-primary btn-sm" id="snapshot-take-btn">${f.taken ? 'Update snapshot' : 'Take snapshot'}</button>
    </div>
    ${_snapshotTakeMsg ? `<div class="snapshot-take-muted">${snapEsc(_snapshotTakeMsg)}</div>` : ''}`;
  el.querySelector('#snapshot-take-btn').onclick = () => openSnapshotDialog(f);
}

// The popup: today's date, the physical gold / silver prices (no live source — see vzsForm_ in
// gas/snapshot.gs), then "Take snapshot". Everything else is priced from the sheet; land is never
// asked — a land price saved from the Log form is spread over the months by the server.
function openSnapshotDialog(f) {
  const month = monthLabel(f.month.slice(0, 7));
  const tagAcct = ACCOUNTS.list.length > 1;
  const unit = type => (Object.values(STREAMS).find(s => s.manualPriceType === type) || {}).manualPriceLabel || 'Price';
  const overlay = document.createElement('div');
  overlay.className = 'asset-form-overlay';
  const fields = (f.manual || []).map((m, i) => `
    <label class="snapshot-take-field">
      <span>${snapEsc(m.name)}${tagAcct && ACCOUNTS.name(m.account_id) ? ' · ' + snapEsc(ACCOUNTS.name(m.account_id)) : ''}
        <small>${snapEsc(unit(m.asset_type))} (₹) · ${m.last_date ? 'last ₹' + Number(m.last_price).toLocaleString('en-IN') + ' on ' + snapEsc(snapDayLabel(m.last_date)) : 'no price yet'}</small></span>
      <input type="number" step="0.01" min="0" inputmode="decimal" data-i="${i}" value="${m.last_price > 0 ? snapEsc(m.last_price) : ''}" />
    </label>`).join('');
  overlay.innerHTML = `<div class="asset-form-box snapshot-dialog">
    <h3>${f.taken ? 'Update' : 'Take'} the ${snapEsc(month)} snapshot</h3>
    <p class="snapshot-take-muted">Holdings as of today (${snapEsc(snapDayLabel(f.today))}) at the sheet's current prices.
      ${f.taken ? `This replaces the one taken on ${snapEsc(snapDayLabel(f.taken.date))}.` : ''} It locks when the next month starts.</p>
    ${(f.epfTyped || []).length ? `<p class="snapshot-take-muted">EPF has no passbook entries yet — ${f.epfTyped.map(e => snapEsc(e.name) + ' counts at its typed ' + fmtCurrency(e.balance)).join(', ')}.</p>` : ''}
    ${fields ? `<div class="snapshot-take-label">Prices with no live source — check and update:</div><div class="snapshot-take-fields">${fields}</div>`
             : '<p class="snapshot-take-muted">No manual prices needed — everything you hold has a price in the sheet.</p>'}
    <div class="snapshot-take-muted" id="snapshot-dialog-msg"></div>
    <div class="form-actions">
      <button type="button" class="btn-secondary" id="snapshot-cancel">Cancel</button>
      <button type="button" class="btn-primary" id="snapshot-go">${f.taken ? 'Update snapshot' : 'Take snapshot'}</button>
    </div></div>`;
  document.body.appendChild(overlay);
  const go = overlay.querySelector('#snapshot-go'), msg = overlay.querySelector('#snapshot-dialog-msg');
  overlay.querySelector('#snapshot-cancel').onclick = () => overlay.remove();
  go.onclick = async () => {
    const prices = [];
    for (const inp of overlay.querySelectorAll('input[data-i]')) {
      const m = f.manual[Number(inp.dataset.i)];
      if (inp.validity && inp.validity.badInput) { showToast('Enter a plain number (no commas) for ' + m.name, 'error'); inp.focus(); return; }
      if (inp.value === '') continue;                                    // blank = keep the last price
      const v = parseFloat(inp.value);
      if (!(v > 0)) { showToast('Enter a price above 0 for ' + m.name, 'error'); inp.focus(); return; }
      prices.push({ asset_type: m.asset_type, asset_id: m.asset_id, price: v });
    }
    go.disabled = true;
    go.textContent = 'Taking…';
    try {
      const r = await API.takeSnapshot(prices);                          // clears the snapshot caches
      _snapshotTakeMsg = `✓ ${monthLabel(r.month)} snapshot ${r.updated ? 'saved as of ' + snapDayLabel(r.date) : 'unchanged'} — ${r.lines} holdings · invested ${fmtCurrency(r.invested)} · value ${fmtCurrency(r.value)}${tagAcct ? ' (all accounts)' : ''}` +
        (r.notes ? ' · ' + r.notes : '');
      showToast(r.updated ? 'Snapshot saved' : 'Nothing changed');
      overlay.remove();
      drawSnapshotTake();
      saveManagerNoteAfterTake();                                        // js/factsheet.js — redraws factsheet + card, saves the note
    } catch (e) {
      msg.textContent = 'Failed: ' + e.message + ' — your prices are still here; try again.';   // keep what you typed
      showToast('Snapshot failed: ' + e.message, 'error');
      go.disabled = false;
      go.textContent = f.taken ? 'Update snapshot' : 'Take snapshot';
    }
  };
}

// ── Card ──
function buildSnapshotCard() {
  const card = document.createElement('div');
  card.className = 'chart-card chart-card-full snapshot-card';
  card.innerHTML = `
    <div class="chart-card-title" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <span><span class="snapshot-card-title">${SNAP_UI.view === 'year' ? 'Yearly' : 'Monthly'} Snapshots — Invested vs Value</span>${buildHelpButton(GUIDE.snapshots.title)}</span>
      <span class="snapshot-controls" style="display:none">
        <span class="snapshot-view" role="group" aria-label="Period">
          <button type="button" class="btn-sm" data-view="month">Monthly</button>
          <button type="button" class="btn-sm" data-view="year">Yearly</button>
        </span>
        <span class="snapshot-view" role="group" aria-label="Chart type">
          <button type="button" class="btn-sm" data-chart="line">Line</button>
          <button type="button" class="btn-sm" data-chart="bar">Bars</button>
        </span>
      </span>
    </div>
    ${buildHelpPanel('snapshots')}
    <div class="snapshot-filters"></div>
    <div class="chart-canvas-wrap"><canvas id="chart-snapshots"></canvas></div>
    <div id="snapshot-note" style="font-size:11.5px;color:var(--text-muted);margin:8px 0 4px"></div>
    <div id="snapshot-table"></div>`;
  return card;
}

async function drawSnapshotCard() {
  const note = document.getElementById('snapshot-note');
  if (!note) return;
  snapshotCachesFresh();
  const account = String(ACCOUNTS.current);
  let data = _snapshotCache[account];
  if (!data) {
    note.textContent = 'Loading snapshots…';
    const gen = _snapshotGen;
    try { data = await API.snapshot('snapshotData', { account }); }
    catch (e) { if (note.isConnected) note.textContent = 'Snapshots unavailable: ' + e.message; return; }
    if (!data || !Array.isArray(data.months)) { if (note.isConnected) note.textContent = SNAP_REDEPLOY; return; }
    if ((data.months || []).length && gen === _snapshotGen) _snapshotCache[account] = data;   // never cache "none yet" or a stale reply
  }
  // The user may have switched tab / account while this was loading — draw nowhere stale.
  if (!note.isConnected || String(ACCOUNTS.current) !== account) return;
  if (!(data.months || []).length) {
    emptyCard('chart-snapshots', 'No snapshots yet — run setupSnapshots() and backfillSnapshots() in Apps Script.');
    note.textContent = '';
    return;
  }
  const card = note.closest('.chart-card');
  const render = () => renderSnapshotView(card, data, account);
  buildSnapshotFilters(card, data, render);
  card.querySelector('.snapshot-controls').style.display = '';
  card.querySelectorAll('.snapshot-view button').forEach(b => {
    b.onclick = () => { if (b.dataset.view) SNAP_UI.view = b.dataset.view; else SNAP_UI.chart = b.dataset.chart; render(); };
  });
  render();
}

// Each dropdown's options, cascading off the current SNAP_UI picks (category → subcategory → asset,
// year → month). Pure — no DOM.
function snapshotOptions(data) {
  const catName = id => (CATEGORIES.find(c => String(c.id) === String(id)) || {}).name || ('Category ' + id);
  const subName = id => SUBCAT_NAMES[id] || SUBCAT_NAMES[Number(id)] || ('Subcategory ' + id);
  const tagAcct = ACCOUNTS.isAll() && ACCOUNTS.list.length > 1;
  // rows carry each month's frozen category (r[5]) / subcategory (r[6]) — a later reclassification
  // never moves a locked month between filters.
  const inCats = r => !SNAP_UI.cats.length || SNAP_UI.cats.includes(r[5]);
  const inSubs = r => !SNAP_UI.subs.length || SNAP_UI.subs.includes(r[6]);
  return {
    cats: () => {
      const have = new Set(data.rows.map(r => r[5]));
      return CATEGORIES.filter(c => have.has(String(c.id))).map(c => ({ value: String(c.id), label: c.name }))
        .concat([...have].filter(id => !CATEGORIES.some(c => String(c.id) === id)).map(id => ({ value: id, label: catName(id) })));
    },
    subs: () => {
      const catOf = {};
      data.rows.filter(inCats).forEach(r => { if (r[6]) catOf[r[6]] = r[5]; });
      const opts = Object.keys(catOf).map(s => ({ value: s, label: subName(s) }));
      const dup = l => opts.filter(o => o.label === l).length > 1;     // e.g. "Large Cap" under funds AND stocks
      return opts.map(o => (dup(o.label) ? { value: o.value, label: o.label + ' · ' + catName(catOf[o.value]) } : o))
        .sort((x, y) => x.label.localeCompare(y.label));
    },
    assets: () => [...new Set(data.rows.filter(r => inCats(r) && inSubs(r)).map(r => r[1]))].map(i => data.assets[i])
      .map(a => ({ value: a.t + '|' + a.id,
                   label: a.n + (tagAcct && ACCOUNTS.name(a.a) ? ' · ' + ACCOUNTS.name(a.a) : '') }))
      .sort((x, y) => x.label.localeCompare(y.label)),
    years: () => [...new Set(data.months.map(m => m.d.slice(0, 4)))].map(y => ({ value: y, label: y })),
    months: () => data.months.filter(m => !SNAP_UI.years.length || SNAP_UI.years.includes(m.d.slice(0, 4)))
      .map(m => ({ value: m.d.slice(0, 7), label: monthLabel(m.d.slice(0, 7)) })),   // by month: a re-take moves the as-of day
  };
}

// Category → Subcategory → Asset and Year → Month, each multi-select and cascading.
function buildSnapshotFilters(card, data, render) {
  const box = card.querySelector('.snapshot-filters');
  box.innerHTML = '';
  box.className = 'snapshot-filters insights-filter-bar';
  const opt = snapshotOptions(data);

  const group = (label, ms) => {
    const g = document.createElement('div');
    g.className = 'insights-filter-group';
    g.innerHTML = `<div class="insights-filter-label">${label}</div>`;
    g.appendChild(ms.wrapper);
    return g;
  };
  const catMS = makeMultiSelect('All Categories', opt.cats(), () => {
    SNAP_UI.cats = catMS.getSelected();
    subMS.setOptions(opt.subs());    SNAP_UI.subs = subMS.getSelected();      // keep picks that still apply
    assetMS.setOptions(opt.assets()); SNAP_UI.assets = assetMS.getSelected();
    render();
  }, SNAP_UI.cats);
  SNAP_UI.cats = catMS.getSelected();
  const subMS = makeMultiSelect('All Subcategories', opt.subs(), () => {
    SNAP_UI.subs = subMS.getSelected();
    assetMS.setOptions(opt.assets()); SNAP_UI.assets = assetMS.getSelected();
    render();
  }, SNAP_UI.subs);
  SNAP_UI.subs = subMS.getSelected();
  const assetMS = makeMultiSelect('All Assets', opt.assets(), () => {
    SNAP_UI.assets = assetMS.getSelected();
    render();
  }, SNAP_UI.assets);
  SNAP_UI.assets = assetMS.getSelected();
  const yearMS = makeMultiSelect('All Years', opt.years(), () => {
    SNAP_UI.years = yearMS.getSelected();
    monthMS.setOptions(opt.months()); SNAP_UI.months = monthMS.getSelected();
    render();
  }, SNAP_UI.years);
  SNAP_UI.years = yearMS.getSelected();
  const monthMS = makeMultiSelect('All Months', opt.months(), () => {
    SNAP_UI.months = monthMS.getSelected();
    render();
  }, SNAP_UI.months);
  SNAP_UI.months = monthMS.getSelected();

  const clear = document.createElement('div');
  clear.className = 'insights-filter-group';
  clear.innerHTML = '<div class="insights-filter-label">&nbsp;</div>';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary btn-sm insights-clear-btn';
  btn.textContent = '✕ Clear';
  btn.onclick = () => {
    Object.assign(SNAP_UI, { cats: [], subs: [], assets: [], years: [], months: [] });
    buildSnapshotFilters(card, data, render);
    render();
  };
  clear.appendChild(btn);

  [group('Category', catMS), group('Subcategory', subMS), group('Asset', assetMS),
   group('Year', yearMS), group('Month', monthMS), clear].forEach(g => box.appendChild(g));
}

// Filtered points: one per month, or (Yearly) the last selected month of each year.
function snapshotPoints(data) {
  const pickA = data.assets.map(a => !SNAP_UI.assets.length || SNAP_UI.assets.includes(a.t + '|' + a.id));
  const pickR = r => pickA[r[1]] && (!SNAP_UI.cats.length || SNAP_UI.cats.includes(r[5])) &&
    (!SNAP_UI.subs.length || SNAP_UI.subs.includes(r[6]));
  const pickM = data.months.map(m => (!SNAP_UI.years.length || SNAP_UI.years.includes(m.d.slice(0, 4))) &&
    (!SNAP_UI.months.length || SNAP_UI.months.includes(m.d.slice(0, 7))));
  const pts = data.months.map(m => ({ date: m.d, status: m.st, source: m.src, notes: m.notes, inv: 0, cur: 0, atCost: 0, old: 0, est: 0 }));
  data.rows.forEach(r => {
    const [mi, , inv, cur, flag] = r;
    if (!pickM[mi] || !pickR(r)) return;
    const p = pts[mi];
    p.inv += inv; p.cur += cur;
    if (flag === 1) p.atCost++;
    if (flag === 2) p.old++;
    if (flag === 3) p.est++;                                          // history: estimated from your recorded prices
  });
  const monthly = pts.filter((p, i) => pickM[i]);
  if (SNAP_UI.view !== 'year') return monthly.map(p => Object.assign(p, { label: monthLabel(p.date.slice(0, 7)) }));
  const byYear = {};
  monthly.forEach(p => { byYear[p.date.slice(0, 4)] = p; });            // months are in date order → last wins
  return Object.keys(byYear).sort().map(y => Object.assign({}, byYear[y], { label: y, year: y }));
}

function renderSnapshotView(card, data, account) {
  card.querySelectorAll('.snapshot-view button').forEach(b => {
    const on = b.dataset.view ? b.dataset.view === SNAP_UI.view : b.dataset.chart === SNAP_UI.chart;
    b.className = 'btn-sm ' + (on ? 'btn-secondary' : 'btn-outline');
    b.setAttribute('aria-pressed', String(on));
  });
  const yearly = SNAP_UI.view === 'year';
  const bars = SNAP_UI.chart === 'bar';
  const title = card.querySelector('.snapshot-card-title');
  if (title) title.textContent = (yearly ? 'Yearly' : 'Monthly') + ' Snapshots — Invested vs Value';
  const pts = snapshotPoints(data);
  const old = _insightsCharts.find(c => c.canvas && c.canvas.id === 'chart-snapshots');
  if (old) { old.destroy(); _insightsCharts = _insightsCharts.filter(c => c !== old); }
  const wrap = card.querySelector('.chart-canvas-wrap');
  if (!pts.length) {
    if (wrap) wrap.innerHTML = '<p class="chart-empty">No snapshots match these filters.</p>';
  } else if (wrap && !wrap.querySelector('canvas')) {
    wrap.innerHTML = '<canvas id="chart-snapshots"></canvas>';
  }
  const statusText = p => (p.status === 'open' ? 'this month (can update)' : p.source === 'backfill' ? 'from history' : 'taken') +
    ' · as of ' + snapDayLabel(p.date);

  if (pts.length) {
    const GRID = CT().grid, TICK = CT().tick;
    const dot = yearly ? 4 : pts.length > 36 ? 0 : 2;                     // few yearly points → visible dots
    newChart('chart-snapshots', {
      type: bars ? 'bar' : 'line',
      data: {
        labels: pts.map(p => p.label),
        datasets: [
          { label: 'Current value', data: pts.map(p => Math.round(p.cur)), borderColor: '#22c55e',
            backgroundColor: bars ? 'rgba(34,197,94,0.55)' : 'rgba(34,197,94,0.10)',
            fill: !bars, tension: 0.25, pointRadius: dot, pointHoverRadius: 5, borderWidth: 2, borderRadius: 4 },
          { label: 'Invested', data: pts.map(p => Math.round(p.inv)), borderColor: '#f59e0b',
            backgroundColor: bars ? 'rgba(245,158,11,0.55)' : 'transparent',
            tension: 0.25, pointRadius: dot, pointHoverRadius: 5, borderWidth: 2, borderDash: bars ? [] : [5, 4], borderRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          datalabels: { display: false },
          legend: { position: 'top', labels: { color: TICK, padding: 14, usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } },
          tooltip: { callbacks: {
            title: items => { const p = pts[items[0].dataIndex]; return yearly ? `${p.year} (as of ${snapDayLabel(p.date)})` : `As of ${snapDayLabel(p.date)}`; },
            label: ctx => ` ${ctx.dataset.label}: ${fmtCurrency(ctx.raw)}`,
            afterBody: items => {
              const p = pts[items[0].dataIndex];
              const g = p.cur - p.inv;
              return [`Gain: ${g >= 0 ? '+' : '−'}${fmtCurrency(Math.abs(g))}${p.inv > 0 ? ` (${(g / p.inv * 100).toFixed(1)}%)` : ''}`,
                      p.status === 'open' ? 'This month — take it again to update it' : '',
                      p.source === 'backfill' ? 'Rebuilt from historical prices (month-end)' : '',
                      p.old ? `${p.old} old manual price(s)` : '', p.notes].filter(Boolean);
            } } },
        },
        scales: {
          x: { ticks: { color: TICK, maxRotation: 45, font: { size: 10 } }, grid: { color: GRID, drawBorder: false } },
          y: { ticks: { color: TICK, callback: fmtAxis, font: { size: 10 } }, grid: { color: GRID, drawBorder: false }, beginAtZero: true },
        },
      },
    });
  }

  const backfilled = pts.filter(p => p.source === 'backfill').length;
  const atCost = pts.reduce((s, p) => s + p.atCost, 0);
  const estimated = pts.reduce((s, p) => s + p.est, 0);
  const note = card.querySelector('#snapshot-note');
  if (note) note.textContent =
    `${pts.length} ${yearly ? 'year(s) — each shows its last snapshot' : 'month(s)'} · each month as of the day it was taken (history: month-end), ` +
    `locked once the next month starts — later sells or edits never change a locked month, except land, which is re-valued when you add a land price or change a land purchase` +
    (backfilled ? ` · ${backfilled} rebuilt from historical prices` : '') +
    (atCost ? ` · ${atCost} asset-month(s) valued at cost (no price on record)` : '') +
    (estimated ? ` · ${estimated} asset-month(s) estimated from your recorded prices (land: straight line; physical gold / silver: Gold / Silver BeES moves)` : '');

  const rows = pts.slice().reverse();
  const tbl = card.querySelector('#snapshot-table');
  if (!tbl) return;
  const prevOf = i => rows[i + 1];
  tbl.innerHTML = !rows.length ? '' : `<div class="report-table-wrap"><table class="report-table">
    <thead><tr><th style="text-align:left">${yearly ? 'Year' : 'Month'}</th><th>Invested</th><th>Value</th><th>Gain</th><th>Gain %</th>
      ${yearly ? '<th>Value change</th>' : ''}<th>Status</th></tr></thead>
    <tbody>${rows.map((p, i) => {
      const g = p.cur - p.inv, pct = p.inv > 0 ? g / p.inv * 100 : 0, cls = g >= 0 ? 'positive' : 'negative';
      const prev = prevOf(i), ch = prev ? p.cur - prev.cur : null;
      return `<tr class="snapshot-row" data-date="${snapEsc(p.date)}" title="${snapEsc(p.notes)}" style="cursor:pointer${!yearly && i >= 12 ? ';display:none' : ''}">
        <td style="text-align:left">${snapEsc(p.label)}${yearly ? ` <span style="color:var(--text-muted);font-size:11px">as of ${snapEsc(monthLabel(p.date.slice(0, 7)))}</span>` : ''}</td>
        <td>${fmtCurrency(p.inv)}</td><td>${fmtCurrency(p.cur)}</td>
        <td class="${cls}">${g >= 0 ? '+' : '−'}${fmtCurrency(Math.abs(g))}</td><td class="${cls}">${pct.toFixed(1)}%</td>
        ${yearly ? `<td class="${ch === null ? '' : ch >= 0 ? 'positive' : 'negative'}">${ch === null ? '—' : (ch >= 0 ? '+' : '−') + fmtCurrency(Math.abs(ch))}</td>` : ''}
        <td style="white-space:nowrap">${snapEsc(statusText(p))}${p.atCost ? ' · ' + p.atCost + ' at cost' : ''}${p.old ? ' · ' + p.old + ' old price' : ''}${p.est ? ' · ' + p.est + ' estimated' : ''}</td></tr>`;
    }).join('')}</tbody></table></div>
    ${!yearly && rows.length > 12 ? '<button class="btn-outline btn-sm" id="snapshot-more" style="margin-top:8px">Show all ' + rows.length + ' months</button>' : ''}
    <div id="snapshot-lines"></div>`;
  const more = tbl.querySelector('#snapshot-more');
  if (more) more.onclick = () => { tbl.querySelectorAll('.snapshot-row').forEach(r => { r.style.display = ''; }); more.remove(); };
  tbl.querySelectorAll('.snapshot-row').forEach(r => { r.onclick = () => drawSnapshotLines(tbl, r.dataset.date, account); });
}

async function drawSnapshotLines(tbl, date, account) {
  const box = tbl.querySelector('#snapshot-lines');
  if (!box) return;
  box.dataset.req = date;                                               // last click wins
  box.innerHTML = '<p class="chart-empty">Loading ' + monthLabel(date.slice(0, 7)) + '…</p>';
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  let res = _snapshotLinesCache[account + '|' + date];
  if (!res) {
    const gen = _snapshotGen;
    try { res = await API.snapshot('snapshotLines', { date, account }); }
    catch (e) { if (box.dataset.req === date) box.innerHTML = '<p class="chart-empty">Couldn\'t load: ' + snapEsc(e.message) + '</p>'; return; }
    if (gen === _snapshotGen) _snapshotLinesCache[account + '|' + date] = res;
  }
  if (!box.isConnected || box.dataset.req !== date) return;
  const lines = (res.lines || []).filter(l => (!SNAP_UI.cats.length || SNAP_UI.cats.includes(String(l.category_id))) &&
      (!SNAP_UI.subs.length || SNAP_UI.subs.includes(String(l.subcategory_id))) &&
      (!SNAP_UI.assets.length || SNAP_UI.assets.includes(l.asset_table + '|' + l.asset_id)))
    .sort((a, b) => (b.current_value || 0) - (a.current_value || 0));
  const catName = id => (CATEGORIES.find(c => String(c.id) === String(id)) || {}).name || id;
  const tagAcct = ACCOUNTS.isAll() && ACCOUNTS.list.length > 1;
  const name = l => snapEsc(l.asset_name) + (tagAcct && ACCOUNTS.name(l.account_id) ? ' · ' + snapEsc(ACCOUNTS.name(l.account_id)) : '');
  const src = { sheet: 'sheet price', amfi: 'AMFI NAV', yahoo: 'market close', manual: 'your price', cost: 'at cost', epf: 'EPF passbook',
                estimate: 'estimated from your prices' };
  const priceFrom = l => snapEsc(src[l.price_source] || l.price_source) + (l.price_date ? ' · ' + snapEsc(snapDayLabel(l.price_date)) : '') +
    (l.old ? ' <span class="negative" title="Not updated since last month\'s snapshot locked">· old</span>' : '');
  box.innerHTML = `<div class="chart-card-title" style="margin-top:14px">As of ${snapEsc(snapDayLabel(date))} — ${lines.length} holdings${res.status === 'open' ? ' (open)' : ''}</div>
    ${res.notes ? `<div style="font-size:11.5px;color:var(--text-muted);margin-bottom:6px">${snapEsc(res.notes)}</div>` : ''}
    <div class="report-table-wrap"><table class="report-table">
    <thead><tr><th style="text-align:left">Asset</th><th style="text-align:left">Category</th><th>Units</th><th>Invested</th><th>Value</th><th style="text-align:left">Price from</th></tr></thead>
    <tbody>${lines.map(l => `<tr><td style="text-align:left">${name(l)}</td><td style="text-align:left">${snapEsc(catName(l.category_id))}</td>
      <td>${l.units === '' ? '—' : Number(l.units).toLocaleString('en-IN', { maximumFractionDigits: 4 })}</td>
      <td>${fmtCurrency(l.invested_value)}</td><td>${fmtCurrency(l.current_value)}</td><td style="text-align:left">${priceFrom(l)}</td></tr>`).join('')}</tbody>
    </table></div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
  const prev = Chart.getChart(canvas);                                  // a quick re-render may have drawn here already
  if (prev) { prev.destroy(); _insightsCharts = _insightsCharts.filter(c => c !== prev); }
  const modern = isModernTheme();
  if (modern) {
    const hue = hueMapper(true);
    try { mapColours(config.options, hue); ((config.data || {}).datasets || []).forEach(d => mapColours(d, hue)); } catch (_) {}
  }
  const chart = new Chart(canvas, config);
  chart._vzModern = modern;
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
      legend: { position: 'bottom', labels: { color: CT().legend, padding: 12, font: { size: legendSize }, usePointStyle: true } },
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
      datasets: [{ data: entries.map(([, v]) => Math.round(v.netCost)), backgroundColor: BUCKET_COLORS, borderColor: CT().surface, borderWidth: 2, hoverOffset: 8 }],
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
      datasets: [{ data: entries.map(([, v]) => Math.round(v.netCost)), backgroundColor: CAT_COLORS.slice(0, entries.length), borderColor: CT().surface, borderWidth: 2, hoverOffset: 8 }],
    },
    options: pieOptions(),
  });
}

// ── Yearly bar ────────────────────────────────────────────────────────────────

function drawYearlyChart(byYear) {
  const years = Object.keys(byYear).sort();
  if (!years.length) return emptyCard('chart-yearly', 'No transactions in selected period.');
  const GRID = CT().grid;
  const TICK = CT().tick;
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

// ── Realized P&L ──────────────────────────────────────────────────────────────

function drawPnLChart(byCategory) {
  const entries = Object.entries(byCategory).filter(([, v]) => Math.abs(v.realizedPnL) > 1);
  if (!entries.length) return emptyCard('chart-pnl', 'No realized P&L yet — sell transactions will appear here.');
  const values = entries.map(([, v]) => Math.round(v.realizedPnL));
  const GRID = CT().grid;
  const TICK = CT().tick;
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
  const sorted = [...txns].sort((a, b) => txnDay(a.txn_date) - txnDay(b.txn_date));

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
    const date  = txnDay(t.txn_date);
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

  const { stream, assets } = entry;
  const txns = entry.assetTxns || entry.txns;                          // each fund's full history (FIFO needs every buy)

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

  // ── Drill-down: rolling SIP journey per fund (full history, like the table — FIFO needs every buy) ──
  const entry = rawData.find(e => e.catId === 1 && e.stream?.txnTable === 'equity_transactions');
  if (!entry) return;
  const txnsByAsset = {}, assetMap = {};
  (entry.assetTxns || entry.txns).forEach(t => {
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
    .sort((a, b) => txnDay(a.txn_date) - txnDay(b.txn_date));
  const out = [];
  let cumUnits = 0, cumInv = 0;
  const cfs = [];
  const firstDate = buys.length ? buys[0].txn_date : null;
  buys.forEach((t, i) => {
    const units = parseFloat(t.units || 0);
    const nav   = parseFloat(t.nav || 0);
    const amt   = getAmtINR(stream, t);
    cumUnits += units; cumInv += amt;
    cfs.push({ amount: -amt, date: txnDay(t.txn_date) });
    const value = nav > 0 ? cumUnits * nav : cumInv;
    const xirr  = computeXIRR([...cfs, { amount: value, date: txnDay(t.txn_date) }]);
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
  const sorted = [...(txns || [])].sort((a, b) => txnDay(a.txn_date) - txnDay(b.txn_date));
  const lots = [];   // { units, costPerUnit, year }
  sorted.forEach(t => {
    const units = parseFloat(t.units || 0);
    if (units <= 0) return;
    if (t.txn_type === 'Buy') {
      const amt = getAmtINR(stream, t);
      lots.push({ units, costPerUnit: amt / units, year: localYMD(t.txn_date).slice(0, 4) });
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
    pointBorderColor: CT().surface,
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
      pointBorderColor: CT().surface,
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
        legend: { position: 'top', labels: { color: CT().legend, padding: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: ctx => ctx.raw !== null ? ` ${ctx.dataset.label}: ${fmtCurrency(ctx.raw)}` : null } },
      },
      scales: {
        x: { ticks: { color: CT().tick, maxTicksLimit: 14, font: { size: 10 } }, grid: { color: CT().grid, drawBorder: false } },
        y: { ticks: { color: CT().tick, callback: fmtAxis, font: { size: 10 } }, grid: { color: CT().grid, drawBorder: false }, beginAtZero: true },
      },
    },
  });
}
