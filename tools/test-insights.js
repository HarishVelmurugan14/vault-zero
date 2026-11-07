// VaultZero — Insights calculation tests (plain node: `node tools/test-insights.js`)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Harness ───────────────────────────────────────────────────────────────────

const ROOT = path.join(__dirname, '..');
const storage = { getItem: () => null, setItem() {}, removeItem() {} };   // api.js reads it at load
const sandbox = vm.createContext({ console, localStorage: storage });
['js/data.js', 'js/fund-engine.js', 'js/api.js', 'js/insights.js']                  // insights.js: computeXIRR
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f }));
const run = code => vm.runInContext(code, sandbox);
const E = new Proxy({}, { get: (_, name) => run(name) });   // E.computeFundSeries(...) — engine functions

let passed = 0;
let failed = 0;

function check(cond, name, detail = '') {
  if (cond) { passed++; return; }
  failed++;
  console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
}

function near(a, b, tol = 1e-9) {
  return Math.abs(a - b) <= tol;
}

// ── Phase 0: scope, mandate, benchmark map ────────────────────────────────────

function testScope() {
  check(JSON.stringify(run('FUND_SCOPE')) === '[1,2,3,8,9]', 'FUND_SCOPE = Indian EQ MF, Stocks, US, Metals, Crypto');
  check(run('isInFundScope(1, "equity_funds")') === true, 'Indian EQ MF is in scope');
  [4, 5, 6, 7].forEach(c => check(run(`isInFundScope(${c}, "x")`) === false, `category ${c} is out of scope`));
  check(run('isInFundScope(3, "us_cash")') === false, 'uninvested US cash is out of scope');
  check(run('sleeveOf(2).key') === 'india', 'Indian stocks sit in the Indian equity sleeve');
}

function testMandate() {
  const m = run('computeMandateWeights()');
  const total = Object.values(m.sleeves).reduce((s, v) => s + v, 0);
  check(near(total, 100), 'sleeve weights renormalise to 100', String(total));
  check(near(m.sleeves.india, 74 / 95 * 100), 'Indian equity = 74 / 95', String(m.sleeves.india));
  check(near(m.sleeves.crypto, 2 / 95 * 100), 'crypto = 2 / 95', String(m.sleeves.crypto));
  const india = m.holdings.filter(h => h.sleeve === 'india');
  check(near(india.reduce((s, h) => s + h.ofSleeve, 0), 100), 'Indian equity sub-split sums to 100% of its sleeve');
  check(near(india.reduce((s, h) => s + h.ofFund, 0), m.sleeves.india), 'Indian equity sub-split sums to the sleeve\'s fund weight');
  const voo = m.holdings.find(h => h.label === 'VOO');
  check(near(voo.ofSleeve, 60) && near(voo.ofFund, 60 * 7 / 95), 'VOO = 60% of US = 4.42% of the fund', String(voo.ofFund));
}

function testBenchmarkMap() {
  const cases = [
    [1, 'Quant ELSS Tax Saver Growth Option Direct Plan', 'nifty500'],
    [1, 'SBI ELSS Tax Saver Fund Direct Growth', 'nifty500'],
    [1, 'DSP ELSS Tax Saver Fund Direct Plan Growth', 'nifty500'],
    [1, 'HDFC Mid Cap Fund -Direct Plan - Growth Option', 'midcap150'],
    [1, 'Tata Small Cap Fund Direct Growth', 'smallcap250'],
    [1, 'ICICI Prudential Large Cap Fund Direct Plan Growth', 'nifty100'],
    [1, 'ICICI Prudential Nifty LargeMidcap 250 Index Fund Direct Growth', 'largemidcap250'],
    [1, 'Parag Parikh Flexi Cap Direct Growth', 'nifty500'],
    [1, 'HDFC Flexi Cap Fund -Direct Plan - Growth Option', 'nifty500'],
    [1, 'Edelweiss Mid Cap Fund Direct Plan Growth Option', 'midcap150'],
    [1, 'Navi Nifty 50 Index Fund Direct Growth', 'nifty50'],
    [1, 'Nippon India Small Cap Fund Direct Plan Growth Option', 'smallcap250'],
    [1, 'Motilal Oswal Midcap Fund Direct Plan Growth', 'midcap150'],
    [1, 'Quant Large Cap Fund Direct Plan Growth', 'nifty100'],
    [1, 'Quant Small Cap Fund Direct Plan Growth', 'smallcap250'],
    [1, 'ICICI Prudential Bharat 22 FOF Direct Plan Growth', null],
    [1, 'Kotak Emerging Equity Fund Direct Plan Growth', 'midcap150'],
    [1, 'Nippon India Large Cap Fund Direct Plan Growth', 'nifty100'],
    [1, 'UTI Nifty Next 50 Index Fund Direct Plan Growth', null],
    [1, 'Tata Nifty500 Multicap India Manufacturing 50 30 20 Index Fund Direct Plan', null],
    [1, 'HDFC Nifty Midcap 150 Index Fund Direct Plan Growth', 'midcap150'],
    [1, 'Mirae Asset Large & Midcap Fund Direct Plan Growth', 'largemidcap250'],
    [1, 'SBI Large and Midcap Fund Direct Growth', 'largemidcap250'],
    [1, 'Nippon India Multi Cap Fund Direct Growth', 'nifty500'],
    [1, 'Motilal Oswal Nifty 500 Momentum 50 Index Fund', null],
    [1, 'Nifty Midcap 150 Momentum 50 Index Fund', null],
    [2, 'Reliance Industries', 'nifty50'],
    [3, 'VANGUARD S&P 500 ETF', 'voo'],
    [3, 'INVESCO NASDAQ 100 ETF', 'qqqm'],
    [8, 'ICICI Prudential Silver ETF', 'silver'],
    [8, 'Kotak Gold ETF', 'gold'],
    [8, 'Gold Coin', 'gold'],
    [9, 'Ethereum', 'btc'],
    [9, 'Bitcoin', 'btc'],
  ];
  cases.forEach(([cat, name, want]) => {
    const got = run(`benchmarkFor(${cat}, ${JSON.stringify(name)})`);
    check(got === want, `benchmark: ${name}`, `got ${got}, want ${want}`);
  });
  check(run('benchmarkFor(1, "Some Nifty 500 Index Fund")') === 'nifty500', '"Nifty 500" never matches the Nifty 50 rule');
  check(run('benchmarkFor(1, "Quant Multi Asset Fund")') === null, 'an unrecognised fund type has no benchmark (→ toast)');
  check(run('benchmarkFor(3, "Apple Inc")') === null, 'an unmapped US stock has no benchmark (→ toast)');
  const keys = run('Object.keys(BENCHMARKS)');
  check(run('BENCHMARK_MAP').every(r => r.bench === null || keys.includes(r.bench)), 'every BENCHMARK_MAP target is a known BENCHMARKS key (or null)');
}

// ── Phase 1: fund engine (synthetic snapshots) ────────────────────────────────

// snapshotData shaped like gas/snapshot.gs vzsData_: n months from `start`, each as of the 28th;
// cellsAt(t) → { assetKey: { inv, cur, flag, cat, table } }.
function synthSnap(n, cellsAt, start = '2022-12') {
  const months = [], rows = [], assets = [], aIdx = {};
  for (let t = 0; t < n; t++) {
    months.push({ d: E.monthShift(start, t) + '-28', st: t === n - 1 ? 'open' : 'locked', src: 'backfill', notes: '' });
    Object.entries(cellsAt(t)).forEach(([key, c]) => {
      if (aIdx[key] === undefined) { aIdx[key] = assets.length; assets.push({ t: c.table || 'equity_funds', id: key, n: key, a: '1' }); }
      rows.push([t, aIdx[key], c.inv, c.cur, c.flag || 0, String(c.cat || 1), '']);
    });
  }
  return { months, assets, rows };
}

// Benchmark rows on the same as-of days: value = f(t).
function synthBench(n, f, code = 'nifty50', start = '2022-12') {
  const rows = [];
  for (let t = 0; t < n; t++) rows.push({ date: E.monthShift(start, t) + '-28', code, nav: f(t) });
  return rows;
}

