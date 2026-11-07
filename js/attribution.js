// VaultZero — Insights → Attribution: where the fund's return came from, by holding and by sleeve
// Numbers from js/fund-engine.js (computeAttribution / computeHoldingVsBench) over the monthly snapshots.

// ── Constants & state ─────────────────────────────────────────────────────────

const ATTR_UP = '#22c55e';
const ATTR_DOWN = '#ef4444';
const ATTR_TOTAL = '#f59e0b';
const ATTR_WATERFALL_TOP = 10;   // holdings drawn one by one; the rest are summed into "Others"
const ATTR_SHARE_TOP = 12;       // holdings in the gain-vs-capital chart (largest capital first)

// Columns of the holding / sleeve tables (the sleeve table swaps the first one).
const ATTR_HOLDING_COLS = [
  { label: 'Holding', cell: r => snapEsc(attrShort(r.name, 30)) },
  { label: 'Contribution', cell: r => fmtPts(r.contrib * 100), cls: r => fsTone(r.contrib * 100) },
  { label: 'Return', cell: r => attrReturnCell(r), cls: r => fsTone(r.ret === null ? null : r.ret * 100) },
  { label: 'Avg weight', cell: r => (r.weight * 100).toFixed(1) + '%' },
  { label: 'Market move', cell: r => fmtRupees(r.move, true), cls: r => fsTone(r.move, 0) },
];

const ATTR_UI = { period: 'y1', from: '', to: '', window: 'y1' };   // survives redraws
let _attrReq = 0;                                                   // the latest drawAttribution() call wins


// ── Helpers ───────────────────────────────────────────────────────────────────

function attrShort(name, n = 22) {
  const s = String(name || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function attrPeriodLabel(a) {
  const gaps = a.months - a.steps;
  return `${fmtDay(a.from)} → ${fmtDay(a.to)} · ${fsMonths(a.months)}` + (gaps > 0 ? ` (${fsMonths(gaps)} without a snapshot)` : '');
}

// A holding / sleeve return, or why there is none; "est." marks values estimated from recorded prices.
function attrReturnCell(r) {
  const est = r.est ? '<br><span class="attr-muted">est.</span>' : '';
  if (r.noRet === 'cost') return '<span class="attr-muted">at cost</span>';
  if (r.noRet) return '<span class="attr-muted">part period</span>';
  return fmtPct(r.ret) + est;
}

// The waterfall's bars: the largest contributors by size, the rest as "Others", then the total.
function computeWaterfallBars(rows, top, total) {
  const sorted = rows.slice().sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib));
  const shown = sorted.slice(0, top).sort((a, b) => b.contrib - a.contrib);
  const rest = sorted.slice(top);
  const bars = shown.map(r => ({ label: r.name || r.label, value: r.contrib }));
  if (rest.length) bars.push({ label: `Others (${rest.length})`, value: rest.reduce((s, r) => s + r.contrib, 0) });
  let run = 0;
  const out = bars.map(b => { const lo = run; run += b.value; return Object.assign(b, { lo, hi: run }); });
  out.push({ label: 'Fund', value: total, lo: 0, hi: total, total: true });
  return out;
}


// ── DOM builders ──────────────────────────────────────────────────────────────

