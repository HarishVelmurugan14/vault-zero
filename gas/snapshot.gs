/**
 * VaultZero — monthly snapshots: a frozen month-by-month history of invested vs current value.
 *
 * SETUP (once, in the VaultZero Apps Script project — schema.gs and Code.gs must be there too):
 *   1. Paste snapshot.gs + the updated schema.gs and Code.gs.
 *   2. Run setupSnapshots() from the editor and accept the permissions (external requests for prices).
 *   3. Run backfillSnapshots() — repeat until it reports "complete" (it pauses before the 6-min limit).
 *   4. Run backfillBenchmarks() once (re-runnable: it only fills what is missing).
 *   5. Deploy → Manage deployments → New version (the app's snapshot endpoints live in Code.gs).
 *
 * EVERY MONTH — no automation: in the app, Insights → Factsheet → "Take snapshot", ANY day of the
 * month. It asks for the manual prices (land, physical gold), saves them, and records THIS month
 * as of that day. Taking it again later in the month replaces it with that day's data. Once the
 * next month starts the month is locked; a month you never took stays a gap.
 *
 *   setupSnapshots()       tabs (incl. epf_transactions), isin + amfi_code on the fund tabs; removes
 *                          the old daily trigger if one exists.
 *   backfillSnapshots()    history: every month from the first transaction up to the month before
 *                          the one it first completes in, each as of its LAST day. Re-running it
 *                          rebuilds those history months (e.g. after importing EPF) — never a month
 *                          you took in the app, never a later month (a skipped month stays a gap).
 *   backfillBenchmarks()   benchmark_prices: each benchmark series (VZS_BENCHMARKS) at every month-end
 *                          from the first transaction month, at every snapshot's as-of day and on every
 *                          fund transaction day. Each Take snapshot also records that day's values and
 *                          any transaction day of the last two months still missing (a failure only warns).
 *   manager_notes          the Factsheet's monthly note, written by the app right after each Take
 *                          snapshot (doPost saveManagerNote → vzsSaveNote_); a locked month's note
 *                          is never rewritten.
 *   pattern_history        that month's "What's happening" feed (one row per pattern), written the
 *                          same way (doPost savePatternHistory → vzsSavePatterns_).
 *
 * What a month means — a frozen fact as of the END of its as-of day (the day you took it):
 *   holdings = transactions dated on or before that day (a later sell never changes it)
 *   invested = remaining units × average buy cost (same method as the Holdings screen)
 *   value    = units × price. A month TAKEN IN THE APP uses the sheet's live GOOGLEFINANCE prices
 *              (current_nav / current_price, already INR; USD→INR implied by the US rows) — a 0 /
 *              #N/A price is valued at cost and noted. HISTORY months (backfill) use the official
 *              price on or before their last day: mutual funds → AMFI NAV (mfapi.in); NSE stocks /
 *              ETFs, US ETFs, crypto, USD→INR → Yahoo Finance daily closes in each market's own
 *              timezone (split adjustment undone so they match your units). Physical gold /
 *              silver and real estate (no market price) → ESTIMATED from your recorded prices —
 *              your manual_prices log plus what you paid on each buy: land in a straight line
 *              between them, a metal along GOLDBEES / SILVERBEES bent to land on each one (and on
 *              that ETF after the last); price_source 'estimate', price_date = the as-of day.
 *              These use prices recorded AFTER the month too, so a re-run of backfillSnapshots()
 *              after a new price or buy can change the history months it touches. An asset you
 *              have never priced stays on the old rule (no price → at cost).
 *   EPF      = its passbook entries (epf_transactions) dated on or before that day: invested =
 *              contributions − withdrawals (≥ 0), value = contributions + interest − withdrawals
 *              (interest is credited once a year). An account with no entries yet counts at its
 *              typed balance in a month you take (history has no such reading).
 *   Bank balances are not part of snapshots.
 * Every line records the date of the price it used; a manual price from before the previous month
 * is noted as "old". Asset names are copied into every line and lines carry no foreign key to the
 * asset tabs, so later sells, edits or deletions never change a month. The tabs are SERVER-ONLY
 * (schema.gs). A price that does not exist (e.g. land you have never priced) is valued at cost
 * (price_source 'cost'). A price that FAILED to download writes nothing. Writes are
 * commit-ordered: new lines first, then the month's header row (the commit marker), then the
 * replaced month's old lines are removed.
 */

// ── Config ───────────────────────────────────────────────────────────────────

const VZS_SNAPSHOTS = 'snapshots';
const VZS_LINES = 'snapshot_lines';
const VZS_SNAPSHOT_HEADERS = ['id', 'month', 'snapshot_date', 'source', 'lines', 'invested_total', 'current_total', 'notes', 'created_at'];
const VZS_LINE_HEADERS = ['id', 'snapshot_id', 'snapshot_date', 'account_id', 'bucket_id', 'category_id', 'subcategory_id',
  'asset_table', 'asset_id', 'asset_name', 'units', 'invested_value', 'price', 'current_value', 'price_source', 'price_date', 'created_at'];
const VZS_TEXT_COLS = ['month', 'snapshot_date', 'price_date', 'date', 'fx_date'];   // stored as text so Sheets never turns them into dates
const VZS_TIME_BUDGET_MS = 4.5 * 60 * 1000;   // stay well inside Apps Script's 6-minute limit
const VZS_RETRY_WAITS_MS = [2000, 5000, 15000];
const VZS_FETCH_BATCH = 10;                     // parallel downloads per UrlFetchApp.fetchAll
const VZS_LOOKBACK_DAYS = 400;                  // Yahoo history before the earliest date (covers long trading halts)
const VZS_NAVALL_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const VZS_HISTORY_UNTIL = 'vzs_history_until'; // Script Property: last month (yyyy-mm) backfillSnapshots() covers
const VZS_EPF_TXNS_HEADERS = ['id', 'account_id', 'txn_type', 'txn_date', 'amount', 'notes', 'created_at'];
// History months between your recorded prices of a physical metal follow this NSE ETF (domestic
// price incl. import duty), bent to pass through every price you recorded (see vzsEstimate_).
const VZS_METAL_PROXY = { Gold: 'GOLDBEES.NS', Silver: 'SILVERBEES.NS' };
const VZS_BENCH = 'benchmark_prices';
const VZS_BENCH_HEADERS = ['id', 'date', 'code', 'nav', 'source', 'price_date', 'fx_date', 'created_at'];
const VZS_BENCH_TAKE_BUDGET_MS = 20000;         // what Take snapshot may spend on benchmarks (failures only warn)
const VZS_FUND_CATS = [1, 2, 3, 8, 9];         // FUND_SCOPE (js/data.js): benchmarks are kept on these transaction days
const VZS_NOTES = 'manager_notes';
const VZS_NOTES_HEADERS = ['id', 'month', 'account', 'note', 'created_at', 'updated_at'];
const VZS_PATTERNS = 'pattern_history';
const VZS_PATTERN_HEADERS = ['id', 'month', 'account', 'pattern_id', 'holding', 'headline', 'value', 'created_at'];

// Benchmark series for Insights (key = benchmark_prices.code = BENCHMARKS in js/data.js). Every
// series is TOTAL RETURN in INR: an index-fund / ETF / FoF NAV from AMFI (mfapi.in; unit splits
// undone), or a Yahoo close adjusted for dividends and splits × USD→INR (fx). Values are chained
// onto what is already stored — at the exact source prices that row used — so Yahoo's rescaling
// or a later change of source continues the series without a jump (an AMFI series stays equal
// to its NAVs). level: a rate kept as-is (never chained). A series with no code is skipped.
const VZS_BENCHMARKS = [
  { key: 'nifty50',        src: 'amfi',  code: '120716' },      // UTI Nifty 50 Index Fund – Direct Growth
  { key: 'nifty100',       src: 'amfi',  code: '147666' },      // Axis Nifty 100 Index Fund – Direct Growth
  { key: 'nifty500',       src: 'amfi',  code: '147625' },      // Motilal Oswal Nifty 500 Index Fund – Direct Growth
  { key: 'largemidcap250', src: 'amfi',  code: '149343' },      // Edelweiss Nifty Large Mid Cap 250 Index Fund – Direct Growth
  { key: 'midcap150',      src: 'amfi',  code: '147622' },      // Motilal Oswal Nifty Midcap 150 Index Fund – Direct Growth
  { key: 'smallcap250',    src: 'amfi',  code: '147623' },      // Motilal Oswal Nifty Smallcap 250 Index Fund – Direct Growth
  { key: 'gold',           src: 'amfi',  code: '118663' },      // Nippon India Gold Savings Fund (FoF) – Direct Growth
  { key: 'silver',         src: 'amfi',  code: '149758' },      // Nippon India Silver ETF
  { key: 'voo',            src: 'yahoo', code: 'VOO', fx: true },
  { key: 'qqqm',           src: 'yahoo', code: 'QQQM', fx: true },
  { key: 'btc',            src: 'yahoo', code: 'BTC-USD', fx: true },
  { key: 'usd_inr',        src: 'yahoo', code: 'INR=X', level: true },
];

// One entry per asset stream — mirrors the valuation in js/holdings.js.
const VZS_STREAMS = [
  { cat: 1, assets: 'equity_funds', txns: 'equity_transactions', fk: 'fund_id', name: 'fund_name',
    amountCol: 'amount', hist: 'amfi', live: 'current_nav' },
  { cat: 5, assets: 'debt_hybrid_funds', txns: 'debt_hybrid_transactions', fk: 'fund_id', name: 'fund_name',
    amountCol: 'amount', hist: 'amfi', live: 'current_nav' },
  { cat: 2, assets: 'indian_equity_stocks_assets', txns: 'indian_equity_stocks_transactions', fk: 'asset_id', name: 'company_name',
    amountCol: 'amount', hist: 'yahoo', live: 'current_price', symbol: a => String(a.ticker || '').trim() + '.NS' },
  { cat: 3, assets: 'us_equity_assets', txns: 'us_equity_transactions', fk: 'asset_id', name: 'name', usEquity: true,
    hist: 'yahoo', live: 'current_price', symbol: a => String(a.ticker || '').trim().replace(/\./g, '-'), usd: true },
  { cat: 4, assets: 'real_estate_assets', txns: 'real_estate_transactions', fk: 'asset_id', name: 'name',
    amountCol: null, manual: 'real_estate' },
  { cat: 6, assets: 'epf_assets', txns: 'epf_transactions', fk: 'account_id', name: 'account_name', ledger: true },   // entries → the account's one EPF
  { cat: 8, assets: 'precious_metal_etf_assets', txns: 'precious_metal_etf_transactions', fk: 'asset_id', name: 'name',
    amountCol: 'amount', hist: 'yahoo', live: 'current_price', symbol: a => String(a.code || '').trim() + '.NS' },
  { cat: 8, assets: 'precious_metal_physical_assets', txns: 'precious_metal_physical_transactions', fk: 'asset_id', name: 'name',
    amountCol: 'amount', manual: 'physical_precious_metal' },
  { cat: 9, assets: 'crypto_assets', txns: 'crypto_transactions', fk: 'asset_id', name: 'name',
    amountCol: 'amount_inr', hist: 'yahoo', live: 'current_price', symbol: a => String(a.ticker || '').trim().replace(/USD$/, '-USD'), usd: true },
];
// live: the sheet column (GOOGLEFINANCE, already in INR) a snapshot TAKEN IN THE APP is valued at.
// History months (backfill) use the official histories instead: mfapi NAVs and Yahoo closes.