function testSteadyGrowth() {
  const snap = synthSnap(37, t => ({ A: { inv: 100000, cur: 100000 * Math.pow(1.01, t) } }));
  const pts = E.computeFundSeries(snap);
  check(pts.length === 37 && pts[0].ret === null, 'steady: one point per month, the first has no return');
  check(pts.slice(1).every(p => near(p.ret, 0.01, 1e-12)), 'steady 1%/month: every monthly TWR = 1%');
  const navs = E.computeBenchNavs(E.computeBenchSeries(synthBench(37, t => 50 * Math.pow(1.005, t))), 'nifty50', pts);
  const h = E.computeHeadline(pts, navs);
  const w = k => h.windows.find(x => x.key === k);
  check(near(w('m1').ret, 0.01, 1e-12), '1M = 1%');
  check(near(w('m3').ret, Math.pow(1.01, 3) - 1, 1e-12), '3M = 1.01³ − 1');
  check(near(w('y1').ret, Math.pow(1.01, 12) - 1, 1e-12), '1Y = 1.01¹² − 1');
  check(near(w('y3').ret, Math.pow(1.01, 12) - 1, 1e-12), '3Y annualised = 1.01¹² − 1');
  check(near(w('y1').bench, Math.pow(1.005, 12) - 1, 1e-12), '1Y benchmark = its own 12-month change');
  check(near(w('y1').gap, (Math.pow(1.01, 12) - Math.pow(1.005, 12)) * 100, 1e-9), '1Y gap in pts = (fund − benchmark) × 100');
  check(near(h.inception.ret, Math.pow(1.01, 36) - 1, 1e-12), 'since inception = 1.01³⁶ − 1');
  const roll = E.computeRolling1Y(pts, navs);
  check(roll.rows.length === 25 && roll.rows.every(r => near(r.ret, Math.pow(1.01, 12) - 1, 1e-12)), 'rolling 1Y: 25 windows, each 1.01¹² − 1');
  check(roll.ahead === 25 && near(roll.aheadPct, 1), 'rolling 1Y: ahead of a 0.5%/month benchmark in every window');
  const cal = E.computeCalendarYears(pts, navs);
  check(JSON.stringify(cal.years.map(y => y.year)) === '[2023,2024,2025]', 'calendar years: only full Dec → Dec years', JSON.stringify(cal.years.map(y => y.year)));
  check(cal.years.every(y => near(y.ret, Math.pow(1.01, 12) - 1, 1e-12)), 'calendar year return = 1.01¹² − 1');
  check(cal.short.length === 1 && cal.short[0].year === 2022 && cal.short[0].part === 'before' && !cal.short[0].need,
    'the year the fund started in is a part year (it can never complete) — no "needs N more"');
  const vol = E.computeVolatility(pts, navs);
  check(!vol.need && near(vol.vol, 0, 1e-9) && vol.months === 36, 'volatility of a constant 1% = 0 over 36 months');
}

function testSipAdded() {
  // Value grows exactly by modified Dietz: V₁ = V₀ + F + r(V₀ + F/2), F = ₹10,000 every month.
  let v = 100000, inv = 100000;
  const cells = [{ A: { inv, cur: v } }];
  for (let t = 1; t < 15; t++) {
    const flow = 10000 * t;                                             // a growing SIP
    v = v + flow + 0.01 * (v + flow / 2);
    inv += flow;
    cells.push({ A: { inv, cur: v } });
  }
  const pts = E.computeFundSeries(synthSnap(15, t => cells[t]));
  check(pts.slice(1).every(p => near(p.ret, 0.01, 1e-12)), 'SIP added: TWR stays 1%/month whatever the money added');
  check(pts.slice(1).every((p, i) => near(p.flow, 10000 * (i + 1), 1e-6)), 'SIP added: net new money = the SIP');
  const c = E.computeContributions(pts);
  check(c.every((x, i) => near(x.putIn + x.market, pts[i].value, 1e-6)), 'put in + market added = value at every point');
}

function testProfitableSell() {
  // Gain ratio 50% throughout; at t = 5 a third of the cost is sold at that ratio — no market move.
  const pts = E.computeFundSeries(synthSnap(8, t => ({
    A: t < 5 ? { inv: 120000, cur: 180000 } : { inv: 80000, cur: 120000 },
    B: { inv: 50000, cur: 50000 * (1 + 0.02 * t) },
  })));
  const p = pts[5];
  check(near(p.moves.find(m => m.ai === 0)?.move || 0, 0, 1e-9), 'profitable sell: the sold holding has no market move');
  check(near(p.flow, -60000, 1e-6), 'profitable sell: proceeds ₹60,000 leave as negative net money', String(p.flow));
  const expected = 1000 / (pts[4].value + p.flow / 2);                 // only B moved (+₹1,000)
  check(near(p.ret, expected, 1e-12), 'profitable sell: the month\'s return comes from the other holding only', `${p.ret} vs ${expected}`);
}

function testFlatAndCrash() {
  // Index path 100 → 110 (peak) → 77 (−30%) → 88 → 99 → 110 (recovered) → 121, then flat 6 months.
  const path = [100, 110, 77, 88, 99, 110, 121, 121, 121, 121, 121, 121, 121];
  const pts = E.computeFundSeries(synthSnap(path.length, t => ({ A: { inv: 100000, cur: 1000 * path[t] } })));
  check(pts.every((p, i) => near(p.idx, path[i], 1e-9)), 'crash and recovery: the index follows the value when nothing is added');
  check(pts.slice(7).every(p => near(p.ret, 0, 1e-12)), 'flat stretch: 0% every month');
  const dd = E.computeDrawdown(pts, pts.map(p => p.idx));
  check(near(dd.max, -0.3, 1e-12), 'max drawdown = −30%');
  check(dd.peakD === pts[1].d && dd.troughD === pts[2].d && dd.recoverD === pts[5].d, 'drawdown dates: peak t1, trough t2, back at the high t5');
  check(dd.recoverMonths === 3, 'months to recover from the trough = 3', String(dd.recoverMonths));
  check(near(dd.current, 0) && dd.highD === pts[12].d && dd.sinceHigh === 0, 'flat at the high: current drawdown 0, high = the latest equal point');
  const open = E.computeDrawdown(pts.slice(0, 4), path.slice(0, 4));
  check(open.recoverMonths === null && open.sinceTrough === 1 && near(open.current, 88 / 110 - 1, 1e-12), 'not yet recovered: months since the trough, current drawdown');
}

function testAtCostAndScope() {
  const pts = E.computeFundSeries(synthSnap(6, t => ({
    A: { inv: 100000, cur: 100000 * (1 + 0.01 * t) },
    G: t < 2 ? { inv: 0, cur: 0 } : { inv: 50000, cur: t < 4 ? 50000 : 65000, flag: t < 4 ? 1 : 0, cat: 8 },  // at cost, then priced
    EPF: { inv: 500000, cur: 600000 + 10000 * t, cat: 6 },
    CASH: { inv: 20000, cur: 20000 * (1 + 0.05 * t), cat: 3, table: 'us_cash' },
  })));
  check(pts.every(p => near(p.value, 100000 * (1 + 0.01 * pts.indexOf(p)) + (pts.indexOf(p) < 2 ? 0 : pts.indexOf(p) < 4 ? 50000 : 65000), 1e-6)),
    'scope: EPF (category 6) and uninvested US cash are not in the fund');
  check(pts[4].moves.every(m => m.ai !== 1), 'valued at cost → priced: the jump is not a market move');
  check(near(pts[3].ret, 1000 / (pts[2].value + pts[3].flow / 2), 1e-12), 'a month with an asset at cost: return from the priced holdings only');
}

function testRevaluation() {
  // G is held at cost (no price) for Jan–Mar, first priced in Apr at +₹15,000, lapses to cost in
  // Jun and is priced again in Jul — none of it is new money or return.
  const g = [null, { inv: 50000, cur: 50000, flag: 1 }, { inv: 50000, cur: 50000, flag: 1 }, { inv: 50000, cur: 50000, flag: 1 },
    { inv: 50000, cur: 65000 }, { inv: 50000, cur: 66000 }, { inv: 50000, cur: 50000, flag: 1 }, { inv: 50000, cur: 68000 }];
  const pts = E.computeFundSeries(synthSnap(8, t => Object.assign({ A: { inv: 100000, cur: 100000 } }, g[t] ? { G: Object.assign({ cat: 8 }, g[t]) } : {})));
  check(near(pts[4].flow, 0) && near(pts[4].reval, 15000) && near(pts[4].move, 0), 'first price for an at-cost holding: no new money, no return — a revaluation');
  check(near(pts[5].move, 1000) && near(pts[5].flow, 0), 'the next priced month is an ordinary market move');
  check(near(pts[6].flow, 0) && near(pts[6].reval, -16000) && near(pts[7].flow, 0) && near(pts[7].reval, 18000), 'price lapsing to cost and coming back: revaluations, flow 0');
  check(pts.slice(1).every(p => near(p.value - (pts[pts.indexOf(p) - 1].value), p.flow + p.move + p.reval, 1e-6)), 'Δvalue = new money + market move + revaluation');
  const c = E.computeContributions(pts);
  check(near(c[7].putIn, 150000) && near(c[7].market, 18000) && c.every((x, i) => near(x.putIn + x.market, pts[i].value, 1e-6)),
    'contributions: put in = cost added, market includes the revaluation, sum = value');
  check(near(pts[1].flow, 50000), 'buying an at-cost holding is new money at its cost');
}

