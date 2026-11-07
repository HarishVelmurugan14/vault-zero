// VaultZero — Insights → Positions: P&L by holding, closed positions, stock picks, concentration,
// weights vs mandate, weight drift, activity and the US currency split — numbers only.
// Holdings come from the Insights transactions (average cost, like Holdings); weights and trends
// from the monthly snapshots. Maths in js/fund-engine.js.

// ── Constants & state ─────────────────────────────────────────────────────────

const POS_FUND = '#f59e0b';     // line colour (Classic hue — newChart() maps it for Modern)

const POS_UI = { show: 'open', drift: 12 };   // survives redraws
let _posReq = 0;                               // the latest drawPositions() call wins


// ── Helpers ───────────────────────────────────────────────────────────────────

function posPeriod(days) {
  if (!(days > 0)) return '—';
  const months = Math.floor(days / 30.4375);
  if (months < 1) return `${Math.round(days)}d`;
  const y = Math.floor(months / 12), m = months % 12;
  if (!y) return `${m}m`;
  return m ? `${y}y ${m}m` : `${y}y`;
}

function posPct(x, digits = 1) {
  return x === null || x === undefined ? '—' : fmtPct(x, digits);
}

function posW(x) {
  return (x * 100).toFixed(1) + '%';
}

// extra: markup after the numbers (e.g. a sparkline canvas)
function posTile(label, value, sub = '', tone = '', extra = '') {
  return `<div class="fs-ret">
      <div class="fs-ret-label">${label}</div>
      <div class="fs-ret-value ${tone}">${value}</div>
      ${sub ? `<div class="fs-ret-from">${sub}</div>` : ''}
      ${extra}
    </div>`;
}

// A date's data-sort value (yyyymmdd as a number; the table parses data-sort as a number).
function posDateSort(iso) {
  return iso ? iso.replace(/-/g, '') : '';
}

function posGated(label, need) {
  return `<div class="fs-ret fs-ret-gated"><div class="fs-ret-label">${label}</div><div class="fs-ret-need">${fsNeed(need)}</div></div>`;
}


// ── Data: Insights entries → normalised holdings ──────────────────────────────

// Every fund-scope holding of the selected account (hidden items left out), with its full
// transaction history in ₹ and today's price — the same prices and US cost basis Insights uses.
//   inAccount: which accounts count (default the one selected; the saved monthly history uses all)
//   inScope(catId, assetTable): which categories count (default the fund scope; Tax adds land and debt funds)
//   usSellRate(d): ₹ per $ for a US sale on day d (Tax: the rate the tax rule uses); 0 / none = today's rate
function buildPositionInputs(rawData, inAccount = a => ACCOUNTS.matches(a.account_id), inScope = isInFundScope, usSellRate = null) {
  const out = [];
  (rawData || []).forEach(entry => {
    if (!inScope(entry.catId, entry.stream.assetTable) || HIDDEN.isCat(entry.catId)) return;
    const { stream } = entry;
    const assets = entry.assets.filter(a => inAccount(a) &&
      !HIDDEN.isAsset(stream.assetTable, a.id) && !HIDDEN.isSub(a.subcategory_id));
    const usRate = stream.usEquity ? usEquityLiveRate(entry.assets, _usAux.wires, stream) : 0;
    assets.forEach(a => {
      const id = assetKey(stream, a);
      const txns = entry.txns.filter(t => String(t[stream.assetIdCol]) === id).map(t => {
        const buy = String(t.txn_type).toUpperCase() === 'BUY';
        const d = localYMD(t.txn_date);
        if (stream.usEquity) {
          const usd = parseFloat(t.usd_amount || 0);
          const rate = !buy && usSellRate ? usSellRate(d) || usRate : usRate;
          return { d, buy, qty: parseFloat(t.units || 0), usd, inr: buy ? parseFloat(t[stream.costBasisCol] || 0) : usd * rate };
        }
        return { d, buy, qty: getQtyVal(t), usd: 0, inr: getAmtINR(stream, t) };
      }).filter(t => t.d);
      if (!txns.length) return;
      let price = 0;
      if (stream.currentPriceCol) price = parseFloat(a[stream.currentPriceCol] || 0);
      else if (stream.manualPriceType && a.price_fetch_way === 'formula') price = parseFloat(a.current_price || 0);
      else if (stream.manualPriceType) price = _manualPricesMap[`${stream.manualPriceType}|${id}`] || 0;
      out.push({ key: stream.assetTable + '|' + id, name: String(a[stream.assetNameCol] || id), cat: entry.catId, account: a.account_id,
                 sub: Number(a.subcategory_id) || 0, kind: String(a.asset_type || '').toUpperCase(), price,
                 priceUsd: stream.usEquity ? parseFloat(a[stream.usdPriceCol] || 0) : 0, txns });
    });
  });
  return out;
}