// Fund → [ISIN, AMFI scheme code, name check]. Verified Nov 2026 against every NAV recorded on
// your own transactions (mfapi.in history). setupSnapshots() writes these into the fund tabs; funds
// added later only need an ISIN — the AMFI code is resolved automatically from AMFI's NAV list.
const VZS_FUND_ISINS = {
  'equity_funds|1':        ['INF966L01986', '120847', 'Quant ELSS Tax Saver Growth Option Direc'],
  'equity_funds|2':        ['INF200K01UM9', '119723', 'SBI ELSS Tax Saver Fund Direct Growth'],
  'equity_funds|3':        ['INF740K01OK1', '119242', 'DSP ELSS Tax Saver Fund Direct Plan Grow'],
  'equity_funds|4':        ['INF179K01XQ0', '118989', 'HDFC Mid Cap Fund -Direct Plan - Growth '],
  'equity_funds|5':        ['INF277K011O1', '145206', 'Tata Small Cap Fund Direct Growth'],
  'equity_funds|6':        ['INF109K016L0', '120586', 'ICICI Prudential Large Cap Fund Direct P'],
  'equity_funds|7':        ['INF109KC12U0', '152482', 'ICICI Prudential Nifty LargeMidcap 250 I'],
  'equity_funds|8':        ['INF879O01027', '122639', 'Parag Parikh Flexi Cap Direct Growth'],
  'equity_funds|9':        ['INF179K01UT0', '118955', 'HDFC Flexi Cap Fund -Direct Plan - Growt'],
  'equity_funds|10':       ['INF843K01AO4', '140228', 'Edelweiss Mid Cap Fund Direct Plan Growt'],
  'equity_funds|11':       ['INF959L01FP2', '149039', 'Navi Nifty 50 Index Fund Direct Growth'],
  'equity_funds|12':       ['INF204K01K15', '118778', 'Nippon India Small Cap Fund Direct Plan '],
  'equity_funds|13':       ['INF247L01445', '127042', 'Motilal Oswal Midcap Fund Direct Plan Gr'],
  'equity_funds|14':       ['INF966L01AT0', '150440', 'Quant Large Cap Fund Direct Plan Growth'],
  'equity_funds|15':       ['INF966L01689', '120828', 'Quant Small Cap Fund Direct Plan Growth'],
  'equity_funds|16':       ['INF109KC1FX1', '143903', 'ICICI Prudential Bharat 22 FOF Direct Pl'],
  'equity_funds|17':       ['INF174K01LT0', '119775', 'Kotak Emerging Equity Fund Direct Plan G'],
  'equity_funds|18':       ['INF204K01XI3', '118632', 'Nippon India Large Cap Fund Direct Plan '],
  'equity_funds|19':       ['INF789FC12T1', '143341', 'UTI Nifty Next 50 Index Fund Direct Plan'],
  'equity_funds|20':       ['INF277KA1BM1', '152588', 'Tata Nifty500 Multicap India Manufacturi'],
  'equity_funds|21':       ['INF179KC1GC8', '151724', 'HDFC Nifty Midcap 150 Index Fund Direct '],
  'debt_hybrid_funds|1':   ['INF109K01T04', '120676', 'ICICI Prudential Ultra Short Term Fund D'],
  'debt_hybrid_funds|2':   ['INF204K01YH3', '143494', 'Nippon India Ultra Short Duration Fund D'],
  'debt_hybrid_funds|3':   ['INF174K01LC6', '119771', 'Kotak Arbitrage Fund Direct Growth'],
  'debt_hybrid_funds|4':   ['INF109K016O4', '120364', 'ICICI Prudential Equity Arbitrage Fund D'],
  'debt_hybrid_funds|5':   ['INF109K01Q49', '120197', 'ICICI Prudential Liquid Fund  Direct Pla'],
  'debt_hybrid_funds|6':   ['INF846K01CX4', '120389', 'Axis Liquid Fund Direct Plan Growth Opti'],
  'debt_hybrid_funds|7':   ['INF205K01KR8', '120401', 'Invesco India Arbitrage Fund Direct Plan'],
};
// ── Entry points ─────────────────────────────────────────────────────────────

function setupSnapshots() {
  const ss = getSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const log = [];
  withWriteLock_(() => {
    [[VZS_SNAPSHOTS, VZS_SNAPSHOT_HEADERS], [VZS_LINES, VZS_LINE_HEADERS], ['epf_transactions', VZS_EPF_TXNS_HEADERS],
     [VZS_BENCH, VZS_BENCH_HEADERS], [VZS_NOTES, VZS_NOTES_HEADERS], [VZS_PATTERNS, VZS_PATTERN_HEADERS]].forEach(([name, headers]) => {
      let sh = ss.getSheetByName(name);
      if (!sh) { sh = ss.insertSheet(name); log.push('created tab ' + name); }
      if (sh.getLastRow() === 0) { sh.appendRow(headers); sh.setFrozenRows(1); log.push(name + ': header row added'); }
      headers.forEach(col => {                                           // tabs from an older version
        const have = vzsHeaders_(sh);
        if (have.indexOf(col) >= 0) return;
        sh.getRange(1, have.length + 1).setValue(col);
        log.push(name + ': added column ' + col);
      });
      const have = vzsHeaders_(sh);
      VZS_TEXT_COLS.forEach(col => {
        const c = have.indexOf(col) + 1;
        if (c > 0) sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@');
      });
    });
    ['equity_funds', 'debt_hybrid_funds'].forEach(t => {
      const sh = ss.getSheetByName(t);
      ['isin', 'amfi_code'].forEach(col => {
        const headers = vzsHeaders_(sh);
        if (headers.indexOf(col) >= 0) return;
        const after = headers.indexOf(col === 'isin' ? 'code' : 'isin');
        sh.insertColumnAfter(after + 1);
        sh.getRange(1, after + 2).setValue(col);
        sh.getRange(1, after + 2, sh.getMaxRows(), 1).setNumberFormat('@');
        log.push(t + ': added column ' + col);
      });
      const headers = vzsHeaders_(sh), n = sh.getLastRow() - 1;
      if (n < 1) return;
      const iId = headers.indexOf('id'), iName = headers.indexOf('fund_name');
      const iIsin = headers.indexOf('isin'), iAmfi = headers.indexOf('amfi_code');
      const data = sh.getRange(2, 1, n, headers.length).getValues();
      const isin = data.map(r => [r[iIsin]]), amfi = data.map(r => [r[iAmfi]]);
      let filled = 0;
      data.forEach((r, i) => {
        const m = VZS_FUND_ISINS[t + '|' + vzKey_(r[iId])];
        if (!m) return;
        if (String(r[iName]).slice(0, 12).toLowerCase() !== m[2].slice(0, 12).toLowerCase()) {
          log.push('SKIPPED ' + t + ' id ' + vzKey_(r[iId]) + ': name "' + r[iName] + '" does not match "' + m[2] + '"');
          return;
        }
        if (!isin[i][0]) { isin[i][0] = m[0]; filled++; }
        if (!amfi[i][0]) amfi[i][0] = m[1];
      });
      sh.getRange(2, iIsin + 1, n, 1).setValues(isin);                    // each column at its own index
      sh.getRange(2, iAmfi + 1, n, 1).setValues(amfi);
      log.push(t + ': ISIN / AMFI code filled for ' + filled + ' fund(s)');
    });
    SpreadsheetApp.flush();
  });

  ScriptApp.getProjectTriggers()                                       // snapshots are taken by hand now
    .filter(t => t.getHandlerFunction() === 'takeMonthlySnapshot')
    .forEach(t => { ScriptApp.deleteTrigger(t); log.push('removed the old daily snapshot trigger'); });
  log.push('monthly: take the snapshot in the app (Insights → Factsheet → Take snapshot), any day of the month');
  vzsNotify_('Snapshots set up', log);
}
// History (re-runnable): every month from the first transaction up to the month before the one
// it FIRST completes in, each as of its last day. Later runs rebuild exactly that range (e.g. after
// importing EPF) — never a month taken in the app, never anything after it.
function backfillSnapshots() {
  const ss = getSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const props = PropertiesService.getScriptProperties();
  const log = [];
  const data = vzsLoad_(ss);
  const first = vzsFirstTxnDate_(data);
  if (!first) { vzsNotify_('Backfill — no transactions yet', log); return; }
  // A month counts as history only once its last day has fully settled (US / crypto closes and
  // the NAV arrive overnight) — so a run in the small hours of the 1st stops one month earlier.
  const settled = new Date(vzsNow_().getTime() - 86400000);
  const until = props.getProperty(VZS_HISTORY_UNTIL) || vzsPrevMonth_(vzsThisMonth_(settled, tz));
  const existing = vzsExisting_(ss);
  const plan = [];
  for (let m = Utilities.formatDate(first, tz, 'yyyy-MM'); m <= until; m = vzsNextMonth_(m)) {
    const e = existing.byMonth[m];
    if (!e || e.source === 'backfill') plan.push({ month: m, date: vzsMonthEnd_(m) });   // taken months stay as taken
  }
  const res = vzsBuild_(ss, data, plan, 'backfill', existing, log);
  if (!res.problem && res.done) props.setProperty(VZS_HISTORY_UNTIL, until);
  vzsNotify_(res.problem ? 'Backfill stopped — ' + res.problem
           : res.done ? 'Backfill complete — history up to ' + until + ' (' + res.wrote + ' month(s) written)'
           : 'Backfill paused (time limit) — run backfillSnapshots() again', log);
}

// The app's "Take snapshot" (doPost action takeSnapshot), any day: logs the manual prices you
// entered or confirmed (dated today, so none counts as "old"), then records THIS month as of
// today at the sheet's live prices — replacing an earlier take this month. Past months are locked.
//   prices: [{ asset_type: 'real_estate' | 'physical_precious_metal', asset_id, price }]
function vzsTake_(prices) {
  const ss = getSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(vzsNow_(), tz, 'yyyy-MM-dd'), month = today.slice(0, 7);
  let data = vzsLoad_(ss);
  const held = {};
  vzsManualHeld_(data, today, tz).forEach(m => { held[m.asset_type + '|' + m.asset_id] = m; });
  const add = [];
  for (const p of (prices || [])) {
    const m = held[String(p.asset_type) + '|' + vzKey_(p.asset_id)];
    if (!m) return { error: 'not a manually priced holding today: ' + p.asset_type + ' #' + p.asset_id };
    const v = Number(p.price);
    if (!(v > 0)) return { error: 'enter a price above 0 for ' + m.name };
    if (m.last_date === today && m.last_price === v) continue;            // already logged today → nothing new
    add.push({ asset_type: m.asset_type, asset_id: m.asset_id, price_per_unit: v, price_date: today });
  }
  add.forEach(r => appendRow('manual_prices', r));                       // validated + locked like any app write
  if (add.length) data = vzsLoad_(ss);
  const log = [];
  const res = vzsBuild_(ss, data, [{ month, date: today }], 'manual', vzsExisting_(ss), log, today);
  if (res.problem) return { error: res.problem, log };
  try {                                                                 // benchmarks never block the snapshot
    const recent = vzsFundTxnDates_(data, tz, Utilities.formatDate(new Date(vzsNow_().getTime() - 62 * 86400000), tz, 'yyyy-MM-dd'));
    // Last month's end too: the Tax tab converts a US sale at USD/INR of the month-end before it.
    const b = vzsRecordBenchmarks_(ss, [vzsMonthEnd_(vzsPrevMonth_(month)), today].concat(recent), log, Date.now() - VZS_TIME_BUDGET_MS + VZS_BENCH_TAKE_BUDGET_MS);
    if (b.failed.length) log.push('warning: benchmark values not recorded for ' + b.failed.join(', ') + ' — run backfillBenchmarks() later');
  } catch (e) { log.push('warning: benchmark values not recorded (' + e.message + ') — run backfillBenchmarks() later'); }
  const head = vzsRows_(ss, VZS_SNAPSHOTS).find(h => vzsMonthOf_(h.month, tz) === month) || {};
  return { month, date: vzsIso_(head.snapshot_date, tz), updated: res.wrote > 0, pricesSaved: add.length,
           lines: Number(head.lines) || 0, invested: Number(head.invested_total) || 0, value: Number(head.current_total) || 0,
           notes: String(head.notes || ''), warnings: log.filter(l => /^warning/.test(l)) };
}