function testMonthGaps() {
  // Monthly points with March 2025 never taken.
  const all = synthSnap(30, t => ({ A: { inv: 100000, cur: 100000 * Math.pow(1.01, t) } }), '2023-01');
  const drop = all.months.findIndex(m => m.d.startsWith('2025-03'));
  const snap = { months: all.months.filter((_, i) => i !== drop), assets: all.assets,
    rows: all.rows.filter(r => r[0] !== drop).map(r => [r[0] > drop ? r[0] - 1 : r[0], ...r.slice(1)]) };
  const pts = E.computeFundSeries(snap);
  const vol = E.computeVolatility(pts, []);
  check(!vol.need && near(vol.vol, 0, 1e-9) && vol.months === 27, 'volatility skips the two-month return across a missed month');
  // 12 months, one missed, 12 more: 24 points but not one 12-month window.
  const two = synthSnap(25, t => ({ A: { inv: 100000, cur: 100000 + t } }), '2023-01');
  const skip = { months: two.months.filter((_, i) => i !== 12), assets: two.assets,
    rows: two.rows.filter(r => r[0] !== 12).map(r => [r[0] > 12 ? r[0] - 1 : r[0], ...r.slice(1)]) };
  const roll = E.computeRolling1Y(E.computeFundSeries(skip), []);
  check(roll.need === 12 && !roll.rows.length, 'rolling chart gated on consecutive windows, not on the point count (needs 12 more)', String(roll.need));
  const cal = E.computeCalendarYears(pts, []);
  check(cal.short.some(y => y.year === 2025 && y.part === 'gap') && cal.years.some(y => y.year === 2024),
    'a year with a missed month is a part year; complete years still show');
  const gapNote = E.computeManagerNote(pts.slice(0, 27), [], snap.assets.map(a => a.n));
  check(gapNote.lines.every(l => !/for the month/.test(l)) && gapNote.lines.some(l => /no one-month return/.test(l)),
    'the note gives no "for the month" return across a missed month');
  const inProgress = E.computeCalendarYears(E.computeFundSeries(synthSnap(17, t => ({ A: { inv: 1, cur: 1 } }), '2023-12')), []);
  check(inProgress.short.some(y => y.year === 2025 && y.need === 8), 'the year in progress needs the months until its December snapshot', JSON.stringify(inProgress.short));
}

function testGates() {
  const pts = E.computeFundSeries(synthSnap(10, t => ({ A: { inv: 1000, cur: 1000 + t } })));
  const h = E.computeHeadline(pts, pts.map(() => null));
  const need = k => h.windows.find(x => x.key === k).need;
  check(!need('m1') && !need('m6') && need('y1') === 3 && need('y3') === 27, '10 points: 1M–6M shown, 1Y needs 3 more, 3Y needs 27 more');
  check(E.computeVolatility(pts, []).need === 14 && E.computeRolling1Y(pts, []).need === 14, '10 points: volatility and rolling chart need 14 more');
  check(h.windows.find(x => x.key === 'm1').bench === null && h.windows.find(x => x.key === 'm1').gap === null, 'no benchmark values → no benchmark number, no gap');
  check(E.computeSinceInception(pts.slice(0, 1), []).need === 1, 'one point: since inception needs 1 more month');
  // A month never taken breaks the run: 1Y needs 13 consecutive points.
  const snap = synthSnap(14, t => ({ A: { inv: 1000, cur: 1000 } }));
  snap.rows = snap.rows.filter(r => r[0] !== 6);
  snap.months[6] = Object.assign({}, snap.months[6]);
  const gap = E.computeFundSeries({ months: snap.months.filter((_, i) => i !== 6), assets: snap.assets,
    rows: snap.rows.map(r => [r[0] > 6 ? r[0] - 1 : r[0], ...r.slice(1)]) });
  check(E.computeWindowReturn(gap, null, 12).need === 6, 'a missing month: 1Y counts only the run after it (needs 6 more)');
}

function testBenchmarks() {
  const series = E.computeBenchSeries([
    { date: '2024-01-31', code: 'x', nav: 10 }, { date: '2024-02-29', code: 'x', nav: 11 },
    { date: '2024-01-15', code: 'x', nav: 9 }, { date: 'bad', code: 'x', nav: 5 }, { date: '2024-03-31', code: 'x', nav: 0 },
  ]);
  check(series.x.length === 3 && series.x[0].d === '2024-01-15', 'benchmark rows: sorted by date, invalid / zero rows dropped');
  const navs = E.computeBenchNavs(series, 'x', [{ d: '2024-01-10' }, { d: '2024-01-31' }, { d: '2024-02-03' }, { d: '2024-03-04' }]);
  check(JSON.stringify(navs) === '[null,10,10,11]', 'benchmark value on or before each as-of day (null before it starts)', JSON.stringify(navs));
  const stale = E.computeBenchNavs(series, 'x', [{ d: '2024-02-07' }, { d: '2024-02-08' }, { d: '2024-04-15' }]);
  check(JSON.stringify(stale) === '[10,null,null]', 'a benchmark value more than 7 days old counts as missing (never a flat 0%)', JSON.stringify(stale));
}

function testVolatility() {
  const rets = [];
  let v = 100000;
  const cells = [{ A: { inv: 100000, cur: v } }];
  for (let t = 1; t < 30; t++) { const r = t % 2 ? 0.02 : -0.01; rets.push(r); v *= 1 + r; cells.push({ A: { inv: 100000, cur: v } }); }
  const pts = E.computeFundSeries(synthSnap(30, t => cells[t]));
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1));
  check(near(E.computeVolatility(pts, []).vol, sd * Math.sqrt(12), 1e-12), 'volatility = sample stdev of monthly returns × √12');
}

function testManagerNote() {
  const snap = synthSnap(14, t => ({
    A: { inv: 100000 + 5000 * t, cur: (100000 + 5000 * t) * (1 + 0.01 * t) },
    B: { inv: 40000, cur: 40000 * (1 - 0.005 * t), cat: 8 },
  }));
  const fs = E.computeFactsheet(snap, synthBench(14, t => 100 + t));
  const n = fs.note;
  check(n && n.lines.length >= 4 && n.lines.length <= 6, 'manager\'s note: 4–6 sentences', n && String(n.lines.length));
  check(n.lines.every(l => !/\b(should|consider|review|buy|sell|recommend)/i.test(l)), 'manager\'s note: facts only — no action words',
    n.lines.find(l => /\b(should|consider|review|buy|sell|recommend)/i.test(l)) || '');
  check(/vs Nifty 50/.test(n.lines[2]) && /pts\)/.test(n.lines[2]), 'manager\'s note: the month\'s TWR next to Nifty 50 with the gap');
  check(n.lines.some(l => /^By sleeve: Indian equity .*Precious metals/.test(l)), 'manager\'s note: one return per sleeve');
}


// ── Phase 2: attribution ──────────────────────────────────────────────────────

function testAttribution() {
  // A grows 1%/month, B falls 0.5%/month, C (metals) is bought in month 6, D is sold in month 8.
  const snap = synthSnap(15, t => {
    const out = {
      A: { inv: 100000, cur: 100000 * Math.pow(1.01, t), cat: 2 },
      B: { inv: 50000 + 2000 * t, cur: (50000 + 2000 * t) * Math.pow(0.995, t), cat: 1 },
    };
    if (t >= 6) out.C = { inv: 30000, cur: 30000 * (1 + 0.02 * (t - 6)), cat: 8 };
    if (t < 8) out.D = { inv: 20000, cur: 20000 * (1 + 0.01 * t), cat: 9 };
    return out;
  });
  const pts = E.computeFundSeries(snap);
  const names = snap.assets.map(a => a.n);
  const r = E.computeAttrRange(pts, 'y1');
  check(r.s === 2 && r.e === 14, '1Y range: the latest point and the one 12 months before', JSON.stringify(r));
  const a = E.computeAttribution(pts, r.s, r.e, names);
  const sum = list => list.reduce((x, h) => x + h.contrib, 0);
  check(near(sum(a.holdings), a.total, 1e-12), 'holding contributions add up exactly to the fund\'s TWR');
  check(near(sum(a.sleeves), a.total, 1e-12), 'sleeve contributions add up exactly to the fund\'s TWR');
  check(near(a.total, pts[14].idx / pts[2].idx - 1, 1e-12), 'attribution total = the fund index change over the period');
  const h = k => a.holdings.find(x => x.name === k);
  check(near(h('A').ret, Math.pow(1.01, 12) - 1, 1e-12) && h('A').fullPeriod, 'a holding held throughout: its own return chained (1.01¹² − 1)');
  check(h('C').ret === null && !h('C').fullPeriod && h('D').ret === null, 'bought or sold inside the period: no holding return (part period)');
  check(h('A').contrib > 0 && h('B').contrib < 0, 'gainers contribute +, losers −');
  check(near(a.holdings.reduce((x, y) => x + Math.abs(y.gainShare), 0), 1, 1e-12), 'shares of the market move: |gains| + |losses| = 100%');
  check(near(a.holdings.reduce((x, y) => x + y.capitalShare, 0), 1, 1e-12), 'shares of capital add up to 100%');
  check(near(a.holdings.reduce((x, y) => x + y.weight, 0), 1, 1e-9), 'average weights add up to 100%');
  const one = E.computeAttribution(E.computeFundSeries(synthSnap(5, t => ({ A: { inv: 1, cur: Math.pow(1.03, t) } }))), 0, 4, ['A']);
  check(near(one.holdings[0].contrib, one.total, 1e-12) && near(one.holdings[0].weight, 1, 1e-12), 'a one-holding fund: contribution = the fund return, weight 100%');
  check(E.computeAttrRange(pts.slice(0, 10), 'y1').need === 3, 'attribution 1Y with 10 points: needs 3 more months');
  check(JSON.stringify(E.computeAttrRange(pts, 'custom', pts[5].month, pts[3].month)) === '{"invalid":true}', 'custom range: From after To is refused');
}

