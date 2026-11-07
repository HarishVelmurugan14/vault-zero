// VaultZero — Insights → Factsheet: the fund (FUND_SCOPE) reported like an AMC factsheet, facts only
// Every number is computed in js/fund-engine.js from the monthly snapshots and benchmark_prices.

// ── Constants & state ─────────────────────────────────────────────────────────

const FS_FUND = '#f59e0b';      // the fund's series (Classic hues — newChart() maps them for Modern)
const FS_BENCH = '#64748b';     // the benchmark's series
const FS_PUT_IN = '#0ea5e9';
const FS_MARKET = '#22c55e';
const FS_SHARE = '#a855f7';
const FS_TOP_PATTERNS = 6;      // "What's happening" cards on the Factsheet

let _fsBench = { gen: -1, rows: [] };   // benchmark_prices rows for the current snapshot generation
let _fsNotes = { gen: -1, rows: [] };   // manager_notes rows
let _fsPatterns = { gen: -1, rows: [] };   // pattern_history rows
let _fsNotesSeq = 0;                    // bumped when a note is saved — an older notes reply is not cached
let _fsReq = 0;                         // the latest drawFactsheet() call wins


// ── Helpers ───────────────────────────────────────────────────────────────────

function fsAspect() {
  return window.innerWidth < 600 ? 1.35 : 2.4;
}

// Colour class for a number as shown (a value that rounds to 0 is neutral).
function fsTone(x, digits = 1) {
  if (x === null || x === undefined || !isFinite(x)) return '';
  const shown = Number(x.toFixed(digits));
  if (shown > 0) return 'positive';
  if (shown < 0) return 'negative';
  return '';
}

function fsNeed(n) {
  return `needs ${n} more month${n === 1 ? '' : 's'}`;
}

function fsMonths(n) {
  return `${n} month${n === 1 ? '' : 's'}`;
}

function fsAxis(scale) {
  const t = CT();
  return Object.assign({ ticks: { color: t.tick, font: { size: 10 } }, grid: { color: t.grid, drawBorder: false } }, scale || {});
}

function fsLegend() {
  return { position: 'top', labels: { color: CT().legend, padding: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } };
}

// help: a GUIDE key (js/guide.js) — an ⓘ in the title opens its plain-English note; example: a
// line about this card's own numbers, shown under the note.
function fsCard(title, inner, extraClass = '', help = '', example = '') {
  const card = document.createElement('div');
  card.className = 'chart-card chart-card-full' + (extraClass ? ' ' + extraClass : '');
  card.innerHTML = `
    <div class="chart-card-title">${title}${help ? buildHelpButton(GUIDE[help].title) : ''}</div>
    ${help ? buildHelpPanel(help, example) : ''}
    ${inner}
  `;
  return card;
}


// ── Data Fetching ─────────────────────────────────────────────────────────────

// Snapshot data (shared with the snapshot card's cache), benchmark rows and saved notes.
async function fetchFactsheetData(account) {
  snapshotCachesFresh();
  const gen = _snapshotGen, seq = _fsNotesSeq;
  const cached = _snapshotCache[account];
  const [snap, bench, notes, patterns] = await Promise.all([
    cached || API.snapshot('snapshotData', { account }),
    _fsBench.gen === gen ? null : API.get('benchmark_prices', { limit: 1000000 }).catch(e => ({ rows: [], error: e.message })),
    _fsNotes.gen === gen ? null : API.get('manager_notes', { limit: 1000000 }).catch(e => ({ rows: [], error: e.message })),
    _fsPatterns.gen === gen ? null : API.get('pattern_history', { limit: 1000000 }).catch(e => ({ rows: [], error: e.message })),
  ]);
  if (!snap || !Array.isArray(snap.months)) return { redeploy: true };
  const benchNow = bench ? { gen, rows: bench.rows || [] } : _fsBench;
  const notesNow = notes ? { gen, rows: notes.rows || [] } : _fsNotes;
  const patternsNow = patterns ? { gen, rows: patterns.rows || [] } : _fsPatterns;
  if (gen === _snapshotGen) {                                          // never cache a reply from before an invalidation
    if (!cached && snap.months.length) _snapshotCache[account] = snap;
    if (bench && !bench.error) _fsBench = benchNow;                    // a failed read is retried on the next draw
    if (notes && !notes.error && seq === _fsNotesSeq) _fsNotes = notesNow;
    if (patterns && !patterns.error && seq === _fsNotesSeq) _fsPatterns = patternsNow;
  }
  return { snap, benchRows: benchNow.rows, benchError: (bench && bench.error) || '', noteRows: notesNow.rows,
           patternRows: patternsNow.rows, patternsError: (patterns && patterns.error) || '' };
}