// ── DOM builders ──────────────────────────────────────────────────────────────

function buildPosPnLCard(rows) {
  const shown = rows.filter(r => (POS_UI.show === 'open' ? r.open : true)).sort((a, b) => b.value - a.value || b.total - a.total);
  const sum = f => shown.reduce((x, r) => x + f(r), 0);
  const tot = { cost: sum(r => r.cost), value: sum(r => r.value), unreal: sum(r => r.unreal), realized: sum(r => r.realized),
                total: sum(r => r.total), bought: sum(r => r.bought) };
  const sleeveLabel = r => (SLEEVES.find(s => s.key === r.sleeve) || {}).label || '';
  const money = (v, signed = true) => `<td class="${fsTone(v, 0)}" data-sort="${v}">${fmtRupees(v, signed)}</td>`;
  const pct = v => `<td class="${fsTone(v === null ? null : v * 100)}" data-sort="${v === null ? '' : v}">${posPct(v)}</td>`;
  const body = shown.map(r => `<tr>
      <td>${snapEsc(attrShort(r.name, 30))}${r.unpriced ? ' <span class="attr-muted">at cost</span>' : ''}${r.open ? '' : ' <span class="attr-muted">closed</span>'}</td>
      <td data-sort="${r.value}">${fmtRupees(r.value)}</td>
      ${money(r.total)}${pct(r.totalPct)}${money(r.unreal)}${pct(r.unrealPct)}${money(r.realized)}${pct(r.realizedPct)}
      <td data-sort="${r.cost}">${fmtRupees(r.cost)}</td>
      <td data-sort="${posDateSort(r.first)}">${snapEsc(fmtDay(r.first))}</td>
      <td data-sort="${r.days}">${posPeriod(r.days)}</td>
      <td>${snapEsc(sleeveLabel(r))}</td>
    </tr>`).join('');
  const seg = ['open', 'all'].map(k => `<button type="button" class="btn-sm ${POS_UI.show === k ? 'btn-secondary' : 'btn-outline'}"
    data-show="${k}" aria-pressed="${POS_UI.show === k}">${k === 'open' ? 'Held now' : 'All, incl. closed'}</button>`).join('');
  return fsCard('P&L by holding', `
    <div class="snapshot-view attr-window" role="group" aria-label="Holdings">${seg}</div>
    <div class="report-table-wrap"><table class="report-table attr-table pos-table">
      <thead><tr><th>Holding</th><th>Value</th><th>Total P&amp;L</th><th>Total %</th><th>Unrealized</th><th>Unreal. %</th>
        <th>Realized</th><th>Real. %</th><th>Invested</th><th>First bought</th><th>Held for</th><th>Sleeve</th></tr></thead>
      <tbody>${body}
        <tr class="total-row"><td>Total (${shown.length})</td><td>${fmtRupees(tot.value)}</td>
          <td class="${fsTone(tot.total, 0)}">${fmtRupees(tot.total, true)}</td>
          <td>${tot.bought > 0 ? fmtPct(tot.total / tot.bought) : '—'}</td>
          <td class="${fsTone(tot.unreal, 0)}">${fmtRupees(tot.unreal, true)}</td><td></td>
          <td class="${fsTone(tot.realized, 0)}">${fmtRupees(tot.realized, true)}</td><td></td>
          <td>${fmtRupees(tot.cost)}</td><td></td><td></td><td></td></tr>
      </tbody></table></div>
    <div class="fs-foot">Average cost, as on Holdings: Invested = cost of the units held; Unrealized = value − that cost
      (% of it); Realized = sale proceeds − the cost of the units sold (% of that cost); Total % = total P&amp;L ÷ everything ever
      bought. Held for = since the units held now were first bought (after any full sale) → today; closed: first purchase → last
      sale. US: cost from your wires; sale proceeds at today's USD→INR. Tap a column to sort.</div>`, 'pos-pnl', 'pnl',
    `Across these ${shown.length} holdings: ${fmtRupees(tot.cost)} invested in the units held, worth ${fmtRupees(tot.value)} — ` +
    `${fmtRupees(tot.unreal, true)} unrealized; sales so far realized ${fmtRupees(tot.realized, true)}.`);
}

