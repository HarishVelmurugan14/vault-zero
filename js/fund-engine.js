// VaultZero — Fund engine: time-weighted returns, benchmarks and risk from the monthly snapshots
// Pure functions only (no DOM, no fetch): js/factsheet.js draws them, tools/test-insights.js tests them.

// ── Data gates ────────────────────────────────────────────────────────────────

// Monthly points a number needs before it is shown; below that it reads "needs N more months".
const FUND_GATES = { m1: 2, m3: 4, m6: 7, y1: 13, y3: 37, vol: 24, rolling: 24 };

// Headline windows: k months back from the latest snapshot (3Y is annualised).
const FUND_WINDOWS = [
  { key: 'm1', label: '1M', months: 1 },
  { key: 'm3', label: '3M', months: 3 },
  { key: 'm6', label: '6M', months: 6 },
  { key: 'y1', label: '1Y', months: 12 },
  { key: 'y3', label: '3Y', months: 36, annualise: true },
];

const FUND_HEADLINE_BENCH = 'nifty50';
const FUND_VOL_MONTHS = 36;                  // volatility uses the latest 36 monthly returns at most
const FUND_BENCH_STALE_DAYS = 7;             // a benchmark value older than this on an as-of day is ignored
const FUND_NO_CELL = { inv: 0, cur: 0, flag: 0 };


// ── Month helpers ─────────────────────────────────────────────────────────────

