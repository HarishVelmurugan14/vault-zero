// VaultZero — Insights → What's happening: the fund's patterns stated as facts, one card each
// Detectors and ranking in js/fund-engine.js (computePatternFeed); the top cards also show on the
// Factsheet. Each month's feed is saved with the snapshot (pattern_history) for "since" / "ended".

// ── Constants & state ─────────────────────────────────────────────────────────

const WH_SPARK_W = 120;
const WH_SPARK_H = 30;
let _whReq = 0;   // the latest drawHappening() call wins


// ── Data ──────────────────────────────────────────────────────────────────────

// Everything the detectors read, from the factsheet data (snapshots + benchmarks) and the
// Insights entries (transactions). inAccount: which accounts' holdings count.
function buildPatternContext(data, rawData, inAccount) {
  const today = localYMD(new Date());
  const snap = data.snap;
  const points = computeFundSeries(snap);
  const series = computeBenchSeries(data.benchRows);
  const inputs = buildPositionInputs(rawData, inAccount);
  // The same name in two accounts would be one pattern key: name the account on both.
  const count = {};
  snap.assets.forEach(a => { count[a.n] = (count[a.n] || 0) + 1; });
  return {
    today,
    points,
    names: snap.assets.map(a => (count[a.n] > 1 ? `${a.n} · ${ACCOUNTS.name(a.a) || 'account ' + a.a}` : a.n)),
    sleeves: SLEEVES.map(s => ({ key: s.key, label: s.label, points: computeFundSeries(snap, s.cats) })),
    series,
    navs: computeBenchNavs(series, FUND_HEADLINE_BENCH, points),
    inputs,
    rows: inputs.map(p => computePositionPnL(p, today)),
    picks: computeStockPicks(inputs, series, computeFundSeries(snap, [2]), snap.assets),
  };
}


// ── DOM builders ──────────────────────────────────────────────────────────────

// A small inline SVG: a line (index) or bars around a zero line; colours come from the theme.
// signed: false — amounts that are never negative (₹ sold, ₹ bought), drawn in the card's colour.
function buildSparkSvg(spark) {
  if (!spark || !spark.values) return '';
  const W = WH_SPARK_W, H = WH_SPARK_H;
  if (spark.kind === 'line') {
    const v = spark.values.filter(x => isFinite(x));
    if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo;
    const y = x => (span > 0 ? H - 2 - (x - lo) / span * (H - 4) : H / 2);
    const pts = v.map((x, i) => `${(i / (v.length - 1) * W).toFixed(1)},${y(x).toFixed(1)}`).join(' ');
    return `<svg class="wh-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const v = spark.values.map(x => (isFinite(x) ? x : 0));
  if (v.length < 2) return '';
  const signed = spark.signed !== false;
  const max = Math.max(...v.map(Math.abs)) || 1, zero = signed ? H / 2 : H - 1, bw = W / v.length;
  const room = signed ? H / 2 - 1 : H - 2;
  const bars = v.map((x, i) => {
    if (Math.abs(x) / max < 1e-6) return '';                            // nothing that month: no bar
    const h = Math.max(1, Math.abs(x) / max * room);
    let cls = 'wh-bar';
    if (signed) cls = x >= 0 ? 'wh-pos' : 'wh-neg';
    return `<rect class="${cls}" x="${(i * bw + bw * 0.15).toFixed(1)}" y="${(x >= 0 ? zero - h : zero).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="1"/>`;
  }).join('');
  return `<svg class="wh-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" y1="${zero}" x2="${W}" y2="${zero}" class="wh-zero"/>${bars}</svg>`;
}

// Text for a card: escaped, with a signed amount kept on one line (+₹… never breaks after the sign).
function whText(s) {
  return snapEsc(s).replace(/([+−])₹/g, '$1\u2060₹');
}

function buildPatternCard(card, since, month) {
  const who = card.scope === 'fund' ? 'Fund' : card.holding;
  const period = card.from ? `${fmtDay(card.from)} → ${fmtDay(card.to)}` : `as of ${fmtDay(card.to)}`;
  let started = '';
  if (since) started = since[card.key] && since[card.key] < month ? `since ${fmtMonth(since[card.key])}` : 'new this month';
  const help = GUIDE_PATTERNS[card.id];
  const helpName = help ? `the ${help.split(' — ')[0]} pattern for ${who}` : '';
  return `<div class="wh-card wh-${card.tone}">
      <div class="wh-who"><span>${snapEsc(who)}${help ? buildHelpButton(helpName) : ''}</span>${started ? `<span class="wh-since">${snapEsc(started)}</span>` : ''}</div>
      ${help ? `<div class="fs-help" hidden><p>${snapEsc(help)}</p></div>` : ''}
      <div class="wh-headline">${whText(card.headline)}</div>
      <ul class="wh-facts">${card.facts.filter(Boolean).map(f => `<li>${whText(f)}</li>`).join('')}</ul>
      <div class="wh-foot">${buildSparkSvg(card.spark)}<span class="wh-period">${snapEsc(period)}</span></div>
    </div>`;
}