function buildPosClosedCard(st) {
  if (!st.count) return fsCard('Closed positions', '<p class="chart-empty">No holding has been fully sold yet.</p>', '', 'closed');
  const money = v => (v === null ? '—' : fmtRupees(v, true));
  const tiles = [
    posTile('Closed', String(st.count), `${st.wins} with a gain · ${st.losses} with a loss`),
    posTile('Win rate', (st.winRate * 100).toFixed(0) + '%', 'closed with a realized gain'),
    posTile('Average win', money(st.avgWin), posPct(st.avgWinPct) + ' of the cost sold', 'positive'),
    posTile('Average loss', money(st.avgLoss), posPct(st.avgLossPct) + ' of the cost sold', st.losses ? 'negative' : ''),
    posTile('Best', money(st.best.realized), snapEsc(attrShort(st.best.name, 28)) + ' · ' + posPct(st.best.realizedPct), fsTone(st.best.realized, 0)),
    posTile('Worst', money(st.worst.realized), snapEsc(attrShort(st.worst.name, 28)) + ' · ' + posPct(st.worst.realizedPct), fsTone(st.worst.realized, 0)),
    posTile('Held: winners', posPeriod(st.winDays), 'average, first purchase → last sale'),
    posTile('Held: losers', posPeriod(st.lossDays), 'average, first purchase → last sale'),
  ];
  const list = st.closed.map(r => `<tr><td>${snapEsc(attrShort(r.name, 30))}</td><td data-sort="${posDateSort(r.lastSell)}">${snapEsc(fmtDay(r.lastSell))}</td>
      <td data-sort="${r.days}">${posPeriod(r.days)}</td><td class="${fsTone(r.realized, 0)}" data-sort="${r.realized}">${fmtRupees(r.realized, true)}</td>
      <td class="${fsTone(r.realizedPct * 100)}" data-sort="${r.realizedPct}">${posPct(r.realizedPct)}</td></tr>`).join('');
  return fsCard('Closed positions', `
    <div class="fs-returns pos-tiles">${tiles.join('')}</div>
    <details class="fs-note-earlier"><summary>All ${st.count} closed positions</summary>
      <div class="report-table-wrap"><table class="report-table attr-table">
        <thead><tr><th>Holding</th><th>Last sale</th><th>Held for</th><th>Realized</th><th>%</th></tr></thead>
        <tbody>${list}</tbody></table></div>
    </details>
    <div class="fs-foot">A closed position = a holding fully sold (none held now). % = realized ÷ the cost of the units sold.</div>`, '', 'closed');
}