function monthShift(month, k) {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`;
}

function monthsApart(from, to) {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

function daysApart(fromIso, toIso) {
  const t = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return (t(toIso) - t(fromIso)) / 86400000;
}

// Calendar months in a row ending at point i (a month never snapshotted breaks the run).
function computeRunLength(points, i) {
  if (i < 0 || !points[i]) return 0;
  let n = 1;
  for (let j = i; j > 0; j--) {
    if (points[j - 1].month !== monthShift(points[j].month, -1)) break;
    n++;
  }
  return n;
}


// ── Fund series (time-weighted) ───────────────────────────────────────────────

// An asset's market move over one month, from its start (a) and end (b) cells: the change in its
// gain plus the gain its sells carried out — cost sold × the asset's average gain ratio over the
// month (start and end ratio; whichever exists). Valued at cost at either end → no price → 0.
function computeAssetMove(a, b) {
  if (a.flag === 1 || b.flag === 1) return 0;
  const ratios = [a, b].filter(x => x.inv > 0).map(x => x.cur / x.inv - 1);
  const avgRatio = ratios.length ? ratios.reduce((s, x) => s + x, 0) / ratios.length : 0;
  const costOut = Math.max(0, a.inv - b.inv);
  return (b.cur - b.inv) - (a.cur - a.inv) + costOut * avgRatio;
}

// snapshotData (gas/snapshot.gs vzsData_) → one point per snapshot month from the first month
// the fund holds anything. Each point keeps its per-holding cells (ai → { inv, cur, flag, cat })
// and, for the month ending there, each holding's move, flow and base (start value + flow/2). Per month (modified Dietz): market move M = Σ asset moves; net new
// money F = Σ asset flows; return r = M ÷ (V₀ + F/2); idx chains the returns from 100.
// An asset valued at cost at either end of a month moves money only by its change in cost; the
// rest of its change (a price appearing or lapsing) is a revaluation — neither return nor new
// money — so Δvalue = F + M + reval.
//   cats: the categories counted (default the whole fund scope; a sleeve passes its own).
function computeFundSeries(snap, cats = FUND_SCOPE) {
  const months = (snap && snap.months) || [];
  const assets = (snap && snap.assets) || [];
  const cells = months.map(() => ({}));                                 // month → asset index → cell
  ((snap && snap.rows) || []).forEach(r => {
    const [mi, ai, inv, cur, flag, cat] = r;
    if (!cells[mi] || !assets[ai]) return;
    if (!cats.includes(Number(cat)) || !isInFundScope(cat, assets[ai].t)) return;
    cells[mi][ai] = { inv: parseFloat(inv || 0), cur: parseFloat(cur || 0), flag: Number(flag) || 0, cat: Number(cat) };
  });

  const points = [];
  let prevCell = null;
  months.forEach((m, mi) => {
    const cell = cells[mi];
    const ids = Object.keys(cell);
    const value = ids.reduce((s, k) => s + cell[k].cur, 0);
    const invested = ids.reduce((s, k) => s + cell[k].inv, 0);
    if (!points.length && value <= 0 && invested <= 0) return;         // before the fund's first holding
    const p = { d: m.d, month: m.d.slice(0, 7), status: m.st, value, invested, flow: invested, move: value - invested,
                reval: 0, base: 0, ret: null, idx: 100, atCost: 0, moves: [], holdings: [], cells: cell };
    ids.forEach(k => { if (cell[k].flag === 1) p.atCost++; });
    if (points.length) {
      const last = points[points.length - 1];
      p.move = 0;
      p.flow = 0;
      new Set([...Object.keys(prevCell), ...ids]).forEach(k => {
        const a = prevCell[k] || FUND_NO_CELL, b = cell[k] || FUND_NO_CELL;
        const cat = (cell[k] || prevCell[k]).cat;
        if (a.flag === 1 || b.flag === 1) {
          const flow = b.inv - a.inv;
          p.flow += flow;
          p.reval += (b.cur - b.inv) - (a.cur - a.inv);
          p.holdings.push({ ai: Number(k), cat, move: 0, flow, reval: (b.cur - b.inv) - (a.cur - a.inv), base: a.cur + flow / 2, atCost: true });
          return;
        }
        const mv = computeAssetMove(a, b);
        const flow = b.cur - a.cur - mv;
        if (mv) p.moves.push({ ai: Number(k), move: mv });
        p.move += mv;
        p.flow += flow;
        p.holdings.push({ ai: Number(k), cat, move: mv, flow, reval: 0, base: a.cur + flow / 2, atCost: false });
      });
      p.base = last.value + p.flow / 2;                                 // = Σ holdings' base
      p.ret = p.base > 0 ? p.move / p.base : 0;                          // nothing held at the start → no return
      p.idx = last.idx * (1 + p.ret);
    }
    points.push(p);
    prevCell = cell;
  });
  return points;
}


// ── Benchmarks ────────────────────────────────────────────────────────────────

// benchmark_prices rows → { code: [{ d, v }] } sorted by date.
function computeBenchSeries(rows) {
  const out = {};
  (rows || []).forEach(r => {
    const v = parseFloat(r.nav || 0);
    const d = String(r.date || '').slice(0, 10);
    if (!(v > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    (out[String(r.code)] = out[String(r.code)] || []).push({ d, v });
  });
  Object.values(out).forEach(list => list.sort((a, b) => (a.d < b.d ? -1 : 1)));
  return out;
}

// The series value on or before each point's as-of date, at most FUND_BENCH_STALE_DAYS old —
// a value missing on a take day reads as no value, never as a flat benchmark.
function computeBenchNavs(series, code, points) {
  const list = (series && series[code]) || [];
  let j = -1;
  return points.map(p => {
    while (j + 1 < list.length && list[j + 1].d <= p.d) j++;
    return j >= 0 && daysApart(list[j].d, p.d) <= FUND_BENCH_STALE_DAYS ? list[j].v : null;
  });
}

function benchReturn(navs, s, e) {
  return navs && navs[s] > 0 && navs[e] > 0 ? navs[e] / navs[s] - 1 : null;
}


// ── Returns over windows ──────────────────────────────────────────────────────

// Return over the last `months` calendar months, ending at the latest snapshot. Gated: the run of
// consecutive monthly points ending there must reach months + 1.
//   → { need } or { from, to, ret, bench, gap (pts) }
function computeWindowReturn(points, navs, months, annualise = false) {
  const gate = months + 1;
  const L = points.length - 1;
  const run = computeRunLength(points, L);
  if (run < gate) return { need: gate - run };
  const s = L - months;
  const ann = x => (x === null || !annualise ? x : Math.pow(1 + x, 12 / months) - 1);
  const ret = ann(points[L].idx / points[s].idx - 1);
  const bench = ann(benchReturn(navs, s, L));
  return { from: points[s].d, to: points[L].d, ret, bench, gap: bench === null ? null : (ret - bench) * 100 };
}

// Since the first snapshot point: cumulative, and annualised once it spans a year.
function computeSinceInception(points, navs) {
  if (points.length < 2) return { need: 2 - points.length };
  const L = points.length - 1;
  const ret = points[L].idx / points[0].idx - 1;
  const bench = benchReturn(navs, 0, L);
  const days = daysApart(points[0].d, points[L].d);
  const ann = x => (x === null || days < 365 ? null : Math.pow(1 + x, 365.25 / days) - 1);
  return { from: points[0].d, to: points[L].d, ret, bench, gap: bench === null ? null : (ret - bench) * 100,
           annRet: ann(ret), annBench: ann(bench), days };
}

// Every headline number at once: windows in FUND_WINDOWS order, then since inception.
function computeHeadline(points, navs) {
  const L = points.length - 1;
  const last = points[L] || null, prev = points[L - 1] || null;
  return {
    value: last ? last.value : 0,
    asOf: last ? last.d : '',
    change: last && prev ? last.value - prev.value : null,
    changePct: last && prev && prev.value > 0 ? (last.value - prev.value) / prev.value : null,
    prevAsOf: prev ? prev.d : '',
    windows: FUND_WINDOWS.map(w => Object.assign({ key: w.key, label: w.label, annualise: !!w.annualise },
      computeWindowReturn(points, navs, w.months, !!w.annualise))),
    inception: computeSinceInception(points, navs),
  };
}

// Calendar-year returns: Dec of the year before → Dec, all 13 monthly points present. A year
// without them goes under short: the year in progress with the months until its December
// snapshot (need); a year that can no longer complete (it began before the first snapshot, or
// misses a month) as part: 'before' | 'gap'.
function computeCalendarYears(points, navs) {
  const at = {};
  points.forEach((p, i) => { at[p.month] = i; });
  const years = [], short = [];
  if (!points.length) return { years, short };
  const latest = points[points.length - 1].month;
  const first = Number(points[0].month.slice(0, 4)), last = Number(latest.slice(0, 4));
  for (let y = first; y <= last; y++) {
    const months = [];
    for (let k = 0; k <= 12; k++) months.push(monthShift(`${y - 1}-12`, k));
    const missing = months.filter(m => at[m] === undefined);
    if (missing.length) {
      if (missing.some(m => m < points[0].month)) short.push({ year: y, part: 'before' });
      else if (missing.some(m => m <= latest)) short.push({ year: y, part: 'gap' });
      else short.push({ year: y, need: missing.length });
      continue;
    }
    const s = at[`${y - 1}-12`], e = at[`${y}-12`];
    const ret = points[e].idx / points[s].idx - 1;
    const bench = benchReturn(navs, s, e);
    years.push({ year: y, ret, bench, gap: bench === null ? null : (ret - bench) * 100 });
  }
  return { years, short };
}

// Rolling 12-month return at every point that has 13 consecutive points behind it. The chart is
// gated on FUND_GATES.rolling consecutive points' worth of windows (24 points → 12 windows); need
// = further months, the run so far continuing.
function computeRolling1Y(points, navs) {
  const rows = [];
  points.forEach((p, i) => {
    if (computeRunLength(points, i) < 13) return;
    rows.push({ d: p.d, month: p.month, ret: p.idx / points[i - 12].idx - 1, bench: benchReturn(navs, i - 12, i) });
  });
  const minRows = FUND_GATES.rolling - 12;
  if (rows.length < minRows) {
    const run = computeRunLength(points, points.length - 1);
    const wait = Math.max(0, 13 - run);                                 // months before the next window can start
    return { need: wait + (minRows - rows.length) - (wait > 0 ? 1 : 0), rows: [] };
  }
  const both = rows.filter(r => r.bench !== null);
  const ahead = both.filter(r => r.ret > r.bench).length;
  return { rows, compared: both.length, ahead, aheadPct: both.length ? ahead / both.length : null };
}


// ── Risk ──────────────────────────────────────────────────────────────────────

function computeStdev(xs) {
  if (xs.length < 2) return null;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (xs.length - 1));
}

// Annualised volatility of one-month returns (sample stdev × √12) over the latest FUND_VOL_MONTHS
// of them, and the benchmark's over the same months. A return spanning a missed month is left
// out; the gate counts one-month returns (FUND_GATES.vol points = vol − 1 returns).
function computeVolatility(points, navs) {
  const idx = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i].month === monthShift(points[i - 1].month, 1)) idx.push(i);
  }
  const minRets = FUND_GATES.vol - 1;
  if (idx.length < minRets) return { need: minRets - idx.length };
  const use = idx.slice(-FUND_VOL_MONTHS);
  const bRets = use.map(i => benchReturn(navs, i - 1, i));
  const bench = bRets.every(x => x !== null) ? computeStdev(bRets) * Math.sqrt(12) : null;
  return { vol: computeStdev(use.map(i => points[i].ret)) * Math.sqrt(12), bench, months: use.length, from: points[use[0] - 1].d };
}

// Drawdowns of an index series (fund idx or benchmark navs): the worst peak → trough fall and how
// many months it took to climb back from the trough, and how far below its high it is now.
function computeDrawdown(points, values) {
  if (points.length < 2) return { need: 2 - points.length };
  const atHigh = (v, high) => v >= high * (1 - 1e-9);                  // chained returns carry float noise
  let peak = -1, worst = { dd: 0, peak: -1, trough: -1 };
  values.forEach((v, i) => {
    if (!(v > 0)) return;
    if (peak < 0 || atHigh(v, values[peak])) { peak = i; return; }
    const dd = v / values[peak] - 1;
    if (dd < worst.dd) worst = { dd, peak, trough: i };
  });
  if (peak < 0) return { need: 2 };
  let recover = -1;
  if (worst.trough >= 0) {
    for (let i = worst.trough + 1; i < values.length; i++) {
      if (atHigh(values[i], values[worst.peak])) { recover = i; break; }
    }
  }
  const L = values.length - 1;
  const month = i => points[i].month;
  return {
    max: worst.dd,
    peakD: worst.peak >= 0 ? points[worst.peak].d : '',
    troughD: worst.trough >= 0 ? points[worst.trough].d : '',
    recoverD: recover >= 0 ? points[recover].d : '',
    recoverMonths: recover >= 0 ? monthsApart(month(worst.trough), month(recover)) : null,
    sinceTrough: worst.trough >= 0 ? monthsApart(month(worst.trough), month(L)) : null,
    current: values[L] > 0 ? values[L] / values[peak] - 1 : null,
    highD: points[peak].d,
    sinceHigh: monthsApart(month(peak), month(L)),
  };
}


// ── Market vs contributions ───────────────────────────────────────────────────

// Cumulative net money put in (money added − money taken out) and cumulative market move
// (revaluations of at-cost holdings included); they sum to the value at every point. The first
// point's invested counts as put in, its gain as market.
function computeContributions(points) {
  let putIn = 0, market = 0;
  return points.map((p, i) => {
    if (i === 0) { putIn = p.invested; market = p.value - p.invested; } else { putIn += p.flow; market += p.move + p.reval; }
    return { d: p.d, month: p.month, putIn, market, value: p.value, share: p.value > 0 ? market / p.value : null };
  });
}


// ── Attribution ───────────────────────────────────────────────────────────────

const ATTR_PERIODS = [
  { key: 'm1', label: '1M', months: 1 },
  { key: 'm3', label: '3M', months: 3 },
  { key: 'y1', label: '1Y', months: 12 },
  { key: 'inception', label: 'Since inception' },
  { key: 'custom', label: 'Custom' },
];

// The point range [s, e] a period covers, ending at the latest snapshot (custom: from → to months).
// Gated like the headline windows: k months need k + 1 consecutive points; a custom range needs
// every month in it.  → { s, e } | { need } | { missing } | { invalid }
function computeAttrRange(points, key, from = '', to = '') {
  const L = points.length - 1;
  if (key === 'inception') return L >= 1 ? { s: 0, e: L } : { need: 2 - points.length };
  if (key === 'custom') {
    const s = points.findIndex(p => p.month === from), e = points.findIndex(p => p.month === to);
    if (s < 0 || e < 0 || e <= s) return { invalid: true };
    const missing = monthsApart(points[s].month, points[e].month) - (e - s);
    return missing ? { missing } : { s, e };
  }
  const period = ATTR_PERIODS.find(x => x.key === key) || ATTR_PERIODS[2];
  const run = computeRunLength(points, L);
  if (run < period.months + 1) return { need: period.months + 1 - run };
  return { s: L - period.months, e: L };
}

// Contribution to the fund's return over points s → e, by holding and by sleeve. Each month a
// holding contributes its market move ÷ the fund's base (its weight × its return); months are
// linked by scaling each by the fund's growth before it, so the contributions add up exactly to
// the fund's time-weighted return. A holding's (or sleeve's) own return is given only when it was
// held at every point of the period and never valued at cost (it is then chained like the
// fund's); otherwise noRet says why: 'part' (not held throughout) or 'cost'. est = months whose
// value was estimated from recorded prices (history of land / physical metals).
//   names: asset index → name
function computeAttribution(points, s, e, names) {
  const byAsset = {}, bySleeve = {};
  const steps = e - s;                                                 // averages are per snapshot step
  const rowOf = (id, map, make) => (map[id] = map[id] || make());
  for (let t = s + 1; t <= e; t++) {
    const p = points[t];
    const scale = points[t - 1].idx / points[s].idx;
    const sleeveMonth = {};
    p.holdings.forEach(h => {
      const sl = sleeveOf(h.cat) || { key: 'other', label: 'Other' };
      const row = rowOf(h.ai, byAsset, () => ({ ai: h.ai, name: names[h.ai] || 'Asset ' + h.ai, contrib: 0, move: 0,
        weight: 0, capital: 0, growth: 1, atCost: 0, est: 0 }));
      row.cat = h.cat;
      row.sleeve = sl.key;
      row.move += h.move;
      row.capital += Math.max(0, h.base);
      if (p.base > 0) { row.contrib += h.move / p.base * scale; row.weight += Math.max(0, h.base) / p.base; }
      if (h.base > 0) row.growth *= 1 + h.move / h.base;
      if (h.atCost) row.atCost++;
      if ((p.cells[h.ai] || {}).flag === 3) row.est++;
      const sm = sleeveMonth[sl.key] = sleeveMonth[sl.key] || { move: 0, base: 0 };
      sm.move += h.move;
      sm.base += h.base;
    });
    Object.keys(sleeveMonth).forEach(k => {
      const sl = SLEEVES.find(x => x.key === k) || { key: k, label: 'Other' };
      const row = rowOf(k, bySleeve, () => ({ key: k, label: sl.label, contrib: 0, move: 0, weight: 0, capital: 0, growth: 1 }));
      const sm = sleeveMonth[k];
      row.move += sm.move;
      row.capital += Math.max(0, sm.base);
      if (p.base > 0) { row.contrib += sm.move / p.base * scale; row.weight += Math.max(0, sm.base) / p.base; }
      if (sm.base > 0) row.growth *= 1 + sm.move / sm.base;
    });
  }
  const span = points.slice(s, e + 1);
  const holdings = Object.values(byAsset).map(r => {
    const held = span.every(p => p.cells[r.ai] && p.cells[r.ai].cur > 0);
    const noRet = held ? (r.atCost ? 'cost' : '') : 'part';
    return Object.assign(r, { weight: r.weight / steps, capital: r.capital / steps, fullPeriod: !noRet, noRet,
                              ret: noRet ? null : r.growth - 1 });
  });
  const sleeveValue = (p, key) => Object.values(p.cells)
    .reduce((x, c) => x + ((sleeveOf(c.cat) || { key: 'other' }).key === key ? c.cur : 0), 0);
  const sleeves = Object.values(bySleeve).map(r => {
    const held = span.every(p => sleeveValue(p, r.key) > 0);
    const atCost = holdings.some(h => h.sleeve === r.key && h.atCost);
    const noRet = held ? (atCost ? 'cost' : '') : 'part';
    return Object.assign(r, { weight: r.weight / steps, capital: r.capital / steps, noRet, ret: noRet ? null : r.growth - 1 });
  });
  // Share of the market move: of the gross move (gains + |losses| = 100%), signed — a share of
  // the net gain would run to hundreds of % whenever gains and losses nearly cancel.
  const moveTotal = holdings.reduce((x, r) => x + r.move, 0);
  const grossMove = holdings.reduce((x, r) => x + Math.abs(r.move), 0);
  const capitalTotal = holdings.reduce((x, r) => x + r.capital, 0);
  [holdings, sleeves].forEach(list => list.forEach(r => {
    r.gainShare = grossMove > 0 ? r.move / grossMove : null;
    r.capitalShare = capitalTotal > 0 ? r.capital / capitalTotal : null;
  }));
  return { from: points[s].d, to: points[e].d, months: monthsApart(points[s].month, points[e].month), steps,
           total: points[e].idx / points[s].idx - 1, moveTotal, grossMove, capitalTotal, holdings, sleeves };
}

// Each holding held for the whole window (the latest `months` months, every month priced) against
// its own benchmark (BENCHMARK_MAP): its chained monthly return, the benchmark's change over the
// same dates and the gap in pts; 3Y figures are annualised. Gated like the headline windows.
// Left out (names of current holdings): partial = not held / priced for the whole window; estimated
// = value estimated from recorded prices in the window (built from the ETF the benchmark tracks,
// so a comparison would be circular); noBench = no BENCHMARK_MAP rule; noValue = its benchmark has
// no value on the window's dates.
//   → { need } | { rows, noBench, partial, estimated, noValue }
function computeHoldingVsBench(points, series, names, months, annualise = false) {
  const L = points.length - 1;
  const run = computeRunLength(points, L);
  if (run < months + 1) return { need: months + 1 - run };
  const s = L - months;
  const navsOf = {};
  const ann = x => (x === null || !annualise ? x : Math.pow(1 + x, 12 / months) - 1);
  const rows = [], noBench = [], partial = [], estimated = [], noValue = [];
  Object.keys(points[L].cells).forEach(k => {
    const ai = Number(k), now = points[L].cells[k];
    if (!(now.cur > 0)) return;
    const name = names[ai] || 'Asset ' + ai;
    const full = points.slice(s, L + 1).every(p => p.cells[k] && p.cells[k].cur > 0 && p.cells[k].flag !== 1);
    if (!full) { partial.push(name); return; }
    if (points.slice(s, L + 1).some(p => p.cells[k].flag === 3)) { estimated.push(name); return; }
    const code = benchmarkFor(now.cat, name);
    if (!code) { noBench.push(name); return; }
    let growth = 1;
    for (let t = s + 1; t <= L; t++) {
      const h = points[t].holdings.find(x => x.ai === ai);
      if (h && h.base > 0) growth *= 1 + h.move / h.base;
    }
    navsOf[code] = navsOf[code] || computeBenchNavs(series, code, points);
    const bench = ann(benchReturn(navsOf[code], s, L));
    if (bench === null) { noValue.push(name); return; }
    const ret = ann(growth - 1);
    rows.push({ ai, name, cat: now.cat, code, benchLabel: (BENCHMARKS[code] || {}).label || code,
                ret, bench, gap: (ret - bench) * 100 });
  });
  rows.sort((a, b) => b.gap - a.gap);
  return { from: points[s].d, to: points[L].d, rows, noBench, partial, estimated, noValue };
}


// ── Positions ─────────────────────────────────────────────────────────────────
// Inputs are normalised holdings (js/positions.js builds them from the Insights data):
//   { key, name, cat, kind ('STOCK' | 'ETF' | ''), price: ₹ per unit now (0 = no price),
//     priceUsd, txns: [{ d: 'yyyy-mm-dd', buy, qty, inr, usd }] }
// US holdings: a buy's inr is its wire-derived cost basis; a sell's inr is its USD at today's rate.

function cmpPositionTxn(a, b) {
  if (a.d !== b.d) return a.d < b.d ? -1 : 1;
  return (b.buy ? 1 : 0) - (a.buy ? 1 : 0);                            // same day: buy first
}

// Average-cost walk over a holding's transactions (same rule as Insights and Holdings: a sell
// larger than the units held counts only those). → running totals and each counted sell.
function computePositionLedger(pos) {
  const L = { qty: 0, cost: 0, usdCost: 0, realized: 0, soldCost: 0, proceeds: 0, bought: 0, first: '', openSince: '',
              lastSell: '', oversold: false, flows: [] };
  pos.txns.slice().sort(cmpPositionTxn).forEach(t => {
    if (t.buy) {
      if (L.qty <= 1e-9) L.openSince = t.d;                            // a new holding period starts
      L.qty += t.qty;
      L.cost += t.inr;
      L.usdCost += t.usd || 0;
      L.bought += t.inr;
      if (!L.first) L.first = t.d;
      L.flows.push({ d: t.d, inr: -t.inr });
      return;
    }
    if (L.qty <= 1e-9) { L.oversold = true; return; }
    const sold = Math.min(t.qty, L.qty);
    if (t.qty > L.qty + 1e-6) L.oversold = true;
    const share = sold / L.qty;
    const gets = t.qty > 0 ? t.inr * sold / t.qty : t.inr;
    L.realized += gets - L.cost * share;
    L.soldCost += L.cost * share;
    L.proceeds += gets;
    L.cost -= L.cost * share;
    L.usdCost -= L.usdCost * share;
    L.qty -= sold;
    L.lastSell = t.d;
    L.flows.push({ d: t.d, inr: gets });
    if (L.qty < 1e-6) { L.qty = 0; L.cost = 0; L.usdCost = 0; }
  });
  return L;
}

// P&L of one holding: unrealized on what is held (at cost when it has no price), realized on what
// was sold, total on everything ever bought. Held for: open = since the units held now were first
// bought (after any full sale) → today; closed = first buy → last sale.
function computePositionPnL(pos, today) {
  const L = computePositionLedger(pos);
  const open = L.qty > 0;
  const unpriced = open && !(pos.price > 0);
  let value = 0;
  if (open) value = unpriced ? L.cost : L.qty * pos.price;
  const unreal = open && !unpriced ? value - L.cost : 0;
  const total = L.realized + unreal;
  const sleeve = sleeveOf(pos.cat);
  return {
    key: pos.key, name: pos.name, cat: pos.cat, kind: pos.kind || '', sleeve: sleeve ? sleeve.key : '',
    first: L.first, openSince: L.openSince, lastSell: L.lastSell, open,
    days: L.first ? daysApart(open ? L.openSince : L.first, open ? today : L.lastSell || today) : 0,
    qty: L.qty, cost: L.cost, usdCost: L.usdCost, value, unreal, unrealPct: open && L.cost > 0 && !unpriced ? unreal / L.cost : null,
    realized: L.realized, soldCost: L.soldCost, proceeds: L.proceeds, realizedPct: L.soldCost > 0 ? L.realized / L.soldCost : null,
    bought: L.bought, total, totalPct: L.bought > 0 ? total / L.bought : null, unpriced, oversold: L.oversold,
    priceUsd: pos.priceUsd || 0,
  };
}

// Fully closed holdings: win rate, average win / loss (₹ and % of the cost sold), best and worst,
// and the average holding period of winners and losers (days).
function computeClosedStats(rows) {
  const closed = rows.filter(r => !r.open && r.soldCost > 0);
  const wins = closed.filter(r => r.realized > 0), losses = closed.filter(r => r.realized < 0);
  const avg = (list, f) => (list.length ? list.reduce((x, r) => x + f(r), 0) / list.length : null);
  const byRealized = closed.slice().sort((a, b) => b.realized - a.realized);
  return {
    count: closed.length, wins: wins.length, losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : null,
    avgWin: avg(wins, r => r.realized), avgWinPct: avg(wins, r => r.realizedPct),
    avgLoss: avg(losses, r => r.realized), avgLossPct: avg(losses, r => r.realizedPct),
    best: byRealized[0] || null, worst: byRealized[byRealized.length - 1] || null,
    winDays: avg(wins, r => r.days), lossDays: avg(losses, r => r.days),
    closed: byRealized,
  };
}

function isoToDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Indian stock picks (category 2) against the same ₹ cashflows put into the benchmark: each buy
// buys index units at that day's value, each sell takes the same ₹ out (the twin's units can go
// below zero when a sale takes out more than it holds). Everything is as of the latest snapshot —
// the picks at their snapshot values, the twin at the index value that day — so the headline,
// the table and the last point of the running ₹ gap agree. Per stock and in all: value vs the
// twin's (gap ₹), XIRR of each (once the first buy is a year old), the hit rate (stocks at or
// above their twin) and the gap at every snapshot since the first buy.
//   positions: normalised inputs; picksPoints: computeFundSeries(snap, [2]); assets: snap.assets
function computeStockPicks(positions, series, picksPoints, assets, code = FUND_HEADLINE_BENCH) {
  const navOn = d => computeBenchNavs(series, code, [{ d }])[0];
  const end = picksPoints[picksPoints.length - 1];
  const picks = [], noValue = [];
  if (!end) return { picks, noValue, running: [] };
  const navEnd = navOn(end.d);
  const aisOf = {};
  (assets || []).forEach((a, ai) => { (aisOf[a.t + '|' + a.id] = aisOf[a.t + '|' + a.id] || []).push(ai); });
  const valueAt = (p, ais) => ais.reduce((x, ai) => x + ((p.cells[ai] || {}).cur || 0), 0);
  positions.forEach(pos => {
    if (pos.cat !== 2) return;
    const flows = computePositionLedger(pos).flows.filter(f => f.d <= end.d);
    if (!flows.length) return;
    let units = 0, missing = false;
    const steps = flows.map(f => {
      const nav = navOn(f.d);
      if (!(nav > 0)) { missing = true; return null; }
      units += -f.inr / nav;                                           // a buy (inr < 0) adds units, a sell takes them out
      return { d: f.d, units };
    });
    if (missing) { noValue.push(pos.name); return; }
    const ais = aisOf[pos.key] || [];
    const value = valueAt(end, ais), shadow = navEnd > 0 ? units * navEnd : null;
    picks.push({ name: pos.name, ais, open: value > 0, first: flows[0].d, flows, steps, value, shadow,
                 bought: flows.reduce((x, f) => x + (f.inr < 0 ? -f.inr : 0), 0),
                 gap: shadow === null ? null : value - shadow, hit: shadow !== null && value >= shadow });
  });
  if (!picks.length || !(navEnd > 0)) return { picks: navEnd > 0 ? picks : [], noValue, running: [], noEnd: !(navEnd > 0), asOf: end.d };
  const first = picks.reduce((m, p) => (p.first < m ? p.first : m), picks[0].first);
  const value = picks.reduce((x, p) => x + p.value, 0), shadow = picks.reduce((x, p) => x + p.shadow, 0);
  const xirrOf = endValue => {
    const cfs = picks.flatMap(p => p.flows).map(f => ({ amount: f.inr, date: isoToDate(f.d) }));
    if (Math.abs(endValue) > 1e-9) cfs.push({ amount: endValue, date: isoToDate(end.d) });
    return computeXIRR(cfs);
  };
  const aged = daysApart(first, end.d) >= 365;
  const running = picksPoints.filter(p => p.d >= first).map(p => {
    const nav = navOn(p.d);
    let units = 0, val = 0;
    picks.forEach(k => {
      const last = k.steps.filter(st => st.d <= p.d).pop();
      units += last ? last.units : 0;
      val += valueAt(p, k.ais);
    });
    return { d: p.d, month: p.month, gap: nav > 0 ? val - units * nav : null };
  });
  return {
    asOf: end.d, picks: picks.sort((a, b) => b.gap - a.gap), noValue, first, value, shadow, gap: value - shadow,
    hits: picks.filter(p => p.hit).length,
    xirr: aged ? xirrOf(value) : null, shadowXirr: aged ? xirrOf(shadow) : null,
    xirrNeed: aged ? 0 : Math.max(1, 12 - monthsApart(first.slice(0, 7), end.month)),
    running,
  };
}

// Concentration at each snapshot: top-5 weight, effective number of holdings (1 / Σ weight²) and
// the largest position; the latest, its trend over up to 13 points and the change from the point
// 12 months earlier (null when that month has no snapshot).
function computeConcentration(points, names) {
  const at = p => {
    const ws = Object.keys(p.cells).map(k => ({ ai: Number(k), w: p.value > 0 ? p.cells[k].cur / p.value : 0 }))
      .filter(x => x.w > 0).sort((a, b) => b.w - a.w);
    const hhi = ws.reduce((x, y) => x + y.w * y.w, 0);
    return { d: p.d, month: p.month, top5: ws.slice(0, 5).reduce((x, y) => x + y.w, 0), eff: hhi > 0 ? 1 / hhi : 0,
             largest: ws[0] ? ws[0].w : 0, largestName: ws[0] ? names[ws[0].ai] || '' : '', count: ws.length };
  };
  const series = points.slice(-13).map(at);
  const latest = series[series.length - 1] || null;
  const ago = latest ? series.find(x => x.month === monthShift(latest.month, -12)) || null : null;
  return { latest, series, ago };
}

// Actual weights vs MANDATE at a snapshot point: per sleeve and, where the mandate splits a sleeve,
// per holding target (holdings it does not name are grouped as "Other" with a 0% target). Gap in
// pts of the fund and in ₹ (gap × fund value).
function computeMandateGaps(point, names) {
  const target = computeMandateWeights();
  const value = point.value;
  const cells = Object.keys(point.cells).map(k => ({ ai: Number(k), cat: point.cells[k].cat, cur: point.cells[k].cur }))
    .filter(c => c.cur > 0);
  const row = (key, label, sleeve, cur, tgt, members) => {
    const actual = value > 0 ? cur / value * 100 : 0;
    return { key, label, sleeve, value: cur, actual, target: tgt, gap: actual - tgt, gapInr: (actual - tgt) / 100 * value, members };
  };
  const sleeves = SLEEVES.map(sl => {
    const mine = cells.filter(c => sl.cats.includes(c.cat));
    return row(sl.key, sl.label, sl.key, mine.reduce((x, c) => x + c.cur, 0), target.sleeves[sl.key] || 0, mine.map(c => names[c.ai]));
  });
  const holdings = [];
  SLEEVES.forEach(sl => {
    const goals = target.holdings.filter(h => h.sleeve === sl.key);
    if (!goals.length) return;
    const mine = cells.filter(c => sl.cats.includes(c.cat));
    const used = new Set();
    goals.forEach(g => {
      const hit = mine.filter(c => !used.has(c.ai) && g.match.test(names[c.ai] || ''));
      hit.forEach(c => used.add(c.ai));
      holdings.push(row(sl.key + ':' + g.label, g.label, sl.key, hit.reduce((x, c) => x + c.cur, 0), g.ofFund, hit.map(c => names[c.ai])));
    });
    const rest = mine.filter(c => !used.has(c.ai));
    if (rest.length) holdings.push(row(sl.key + ':other', `Other ${sl.label}`, sl.key,
      rest.reduce((x, c) => x + c.cur, 0), 0, rest.map(c => names[c.ai])));
  });
  return { d: point.d, value, sleeves, holdings };
}

// Change in each sleeve's weight over the latest `months` months, split into the part market
// moves made (the weights had no money been added or taken out) and the part contributions made.
// Gated like the windows: months + 1 consecutive points.
function computeWeightDrift(points, months) {
  const L = points.length - 1;
  const run = computeRunLength(points, L);
  if (run < months + 1) return { need: months + 1 - run };
  const s = L - months;
  const keyOf = cat => (sleeveOf(cat) || { key: 'other' }).key;
  const sum = { V0: points[s].value, M: 0, R: 0, F: 0 };
  const by = {};
  SLEEVES.forEach(sl => { by[sl.key] = { key: sl.key, label: sl.label, V0: 0, M: 0, R: 0, F: 0, V1: 0 }; });
  Object.values(points[s].cells).forEach(c => { if (by[keyOf(c.cat)]) by[keyOf(c.cat)].V0 += c.cur; });
  Object.values(points[L].cells).forEach(c => { if (by[keyOf(c.cat)]) by[keyOf(c.cat)].V1 += c.cur; });
  for (let t = s + 1; t <= L; t++) {
    points[t].holdings.forEach(h => {
      const b = by[keyOf(h.cat)];
      if (!b) return;
      b.M += h.move; b.R += h.reval; b.F += h.flow;
      sum.M += h.move; sum.R += h.reval; sum.F += h.flow;
    });
  }
  const V1 = points[L].value, Vm = sum.V0 + sum.M + sum.R;
  const sleeves = Object.values(by).map(b => {
    const w0 = sum.V0 > 0 ? b.V0 / sum.V0 : 0, w1 = V1 > 0 ? b.V1 / V1 : 0;
    const wm = Vm > 0 ? (b.V0 + b.M + b.R) / Vm : w0;
    return { key: b.key, label: b.label, w0, w1, delta: w1 - w0, market: wm - w0, flows: w1 - wm };
  });
  return { from: points[s].d, to: points[L].d, sleeves };
}

// Money in and out by month (the latest 24 months) and by year: bought, sold (sale proceeds) and
// turnover = sold ÷ the fund's average snapshot value that year (this year: so far).
function computeActivity(positions, points, today) {
  const byMonth = {}, byYear = {};
  positions.forEach(pos => {
    computePositionLedger(pos).flows.forEach(f => {
      const m = f.d.slice(0, 7), y = f.d.slice(0, 4);
      const bm = byMonth[m] = byMonth[m] || { bought: 0, sold: 0 };
      const by = byYear[y] = byYear[y] || { bought: 0, sold: 0 };
      if (f.inr < 0) { bm.bought -= f.inr; by.bought -= f.inr; } else { bm.sold += f.inr; by.sold += f.inr; }
    });
  });
  const thisMonth = today.slice(0, 7);
  const months = [];
  for (let k = 23; k >= 0; k--) {
    const m = monthShift(thisMonth, -k);
    months.push(Object.assign({ month: m }, byMonth[m] || { bought: 0, sold: 0 }));
  }
  const year = y => {
    const pts = points.filter(p => p.month.slice(0, 4) === String(y));
    const avgValue = pts.length ? pts.reduce((x, p) => x + p.value, 0) / pts.length : 0;
    const a = byYear[String(y)] || { bought: 0, sold: 0 };
    return { year: y, bought: a.bought, sold: a.sold, points: pts.length, avgValue, turnover: avgValue > 0 ? a.sold / avgValue : null };
  };
  const y = Number(today.slice(0, 4));
  return { months, thisYear: year(y), lastYear: year(y - 1) };
}

// US holdings' INR result split into the stock move (in USD, at the INR cost rate) and the
// USD/INR move: stock = (value $ − cost $) × cost rate; FX = value $ × (rate now − cost rate);
// together = value ₹ − cost ₹. Cost rate = wire-derived ₹ cost ÷ $ cost. Open holdings only.
function computeUsSplit(rows) {
  const split = r => {
    const valueUsd = r.qty * r.priceUsd;
    const fxCost = r.cost / r.usdCost, fxNow = r.value / valueUsd;
    const stockMove = (valueUsd - r.usdCost) * fxCost, fxMove = valueUsd * (fxNow - fxCost);
    return { name: r.name, costInr: r.cost, costUsd: r.usdCost, valueUsd, valueInr: r.value, fxCost, fxNow, stockMove, fxMove,
             stockPct: valueUsd / r.usdCost - 1, fxPct: fxNow / fxCost - 1, totalPct: r.value / r.cost - 1 };
  };
  const holdings = rows.filter(r => r.cat === 3 && r.open && !r.unpriced && r.usdCost > 0 && r.priceUsd > 0 && r.cost > 0).map(split);
  if (!holdings.length) return { holdings, total: null };
  const t = holdings.reduce((x, h) => ({ cost: x.cost + h.costInr, usdCost: x.usdCost + h.costUsd, value: x.value + h.valueInr,
    qty: 1, priceUsd: x.priceUsd + h.valueUsd }), { cost: 0, usdCost: 0, value: 0, qty: 1, priceUsd: 0 });
  return { holdings, total: Object.assign(split(t), { name: 'US equity' }) };
}


// ── Pattern feed ("What's happening") ─────────────────────────────────────────
// Each detector states one pattern as fact and returns cards:
//   { id, holding, scope: 'fund' | 'sleeve' | 'holding', tone: 'up' | 'down' | 'neutral', headline,
//     facts: [2–3 strings], spark: { kind: 'line' | 'bars', values }, from, to, impact (₹), unusual, value }
// A card exists only when its data gate passes. The feed ranks by |₹ impact|, then by how unusual the
// pattern is against that holding's own history (unusual ≥ 1 = beyond anything seen before).

const PATTERN_RULES = {
  streakFund: 4,             // months in a row, same sign
  streakHolding: 5,
  momentum12: 0.05,          // |12M return| at least this…
  momentum3: 0.03,           // …and the last 3 months at least this the other way
  mfHighMonths: 12,          // MF-like: months without a new high
  mfGapPts: 3,               // MF-like: 3Y return behind its benchmark by this many pts a year
  stockHighMonths: 6,        // stocks / crypto: months without a new high
  stockRangeMonths: 6,       // stocks / crypto: months within ±stockBand of their average
  stockBand: 0.05,
  drawdownMin: 0.05,
  driftPts: 0.03,
  volRatio: 1.5,
  volRecent: 6,
  hedgeMonths: 24,
  hedgeMinDown: 3,
  buyMin: 3,
  closedMin: 2,
  dispersionMin: 3,
};
const PATTERN_MF_CATS = [1, 3, 8];   // stagnation by asset type: funds / ETFs / metals vs stocks and crypto
const PATTERN_STOCK_CATS = [2, 9];

function fmtMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

function signOf(x, eps = 0.0005) {
  if (x > eps) return 1;
  if (x < -eps) return -1;
  return 0;
}

function toneOf(x, eps = 0) {
  const s = signOf(x, eps);
  if (s > 0) return 'up';
  if (s < 0) return 'down';
  return 'neutral';
}

// A current holding's run of consecutive monthly points, each held and priced, ending at the latest
// point: its index (chained monthly returns), monthly returns and market moves. null if not held now.
function computeHoldingTrack(points, ai) {
  const L = points.length - 1;
  const ok = t => { const c = points[t].cells[ai]; return !!(c && c.cur > 0 && c.flag !== 1); };
  if (L < 0 || !ok(L)) return null;
  let s = L;
  while (s > 0 && ok(s - 1) && points[s - 1].month === monthShift(points[s].month, -1)) s--;
  const idx = [100], rets = [], moves = [];
  for (let t = s + 1; t <= L; t++) {
    const h = points[t].holdings.find(x => x.ai === ai);
    const r = h && h.base > 0 ? h.move / h.base : 0;
    rets.push(r);
    moves.push(h ? h.move : 0);
    idx.push(idx[idx.length - 1] * (1 + r));
  }
  return { ai, s, pts: points.slice(s, L + 1), idx, rets, moves, value: points[L].cells[ai].cur, cat: points[L].cells[ai].cat,
           est: points.slice(s, L + 1).some(p => p.cells[ai].flag === 3) };
}

// A fund / sleeve series as a track (its consecutive run ending at the latest point).
function computeSeriesTrack(points) {
  const L = points.length - 1;
  if (L < 0 || !(points[L].value > 0)) return null;
  let s = L - computeRunLength(points, L) + 1;
  for (let t = L; t > s; t--) { if (!(points[t - 1].value > 0)) { s = t; break; } }   // an emptied sleeve restarts the run
  const pts = points.slice(s);
  return { pts, idx: pts.map(p => p.idx), rets: pts.slice(1).map(p => p.ret), moves: pts.slice(1).map(p => p.move), value: points[L].value };
}

// The run of same-sign monthly returns ending at the latest one, and the longest earlier run of that sign.
function computeStreak(rets) {
  const n = rets.length;
  if (!n) return { len: 0, sign: 0, prior: 0 };
  const sign = signOf(rets[n - 1]);
  if (!sign) return { len: 0, sign: 0, prior: 0 };
  let len = 0;
  while (len < n && signOf(rets[n - 1 - len]) === sign) len++;
  let prior = 0, run = 0;
  rets.slice(0, n - len).forEach(r => { run = signOf(r) === sign ? run + 1 : 0; prior = Math.max(prior, run); });
  return { len, sign, prior };
}

function patternCard(o) {
  return Object.assign({ holding: '', scope: 'holding', tone: 'neutral', facts: [], spark: null, unusual: 0, value: 0 }, o);
}

// The subjects detectors run over: the fund, each sleeve and each current holding.
function patternSubjects(ctx) {
  const subjects = [{ scope: 'fund', name: 'Fund', track: computeSeriesTrack(ctx.points) }];
  ctx.sleeves.forEach(s => {
    if (s.points.length && s.points[s.points.length - 1].value > 0) subjects.push({ scope: 'sleeve', name: s.label, track: computeSeriesTrack(s.points), key: s.key });
  });
  const L = ctx.points[ctx.points.length - 1];
  Object.keys(L ? L.cells : {}).forEach(k => {
    const track = computeHoldingTrack(ctx.points, Number(k));
    if (track) subjects.push({ scope: 'holding', name: ctx.names[k] || 'Asset ' + k, track, ai: Number(k) });
  });
  return subjects.filter(x => x.track && x.track.pts.length > 1);
}

// 1. Streaks: the latest months all up (or all down), long enough to be more than noise.
function patternStreaks(ctx, subjects) {
  return subjects.map(sub => {
    const t = sub.track, st = computeStreak(t.rets);
    const min = sub.scope === 'holding' ? PATTERN_RULES.streakHolding : PATTERN_RULES.streakFund;
    if (st.len < min) return null;
    const n = t.idx.length - 1, cum = t.idx[n] / t.idx[n - st.len] - 1;
    const impact = t.moves.slice(-st.len).reduce((x, y) => x + y, 0);
    return patternCard({
      id: 'streak', holding: sub.scope === 'fund' ? '' : sub.name, scope: sub.scope, tone: st.sign > 0 ? 'up' : 'down',
      headline: `${sub.name}: ${st.len} months in a row ${st.sign > 0 ? 'up' : 'down'}`,
      facts: [`${fmtPct(cum)} over the ${st.len} months`, `market move ${fmtRupees(impact, true)}`,
              st.prior ? `longest earlier run: ${fmtMonths(st.prior)}` : 'no earlier run this long'],
      spark: { kind: 'bars', values: t.rets.slice(-12) }, from: t.pts[n - st.len].d, to: t.pts[n].d,
      impact, unusual: st.len / Math.max(st.prior, 1), value: st.len * st.sign,
    });
  }).filter(Boolean);
}

// 2. Momentum shift: the last 3 months went the other way from the 9 before them, by more than the
// holding's usual 3-month swing (a move within one standard deviation of its own 3-month returns is noise).
function patternMomentum(ctx, subjects) {
  return subjects.map(sub => {
    const t = sub.track, n = t.idx.length - 1;
    if (n < 12) return null;
    const r9 = t.idx[n - 3] / t.idx[n - 12] - 1, r3 = t.idx[n] / t.idx[n - 3] - 1;
    if (signOf(r9) === signOf(r3) || Math.abs(r9) < PATTERN_RULES.momentum12 || Math.abs(r3) < PATTERN_RULES.momentum3) return null;
    const threes = [];
    for (let i = 3; i <= n; i++) threes.push(t.idx[i] / t.idx[i - 3] - 1);
    const sd = computeStdev(threes) || 0, mean = threes.reduce((x, y) => x + y, 0) / threes.length;
    const z = sd > 0 ? Math.abs(r3 - mean) / sd : 0;
    if (z < 1) return null;
    const impact = t.moves.slice(-3).reduce((x, y) => x + y, 0);
    return patternCard({
      id: 'momentum', holding: sub.scope === 'fund' ? '' : sub.name, scope: sub.scope, tone: toneOf(r3),
      headline: `${sub.name}: ${fmtPct(r3)} over the last 3 months after ${fmtPct(r9)} over the 9 before`,
      facts: [`12 months: ${fmtPct(t.idx[n] / t.idx[n - 12] - 1)}`, `3-month market move ${fmtRupees(impact, true)}`,
              `${z.toFixed(1)}× its usual 3-month swing`],
      spark: { kind: 'line', values: t.idx.slice(-13) }, from: t.pts[n - 12].d, to: t.pts[n].d,
      impact, unusual: z / 2, value: r3,
    });
  }).filter(Boolean);
}

// Months since the index's high, the high's point, and the low since it (as a fraction of the high).
function computeSinceHigh(idx) {
  let hi = 0;
  idx.forEach((v, i) => { if (v >= idx[hi] * (1 - 1e-9)) hi = i; });
  const low = Math.min(...idx.slice(hi));
  let longest = 0, run = 0, peak = idx[0];
  idx.slice(0, hi + 1).forEach(v => { if (v >= peak * (1 - 1e-9)) { peak = v; run = 0; } else { run++; longest = Math.max(longest, run); } });
  return { months: idx.length - 1 - hi, hi, low: low / idx[hi] - 1, now: idx[idx.length - 1] / idx[hi] - 1, longest };
}

// The stagnation rules for one holding's track, by asset type. MF-like (funds, ETFs, metals): 3Y
// return behind its own benchmark (BENCHMARK_MAP) by 3+ pts a year, or 12+ months without a new
// high; stocks / crypto: 6+ months within ±5% of the range's midpoint (while not at a new high), or
// 6+ months without a new high. Each rule is reported as met / not met / not testable yet.
// A rule that can never be tested for this holding (no benchmark, estimated values, no benchmark
// value on the window's dates) is marked na rather than not met.
//   → { type: 'mf' | 'stock' | '', sinceHigh, gap3y, code, band, checks: [{ rule, met, detail, need, na }], reasons }
function computeStagnation(track, name, series) {
  const t = track, n = t.idx.length - 1, cat = t.cat;
  let type = '';
  if (PATTERN_MF_CATS.includes(cat)) type = 'mf';
  else if (PATTERN_STOCK_CATS.includes(cat)) type = 'stock';
  const sh = computeSinceHigh(t.idx);
  const code = benchmarkFor(cat, name);
  const out = { type, sinceHigh: sh, gap3y: null, code, band: null, checks: [], reasons: [] };
  if (!type) return out;
  const highMonths = type === 'mf' ? PATTERN_RULES.mfHighMonths : PATTERN_RULES.stockHighMonths;
  const highMet = sh.months >= highMonths;
  out.checks.push({ rule: `${highMonths}+ months without a new high`, met: highMet, detail: `${fmtMonths(sh.months)} since the high`,
                    need: Math.max(0, highMonths + 1 - t.idx.length) });
  if (highMet) out.reasons.push(`${sh.months} months without a new high`);
  if (type === 'mf') {
    const rule = `3-year return ${PATTERN_RULES.mfGapPts}+ pts a year behind its benchmark`;
    let detail = 'no benchmark', need = 0, met = false, na = true;
    if (t.est) detail = 'valued from estimates — not compared';
    else if (code && n < 36) { detail = fsNeedText(37 - t.idx.length); need = 37 - t.idx.length; na = false; }
    else if (code) {
      const navs = computeBenchNavs(series, code, t.pts);
      const b = benchReturn(navs, n - 36, n);
      if (b === null) detail = 'no benchmark value on the window dates';
      else {
        na = false;
        out.gap3y = (Math.pow(t.idx[n] / t.idx[n - 36], 1 / 3) - Math.pow(1 + b, 1 / 3)) * 100;
        met = out.gap3y <= -PATTERN_RULES.mfGapPts;
        detail = `${fmtPts(out.gap3y)} a year vs ${(BENCHMARKS[code] || {}).label || code}`;
      }
    }
    out.checks.push({ rule, met, detail, need, na });
    if (met) out.reasons.unshift(`3-year return ${fmtPts(out.gap3y)} a year vs ${(BENCHMARKS[code] || {}).label || code}`);
  } else {
    const k = PATTERN_RULES.stockRangeMonths;
    const rule = `${k} months within ±${(PATTERN_RULES.stockBand * 100).toFixed(0)}% (not at a new high)`;
    if (n < k) {
      out.checks.push({ rule, met: false, detail: fsNeedText(k + 1 - t.idx.length), need: k + 1 - t.idx.length });
    } else {
      const w = t.idx.slice(-(k + 1));
      const hiW = Math.max(...w), loW = Math.min(...w);
      out.band = (hiW - loW) / (hiW + loW);                             // ± around the range's midpoint
      const met = out.band <= PATTERN_RULES.stockBand && sh.months >= 1;
      out.checks.push({ rule, met, detail: `±${(out.band * 100).toFixed(1)}% over ${k} months`, need: 0 });
      if (met) out.reasons.push(`${k} months within ±${(out.band * 100).toFixed(1)}% of their midpoint`);
    }
  }
  return out;
}

// 3. Stagnation (computeStagnation's rules). Always states the months since the high and the range.
function patternStagnation(ctx, subjects) {
  return subjects.filter(s => s.scope === 'holding').map(sub => {
    const t = sub.track, n = t.idx.length - 1;
    const st = computeStagnation(t, sub.name, ctx.series);
    if (!st.reasons.length) return null;
    const sh = st.sinceHigh;
    const impact = sh.now < 0 ? t.value / (1 + sh.now) - t.value : 0;
    // The period the headline is about: 3 years when the 3Y gap leads, else since the high (≥ 2 points).
    const gapLed = st.gap3y !== null && st.gap3y <= -PATTERN_RULES.mfGapPts;
    const sparkFrom = gapLed ? n - 36 : Math.min(Math.max(sh.hi, n - 36), n - 1);
    return patternCard({
      id: 'stagnation', holding: sub.name, tone: 'neutral', headline: `${sub.name}: ${st.reasons[0]}`,
      facts: [`${fmtMonths(sh.months)} since the high of ${fmtDay(t.pts[sh.hi].d)}`,
              `since then: low ${fmtPct(sh.low)}, now ${fmtPct(sh.now)} from the high`].concat(st.reasons.slice(1, 2)),
      spark: { kind: 'line', values: t.idx.slice(sparkFrom) }, from: t.pts[sparkFrom].d, to: t.pts[n].d,
      impact: -impact, unusual: sh.months / Math.max(sh.longest, 1),
      value: st.gap3y !== null && st.gap3y <= -PATTERN_RULES.mfGapPts ? st.gap3y : sh.months,
    });
  }).filter(Boolean);
}

// 4. Drawdown context: the fund or a sleeve 5%+ below its high.
function patternDrawdown(ctx, subjects) {
  return subjects.filter(s => s.scope !== 'holding').map(sub => {
    const t = sub.track;
    const pts = sub.scope === 'fund' ? ctx.points : ctx.sleeves.find(x => x.key === sub.key).points;
    const dd = computeDrawdown(pts, pts.map(p => p.idx));
    if (dd.need || !(dd.current <= -PATTERN_RULES.drawdownMin)) return null;
    const below = t.value / (1 + dd.current) - t.value;
    const facts = [`worst so far ${fmtPct(dd.max)} (${fmtDay(dd.peakD)} → ${fmtDay(dd.troughD)})`, `${fmtRupees(below)} below the value at the high's level`];
    if (sub.scope === 'fund') {
      const nb = computeDrawdown(pts, ctx.navs);
      if (!nb.need && nb.current !== null) facts.push(`Nifty 50: ${fmtPct(nb.current)} from its own high`);
    }
    return patternCard({
      id: 'drawdown', holding: sub.scope === 'fund' ? '' : sub.name, scope: sub.scope, tone: 'down',
      headline: `${sub.name}: ${(Math.abs(dd.current) * 100).toFixed(1)}% below its high of ${fmtDay(dd.highD)}, ${fmtMonths(dd.sinceHigh)} ago`,
      facts, spark: { kind: 'line', values: pts.slice(Math.max(pts.findIndex(p => p.d === dd.highD), pts.length - 37)).map(p => p.idx) },
      from: pts[Math.max(pts.findIndex(p => p.d === dd.highD), pts.length - 37)].d, to: pts[pts.length - 1].d,
      impact: -below, unusual: dd.max < 0 ? dd.current / dd.max : 0, value: dd.current,
    });
  }).filter(Boolean);
}