// ── DOM builders ──────────────────────────────────────────────────────────────

function buildFsScope() {
  const el = document.createElement('div');
  el.className = 'fs-scope';
  el.textContent = 'Fund = Indian equity funds & stocks, US equity, precious metals and crypto, from the monthly snapshots. ' +
    'EPF, bank, debt / arbitrage funds, land and uninvested US cash are not part of it. The filters above do not apply here.';
  return el;
}

function buildFsReturnTile(label, w, benchLabel) {
  if (w.need) {
    return `<div class="fs-ret fs-ret-gated">
      <div class="fs-ret-label">${label}</div>
      <div class="fs-ret-need">${fsNeed(w.need)}</div>
    </div>`;
  }
  return `<div class="fs-ret" title="${snapEsc(fmtDay(w.from) + ' → ' + fmtDay(w.to))}">
      <div class="fs-ret-label">${label}</div>
      <div class="fs-ret-value ${fsTone(w.ret * 100)}">${fmtPct(w.ret)}</div>
      <div class="fs-ret-bench">${snapEsc(benchLabel)} ${fmtPct(w.bench)}</div>
      <div class="fs-ret-gap ${fsTone(w.gap)}">${w.gap === null ? 'no benchmark value' : fmtPts(w.gap)}</div>
      <div class="fs-ret-from">${w.sub || 'since ' + fmtDay(w.from)}</div>
    </div>`;
}

function buildFsHeadline(model, benchError) {
  const h = model.headline, last = model.points[model.points.length - 1];
  const tiles = h.windows.map(w => buildFsReturnTile(w.annualise ? `${w.label} p.a.` : w.label, w, model.benchLabel));
  const inc = h.inception;
  if (inc.need || inc.annRet === null) {
    tiles.push(buildFsReturnTile('Since inception', inc, model.benchLabel));
  } else {
    tiles.push(buildFsReturnTile('Since inception p.a.', {
      from: inc.from, to: inc.to, ret: inc.annRet, bench: inc.annBench,
      gap: inc.annBench === null ? null : (inc.annRet - inc.annBench) * 100,
      sub: `total ${fmtPct(inc.ret)} since ${fmtDay(inc.from)}`,
    }, model.benchLabel));
  }
  let change = '';
  if (h.change !== null) {
    const arrow = h.change >= 0 ? '▲' : '▼';
    const pct = h.changePct === null ? '' : ` (${fmtPct(h.changePct)})`;
    const reval = Math.round(last.reval) ? ` · revaluation ${fmtRupees(last.reval, true)}` : '';
    change = `
    <div class="fs-change ${fsTone(h.change, 0)}">${arrow} ${fmtRupees(h.change)}${pct} since ${snapEsc(fmtDay(h.prevAsOf))}</div>
    <div class="fs-split">Market move ${fmtRupees(last.move, true)} · net new money ${fmtRupees(last.flow, true)}${reval}</div>`;
  }
  const foot = [
    'Time-weighted returns: money you add or take out never counts as performance.',
    `Benchmark: ${model.benchLabel} total return (index-fund NAV).`,
  ];
  if (benchError) foot.push(`Benchmark values unavailable: ${benchError}.`);
  else if (!model.benchFrom) foot.push(`${model.benchLabel} values are not loaded yet — run backfillBenchmarks() in Apps Script.`);
  else if (model.benchFrom > model.points[0].d) foot.push(`${model.benchLabel} values start ${fmtDay(model.benchFrom)}.`);
  if (model.atCost) {
    foot.push(`${model.atCost} asset-month(s) valued at cost (no price on record) carry no market move; when such a holding ` +
      'gets a price, the change is a revaluation, not a return.');
  }
  return fsCard(`Fund · as of ${snapEsc(fmtDay(h.asOf))}`, `
    <div class="fs-value-row">
      <div class="fs-value">${fmtRupees(h.value)}</div>
      <div>${change}</div>
    </div>
    <div class="fs-returns">${tiles.join('')}</div>
    <div class="fs-foot">${foot.map(snapEsc).join(' ')}</div>`, 'fs-headline', 'fund', buildFsHeadlineExample(h, model.benchLabel));
}