function testHoldingVsBench() {
  const snap = synthSnap(14, t => {
    const out = {
      'Reliance Industries': { inv: 10000, cur: 10000 * Math.pow(1.02, t), cat: 2 },
      'Quant Multi Asset Fund': { inv: 10000, cur: 10000, cat: 1 },
    };
    if (t >= 3) out['Navi Nifty 50 Index Fund'] = { inv: 5000, cur: 5000, cat: 1 };
    return out;
  });
  const pts = E.computeFundSeries(snap);
  const series = E.computeBenchSeries(synthBench(14, t => 100 * Math.pow(1.01, t)));
  const vs = E.computeHoldingVsBench(pts, series, snap.assets.map(a => a.n), 12);
  const rel = vs.rows.find(x => x.name === 'Reliance Industries');
  check(rel && rel.code === 'nifty50' && near(rel.ret, Math.pow(1.02, 12) - 1, 1e-12) && near(rel.bench, Math.pow(1.01, 12) - 1, 1e-12),
    'holding vs its own benchmark: chained return and the benchmark over the same dates');
  check(near(rel.gap, (Math.pow(1.02, 12) - Math.pow(1.01, 12)) * 100, 1e-9), 'gap in pts = (holding − benchmark) × 100');
  check(vs.noBench.includes('Quant Multi Asset Fund') && vs.partial.includes('Navi Nifty 50 Index Fund'),
    'left out and named: no benchmark rule / not held for the whole window');
  check(E.computeHoldingVsBench(pts, series, [], 36, true).need === 23, '3Y with 14 points: needs 23 more months');
}

function testAttributionEdges() {
  // A sold out in month 2 and bought back in month 3; BTC (crypto sleeve) first bought in month 1;
  // G held at cost all along; B flat.
  const snap = synthSnap(5, t => {
    const out = { B: { inv: 100, cur: 100 }, G: { inv: 50, cur: 50, flag: 1, cat: 8 } };
    if (t !== 2) out.A = { inv: 100, cur: [100, 110, 0, 120, 121][t] };
    if (t >= 1) out.BTC = { inv: 100, cur: [0, 120, 120, 125, 130][t], cat: 9 };
    return out;
  });
  const pts = E.computeFundSeries(snap);
  const a = E.computeAttribution(pts, 0, 4, snap.assets.map(x => x.n));
  const h = k => a.holdings.find(x => x.name === k);
  check(h('A').ret === null && h('A').noRet === 'part', 'sold out and bought back inside the period: no holding return (part period)');
  check(h('G').ret === null && h('G').noRet === 'cost', 'held throughout but at cost: no return, reason "cost"');
  check(a.sleeves.find(x => x.key === 'crypto').ret === null, 'a sleeve first bought inside the period: no sleeve return');
  check(a.sleeves.find(x => x.key === 'metals').noRet === 'cost', 'a sleeve with an at-cost holding: no sleeve return');
  check(near(a.holdings.reduce((x, r) => x + r.contrib, 0), a.total, 1e-12), 'contributions still add up to the fund return');

  // Calendar months for the label when a month was never taken.
  const all = synthSnap(6, t => ({ A: { inv: 1, cur: 1 + t / 100 } }), '2025-01');
  const gapSnap = { months: all.months.filter((_, i) => i !== 2 && i !== 3), assets: all.assets,
    rows: all.rows.filter(r => r[0] !== 2 && r[0] !== 3).map(r => [r[0] > 3 ? r[0] - 2 : r[0], ...r.slice(1)]) };
  const gp = E.computeFundSeries(gapSnap);
  const ga = E.computeAttribution(gp, 0, gp.length - 1, ['A']);
  check(ga.months === 5 && ga.steps === 3, 'since inception across a gap: 5 calendar months over 3 snapshot steps', `${ga.months}/${ga.steps}`);
}

function testVsBenchExclusions() {
  const snap = synthSnap(14, t => ({
    'Gold Coin': { inv: 1000, cur: 1000 * (1 + 0.01 * t), flag: t < 10 ? 3 : 0, cat: 8 },
    'Bitcoin': { inv: 1000, cur: 1000 * (1 + 0.02 * t), cat: 9 },
    'Reliance Industries': { inv: 1000, cur: 1100, cat: 2 },
  }));
  const pts = E.computeFundSeries(snap);
  const series = E.computeBenchSeries(synthBench(14, t => 50 + t, 'nifty50'));    // no btc / gold series
  const vs = E.computeHoldingVsBench(pts, series, snap.assets.map(x => x.n), 12);
  check(vs.estimated.includes('Gold Coin'), 'estimated values in the window: left out of the benchmark comparison and named');
  check(vs.noValue.includes('Bitcoin') && !vs.rows.some(r => r.name === 'Bitcoin'), 'no benchmark value on the window dates: named, not drawn');
  check(vs.rows.length === 1 && vs.rows[0].name === 'Reliance Industries' && vs.rows.every(r => r.gap !== null), 'rows all have a gap');
}

// ── Phase 3: positions ────────────────────────────────────────────────────────

const pos = (name, cat, txns, price = 0, extra = {}) => Object.assign({ key: 'x|' + name, name, cat, kind: '', price, priceUsd: 0,
  txns: txns.map(([d, buy, qty, inr, usd]) => ({ d, buy, qty, inr, usd: usd || 0 })) }, extra);

function testPositionPnL() {
  const p = pos('A', 1, [['2025-01-10', true, 10, 1000], ['2025-02-10', true, 10, 1200], ['2025-03-10', false, 5, 750]], 150);
  const r = E.computePositionPnL(p, '2026-01-10');
  check(near(r.cost, 1650) && near(r.value, 2250) && near(r.unreal, 600), 'average cost: 15 units at ₹110 held, worth ₹2,250');
  check(near(r.realized, 200) && near(r.soldCost, 550) && near(r.realizedPct, 200 / 550), 'realized = proceeds − average cost of the units sold');
  check(near(r.total, 800) && near(r.totalPct, 800 / 2200) && r.first === '2025-01-10' && r.days === 365, 'total P&L on all bought; held since the first buy');
  const over = E.computePositionPnL(pos('B', 1, [['2025-01-01', true, 10, 1000], ['2025-02-01', false, 15, 1650]]), '2025-06-01');
  check(over.oversold && near(over.proceeds, 1100) && !over.open && near(over.realized, 100), 'a sale larger than the units held counts only those');
  const sameDay = E.computePositionPnL(pos('C', 1, [['2025-01-01', false, 5, 600], ['2025-01-01', true, 10, 1000]], 100), '2025-01-02');
  check(!sameDay.oversold && near(sameDay.realized, 100), 'same-day buy and sell: the buy counts first');
  const unpriced = E.computePositionPnL(pos('D', 8, [['2025-01-01', true, 1, 5000]], 0), '2025-06-01');
  check(unpriced.unpriced && near(unpriced.value, 5000) && unpriced.unreal === 0 && unpriced.unrealPct === null, 'no price: valued at cost, no unrealized %');
  const closed = E.computePositionPnL(pos('E', 1, [['2025-01-01', true, 10, 1000], ['2025-07-01', false, 10, 900]]), '2026-01-01');
  check(!closed.open && closed.days === E.daysApart('2025-01-01', '2025-07-01'), 'a closed holding is held until its last sale');
}