// Builds and writes plan = [{ month: 'yyyy-mm', date: as-of 'yyyy-mm-dd' }] (oldest first).
// Nothing is written if any needed download fails; a month whose as-of date and content would
// not change is left alone. liveDay (Take snapshot only) = today: an EPF account without passbook
// entries then counts at its typed balance. → { wrote, done, problem }
function vzsBuild_(ss, data, plan, source, existing, log, liveDay) {
  const started = Date.now();
  const tz = ss.getSpreadsheetTimeZone();
  const out = extra => Object.assign({ wrote: 0, done: true, problem: null }, extra);
  if (!plan.length) { log.push('nothing to do'); return out({}); }
  const dates = plan.map(p => p.date);
  if (existing.orphans) withWriteLock_(() => vzsDeleteOrphans_(ss));    // leftovers of a crashed write
  (data.__dupes || []).forEach(w => log.push('warning: ' + w));
  // A month taken in the app is valued at the sheet's live prices; history at official histories.
  const amfi = liveDay ? {} : vzsResolveAmfi_(ss, data, log, dates, tz);
  if (amfi.failed) {
    log.push('could not download AMFI\'s fund list (' + amfi.failed + ') — nothing written; try again later');
    return out({ problem: 'AMFI fund list download failed', done: false });
  }
  const prices = liveDay ? vzsSheetPriceSource_(data, liveDay, tz, started) : vzsPriceSource_(data, tz, started);
  const pre = prices.prefetch(dates);
  if (pre.failed.length) {
    log.push('price downloads failed: ' + pre.failed.join(', ') + ' — nothing written; try again later');
    return out({ problem: 'price download failed (' + pre.failed.length + ')', done: false });
  }
  let wrote = 0;
  const skipped = [];
  const finish = done => {
    pre.warnings.forEach(w => log.push('warning: ' + w));
    return out({ wrote, done, problem: skipped.length ? skipped.join(', ') + ' changed by another run meanwhile — try again' : null });
  };
  for (let i = 0; i < plan.length; i++) {
    const { month, date } = plan[i];
    if (i > 0 && Date.now() - started > VZS_TIME_BUDGET_MS) { log.push('time budget reached — stopped before ' + month); return finish(false); }
    const e = existing.byMonth[month] || null;
    const built = vzsBuildLines_(data, date, tz, prices, liveDay);
    const notes = built.notes.join(' · ');
    if (e && e.source === source && e.date === date && e.notes === notes && vzsSameLines_(existing.lines(month), built.lines)) continue;
    if (!vzsWriteMonth_(ss, { month, date, source, lines: built.lines, notes, expectId: e ? e.id : null })) { skipped.push(month); continue; }
    existing.set(month, { date, source, notes }, built.lines);
    wrote++;
    const inv = built.lines.reduce((s, l) => s + l.invested_value, 0), cur = built.lines.reduce((s, l) => s + l.current_value, 0);
    const atCost = built.lines.filter(l => l.price_source === 'cost').length;
    log.push(month + ' as of ' + date + (e ? ' (updated)' : '') + ': ' + built.lines.length + ' lines, invested ' + Math.round(inv) +
             ', value ' + Math.round(cur) + (atCost ? ', ' + atCost + ' at cost (no price on record)' : '') + (notes ? ' — ' + notes : ''));
  }
  return finish(true);
}

// The assets the Take snapshot popup asks a price for: real estate and physical gold / silver
// (no market price exists) that are held at the end of `dateStr` — unless the asset is set to
// Price Source = formula (its price is in the sheet). With their latest price up to that day.
function vzsManualHeld_(data, dateStr, tz) {
  const out = [];
  VZS_STREAMS.filter(st => st.manual).forEach(st => {
    const pos = vzsPositions_(st, data[st.txns] || [], vzsCutoff_(dateStr, tz));
    (data[st.assets] || []).forEach(a => {
      const p = pos[vzKey_(a.id)];
      if (!p || p.buyUnits <= 0 || p.netQty <= 1e-6) return;
      if (String(a.price_fetch_way || '') === 'formula') return;
      const m = vzsManualPrice_(data, st.manual, a.id, dateStr, tz);
      out.push({ asset_type: st.manual, asset_id: vzKey_(a.id), name: String(a[st.name] || '').trim(),
                 account_id: vzKey_(a.account_id), last_price: m.p, last_date: m.d });
    });
  });
  return out;
}

// ── Lines ────────────────────────────────────────────────────────────────────

// One month's lines as of `dateStr` (the day it is taken; month-end for history).
// → { lines, notes: [text] }. liveDay: see vzsBuild_.
function vzsBuildLines_(data, dateStr, tz, prices, liveDay) {
  const cut = vzsCutoff_(dateStr, tz);                                  // 00:00 after the as-of day
  const oldBefore = vzsOldBefore_(dateStr);                             // a manual price older than this is "old"
  const catBucket = vzsCatBuckets_(data);
  const out = [], old = [], noPrice = [], noRate = [], typed = [], est = [];
  VZS_STREAMS.forEach(st => {
    if (st.ledger) { vzsLedgerLines_(st, data, dateStr, cut, tz, catBucket, liveDay, typed).forEach(l => out.push(l)); return; }
    const pos = vzsPositions_(st, data[st.txns] || [], cut);
    (data[st.assets] || []).forEach(a => {
      const p = pos[vzKey_(a.id)];
      if (!p || p.buyUnits <= 0 || p.netQty <= 1e-6) return;           // nothing held at that date
      const invested = p.cost;                                           // running average (see vzsPositions_)
      const px = prices.at(st, a, dateStr);
      const line = vzsLine_(st, a, dateStr, catBucket, {
        units: vzsRound_(p.netQty, 6), invested_value: vzsRound_(invested, 2),
        price: px.price > 0 ? vzsRound_(px.price, 4) : '',
        current_value: vzsRound_(px.price > 0 ? p.netQty * px.price : invested, 2),
        price_source: px.price > 0 ? px.source : 'cost', price_date: px.price > 0 ? px.date : '' });
      out.push(line);
      if (st.manual && px.price > 0 && px.date < oldBefore) old.push(line.asset_name + ' (' + px.date + ')');
      if (px.source === 'estimate') est.push(line.asset_name);
      if (st.hist && !(px.price > 0)) noPrice.push(line.asset_name + ' (' + (liveDay ? 'sheet ' + st.live + ' is 0 / #N/A — check its GOOGLEFINANCE cell'
        : st.hist === 'amfi' ? 'AMFI ' + (vzKey_(a.amfi_code) || 'code missing') : st.symbol(a)) + ')');
    });
    if (st.usEquity) vzsUsCash_(st, data, cut, dateStr, prices).forEach(c => {
      if (!(c.rate > 0)) noRate.push(c.account || 'default');
      out.push({
        snapshot_date: dateStr, account_id: c.account, bucket_id: catBucket[String(st.cat)] || '', category_id: st.cat,
        subcategory_id: '', asset_table: 'us_cash', asset_id: c.account || '0', asset_name: 'Uninvested Cash (USD)',
        units: vzsRound_(c.usd, 2), invested_value: vzsRound_(c.inr, 2), price: c.rate > 0 ? vzsRound_(c.rate, 4) : '',
        current_value: vzsRound_(c.inr, 2), price_source: c.rate > 0 ? (c.src || 'yahoo') : 'cost', price_date: c.rate > 0 ? c.date : '' });
    });
  });
  const notes = [];
  if (noPrice.length) notes.push('no market price, valued at cost: ' + noPrice.join(', '));
  if (noRate.length) notes.push('no USD→INR rate on or before this date: uninvested US cash shown as ₹0');
  if (old.length) notes.push('old manual price: ' + old.join(', '));
  if (est.length) notes.push('estimated from your recorded prices (land: straight line; metals: ETF moves): ' + est.join(', '));
  if (typed.length) notes.push('EPF at its typed balance (no passbook entries yet): ' + typed.join(', '));
  return { lines: out, notes };
}
// EPF from its passbook entries dated before the cut-off — entries belong to an ACCOUNT, which has
// one EPF row in epf_assets: invested = contributions − withdrawals
// (never below 0), value = contributions + interest − withdrawals; price_date = the latest entry.
// Same rule as staticBalanceOf (js/data.js). An account with NO entries at all counts at its typed
// current_balance — but only in a month being taken now (liveDay); history has no such reading.
function vzsLedgerLines_(st, data, dateStr, cut, tz, catBucket, liveDay, typed) {
  const sums = {}, hasAny = {};
  (data[st.txns] || []).forEach(t => {
    hasAny[vzKey_(t[st.fk])] = true;
    const d = vzsAsDate_(t.txn_date);
    if (!d || d >= cut) return;
    const s = sums[vzKey_(t[st.fk])] = sums[vzKey_(t[st.fk])] || { c: 0, i: 0, w: 0, last: '' };
    const amt = parseFloat(t.amount) || 0;
    if (t.txn_type === 'Contribution') s.c += amt;
    else if (t.txn_type === 'Withdrawal') s.w += amt;
    else if (t.txn_type === 'Interest') s.i += amt;
    const iso = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    if (iso > s.last) s.last = iso;
  });
  const out = [];
  const seen = {};
  (data[st.assets] || []).forEach(a => {
    const k = vzKey_(a.account_id);
    if (seen[k]) return;                                                // one EPF per account (UNIQUE in schema.gs)
    seen[k] = true;
    let inv, val, pd;
    if (hasAny[k]) {
      const s = sums[k];
      if (!s) return;
      val = s.c + s.i - s.w; inv = Math.max(0, s.c - s.w); pd = s.last;
    } else {
      const b = Number(a.current_balance) || 0;
      if (!liveDay || String(a.is_active).toUpperCase() !== 'TRUE' || !b) return;
      inv = val = b; pd = liveDay;
      typed.push(String(a[st.name] || '').trim());
    }
    if (Math.abs(val) < 0.005) return;                                  // nothing left in the account
    out.push(vzsLine_(st, a, dateStr, catBucket, { units: '', invested_value: vzsRound_(inv, 2), price: '',
      current_value: vzsRound_(val, 2), price_source: 'epf', price_date: pd }));
  });
  return out;
}
function vzsLine_(st, a, dateStr, catBucket, extra) {
  return Object.assign({
    snapshot_date: dateStr, account_id: vzKey_(a.account_id), bucket_id: catBucket[String(st.cat)] || '',
    category_id: st.cat, subcategory_id: vzKey_(a.subcategory_id), asset_table: st.assets, asset_id: vzKey_(a.id),
    asset_name: String(a[st.name] || '').trim() || (st.assets + '#' + vzKey_(a.id)),   // NOT NULL — never block a month
  }, extra);
}
// Holdings at `at` per asset, in date order (same day: buy first): a sell takes out the AVERAGE
// cost of what is held — the same running-average method as js/holdings.js and js/insights.js.
// → { aid: { buyUnits, netQty, cost } } (cost = what the units still held cost you)
function vzsPositions_(st, txns, at) {
  const pos = {};
  const rows = txns.map(t => ({ t, d: vzsAsDate_(t.txn_date) })).filter(x => x.d && x.d < at);   // only BEFORE the cut-off
  const isBuy = t => (st.usEquity ? String(t.txn_type).toUpperCase() === 'BUY' : t.txn_type === 'Buy');
  rows.sort((x, y) => (x.d - y.d) || (isBuy(y.t) - isBuy(x.t)));
  rows.forEach(({ t }) => {
    const aid = vzKey_(t[st.fk]);
    const p = pos[aid] = pos[aid] || { buyUnits: 0, netQty: 0, cost: 0 };
    let qty, amt;
    if (st.usEquity) {
      qty = parseFloat(t.units || 0);
      amt = parseFloat(t.inr_cost_basis || 0);
    } else {
      qty = parseFloat(t.units || t.quantity || 0);
      if (st.amountCol) {
        const n = parseFloat(t.nav || t.price_per_unit || 0);
        amt = (qty > 0 && n > 0) ? qty * n : parseFloat(t[st.amountCol] || 0);
      } else {
        amt = parseFloat(t.quantity || 0) * parseFloat(t.price_per_unit || 0)
            + parseFloat(t.registration_cost || 0) + parseFloat(t.other_expenses || 0);
      }
    }
    if (isBuy(t)) { p.buyUnits += qty; p.netQty += qty; p.cost += amt; }
    else if (p.netQty > 0) {
      const sold = Math.min(qty, p.netQty);
      p.cost -= p.cost / p.netQty * sold;
      p.netQty -= sold;
      if (p.netQty < 1e-6) { p.netQty = 0; p.cost = 0; }
    }
  });
  return pos;
}
// US cash per account (wires − buys + sells − repatriations + income), as of `at`, at the USD→INR
// close on or before the snapshot date.
function vzsUsCash_(st, data, at, dateStr, prices) {
  const before = (rows, col) => (rows || []).filter(r => { const d = vzsAsDate_(r[col]); return d && d < at; });
  const assetAcct = {};
  (data[st.assets] || []).forEach(a => { assetAcct[vzKey_(a.id)] = vzKey_(a.account_id); });
  const txns = before(data[st.txns], 'txn_date'), wires = before(data.us_wires, 'wire_date');
  const repats = before(data.us_repatriations, 'repat_date'), income = before(data.us_income, 'income_date');
  const accts = new Set();
  wires.concat(repats, income).forEach(r => accts.add(vzKey_(r.account_id)));
  txns.forEach(t => accts.add(assetAcct[vzKey_(t[st.fk])] || ''));
  const fx = prices.usdInr(dateStr);
  const out = [];
  accts.forEach(acct => {
    const sum = (rows, col) => rows.filter(r => vzKey_(r.account_id) === acct).reduce((s, r) => s + (parseFloat(r[col]) || 0), 0);
    let bought = 0, sold = 0;
    txns.filter(t => (assetAcct[vzKey_(t[st.fk])] || '') === acct).forEach(t => {
      const amt = parseFloat(t.usd_amount) || 0;
      if (String(t.txn_type).toUpperCase() === 'BUY') bought += amt; else sold += amt;
    });
    const usd = sum(wires, 'usd_received') - bought + sold - sum(repats, 'usd_withdrawn') + sum(income, 'usd_amount');
    if (Math.abs(usd) <= 0.01) return;
    out.push({ account: acct, usd, rate: fx.v, date: fx.d, src: fx.src, inr: fx.v > 0 ? usd * fx.v : 0 });
  });
  return out;
}
// ── Prices ───────────────────────────────────────────────────────────────────