// The ⓘ line on the headline: the 1Y window (else the longest one shown) in plain words.
function buildFsHeadlineExample(h, benchLabel) {
  const shown = h.windows.filter(w => !w.need && w.bench !== null && !w.annualise);
  const w = shown.find(x => x.key === 'y1') || shown[shown.length - 1];
  if (!w) return '';
  return `From ${fmtDay(w.from)} to ${fmtDay(w.to)} (${w.label}) your fund returned ${fmtPct(w.ret)} and ${benchLabel} ` +
    `${fmtPct(w.bench)}, a gap of ${fmtPts(w.gap)}: ₹100 in the fund became ₹${(100 * (1 + w.ret)).toFixed(2)}, ` +
    `₹100 in the index ₹${(100 * (1 + w.bench)).toFixed(2)}.`;
}

function buildFsChartCard(title, canvasId, sub = '', help = '', example = '') {
  return fsCard(title, `
    ${sub ? `<div class="fs-sub">${sub}</div>` : ''}
    <div class="chart-canvas-wrap"><canvas id="${canvasId}"></canvas></div>
    <div class="fs-foot" id="${canvasId}-foot"></div>`, '', help, example);
}

function buildFsRiskTile(label, value, sub, tone = '') {
  return `<div class="fs-ret">
      <div class="fs-ret-label">${label}</div>
      <div class="fs-ret-value ${tone}">${value}</div>
      <div class="fs-ret-from">${sub}</div>
    </div>`;
}

function buildFsRisk(model) {
  const { vol, dd, ddBench, benchLabel } = model;
  const b = snapEsc(benchLabel);
  const tiles = [];
  if (vol.need) {
    tiles.push(`<div class="fs-ret fs-ret-gated"><div class="fs-ret-label">Volatility p.a.</div><div class="fs-ret-need">${fsNeed(vol.need)}</div></div>`);
  } else {
    const benchVol = vol.bench === null ? '—' : (vol.bench * 100).toFixed(1) + '%';
    tiles.push(buildFsRiskTile('Volatility p.a.', `${(vol.vol * 100).toFixed(1)}%`, `${b} ${benchVol} · last ${fsMonths(vol.months)}`));
  }
  if (dd.need) {
    tiles.push(`<div class="fs-ret fs-ret-gated"><div class="fs-ret-label">Drawdowns</div><div class="fs-ret-need">${fsNeed(dd.need)}</div></div>`);
  } else {
    const benchWorst = ddBench.need ? '' : ` · ${b} ${fmtPct(ddBench.max)}`;
    tiles.push(buildFsRiskTile('Max drawdown', fmtPct(dd.max),
      dd.max < 0 ? `${snapEsc(fmtDay(dd.peakD))} → ${snapEsc(fmtDay(dd.troughD))}${benchWorst}` : `no fall from a high yet${benchWorst}`,
      fsTone(dd.max * 100)));
    tiles.push(buildFsRiskTile('Current drawdown', fmtPct(dd.current),
      dd.sinceHigh > 0 && dd.current < 0 ? `below the ${snapEsc(fmtDay(dd.highD))} high · ${fsMonths(dd.sinceHigh)}` : 'at its high',
      fsTone(dd.current * 100)));
    let rec = '—', recSub = 'no drawdown yet';
    if (dd.recoverMonths !== null) {
      rec = fsMonths(dd.recoverMonths);
      recSub = `trough ${snapEsc(fmtDay(dd.troughD))} → back at the high ${snapEsc(fmtDay(dd.recoverD))}`;
    } else if (dd.max < 0) {
      rec = 'Not yet';
      recSub = `${fsMonths(dd.sinceTrough)} since the ${snapEsc(fmtDay(dd.troughD))} trough`;
    }
    tiles.push(buildFsRiskTile('Recovery from the worst', rec, recSub));
  }
  const eg = [];
  if (!vol.need) eg.push(`A typical month landed about ${(vol.vol * 100 / Math.sqrt(12)).toFixed(1)}% above or below the average month (${(vol.vol * 100).toFixed(1)}% a year).`);
  if (!dd.need && dd.max < 0) eg.push(`The biggest fall was ${fmtPct(dd.max)}: ₹100 at the ${fmtDay(dd.peakD)} high was ₹${(100 * (1 + dd.max)).toFixed(0)} by ${fmtDay(dd.troughD)}.`);
  return fsCard('Risk', `
    <div class="fs-returns fs-risk">${tiles.join('')}</div>
    <div class="fs-foot">Volatility = standard deviation of one-month time-weighted returns × √12. Drawdowns are on the
      growth-of-₹100 index, so new money never hides a fall.</div>`, '', 'risk', eg.join(' '));
}