function testClosedStats() {
  const rows = [
    pos('W1', 1, [['2025-01-01', true, 1, 100], ['2025-03-02', false, 1, 150]]),
    pos('W2', 1, [['2025-01-01', true, 1, 200], ['2025-01-31', false, 1, 220]]),
    pos('L1', 1, [['2025-01-01', true, 1, 100], ['2025-12-27', false, 1, 70]]),
    pos('Open', 1, [['2025-01-01', true, 1, 100]], 120),
  ].map(p => E.computePositionPnL(p, '2026-01-01'));
  const st = E.computeClosedStats(rows);
  check(st.count === 3 && st.wins === 2 && st.losses === 1 && near(st.winRate, 2 / 3), 'closed positions: 2 wins, 1 loss (open ones left out)');
  check(near(st.avgWin, 35) && near(st.avgWinPct, (0.5 + 0.1) / 2) && near(st.avgLoss, -30) && near(st.avgLossPct, -0.3), 'average win / loss in ₹ and %');
  check(st.best.name === 'W1' && st.worst.name === 'L1', 'best and worst by ₹ realized');
  check(near(st.winDays, (60 + 30) / 2) && near(st.lossDays, 360), 'average holding period of winners vs losers');
}

function testStockPicks() {
  const series = E.computeBenchSeries([{ date: '2024-01-15', code: 'nifty50', nav: 100 }, { date: '2025-01-20', code: 'nifty50', nav: 105 },
    { date: '2024-05-31', code: 'nifty50', nav: 101 }, { date: '2025-06-30', code: 'nifty50', nav: 108 }, { date: '2025-07-01', code: 'nifty50', nav: 110 }]);
  const inputs = [pos('Infosys', 2, [['2024-01-15', true, 10, 1000]], 120), pos('Fund', 1, [['2024-01-15', true, 1, 1000]], 1000)];
  const assets = [{ t: 'x', id: 'Infosys' }, { t: 'x', id: 'Fund' }];
  const pt = (d, cur) => ({ d, month: d.slice(0, 7), value: cur, cells: { 0: { cur } } });
  const sp = E.computeStockPicks(inputs, series, [pt('2025-06-30', 1150), pt('2025-07-01', 1200)], assets);
  check(sp.asOf === '2025-07-01' && sp.picks.length === 1 && near(sp.shadow, 1100) && near(sp.gap, 100) && sp.hits === 1,
    'stock vs index twin at the latest snapshot: ₹1,000 into the index at 100, then 110 → ₹1,100; gap +₹100');
  check(sp.xirr !== null && sp.xirr > sp.shadowXirr, 'XIRR shown once the first buy is a year old, higher than the twin\'s');
  check(near(sp.running[0].gap, 1150 - 10 * 108) && near(sp.running[1].gap, sp.gap), 'running gap at each snapshot; its last point = the headline gap');
  const young = E.computeStockPicks(inputs, series, [pt('2024-06-01', 1010)], assets);
  check(young.xirr === null && young.xirrNeed === 7, 'first buy under a year before the snapshot: XIRR needs the remaining months', String(young.xirrNeed));
  const none = E.computeStockPicks([pos('X', 2, [['2023-01-01', true, 1, 100]], 100)], series, [pt('2025-07-01', 0)], [{ t: 'x', id: 'X' }]);
  check(none.picks.length === 0 && none.noValue.includes('X'), 'no index value on a transaction day: left out and named');
  // One stock left out (no index value on its buy day): its snapshot value stays out of the running gap.
  const two = [pos('Infosys', 2, [['2024-01-15', true, 10, 1000]]), pos('Old', 2, [['2023-01-01', true, 1, 100]])];
  const mixed = E.computeStockPicks(two, series, [{ d: '2025-07-01', month: '2025-07', value: 1700, cells: { 0: { cur: 1200 }, 1: { cur: 500 } } }],
    [{ t: 'x', id: 'Infosys' }, { t: 'x', id: 'Old' }]);
  check(near(mixed.value, 1200) && near(mixed.running[0].gap, mixed.gap), 'a stock left out adds nothing to the picks or the running gap');
  // Bought ₹100, sold for ₹200 with the index flat: the twin ends at −₹100 and its XIRR counts that.
  const flat = E.computeBenchSeries([{ date: '2025-01-10', code: 'nifty50', nav: 100 }, { date: '2025-06-10', code: 'nifty50', nav: 100 },
    { date: '2026-02-01', code: 'nifty50', nav: 100 }]);
  const sold = E.computeStockPicks([pos('S', 2, [['2025-01-10', true, 1, 100], ['2025-06-10', false, 1, 200]])], flat,
    [{ d: '2026-02-01', month: '2026-02', value: 0, cells: {} }], [{ t: 'x', id: 'S' }]);
  check(near(sold.shadow, -100) && Math.abs(sold.shadowXirr) < 1e-4 && sold.xirr > 1, 'a negative twin keeps its end value: twin XIRR ≈ 0%, the stock\'s far higher');
}

function testHeldFor() {
  const r = E.computePositionPnL(pos('N', 1, [['2025-01-03', true, 10, 1000], ['2025-06-06', false, 10, 1100], ['2026-05-18', true, 5, 600]], 130), '2026-11-04');
  check(r.first === '2025-01-03' && r.openSince === '2026-05-18' && r.days === E.daysApart('2026-05-18', '2026-11-04'),
    'held for: since the units held now were bought (after a full sale), first bought stays the first ever');
}

function testConcentrationMandateDrift() {
  const snap = synthSnap(14, t => ({
    'Navi Nifty 50 Index Fund': { inv: 50000, cur: 50000 + 1000 * t, cat: 1 },
    'Some Flexi Fund': { inv: 30000 + 2000 * t, cur: 30000 + 2000 * t, cat: 1 },
    'Gold Coin': { inv: 20000, cur: 20000 * (1 + 0.02 * t), cat: 8 },
  }));
  const pts = E.computeFundSeries(snap);
  const names = snap.assets.map(a => a.n);
  const c = E.computeConcentration(pts, names);
  const w = [pts[13].cells[0].cur, pts[13].cells[1].cur, pts[13].cells[2].cur].map(v => v / pts[13].value);
  check(near(c.latest.top5, 1) && near(c.latest.eff, 1 / w.reduce((x, y) => x + y * y, 0), 1e-9), 'concentration: top-5 weight and 1/HHI');
  check(c.latest.largestName === 'Navi Nifty 50 Index Fund' && c.ago && c.ago.month === E.monthShift(c.latest.month, -12), 'largest position, and the point 12 months earlier');
  const mg = E.computeMandateGaps(pts[13], names);
  check(near(mg.sleeves.reduce((x, r) => x + r.gap, 0), 0, 1e-9) && near(mg.sleeves.reduce((x, r) => x + r.gapInr, 0), 0, 1e-6), 'mandate gaps across sleeves net to zero (pts and ₹)');
  const navi = mg.holdings.find(r => r.label === 'Navi Nifty 50'), other = mg.holdings.find(r => r.key === 'india:other');
  check(navi && near(navi.value, pts[13].cells[0].cur) && other && other.target === 0 && other.members[0] === 'Some Flexi Fund',
    'sub-sleeve: mandate holdings matched by name, the rest as Other with a 0% target');
  const dr = E.computeWeightDrift(pts, 12);
  check(dr.sleeves.every(r => near(r.market + r.flows, r.delta, 1e-12)), 'weight drift: market + contributions = the change');
  const metals = dr.sleeves.find(r => r.key === 'metals');
  check(metals.market > 0 && metals.flows < 0, 'drift: gold rising lifts its weight (market), money added elsewhere dilutes it (contributions)');
  check(E.computeWeightDrift(pts.slice(0, 5), 6).need === 2, 'drift 6M with 5 points: needs 2 more months');
}

function testActivityAndUs() {
  const inputs = [pos('A', 1, [['2025-03-05', true, 1, 1000], ['2025-03-20', true, 1, 500], ['2026-02-01', false, 1, 800]], 900)];
  const points = [{ month: '2025-03', value: 1500 }, { month: '2025-12', value: 2500 }, { month: '2026-02', value: 1000 }];
  const act = E.computeActivity(inputs, points, '2026-02-15');
  check(act.months.length === 24 && act.months[23].month === '2026-02' && near(act.months[23].sold, 800), 'activity: 24 months; the sale counted at its proceeds');
  check(near(act.months.find(m => m.month === '2025-03').bought, 1500), 'activity: bought per month');
  check(near(act.lastYear.turnover, 0) && near(act.thisYear.turnover, 800 / 1000) && near(act.lastYear.avgValue, 2000), 'turnover = sold ÷ the average snapshot value that year');
  const us = E.computeUsSplit([E.computePositionPnL(pos('VOO', 3, [['2025-01-01', true, 1, 8800, 100]], 9900, { priceUsd: 110 }), '2026-01-01')]);
  const h = us.holdings[0];
  check(near(h.fxCost, 88) && near(h.fxNow, 90) && near(h.stockMove, 880) && near(h.fxMove, 220), 'US split: stock move at the cost rate, FX move on the value');
  check(near(h.stockMove + h.fxMove, 9900 - 8800) && near((1 + h.stockPct) * (1 + h.fxPct) - 1, h.totalPct, 1e-12), 'US split adds up to the INR result');
}