function buildPosPicksCard(sp, benchLabel, benchError) {
  const title = 'Stock picks vs the same money in ' + snapEsc(benchLabel);
  if (benchError) return fsCard(title, `<p class="chart-empty">Benchmark values unavailable: ${snapEsc(benchError)}.</p>`);
  if (!sp.picks.length) {
    let why = 'No Indian stock transactions up to the latest snapshot.';
    if (sp.noEnd) why = `No ${snapEsc(benchLabel)} value on the latest snapshot day (${snapEsc(fmtDay(sp.asOf))}) — run backfillBenchmarks() in Apps Script.`;
    else if (sp.noValue.length) why = `No ${snapEsc(benchLabel)} value on a transaction day for: ${snapEsc(sp.noValue.join(', '))} — run backfillBenchmarks() in Apps Script.`;
    return fsCard(title, `<p class="chart-empty">${why}</p>`);
  }
  const xirr = sp.xirr === null ? posGated('XIRR', sp.xirrNeed)
    : posTile('XIRR', fmtXIRR(sp.xirr), `${snapEsc(benchLabel)} with the same cashflows ${fmtXIRR(sp.shadowXirr)}`, fsTone(sp.xirr * 100));
  const rows = sp.picks.map(p => `<tr><td>${snapEsc(attrShort(p.name, 30))}${p.open ? '' : ' <span class="attr-muted">closed</span>'}</td>
      <td class="${fsTone(p.gap, 0)}" data-sort="${p.gap}">${fmtRupees(p.gap, true)}</td>
      <td data-sort="${p.value}">${fmtRupees(p.value)}</td><td data-sort="${p.shadow}">${fmtRupees(p.shadow, p.shadow < 0)}</td>
      <td data-sort="${p.bought}">${fmtRupees(p.bought)}</td></tr>`).join('');
  return fsCard(title, `
    <div class="fs-sub">As of the latest snapshot, ${snapEsc(fmtDay(sp.asOf))}.</div>
    <div class="fs-returns pos-tiles">
      ${posTile('Picks vs index twin', fmtRupees(sp.gap, true), `picks ${fmtRupees(sp.value)} · twin ${fmtRupees(sp.shadow, sp.shadow < 0)}`, fsTone(sp.gap, 0))}
      ${xirr}
      ${posTile('Hit rate', `${sp.hits} of ${sp.picks.length}`, `stocks at or above their ${snapEsc(benchLabel)} twin`)}
    </div>
    <div class="chart-canvas-wrap"><canvas id="chart-pos-picks"></canvas></div>
    <div class="report-table-wrap"><table class="report-table attr-table">
      <thead><tr><th>Stock</th><th>Gap</th><th>Value</th><th>Index twin</th><th>Bought</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="fs-foot">Index twin = every purchase of the stock put into ${snapEsc(benchLabel)} that day instead, every sale taking the same ₹
      out of it (a twin goes below zero when a sale takes out more than it holds). Gap = the stock's snapshot value − the twin's (sale
      proceeds are the same on both sides). The line: picks' value at each snapshot − the twins' value then. XIRR is shown once the
      first purchase is a year old.
      ${sp.noValue.length ? 'Left out (no index value on a transaction day): ' + snapEsc(sp.noValue.join(', ')) + '.' : ''}</div>`, '', 'picks',
    buildPosPicksExample(sp, benchLabel));
}

function buildPosConcCard(conc) {
  const l = conc.latest, a = conc.ago;
  const then = (f, fmt) => (a ? `12 months earlier ${fmt(f(a))}` : 'no snapshot 12 months earlier');
  const spark = id => `<div class="pos-spark-wrap"><canvas id="${id}"></canvas></div>`;
  return fsCard('Concentration', `
    <div class="fs-returns pos-tiles">
      ${posTile('Top-5 weight', posW(l.top5), then(x => x.top5, posW), '', spark('spark-pos-top5'))}
      ${posTile('Effective holdings', l.eff.toFixed(1), then(x => x.eff, x => x.toFixed(1)) + ` · ${l.count} held`, '', spark('spark-pos-eff'))}
      ${posTile('Largest position', posW(l.largest), snapEsc(attrShort(l.largestName, 28)) + ' · ' + then(x => x.largest, posW), '', spark('spark-pos-largest'))}
    </div>
    <div class="fs-foot">From the latest snapshot (${snapEsc(fmtDay(l.d))}). Effective holdings = 1 ÷ Σ weight² — the number of equal-sized
      holdings that would be as concentrated. Lines: the latest ${conc.series.length} snapshots.</div>`, '', 'concentration',
    `Your 5 largest holdings are ${posW(l.top5)} of the fund, and its ${l.count} holdings are as concentrated as ${l.eff.toFixed(1)} equal-sized ones.`);
}