// 5. Where the gain came from: the 12-month return by sleeve and its largest holdings.
function patternGainSource(ctx) {
  const r = computeAttrRange(ctx.points, 'y1');
  if (r.need) return [];
  const a = computeAttribution(ctx.points, r.s, r.e, ctx.names);
  const sl = a.sleeves.slice().sort((x, y) => Math.abs(y.contrib) - Math.abs(x.contrib));
  const hs = a.holdings.slice().sort((x, y) => Math.abs(y.contrib) - Math.abs(x.contrib)).slice(0, 2);
  if (!sl.length) return [];
  const gross = sl.reduce((x, s) => x + Math.abs(s.contrib), 0);
  return [patternCard({
    id: 'gain_source', scope: 'fund', tone: toneOf(sl[0].contrib),
    headline: `${sl[0].label} gave ${fmtPts(sl[0].contrib * 100)} of the fund's ${fmtPct(a.total)} over 12 months`,
    facts: hs.map(h => `${h.name}: ${fmtPts(h.contrib * 100)}`).concat(sl[1] ? [`${sl[1].label}: ${fmtPts(sl[1].contrib * 100)}`] : []).slice(0, 3),
    spark: { kind: 'bars', values: sl.map(s => s.contrib) }, from: a.from, to: a.to,
    impact: sl[0].move, unusual: gross > 0 ? Math.abs(sl[0].contrib) / gross : 0, value: sl[0].contrib,
  })];
}