// ── Phase 4: pattern feed ─────────────────────────────────────────────────────

function patternCtx(snap, benchRows = [], extra = {}) {
  const points = E.computeFundSeries(snap);
  const series = E.computeBenchSeries(benchRows);
  return Object.assign({
    today: points[points.length - 1].d, points, names: snap.assets.map(a => a.n),
    sleeves: run('SLEEVES').map(s => ({ key: s.key, label: s.label, points: E.computeFundSeries(snap, s.cats) })),
    series, navs: E.computeBenchNavs(series, 'nifty50', points), inputs: [], rows: [], picks: { picks: [] },
  }, extra);
}

function testStreaks() {
  check(JSON.stringify(E.computeStreak([0.01, -0.02, 0.01, 0.01, 0.01])) === '{"len":3,"sign":1,"prior":1}', 'streak: the latest run and the longest earlier run');
  // Fund falls 2 months then rises 6: a 6-month up streak for the holding and the fund.
  const path = [100, 98, 96, 97, 98, 99, 100, 101, 102];
  const snap = synthSnap(path.length, t => ({ 'Parag Parikh Flexi Cap': { inv: 1000, cur: 10 * path[t] } }));
  const feed = E.computePatternFeed(patternCtx(snap));
  const st = feed.filter(c => c.id === 'streak');
  const h = st.find(c => c.holding === 'Parag Parikh Flexi Cap'), f = st.find(c => c.scope === 'fund');
  check(h && h.value === 6 && h.tone === 'up' && /6 months in a row up/.test(h.headline), 'streak card: 6 months in a row up', h && h.headline);
  check(f && f.value === 6, 'the fund gets its own streak card');
  check(near(h.impact, 10 * (102 - 96), 1e-6), 'streak ₹ impact = the market move over the run');
  const short = E.computePatternFeed(patternCtx(synthSnap(5, t => ({ A: { inv: 1000, cur: 1000 + 10 * t } })))).filter(c => c.id === 'streak' && c.scope === 'holding');
  check(!short.length, 'a 4-month holding streak is below the 5-month gate: no card');
}

function testStagnation() {
  // MF peaks in month 2, then 13 months lower: "13 months without a new high", range stated.
  const mf = [100, 105, 110, 104, 100, 98, 99, 101, 103, 100, 97, 99, 102, 104, 106, 103];
  const feedMf = E.computePatternFeed(patternCtx(synthSnap(mf.length, t => ({ 'Edelweiss Mid Cap Fund': { inv: 1000, cur: 10 * mf[t], cat: 1 } }))));
  const s1 = feedMf.find(c => c.id === 'stagnation');
  check(s1 && /13 months without a new high/.test(s1.headline), 'MF stagnation: 12+ months without a new high', s1 && s1.headline);
  check(s1 && s1.facts.some(f => /13 months since the high/.test(f)) && s1.facts.some(f => /low −11\.8%, now −6\.4% from the high/.test(f)),
    'stagnation states the months since the high and the range since it', s1 && s1.facts.join(' | '));
  // A stock within ±5% of its average for 6 months, at a high 2 months ago: range-bound.
  const st = [100, 120, 121, 119, 122, 123, 120, 121];
  const s2 = E.computePatternFeed(patternCtx(synthSnap(st.length, t => ({ 'Infosys': { inv: 1000, cur: 10 * st[t], cat: 2 } })))).find(c => c.id === 'stagnation');
  check(s2 && /6 months within ±/.test(s2.headline), 'stock stagnation: 6 months range-bound within ±5%', s2 && s2.headline);
  // A stock still making new highs is not stagnant.
  const up = E.computePatternFeed(patternCtx(synthSnap(9, t => ({ 'Infosys': { inv: 1000, cur: 1000 * Math.pow(1.03, t), cat: 2 } })))).find(c => c.id === 'stagnation');
  check(!up, 'a holding at a new high is not stagnant');
  // MF 3Y: 0.5%/month vs its benchmark 1%/month → about 6.5 pts a year behind.
  const snap = synthSnap(37, t => ({ 'Edelweiss Mid Cap Fund': { inv: 1000, cur: 1000 * Math.pow(1.005, t), cat: 1 } }));
  const s3 = E.computePatternFeed(patternCtx(snap, synthBench(37, t => 100 * Math.pow(1.01, t), 'midcap150'))).find(c => c.id === 'stagnation');
  const gap = (Math.pow(1.005, 12) - Math.pow(1.01, 12)) * 100;
  check(s3 && /3-year return −\d+\.\d pts a year vs Nifty Midcap 150/.test(s3.headline) && near(s3.value, gap, 1e-6),
    'MF stagnation: 3-year return 3+ pts a year behind its own benchmark', s3 && s3.headline);
  check(s3 && s3.spark.values.length === 37 && s3.from === snap.months[0].d, 'a 3-year-gap card spans the 3 years it is about');
  const nbPts = E.computeFundSeries(synthSnap(10, t => ({ 'UTI Nifty Next 50 Index Fund': { inv: 1, cur: 1 + t / 100, cat: 1 } })));
  const nb = E.computeStagnation(E.computeHoldingTrack(nbPts, 0), 'UTI Nifty Next 50 Index Fund', E.computeBenchSeries([]));
  check(nb.checks[1].na && !nb.checks[1].need, 'a fund with no benchmark: its 3Y rule cannot be tested (na), not "needs N more months"');
}

function testOtherPatterns() {
  // 12 months up then 3 months down: momentum shift; 5%+ below the high: drawdown.
  const path = [];
  for (let t = 0; t <= 12; t++) path.push(100 * Math.pow(1.03, t));
  [0.96, 0.95, 0.96].forEach(f => path.push(path[path.length - 1] * f));
  const snap = synthSnap(path.length, t => ({ 'Kotak Gold ETF': { inv: 1000, cur: 10 * path[t], cat: 8 } }));
  const feed = E.computePatternFeed(patternCtx(snap));
  const mom = feed.find(c => c.id === 'momentum' && c.holding === 'Kotak Gold ETF');
  check(mom && mom.tone === 'down' && /over the last 3 months after \+30\.5% over the 9 before/.test(mom.headline),
    'momentum shift: down 3 months after up 9 (windows do not overlap)', mom && mom.headline);
  const dd = feed.find(c => c.id === 'drawdown' && c.scope === 'fund');
  check(dd && /12\.4% below its high/.test(dd.headline), 'drawdown context: the fund 5%+ below its high', dd && dd.headline);
  check(feed.every((c, i) => !i || Math.abs(feed[i - 1].impact) >= Math.abs(c.impact) - 1e-9), 'the feed is ranked by |₹ impact|');
  const words = /\b(should|consider|review|recommend|buy now|sell now|switch|rebalance)\b/i;
  check(feed.every(c => !words.test(c.headline) && c.facts.every(f => !words.test(f))), 'every card is a fact: no advice words');
  check(feed.every(c => c.facts.length >= 1 && c.facts.length <= 3 && c.to), 'each card: 1–3 supporting numbers and its period');
}

function testPatternHistory() {
  const cards = [{ key: 'streak|', id: 'streak', holding: '' }, { key: 'drawdown|', id: 'drawdown', holding: '' }];
  const hist = [
    { month: '2026-08', pattern_id: 'streak', holding: '', headline: 'a' }, { month: '2026-09', pattern_id: 'streak', holding: '', headline: 'b' },
    { month: '2026-10', pattern_id: 'streak', holding: '', headline: 'c' }, { month: '2026-10', pattern_id: 'momentum', holding: 'Gold Coin', headline: 'Gold momentum' },
    { month: '2026-07', pattern_id: 'drawdown', holding: '', headline: 'old' },
  ];
  const h = E.computePatternHistory(cards, hist, '2026-11');
  check(h.since['streak|'] === '2026-08' && h.since['drawdown|'] === '2026-11', 'since: the start of the run of consecutive months; a gap restarts it');
  check(h.ended.length === 1 && h.ended[0].headline === 'Gold momentum', 'ended: in last month\'s feed, gone now');
}