// One HTTP GET with patient retries. → { ok, status, text } ; status 404 = "no such data" (permanent).
function vzsFetch_(url, started) {
  let last = { ok: false, status: 0, text: '' };
  for (let i = 0; i <= VZS_RETRY_WAITS_MS.length; i++) {
    if (Date.now() - started > VZS_TIME_BUDGET_MS) return { ok: false, status: 0, text: 'time budget' };
    try {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      const code = res.getResponseCode();
      if (code === 200) return { ok: true, status: 200, text: res.getContentText() };
      last = { ok: false, status: code, text: '' };
      if (code === 404) return last;                                   // permanent — don't retry
      let wait = VZS_RETRY_WAITS_MS[i];
      const ra = Number((res.getHeaders() || {})['Retry-After']);
      if (code === 429 && ra > 0) wait = Math.min(ra * 1000, 30000);
      if (i < VZS_RETRY_WAITS_MS.length && Date.now() - started + wait < VZS_TIME_BUDGET_MS) Utilities.sleep(wait);
      else break;
    } catch (e) {
      last = { ok: false, status: 0, text: String(e) };
      if (i < VZS_RETRY_WAITS_MS.length && Date.now() - started < VZS_TIME_BUDGET_MS) Utilities.sleep(VZS_RETRY_WAITS_MS[i]);
      else break;
    }
  }
  return last;
}
// Price "at" a snapshot date = the latest official price dated on or before it; manually priced
// assets are estimated between your recorded prices (vzsEstimate_, see the header).
// prefetch(dates) downloads what those as-of dates need — only assets actually held on one of
// them, from shortly before the earliest — in parallel batches; at() only reads the cache.
function vzsPriceSource_(data, tz, started) {
  const cache = {};                                    // key → { state: 'ok'|'nodata'|'failed', v: [{d, v}] sorted }
  const byDate = (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
  const parseNavs = vzsParseNavs_;
  const parseBars = j => {
    const r = j && j.chart && j.chart.result && j.chart.result[0];
    if (!r || !r.timestamp) return null;
    const closes = (((r.indicators || {}).quote || [])[0] || {}).close || [];
    const xtz = (r.meta && r.meta.exchangeTimezoneName) || 'UTC';        // trading day in the market's own tz
    const day = ts => Utilities.formatDate(new Date(ts * 1000), xtz, 'yyyy-MM-dd');
    // Yahoo's close is split-adjusted but the units in the sheet are not (a bonus is logged as a
    // Buy at 0 on its ex-date) → multiply back every split dated after the bar = the price quoted that day.
    const splits = Object.keys((r.events || {}).splits || {}).map(k => r.events.splits[k])
      .map(x => ({ d: day(x.date), f: (Number(x.numerator) || 0) / (Number(x.denominator) || 0) }))
      .filter(x => x.f > 0 && isFinite(x.f));
    const seen = {};
    r.timestamp.forEach((ts, i) => { if (closes[i] > 0) seen[day(ts)] = closes[i]; });
    return Object.keys(seen).map(d => ({ d, v: splits.reduce((v, x) => (x.d > d ? v * x.f : v), seen[d]) })).sort(byDate);
  };
  const yahooUrl = (sym, p1, p2) => 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) +
    '?interval=1d&events=split&period1=' + p1 + '&period2=' + p2;
  const val = (entry, iso) => (entry && entry.state === 'ok' ? vzsOnOrBefore_(entry.v, iso) : { d: '', v: 0 });
  const usdInr = iso => val(cache['yahoo:INR=X'], iso);

  return {
    usdInr,
    // Download every series the given months need. Stops at the first failure (nothing could be
    // written anyway) or at the time budget. → { failed: [names], warnings: [text] }
    prefetch(months) {
      const failed = [], warnings = [], jobs = {};
      const earliest = months.reduce((a, b) => (a < b ? a : b));
      const p1 = Math.floor((Utilities.parseDate(earliest, tz, 'yyyy-MM-dd').getTime() - VZS_LOOKBACK_DAYS * 86400000) / 1000);
      const p2 = Math.floor(Date.now() / 1000 + 86400);
      const cuts = months.map(m => vzsCutoff_(m, tz));
      let usd = false;
      VZS_STREAMS.forEach(st => {
        if (!st.hist) return;
        const held = vzsHeldIds_(st, data, months, tz);
        (data[st.assets] || []).filter(a => held.has(vzKey_(a.id))).forEach(a => {
          const label = st.assets + '#' + vzKey_(a.id) + ' ' + String(a[st.name] || '').slice(0, 30);
          if (st.hist === 'amfi') {
            const code = vzKey_(a.amfi_code);
            if (!code) { warnings.push(label + ' has no ISIN / AMFI code → valued at cost (add its ISIN in the fund tab)'); return; }
            jobs['amfi:' + code] = { url: 'https://api.mfapi.in/mf/' + encodeURIComponent(code), parse: parseNavs, label, what: 'AMFI code ' + code };
          } else {
            const sym = st.symbol(a);
            jobs['yahoo:' + sym] = { url: yahooUrl(sym, p1, p2), parse: parseBars, label, what: '"' + sym + '"' };
            if (st.usd) usd = true;
          }
        });
        if (st.usEquity) {                                               // US cash can exist without a held asset
          const last = cuts.reduce((a, b) => (a > b ? a : b));
          const any = (rows, col) => (rows || []).some(r => { const d = vzsAsDate_(r[col]); return d && d < last; });
          if (any(data.us_wires, 'wire_date') || any(data.us_repatriations, 'repat_date') || any(data.us_income, 'income_date') ||
              any(data[st.txns], 'txn_date')) usd = true;
        }
      });
      if (usd) jobs['yahoo:INR=X'] = { url: yahooUrl('INR=X', p1, p2), parse: parseBars, label: 'USD→INR', what: '"INR=X"' };
      VZS_STREAMS.filter(st => st.manual === 'physical_precious_metal').forEach(st => {
        const held = vzsHeldIds_(st, data, months, tz);
        (data[st.assets] || []).filter(a => held.has(vzKey_(a.id))).forEach(a => {
          const sym = VZS_METAL_PROXY[String(a.metal_type || '')];
          if (!sym) return;
          jobs['proxy:' + sym] = { url: yahooUrl(sym, p1, p2).replace('events=split', 'events=div%7Csplit'), parse: vzsParseAdjCloses_,
            label: String(a[st.name] || '').slice(0, 30), what: '"' + sym + '" (between your recorded prices)', proxy: true };
        });
      });

      const keys = Object.keys(jobs);
      for (let i = 0; i < keys.length && !failed.length; i += VZS_FETCH_BATCH) {
        if (Date.now() - started > VZS_TIME_BUDGET_MS) { failed.push('time budget (' + (keys.length - i) + ' series left)'); break; }
        const batch = keys.slice(i, i + VZS_FETCH_BATCH);
        const res = vzsFetchAll_(batch.map(k => jobs[k].url), started);
        batch.forEach((k, j) => {
          const r = res[j];
          if (r.ok) {
            try { const v = jobs[k].parse(JSON.parse(r.text)); cache[k] = v && v.length ? { state: 'ok', v } : { state: 'nodata' }; }
            catch (e) { cache[k] = { state: 'failed' }; }
          } else cache[k] = { state: r.status === 404 ? 'nodata' : 'failed' };
          if (cache[k].state === 'nodata' && k === 'yahoo:INR=X') cache[k] = { state: 'failed' };   // US cash can't be valued without it
          if (cache[k].state === 'failed') failed.push(k.replace(':', ' '));
          if (cache[k].state === 'nodata') warnings.push(jobs[k].label + ': no price history for ' + jobs[k].what +
            (jobs[k].proxy ? ' → your latest price up to each date' : ' → valued at cost'));
        });
      }
      return { failed, warnings };
    },
    // → { price, source, date } for one asset on snapshot date `iso` (price 0 = none on record)
    at(st, a, iso) {
      if (st.manual) {
        const est = vzsEstimate_(st, data, a, iso, tz, cache['proxy:' + VZS_METAL_PROXY[String(a.metal_type || '')]]);
        if (est) return est;
        const m = vzsManualPrice_(data, st.manual, a.id, iso, tz);         // your latest price up to that date
        return { price: m.p, source: 'manual', date: m.d };
      }
      if (st.hist === 'amfi') {
        const code = vzKey_(a.amfi_code);
        const n = code ? val(cache['amfi:' + code], iso) : { d: '', v: 0 };
        return { price: n.v, source: 'amfi', date: n.d };
      }
      if (st.hist === 'yahoo') {
        const c = val(cache['yahoo:' + st.symbol(a)], iso);
        if (!st.usd) return { price: c.v, source: 'yahoo', date: c.d };
        const fx = usdInr(iso);
        return { price: c.v > 0 && fx.v > 0 ? c.v * fx.v : 0, source: 'yahoo', date: c.d };
      }
      return { price: 0, source: 'cost', date: '' };
    },
  };
}
// History only: a price for a manually priced asset on a day between the prices on record —
// your manual prices and what you paid on each buy (land: cost per unit incl. registration and
// expenses). Land runs in a straight line between those points and stays at the last one after
// it; a physical metal follows its ETF proxy (proxy = { state, v } from prefetch), corrected
// smoothly so it lands exactly on each recorded price, and after the last one follows the proxy
// from there. → { price, source: 'estimate' | 'manual', date } or null = keep the plain rule
// (latest manual price, else cost).
function vzsEstimate_(st, data, a, iso, tz, proxy) {
  const pts = vzsPricePoints_(st, data, a, tz);
  if (!pts.some(x => x.manual)) return null;                           // nothing you priced yet → as before
  let i = -1;
  for (let j = 0; j < pts.length && pts[j].d <= iso; j++) i = j;
  if (i < 0) return null;
  const before = pts[i], after = pts[i + 1] || null;
  if (before.d === iso) return { price: before.p, source: before.manual ? 'manual' : 'estimate', date: iso };
  const day = d => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  if (st.manual === 'real_estate') {
    if (!after) return before.manual ? { price: before.p, source: 'manual', date: before.d }   // past the last point: it holds
                                     : { price: before.p, source: 'estimate', date: iso };
    const f = (day(iso) - day(before.d)) / (day(after.d) - day(before.d));
    return { price: before.p + (after.p - before.p) * f, source: 'estimate', date: iso };
  }
  const px = d => (proxy && proxy.state === 'ok' ? vzsOnOrBefore_(proxy.v, d).v : 0);
  const now = px(iso), then = px(before.d);
  if (!(now > 0 && then > 0)) return null;
  let price = before.p * now / then;
  if (after && px(after.d) > 0) {                                       // bend the proxy path onto the next recorded price
    const miss = after.p / (before.p * px(after.d) / then);
    price *= Math.pow(miss, (day(iso) - day(before.d)) / (day(after.d) - day(before.d)));
  }
  return { price, source: 'estimate', date: iso };
}