// 6. Market vs me: the 12-month change in value split into money added and market move.
function patternMarketVsMe(ctx) {
  const L = ctx.points.length - 1;
  if (computeRunLength(ctx.points, L) < 13) return [];
  const span = ctx.points.slice(L - 11);
  const flow = span.reduce((x, p) => x + p.flow, 0), market = span.reduce((x, p) => x + p.move + p.reval, 0);
  const change = ctx.points[L].value - ctx.points[L - 12].value;
  return [patternCard({
    id: 'market_vs_me', scope: 'fund', tone: toneOf(market, 0.5),
    headline: `Value ${change >= 0 ? 'up' : 'down'} ${fmtRupees(change)} over 12 months: ${fmtRupees(flow, true)} money added, ${fmtRupees(market, true)} market`,
    facts: [flow > 0 ? `market move per ₹100 added: ${fmtRupees(market / flow * 100, true)}` : 'no net money added',
            `months with a market gain: ${span.filter(p => p.move > 0).length} of 12`],
    spark: { kind: 'bars', values: span.map(p => p.move) }, from: ctx.points[L - 12].d, to: ctx.points[L].d,
    impact: market, unusual: 0, value: market,
  })];
}

// 7. Weight drift: a sleeve's weight moved 3+ pts in 12 months (market vs contributions).
function patternDrift(ctx) {
  const dr = computeWeightDrift(ctx.points, 12);
  if (dr.need) return [];
  const target = computeMandateWeights().sleeves;
  const V = ctx.points[ctx.points.length - 1].value;
  return dr.sleeves.filter(s => Math.abs(s.delta) >= PATTERN_RULES.driftPts).map(s => patternCard({
    id: 'weight_drift', holding: s.label, scope: 'sleeve', tone: 'neutral',
    headline: `${s.label}: weight ${(s.w0 * 100).toFixed(1)}% → ${(s.w1 * 100).toFixed(1)}% over 12 months (${fmtPts(s.delta * 100)})`,
    facts: [`market ${fmtPts(s.market * 100)}, money in/out ${fmtPts(s.flows * 100)}`, `mandate ${(target[s.key] || 0).toFixed(1)}%`],
    spark: { kind: 'bars', values: [s.market, s.flows] }, from: dr.from, to: dr.to,
    impact: s.delta * V, unusual: Math.abs(s.delta) / PATTERN_RULES.driftPts / 4, value: s.delta,
  }));
}