function testPatternFixes() {
  // A stock rising 1% every month is not "range-bound" stagnation.
  const riser = E.computePatternFeed(patternCtx(synthSnap(9, t => ({ Infosys: { inv: 1000, cur: 1000 * Math.pow(1.01, t), cat: 2 } }))));
  check(!riser.some(c => c.id === 'stagnation'), 'a stock making new highs is never range-bound stagnation');
  // A sleeve sold out: no drawdown / volatility cards for it.
  const snap = synthSnap(30, t => Object.assign({ A: { inv: 1000, cur: 1000 + 5 * t } },
    t < 22 ? { Bitcoin: { inv: 500, cur: 500 * (1 + 0.2 * Math.sin(t)), cat: 9 } } : {}));
  const feed = E.computePatternFeed(patternCtx(snap));
  check(!feed.some(c => c.holding === 'Crypto' && ['drawdown', 'vol_regime', 'streak', 'momentum'].includes(c.id)),
    'a fully sold sleeve gets no drawdown / volatility / streak / momentum cards (its weight drift to 0% still shows)',
    feed.filter(c => c.holding === 'Crypto').map(c => c.id + ': ' + c.headline).join(' | '));
  // Tax: exactly 12 calendar months is still short-term; a day more is long-term.
  const lt = E.computeFifoLots(pos('X', 1, [['2023-06-10', true, 1, 100], ['2024-06-10', false, 1, 150]]));
  const ctxTax = d => ({ today: d, inputs: [pos('X', 1, [['2023-06-10', true, 1, 100], [d, false, 1, 150]])], points: [], rows: [] });
  check(lt.sold[0].gain === 50, 'FIFO lots: the sold lot carries its gain');
  const t1 = run('patternTax')(ctxTax('2024-06-10'))[0], t2 = run('patternTax')(ctxTax('2024-06-11'))[0];
  check(/ ₹0 long-term, \+₹50 short-term/.test(t1.headline) && /\+₹50 long-term, ₹0 short-term/.test(t2.headline),
    'long-term = held more than 12 calendar months (29 Feb in between makes no difference)', t1.headline + ' | ' + t2.headline);
  // History: nothing saved for last month → no "since" and no "ended".
  const h = E.computePatternHistory([{ key: 'streak|' }], [{ month: '2026-08', pattern_id: 'streak', holding: '', headline: 'x' }], '2026-11');
  check(h.since === null && h.ended.length === 0, 'no feed saved last month: no "new this month" claims');
}

// ── Phase 5: trends ───────────────────────────────────────────────────────────

function testTrends() {
  const snap = synthSnap(14, t => ({
    'Edelweiss Mid Cap Fund': { inv: 1000, cur: 1000 * Math.pow(1.01, t), cat: 1 },
    'Gold Coin': { inv: 500, cur: 500 * (1 + 0.02 * t), cat: 8, flag: 3 },
  }));
  const points = E.computeFundSeries(snap);
  const rows = E.computeTrends({ points, names: snap.assets.map(a => a.n), series: E.computeBenchSeries(synthBench(14, t => 100 * Math.pow(1.005, t), 'midcap150')) });
  const mf = rows.find(r => r.name === 'Edelweiss Mid Cap Fund'), gold = rows.find(r => r.name === 'Gold Coin');
  check(rows[0].scope === 'fund' && rows[0].code === 'nifty50', 'trends: the fund first, against Nifty 50');
  const y1 = mf.windows.find(w => w.key === 'y1'), y3 = mf.windows.find(w => w.key === 'y3');
  check(mf.code === 'midcap150' && near(y1.ret, Math.pow(1.01, 12) - 1, 1e-12) && near(y1.bench, Math.pow(1.005, 12) - 1, 1e-12),
    'trends: a holding against its own benchmark (BENCHMARK_MAP) over the same snapshot dates');
  check(y3.need === 23, 'trends: 3Y needs 37 consecutive points (needs 23 more)', String(y3.need));
  check(near(mf.benchLine[mf.benchLine.length - 1], 100 * Math.pow(1.005, 13), 1e-9) && near(mf.line[0], 100), 'trends: both lines start at 100');
  check(gold.est && gold.benchLine === null && gold.windows.every(w => w.need || w.bench === null), 'trends: estimated values are never compared with a benchmark');
  const checks = mf.stag.checks;
  check(mf.stag.type === 'mf' && checks.length === 2 && checks[0].met === false && checks[1].need === 23,
    'trends: every stagnation rule listed — met / not met / not enough months yet');
}

// ── Tax ───────────────────────────────────────────────────────────────────────

function taxPos(cat, sub, price, txns) {
  return { key: `t|${cat}|${sub}`, name: `asset ${cat}/${sub}`, cat, sub, price,
           txns: txns.map(([d, buy, qty, inr]) => ({ d, buy, qty, inr, usd: 0 })) };
}

function testTaxRules() {
  check(E.taxLongTermFrom('2025-01-31', 12) === '2026-02-01', 'tax: long-term = the day after 12 months');
  check(E.taxLongTermFrom('2024-02-29', 12) === '2025-03-01', 'tax: a 29 Feb buy turns long-term on 1 Mar');
  check(E.taxLongTermFrom('2025-06-15', 24) === '2027-06-16', 'tax: 24-month rule');
  check(E.taxFyStart('2026-11-07') === '2026-04-01' && E.taxFyStart('2027-03-31') === '2026-04-01' && E.taxFyStart('2027-04-01') === '2027-04-01',
    'tax: the financial year starts on 1 April');
  const rule = (cat, sub, d) => E.taxRuleOf({ cat, sub }, d);
  check(rule(1, 101, '2026-01-01') === 'equity' && rule(2, 201, '2026-01-01') === 'equity', 'tax: equity funds and stocks follow the equity rule');
  check(rule(5, 503, '2026-01-01') === 'equity', 'tax: arbitrage funds follow the equity rule');
  check(rule(5, 501, '2024-01-01') === 'debt' && rule(5, 502, '2023-04-01') === 'debt', 'tax: debt units bought from 1 Apr 2023 are slab-rate');
  check(rule(5, 501, '2023-03-31') === 'other', 'tax: older debt units follow the 24-month rule');
  check(rule(8, 801, '2026-01-01') === 'etf' && rule(8, 802, '2026-01-01') === 'other', 'tax: gold ETFs 12 months, physical metal 24 months');
  check(rule(3, 301, '2026-01-01') === 'other' && rule(4, 401, '2026-01-01') === 'other' && rule(9, 901, '2026-01-01') === 'crypto',
    'tax: US shares and land 24 months, crypto flat');
}

function testTaxBill() {
  const bill = b => E.computeTaxBill(Object.assign(E.taxBucket(), b));
  const line = (r, k) => r.lines.find(l => l.key === k);
  let r = bill({ eqLT: 200000 });
  check(near(line(r, 'eqLT').exempt, 125000) && near(r.tax, 75000 * 0.125 * 1.04), 'tax: ₹1.25 lakh equity exemption, 12.5% + 4% cess above it');
  r = bill({ eqST: 10000 });
  check(near(r.tax, 2000 * 1.04), 'tax: short-term equity at 20%');
  r = bill({ eqST: -50000, eqLT: 200000 });
  check(near(line(r, 'eqLT').gain, 150000) && near(r.tax, 25000 * 0.125 * 1.04), 'tax: a short-term loss comes off long-term gains');
  r = bill({ ltOther: -30000, slab: 40000 });
  check(near(r.slabGain, 40000) && near(r.lossLeft, 30000) && near(r.tax, 0), 'tax: a long-term loss never comes off short-term gains');
  r = bill({ slab: -10000, eqST: 30000, ltOther: 20000 });
  check(near(line(r, 'eqST').gain, 20000) && near(line(r, 'ltOther').gain, 20000), 'tax: short-term losses go to the highest-taxed gain first');
  r = bill({ crypto: 5000, eqST: -5000 });
  check(near(line(r, 'crypto').tax, 1500) && near(r.lossLeft, 5000), 'tax: crypto gains are never reduced by losses');
  check(line(bill({ slab: 9000 }), 'slab').tax === null, 'tax: slab-rate gains carry no ₹ tax figure');
}