// Recorded prices of one manually priced asset, oldest first: [{ d, p, manual }]. A manual price
// wins over a buy on the same day; several buys on one day → their average price per unit.
function vzsPricePoints_(st, data, a, tz) {
  const key = '__pts:' + st.assets + '|' + vzKey_(a.id);
  if (data[key]) return data[key];
  const byDay = {};
  (data[st.txns] || []).forEach(t => {
    if (vzKey_(t[st.fk]) !== vzKey_(a.id) || t.txn_type !== 'Buy') return;
    const d = vzsAsDate_(t.txn_date), qty = parseFloat(t.quantity || t.units || 0);
    const cost = parseFloat(t.quantity || 0) * parseFloat(t.price_per_unit || 0)
               + parseFloat(t.registration_cost || 0) + parseFloat(t.other_expenses || 0);
    if (!d || !(qty > 0) || !(cost > 0)) return;
    const iso = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    const b = byDay[iso] = byDay[iso] || { qty: 0, cost: 0 };
    b.qty += qty; b.cost += cost;
  });
  const pts = {};
  Object.keys(byDay).forEach(d => { pts[d] = { d, p: byDay[d].cost / byDay[d].qty, manual: false }; });
  const ids = {};
  (data.manual_prices || []).forEach(r => {
    if (String(r.asset_type) !== st.manual || vzKey_(r.asset_id) !== vzKey_(a.id)) return;
    const d = vzsAsDate_(r.price_date), p = Number(r.price_per_unit) || 0, id = Number(r.id) || 0;
    if (!d || !(p > 0)) return;
    const iso = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    if (pts[iso] && pts[iso].manual && ids[iso] > id) return;          // same day twice → the later entry is the correction
    pts[iso] = { d: iso, p, manual: true };
    ids[iso] = id;
  });
  data[key] = Object.keys(pts).sort().map(d => pts[d]);
  return data[key];
}

// Prices for a snapshot taken in the app (today): the sheet's own GOOGLEFINANCE columns (already
// INR — US / crypto included). USD→INR for uninvested US cash is implied by the sheet too
// (current_price ÷ current_price_usd of a US asset); only if the sheet has none, Yahoo's rate.
// A 0 / #N/A price is no price: the asset is valued at cost and named in the month's notes.
function vzsSheetPriceSource_(data, day, tz, started) {
  let rate = 0, rateDate = day, rateSrc = 'sheet';
  (data.us_equity_assets || []).some(a => {
    const inr = Number(a.current_price), usd = Number(a.current_price_usd);
    if (inr > 0 && usd > 0) { rate = inr / usd; return true; }
    return false;
  });
  return {
    usdInr: () => ({ v: rate, d: rate > 0 ? rateDate : '', src: rateSrc }),
    prefetch() {
      const warnings = [];
      const usData = ['us_wires', 'us_repatriations', 'us_income', 'us_equity_transactions'].some(t => (data[t] || []).length);
      if (!(rate > 0) && usData) {                                       // US cash possible, no US price pair in the sheet
        const r = vzsFetch_('https://query1.finance.yahoo.com/v8/finance/chart/INR%3DX?interval=1d&range=5d', started);
        try {
          const q = JSON.parse(r.text).chart.result[0], closes = q.indicators.quote[0].close.filter(c => c > 0);
          if (r.ok && closes.length) { rate = closes[closes.length - 1]; rateSrc = 'yahoo'; } else throw new Error('no data');
        } catch (e) { warnings.push('no USD→INR rate in the sheet or from Yahoo — uninvested US cash shown as ₹0'); }
      }
      return { failed: [], warnings };
    },
    at(st, a, iso) {
      if (st.manual && String(a.price_fetch_way || '') === 'formula') {   // priced in the sheet, not by you
        const p = Number(a.current_price) || 0;
        return { price: p > 0 ? p : 0, source: 'sheet', date: day };
      }
      if (st.manual) {
        const m = vzsManualPrice_(data, st.manual, a.id, iso, tz);
        return { price: m.p, source: 'manual', date: m.d };
      }
      const p = st.live ? Number(a[st.live]) || 0 : 0;
      return { price: p > 0 ? p : 0, source: 'sheet', date: day };
    },
  };
}

// Many GETs at once (UrlFetchApp.fetchAll); anything that isn't 200 / 404 is retried one at a time
// with back-off. → [{ ok, status, text }] in the same order.
function vzsFetchAll_(urls, started) {
  let res = null;
  try { res = UrlFetchApp.fetchAll(urls.map(url => ({ url, muteHttpExceptions: true, followRedirects: true }))); }
  catch (e) { res = null; }                                             // e.g. DNS failure → retry singly
  let gaveUp = false;                                                   // one failure fails the run → don't retry the rest
  return urls.map((url, i) => {
    const r = res && res[i];
    const code = r ? r.getResponseCode() : 0;
    if (code === 200) return { ok: true, status: 200, text: r.getContentText() };
    if (code === 404) return { ok: false, status: 404, text: '' };
    if (gaveUp) return { ok: false, status: code, text: 'skipped' };
    const one = vzsFetch_(url, started);
    if (!one.ok && one.status !== 404) gaveUp = true;
    return one;
  });
}
// mfapi.in JSON → [{ d: 'yyyy-mm-dd', v: NAV }] oldest first (null = not a NAV payload).
function vzsParseNavs_(j) {
  if (!j || !j.data) return null;
  return j.data.map(x => {
    const p = String(x.date).split('-');                                  // dd-mm-yyyy
    return { d: p[2] + '-' + p[1] + '-' + p[0], v: Number(x.nav) };
  }).filter(x => x.v > 0).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}
// Latest {d, v} in a date-sorted list with d <= iso (binary search). { d: '', v: 0 } if none.
function vzsOnOrBefore_(list, iso) {
  let lo = 0, hi = list.length - 1, hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].d <= iso) { hit = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return hit >= 0 ? list[hit] : { d: '', v: 0 };
}
// Latest manual price dated on or before `lastIso` → { p, d } (p 0 = none). Ties → highest id.
function vzsManualPrice_(data, assetType, assetId, lastIso, tz) {
  let best = null;
  (data.manual_prices || []).forEach(r => {
    if (String(r.asset_type) !== assetType || vzKey_(r.asset_id) !== vzKey_(assetId)) return;
    const d = vzsAsDate_(r.price_date);
    if (!d) return;
    const iso = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    if (iso > lastIso) return;
    const id = Number(r.id) || 0;                        // same date twice → the later entry is the correction
    if (!best || iso > best.d || (iso === best.d && id > best.id)) best = { d: iso, p: Number(r.price_per_unit) || 0, id };
  });
  return best ? { d: best.d, p: best.p } : { d: '', p: 0 };
}
// Asset ids (vzKey_) of a stream held at the end of at least one of `dates` (as-of days).
function vzsHeldIds_(st, data, dates, tz) {
  const held = new Set();
  dates.forEach(m => {
    const pos = vzsPositions_(st, data[st.txns] || [], vzsCutoff_(m, tz));
    Object.keys(pos).forEach(k => { if (pos[k].buyUnits > 0 && pos[k].netQty > 1e-6) held.add(k); });
  });
  return held;
}
// Funds held on `dates` that have an ISIN but no AMFI code yet: look the code up in AMFI's NAV
// list and store it. (A fund not held then never blocks the run.)
function vzsResolveAmfi_(ss, data, log, dates, tz) {
  const missing = [];
  VZS_STREAMS.filter(st => st.hist === 'amfi').forEach(st => {
    const held = vzsHeldIds_(st, data, dates, tz);
    (data[st.assets] || []).forEach(f => {
      if (held.has(vzKey_(f.id)) && vzKey_(f.isin) && !vzKey_(f.amfi_code)) missing.push({ t: st.assets, f });
    });
  });
  if (!missing.length) return {};
  const r = vzsFetch_(VZS_NAVALL_URL, Date.now());
  if (!r.ok) return { failed: 'HTTP ' + r.status };
  const byIsin = {};
  r.text.split('\n').forEach(line => {
    const p = line.split(';');
    if (p.length >= 6 && /^\d+$/.test(p[0].trim())) [p[1], p[2]].forEach(i => { if (/^INF/.test(String(i).trim())) byIsin[i.trim()] = p[0].trim(); });
  });
  withWriteLock_(() => missing.forEach(({ t, f }) => {
    const code = byIsin[String(f.isin).trim()];
    if (!code) { log.push(t + ' id ' + vzKey_(f.id) + ': ISIN ' + f.isin + ' not in AMFI\'s list — check the ISIN'); return; }
    const sh = ss.getSheetByName(t), h = vzsHeaders_(sh);
    const ids = sh.getRange(2, h.indexOf('id') + 1, sh.getLastRow() - 1, 1).getValues();
    const row = ids.findIndex(x => vzKey_(x[0]) === vzKey_(f.id));
    if (row < 0) return;
    sh.getRange(row + 2, h.indexOf('amfi_code') + 1).setNumberFormat('@').setValue(code);
    f.amfi_code = code;
    log.push(t + ' id ' + vzKey_(f.id) + ' "' + f.fund_name + '": AMFI code ' + code + ' resolved from ISIN ' + f.isin);
  }));
  return {};
}
// ── Benchmarks ───────────────────────────────────────────────────────────────

// History (re-runnable, fills only what is missing): one value per series for every month-end
// from the first transaction month to the last complete month, and for every snapshot's as-of day.
function backfillBenchmarks() {
  const ss = getSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const log = [];
  const first = vzsFirstTxnDate_(vzsLoad_(ss));
  if (!first) { vzsNotify_('Benchmarks — no transactions yet', log); return; }
  const res = vzsRecordBenchmarks_(ss, vzsBenchDates_(ss, first, tz), log, Date.now());
  vzsNotify_(res.failed.length ? 'Benchmarks — ' + res.failed.length + ' series failed (run again later): ' + res.failed.join(', ')
           : 'Benchmarks complete — ' + res.wrote + ' value(s) written', log);
}

// Month-ends from the first transaction to the last complete month, every snapshot's as-of day,
// and every fund-scope transaction day before today (Insights compares buys and sells with the
// index on the same day).
function vzsBenchDates_(ss, first, tz) {
  const dates = new Set();
  const lastFull = vzsPrevMonth_(vzsThisMonth_(new Date(vzsNow_().getTime() - 86400000), tz));   // its last day has settled
  for (let m = Utilities.formatDate(first, tz, 'yyyy-MM'); m <= lastFull; m = vzsNextMonth_(m)) dates.add(vzsMonthEnd_(m));
  vzsRows_(ss, VZS_SNAPSHOTS).forEach(h => { const d = vzsIso_(h.snapshot_date, tz); if (d) dates.add(d); });
  vzsFundTxnDates_(vzsLoad_(ss), tz, '').forEach(d => dates.add(d));
  return Array.from(dates).sort();
}

// The first day whose prices may still move: today, or before 06:00 yesterday — a bar dated
// yesterday is still live until the US close (~02:30 IST) and the UTC crypto close (05:30 IST).
// Prices dated before it are settled. (Offsets assume the sheet's timezone is IST.)
function vzsSettledDay_(tz) {
  return Utilities.formatDate(new Date(vzsNow_().getTime() - 6 * 3600000), tz, 'yyyy-MM-dd');
}

// Days ('yyyy-mm-dd', after `since`, before vzsSettledDay_) with a transaction in the fund's categories
// (VZS_FUND_CATS — the same scope as FUND_SCOPE in js/data.js).
function vzsFundTxnDates_(data, tz, since) {
  const settled = vzsSettledDay_(tz);
  const out = new Set();
  VZS_STREAMS.filter(st => st.txns && VZS_FUND_CATS.indexOf(st.cat) >= 0).forEach(st => (data[st.txns] || []).forEach(t => {
    const d = vzsIso_(t.txn_date, tz);
    if (d && d > since && d < settled) out.add(d);
  }));
  return Array.from(out);
}