// 8. Buy timing: the last 12 months' purchases against each holding's benchmark — its level on the
// day bought vs its average over the 12 months (₹-weighted).
function patternBuyTiming(ctx) {
  const L = ctx.points.length - 1;
  if (computeRunLength(ctx.points, L) < 13) return [];
  const from = ctx.points[L - 12].d, to = ctx.points[L].d;
  const avgOf = {};
  let sum = 0, cheap = 0, effect = 0, n = 0;
  const perMonth = {};
  ctx.inputs.forEach(pos => {
    const code = benchmarkFor(pos.cat, pos.name);
    if (!code) return;
    if (avgOf[code] === undefined) {
      const navs = computeBenchNavs(ctx.series, code, ctx.points.slice(L - 12));
      avgOf[code] = navs.every(v => v > 0) ? navs.reduce((x, y) => x + y, 0) / navs.length : null;
    }
    if (!avgOf[code]) return;
    pos.txns.filter(t => t.buy && t.d > from && t.d <= to).forEach(t => {
      const lvl = computeBenchNavs(ctx.series, code, [{ d: t.d }])[0];
      if (!(lvl > 0)) return;
      const rel = lvl / avgOf[code] - 1;
      sum += t.inr; effect += -rel * t.inr; n++;
      perMonth[t.d.slice(0, 7)] = (perMonth[t.d.slice(0, 7)] || 0) + t.inr;
      if (rel < 0) cheap += t.inr;
    });
  });
  if (n < PATTERN_RULES.buyMin || !(sum > 0)) return [];
  const rel = -effect / sum;
  return [patternCard({
    id: 'buy_timing', scope: 'fund', tone: toneOf(-rel, 0.0005),
    headline: `Purchases in the last 12 months went in at benchmark levels ${(Math.abs(rel) * 100).toFixed(1)}% ${rel <= 0 ? 'below' : 'above'} their 12-month average`,
    facts: [`${fmtRupees(sum)} over ${n} purchases`, `${(cheap / sum * 100).toFixed(0)}% of it below the average level`,
            `vs buying at the average: ${fmtRupees(effect, true)}`],
    spark: { kind: 'bars', signed: false, values: ctx.points.slice(L - 11).map(p => perMonth[p.month] || 0) },
    from, to, impact: effect, unusual: Math.abs(rel) * 10, value: rel,
  })];
}