function buildPosMandateCard(mg) {
  const row = r => `<tr><td>${snapEsc(r.label)}</td><td class="${fsTone(r.gap)}" data-sort="${r.gap}">${fmtPts(r.gap)}</td>
      <td data-sort="${r.actual}">${r.actual.toFixed(1)}%</td><td data-sort="${r.target}">${r.target.toFixed(1)}%</td>
      <td class="${fsTone(r.gapInr, 0)}" data-sort="${r.gapInr}">${fmtRupees(r.gapInr, true)}</td></tr>`;
  const table = list => `<div class="report-table-wrap"><table class="report-table attr-table">
      <thead><tr><th>Sleeve / holding</th><th>Gap</th><th>Actual</th><th>Mandate</th><th>Gap ₹</th></tr></thead>
      <tbody>${list.map(row).join('')}</tbody></table></div>`;
  return fsCard('Weights vs mandate', `
    <div class="chart-canvas-wrap"><canvas id="chart-pos-mandate"></canvas></div>
    ${table(mg.sleeves)}
    <div class="fs-note-month">Within the sleeves the mandate splits</div>
    <div class="chart-canvas-wrap"><canvas id="chart-pos-mandate-sub"></canvas></div>
    ${table(mg.holdings)}
    <div class="fs-foot">% of the fund at the latest snapshot (${snapEsc(fmtDay(mg.d))}, ${fmtRupees(mg.value)}). Mandate = MANDATE in js/data.js,
      renormalised to 100. Gap ₹ = gap × the fund's value. Holdings the mandate does not name are grouped as "Other" with a 0% mandate.</div>`,
    '', 'mandate', buildPosMandateExample(mg));
}

// The ⓘ line on the picks card. A twin below zero = sales took out more than it held.
function buildPosPicksExample(sp, benchLabel) {
  const twin = sp.shadow >= 0 ? `would be worth ${fmtRupees(sp.shadow)}`
    : `would leave the twin ${fmtRupees(-sp.shadow)} short, because your sales took out more than it held`;
  return `Your stocks are worth ${fmtRupees(sp.value)}; the same purchases and sales in ${benchLabel} ${twin} — a gap of ${fmtRupees(sp.gap, true)}.`;
}

// The ⓘ line on the mandate card: the sleeve furthest from its mandate, in plain words.
function buildPosMandateExample(mg) {
  const r = mg.sleeves.slice().sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  if (!r) return '';
  return `${r.label} is ${r.actual.toFixed(1)}% of the fund against a mandate of ${r.target.toFixed(1)}%: ` +
    `a gap of ${fmtPts(r.gap)}, about ${fmtRupees(Math.abs(r.gapInr))} ${r.gap >= 0 ? 'more' : 'less'} than the plan.`;
}

function buildPosDriftCard(dr) {
  const seg = [6, 12].map(k => `<button type="button" class="btn-sm ${POS_UI.drift === k ? 'btn-secondary' : 'btn-outline'}"
    data-drift="${k}" aria-pressed="${POS_UI.drift === k}">${k}M</button>`).join('');
  if (dr.need) {
    return fsCard('Weight drift', `<div class="snapshot-view attr-window" role="group" aria-label="Window">${seg}</div>
      <p class="chart-empty">${POS_UI.drift}M ${fsNeed(dr.need)}.</p>`, 'pos-drift', 'drift');
  }
  const pts = x => fmtPts(x * 100);
  const rows = dr.sleeves.map(r => `<tr><td>${snapEsc(r.label)}</td><td class="${fsTone(r.delta * 100)}">${pts(r.delta)}</td>
      <td class="${fsTone(r.market * 100)}">${pts(r.market)}</td><td class="${fsTone(r.flows * 100)}">${pts(r.flows)}</td>
      <td>${posW(r.w0)} → ${posW(r.w1)}</td></tr>`).join('');
  return fsCard('Weight drift', `
    <div class="snapshot-view attr-window" role="group" aria-label="Window">${seg}</div>
    <div class="fs-sub">${snapEsc(fmtDay(dr.from))} → ${snapEsc(fmtDay(dr.to))}</div>
    <div class="chart-canvas-wrap"><canvas id="chart-pos-drift"></canvas></div>
    <div class="report-table-wrap"><table class="report-table attr-table">
      <thead><tr><th>Sleeve</th><th>Change</th><th>Market</th><th>Money in/out</th><th>Weight</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="fs-foot">Market = the change the weights would have had with no money added or taken out (each sleeve's start value
      plus its market moves); Money in/out = the rest, from money added or taken out. Market + money in/out = change.</div>`, 'pos-drift', 'drift');
}

