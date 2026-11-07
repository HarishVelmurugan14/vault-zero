// VaultZero — Insights → Trends: every holding against its own benchmark, with the stagnation rules
// Numbers from js/fund-engine.js (computeTrends / computeStagnation) over the monthly snapshots and
// BENCHMARK_MAP; facts only.

// ── Constants & state ─────────────────────────────────────────────────────────

const TR_W = 300;
const TR_H = 84;
let _trReq = 0;   // the latest drawTrends() call wins


// ── DOM builders ──────────────────────────────────────────────────────────────

// The holding's growth index (solid) and its benchmark started at the same level (dashed), as an inline SVG.
function buildTrendSvg(line, benchLine) {
  const all = line.concat((benchLine || []).filter(v => v !== null)).filter(v => isFinite(v));
  if (line.length < 2 || !all.length) return '';
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo;
  const x = i => (i / (line.length - 1) * TR_W).toFixed(1);
  const y = v => (span > 0 ? TR_H - 4 - (v - lo) / span * (TR_H - 8) : TR_H / 2).toFixed(1);
  const path = vals => vals.map((v, i) => (v === null || !isFinite(v) ? '' : `${x(i)},${y(v)}`)).filter(Boolean).join(' ');
  const bench = benchLine ? `<polyline class="tr-bench" points="${path(benchLine)}" fill="none" vector-effect="non-scaling-stroke"/>` : '';
  return `<svg class="tr-chart" viewBox="0 0 ${TR_W} ${TR_H}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" y1="${y(100)}" x2="${TR_W}" y2="${y(100)}" class="tr-base"/>
    ${bench}<polyline class="tr-line" points="${path(line)}" fill="none" vector-effect="non-scaling-stroke"/></svg>`;
}

// est: the holding's values are estimates built from its benchmark — no comparison is shown.
// code: its benchmark key ('' / null = BENCHMARK_MAP gives it none).
function buildTrendWindow(w, est, code) {
  if (w.need) return `<div class="tr-win"><span>${w.label}</span><b class="attr-muted">${fsNeed(w.need)}</b></div>`;
  let vs = `bench ${fmtPct(w.bench)} · <span class="${fsTone(w.gap)}">${fmtPts(w.gap)}</span>`;
  if (est) vs = 'not compared';
  else if (!code) vs = 'no benchmark';
  else if (w.bench === null) vs = 'no benchmark value';
  return `<div class="tr-win"><span>${w.label}</span><b class="${fsTone(w.ret * 100)}">${fmtPct(w.ret)}</b><em>${vs}</em></div>`;
}

function buildTrendCard(r) {
  const checks = r.stag && r.stag.checks.length ? `<ul class="tr-checks">${r.stag.checks.map(c => {
    let mark = '○', cls = 'tr-no';
    if (c.na) { mark = '–'; cls = 'tr-na'; } else if (c.need) { mark = '…'; cls = 'tr-wait'; } else if (c.met) { mark = '●'; cls = 'tr-yes'; }
    return `<li class="${cls}"><span class="tr-mark">${mark}</span>${snapEsc(c.rule)}: ${snapEsc(c.detail)}</li>`;
  }).join('')}</ul>` : '';
  const met = r.stag && r.stag.reasons.length;
  let against = r.code ? 'vs ' + snapEsc(r.benchLabel) : 'no benchmark';
  if (r.est) against = 'estimated values — not compared';
  return `<div class="tr-card${met ? ' tr-stagnant' : ''}">
      <div class="tr-head"><b>${snapEsc(r.name)}</b><span>${against}</span></div>
      ${buildTrendSvg(r.line, r.benchLine)}
      <div class="tr-wins">${r.windows.map(w => buildTrendWindow(w, r.est, r.code)).join('')}</div>
      <div class="tr-high">${r.sinceHigh ? `${fsMonths(r.sinceHigh)} since the high of ${snapEsc(fmtDay(r.highD))} · now ${fmtPct(r.fromHigh)}, low ${fmtPct(r.lowSinceHigh)}`
        : `at its high (${snapEsc(fmtDay(r.highD))})`}</div>
      ${checks}
      <div class="wh-period">${snapEsc(fmtDay(r.from))} → ${snapEsc(fmtDay(r.to))}</div>
    </div>`;
}