// Writes the missing (date, series) values for `dates` ('yyyy-mm-dd'). A value is the series'
// latest SETTLED price on or before the date — nothing dated vzsSettledDay_ or later counts
// (tonight's NAV, a US session still open, a live crypto / FX bar); price_date / fx_date record
// the prices used.
// A date before the series existed gets no row. Each series is downloaded once; a failed one is
// skipped (named in `failed`), the rest are still written. `started` sets the time budget (Take
// snapshot passes a short one). → { wrote, failed: [keys] }
function vzsRecordBenchmarks_(ss, dates, log, started) {
  const tz = ss.getSpreadsheetTimeZone();
  const series = VZS_BENCHMARKS.filter(b => b.code);
  if (!series.length || !dates.length) return { wrote: 0, failed: [] };
  const stored = vzsBenchStored_(ss, tz);
  const need = {};
  series.forEach(b => {
    const have = stored[b.key];
    const miss = dates.filter(d => !(have && have.dates.has(d)));
    if (miss.length) need[b.key] = miss;
  });
  const todo = series.filter(b => need[b.key]);
  if (!todo.length) { log.push('benchmarks: nothing new to record'); return { wrote: 0, failed: [] }; }

  // Download from before the earliest needed date or chain anchor (the series' last stored value).
  let earliest = dates.reduce((a, b) => (a < b ? a : b));
  todo.forEach(b => { const last = stored[b.key] && stored[b.key].last; if (last && last.d < earliest) earliest = last.d; });
  const p1 = Math.floor((Utilities.parseDate(earliest, tz, 'yyyy-MM-dd').getTime() - 10 * 86400000) / 1000);
  const p2 = Math.floor(Date.now() / 1000 + 86400);
  const jobs = {};
  const yahoo = sym => 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) +
    '?interval=1d&events=div%7Csplit&period1=' + p1 + '&period2=' + p2;
  todo.forEach(b => {
    if (b.src === 'amfi') jobs['amfi:' + b.code] = { url: 'https://api.mfapi.in/mf/' + encodeURIComponent(b.code), parse: vzsParseNavs_ };
    else jobs['yahoo:' + b.code] = { url: yahoo(b.code), parse: vzsParseAdjCloses_ };
    if (b.fx) jobs['yahoo:INR=X'] = { url: yahoo('INR=X'), parse: vzsParseAdjCloses_ };
  });
  const got = {};
  const keys = Object.keys(jobs);
  const settled = vzsSettledDay_(tz);
  for (let i = 0; i < keys.length; i += VZS_FETCH_BATCH) {
    if (Date.now() - started > VZS_TIME_BUDGET_MS) break;              // the rest count as failed
    const batch = keys.slice(i, i + VZS_FETCH_BATCH);
    const res = vzsFetchAll_(batch.map(k => jobs[k].url), started);
    batch.forEach((k, j) => {
      if (!res[j].ok) return;
      try {
        let v = jobs[k].parse(JSON.parse(res[j].text));
        v = v && v.filter(x => x.d < settled);                          // settled prices only
        if (v && v.length) got[k] = k.indexOf('amfi:') === 0 ? vzsUndoSplits_(v) : v;
      } catch (e) { /* counted as failed below */ }
    });
  }

  const failed = [], rows = [];
  todo.forEach(b => {
    const own = got[b.src + ':' + b.code], fx = b.fx ? got['yahoo:INR=X'] : null;
    if (!own || (b.fx && !fx)) { failed.push(b.key); return; }
    // → { v, pd, fd } for as-of day `iso` (pd / fd: the price / fx dates used); v 0 = none
    const fresh = (iso, fxIso) => {
      const p = vzsOnOrBefore_(own, iso);
      if (!(p.v > 0)) return { v: 0 };
      if (!b.fx) return { v: p.v, pd: p.d, fd: '' };
      const r = vzsOnOrBefore_(fx, fxIso || iso);
      return r.v > 0 ? { v: p.v * r.v, pd: p.d, fd: r.d } : { v: 0 };
    };
    let k = 1;                                                          // chain onto the stored series
    const last = stored[b.key] && stored[b.key].last;
    if (last && !b.level) {
      const f = fresh(last.pd || last.d, last.fd || last.pd || last.d).v;   // the very prices that row used
      if (!(f > 0)) { failed.push(b.key); log.push('warning: ' + b.key + ' has no value on ' + last.d + ' to chain onto'); return; }
      k = last.nav / f;
      if (Math.abs(k - 1) < 1e-8) k = 1;                                // same prices → stay equal to the NAVs
    }
    const source = b.src + ':' + b.code + (b.fx ? '×INR=X' : '');
    need[b.key].forEach(d => {
      const f = fresh(d);
      if (f.v > 0) rows.push({ date: d, code: b.key, nav: vzsRound_(f.v * k, 6), source, price_date: f.pd, fx_date: f.fd });
    });
  });
  const wrote = rows.length ? vzsWriteBench_(ss, rows) : 0;
  log.push('benchmarks: ' + wrote + ' value(s) written' + (failed.length ? '; failed: ' + failed.join(', ') : ''));
  return { wrote, failed };
}

// Yahoo chart JSON → [{ d, v: close adjusted for dividends and splits }] oldest first, by trading
// day in the market's own timezone (a total-return series up to Yahoo's rescaling — every value
// from ONE download shares the same scale).
function vzsParseAdjCloses_(j) {
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.timestamp) return null;
  const adj = ((((r.indicators || {}).adjclose || [])[0] || {}).adjclose) || (((r.indicators || {}).quote || [])[0] || {}).close || [];
  const xtz = (r.meta && r.meta.exchangeTimezoneName) || 'UTC';
  const seen = {};
  r.timestamp.forEach((ts, i) => { if (adj[i] > 0) seen[Utilities.formatDate(new Date(ts * 1000), xtz, 'yyyy-MM-dd')] = adj[i]; });
  return Object.keys(seen).sort().map(d => ({ d, v: seen[d] }));
}

// A NAV list with unit splits / consolidations undone (an ETF's NAV drops to 1/n overnight when
// its units split n-for-1): a day-on-day ratio within 3% of 1/n or n (n = 2…100) scales every
// earlier value. A real one-day market move is never that size for these series.
function vzsUndoSplits_(list) {
  const out = list.map(x => ({ d: x.d, v: x.v }));
  const factors = [2, 3, 4, 5, 10, 20, 25, 50, 100];
  for (let i = out.length - 1; i > 0; i--) {
    const r = out[i].v / out[i - 1].v;
    const n = factors.find(f => Math.abs(r * f - 1) < 0.03 || Math.abs(r / f - 1) < 0.03);
    if (!n) continue;
    const scale = Math.abs(r * n - 1) < 0.03 ? 1 / n : n;
    for (let j = 0; j < i; j++) out[j].v *= scale;
  }
  return out;
}

// What benchmark_prices holds: key → { dates: Set, last: { d, nav, pd, fd } } (last = latest date).
function vzsBenchStored_(ss, tz) {
  const out = {};
  vzsRows_(ss, VZS_BENCH).forEach(r => {
    const key = String(r.code), d = vzsIso_(r.date, tz), nav = Number(r.nav);
    if (!d || !(nav > 0)) return;
    const s = out[key] = out[key] || { dates: new Set(), last: null };
    s.dates.add(d);
    if (!s.last || d > s.last.d) s.last = { d, nav, pd: vzsIso_(r.price_date, tz), fd: vzsIso_(r.fx_date, tz) };
  });
  return out;
}

// Appends benchmark rows under the write lock, validated against schema.gs. A (date, code) that
// another run stored meanwhile is dropped, not duplicated. → rows written
function vzsWriteBench_(ss, rows) {
  return withWriteLock_(() => {
    const tz = ss.getSpreadsheetTimeZone();
    const sh = ss.getSheetByName(VZS_BENCH);
    if (!sh) throw new Error(VZS_BENCH + ' tab missing — run setupSnapshots() first');
    const head = vzsHeaders_(sh);
    const missing = VZS_BENCH_HEADERS.filter(h => head.indexOf(h) < 0);
    if (missing.length) throw new Error(VZS_BENCH + ' lacks column(s) ' + missing.join(', ') + ' — run setupSnapshots() again');
    const stored = vzsBenchStored_(ss, tz);
    const fresh = rows.filter(r => !(stored[r.code] && stored[r.code].dates.has(r.date)));
    if (!fresh.length) return 0;
    const ctx = vzCtx_(ss);
    const ids = vzIdBlock_(VZS_BENCH, vzsMaxId_(sh));
    const now = new Date().toISOString();
    const values = fresh.map(r => {
      const row = Object.assign({ id: ids.next(), created_at: now }, r);
      vzAssertRow_(ctx, VZS_BENCH, row, null);
      ctx.add(VZS_BENCH, row);
      return head.map(h => (row[h] !== undefined ? row[h] : ''));
    });
    const start = sh.getLastRow() + 1;
    vzEnsureRows_(sh, start + values.length - 1);
    ['date', 'price_date', 'fx_date'].forEach(c => sh.getRange(start, head.indexOf(c) + 1, values.length, 1).setNumberFormat('@'));
    sh.getRange(start, 1, values.length, head.length).setValues(values);
    SpreadsheetApp.flush();
    ids.commit();
    return values.length;
  });
}

// ── Manager notes & pattern history (Insights → Factsheet / What's happening) ──

// Upserts the note for (month, account). The app writes it right after Take snapshot; the month
// must have a snapshot. While the month is open a later take rewrites it; once the month is
// locked its note is kept as written (a missing one can still be added once). → { saved }
function vzsSaveNote_(month, account, note) {
  const m = String(month || ''), acct = vzKey_(account || 'all'), text = String(note || '').trim();
  if (!/^\d{4}-\d{2}$/.test(m)) throw new Error('month must be yyyy-mm');
  if (!text || text.length > 4000) throw new Error('note must be 1–4000 characters');
  if (/^[=+\-@]/.test(text)) throw new Error('note must not start with = + - @');   // never a formula
  const ss = getSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  return withWriteLock_(() => {
    if (!vzsRows_(ss, VZS_SNAPSHOTS).some(h => vzsMonthOf_(h.month, tz) === m)) throw new Error('no snapshot for ' + m);
    if (acct !== 'all' && !vzsRows_(ss, 'accounts').some(a => vzKey_(a.id) === acct)) throw new Error('unknown account ' + acct);
    const sh = ss.getSheetByName(VZS_NOTES);
    if (!sh) throw new Error(VZS_NOTES + ' tab missing — run setupSnapshots() first');
    const head = vzsHeaders_(sh);
    const missing = VZS_NOTES_HEADERS.filter(h => head.indexOf(h) < 0);
    if (missing.length) throw new Error(VZS_NOTES + ' lacks column(s) ' + missing.join(', ') + ' — run setupSnapshots() again');
    const rows = vzsRows_(ss, VZS_NOTES);
    const i = rows.findIndex(r => vzsMonthOf_(r.month, tz) === m && vzKey_(r.account) === acct);
    const now = new Date().toISOString();
    const ctx = vzCtx_(ss);
    if (i >= 0) {
      if (m !== vzsThisMonth_(vzsNow_(), tz)) return { saved: false, locked: true };
      const row = Object.assign({}, rows[i], { note: text, updated_at: now });
      vzAssertRow_(ctx, VZS_NOTES, row, rows[i].id);
      const r = vzsRowNumber_(sh, rows[i].id);
      sh.getRange(r, head.indexOf('note') + 1).setValue(text);
      sh.getRange(r, head.indexOf('updated_at') + 1).setValue(now);
      SpreadsheetApp.flush();
      return { saved: true };
    }
    const ids = vzIdBlock_(VZS_NOTES, vzsMaxId_(sh));
    const row = { id: ids.next(), month: m, account: acct, note: text, created_at: now, updated_at: now };
    vzAssertRow_(ctx, VZS_NOTES, row, null);
    const start = sh.getLastRow() + 1;
    vzEnsureRows_(sh, start);
    ['month', 'account'].forEach(c => sh.getRange(start, head.indexOf(c) + 1).setNumberFormat('@'));
    sh.getRange(start, 1, 1, head.length).setValues([head.map(h => (row[h] !== undefined ? row[h] : ''))]);
    SpreadsheetApp.flush();
    ids.commit();
    return { saved: true };
  });
}