function testTaxEstimate() {
  const today = '2026-11-07';
  const mf = taxPos(1, 101, 16, [['2025-01-10', true, 100, 1000], ['2026-06-10', true, 100, 1200], ['2026-08-01', false, 50, 750]]);
  let est = E.computeTaxEstimate([mf], today);
  const row = est.rows[0];
  check(near(row.booked, 250) && near(row.gain, 700) && near(row.lt, 300), 'tax: FIFO — the sale uses the oldest lot; gain now split long / short');
  check(row.nextLT && row.nextLT.d === '2027-06-11' && near(row.nextLT.gain, 400), 'tax: next lot turning long-term, with its gain');
  check(near(est.booked.tax, 0) && near(est.ifSold.tax, 400 * 0.2 * 1.04), 'tax: booked long-term gain within the exemption; if all sold adds the short-term lot');
  const old = taxPos(1, 101, 20, [['2024-01-10', true, 10, 100], ['2026-02-01', false, 10, 200]]);
  est = E.computeTaxEstimate([old], today);
  check(est.rows.length === 0 && near(est.booked.tax, 0), 'tax: a sale before 1 April is not this year\'s');
  const arb = taxPos(5, 503, 12, [['2025-01-01', true, 100, 1000], ['2026-05-01', false, 100, 1200]]);
  est = E.computeTaxEstimate([arb], today);
  check(near(est.booked.lines.find(l => l.key === 'eqLT').gain, 200), 'tax: an arbitrage fund\'s gain is a long-term equity gain');
  const debt = taxPos(5, 501, 12, [['2022-05-01', true, 100, 1000], ['2024-05-01', true, 100, 1000], ['2026-06-01', false, 100, 1100]]);
  est = E.computeTaxEstimate([debt], today);
  check(near(est.booked.lines.find(l => l.key === 'ltOther').gain, 100) && near(est.ifSold.slabGain, 200),
    'tax: older debt units long-term at 12.5%, newer ones at the slab rate');
  const btc = taxPos(9, 901, 30, [['2025-01-01', true, 1, 50], ['2025-02-01', true, 1, 20], ['2026-05-01', false, 1, 10]]);
  est = E.computeTaxEstimate([btc], today);
  check(near(est.booked.lines.find(l => l.key === 'crypto').gain, 0) && near(est.ifSold.lines.find(l => l.key === 'crypto').gain, 10)
    && est.rows[0].lt === null, 'tax: a crypto loss counts for nothing; the held gain is taxed flat');
  const noPrice = taxPos(4, 401, 0, [['2020-01-01', true, 10, 100000]]);
  est = E.computeTaxEstimate([noPrice], today);
  check(est.unpriced.length === 1 && est.rows[0].unpriced && near(est.ifSold.tax, 0), 'tax: a holding without a price is listed, not estimated');
}

function testTaxFixes() {
  const today = '2026-11-07';
  const elss = taxPos(1, 105, 20, [['2023-01-10', true, 10, 100], ['2025-03-10', true, 10, 150]]);
  let est = E.computeTaxEstimate([elss], today);
  check(est.locked.length === 1 && est.locked[0].until === '2028-03-10' && near(est.locked[0].gain, 50) && near(est.rows[0].gain, 150),
    'tax: ELSS units in their 3-year lock-in are listed, not counted as sellable');
  check(near(est.ifSold.lines.find(l => l.key === 'eqLT').gain, 100), 'tax: only the free ELSS lot counts in "if all sold"');
  check(near(est.rows[0].lt, 150) && est.rows[0].locked === true && est.locked[0].first === '2028-03-10',
    'tax: a locked ELSS lot still shows in "of it long-term"; the free dates are kept');
  const wash = taxPos(1, 101, 20, [['2025-01-01', true, 10, 100], ['2025-02-01', true, 10, 300], ['2026-06-01', false, 20, 400]]);
  check(E.computeTaxEstimate([wash], today).rows.length === 1, 'tax: a holding sold this year stays listed even when its gains net to zero');
  const btc = taxPos(9, 901, 30, [['2025-01-01', true, 1, 50], ['2025-01-02', true, 1, 10], ['2026-05-01', false, 1, 20], ['2026-05-01', false, 1, 20]]);
  est = E.computeTaxEstimate([btc], today);
  check(near(est.booked.lines.find(l => l.key === 'crypto').gain, 10), 'tax: two crypto sales on one day are taxed one by one (a loss on one never nets the other)');
  const debtOld = taxPos(5, 501, 12, [['2022-05-01', true, 100, 1000]]);
  check(E.computeTaxEstimate([debtOld], today).rows[0].rule === 'other', 'tax: a debt fund bought before 1 Apr 2023 is labelled by its lots');
  const debtMix = taxPos(5, 501, 12, [['2022-05-01', true, 100, 1000], ['2024-05-01', true, 100, 1000]]);
  check(E.computeTaxEstimate([debtMix], today).rows[0].rule === 'debtMixed', 'tax: a debt fund with units on both sides of 1 Apr 2023 is marked mixed');
  const fx = [{ d: '2026-04-30', v: 85 }, { d: '2026-05-31', v: 86 }, { d: '2026-06-12', v: 87 }];
  check(E.taxUsdInrOn(fx, '2026-06-12').v === 86 && E.taxUsdInrOn(fx, '2026-06-12').on === 'monthEnd', 'tax: a US sale uses USD/INR on the last day of the month before');
  check(E.taxUsdInrOn([{ d: '2026-06-12', v: 87 }], '2026-06-12').on === 'saleDay', 'tax: no month-end rate → the sale day\'s rate');
  check(E.taxUsdInrOn([], '2026-06-12').v === 0 && E.taxUsdInrOn([], '2026-06-12').on === '', 'tax: no rate at all → 0 (the caller falls back to today\'s)');
}

function testGuide() {
  const g = vm.createContext({ console, document: { addEventListener() {} }, snapEsc: s => String(s) });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/guide.js'), 'utf8'), g, { filename: 'js/guide.js' });
  const guide = vm.runInContext('GUIDE', g), patterns = vm.runInContext('GUIDE_PATTERNS', g);
  const lessons = vm.runInContext('GUIDE_LESSONS', g), glossary = vm.runInContext('GUIDE_GLOSSARY', g);
  const inLessons = lessons.flatMap(l => l.keys);
  check(inLessons.every(k => guide[k]) && Object.keys(guide).every(k => inLessons.includes(k)), 'guide: every entry is in exactly the lessons');
  const ids = [...fs.readFileSync(path.join(ROOT, 'js/fund-engine.js'), 'utf8').matchAll(/^\s+id: '([a-z_]+)',/gm)].map(m => m[1]);
  check(ids.length >= 16 && ids.every(id => patterns[id]), 'guide: every pattern card has a note', ids.filter(id => !patterns[id]).join(', '));
  const src = ['factsheet', 'happening', 'trends', 'attribution', 'positions', 'tax']
    .map(f => fs.readFileSync(path.join(ROOT, `js/${f}.js`), 'utf8')).join('\n');
  const used = [...src.matchAll(/(?:`|'[a-z-]*'),\s*'[a-z-]*',\s*'([a-z_]+)'(?=[,)\s])/g)].map(m => m[1]);
  check(used.length >= 25 && used.every(k => guide[k]), 'guide: every card ⓘ key has an entry', used.filter(k => !guide[k]).join(', '));
  const ins = fs.readFileSync(path.join(ROOT, 'js/insights.js'), 'utf8');
  const old = [...ins.matchAll(/(?:true|false),\s*'([a-z_]+)'\)/g)].map(m => m[1]).concat([...ins.matchAll(/buildHelpPanel\('([a-z_]+)'\)/g)].map(m => m[1]));
  check(old.length >= 10 && old.every(k => guide[k]), 'guide: every Net worth / Funds / snapshot ⓘ key has an entry', old.filter(k => !guide[k]).join(', '));
  const tabs = [...ins.matchAll(/\{ id: '([a-z]+)',\s+label: /g)].map(m => m[1]);
  check(tabs.join(',') === 'factsheet,happening,trends,attribution,positions,funds,tax,networth,guide', 'insights: final tab order', tabs.join(','));
  const text = JSON.stringify([guide, patterns, glossary, lessons]).replace(/Buy timing|Avg buy gap/g, '');   // card labels, not advice
  const advice = text.match(/\b(should|consider|recommend|review|buy|sell)\b/gi);
  check(!advice, 'guide: no advice wording', (advice || []).join(', '));
}

// ── Run ───────────────────────────────────────────────────────────────────────

testScope();
testMandate();
testBenchmarkMap();
testSteadyGrowth();
testSipAdded();
testProfitableSell();
testFlatAndCrash();
testAtCostAndScope();
testRevaluation();
testMonthGaps();
testGates();
testBenchmarks();
testVolatility();
testManagerNote();
testAttribution();
testHoldingVsBench();
testAttributionEdges();
testVsBenchExclusions();
testPositionPnL();
testClosedStats();
testStockPicks();
testHeldFor();
testConcentrationMandateDrift();
testActivityAndUs();
testStreaks();
testStagnation();
testOtherPatterns();
testPatternHistory();
testPatternFixes();
testTrends();
testTaxRules();
testTaxBill();
testTaxEstimate();
testTaxFixes();
testGuide();
console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