function buildFsContribCard(model) {
  const c = model.contrib, last = c[c.length - 1];
  const yearAgo = c.find(x => x.month === monthShift(last.month, -12));
  const share = x => (x && x.share !== null ? (x.share * 100).toFixed(1) + '%' : '—');
  return fsCard('Money put in vs market', `
    <div class="fs-stats">
      <div><span>Net money put in</span><b>${fmtRupees(last.putIn, last.putIn < 0)}</b></div>
      <div><span>Market added</span><b class="${fsTone(last.market, 0)}">${fmtRupees(last.market, true)}</b></div>
      <div><span>Growth share of value</span><b>${share(last)}</b></div>
      <div><span>12 months earlier</span><b>${share(yearAgo)}</b></div>
    </div>
    <div class="chart-canvas-wrap"><canvas id="chart-fs-contrib"></canvas></div>
    <div class="fs-foot">Net money put in = money added − money taken out (amounts taken out are estimated at the holding's
      average gain ratio for that month). Market added = the sum of every month's market move, plus revaluations of holdings
      first priced after being held at cost. Together they equal the value.</div>`, '', 'contrib',
    last.putIn >= 0
      ? `Of ${fmtRupees(last.putIn + last.market)}, ${fmtRupees(last.putIn)} is money you put in and ${fmtRupees(last.market, true)} ` +
        `came from the market (${share(last)} of the value).`
      : `Of ${fmtRupees(last.putIn + last.market)}, the market added ${fmtRupees(last.market, true)}, and you have taken out ` +
        `${fmtRupees(-last.putIn)} more than you put in.`);
}