function buildPosActivityCard(act) {
  const yr = y => (y.turnover === null ? '—' : (y.turnover * 100).toFixed(1) + '%');
  const last = act.lastYear.points >= 12 ? `turnover ${yr(act.lastYear)}` : `turnover needs a full year of snapshots (${act.lastYear.points} of 12)`;
  return fsCard('Activity', `
    <div class="fs-returns pos-tiles">
      ${posTile(`${act.thisYear.year} so far`, fmtRupees(act.thisYear.bought), `bought · sold ${fmtRupees(act.thisYear.sold)} · turnover ${yr(act.thisYear)}`)}
      ${posTile(String(act.lastYear.year), fmtRupees(act.lastYear.bought), `bought · sold ${fmtRupees(act.lastYear.sold)} · ${last}`)}
    </div>
    <div class="chart-canvas-wrap"><canvas id="chart-pos-activity"></canvas></div>
    <div class="fs-foot">Bought = money put into fund holdings; sold = sale proceeds (latest 24 months by month). Turnover = sold ÷ the
      fund's average snapshot value in that year (${act.thisYear.year}: so far, over ${act.thisYear.points} snapshot(s)).</div>`, '', 'activity');
}

function buildPosUsCard(us) {
  if (!us.total) return fsCard('US equity: stock move vs USD/INR', '<p class="chart-empty">No priced US holdings held now.</p>', '', 'us_split');
  const t = us.total;
  const rows = us.holdings.map(h => `<tr><td>${snapEsc(attrShort(h.name, 28))}</td>
      <td class="${fsTone(h.totalPct * 100)}">${posPct(h.totalPct)}</td>
      <td class="${fsTone(h.stockMove, 0)}">${fmtRupees(h.stockMove, true)} (${posPct(h.stockPct)})</td>
      <td class="${fsTone(h.fxMove, 0)}">${fmtRupees(h.fxMove, true)} (${posPct(h.fxPct)})</td>
      <td>${fmtRupees(h.costInr)}</td><td>${fmtRupees(h.valueInr)}</td></tr>`).join('');
  return fsCard('US equity: stock move vs USD/INR', `
    <div class="fs-returns pos-tiles">
      ${posTile('Stock move', fmtRupees(t.stockMove, true), `${posPct(t.stockPct)} in USD`, fsTone(t.stockMove, 0))}
      ${posTile('USD/INR move', fmtRupees(t.fxMove, true), `₹${t.fxCost.toFixed(2)} → ₹${t.fxNow.toFixed(2)} per $ (${posPct(t.fxPct)})`, fsTone(t.fxMove, 0))}
      ${posTile('In INR', fmtRupees(t.valueInr - t.costInr, true), `${posPct(t.totalPct)} on ${fmtRupees(t.costInr)}`, fsTone(t.valueInr - t.costInr, 0))}
    </div>
    <div class="report-table-wrap"><table class="report-table attr-table">
      <thead><tr><th>Holding</th><th>In INR</th><th>Stock move</th><th>USD/INR move</th><th>Cost ₹</th><th>Value ₹</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="fs-foot">Units held now. Cost ₹ = wire-derived cost basis; cost rate = cost ₹ ÷ cost $ (the wires' all-in rate, so
      transfer charges sit in it). Stock move = (value $ − cost $) × cost rate; USD/INR move = value $ × (rate now − cost rate).
      Together they make the INR result. Uninvested USD cash is not included.</div>`, '', 'us_split',
    `Your US holdings are ${fmtRupees(t.valueInr - t.costInr, true)} in rupees: ${fmtRupees(t.stockMove, true)} from the stocks ` +
    `and ${fmtRupees(t.fxMove, true)} from the dollar going from ₹${t.fxCost.toFixed(2)} to ₹${t.fxNow.toFixed(2)}.`);
}


// ── Render ────────────────────────────────────────────────────────────────────

function renderPositionsTab(container, rawData) {
  container.appendChild(buildFsScope());
  const body = document.createElement('div');
  body.id = 'positions-body';
  body.appendChild(fsCard('Positions', '<p class="chart-empty">Loading…</p>'));
  container.appendChild(body);
  requestAnimationFrame(() => { drawPositions(rawData); });
}