// The feed as a card grid: the first `limit` cards (all when 0), plus — with All accounts, where
// the history is kept — the patterns that ended last month. On the Factsheet a "show all" button
// opens the What's happening tab.
function buildPatternSection(cards, historyRows, month, limit = 0, historyError = '') {
  const hist = ACCOUNTS.isAll() && !historyError
    ? computePatternHistory(cards, (historyRows || []).filter(r => String(r.account) === 'all'), month) : null;
  const shown = limit ? cards.slice(0, limit) : cards;
  const grid = shown.length
    ? `<div class="wh-grid">${shown.map(c => buildPatternCard(c, hist && hist.since, month)).join('')}</div>`
    : '<p class="chart-empty">No pattern passes its data gate yet.</p>';
  const ended = !limit && hist && hist.ended.length
    ? `<div class="fs-note-month">Ended since ${snapEsc(fmtMonth(hist.lastMonth))}</div>
       <ul class="fs-note-lines wh-ended">${hist.ended.map(e => `<li>${snapEsc(e.headline)}</li>`).join('')}</ul>` : '';
  const more = limit && cards.length > limit
    ? `<button type="button" class="btn-outline btn-sm wh-more">Show all ${cards.length}</button>` : '';
  let foot = '';
  if (historyError) foot = `<div class="fs-foot">Pattern history unavailable: ${snapEsc(historyError)}.</div>`;
  else if (!hist) foot = '<div class="fs-foot">When each pattern started is tracked for All accounts.</div>';
  else if (!hist.since) foot = `<div class="fs-foot">No feed was saved for ${snapEsc(fmtMonth(hist.lastMonth))}, so when each pattern started is not known yet.</div>`;
  const card = fsCard(`What's happening${limit ? '' : ` · ${cards.length} pattern${cards.length === 1 ? '' : 's'}`}`, `
    ${grid}${more}${ended}${foot}
    <div class="fs-foot">Facts from the snapshots and transactions, largest ₹ effect first. A pattern shows only when it has the
      months of data it needs.</div>`, 'wh-section', 'patterns');
  const btn = card.querySelector('.wh-more');
  if (btn) btn.addEventListener('click', openHappeningTab);
  return card;
}

function openHappeningTab() {
  const tab = [...document.querySelectorAll('.insights-subnav-tab')].find(b => b.textContent === 'What\'s happening');
  if (tab) tab.click();
}


// ── Render ────────────────────────────────────────────────────────────────────

function renderHappeningTab(container, rawData) {
  container.appendChild(buildFsScope());
  const body = document.createElement('div');
  body.id = 'happening-body';
  body.appendChild(fsCard('What\'s happening', '<p class="chart-empty">Loading…</p>'));
  container.appendChild(body);
  requestAnimationFrame(() => { drawHappening(rawData); });
}

async function drawHappening(rawData) {
  const body = document.getElementById('happening-body');
  if (!body) return;
  const account = String(ACCOUNTS.current);
  const req = ++_whReq;
  let data;
  try {
    data = await fetchFactsheetData(account);
  } catch (e) {
    if (body.isConnected && req === _whReq) body.innerHTML = fsCard('What\'s happening', `<p class="chart-empty">Unavailable: ${snapEsc(e.message)}</p>`).outerHTML;
    return;
  }
  if (!body.isConnected || req !== _whReq || String(ACCOUNTS.current) !== account) return;
  body.innerHTML = '';
  if (data.redeploy) { body.appendChild(fsCard('What\'s happening', `<p class="chart-empty">${snapEsc(SNAP_REDEPLOY)}</p>`)); return; }
  const ctx = buildPatternContext(data, rawData);
  if (!ctx.points.length) { body.appendChild(fsCard('What\'s happening', '<p class="chart-empty">No fund holdings in the snapshots yet.</p>')); return; }
  const cards = computePatternFeed(ctx);
  body.appendChild(buildPatternSection(cards, data.patternRows, ctx.points[ctx.points.length - 1].month, 0, data.patternsError));
}