function buildAttrPicker(points, onChange) {
  const card = document.createElement('div');
  card.className = 'chart-card chart-card-full attr-picker';
  const seg = document.createElement('div');
  seg.className = 'snapshot-view attr-periods';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Period');
  ATTR_PERIODS.forEach(p => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-sm ' + (ATTR_UI.period === p.key ? 'btn-secondary' : 'btn-outline');
    b.setAttribute('aria-pressed', String(ATTR_UI.period === p.key));
    b.textContent = p.label;
    b.addEventListener('click', () => { ATTR_UI.period = p.key; onChange(); });
    seg.appendChild(b);
  });
  card.appendChild(seg);
  if (ATTR_UI.period !== 'custom') return card;

  const months = points.map(p => p.month);
  const L = months.length - 1;
  if (!months.includes(ATTR_UI.from)) ATTR_UI.from = months[L - Math.min(12, Math.max(1, computeRunLength(points, L) - 1))] || months[0] || '';
  if (!months.includes(ATTR_UI.to)) ATTR_UI.to = months[months.length - 1] || '';
  const row = document.createElement('div');
  row.className = 'insights-filter-bar attr-custom';
  [['From', 'from'], ['To', 'to']].forEach(([label, key]) => {
    const { group, select } = makeFilterGroup(label, 'attr-' + key);
    months.forEach(m => {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = monthLabel(m);
      if (m === ATTR_UI[key]) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', () => { ATTR_UI[key] = select.value; onChange(); });
    row.appendChild(group);
  });
  card.appendChild(row);
  return card;
}

function buildAttrTable(rows, cols) {
  return `<div class="report-table-wrap"><table class="report-table attr-table">
    <thead><tr>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cols.map(c => `<td${c.cls ? ` class="${c.cls(r)}"` : ''}>${c.cell(r)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function buildAttrContribCard(a) {
  const shown = a.holdings.filter(r => fsTone(r.contrib * 100));      // a contribution that rounds to 0.0 pts is neither
  const up = shown.filter(r => r.contrib > 0).sort((x, y) => y.contrib - x.contrib).slice(0, 5);
  const down = shown.filter(r => r.contrib < 0).sort((x, y) => x.contrib - y.contrib).slice(0, 5);
  const list = (title, rows) => `<div class="attr-list"><div class="fs-note-month">${title}</div>
    ${rows.length ? buildAttrTable(rows, ATTR_HOLDING_COLS) : '<p class="chart-empty">None in this period.</p>'}</div>`;
  return fsCard('Contribution to return · by holding', `
    <div class="fs-sub">Fund ${fmtPct(a.total)} time-weighted over ${snapEsc(attrPeriodLabel(a))} — the sum of the contributions below.</div>
    <div class="chart-canvas-wrap" id="attr-holdings-wrap"><canvas id="chart-attr-holdings"></canvas></div>
    ${list('Top contributors', up)}
    ${list('Top detractors', down)}
    <div class="fs-foot">Contribution (pts) = each month's market move of the holding ÷ the fund's capital that month (its weight ×
      its return), linked across the months so the holdings add up to the fund's return. Return is shown for holdings held at every
      snapshot of the period and never valued at cost; "est." = some months valued from recorded prices (no market price).</div>`,
    '', 'attr_holding', buildAttrExample(a, up, down));
}

// The ⓘ line on the holdings card: the largest contributor and detractor in plain words.
function buildAttrExample(a, up, down) {
  const parts = [`The fund returned ${fmtPct(a.total)} over ${attrPeriodLabel(a)}`];
  if (up.length) parts.push(`${up[0].name} added the most, ${fmtPts(up[0].contrib * 100)}`);
  if (down.length) parts.push(`${down[0].name} took away the most, ${fmtPts(down[0].contrib * 100)}`);
  return parts.join('; ') + '.';
}

function buildAttrSleeveCard(a) {
  const rows = a.sleeves.slice().sort((x, y) => y.contrib - x.contrib);
  const cols = [{ label: 'Sleeve', cell: r => snapEsc(r.label) }].concat(ATTR_HOLDING_COLS.slice(1));
  return fsCard('Contribution to return · by sleeve', `
    <div class="chart-canvas-wrap" id="attr-sleeves-wrap"><canvas id="chart-attr-sleeves"></canvas></div>
    ${buildAttrTable(rows, cols)}
    <div class="fs-foot">A sleeve's return is shown when it was held at every snapshot of the period and none of it was valued at cost.</div>`,
    '', 'attr_sleeve');
}

function buildAttrVsBenchCard(vs, benchError) {
  const seg = ['y1', 'y3'].map(k => `<button type="button" class="btn-sm ${ATTR_UI.window === k ? 'btn-secondary' : 'btn-outline'}"
    data-window="${k}" aria-pressed="${ATTR_UI.window === k}">${k === 'y1' ? '1Y' : '3Y p.a.'}</button>`).join('');
  let inner;
  if (vs.need) {
    inner = `<p class="chart-empty">${ATTR_UI.window === 'y1' ? '1Y' : '3Y'} ${fsNeed(vs.need)}.</p>`;
  } else if (benchError) {
    inner = `<p class="chart-empty">Benchmark values unavailable: ${snapEsc(benchError)}.</p>`;
  } else if (!vs.rows.length) {
    inner = '<p class="chart-empty">No holding was held and priced for the whole window.</p>';
  } else {
    inner = `<div class="fs-sub">${snapEsc(fmtDay(vs.from))} → ${snapEsc(fmtDay(vs.to))}: each holding's time-weighted return minus its
      own benchmark's${ATTR_UI.window === 'y3' ? ', both annualised' : ''}.</div>
      <div class="chart-canvas-wrap" id="attr-vs-wrap"><canvas id="chart-attr-vs"></canvas></div>`;
  }
  const names = list => list.map(x => attrShort(x, 30)).join(', ');
  const left = [];
  if (vs.partial && vs.partial.length) left.push(`Not held (or not priced) for the whole window: ${names(vs.partial)}.`);
  if (vs.estimated && vs.estimated.length) left.push(`Valued from recorded prices (estimates) in this window, not compared: ${names(vs.estimated)}.`);
  if (vs.noValue && vs.noValue.length) left.push(`No benchmark value on the window's dates: ${names(vs.noValue)}.`);
  if (vs.noBench && vs.noBench.length) left.push(`No benchmark: ${names(vs.noBench)}.`);
  return fsCard('Holdings vs their own benchmark', `
    <div class="snapshot-view attr-window" role="group" aria-label="Window">${seg}</div>
    ${inner}
    <div class="fs-foot">${snapEsc(left.join(' '))}</div>`, 'attr-vs', 'attr_vs_bench');
}

function buildAttrShareCard(a) {
  return fsCard('Share of the market move vs share of capital', `
    <div class="chart-canvas-wrap" id="attr-share-wrap"><canvas id="chart-attr-share"></canvas></div>
    <div class="fs-foot">Capital = the holding's average capital over the period (start value + half its net new money, each month)
      as a share of the fund's. Market move = its ₹ market move as a share of all holdings' gains and losses together
      (gains + |losses| = 100%): green = a gain, red = a loss (a negative share). ${ATTR_SHARE_TOP} largest holdings by capital.</div>`,
    '', 'attr_share');
}


// ── Render ────────────────────────────────────────────────────────────────────

function renderAttributionTab(container) {
  container.appendChild(buildFsScope());
  const body = document.createElement('div');
  body.id = 'attribution-body';
  body.appendChild(fsCard('Attribution', '<p class="chart-empty">Loading…</p>'));
  container.appendChild(body);
  requestAnimationFrame(() => { drawAttribution(); });
}

async function drawAttribution() {
  const body = document.getElementById('attribution-body');
  if (!body) return;
  const account = String(ACCOUNTS.current);
  const req = ++_attrReq;
  let data;
  try {
    data = await fetchFactsheetData(account);
  } catch (e) {
    if (body.isConnected && req === _attrReq) body.innerHTML = fsCard('Attribution', `<p class="chart-empty">Attribution unavailable: ${snapEsc(e.message)}</p>`).outerHTML;
    return;
  }
  if (!body.isConnected || req !== _attrReq || String(ACCOUNTS.current) !== account) return;
  const empty = msg => { body.innerHTML = ''; body.appendChild(fsCard('Attribution', `<p class="chart-empty">${msg}</p>`)); };
  if (data.redeploy) return empty(snapEsc(SNAP_REDEPLOY));
  const points = computeFundSeries(data.snap);
  if (!points.length) return empty('No fund holdings in the snapshots yet.');
  renderAttribution(body, points, data);
}

// Lays out the cards for the chosen period from already-fetched data (period changes reuse it).
function renderAttribution(body, points, data) {
  _insightsCharts = _insightsCharts.filter(c => {
    if (!c.canvas || !body.contains(c.canvas)) return true;
    try { c.destroy(); } catch (_) {}
    return false;
  });
  body.innerHTML = '';
  const redraw = () => renderAttribution(body, points, data);
  body.appendChild(buildAttrPicker(points, redraw));

  const names = data.snap.assets.map(x => x.n);
  const range = computeAttrRange(points, ATTR_UI.period, ATTR_UI.from, ATTR_UI.to);
  const label = (ATTR_PERIODS.find(p => p.key === ATTR_UI.period) || {}).label;
  let a = null;
  if (range.need) body.appendChild(fsCard('Contribution to return', `<p class="chart-empty">${label} ${fsNeed(range.need)}.</p>`));
  else if (range.invalid) body.appendChild(fsCard('Contribution to return', '<p class="chart-empty">Pick a From month before the To month.</p>'));
  else if (range.missing) {
    body.appendChild(fsCard('Contribution to return', `<p class="chart-empty">${fsMonths(range.missing)} in this range ` +
      `${range.missing === 1 ? 'has' : 'have'} no snapshot — pick a range without gaps.</p>`));
  } else {
    a = computeAttribution(points, range.s, range.e, names);
    body.appendChild(buildAttrContribCard(a));
    body.appendChild(buildAttrSleeveCard(a));
  }

  const series = computeBenchSeries(data.benchRows);
  const months = ATTR_UI.window === 'y3' ? 36 : 12;
  const vs = computeHoldingVsBench(points, series, names, months, ATTR_UI.window === 'y3');
  const vsCard = buildAttrVsBenchCard(vs, data.benchError);
  vsCard.querySelectorAll('[data-window]').forEach(b => {
    b.addEventListener('click', () => { ATTR_UI.window = b.dataset.window; redraw(); });
  });
  body.appendChild(vsCard);
  if (a) body.appendChild(buildAttrShareCard(a));

  requestAnimationFrame(() => {
    if (!body.isConnected) return;
    if (a) {
      drawAttrWaterfall('chart-attr-holdings', computeWaterfallBars(a.holdings, ATTR_WATERFALL_TOP, a.total));
      drawAttrWaterfall('chart-attr-sleeves', computeWaterfallBars(a.sleeves, SLEEVES.length + 1, a.total));
      drawAttrShare(a);
    }
    if (!vs.need && !data.benchError && vs.rows.length) drawAttrVsBench(vs);
  });
}


// ── Charts ────────────────────────────────────────────────────────────────────

// Horizontal bars get a height that fits their count; the wrap's height is the only inline size.
function sizeAttrChart(canvasId, bars) {
  const wrap = document.getElementById(canvasId)?.closest('.chart-canvas-wrap');
  if (wrap) wrap.style.height = `${Math.max(140, bars * 28 + 56)}px`;
}

function drawAttrWaterfall(canvasId, bars) {
  sizeAttrChart(canvasId, bars.length);
  const colour = b => {
    if (b.total) return ATTR_TOTAL;
    return b.value >= 0 ? ATTR_UP : ATTR_DOWN;
  };
  newChart(canvasId, {
    type: 'bar',
    data: {
      labels: bars.map(b => attrShort(b.label)),
      datasets: [{ label: 'Contribution', data: bars.map(b => [b.lo * 100, b.hi * 100]),
                   backgroundColor: bars.map(colour), borderRadius: 3, borderSkipped: false, maxBarThickness: 18 }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 4 } },
      plugins: {
        datalabels: { display: false },
        legend: { display: false },
        tooltip: { callbacks: {
          title: items => bars[items[0].dataIndex].label,
          label: ctx => {
            const b = bars[ctx.dataIndex];
            return b.total ? ` Fund return: ${fmtPct(b.value)}` : ` Contribution: ${fmtPts(b.value * 100)}`;
          },
        } },
      },
      scales: {
        x: fsAxis({ ticks: { color: CT().tick, callback: v => v + ' pts', font: { size: 10 } } }),
        y: fsAxis({ grid: { display: false }, ticks: { color: CT().tick, autoSkip: false, font: { size: 10.5 } } }),
      },
    },
  });
}

function drawAttrVsBench(vs) {
  const rows = vs.rows;
  sizeAttrChart('chart-attr-vs', rows.length);
  newChart('chart-attr-vs', {
    type: 'bar',
    data: {
      labels: rows.map(r => attrShort(r.name)),
      datasets: [{ label: 'Gap', data: rows.map(r => r.gap), backgroundColor: rows.map(r => (r.gap >= 0 ? ATTR_UP : ATTR_DOWN)),
                   borderRadius: 3, maxBarThickness: 18 }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 4 } },
      plugins: {
        datalabels: { display: false },
        legend: { display: false },
        tooltip: { callbacks: {
          title: items => rows[items[0].dataIndex].name,
          label: ctx => {
            const r = rows[ctx.dataIndex];
            return [` ${fmtPct(r.ret)} vs ${r.benchLabel} ${fmtPct(r.bench)}`, ` Gap: ${fmtPts(r.gap)}`];
          },
        } },
      },
      scales: {
        x: fsAxis({ ticks: { color: CT().tick, callback: v => v + ' pts', font: { size: 10 } } }),
        y: fsAxis({ grid: { display: false }, ticks: { color: CT().tick, autoSkip: false, font: { size: 10.5 } } }),
      },
    },
  });
}

// The market-move series is coloured per bar (gain / loss); its legend swatch is the gain colour,
// resolved for the theme on every draw so a theme switch keeps it right.
function attrShareLegend() {
  const legend = fsLegend();
  legend.labels.generateLabels = chart => {
    const items = Chart.defaults.plugins.legend.labels.generateLabels(chart);
    const up = isModernTheme() ? hueMapper(true)(ATTR_UP) : ATTR_UP;
    if (items[1]) { items[1].fillStyle = up; items[1].strokeStyle = up; }
    return items;
  };
  return legend;
}

function drawAttrShare(a) {
  const rows = a.holdings.filter(r => r.capitalShare !== null).sort((x, y) => y.capital - x.capital).slice(0, ATTR_SHARE_TOP);
  sizeAttrChart('chart-attr-share', rows.length * 1.6);
  newChart('chart-attr-share', {
    type: 'bar',
    data: {
      labels: rows.map(r => attrShort(r.name)),
      datasets: [
        { label: 'Share of capital', data: rows.map(r => r.capitalShare * 100), backgroundColor: 'rgba(100,116,139,0.75)', borderRadius: 3, maxBarThickness: 12 },
        { label: 'Share of market move', data: rows.map(r => (r.gainShare === null ? null : r.gainShare * 100)),
          backgroundColor: rows.map(r => (r.move >= 0 ? 'rgba(34,197,94,0.85)' : 'rgba(239,68,68,0.85)')), borderRadius: 3, maxBarThickness: 12 },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 4 } },
      plugins: {
        datalabels: { display: false },
        legend: attrShareLegend(),
        tooltip: { callbacks: {
          title: items => rows[items[0].dataIndex].name,
          label: ctx => (ctx.raw === null ? null : ` ${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%`),
          afterBody: items => ` Market move: ${fmtRupees(rows[items[0].dataIndex].move, true)}`,
        } },
      },
      scales: {
        x: fsAxis({ ticks: { color: CT().tick, callback: v => v + '%', font: { size: 10 } } }),
        y: fsAxis({ grid: { display: false }, ticks: { color: CT().tick, autoSkip: false, font: { size: 10.5 } } }),
      },
    },
  });
}