async function drawPositions(rawData) {
  const body = document.getElementById('positions-body');
  if (!body) return;
  const account = String(ACCOUNTS.current);
  const req = ++_posReq;
  let data;
  try {
    data = await fetchFactsheetData(account);
  } catch (e) {
    if (body.isConnected && req === _posReq) body.innerHTML = fsCard('Positions', `<p class="chart-empty">Positions unavailable: ${snapEsc(e.message)}</p>`).outerHTML;
    return;
  }
  if (!body.isConnected || req !== _posReq || String(ACCOUNTS.current) !== account) return;
  if (data.redeploy) { body.innerHTML = fsCard('Positions', `<p class="chart-empty">${snapEsc(SNAP_REDEPLOY)}</p>`).outerHTML; return; }
  const today = localYMD(new Date());
  const inputs = buildPositionInputs(rawData);
  const model = {
    today,
    inputs,
    rows: inputs.map(p => computePositionPnL(p, today)),
    points: computeFundSeries(data.snap),
    names: data.snap.assets.map(x => x.n),
    assets: data.snap.assets,
    benchError: data.benchError,
    series: computeBenchSeries(data.benchRows),
    picksPoints: computeFundSeries(data.snap, [2]),
  };
  renderPositions(body, model);
}

// Lays out every card from the computed model (toggles re-render from it, no refetch).
function renderPositions(body, m) {
  _insightsCharts = _insightsCharts.filter(c => {
    if (!c.canvas || !body.contains(c.canvas)) return true;
    try { c.destroy(); } catch (_) {}
    return false;
  });
  body.innerHTML = '';
  const redraw = () => renderPositions(body, m);
  const benchLabel = BENCHMARKS[FUND_HEADLINE_BENCH].label;
  const L = m.points[m.points.length - 1];

  const pnl = buildPosPnLCard(m.rows);
  pnl.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => { POS_UI.show = b.dataset.show; redraw(); }));
  body.appendChild(pnl);
  body.appendChild(buildPosClosedCard(computeClosedStats(m.rows)));
  const picks = computeStockPicks(m.inputs, m.series, m.picksPoints, m.assets);
  body.appendChild(buildPosPicksCard(picks, benchLabel, m.benchError));
  const conc = L ? computeConcentration(m.points, m.names) : null;
  if (conc) body.appendChild(buildPosConcCard(conc));
  const mg = L ? computeMandateGaps(L, m.names) : null;
  if (mg) body.appendChild(buildPosMandateCard(mg));
  const drift = computeWeightDrift(m.points, POS_UI.drift);
  const dc = buildPosDriftCard(drift);
  dc.querySelectorAll('[data-drift]').forEach(b => b.addEventListener('click', () => { POS_UI.drift = Number(b.dataset.drift); redraw(); }));
  body.appendChild(dc);
  const act = computeActivity(m.inputs, m.points, m.today);
  body.appendChild(buildPosActivityCard(act));
  body.appendChild(buildPosUsCard(computeUsSplit(m.rows)));
  body.querySelectorAll('.pos-table, .attr-table').forEach(t => makeTableSortable(t));

  requestAnimationFrame(() => {
    if (!body.isConnected) return;
    if (picks.picks.length && !m.benchError) drawPosPicks(picks);
    if (conc) drawPosSparks(conc);
    if (mg) {
      drawPosMandate('chart-pos-mandate', mg.sleeves);
      if (mg.holdings.length) drawPosMandate('chart-pos-mandate-sub', mg.holdings);
    }
    if (!drift.need) drawPosDrift(drift);
    drawPosActivity(act);
  });
}


// ── Charts ────────────────────────────────────────────────────────────────────

function drawPosPicks(sp) {
  const rows = sp.running.filter(r => r.gap !== null);
  if (!rows.length) return emptyCard('chart-pos-picks', 'No snapshot since the first purchase yet.');
  newChart('chart-pos-picks', {
    type: 'line',
    data: {
      labels: rows.map(r => monthLabel(r.month)),
      datasets: [{ label: 'Picks − index twin (₹)', data: rows.map(r => Math.round(r.gap)), borderColor: POS_FUND,
                   fill: { target: 'origin', above: 'rgba(34,197,94,0.18)', below: 'rgba(239,68,68,0.18)' },
                   tension: 0.2, pointRadius: rows.length > 36 ? 0 : 2, borderWidth: 2 }],
    },
    options: {
      responsive: true,
      aspectRatio: fsAspect(),
      plugins: {
        datalabels: { display: false },
        legend: fsLegend(),
        tooltip: { callbacks: {
          title: items => 'As of ' + fmtDay(rows[items[0].dataIndex].d),
          label: ctx => ` Gap: ${fmtRupees(ctx.raw, true)}`,
        } },
      },
      scales: {
        x: fsAxis({ ticks: { color: CT().tick, maxRotation: 45, maxTicksLimit: 12, font: { size: 10 } } }),
        y: fsAxis({ ticks: { color: CT().tick, callback: fmtAxis, font: { size: 10 } } }),
      },
    },
  });
}