function buildFsNoteCard(model, noteRows) {
  const n = model.note;
  if (!n) return fsCard('Manager\'s note', `<p class="chart-empty">${fsNeed(1)}</p>`, 'fs-note', 'note');
  const all = ACCOUNTS.isAll();
  const mine = !all ? [] : noteRows.filter(r => String(r.account) === 'all' && /^\d{4}-\d{2}/.test(String(r.month)))
    .sort((a, b) => (String(a.month) < String(b.month) ? 1 : -1));
  const saved = mine.find(r => String(r.month).slice(0, 7) === n.month);
  const lines = saved ? String(saved.note).split('\n') : n.lines;
  let status = `Saved with the ${monthLabel(n.month)} snapshot.`;
  if (!all) status = 'Written from this account\'s snapshots. Monthly notes are saved for All accounts only.';
  else if (!saved && n.month === localYMD(new Date()).slice(0, 7)) status = 'Written from the snapshots — saved when this month\'s snapshot is taken.';
  else if (!saved) status = 'Written from the snapshots — no note was saved for this month.';
  const earlier = mine.filter(r => String(r.month).slice(0, 7) < n.month);
  return fsCard(`Manager's note · ${snapEsc(monthLabel(n.month))}`, `
    <ul class="fs-note-lines">${lines.map(l => `<li>${snapEsc(l)}</li>`).join('')}</ul>
    <div class="fs-foot">${snapEsc(status)}</div>
    ${earlier.length ? `<details class="fs-note-earlier"><summary>Earlier notes (${earlier.length})</summary>
      ${earlier.map(r => `<div class="fs-note-month">${snapEsc(monthLabel(String(r.month).slice(0, 7)))}</div>
        <ul class="fs-note-lines">${String(r.note).split('\n').map(l => `<li>${snapEsc(l)}</li>`).join('')}</ul>`).join('')}
    </details>` : ''}`, 'fs-note', 'note');
}


// ── Render ────────────────────────────────────────────────────────────────────

// Factsheet tab: Take snapshot panel → headline → charts → risk → money put in vs market →
// snapshot card → manager's note.
function renderFactsheetTab(container, rawData) {
  container.appendChild(buildFsScope());
  container.appendChild(buildSnapshotTake());
  const body = document.createElement('div');
  body.id = 'factsheet-body';
  body.appendChild(fsCard('Fund', '<p class="chart-empty">Loading the factsheet…</p>'));
  container.appendChild(body);
  container.appendChild(buildSnapshotCard());
  const note = document.createElement('div');
  note.id = 'factsheet-note';
  container.appendChild(note);
  requestAnimationFrame(() => {
    drawSnapshotTake();
    drawFactsheetThenCard(rawData);
  });
}

// The snapshot card draws after the factsheet so it reuses the snapshot data fetched there.
async function drawFactsheetThenCard(rawData) {
  try { await drawFactsheet(rawData); } finally { drawSnapshotCard(); }
}

// rawData: the Insights entries (transactions) for the "What's happening" cards; without it
// those cards are left out.
async function drawFactsheet(rawData = _insightsCache) {
  const body = document.getElementById('factsheet-body');
  if (!body) return;
  const account = String(ACCOUNTS.current);
  const req = ++_fsReq;
  let data;
  try {
    data = await fetchFactsheetData(account);
  } catch (e) {
    if (body.isConnected && req === _fsReq) body.innerHTML = fsCard('Fund', `<p class="chart-empty">Factsheet unavailable: ${snapEsc(e.message)}</p>`).outerHTML;
    return;
  }
  // The user may have switched tab / account while this was loading — draw nowhere stale.
  if (!body.isConnected || req !== _fsReq || String(ACCOUNTS.current) !== account) return;
  const empty = msg => { body.innerHTML = ''; body.appendChild(fsCard('Fund', `<p class="chart-empty">${msg}</p>`)); };
  if (data.redeploy) return empty(snapEsc(SNAP_REDEPLOY));
  if (!data.snap.months.length) return empty('No snapshots yet — run setupSnapshots() and backfillSnapshots() in Apps Script.');
  let model;
  try {
    model = computeFactsheet(data.snap, data.benchRows);
  } catch (e) {
    return empty(`Factsheet could not be computed: ${snapEsc(e.message)}`);
  }
  if (!model.points.length) return empty('No fund holdings in the snapshots yet.');

  // Charts from an earlier draw of this tab sit on canvases that are about to go.
  _insightsCharts = _insightsCharts.filter(c => {
    if (!c.canvas || !body.contains(c.canvas)) return true;
    try { c.destroy(); } catch (_) {}
    return false;
  });
  body.innerHTML = '';
  body.appendChild(buildFsHeadline(model, data.benchError));
  if (rawData) {
    const feed = computePatternFeed(buildPatternContext(data, rawData));
    body.appendChild(buildPatternSection(feed, data.patternRows, model.points[model.points.length - 1].month, FS_TOP_PATTERNS, data.patternsError));
  }
  const first = model.points[0], last = model.points[model.points.length - 1];
  body.appendChild(buildFsChartCard('Growth of ₹100 since inception', 'chart-fs-growth', '', 'growth',
    `₹100 at the first snapshot (${fmtDay(first.d)}) is ₹${last.idx.toFixed(0)} at the latest (${fmtDay(last.d)}).`));
  const rollSub = model.rolling.need || model.rolling.aheadPct === null ? ''
    : `Ahead of ${snapEsc(model.benchLabel)} in ${model.rolling.ahead} of ${model.rolling.compared} rolling 12-month periods ` +
      `(${(model.rolling.aheadPct * 100).toFixed(0)}%)`;
  const r = document.createElement('div');
  r.className = 'insights-grid-2 fs-grid';
  r.appendChild(buildFsChartCard('Calendar-year returns', 'chart-fs-calendar', '', 'calendar'));
  r.appendChild(buildFsChartCard('Rolling 1-year return', 'chart-fs-rolling', rollSub, 'rolling'));
  body.appendChild(r);
  body.appendChild(buildFsRisk(model));
  body.appendChild(buildFsContribCard(model));

  const note = document.getElementById('factsheet-note');
  if (note) { note.innerHTML = ''; note.appendChild(buildFsNoteCard(model, data.noteRows)); }

  requestAnimationFrame(() => {
    if (!body.isConnected) return;
    drawFsGrowth(model);
    drawFsCalendar(model);
    drawFsRolling(model);
    drawFsContrib(model);
  });
}