// 9. Dispersion: how far apart the holdings' 12-month returns are.
function patternDispersion(ctx, subjects) {
  const list = subjects.filter(s => s.scope === 'holding' && s.track.idx.length > 12).map(s => {
    const n = s.track.idx.length - 1;
    return { name: s.name, r: s.track.idx[n] / s.track.idx[n - 12] - 1, move: s.track.moves.slice(-12).reduce((x, y) => x + y, 0) };
  }).sort((a, b) => a.r - b.r);
  if (list.length < PATTERN_RULES.dispersionMin) return [];
  const k = list.length >> 1;
  const lo = list[0], hi = list[list.length - 1], mid = list.length % 2 ? list[k].r : (list[k - 1].r + list[k].r) / 2;
  const L = ctx.points.length - 1;
  return [patternCard({
    id: 'dispersion', scope: 'fund', tone: 'neutral',
    headline: `12-month returns ranged from ${fmtPct(lo.r)} (${lo.name}) to ${fmtPct(hi.r)} (${hi.name})`,
    facts: [`${((hi.r - lo.r) * 100).toFixed(1)} pts apart across ${list.length} holdings`, `median ${fmtPct(mid)}`],
    spark: { kind: 'bars', values: list.map(x => x.r) }, from: ctx.points[Math.max(0, L - 12)].d, to: ctx.points[L].d,
    impact: list.reduce((x, y) => x + Math.abs(y.move), 0) / 2, unusual: 0, value: hi.r - lo.r,
  })];
}

// 10. Volatility regime: the size of the last 6 months' monthly moves vs the months before (×1.5 or
// ÷1.5). Only the earlier window (23+ returns) gets an annualised volatility; the recent one is a ratio.
function patternVolRegime(ctx, subjects) {
  return subjects.filter(s => s.scope !== 'holding').map(sub => {
    const t = sub.track, rets = t.rets;
    if (t.pts.length < FUND_GATES.vol) return null;
    const recent = rets.slice(-PATTERN_RULES.volRecent), before = rets.slice(-FUND_VOL_MONTHS, -PATTERN_RULES.volRecent);
    if (before.length < FUND_GATES.vol - 1 - PATTERN_RULES.volRecent) return null;
    const a = computeStdev(recent) * Math.sqrt(12), b = computeStdev(before) * Math.sqrt(12);
    if (!(b > 0)) return null;
    const ratio = a / b;
    if (ratio < PATTERN_RULES.volRatio && ratio > 1 / PATTERN_RULES.volRatio) return null;
    const big = recent.reduce((m, r) => (Math.abs(r) > Math.abs(m) ? r : m), 0);
    return patternCard({
      id: 'vol_regime', holding: sub.scope === 'fund' ? '' : sub.name, scope: sub.scope, tone: 'neutral',
      headline: `${sub.name}: monthly swings over the last 6 months ${ratio.toFixed(1)}× those of the ${before.length} months before`,
      facts: [`largest monthly move in the 6 months: ${fmtPct(big)}`, `volatility over the ${before.length} months before: ${(b * 100).toFixed(1)}% a year`],
      spark: { kind: 'bars', values: recent }, from: t.pts[t.pts.length - 1 - PATTERN_RULES.volRecent].d, to: t.pts[t.pts.length - 1].d,
      impact: t.value * a / Math.sqrt(12), unusual: Math.max(ratio, 1 / ratio) / 3, value: ratio,
    });
  }).filter(Boolean);
}

// 11. Hedge behaviour: what precious metals did in the months Indian equity fell (last 24).
function patternHedge(ctx) {
  const india = ctx.sleeves.find(s => s.key === 'india'), metals = ctx.sleeves.find(s => s.key === 'metals');
  if (!india || !metals) return [];
  const L = ctx.points.length - 1;
  if (computeRunLength(ctx.points, L) < PATTERN_RULES.hedgeMonths + 1) return [];
  const months = ctx.points.slice(L - PATTERN_RULES.hedgeMonths + 1).map(p => p.month);
  const at = (s, m) => s.points.find(p => p.month === m);
  const down = months.map(m => ({ i: at(india, m), g: at(metals, m) }))
    .filter(x => x.i && x.g && x.i.ret !== null && x.g.ret !== null && x.i.ret < 0);
  if (down.length < PATTERN_RULES.hedgeMinDown) return [];
  const up = down.filter(x => x.g.ret > 0).length;
  const avg = f => down.reduce((s, x) => s + f(x), 0) / down.length;
  const move = down.reduce((s, x) => s + x.g.move, 0);
  return [patternCard({
    id: 'hedge', scope: 'sleeve', holding: metals.label, tone: toneOf(avg(x => x.g.ret), 0.0005),
    headline: `In the ${down.length} months Indian equity fell (last 24), precious metals rose in ${up}`,
    facts: [`average month: Indian equity ${fmtPct(avg(x => x.i.ret))}, precious metals ${fmtPct(avg(x => x.g.ret))}`,
            `metals' market move in those months ${fmtRupees(move, true)}`],
    spark: { kind: 'bars', values: down.map(x => x.g.ret) }, from: ctx.points[L - PATTERN_RULES.hedgeMonths].d, to: ctx.points[L].d,
    impact: move, unusual: up / down.length, value: up / down.length,
  })];
}

// 12. US FX share: how much of the US sleeve's INR result came from USD/INR.
function patternUsFx(ctx) {
  const us = computeUsSplit(ctx.rows).total;
  if (!us) return [];
  const result = us.valueInr - us.costInr;
  const gross = Math.abs(us.stockMove) + Math.abs(us.fxMove);
  return [patternCard({
    id: 'us_fx', scope: 'sleeve', holding: 'US equity', tone: toneOf(us.fxMove, 0.5),
    headline: `USD/INR gave ${fmtRupees(us.fxMove, true)} of the US sleeve's ${fmtRupees(result, true)} result`,
    facts: [`rate ₹${us.fxCost.toFixed(2)} → ₹${us.fxNow.toFixed(2)} per $ (${fmtPct(us.fxPct)})`, `stock move ${fmtRupees(us.stockMove, true)} (${fmtPct(us.stockPct)} in USD)`],
    spark: { kind: 'bars', values: [us.stockMove, us.fxMove] }, from: '', to: ctx.today,
    impact: us.fxMove, unusual: gross > 0 ? Math.abs(us.fxMove) / gross : 0, value: us.fxMove,
  })];
}

// 13. Stock picks vs the same money in the index (computeStockPicks).
function patternPicks(ctx) {
  const sp = ctx.picks;
  if (!sp || !sp.picks.length) return [];
  return [patternCard({
    id: 'stock_picks', scope: 'fund', holding: 'Indian stocks', tone: toneOf(sp.gap, 0.5),
    headline: `Stock picks ${fmtRupees(sp.gap, true)} vs the same money in Nifty 50`,
    facts: [`${sp.hits} of ${sp.picks.length} stocks at or above their index twin`,
            sp.xirr === null ? `XIRR ${fsNeedText(sp.xirrNeed)}` : `XIRR ${fmtPct(sp.xirr)} vs ${fmtPct(sp.shadowXirr)}`],
    spark: { kind: 'line', values: sp.running.filter(r => r.gap !== null).map(r => r.gap) }, from: sp.first, to: sp.asOf,
    impact: sp.gap, unusual: 0, value: sp.gap,
  })];
}

function fsNeedText(n) {
  return `needs ${n} more month${n === 1 ? '' : 's'}`;
}

// 14. Closed trades: holdings fully sold in the last 12 months.
function patternClosed(ctx) {
  const since = isoShiftDays(ctx.today, -365);
  const st = computeClosedStats(ctx.rows.filter(r => !r.open && r.lastSell > since));
  if (st.count < PATTERN_RULES.closedMin) return [];
  const total = st.closed.reduce((x, r) => x + r.realized, 0);
  return [patternCard({
    id: 'closed_trades', scope: 'fund', tone: toneOf(total, 0.5),
    headline: `${st.count} holdings fully sold in the last 12 months: ${st.wins} with a gain, realized ${fmtRupees(total, true)}`,
    facts: [`average win ${st.avgWin === null ? '—' : fmtRupees(st.avgWin, true)} vs average loss ${st.avgLoss === null ? '—' : fmtRupees(st.avgLoss, true)}`,
            `best ${st.best.name} ${fmtRupees(st.best.realized, true)}`],
    spark: { kind: 'bars', values: st.closed.map(r => r.realized) }, from: since, to: ctx.today,
    impact: total, unusual: 0, value: total,
  })];
}