function drawPosSparks(conc) {
  const spark = (id, values) => newChart(id, {
    type: 'line',
    data: { labels: conc.series.map(x => monthLabel(x.month)), datasets: [{ data: values, borderColor: POS_FUND, backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 1.5 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { datalabels: { display: false }, legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
  spark('spark-pos-top5', conc.series.map(x => x.top5 * 100));
  spark('spark-pos-eff', conc.series.map(x => x.eff));
  spark('spark-pos-largest', conc.series.map(x => x.largest * 100));
}

function drawPosMandate(canvasId, rows) {
  sizeAttrChart(canvasId, rows.length * 1.6);
  newChart(canvasId, {
    type: 'bar',
    data: {
      labels: rows.map(r => attrShort(r.label)),
      datasets: [
        { label: 'Actual', data: rows.map(r => r.actual), backgroundColor: 'rgba(245,158,11,0.85)', borderRadius: 3, maxBarThickness: 12 },
        { label: 'Mandate', data: rows.map(r => r.target), backgroundColor: 'rgba(100,116,139,0.75)', borderRadius: 3, maxBarThickness: 12 },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 4 } },
      plugins: {
        datalabels: { display: false },
        legend: fsLegend(),
        tooltip: { callbacks: {
          label: ctx => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%`,
          afterBody: items => { const r = rows[items[0].dataIndex]; return ` Gap: ${fmtPts(r.gap)} (${fmtRupees(r.gapInr, true)})`; },
        } },
      },
      scales: {
        x: fsAxis({ ticks: { color: CT().tick, callback: v => v + '%', font: { size: 10 } } }),
        y: fsAxis({ grid: { display: false }, ticks: { color: CT().tick, autoSkip: false, font: { size: 10.5 } } }),
      },
    },
  });
}

function drawPosDrift(dr) {
  const rows = dr.sleeves;
  sizeAttrChart('chart-pos-drift', rows.length * 1.2);
  newChart('chart-pos-drift', {
    type: 'bar',
    data: {
      labels: rows.map(r => r.label),
      datasets: [
        { label: 'Market', data: rows.map(r => r.market * 100), backgroundColor: 'rgba(245,158,11,0.85)', borderRadius: 3, maxBarThickness: 16, stack: 'd' },
        { label: 'Money in/out', data: rows.map(r => r.flows * 100), backgroundColor: 'rgba(14,165,233,0.8)', borderRadius: 3, maxBarThickness: 16, stack: 'd' },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 4 } },
      plugins: {
        datalabels: { display: false },
        legend: fsLegend(),
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtPts(ctx.raw)}` } },
      },
      scales: {
        x: fsAxis({ stacked: true, ticks: { color: CT().tick, callback: v => v + ' pts', font: { size: 10 } } }),
        y: fsAxis({ stacked: true, grid: { display: false }, ticks: { color: CT().tick, autoSkip: false, font: { size: 10.5 } } }),
      },
    },
  });
}

function drawPosActivity(act) {
  newChart('chart-pos-activity', {
    type: 'bar',
    data: {
      labels: act.months.map(x => monthLabel(x.month)),
      datasets: [
        { label: 'Bought', data: act.months.map(x => Math.round(x.bought)), backgroundColor: 'rgba(34,197,94,0.8)', borderRadius: 3, maxBarThickness: 14 },
        { label: 'Sold', data: act.months.map(x => -Math.round(x.sold)), backgroundColor: 'rgba(239,68,68,0.8)', borderRadius: 3, maxBarThickness: 14 },
      ],
    },
    options: {
      responsive: true,
      aspectRatio: fsAspect(),
      plugins: {
        datalabels: { display: false },
        legend: fsLegend(),
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtRupees(Math.abs(ctx.raw))}` } },
      },
      scales: {
        x: fsAxis({ stacked: true, ticks: { color: CT().tick, maxRotation: 45, maxTicksLimit: 12, font: { size: 10 } } }),
        y: fsAxis({ stacked: true, ticks: { color: CT().tick, callback: v => fmtAxis(Math.abs(v)), font: { size: 10 } } }),
      },
    },
  });
}