// ── Charts ────────────────────────────────────────────────────────────────────

function drawFsGrowth(model) {
  const { points, navs, benchLabel } = model;
  const b0 = navs.findIndex(v => v > 0);                               // the benchmark starts at the fund's level
  const bench = navs.map((v, i) => (b0 >= 0 && i >= b0 && v > 0 ? v / navs[b0] * points[b0].idx : null));
  const dot = points.length > 36 ? 0 : 2;
  newChart('chart-fs-growth', {
    type: 'line',
    data: {
      labels: points.map(p => monthLabel(p.month)),
      datasets: [
        { label: 'Fund', data: points.map(p => Math.round(p.idx * 10) / 10), borderColor: FS_FUND,
          backgroundColor: 'rgba(245,158,11,0.08)', fill: true, tension: 0.25, pointRadius: dot, pointHoverRadius: 5, borderWidth: 2.5 },
        { label: benchLabel, data: bench.map(v => (v === null ? null : Math.round(v * 10) / 10)), borderColor: FS_BENCH,
          backgroundColor: 'transparent', borderDash: [5, 4], tension: 0.25, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
      ],
    },
    options: {
      responsive: true,
      aspectRatio: fsAspect(),
      interaction: { mode: 'index', intersect: false },
      plugins: {
        datalabels: { display: false },
        legend: fsLegend(),
        tooltip: { callbacks: {
          title: items => 'As of ' + fmtDay(points[items[0].dataIndex].d),
          label: ctx => (ctx.raw === null ? null : ` ${ctx.dataset.label}: ₹${ctx.raw.toFixed(1)}`),
        } },
      },
      scales: {
        x: fsAxis({ ticks: { color: CT().tick, maxRotation: 45, maxTicksLimit: 14, font: { size: 10 } } }),
        y: fsAxis({ ticks: { color: CT().tick, callback: v => '₹' + v, font: { size: 10 } } }),
      },
    },
  });
  const foot = document.getElementById('chart-fs-growth-foot');
  if (foot) foot.textContent = `₹100 placed in the fund on ${fmtDay(points[0].d)} and in ${benchLabel}` +
    (b0 > 0 ? ` (from ${fmtDay(points[b0].d)}, at the fund's level then)` : '') + ', each growing at its time-weighted return.';
}

function drawFsCalendar(model) {
  const { years, short } = model.calendar;
  const why = { before: 'part year (before the first snapshot)', gap: 'part year (a month has no snapshot)' };
  const foot = document.getElementById('chart-fs-calendar-foot');
  if (foot && short.length) {
    foot.textContent = 'Not shown (each year needs Dec → Dec, 13 monthly points): ' +
      short.map(s => `${s.year} ${s.need ? fsNeed(s.need) : why[s.part]}`).join(' · ');
  }
  if (!years.length) {
    const next = short.find(s => s.need);
    return emptyCard('chart-fs-calendar', next ? `First full calendar year ${fsNeed(next.need)}.` : 'No full calendar year yet.');
  }
  newChart('chart-fs-calendar', {
    type: 'bar',
    data: {
      labels: years.map(y => String(y.year)),
      datasets: [
        { label: 'Fund', data: years.map(y => y.ret * 100), backgroundColor: 'rgba(245,158,11,0.85)', borderRadius: 4, maxBarThickness: 34 },
        { label: model.benchLabel, data: years.map(y => (y.bench === null ? null : y.bench * 100)), backgroundColor: 'rgba(100,116,139,0.75)',
          borderRadius: 4, maxBarThickness: 34 },
      ],
    },
    options: {
      responsive: true,
      aspectRatio: 1.6,
      plugins: {
        datalabels: { display: false },
        legend: fsLegend(),
        tooltip: { callbacks: {
          label: ctx => (ctx.raw === null ? null : ` ${ctx.dataset.label}: ${fmtPct(ctx.raw / 100)}`),
          afterBody: items => { const y = years[items[0].dataIndex]; return y.gap === null ? '' : `Gap: ${fmtPts(y.gap)}`; },
        } },
      },
      scales: {
        x: fsAxis({ grid: { display: false } }),
        y: fsAxis({ ticks: { color: CT().tick, callback: v => v + '%', font: { size: 10 } } }),
      },
    },
  });
}

function drawFsRolling(model) {
  const roll = model.rolling;
  const foot = document.getElementById('chart-fs-rolling-foot');
  if (roll.need) return emptyCard('chart-fs-rolling', `The rolling chart ${fsNeed(roll.need)}.`);
  if (foot) foot.textContent = 'Each point: the time-weighted return over the 12 months ending that month.';
  newChart('chart-fs-rolling', {
    type: 'line',
    data: {
      labels: roll.rows.map(x => monthLabel(x.month)),
      datasets: [
        { label: 'Fund', data: roll.rows.map(x => x.ret * 100), borderColor: FS_FUND, backgroundColor: 'transparent',
          tension: 0.25, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2.5 },
        { label: model.benchLabel, data: roll.rows.map(x => (x.bench === null ? null : x.bench * 100)), borderColor: FS_BENCH,
          backgroundColor: 'transparent', borderDash: [5, 4], tension: 0.25, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
      ],
    },
    options: {
      responsive: true,
      aspectRatio: 1.6,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        datalabels: { display: false },
        legend: fsLegend(),
        tooltip: { callbacks: {
          title: items => '12 months to ' + fmtDay(roll.rows[items[0].dataIndex].d),
          label: ctx => (ctx.raw === null ? null : ` ${ctx.dataset.label}: ${fmtPct(ctx.raw / 100)}`),
        } },
      },
      scales: {
        x: fsAxis({ ticks: { color: CT().tick, maxRotation: 45, maxTicksLimit: 8, font: { size: 10 } } }),
        y: fsAxis({ ticks: { color: CT().tick, callback: v => v + '%', font: { size: 10 } } }),
      },
    },
  });
}

function drawFsContrib(model) {
  const c = model.contrib;
  const dot = c.length > 36 ? 0 : 2;
  newChart('chart-fs-contrib', {
    type: 'line',
    data: {
      labels: c.map(x => monthLabel(x.month)),
      datasets: [
        { label: 'Net money put in', data: c.map(x => Math.round(x.putIn)), borderColor: FS_PUT_IN,
          backgroundColor: 'rgba(14,165,233,0.16)', fill: 'origin', tension: 0.2, pointRadius: dot, borderWidth: 2 },
        { label: 'Value (shaded: market added)', data: c.map(x => Math.round(x.value)), borderColor: FS_MARKET,
          fill: { target: '-1', above: 'rgba(34,197,94,0.22)', below: 'rgba(239,68,68,0.22)' },
          tension: 0.2, pointRadius: dot, borderWidth: 2 },
        { label: 'Growth share of value', data: c.map(x => (x.share === null ? null : x.share * 100)), borderColor: FS_SHARE,
          backgroundColor: 'transparent', borderDash: [4, 3], tension: 0.2, pointRadius: 0, borderWidth: 1.5, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true,
      aspectRatio: fsAspect(),
      interaction: { mode: 'index', intersect: false },
      plugins: {
        datalabels: { display: false },
        legend: fsLegend(),
        tooltip: { callbacks: {
          title: items => 'As of ' + fmtDay(c[items[0].dataIndex].d),
          label: ctx => {
            if (ctx.raw === null) return null;
            if (ctx.dataset.yAxisID === 'y1') return ` Growth share: ${ctx.raw.toFixed(1)}%`;
            return ` ${ctx.datasetIndex === 1 ? 'Value' : ctx.dataset.label}: ${fmtCurrency(ctx.raw)}`;
          },
          afterBody: items => ` Market added: ${fmtRupees(c[items[0].dataIndex].market, true)}`,
        } },
      },
      scales: {
        x: fsAxis({ ticks: { color: CT().tick, maxRotation: 45, maxTicksLimit: 14, font: { size: 10 } } }),
        y: fsAxis({ ticks: { color: CT().tick, callback: fmtAxis, font: { size: 10 } }, beginAtZero: true }),
        y1: fsAxis({ position: 'right', ticks: { color: CT().tick, callback: v => v + '%', font: { size: 10 } }, grid: { display: false } }),
      },
    },
  });
}


// ── Monthly note: saved right after Take snapshot ─────────────────────────────

// Called by the Take snapshot dialog once the snapshot is saved: redraws the factsheet and the
// snapshot card from the new data, writes this month's note and "What's happening" feed for all
// accounts (the snapshot covers them all), then redraws once more to show them as saved. The feed
// is saved only from complete inputs (no partial Insights load, benchmarks read).
async function saveManagerNoteAfterTake() {
  let raw = _insightsCache;
  if (!raw) { try { raw = await fetchAllInsightsData(); } catch (_) { raw = null; } }
  await drawFactsheetThenCard(raw);
  let snap, bench;
  try {
    const gen = _snapshotGen;
    [snap, bench] = await Promise.all([
      _snapshotCache.all || API.snapshot('snapshotData', { account: 'all' }),
      _fsBench.gen === gen ? _fsBench : API.get('benchmark_prices', { limit: 1000000 }).catch(e => ({ rows: [], error: e.message })),
    ]);
    const model = computeFactsheet(snap, bench.rows || []);
    if (!model.note) return;
    await API.saveManagerNote(model.note.month, 'all', model.note.lines.join('\n'));
    _fsNotesSeq++;
    _fsNotes = { gen: -1, rows: [] };
  } catch (e) {
    showToast('Monthly note not saved: ' + e.message, 'error');
    return;
  }
  try {
    if (!raw || _insightsPartial) throw new Error('Insights data did not load completely — Refresh, then take the snapshot again');
    if (bench.error) throw new Error('benchmark values did not load (' + bench.error + ')');
    const points = computeFundSeries(snap);
    const feed = computePatternFeed(buildPatternContext({ snap, benchRows: bench.rows || [] }, raw, () => true));
    await API.savePatternHistory(points[points.length - 1].month, 'all', feed.map(c => ({
      pattern_id: c.id, holding: c.holding, headline: c.headline, value: Math.round(c.value * 1e6) / 1e6 })));
    _fsNotesSeq++;
    _fsPatterns = { gen: -1, rows: [] };
  } catch (e) {
    showToast('What\'s happening history not saved: ' + e.message, 'error');
  }
  drawFactsheet(raw);
}