// Replaces the feed stored for (month, account) with `rows` ([{ pattern_id, holding, headline,
// value }]). Same rules as the note: the month needs a snapshot; while it is open a later take
// replaces its rows; once locked, a month that already has rows keeps them. → { saved, rows }
function vzsSavePatterns_(month, account, rows) {
  const m = String(month || ''), acct = vzKey_(account || 'all');
  if (!/^\d{4}-\d{2}$/.test(m)) throw new Error('month must be yyyy-mm');
  if (!Array.isArray(rows) || rows.length > 200) throw new Error('rows must be a list of at most 200');
  const clean = rows.map(r => {
    const id = String(r.pattern_id || ''), holding = String(r.holding || '').trim(), headline = String(r.headline || '').trim();
    const value = Number(r.value);
    if (!/^[a-z0-9_]{1,40}$/.test(id)) throw new Error('bad pattern_id ' + id);
    if (holding.length > 120 || !headline || headline.length > 300) throw new Error('holding / headline too long for ' + id);
    if (/^[=+\-@]/.test(holding) || /^[=+\-@]/.test(headline)) throw new Error('text must not start with = + - @');
    if (!isFinite(value)) throw new Error('value must be a number for ' + id);
    return { pattern_id: id, holding, headline, value };
  });
  const ss = getSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  return withWriteLock_(() => {
    if (!vzsRows_(ss, VZS_SNAPSHOTS).some(h => vzsMonthOf_(h.month, tz) === m)) throw new Error('no snapshot for ' + m);
    if (acct !== 'all' && !vzsRows_(ss, 'accounts').some(a => vzKey_(a.id) === acct)) throw new Error('unknown account ' + acct);
    const sh = ss.getSheetByName(VZS_PATTERNS);
    if (!sh) throw new Error(VZS_PATTERNS + ' tab missing — run setupSnapshots() first');
    const head = vzsHeaders_(sh);
    const missing = VZS_PATTERN_HEADERS.filter(h => head.indexOf(h) < 0);
    if (missing.length) throw new Error(VZS_PATTERNS + ' lacks column(s) ' + missing.join(', ') + ' — run setupSnapshots() again');
    const mine = r => vzsMonthOf_(r.month, tz) === m && vzKey_(r.account) === acct;
    const old = vzsRows_(ss, VZS_PATTERNS).filter(mine);
    if (old.length && m !== vzsThisMonth_(vzsNow_(), tz)) return { saved: false, locked: true };
    const oldIds = new Set(old.map(r => vzKey_(r.id)));
    // Validate every new row first (against the table without this month's old rows), then append
    // them, and only then delete the old ones — a rejected save leaves the stored feed as it was.
    const ctx = vzCtx_(ss);
    const table = ctx.table(VZS_PATTERNS);
    table.rows = table.rows.filter(r => !oldIds.has(vzKey_(r.id)));
    const idsNext = vzIdBlock_(VZS_PATTERNS, vzsMaxId_(sh));
    const now = new Date().toISOString();
    const values = clean.map(r => {
      const row = Object.assign({ id: idsNext.next(), month: m, account: acct, created_at: now }, r);
      vzAssertRow_(ctx, VZS_PATTERNS, row, null);
      ctx.add(VZS_PATTERNS, row);
      return head.map(h => (row[h] !== undefined ? row[h] : ''));
    });
    if (values.length) {
      const start = sh.getLastRow() + 1;
      vzEnsureRows_(sh, start + values.length - 1);
      ['month', 'account', 'holding', 'headline'].forEach(c => sh.getRange(start, head.indexOf(c) + 1, values.length, 1).setNumberFormat('@'));
      sh.getRange(start, 1, values.length, head.length).setValues(values);
    }
    if (oldIds.size) {
      const ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
      for (let i = ids.length - 1; i >= 0; i--) if (oldIds.has(vzKey_(ids[i][0]))) sh.deleteRow(i + 2);   // bottom up
    }
    SpreadsheetApp.flush();
    idsNext.commit();
    return { saved: true, rows: values.length };
  });
}

// Sheet row number of the row with this id (ids are in column A).
function vzsRowNumber_(sh, id) {
  const ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  const i = ids.findIndex(r => vzKey_(r[0]) === vzKey_(id));
  if (i < 0) throw new Error('row ' + id + ' not found');
  return i + 2;
}

// ── Storage ──────────────────────────────────────────────────────────────────

// Committed months (a month counts only once its header row exists) and their lines, by month.
function vzsExisting_(ss) {
  const tz = ss.getSpreadsheetTimeZone();
  const byId = {}, byMonth = {}, lines = {};
  vzsRows_(ss, VZS_SNAPSHOTS).forEach(h => {
    const m = vzsMonthOf_(h.month, tz);
    byId[vzKey_(h.id)] = m;
    byMonth[m] = { id: vzKey_(h.id), date: vzsIso_(h.snapshot_date, tz), source: String(h.source || ''), notes: String(h.notes || '') };
  });
  let orphans = 0;
  vzsRows_(ss, VZS_LINES).forEach(l => {
    const m = byId[vzKey_(l.snapshot_id)];
    if (m) (lines[m] = lines[m] || []).push(vzsLineObj_(l, tz)); else orphans++;
  });
  return {
    byMonth,
    orphans,
    lines: m => lines[m] || [],
    set(m, head, ls) { byMonth[m] = Object.assign({ id: 'new' }, head); lines[m] = ls; },
  };
}

// Same content? (ignores ids / timestamps)
function vzsSameLines_(a, b) {
  const num = v => (v === '' || v === null || v === undefined ? '' : String(vzsRound_(v, 6)));
  const fp = ls => ls.map(l => [l.asset_table, vzKey_(l.asset_id), vzKey_(l.account_id), vzKey_(l.category_id),
    vzKey_(l.subcategory_id), String(l.asset_name), num(l.units), num(l.invested_value), num(l.price), num(l.current_value),
    String(l.price_source), String(l.price_date || '')].join('\u0001')).sort().join('\n');
  return a.length === b.length && fp(a) === fp(b);
}
// Writes (or replaces) one month under the lock, validated against schema.gs:
//   1. new lines under a NEW snapshot id (invisible to readers until step 2),
//   2. the header row — appended, or written over the old header in place: the commit point,
//   3. the replaced month's old lines (now orphans) are deleted.
// A crash at any step leaves either the old month or the new one, plus orphans that readers
// ignore and the next run removes. m.expectId = the header id the caller planned against (null =
// "month absent"); if another run changed the month meanwhile, nothing is written → false.
function vzsWriteMonth_(ss, m) {
  return withWriteLock_(() => {
    const tz = ss.getSpreadsheetTimeZone();
    const t = vzsTabs_(ss);                                             // throws on missing tabs / columns
    const snapSh = t.snapSh, lineSh = t.lineSh, sHead = t.sHead, lHead = t.lHead;
    vzsDeleteOrphans_(ss);                                              // leftovers of a crashed attempt

    const heads = snapSh.getLastRow() > 1 ? snapSh.getRange(2, 1, snapSh.getLastRow() - 1, sHead.length).getValues() : [];
    const iMonth = sHead.indexOf('month'), iId = sHead.indexOf('id');
    const oldIdx = heads.findIndex(r => vzsMonthOf_(r[iMonth], tz) === m.month);   // one row per month
    const oldId = oldIdx >= 0 ? vzKey_(heads[oldIdx][iId]) : null;
    if (m.expectId !== undefined && m.expectId !== 'new' && (oldId || null) !== (m.expectId || null)) return false;

    const ctx = vzCtx_(ss);
    const now = new Date().toISOString();
    const snapIds = vzIdBlock_(VZS_SNAPSHOTS, vzsMaxId_(snapSh)), lineIds = vzIdBlock_(VZS_LINES, vzsMaxId_(lineSh));
    const snap = { id: snapIds.next(), month: m.month, snapshot_date: m.date, source: m.source, lines: m.lines.length,
      invested_total: vzsRound_(m.lines.reduce((s, l) => s + l.invested_value, 0), 2),
      current_total: vzsRound_(m.lines.reduce((s, l) => s + l.current_value, 0), 2), notes: m.notes || '', created_at: now };
    vzAssertRow_(ctx, VZS_SNAPSHOTS, snap, oldId);
    if (oldId) ctx.replace(VZS_SNAPSHOTS, oldId, snap); else ctx.add(VZS_SNAPSHOTS, snap);
    const rows = m.lines.map(l => {
      const row = Object.assign({}, l, { id: lineIds.next(), snapshot_id: snap.id, created_at: now });
      vzAssertRow_(ctx, VZS_LINES, row, null);
      ctx.add(VZS_LINES, row);
      return lHead.map(h => (row[h] !== undefined ? row[h] : ''));
    });

    const textCols = (sh, head, row, n) => VZS_TEXT_COLS.forEach(c => {
      const i = head.indexOf(c);
      if (i >= 0) sh.getRange(row, i + 1, n, 1).setNumberFormat('@');
    });
    if (rows.length) {
      const start = lineSh.getLastRow() + 1;
      vzEnsureRows_(lineSh, start + rows.length - 1);
      textCols(lineSh, lHead, start, rows.length);
      lineSh.getRange(start, 1, rows.length, lHead.length).setValues(rows);
      SpreadsheetApp.flush();
    }
    const hRow = oldIdx >= 0 ? oldIdx + 2 : snapSh.getLastRow() + 1;
    vzEnsureRows_(snapSh, hRow);
    textCols(snapSh, sHead, hRow, 1);
    snapSh.getRange(hRow, 1, 1, sHead.length).setValues([sHead.map(h => (snap[h] !== undefined ? snap[h] : ''))]);
    SpreadsheetApp.flush();                                             // ← committed
    snapIds.commit();
    lineIds.commit();
    if (oldId) vzsDeleteWhere_(lineSh, r => vzKey_(r.snapshot_id) === oldId);
    return true;
  });
}
// Both tabs with every expected column — checked BEFORE anything is deleted, so a damaged
// header row can never make every line look orphaned.
function vzsTabs_(ss) {
  const snapSh = ss.getSheetByName(VZS_SNAPSHOTS), lineSh = ss.getSheetByName(VZS_LINES);
  if (!snapSh || !lineSh) throw new Error('snapshot tabs missing — run setupSnapshots() first');
  const sHead = vzsHeaders_(snapSh), lHead = vzsHeaders_(lineSh);
  const missing = VZS_SNAPSHOT_HEADERS.filter(h => sHead.indexOf(h) < 0)
    .concat(VZS_LINE_HEADERS.filter(h => lHead.indexOf(h) < 0));
  if (missing.length) throw new Error('snapshot tabs lack column(s) ' + missing.join(', ') + ' — run setupSnapshots() again');
  return { snapSh, lineSh, sHead, lHead };
}
// Lines whose month header does not exist (crash leftovers / replaced months). Refuses to run on
// a damaged tab: a header row without an id would otherwise make every line look orphaned.
function vzsDeleteOrphans_(ss) {
  vzsTabs_(ss);
  const heads = vzsRows_(ss, VZS_SNAPSHOTS);
  if (heads.some(h => vzKey_(h.id) === '')) throw new Error('a snapshots row has no id — fix the snapshots tab before the next run');
  const ids = new Set(heads.map(h => vzKey_(h.id)));
  vzsDeleteWhere_(ss.getSheetByName(VZS_LINES), r => !ids.has(vzKey_(r.snapshot_id)));
}
// Delete matching rows bottom-up, one deleteRows() call per contiguous run. Returns the count.
function vzsDeleteWhere_(sh, match) {
  if (!sh || sh.getLastRow() < 2) return 0;
  const v = sh.getDataRange().getValues(), h = v[0].map(x => String(x).trim());
  const hit = [];
  for (let i = 1; i < v.length; i++) if (v[i].some(c => c !== '' && c !== null) && match(vzRowObj_(h, v[i]))) hit.push(i + 1);
  for (let j = hit.length - 1; j >= 0; ) {
    let k = j;
    while (k > 0 && hit[k - 1] === hit[k] - 1) k--;
    sh.deleteRows(hit[k], hit[j] - hit[k] + 1);
    j = k - 1;
  }
  return hit.length;
}
// ── Read API (doGet actions snapshotData / snapshotLines / snapshotForm) ─────