function buildTrendTable(rows) {
  const cell = (v, fmt, tone) => `<td class="${tone}" data-sort="${v === null || v === undefined ? '' : v}">${v === null || v === undefined ? '—' : fmt(v)}</td>`;
  const win = (r, k) => r.windows.find(w => w.key === k) || {};
  const body = rows.map(r => {
    const y1 = win(r, 'y1'), y3 = win(r, 'y3');
    const met = r.stag ? r.stag.reasons.length : 0;
    return `<tr><td>${snapEsc(attrShort(r.name, 30))}</td>
      ${cell(y1.need ? null : y1.gap, fmtPts, fsTone(y1.gap))}
      ${cell(y3.need ? null : y3.gap, fmtPts, fsTone(y3.gap))}
      ${cell(r.sinceHigh, x => fsMonths(x), '')}
      ${cell(r.fromHigh, x => fmtPct(x), fsTone(r.fromHigh * 100))}
      <td data-sort="${met}">${r.stag && r.stag.type ? (met ? `${met} rule${met === 1 ? '' : 's'} met` : 'none met') : '—'}</td></tr>`;
  }).join('');
  return `<div class="report-table-wrap"><table class="report-table attr-table tr-table">
    <thead><tr><th>Holding</th><th>1Y vs bench</th><th>3Y vs bench p.a.</th><th>Since high</th><th>From high</th><th>Stagnation</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}


// The ⓘ line on the table: the first holding with a 1Y comparison, in plain words.
function buildTrendExample(rows) {
  const ok = x => !x.est && x.code && x.windows.some(w => w.key === 'y1' && !w.need && w.bench !== null);
  const r = rows.find(x => x.scope === 'holding' && ok(x)) || rows.find(ok);
  if (!r) return '';
  const w = r.windows.find(x => x.key === 'y1');
  const high = r.sinceHigh ? `; its last high was ${fsMonths(r.sinceHigh)} ago and it is ${fmtPct(r.fromHigh)} from it` : '; it is at its high';
  return `${r.name}: ${fmtPct(w.ret)} over 1Y vs ${r.benchLabel} ${fmtPct(w.bench)}, a gap of ${fmtPts(w.gap)}${high}.`;
}


// ── Render ────────────────────────────────────────────────────────────────────

function renderTrendsTab(container) {
  container.appendChild(buildFsScope());
  const body = document.createElement('div');
  body.id = 'trends-body';
  body.appendChild(fsCard('Trends', '<p class="chart-empty">Loading…</p>'));
  container.appendChild(body);
  requestAnimationFrame(() => { drawTrends(); });
}

async function drawTrends() {
  const body = document.getElementById('trends-body');
  if (!body) return;
  const account = String(ACCOUNTS.current);
  const req = ++_trReq;
  let data;
  try {
    data = await fetchFactsheetData(account);
  } catch (e) {
    if (body.isConnected && req === _trReq) body.innerHTML = fsCard('Trends', `<p class="chart-empty">Trends unavailable: ${snapEsc(e.message)}</p>`).outerHTML;
    return;
  }
  if (!body.isConnected || req !== _trReq || String(ACCOUNTS.current) !== account) return;
  body.innerHTML = '';
  if (data.redeploy) { body.appendChild(fsCard('Trends', `<p class="chart-empty">${snapEsc(SNAP_REDEPLOY)}</p>`)); return; }
  const points = computeFundSeries(data.snap);
  if (!points.length) { body.appendChild(fsCard('Trends', '<p class="chart-empty">No fund holdings in the snapshots yet.</p>')); return; }
  const rows = computeTrends({ points, names: data.snap.assets.map(a => a.n), series: computeBenchSeries(data.benchRows) });
  const rules = `Stagnation rules — Indian funds, US shares & ETFs, and metals: ${PATTERN_RULES.mfHighMonths}+ months without a new high, or a 3-year return
    ${PATTERN_RULES.mfGapPts}+ pts a year behind the benchmark; Indian stocks and crypto: ${PATTERN_RULES.stockHighMonths}+ months without a
    new high, or ${PATTERN_RULES.stockRangeMonths} months within ±${(PATTERN_RULES.stockBand * 100).toFixed(0)}% of the range's midpoint.
    ● met · ○ not met · … not enough months yet · – cannot be tested for this holding.`;
  const table = fsCard('Trends · every holding vs its own benchmark', `
    ${buildTrendTable(rows)}
    <div class="fs-foot">${data.benchError ? `Benchmark values unavailable: ${snapEsc(data.benchError)}. ` : ''}Benchmarks from BENCHMARK_MAP
      (js/data.js); returns are each holding's time-weighted monthly returns over the months it was held and priced, the benchmark
      over the same snapshot dates. ${rules}</div>`, '', 'trends_table', buildTrendExample(rows));
  body.appendChild(table);
  body.appendChild(fsCard('Holding by holding', `<div class="tr-grid">${rows.map(buildTrendCard).join('')}</div>
    <div class="fs-foot">Lines: the holding's growth (solid; returns only) and its benchmark started at the same level (dashed), latest ${Math.min(36, points.length - 1)} months at most.</div>`,
    '', 'trends_cards'));
  table.querySelectorAll('.tr-table').forEach(t => makeTableSortable(t));
}
