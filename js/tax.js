// VaultZero — Insights → Tax: capital-gains tax for this financial year, lot by lot (FIFO) with the
// current rules — on gains already booked, and if everything held were also sold today. Maths in
// js/fund-engine.js (computeTaxEstimate, TAX_RULES); facts only. Tax is per person, so with All
// accounts each account gets its own estimate.

// ── Constants & state ─────────────────────────────────────────────────────────

const TAX_CATS = [1, 2, 3, 4, 5, 8, 9];   // everything sold for a capital gain (EPF and bank are not)
const TAX_SOURCES = [
  ['Tax on long-term capital gains', 'https://www.incometaxindia.gov.in/w/tax-on-long-term-capital-gains%E2%80%8B'],
  ['Tax on short-term capital gains', 'https://www.incometaxindia.gov.in/w/tax-on-short-term-capital-gains%E2%80%8B'],
  ['Taxation of virtual digital assets', 'https://incometaxindia.gov.in/w/taxation-of-virtual-digital-asset-vda-'],
  ['CBDT FAQ on the July 2024 changes', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2036604'],
];
// What · long-term after · long-term rate · short-term rate (the rules TAX_RULES encodes)
const TAX_TABLE = [
  ['Listed shares, equity funds, arbitrage funds', 'more than 12 months', '12.5% on gains above ₹1.25 lakh a year', '20%'],
  ['Gold & silver ETFs', 'more than 12 months', '12.5%', 'slab rate'],
  ['US shares & ETFs', 'more than 24 months', '12.5%', 'slab rate'],
  ['Physical gold & silver', 'more than 24 months', '12.5%', 'slab rate'],
  ['Land & buildings', 'more than 24 months', '12.5% (bought before 23 Jul 2024: or 20% with indexation, if lower — not applied here)', 'slab rate'],
  ['Debt funds bought from 1 Apr 2023', 'never', 'slab rate', 'slab rate'],
  ['Debt funds bought before 1 Apr 2023', 'more than 24 months', '12.5%', 'slab rate'],
  ['Crypto', 'no difference', '30%; no loss can reduce it, and a crypto loss reduces nothing', '30%'],
];
let _taxReq = 0;   // the latest drawTax() call wins


// ── Helpers ───────────────────────────────────────────────────────────────────

function taxRate(rate) {
  return rate === 'slab' ? 'slab rate' : `${+(rate * 100).toFixed(1)}%`;
}

function taxFyLabel(fyStart) {
  const y = Number(fyStart.slice(0, 4));
  return `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

// The holding's kind, as the rules table names it.
function taxKind(r) {
  if (r.rule === 'debtMixed') return 'Debt fund (bought before and after 1 Apr 2023)';
  if (r.rule !== 'other') return TAX_RULES[r.rule].label;
  const kinds = { 3: 'US shares & ETFs', 4: 'Land & buildings', 5: 'Debt fund (bought before 1 Apr 2023)', 8: 'Physical gold & silver' };
  return kinds[Number(r.cat)] || TAX_RULES.other.label;
}

// A text cell in a sortable money column: sorts below every number.
function taxTextCell(text) {
  return `<td data-sort="-Infinity">${text}</td>`;
}


// ── DOM builders ──────────────────────────────────────────────────────────────

// who: the account's name when All accounts shows one estimate per person ('' otherwise).
// usNote: how US sales were converted to rupees ('' when there were none this year).
function buildTaxSummary(est, who, usNote) {
  const b = est.booked, all = est.ifSold;
  const extra = all.tax - b.tax;
  const less = extra < -0.5;
  const left = TAX_EQUITY_EXEMPT - b.lines.find(l => l.key === 'eqLT').exempt;
  const foot = [`Gains booked = sales from ${fmtDay(est.fyStart)} to today. Tax includes 4% cess; no surcharge (it applies only
    above ₹50 lakh of income). Gains taxed at your slab rate are added to your income, so they have no ₹ figure here. Only this
    year's losses are used; losses carried forward from earlier years are not included.`];
  if (b.lossLeft >= 1) foot.push(`Losses booked this year not used against a gain: ${fmtRupees(b.lossLeft)} (they can be carried forward for 8 years if the return is filed on time).`);
  if (usNote) foot.push(usNote);
  if (est.unpriced.length) foot.push(`No price on record, left out of "if all sold": ${est.unpriced.map(n => attrShort(n, 28)).join(', ')}.`);
  if (est.locked.length) {
    foot.push('ELSS units still in their 3-year lock-in cannot be sold, so they are left out of "if all sold": ' +
      est.locked.map(x => `${attrShort(x.name, 28)} ${fmtRupees(x.value)} (${x.first === x.until ? `free from ${fmtDay(x.until)}`
        : `frees up in parts, ${fmtDay(x.first)} to ${fmtDay(x.until)}`})`).join(', ') + '.');
  }
  let change = `Selling everything else today would add about ${fmtRupees(extra)}`;
  if (less) change = `Selling everything else today would lower it by about ${fmtRupees(-extra)}, because losses on what is held would set off gains already booked`;
  const example = `This year so far, sales carry about ${fmtRupees(b.tax)} of tax at fixed rates. ${change}; on top, ` +
    `${fmtRupees(all.slabGain)} of gains (booked and held) would be taxed at the slab rate.`;
  let tone = '';
  if (extra > 0.5) tone = 'negative';
  else if (less) tone = 'positive';
  return fsCard(`Tax estimate · ${taxFyLabel(est.fyStart)}${who ? ' · ' + snapEsc(who) : ''}`, `
    <div class="fs-returns pos-tiles">
      ${posTile('Booked this year', fmtRupees(b.tax), 'tax on gains already booked by selling', b.tax > 0.5 ? 'negative' : '')}
      ${posTile('If all held were sold today', fmtRupees(Math.abs(extra)), less ? 'less than booked: losses held set off booked gains' : 'more, on top of booked', tone)}
      ${posTile('Equity exemption left', fmtRupees(left), `of ${fmtRupees(TAX_EQUITY_EXEMPT)} this year`)}
      ${posTile('Gains at your slab rate', fmtRupees(b.slabGain), `booked · ${fmtRupees(all.slabGain)} if all sold`)}
    </div>
    <div class="fs-foot">${snapEsc(foot.join(' '))} Estimate from your recorded transactions — not a tax computation.</div>`,
    '', 'tax_estimate', example);
}

function buildTaxLines(est, who) {
  const b = est.booked, all = est.ifSold;
  const rate = l => (l.key === 'eqLT' ? '12.5% over ₹1.25L' : taxRate(l.rate));
  const tax = l => (l.tax === null ? '—' : fmtRupees(l.tax));
  const rows = b.lines.map((l, i) => {
    const a = all.lines[i];
    return `<tr><td>${snapEsc(l.label)}</td><td>${rate(l)}</td>
      <td>${fmtRupees(l.gain)}</td><td>${tax(l)}</td><td>${fmtRupees(a.gain)}</td><td>${tax(a)}</td></tr>`;
  }).join('');
  return fsCard(`How the estimate adds up${who ? ' · ' + snapEsc(who) : ''}`, `
    <div class="report-table-wrap"><table class="report-table attr-table tax-table">
      <thead><tr><th>Kind of gain</th><th>Rate</th><th>Booked: gain</th><th>Booked: tax</th><th>If all sold: gain</th><th>If all sold: tax</th></tr></thead>
      <tbody>${rows}
        <tr><td>Cess 4%</td><td></td><td></td><td>${fmtRupees(b.cess)}</td><td></td><td>${fmtRupees(all.cess)}</td></tr>
        <tr class="total-row"><td>Total</td><td></td><td></td><td>${fmtRupees(b.tax)}</td><td></td><td>${fmtRupees(all.tax)}</td></tr>
      </tbody></table></div>
    <div class="fs-foot">Gains after losses are set off: a short-term loss against any gain except crypto, a long-term loss only
      against long-term gains, nothing against crypto — the highest-taxed gains first, taking your slab rate as at least 20%.
      "If all sold" = booked + everything held.</div>`, '', 'tax_lines');
}

function buildTaxHoldings(est, today, who) {
  const money = v => `<td class="${fsTone(v, 0)}" data-sort="${v}">${fmtRupees(v, true)}</td>`;
  const body = est.rows.map(r => {
    let next = '—';
    if (r.nextLT) next = `${fmtDay(r.nextLT.d)} · ${fmtRupees(r.nextLT.gain, true)}`;
    let gain = money(r.gain), lt = r.lt === null ? taxTextCell('n/a') : money(r.lt);
    if (r.unpriced) { gain = taxTextCell('no price'); lt = taxTextCell('—'); }
    if (!r.open) { gain = taxTextCell('sold'); lt = taxTextCell('—'); }
    return `<tr><td>${snapEsc(attrShort(r.name, 30))}${r.locked ? ' <span class="attr-muted">part locked</span>' : ''}</td>
      <td>${snapEsc(taxKind(r))}</td>${gain}${lt}${money(r.booked)}
      <td data-sort="${r.nextLT ? posDateSort(r.nextLT.d) : '-Infinity'}">${snapEsc(next)}</td></tr>`;
  }).join('');
  return fsCard(`By holding${who ? ' · ' + snapEsc(who) : ''}`, `
    <div class="report-table-wrap"><table class="report-table attr-table tax-table tax-sort">
      <thead><tr><th>Holding</th><th>Rule</th><th>Gain now</th><th>of it long-term</th><th>Booked this year</th><th>Next lot turns long-term</th></tr></thead>
      <tbody>${body}</tbody></table></div>
    <div class="fs-foot">Gain now = value today − the cost of the lots held (FIFO), so it can differ a little from P&amp;L by holding
      (average cost). Next lot = the earliest short-term lot and its gain today. "part locked" = some ELSS units are still in their
      3-year lock-in. As of ${snapEsc(fmtDay(today))}; tap a column to sort.</div>`, '', 'tax_holdings');
}

function buildTaxRules() {
  const rows = TAX_TABLE.map(r => `<tr>${r.map(c => `<td>${snapEsc(c)}</td>`).join('')}</tr>`).join('');
  const links = TAX_SOURCES.map(([label, url]) => `<li><a href="${url}" target="_blank" rel="noopener noreferrer">${snapEsc(label)}</a></li>`).join('');
  return fsCard('The rules used', `
    <div class="report-table-wrap"><table class="report-table attr-table tax-rules">
      <thead><tr><th>What</th><th>Long-term after</th><th>Long-term rate</th><th>Short-term rate</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="fs-foot">Resident individual; sales from 23 Jul 2024 (rates unchanged by Budget 2026; Income-tax Act 2025 s.196–198 from
      1 Apr 2026). Plus 4% cess. Not applied: surcharge; the 31 Jan 2018 price for shares and equity funds bought before 1 Feb 2018
      (grandfathering); the land indexation option; losses carried forward from earlier years; 1% TDS on crypto sales (it counts
      toward the tax, not on top). Source: Income Tax Department —</div>
    <ul class="gd-list tax-sources">${links}</ul>`, '', 'tax_rules');
}


// ── Render ────────────────────────────────────────────────────────────────────

function renderTaxTab(container, rawData) {
  const scope = document.createElement('div');
  scope.className = 'fs-scope';
  scope.textContent = 'Tax = everything sold for a capital gain: equity and debt funds, stocks, US equity, precious metals, land ' +
    'and crypto, from your transactions (EPF, bank and hidden items are not). Tax is per person: with All accounts each account ' +
    'gets its own estimate. The filters above do not apply.';
  container.appendChild(scope);
  const body = document.createElement('div');
  body.id = 'tax-body';
  body.appendChild(fsCard('Tax estimate', '<p class="chart-empty">Loading…</p>'));
  container.appendChild(body);
  requestAnimationFrame(() => { drawTax(body, rawData); });
}

async function drawTax(body, rawData) {
  const account = String(ACCOUNTS.current);
  const req = ++_taxReq;
  let usdInr = [], benchError = '';
  try {
    const data = await fetchFactsheetData(account);
    if (data.benchError) benchError = data.benchError;
    else if (!data.redeploy) usdInr = computeBenchSeries(data.benchRows).usd_inr || [];
  } catch (e) {
    benchError = e.message;
  }
  if (!body.isConnected || req !== _taxReq || String(ACCOUNTS.current) !== account) return;
  body.innerHTML = '';
  const today = localYMD(new Date());
  const fyStart = taxFyStart(today);
  const live = [], saleDay = [];   // US sales this year at today's rate (no value on file) / at the sale day's
  const rate = d => {
    const r = taxUsdInrOn(usdInr, d);
    if (d >= fyStart && !r.on && !live.includes(d)) live.push(d);
    if (d >= fyStart && r.on === 'saleDay' && !saleDay.includes(d)) saleDay.push(d);
    return r.v;
  };
  let inputs;
  try {
    inputs = buildPositionInputs(rawData, undefined, cat => TAX_CATS.includes(Number(cat)), rate);
  } catch (e) {
    body.appendChild(fsCard('Tax estimate', `<p class="chart-empty">Tax estimate unavailable: ${snapEsc(e.message)}</p>`));
    return;
  }
  const usNote = list => {
    const sold = list.filter(p => Number(p.cat) === 3 && p.txns.some(t => !t.buy && t.d >= fyStart && t.d <= today));
    if (!sold.length) return '';
    const ofThese = list => list.filter(d => sold.some(p => p.txns.some(t => !t.buy && t.d === d)));
    const days = ofThese(live), dayRate = ofThese(saleDay);
    let note = 'US sales are converted at the USD/INR rate on the last day of the month before each sale (Yahoo\'s rate; the tax ' +
      'rule uses SBI\'s buying rate that day); their cost is the rupees your wires paid.';
    if (dayRate.length) note += ` No month-end rate on file for the sales on ${dayRate.map(fmtDay).join(', ')}: those use the sale day's rate.`;
    if (days.length) note += ` No rate on file${benchError ? ` (${benchError})` : ''} for the sales on ${days.map(fmtDay).join(', ')}: those use today's rate.`;
    return note;
  };
  // One estimate per person: under All accounts, group by account.
  const groups = {};
  inputs.forEach(p => { (groups[String(p.account)] = groups[String(p.account)] || []).push(p); });
  const keys = Object.keys(groups);
  const named = ACCOUNTS.isAll() && keys.length > 1;
  const sections = named ? keys.map(k => ({ who: ACCOUNTS.name(k) || `Account ${k}`, inputs: groups[k] })) : [{ who: '', inputs }];
  sections.forEach(sec => {
    const est = computeTaxEstimate(sec.inputs, today);
    if (named && !est.rows.length && !est.locked.length) return;
    body.appendChild(buildTaxSummary(est, sec.who, usNote(sec.inputs)));
    body.appendChild(buildTaxLines(est, sec.who));
    if (est.rows.length) body.appendChild(buildTaxHoldings(est, today, sec.who));
  });
  body.appendChild(buildTaxRules());
  body.querySelectorAll('.tax-sort').forEach(t => makeTableSortable(t));
}