// Every visible line of every month in a compact form; the chart filters (category, subcategory,
// asset, year, month) run in the browser. Same hide / account rules as the app. Cached (chunked)
// under a hash of every header (id, date, line count), every hide and the current month, so any
// write, hide change or new month is seen immediately.
//   months: [{ d: as-of date, st: 'open' (this month) | 'locked', src: 'backfill' | 'manual', notes }]   assets: [{ t, id, n: latest name, a: account }]
//   rows:   [monthIdx, assetIdx, invested ₹, value ₹, flag, category, subcategory] — category /
//           subcategory as frozen in that month's line; flag 1 = valued at cost, 2 = old manual price,
//           3 = estimated between your recorded prices (history only)
function vzsData_(account) {
  const ss = getSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const heads = vzsRows_(ss, VZS_SNAPSHOTS), hides = vzsRows_(ss, 'hidden_items');
  const openMonth = vzsThisMonth_(vzsNow_(), tz);
  const version = 'vzs5:' + account + ':' + openMonth + ':' + vzsHash_(heads.map(h => [vzKey_(h.id), vzsIso_(h.snapshot_date, tz), h.lines].join('/')).join(',')) +
                  ':' + vzsHash_(hides.map(h => [vzKey_(h.id), vzKey_(h.account_id), h.kind, h.ref].join('/')).join(','));
  const hit = vzsCacheGet_(version);
  if (hit) return hit;

  const visible = vzsVisibility_(hides, account);
  const months = heads.map(h => { const d = vzsIso_(h.snapshot_date, tz);
    return { id: vzKey_(h.id), d, st: vzsMonthOf_(h.month, tz) === openMonth ? 'open' : 'locked', src: String(h.source || ''), notes: String(h.notes || '') }; })
    .sort((a, b) => (a.d < b.d ? -1 : 1));
  const mIdx = {};
  months.forEach((m, i) => { mIdx[m.id] = i; });
  const assets = [], aIdx = {}, last = [], rows = [];
  vzsRows_(ss, VZS_LINES).forEach(l => {
    const mi = mIdx[vzKey_(l.snapshot_id)];
    if (mi === undefined || !visible(l)) return;                     // orphans (unknown id) are ignored
    const key = l.asset_table + '|' + vzKey_(l.asset_id);
    let ai = aIdx[key];
    if (ai === undefined) { ai = aIdx[key] = assets.length; assets.push({ t: String(l.asset_table), id: vzKey_(l.asset_id) }); last.push(-1); }
    if (mi >= last[ai]) { assets[ai].n = String(l.asset_name); assets[ai].a = vzKey_(l.account_id); last[ai] = mi; }   // latest name
    rows.push([mi, ai, Math.round(Number(l.invested_value) || 0), Math.round(Number(l.current_value) || 0),
      l.price_source === 'cost' ? 1 : l.price_source === 'estimate' ? 3 : vzsIsOld_(l, months[mi].d, tz) ? 2 : 0,
      vzKey_(l.category_id), vzKey_(l.subcategory_id)]);
  });
  const res = { months: months.map(m => ({ d: m.d, st: m.st, src: m.src, notes: m.notes })), assets, rows };
  vzsCachePut_(version, res);
  return res;
}
// One month's lines. A month's lines are written in one block, so only that block is read.
function vzsLinesFor_(dateStr, account) {
  const ss = getSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const head = vzsRows_(ss, VZS_SNAPSHOTS).find(h => vzsIso_(h.snapshot_date, tz) === String(dateStr));
  if (!head) return { date: dateStr, lines: [] };
  const visible = vzsVisibility_(vzsRows_(ss, 'hidden_items'), account);
  return { date: dateStr, status: vzsMonthOf_(head.month, tz) === vzsThisMonth_(vzsNow_(), tz) ? 'open' : 'locked', notes: head.notes || '',
    lines: vzsMonthLines_(ss, vzKey_(head.id)).filter(visible)
      .map(l => Object.assign(vzsLineObj_(l, tz), { old: vzsIsOld_(l, String(dateStr), tz) })) };
}
// Raw line rows of one snapshot id: scan the snapshot_id column, read only the rows that span it.
function vzsMonthLines_(ss, snapId) {
  const sh = ss.getSheetByName(VZS_LINES);
  if (!sh || sh.getLastRow() < 2) return [];
  const h = vzsHeaders_(sh), c = h.indexOf('snapshot_id') + 1, n = sh.getLastRow() - 1;
  if (c < 1) return [];
  const ids = sh.getRange(2, c, n, 1).getValues();
  let lo = -1, hi = -1;
  ids.forEach((r, i) => { if (vzKey_(r[0]) === snapId) { if (lo < 0) lo = i; hi = i; } });
  if (lo < 0) return [];
  return sh.getRange(lo + 2, 1, hi - lo + 1, h.length).getValues()
    .map(r => vzRowObj_(h, r)).filter(l => vzKey_(l.snapshot_id) === snapId);
}
// For the app's "Take snapshot" panel: this month, whether it is taken (and as of which day),
// and the manual-priced holdings with their latest price (the form's starting values).
function vzsForm_() {
  const ss = getSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(vzsNow_(), tz, 'yyyy-MM-dd'), month = today.slice(0, 7);
  const head = vzsRows_(ss, VZS_SNAPSHOTS).find(h => vzsMonthOf_(h.month, tz) === month);
  const data = vzsLoad_(ss);
  return { today, month,
    taken: head ? { date: vzsIso_(head.snapshot_date, tz), source: String(head.source || ''), lines: Number(head.lines) || 0,
                    invested: Number(head.invested_total) || 0, value: Number(head.current_total) || 0, notes: String(head.notes || '') } : null,
    manual: vzsManualHeld_(data, today, tz),
    epfTyped: (data.epf_assets || []).filter(a => String(a.is_active).toUpperCase() === 'TRUE' && Number(a.current_balance) &&
      !(data.epf_transactions || []).some(t => vzKey_(t.account_id) === vzKey_(a.account_id)))
      .map(a => ({ name: String(a.account_name || ''), balance: Number(a.current_balance) })) };
}

// A manual price from before the previous month → "old" for this month.
function vzsIsOld_(l, dateStr, tz) {
  if (String(l.price_source) !== 'manual') return false;
  const pd = vzsIso_(l.price_date, tz);
  return !!pd && pd < vzsOldBefore_(String(dateStr));
}

// Mirrors HIDDEN._hit + ACCOUNTS.matches in js/api.js: a hide applies when it is global (account '')
// or scoped to the account being viewed; a specific account sees only its own lines.
function vzsVisibility_(hidden, account) {
  const acc = String(account || 'all');
  const hides = hidden.filter(h => { const a = vzKey_(h.account_id); return a === '' || (acc !== 'all' && a === acc); });
  const hit = (kind, ref) => hides.some(h => String(h.kind) === kind && String(h.ref) === String(ref));
  return l => {
    if (acc !== 'all' && vzKey_(l.account_id) !== acc) return false;
    if (hit('category', vzKey_(l.category_id))) return false;
    if (vzKey_(l.subcategory_id) !== '' && hit('subcategory', vzKey_(l.subcategory_id))) return false;
    if (hit('asset', l.asset_table + '|' + vzKey_(l.asset_id))) return false;
    return true;
  };
}
// CacheService holds ≤100 KB per key → store big payloads in chunks under one version key.
function vzsCacheGet_(version) {
  try {
    const c = CacheService.getScriptCache();
    const n = Number(c.get(version + ':n'));
    if (!n) return null;
    let s = '';
    for (let i = 0; i < n; i++) { const part = c.get(version + ':' + i); if (part === null) return null; s += part; }
    return JSON.parse(s);
  } catch (e) { return null; }
}
function vzsCachePut_(version, obj) {
  try {
    const s = JSON.stringify(obj), size = 90000, n = Math.ceil(s.length / size);
    if (n > 40) return;                                                 // too big to be worth caching
    const c = CacheService.getScriptCache();
    for (let i = 0; i < n; i++) c.put(version + ':' + i, s.slice(i * size, (i + 1) * size), 21600);
    c.put(version + ':n', String(n), 21600);
  } catch (e) { /* uncached */ }
}
// ── Helpers ──────────────────────────────────────────────────────────────────

function vzsLineObj_(l, tz) {
  return { snapshot_date: vzsIso_(l.snapshot_date, tz), account_id: vzKey_(l.account_id), bucket_id: vzKey_(l.bucket_id),
    category_id: vzKey_(l.category_id), subcategory_id: vzKey_(l.subcategory_id), asset_table: String(l.asset_table),
    asset_id: vzKey_(l.asset_id), asset_name: String(l.asset_name), units: l.units, invested_value: Number(l.invested_value) || 0,
    price: l.price, current_value: Number(l.current_value) || 0, price_source: String(l.price_source),
    price_date: vzsIso_(l.price_date, tz) };
}
function vzsCatBuckets_(data) {
  const m = {};
  (data.categories || []).forEach(c => { m[vzKey_(c.id)] = Number(c.bucket_id) || ''; });
  return m;
}
// Asset rows are de-duplicated by id (first wins) so a pasted duplicate can neither double-count
// nor block every month on the UNIQUE check; data.__dupes lists what was skipped.
function vzsLoad_(ss) {
  const data = { __dupes: [] };
  ['categories', 'manual_prices', 'us_wires', 'us_repatriations', 'us_income']
    .concat(VZS_STREAMS.map(s => s.assets), VZS_STREAMS.filter(s => s.txns).map(s => s.txns))
    .forEach(t => { if (!data[t]) data[t] = vzsRows_(ss, t); });
  VZS_STREAMS.forEach(st => {
    const seen = {};
    data[st.assets] = data[st.assets].filter(a => {
      const k = vzKey_(a.id);
      if (!seen[k]) { seen[k] = true; return true; }
      data.__dupes.push(st.assets + ' has two rows with id ' + k + ' — the second is ignored; fix the sheet');
      return false;
    });
  });
  return data;
}
function vzsRows_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getValues();
  const h = v[0].map(x => String(x).trim());
  return v.slice(1).filter(r => r.some(c => c !== '' && c !== null)).map(r => vzRowObj_(h, r));
}
function vzsHeaders_(sh) {
  return sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(h => String(h).trim());
}
function vzsMaxId_(sh) {
  if (sh.getLastRow() < 2) return 0;
  return sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
    .reduce((m, r) => { const v = Number(r[0]); return isFinite(v) && v > m ? v : m; }, 0);
}
function vzsFirstTxnDate_(data) {
  let first = null;
  VZS_STREAMS.filter(s => s.txns).forEach(s => (data[s.txns] || []).forEach(t => {
    const d = vzsAsDate_(t.txn_date);
    if (d && (!first || d < first)) first = d;
  }));
  return first;
}
function vzsAsDate_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  return null;
}
// Dates kept as text; a Date cell (older / hand-edited row) is formatted in the sheet tz.
function vzsIso_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}
// The one place the engine reads the clock.
function vzsNow_() { return new Date(); }
// ── Calendar (all 'yyyy-mm' / 'yyyy-mm-dd' strings in the spreadsheet's timezone) ──

function vzsPad2_(n) { return ('0' + n).slice(-2); }
function vzsNextMonth_(ym) {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  return m === 12 ? (y + 1) + '-01' : y + '-' + vzsPad2_(m + 1);
}
function vzsPrevMonth_(ym) {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  return m === 1 ? (y - 1) + '-12' : y + '-' + vzsPad2_(m - 1);
}
// Last calendar day of the month.
function vzsMonthEnd_(ym) {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  return ym.slice(0, 7) + '-' + vzsPad2_(new Date(Date.UTC(y, m, 0)).getUTCDate());
}
function vzsNextDay_(iso) {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + 1));
  return d.getUTCFullYear() + '-' + vzsPad2_(d.getUTCMonth() + 1) + '-' + vzsPad2_(d.getUTCDate());
}
// 00:00 on the day after the as-of day — holdings are everything dated before this.
function vzsCutoff_(iso, tz) { return Utilities.parseDate(vzsNextDay_(iso), tz, 'yyyy-MM-dd'); }
// A manual price dated before this (the 1st of the previous month) counts as "old".
function vzsOldBefore_(iso) { return vzsPrevMonth_(iso.slice(0, 7)) + '-01'; }
function vzsThisMonth_(now, tz) { return Utilities.formatDate(now, tz, 'yyyy-MM'); }
// A month cell as 'yyyy-mm' (text, or a Date if Sheets converted it).
function vzsMonthOf_(v, tz) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM') : String(v || '').slice(0, 7); }

// Short stable hash (djb2) for cache keys.
function vzsHash_(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + '.' + str.length.toString(36);
}
function vzsRound_(v, dp) { const f = Math.pow(10, dp); return Math.round((Number(v) || 0) * f) / f; }
function vzsNotify_(title, log) {
  const text = 'VaultZero snapshots — ' + title + '\n\n' + log.slice(0, 60).join('\n') +
               (log.length > 60 ? '\n… and ' + (log.length - 60) + ' more' : '');
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert(text.slice(0, 1800)); } catch (e) { /* editor / trigger: log only */ }
}