function isoShiftDays(iso, days) {
  const d = isoToDate(iso);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Open and sold FIFO lots of one holding (Indian rule for capital gains: oldest units go first).
function computeFifoLots(pos) {
  const open = [], sold = [];
  pos.txns.slice().sort(cmpPositionTxn).forEach((t, tx) => {
    if (t.buy) { open.push({ d: t.d, qty: t.qty, cost: t.inr }); return; }
    let left = t.qty;
    const per = t.qty > 0 ? t.inr / t.qty : 0;
    while (left > 1e-9 && open.length) {
      const lot = open[0], take = Math.min(left, lot.qty), cost = lot.cost * take / lot.qty;
      sold.push({ buyD: lot.d, sellD: t.d, tx, qty: take, gain: per * take - cost });   // tx: the sale it belongs to
      lot.qty -= take; lot.cost -= cost; left -= take;
      if (lot.qty < 1e-9) open.shift();
    }
  });
  return { open, sold };
}

// 15. Tax position (numbers only): Indian equity gains by holding period (more than 12 calendar
// months = long term) — realized this financial year, unrealized now, and gains turning long-term
// within 90 days.
function patternTax(ctx) {
  const fyStart = taxFyStart(ctx.today);
  const longTerm = (a, b) => b >= taxLongTermFrom(a, 12);              // held more than 12 months (the Tax tab's rule)
  const soon = isoShiftDays(ctx.today, 90);
  const out = { rLT: 0, rST: 0, uLT: 0, uST: 0, turning: 0 };
  ctx.inputs.filter(p => p.cat === 1 || p.cat === 2).forEach(pos => {
    const lots = computeFifoLots(pos);
    lots.sold.filter(l => l.sellD >= fyStart).forEach(l => { if (longTerm(l.buyD, l.sellD)) out.rLT += l.gain; else out.rST += l.gain; });
    if (!(pos.price > 0)) return;
    lots.open.forEach(l => {
      const g = l.qty * pos.price - l.cost;
      if (longTerm(l.d, ctx.today)) out.uLT += g; else out.uST += g;
      if (!longTerm(l.d, ctx.today) && longTerm(l.d, soon)) out.turning += g;
    });
  });
  if (![out.rLT, out.rST, out.uLT, out.uST].some(v => Math.abs(v) >= 1)) return [];
  const fy = `FY ${fyStart.slice(2, 4)}-${String(Number(fyStart.slice(2, 4)) + 1).padStart(2, '0')}`;
  return [patternCard({
    id: 'tax_position', scope: 'fund', tone: 'neutral',
    headline: `${fy} so far: Indian equity gains realized ${fmtRupees(out.rLT, true)} long-term, ${fmtRupees(out.rST, true)} short-term`,
    facts: [`unrealized now: ${fmtRupees(out.uLT, true)} long-term, ${fmtRupees(out.uST, true)} short-term`,
            `turning long-term in the next 90 days: ${fmtRupees(out.turning, true)}`],
    spark: { kind: 'bars', values: [out.rLT, out.rST, out.uLT, out.uST] }, from: fyStart, to: ctx.today,
    impact: out.rLT + out.rST, unusual: 0, value: out.rLT + out.rST,
  })];
}

// 16. Turnover: this year so far vs the same months last year (last year needs a full year of
// snapshots for its turnover; the ₹ effect compares sales over the same months).
function patternTurnover(ctx) {
  const act = computeActivity(ctx.inputs, ctx.points, ctx.today);
  if (act.lastYear.points < 12 || act.thisYear.turnover === null || act.lastYear.turnover === null) return [];
  const upTo = ctx.today.slice(5, 7);
  const sameSpan = act.months.filter(m => m.month.slice(0, 4) === String(act.lastYear.year) && m.month.slice(5, 7) <= upTo)
    .reduce((x, m) => x + m.sold, 0);
  if (!act.thisYear.sold && !sameSpan) return [];
  return [patternCard({
    id: 'turnover', scope: 'fund', tone: 'neutral',
    headline: `Turnover ${(act.thisYear.turnover * 100).toFixed(1)}% so far in ${act.thisYear.year} vs ${(act.lastYear.turnover * 100).toFixed(1)}% in all of ${act.lastYear.year}`,
    facts: [`sold so far: ${fmtRupees(act.thisYear.sold)} vs ${fmtRupees(sameSpan)} over the same months of ${act.lastYear.year}`,
            `bought so far: ${fmtRupees(act.thisYear.bought)}`],
    spark: { kind: 'bars', signed: false, values: act.months.filter(m => m.month.slice(0, 4) === String(act.thisYear.year)).map(m => m.sold) },
    from: `${act.thisYear.year}-01-01`, to: ctx.today,
    impact: act.thisYear.sold - sameSpan, unusual: sameSpan > 0 ? act.thisYear.sold / sameSpan / 2 : 0, value: act.thisYear.turnover,
  })];
}

// Every detector, ranked: |₹ impact| first, then how unusual. Each card gets key = id|holding.
//   ctx: { points, names, sleeves: [{ key, label, points }], series, navs (fund's Nifty 50), inputs,
//          rows (computePositionPnL), picks (computeStockPicks), today }
function computePatternFeed(ctx) {
  if (!ctx.points.length) return [];
  const subjects = patternSubjects(ctx);
  const cards = [].concat(
    patternStreaks(ctx, subjects), patternMomentum(ctx, subjects), patternStagnation(ctx, subjects),
    patternDrawdown(ctx, subjects), patternGainSource(ctx), patternMarketVsMe(ctx), patternDrift(ctx),
    patternBuyTiming(ctx), patternDispersion(ctx, subjects), patternVolRegime(ctx, subjects), patternHedge(ctx),
    patternUsFx(ctx), patternPicks(ctx), patternClosed(ctx), patternTax(ctx), patternTurnover(ctx));
  cards.forEach(c => { c.key = c.id + '|' + c.holding; });
  const seen = new Set();
  return cards.sort((a, b) => (Math.abs(b.impact) - Math.abs(a.impact)) || (b.unusual - a.unusual))
    .filter(c => !seen.has(c.key) && seen.add(c.key));                // one card per pattern and holding
}

// When each active pattern started (the run of consecutive earlier months it was in the feed) and
// the patterns in last month's feed that are gone now. history: pattern_history rows.
// Without a saved feed for last month nothing can be said about either: since is null, ended [].
function computePatternHistory(cards, history, month) {
  const byMonth = {};
  (history || []).forEach(r => {
    const m = String(r.month).slice(0, 7);
    (byMonth[m] = byMonth[m] || {})[String(r.pattern_id) + '|' + String(r.holding || '')] = r;
  });
  if (!byMonth[monthShift(month, -1)]) return { since: null, ended: [], lastMonth: monthShift(month, -1) };
  const since = {};
  cards.forEach(c => {
    let m = month, start = month;
    for (;;) {
      m = monthShift(m, -1);
      if (!byMonth[m] || !byMonth[m][c.key]) break;
      start = m;
    }
    since[c.key] = start;
  });
  const last = byMonth[monthShift(month, -1)] || {};
  const live = new Set(cards.map(c => c.key));
  const ended = Object.keys(last).filter(k => !live.has(k)).map(k => ({ key: k, headline: String(last[k].headline || '') }));
  return { since, ended, lastMonth: monthShift(month, -1) };
}


// ── Trends ────────────────────────────────────────────────────────────────────

const TREND_WINDOWS = [
  { key: 'm6', label: '6M', months: 6 },
  { key: 'y1', label: '1Y', months: 12 },
  { key: 'y3', label: '3Y p.a.', months: 36, annualise: true },
];

// A track's return over the latest `months` months next to a benchmark's (navs over the same
// points), gated on the track's consecutive points.  → { need } | { ret, bench, gap }
function computeTrackWindow(t, navs, months, annualise = false) {
  const n = t.idx.length - 1;
  if (n < months) return { need: months + 1 - t.idx.length };
  const ann = x => (x === null || !annualise ? x : Math.pow(1 + x, 12 / months) - 1);
  const ret = ann(t.idx[n] / t.idx[n - months] - 1);
  const bench = navs ? ann(benchReturn(navs, n - months, n)) : null;
  return { ret, bench, gap: bench === null ? null : (ret - bench) * 100 };
}

// Every current holding (and the fund vs Nifty 50) against its own benchmark: 6M / 1Y / 3Y, the
// months since its high and the range since, the stagnation rules for its asset type, and its index
// with the benchmark's (rebased to it) over up to the latest 37 points. Estimated holdings are not
// compared with a benchmark (their history is built from it).
function computeTrends(ctx) {
  const rows = [];
  const fund = computeSeriesTrack(ctx.points);
  if (fund) {
    const navs = computeBenchNavs(ctx.series, FUND_HEADLINE_BENCH, fund.pts);
    rows.push(Object.assign(computeTrendRow(fund, navs, 'Fund', FUND_HEADLINE_BENCH, fund.value), { scope: 'fund', stag: null }));
  }
  const L = ctx.points[ctx.points.length - 1];
  Object.keys(L ? L.cells : {}).forEach(k => {
    const t = computeHoldingTrack(ctx.points, Number(k));
    if (!t || t.idx.length < 2) return;
    const name = ctx.names[k] || 'Asset ' + k;
    const code = benchmarkFor(t.cat, name);
    const navs = code && !t.est ? computeBenchNavs(ctx.series, code, t.pts) : null;
    rows.push(Object.assign(computeTrendRow(t, navs, name, code, t.value), { scope: 'holding', cat: t.cat, est: t.est,
                                                                           stag: computeStagnation(t, name, ctx.series) }));
  });
  return rows.sort((a, b) => (a.scope === 'fund' ? -1 : 0) - (b.scope === 'fund' ? -1 : 0) || b.value - a.value);
}

function computeTrendRow(t, navs, name, code, value) {
  const n = t.idx.length - 1, s = Math.max(0, n - 36);
  const b0 = navs ? navs.findIndex((v, i) => i >= s && v > 0) : -1;
  const sh = computeSinceHigh(t.idx);
  return {
    name, code, benchLabel: code ? (BENCHMARKS[code] || {}).label || code : '', value,
    from: t.pts[s].d, to: t.pts[n].d, points: t.idx.length,
    windows: TREND_WINDOWS.map(w => Object.assign({ key: w.key, label: w.label }, computeTrackWindow(t, navs, w.months, !!w.annualise))),
    sinceHigh: sh.months, highD: t.pts[sh.hi].d, fromHigh: sh.now, lowSinceHigh: sh.low,
    line: t.idx.slice(s).map(v => v / t.idx[s] * 100),
    benchLine: b0 >= 0 ? navs.slice(s).map((v, i) => (i + s >= b0 && v > 0 ? v / navs[b0] * t.idx[b0] / t.idx[s] * 100 : null)) : null,
  };
}


// ── Tax ───────────────────────────────────────────────────────────────────────
// Capital-gains tax of a resident individual on sales from 23 Jul 2024 (Finance (No. 2) Act 2024,
// rates unchanged by the Finance Act 2026; Income-tax Act 2025 s.196 / 197 / 198 = old s.111A /
// 112 / 112A). Sources: incometaxindia.gov.in "Tax on long-term capital gains", "Tax on short-term
// capital gains", "Taxation of Virtual Digital Asset (VDA)".
//   lt / st: the rate, or 'slab' = added to income and taxed at the slab rate (no ₹ estimate here).

const TAX_CESS = 0.04;                      // health & education cess, on the tax
const TAX_EQUITY_EXEMPT = 125000;           // a year: long-term gains of listed shares and equity funds together
const TAX_DEBT_SLAB_FROM = '2023-04-01';    // debt-fund units bought from this day are short-term at any age
const TAX_RULES = {
  equity: { label: 'Listed shares & equity funds', ltMonths: 12, lt: 0.125, st: 0.20 },
  etf:    { label: 'Gold & silver ETFs', ltMonths: 12, lt: 0.125, st: 'slab' },
  other:  { label: 'Other assets', ltMonths: 24, lt: 0.125, st: 'slab' },
  debt:   { label: 'Debt funds bought from 1 Apr 2023', ltMonths: null, lt: 'slab', st: 'slab' },
  crypto: { label: 'Crypto (virtual digital assets)', ltMonths: null, flat: 0.30 },
};

// The rule for units of a holding bought on buyD. Arbitrage funds (subcategory 503) are
// equity-oriented funds for tax; debt-fund units bought before 1 Apr 2023 follow the 24-month rule.
function taxRuleOf(pos, buyD) {
  const cat = Number(pos.cat);
  if (cat === 1 || cat === 2 || Number(pos.sub) === 503) return 'equity';
  if (cat === 9) return 'crypto';
  if (cat === 5) return buyD >= TAX_DEBT_SLAB_FROM ? 'debt' : 'other';
  if (cat === 8 && Number(pos.sub) === 801) return 'etf';
  return 'other';                                                      // US shares, physical metal, land
}

// First day a unit bought on buyD has been held for more than `months` months.
function taxLongTermFrom(buyD, months) {
  const m = monthShift(buyD.slice(0, 7), months);
  const last = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
  const day = Math.min(Number(buyD.slice(8, 10)), last);
  return isoShiftDays(`${m}-${String(day).padStart(2, '0')}`, 1);
}

// 1 April of the financial year that today falls in.
function taxFyStart(today) {
  const y = Number(today.slice(0, 4));
  return `${Number(today.slice(5, 7)) >= 4 ? y : y - 1}-04-01`;
}

// One year's gains by how they are taxed (losses negative): equity short / long term, other
// long-term at 12.5%, everything at the slab rate, crypto (gains only — its losses never count).
function taxBucket() {
  return { eqST: 0, eqLT: 0, ltOther: 0, slab: 0, crypto: 0 };
}

function taxAdd(b, rule, longTerm, gain) {
  if (rule === 'crypto') b.crypto += Math.max(gain, 0);
  else if (rule === 'equity') b[longTerm ? 'eqLT' : 'eqST'] += gain;
  else if (longTerm && TAX_RULES[rule].lt !== 'slab') b.ltOther += gain;
  else b.slab += gain;
}

// Tax on one year's gains. Losses are set off as the law allows — a short-term loss against any
// gain, a long-term loss only against long-term gains — taking the highest-taxed gains first (the
// slab rate taken as at least 20%); then the ₹1.25 lakh equity exemption, then 4% cess.
//   → { lines: [{ key, label, gain, rate, exempt, tax }], tax (incl. cess), cess, slabGain, lossLeft }
function computeTaxBill(b) {
  const g = { slab: Math.max(b.slab, 0), eqST: Math.max(b.eqST, 0), ltOther: Math.max(b.ltOther, 0), eqLT: Math.max(b.eqLT, 0) };
  let ltLoss = -Math.min(b.ltOther, 0) - Math.min(b.eqLT, 0);
  let stLoss = -Math.min(b.slab, 0) - Math.min(b.eqST, 0);
  const setOff = (key, loss) => { const x = Math.min(g[key], loss); g[key] -= x; return loss - x; };
  ['ltOther', 'eqLT'].forEach(k => { ltLoss = setOff(k, ltLoss); });
  ['slab', 'eqST', 'ltOther', 'eqLT'].forEach(k => { stLoss = setOff(k, stLoss); });
  const exempt = Math.min(g.eqLT, TAX_EQUITY_EXEMPT);
  const lines = [
    { key: 'eqST', label: 'Shares & equity funds · short-term', gain: g.eqST, rate: TAX_RULES.equity.st, exempt: 0 },
    { key: 'eqLT', label: 'Shares & equity funds · long-term', gain: g.eqLT, rate: TAX_RULES.equity.lt, exempt },
    { key: 'ltOther', label: 'Other assets · long-term', gain: g.ltOther, rate: TAX_RULES.other.lt, exempt: 0 },
    { key: 'crypto', label: 'Crypto', gain: b.crypto, rate: TAX_RULES.crypto.flat, exempt: 0 },
    { key: 'slab', label: 'Added to income (slab rate)', gain: g.slab, rate: 'slab', exempt: 0 },
  ];
  lines.forEach(l => { l.tax = l.rate === 'slab' ? null : (l.gain - l.exempt) * l.rate; });
  const before = lines.reduce((x, l) => x + (l.tax || 0), 0);
  return { lines, cess: before * TAX_CESS, tax: before * (1 + TAX_CESS), slabGain: g.slab, lossLeft: ltLoss + stLoss };
}

// Capital-gains estimate from FIFO lots (oldest units sold first, as the law reads).
//   inputs: normalised holdings (buildPositionInputs) with cat and sub (subcategory id)
//   → { fyStart, rows: per holding, booked: tax bill of gains realized this financial year,
//       ifSold: tax bill if everything held were also sold today (booked + held), unpriced: names,
//       locked: ELSS lots still in their 3-year lock-in — [{ name, value, gain, first, until }] (free dates) }
// Each crypto sale is taxed on its own (its loss counts for nothing); unrealized, per holding.
// Locked ELSS units cannot be sold, so they stay out of "if all sold".
function computeTaxEstimate(inputs, today) {
  const fyStart = taxFyStart(today);
  const booked = taxBucket(), held = taxBucket();
  const rows = [], unpriced = [], locked = [];
  inputs.forEach(pos => {
    const lots = computeFifoLots(pos);
    const soldNow = lots.sold.filter(l => l.sellD >= fyStart && l.sellD <= today);
    const isCrypto = taxRuleOf(pos, today) === 'crypto';
    // The row's rule from the lots it reports (a debt fund's units can sit on both sides of 1 Apr 2023).
    const rules = new Set(lots.open.map(l => taxRuleOf(pos, l.d)).concat(soldNow.map(l => taxRuleOf(pos, l.buyD))));
    let rule = taxRuleOf(pos, today);
    if (rules.size === 1) rule = [...rules][0];
    else if (rules.size > 1) rule = 'debtMixed';
    const row = { key: pos.key, name: pos.name, cat: pos.cat, account: pos.account, rule, gain: 0, lt: isCrypto ? null : 0,
                  booked: 0, nextLT: null, open: lots.open.length > 0, unpriced: false, locked: false };
    const cryptoSales = {};
    soldNow.forEach(l => {
      const r = taxRuleOf(pos, l.buyD);
      row.booked += l.gain;
      if (r === 'crypto') { cryptoSales[l.tx] = (cryptoSales[l.tx] || 0) + l.gain; return; }
      const months = TAX_RULES[r].ltMonths;
      taxAdd(booked, r, months !== null && l.sellD >= taxLongTermFrom(l.buyD, months), l.gain);
    });
    Object.values(cryptoSales).forEach(gn => taxAdd(booked, 'crypto', false, gn));
    if (row.open && !(pos.price > 0)) { row.unpriced = true; unpriced.push(pos.name); }
    if (row.open && pos.price > 0) {
      let cryptoGain = 0;
      const lock = { value: 0, gain: 0, first: '', until: '' };
      lots.open.forEach(l => {
        const gn = l.qty * pos.price - l.cost;
        const r = taxRuleOf(pos, l.d);
        row.gain += gn;
        if (r === 'crypto') { cryptoGain += gn; return; }
        const months = TAX_RULES[r].ltMonths;
        const from = months === null ? null : taxLongTermFrom(l.d, months);
        const longTerm = from !== null && today >= from;
        if (longTerm) row.lt += gn;
        else if (from && (!row.nextLT || from < row.nextLT.d)) row.nextLT = { d: from, gain: gn };
        const free = taxElssFreeFrom(pos, l.d);
        if (free && today < free) {                                    // in its lock-in: cannot be sold yet
          lock.value += l.qty * pos.price; lock.gain += gn;
          if (free > lock.until) lock.until = free;
          if (!lock.first || free < lock.first) lock.first = free;
          return;
        }
        taxAdd(held, r, longTerm, gn);
      });
      if (isCrypto) taxAdd(held, 'crypto', false, cryptoGain);
      if (lock.until) {
        row.locked = true;
        locked.push({ name: pos.name, value: lock.value, gain: lock.gain, first: lock.first, until: lock.until });
      }
    }
    if (row.open || soldNow.length) rows.push(row);
  });
  const both = taxBucket();
  Object.keys(both).forEach(k => { both[k] = booked[k] + held[k]; });
  rows.sort((a, b) => Math.abs(b.gain) + Math.abs(b.booked) - Math.abs(a.gain) - Math.abs(a.booked));
  return { fyStart, rows, booked: computeTaxBill(booked), ifSold: computeTaxBill(both), unpriced, locked };
}

// ₹ per $ for a US sale on day d, the way the tax rule reads it (Rule 115: the rate on the last day
// of the month before the sale) from the usd_inr benchmark series ([{ d, v }], sorted); the sale
// day's rate when that month-end is missing; none when neither is within FUND_BENCH_STALE_DAYS.
//   → { v, on: 'monthEnd' | 'saleDay' | '' }
function taxUsdInrOn(list, d) {
  const at = day => {
    let hit = null;
    (list || []).forEach(x => { if (x.d <= day) hit = x; });
    return hit && daysApart(hit.d, day) <= FUND_BENCH_STALE_DAYS ? hit.v : 0;
  };
  const m = monthShift(d.slice(0, 7), -1);
  const monthEnd = `${m}-${String(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate()).padStart(2, '0')}`;
  const v = at(monthEnd);
  if (v) return { v, on: 'monthEnd' };
  const day = at(d);
  return { v: day, on: day ? 'saleDay' : '' };
}

// ELSS (subcategory 105) units can be sold only 3 years after they were bought: the first free
// day, or '' for anything else.
function taxElssFreeFrom(pos, buyD) {
  if (Number(pos.sub) !== 105) return '';
  const m = monthShift(buyD.slice(0, 7), 36);
  const last = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
  return `${m}-${String(Math.min(Number(buyD.slice(8, 10)), last)).padStart(2, '0')}`;
}


// ── Factsheet model ───────────────────────────────────────────────────────────

// Everything the Factsheet shows, from snapshotData + benchmark_prices rows.
function computeFactsheet(snap, benchRows, benchCode = FUND_HEADLINE_BENCH) {
  const points = computeFundSeries(snap);
  const navs = computeBenchNavs(computeBenchSeries(benchRows), benchCode, points);
  const names = ((snap && snap.assets) || []).map(a => a.n);
  const sleeves = SLEEVES.map(s => ({ key: s.key, label: s.label, points: computeFundSeries(snap, s.cats) }));
  const benchLabel = (BENCHMARKS[benchCode] || {}).label || benchCode;
  return {
    points,
    navs,
    benchLabel,
    benchFrom: (points.find((p, i) => navs[i] > 0) || {}).d || '',
    headline: computeHeadline(points, navs),
    calendar: computeCalendarYears(points, navs),
    rolling: computeRolling1Y(points, navs),
    vol: computeVolatility(points, navs),
    dd: computeDrawdown(points, points.map(p => p.idx)),
    ddBench: computeDrawdown(points, navs),
    contrib: computeContributions(points),
    atCost: points.reduce((s, p) => s + p.atCost, 0),
    note: computeManagerNote(points, navs, names, sleeves, benchLabel),
  };
}


// ── Monthly manager's note ────────────────────────────────────────────────────

// '+', '−' or '' for a number as it will be shown (a value that rounds to zero gets no sign).
function fmtSign(shown) {
  if (shown > 0) return '+';
  if (shown < 0) return '−';
  return '';
}

function fmtPct(r, digits = 1) {
  if (r === null || r === undefined || !isFinite(r)) return '—';
  const shown = Number((r * 100).toFixed(digits));
  return fmtSign(shown) + Math.abs(shown).toFixed(digits) + '%';
}

function fmtPts(g) {
  if (g === null || g === undefined || !isFinite(g)) return '—';
  const shown = Number(g.toFixed(1));
  return fmtSign(shown) + Math.abs(shown).toFixed(1) + ' pts';
}

function fmtRupees(v, signed = false) {
  const n = Math.round(parseFloat(v || 0));
  return (signed ? fmtSign(n) : '') + '₹' + Math.abs(n).toLocaleString('en-IN');
}

function fmtDay(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

function fmtMonths(n) {
  return `${n} month${n === 1 ? '' : 's'}`;
}

// The month's market gains / losses by holding, largest first: up to two gains and one loss.
function buildMoversLine(p, names, since) {
  const moves = p.moves.slice().sort((x, y) => y.move - x.move);
  const ups = moves.filter(m => m.move >= 1).slice(0, 2);
  const down = moves.filter(m => m.move <= -1).slice(-1);
  const part = m => `${names[m.ai] || 'Asset ' + m.ai} (${fmtRupees(m.move, true)})`;
  const bits = [];
  if (ups.length) bits.push(`largest market gain${ups.length > 1 ? 's' : ''}${since}: ${ups.map(part).join(', ')}`);
  if (down.length) bits.push(`largest market loss: ${part(down[0])}`);
  return bits.length ? bits.join('; ').replace(/^./, c => c.toUpperCase()) + '.' : '';
}

// 4–6 factual sentences on the latest month: value change, money in vs market, the month's return
// vs the benchmark, the largest moves, each sleeve's month, and the distance from the high. When
// the previous snapshot is not the month before, no "for the month" return is given (1M gate).
//   names: asset index → name; sleeves: [{ label, points }] (computeFundSeries per sleeve)
function computeManagerNote(points, navs, names, sleeves = [], benchLabel = 'Nifty 50') {
  const L = points.length - 1;
  if (L < 1) return null;
  const p = points[L], prev = points[L - 1];
  const oneMonth = computeRunLength(points, L) >= FUND_GATES.m1;
  const lines = [];
  const change = p.value - prev.value;
  const changePct = prev.value > 0 ? ` (${fmtPct(change / prev.value)})` : '';
  const direction = change >= 0 ? 'up' : 'down';
  lines.push(`Fund value ${fmtRupees(p.value)} as of ${fmtDay(p.d)}, ${direction} ${fmtRupees(change)}${changePct} from ${fmtDay(prev.d)}.`);
  const reval = Math.round(p.reval) ? `; revaluation of holdings without a market price ${fmtRupees(p.reval, true)}` : '';
  lines.push(`Net new money ${fmtRupees(p.flow, true)}; market move ${fmtRupees(p.move, true)}${reval}.`);
  if (oneMonth) {
    const b = benchReturn(navs, L - 1, L);
    const vs = b === null ? '' : ` vs ${benchLabel} ${fmtPct(b)} (${fmtPts((p.ret - b) * 100)})`;
    lines.push(`Time-weighted return for the month: ${fmtPct(p.ret)}${vs}.`);
  } else {
    lines.push(`No snapshot between ${fmtDay(prev.d)} and ${fmtDay(p.d)}: the change covers ` +
      `${fmtMonths(monthsApart(prev.month, p.month))}, so there is no one-month return.`);
  }
  const movers = buildMoversLine(p, names, oneMonth ? '' : ` since ${fmtDay(prev.d)}`);
  if (movers) lines.push(movers);

  if (oneMonth) {
    const bySleeve = sleeves.map(s => {
      const qi = s.points.findIndex(x => x.month === p.month);
      const q = s.points[qi], before = s.points[qi - 1];
      if (!q || !before || before.month !== prev.month || (q.value <= 0 && before.value <= 0)) return '';
      return `${s.label} ${fmtPct(q.ret)}`;
    }).filter(Boolean);
    if (bySleeve.length > 1) lines.push(`By sleeve: ${bySleeve.join(', ')}.`);
  }

  const dd = computeDrawdown(points, points.map(x => x.idx));
  if (!dd.need) {
    const below = (Math.abs(dd.current) * 100).toFixed(1);
    lines.push(Number(below) > 0
      ? `The fund index is ${below}% below its high of ${fmtDay(dd.highD)} (${fmtMonths(dd.sinceHigh)} ago).`
      : 'The fund index is at its high.');
  }
  return { month: p.month, d: p.d, lines };
}
