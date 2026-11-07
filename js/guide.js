// VaultZero — the plain-English guide to Insights: what each number means, how it is worked out and
// how to read it. A card's ⓘ opens its entry (fsCard's help key, with a line on the card's own
// numbers); the Guide tab teaches them in order, with the pattern types and a glossary.
// Definitions and facts only — no advice.

// ── Card entries ──────────────────────────────────────────────────────────────
// what: what the card shows · how: how it is worked out · read: how to read it

const GUIDE = {
  fund: {
    title: 'Fund headline',
    what: 'Everything you invest for growth, treated as one mutual fund you run yourself: its value today, the change since the last snapshot, and its return over 1 month to 3 years, each next to Nifty 50.',
    how: 'Returns are time-weighted (TWR). Each month\'s market gain or loss is divided by what the fund was worth at the previous snapshot, plus half of any money added (or minus half of any taken out) during the month — on average that money was invested for half the month. The monthly results are then multiplied together: 1.02 × 0.99 × … . Money you add or take out never counts as a gain or a loss. "Market move" is the part of the change caused by prices; "net new money" is what you added minus what you took out.',
    read: 'The big % is your return. Below it: Nifty 50\'s return over the same dates, then the gap in points (pts) — above zero means your fund did better than the index over that window. "p.a." = per year: a return over several years turned into a yearly rate. "needs N more months" = not enough monthly snapshots yet for that window.',
  },
  growth: {
    title: 'Growth of ₹100',
    what: 'What ₹100 put in at the first snapshot would be worth now if no money had been added or taken out. The dashed line is the same ₹100 in Nifty 50.',
    how: 'Start at 100 and multiply by (1 + each month\'s time-weighted return).',
    read: 'Where your line is above the index line, your fund has grown more since the start. Dips are falls; the line only shows market moves, never your deposits.',
  },
  calendar: {
    title: 'Calendar-year returns',
    what: 'Your return for each January–December year, next to the index\'s.',
    how: 'The monthly returns inside the year, chained. A year needs a snapshot for every month from the December before to its own December (13 in all); a year without that (it started before your first snapshot, a month is missing, or it is not over yet) is left off the chart and listed under it.',
    read: 'Good and bad years side by side show how uneven yearly returns are, even when the long-run result is steady.',
  },
  rolling: {
    title: 'Rolling 1-year return',
    what: 'The 1-year return measured at every month-end, not only in December. Each point is "the 12 months ending here".',
    how: 'For every month: the chained return of the 12 months before it, and the same for the index. Needs 24 snapshots in a row.',
    read: '"Ahead in 8 of 12 periods" = in 8 of the 12-month windows your fund finished in front of the index. It shows how often you were ahead, whatever month someone started measuring.',
  },
  risk: {
    title: 'Risk: volatility and drawdowns',
    what: 'How bumpy the ride has been. Volatility = how much the monthly returns swing. Drawdown = how far the fund fell from a high.',
    how: 'Volatility p.a. = how far a typical month\'s return lands from the average month — the standard deviation; for roughly bell-shaped returns about two months in three fall within it — over the latest 36 months at most, turned into a yearly figure by multiplying by √12 ≈ 3.5 (ups and downs partly cancel over a year, so it is not × 12). Max drawdown = the biggest fall from any high to a later low on the growth-of-₹100 line. Current drawdown = how far below its latest high it is now. Recovery = months from the low back to the old high.',
    read: 'Higher volatility = bigger swings, both up and down. A max drawdown of −20% means that at the worst point, ₹100 at the high had become ₹80. Volatility and max drawdown have Nifty 50\'s figure beside them for comparison. Because these use the ₹100 line, new money you added can\'t hide a fall.',
  },
  contrib: {
    title: 'Money put in vs market',
    what: 'Today\'s value split into the money you put in and what the market added on top.',
    how: 'Net money put in = everything added − everything taken out (an amount taken out is estimated from the holding\'s average gain that month). Market added = the first snapshot\'s gain plus every later month\'s market move, plus revaluations (a holding first priced after being held at cost). The two add up to the value. Growth share = market added ÷ value.',
    read: 'In the early years most of the value is your own money; the market\'s share grows as returns build on themselves (compounding) — and shrinks in a fall.',
  },
  note: {
    title: 'Manager\'s note',
    what: 'A short summary written automatically each month from the snapshots: the month\'s return against the index, the biggest movers and what changed.',
    how: 'Built from the latest two snapshots. With All accounts it is saved when the month\'s snapshot is taken, so earlier months stay readable.',
    read: 'A monthly diary of the fund, in numbers. It describes what happened; it does not say what to do.',
  },
  patterns: {
    title: 'What\'s happening',
    what: 'Short fact cards about what stands out: streaks, falls from a high, holdings with no new high for a long time, weight changes, tax position and more.',
    how: 'Each kind of card has a fixed rule (for example "4 months in a row in the same direction") and shows only when the rule is met and enough months of data exist. The cards are ordered by how many rupees they involve.',
    read: '"since Mar 26" = the pattern has shown every month since then; "new this month" = first time. The ⓘ on a card explains that kind of card. They describe the past; they are not advice.',
  },
  trends_table: {
    title: 'Trends: every holding vs its own benchmark',
    what: 'Each holding against the index that matches it (a small-cap fund against a small-cap index, a gold ETF against gold), and how long since it made a new high.',
    how: '1Y / 3Y vs bench = the holding\'s time-weighted return − its index\'s (3Y as a yearly rate). Since high = months since its growth line (returns only, like Growth of ₹100 — buying and selling do not move it) last made a new high, within its latest unbroken run of monthly snapshots. From high = how far that line is below its high now.',
    read: 'A negative gap = the holding did worse than its own index over that window. "Stagnation" counts how many of its stagnation rules are met — the cards below list each rule.',
  },
  trends_cards: {
    title: 'Holding by holding',
    what: 'A small chart per holding — its growth line (solid; returns only, so purchases and sales do not move it) against its index started at the same level (dashed) — with its 6-month, 1-year and 3-year numbers and its stagnation rules.',
    how: 'Indian funds, US shares & ETFs, and metals: no new high for 12+ months, or a 3-year return 3+ pts a year behind the index. Indian stocks and crypto: no new high for 6+ months, or 6 months within ±5% of the middle of their range.',
    read: '● met · ○ not met · … not enough months yet · – can\'t be tested (no matching index, or values estimated from the index). A met rule is a fact about the past.',
  },
  attr_holding: {
    title: 'Contribution to return · by holding',
    what: 'Which holdings made the fund\'s return over the period you pick, and which pulled it down.',
    how: 'Contribution = the holding\'s ₹ market move each month ÷ the fund\'s value that month, linked across the months so that all holdings add up exactly to the fund\'s return. Roughly weight × return: a holding that is 20% of the fund and rises 10% adds about 2 pts.',
    read: 'A big holding with a small return can add more than a small holding with a big return. The contributions (pts) add up to the fund\'s return shown at the top of the card.',
  },
  attr_sleeve: {
    title: 'Contribution to return · by sleeve',
    what: 'The same split, by sleeve: Indian equity, precious metals, US equity and crypto.',
    how: 'The sum of the contributions of the holdings in each sleeve.',
    read: 'Shows which part of the fund the period\'s return came from.',
  },
  attr_vs_bench: {
    title: 'Holdings vs their own benchmark',
    what: 'Each holding\'s return minus its own index\'s, over 1 year or 3 years.',
    how: 'Only holdings held and priced for the whole window. Holdings valued from estimated prices are left out — they were estimated from the index, so comparing them with it would be circular.',
    read: 'A bar to the right = the holding beat its index by that many pts; to the left = it trailed.',
  },
  attr_share: {
    title: 'Share of the move vs share of capital',
    what: 'How much money sits in a holding next to how much of the fund\'s movement it caused.',
    how: 'Share of capital = its average money over the period ÷ the fund\'s. Share of the move = its ₹ gain or loss ÷ all holdings\' gains and losses added together, ignoring the sign.',
    read: 'A holding with 10% of the money but 30% of the move swings the fund far more than its size — high-swing assets such as crypto often look like this.',
  },
  pnl: {
    title: 'P&L by holding',
    what: 'Profit and loss of every holding, in rupees and %.',
    how: 'Average-cost method (as on Holdings). Invested = the cost of the units held. Unrealized = value now − that cost (a paper gain, not yet sold). Realized = what sales brought in − what those units cost. Total = both; Total % = total ÷ everything ever bought.',
    read: 'Unrealized moves with prices every day; realized is locked in. "at cost" = no price on record, so its gain shows as zero.',
  },
  closed: {
    title: 'Closed positions',
    what: 'Holdings you have sold completely.',
    how: 'Win rate = the share of them closed with a gain. Average win / loss in ₹ and as a % of the cost of the units sold. Held = first purchase → last sale.',
    read: 'A record of finished trades: how many ended up, how many down, and by how much.',
  },
  picks: {
    title: 'Stock picks vs the index twin',
    what: 'Whether your Indian stocks did better than the same money put into Nifty 50 on the same days.',
    how: 'Every purchase of a stock is copied into the index that day (its "index twin"); every sale takes the same ₹ out of the twin. Gap = the stock\'s value − its twin\'s value. XIRR = the yearly return of your actual cash flows, with the twin\'s beside it. If a sale takes out more ₹ than the twin holds, the twin goes below zero, and that shortfall counts in your favour in the gap.',
    read: 'A positive gap = the stock is ahead of its twin. Hit rate = how many stocks are at or above their twin.',
  },
  concentration: {
    title: 'Concentration',
    what: 'How much of the fund sits in a few holdings.',
    how: 'Top-5 weight = the five largest holdings\' share of the fund. Effective holdings = 1 ÷ (the sum of every weight squared): 4 equal holdings → 4; one at 70% and three at 10% → about 1.9.',
    read: 'The lower the effective number, the more the fund behaves like a few holdings. The small lines show how each number has moved over the snapshots.',
  },
  mandate: {
    title: 'Weights vs mandate',
    what: 'Your planned weights (the mandate) next to the actual weights at the latest snapshot.',
    how: 'Mandate = the targets in MANDATE (js/data.js), scaled to 100%. Gap = actual − mandate, in pts. Gap ₹ = gap × the fund\'s value.',
    read: 'A positive gap = more money there than the plan says; negative = less. "Other" = holdings the mandate does not name.',
  },
  drift: {
    title: 'Weight drift',
    what: 'How each sleeve\'s share of the fund changed over 6 or 12 months, and what caused it.',
    how: 'Market = the change prices alone would have made. Money in/out = the change from money added or taken out. Market + money in/out = the change.',
    read: '"+4 pts market" = prices alone pushed that sleeve up by 4 points of the fund.',
  },
  activity: {
    title: 'Activity',
    what: 'How much you bought and sold, by month and by year.',
    how: 'Turnover = sold ÷ the fund\'s average snapshot value in that year.',
    read: '10% turnover = sales worth a tenth of the fund in that year.',
  },
  us_split: {
    title: 'US equity: stock move vs USD/INR',
    what: 'Your US holdings\' rupee result split into the stock price change (in dollars) and the change in the dollar–rupee rate.',
    how: 'Stock move = (value $ − cost $) × the rate you paid. USD/INR move = value $ × (the rate now − the rate you paid). Together they make the rupee result.',
    read: 'When the rupee weakens, US holdings gain in rupees even if the stocks are flat — and the reverse.',
  },
  tax_estimate: {
    title: 'Tax estimate',
    what: 'Capital-gains tax for this financial year (1 April – 31 March): on gains already booked by selling, and what it would be if everything held were also sold today.',
    how: 'Every purchase (a "lot") is tracked on its own, and sales use the oldest units first (FIFO), as the tax law does. Each lot is long-term or short-term by how long it was held. US sales are converted at the USD/INR rate on the last day of the month before the sale, as the tax rule reads. ELSS units still in their 3-year lock-in cannot be sold, so they stay out of "if all sold". Includes 4% cess; no surcharge (it applies only above ₹50 lakh of income).',
    read: '"Booked" = tax on this year\'s sales so far. "If all sold today" is hypothetical — a measure of the tax inside your gains. Gains taxed at your slab rate show in ₹ with no tax figure, because that rate depends on your income.',
  },
  tax_lines: {
    title: 'How the estimate adds up',
    what: 'The estimate by kind of gain.',
    how: 'Losses first (set off): a short-term loss can reduce any gain except crypto; a long-term loss only long-term gains. Crypto stands apart: no loss reduces a crypto gain, and a crypto loss reduces nothing. Only this year\'s losses are used — losses carried forward from earlier years are not included. Then the first ₹1.25 lakh of long-term gains on listed shares and equity funds each year is tax-free.',
    read: 'Each row: the gain after losses, its rate, and the tax. Slab-rate gains are added to your income. With All accounts, each person gets their own estimate — the exemption and set-off are per person.',
  },
  tax_holdings: {
    title: 'Tax by holding',
    what: 'Each holding\'s gain now, how much of it is long-term, gains booked this year, and when its next short-term lot turns long-term.',
    how: 'From the FIFO lots, at today\'s prices. These gains can differ a little from P&L by holding, which uses average cost.',
    read: '"Turns long-term" = the first day that lot counts as held long enough for the long-term rate.',
  },
  tax_rules: {
    title: 'The rules used',
    what: 'The holding periods and rates the estimate uses, for a resident individual, from the Income Tax Department\'s pages.',
    how: 'Rates for sales from 23 July 2024; unchanged by Budget 2026. The Income-tax Act 2025 applies from 1 April 2026 with new section numbers.',
    read: 'Long-term = held for more than the months shown. Slab rate = added to your income and taxed at the rate of the income band it falls in (see the glossary).',
  },
  snapshots: {
    title: 'Monthly snapshots',
    what: 'Every snapshot taken so far: what the holdings had cost (Invested) and what they were worth (Value), month by month or year by year.',
    how: 'It adds up every category the snapshots record — EPF, debt funds and land included — unless its own filters narrow it. Invested = the cost of the units still held (average cost); Value = their price at the snapshot.',
    read: 'This is why its numbers differ from the Fund above, which counts only the fund\'s categories. Invested also differs from "Net money put in": after a sale, Invested drops by the cost of the units sold, while Net money put in drops by the amount taken out (estimated from the holding\'s average gain that month).',
  },
  nw_growth: {
    title: 'Portfolio Growth',
    what: 'Everything bought and sold through transactions (debt funds and land included; EPF and bank balances are not) — the running total of money invested, month by month, with today\'s value as a line across it.',
    how: 'Invested = each month\'s purchases added and the cost of what was sold taken off. Only today\'s value is known here, so it is drawn flat; the monthly history of value is on the Factsheet (fund only) and the snapshots card.',
    read: 'The gap between the end of the invested line and the value line is today\'s unrealized gain or loss. The filters above apply — with a From/To month filter, the invested line counts only that period\'s purchases and sales and starts from zero, while the value line is still today\'s value of everything held, so the gap is then not a gain or loss.',
  },
  nw_split: {
    title: 'Portfolio by bucket and by category',
    what: 'How the money you have invested is split: by bucket (Wealth Builder, Safety Net, Hedge & Opportunities) and by category — EPF and bank included.',
    how: 'Each slice = the cost of what is held in it (money invested, not today\'s value).',
    read: 'Shows where your money went in. The fund\'s weights by value, as of the latest snapshot, are on Positions → Weights vs mandate.',
  },
  nw_currency: {
    title: 'Currency exposure',
    what: 'How much of the money invested sits in rupee assets, in US dollars and in crypto.',
    how: 'Each category is assigned a currency (US equity = USD, crypto = Crypto, the rest = INR); slices = money invested.',
    read: 'Slices are money invested (cost), so they do not grow or shrink with prices or the exchange rate; only uninvested US cash is at today\'s rate. Today\'s values are in Stream-wise P&L.',
  },
  nw_yearly: {
    title: 'Yearly summary',
    what: 'Money put in and money taken out in each calendar year, across everything bought and sold through transactions.',
    how: 'Invested = the year\'s purchases; Redeemed = what the year\'s sales brought in.',
    read: 'A record of how much was bought and sold each year. Moving money from one holding to another shows on both sides, so the Invested bar is not only fresh money.',
  },
  nw_streams: {
    title: 'Stream-wise P&L',
    what: 'Profit and loss by category for everything you own, with each category\'s XIRR.',
    how: 'Invested = the cost of what is held (average cost); Gain = value now − that cost; XIRR = the yearly return of the category\'s real cash flows (dates and amounts of every purchase and sale, plus today\'s value).',
    read: 'XIRR is a money-weighted return — it depends on when you added money — so it is not the same as the time-weighted returns on the Factsheet. Tap a column to sort.',
  },
  nw_liquidity: {
    title: 'Liquidity ladder',
    what: 'How quickly each part of everything you own could be turned into cash.',
    how: 'Each category sits in one tier (instant, 1 day, 3–5 days, weeks, months+, locked) by how long a sale usually takes to pay out; amounts are today\'s values (cost where there is no price), as a share of all tiers.',
    read: 'EPF is "locked": withdrawals are restricted until retirement. The tiers are typical settlement times, not guarantees.',
  },
  funds_mf: {
    title: 'Per-fund P&L (FIFO)',
    what: 'Every Indian equity mutual fund you hold or held: what it cost, what it is worth, what was taken out, and its SIP history.',
    how: 'Lots are matched oldest-first (FIFO) for this table. Abs. return % = (value now + money taken out − everything invested) ÷ everything invested. XIRR = the yearly return of the fund\'s own cash flows. Avg buy gap = days from the first purchase to today (or the last sale) ÷ the number of purchases. SIP streak = months in a row with a purchase — a month counts as "in a row" when its first purchase came within 45 days of the previous month\'s — and 0 once 45 days pass after the latest month\'s first purchase; Longest streak = the longest run.',
    read: 'Tap a fund to see the units you still hold, grouped by the year they were bought and valued at today\'s NAV (sold units are left out), plus its rolling SIP returns. The account, category, subcategory and asset filters apply; the month range does not, because FIFO needs every purchase.',
  },
  funds_realized: {
    title: 'Realized P&L by category',
    what: 'Profit or loss already locked in by selling, for each category.',
    how: 'What sales brought in − what those units cost (average cost).',
    read: 'Green = a realized gain, red = a realized loss.',
  },
};


// ── Pattern types ─────────────────────────────────────────────────────────────

const GUIDE_PATTERNS = {
  streak: 'Streak — the fund or a sleeve (4+ months), or a holding (5+ months), went the same way every month; a flat month (a move of 0.05% or less) ends the run. Long runs in one direction are rarer than they feel.',
  momentum: 'Momentum shift — the last 3 months went the other way from the 9 months before, by more than the holding\'s usual 3-month swing.',
  stagnation: 'Stagnation — no new high for a long time, a 3-year return well behind the matching index, or a long sideways stretch (the Trends tab lists the rules).',
  drawdown: 'Drawdown — the fund or a sleeve is 5%+ below its high, with how long ago the high was.',
  gain_source: 'Where the gain came from — the 12-month return split by sleeve and the largest holdings (contribution in pts).',
  market_vs_me: 'Market vs me — the 12-month change in value split into money you added and the market\'s move.',
  weight_drift: 'Weight drift — a sleeve\'s share of the fund moved 3+ pts in 12 months, split into prices and money in/out (money added or taken out).',
  buy_timing: 'Buy timing — the last 12 months\' purchases, each compared with its own benchmark (gold for a gold ETF, a small-cap index for a small-cap fund): the level on the day you bought vs that benchmark\'s average over the last 13 monthly snapshots. "vs buying at the average" is a comparison, not a gain. Holdings with no benchmark are left out.',
  dispersion: 'Dispersion — how far apart the holdings\' 12-month returns are: best, worst and the middle (median).',
  vol_regime: 'Volatility change — the last 6 months\' swings were 1.5× bigger (or smaller) than the months before.',
  hedge: 'Hedge — what precious metals did in the months Indian equity fell (last 24 months).',
  us_fx: 'US currency share — how much of the US sleeve\'s rupee result came from the dollar–rupee rate.',
  stock_picks: 'Stock picks — your stocks against the same money in Nifty 50 (the index twin).',
  closed_trades: 'Closed trades — holdings fully sold in the last 12 months, wins and losses.',
  tax_position: 'Tax position — Indian equity gains this financial year, long-term vs short-term, and gains turning long-term in the next 90 days.',
  turnover: 'Turnover — sales so far this year as a % of the fund, vs the % for all of last year; the first fact compares ₹ sold over the same months of each year.',
};


// ── Glossary ──────────────────────────────────────────────────────────────────

const GUIDE_GLOSSARY = [
  ['Snapshot', 'A monthly record (taken 8th–14th) of every holding\'s value and cost. Fund returns, trends, weights and most patterns come from these; P&L, closed positions, activity, the US split and Tax work from your transactions at today\'s prices; stock picks use your transactions valued at the latest snapshot.'],
  ['Fund scope', 'What counts as "the fund": Indian equity funds and stocks, US equity, precious metals and crypto. Debt and arbitrage funds, land, EPF, bank balances and uninvested US cash are left out (Net worth covers everything; Tax covers all but EPF and bank).'],
  ['Inception', 'The first snapshot: where the fund\'s history starts. "Since inception" = from then to now.'],
  ['Sleeve', 'A group inside the fund: Indian equity, precious metals, US equity, crypto.'],
  ['Weight', 'A holding\'s or sleeve\'s share of the fund\'s value, in %.'],
  ['Mandate', 'Your planned weights — the target mix you set.'],
  ['Benchmark / index', 'A market average to compare against. Nifty 50 = India\'s 50 largest companies. Values come from an index fund\'s NAV, so dividends are included.'],
  ['NAV (net asset value)', 'The price of one unit of a mutual fund or ETF, published each working day.'],
  ['Total return', 'The price change plus any dividends paid out, counted as if they were put back in.'],
  ['TWR (time-weighted return)', 'The return of the investments themselves, ignoring when and how much money you added. The standard way funds report returns.'],
  ['XIRR', 'Your personal yearly return, counting the timing of every rupee you put in and took out (money-weighted). Used on Funds, Net worth and for stock picks.'],
  ['p.a. (annualised)', 'Per year. A 3-year total of +40% is about +11.9% p.a., because 1.119 × 1.119 × 1.119 ≈ 1.40.'],
  ['pts (percentage points)', 'The difference between two percentages: +12% vs +8% is a gap of +4 pts.'],
  ['Drawdown', 'A fall from a previous high, in %. The low point is the trough.'],
  ['Volatility', 'How far returns typically land from their average (the standard deviation), as a yearly figure.'],
  ['Median', 'The middle value when all are lined up from lowest to highest.'],
  ['Rolling return', 'The same-length return measured from many start dates, such as every 12-month window.'],
  ['Contribution (pts)', 'How many pts of the fund\'s return came from one holding or sleeve (roughly weight × return). A contributor added to the return; a detractor took away from it.'],
  ['Money in/out', 'Money you added to or took out of the fund — never counted as a gain or a loss.'],
  ['Revaluation', 'A jump in value when a holding carried at cost (no price on record) gets its first price. It is not counted as a return.'],
  ['Unrealized gain', 'A gain on units you still hold — on paper until sold.'],
  ['Realized gain', 'A gain locked in by selling.'],
  ['Average cost', 'Each purchase adds what you paid to the cost of the units held; each sale removes the sold units\' share of that cost at the average price. The cost of the units held is the "Invested" figure used for P&L.'],
  ['FIFO', 'First in, first out — a sale uses the oldest units first. The tax law uses it for capital gains.'],
  ['Lot', 'Units bought in one purchase; each lot has its own date and cost.'],
  ['Turnover', 'Sales in a year ÷ the fund\'s average value.'],
  ['LTCG / STCG', 'Long-term / short-term capital gain — a gain on something held longer / shorter than its holding period (12 or 24 months).'],
  ['Slab rate', 'Income tax is charged in bands (slabs) of income, each with its own rate (up to 30%). A gain taxed "at slab rate" is added to your other income for the year and taxed at the rate of the band it falls in — usually your highest band, not your average rate.'],
  ['Set off', 'Using a loss to reduce a gain in the same year.'],
  ['Cess', 'A 4% add-on to the tax itself.'],
  ['Surcharge', 'An extra on the tax for incomes above ₹50 lakh; not applied in the estimate.'],
  ['Indexation', 'Raising the purchase cost for inflation. For land bought before 23 Jul 2024, 20% on that raised cost may be chosen instead of 12.5%.'],
  ['Grandfathering (31 Jan 2018 price)', 'For shares and equity funds bought before 1 Feb 2018, the cost can be taken as their 31 Jan 2018 price when that is higher. Not applied in the estimate.'],
  ['TDS', 'Tax deducted at the time of a sale — for example 1% on crypto sales. It counts toward the tax, not on top of it.'],
  ['Financial year (FY)', '1 April to 31 March. FY 2026-27 = 1 Apr 2026 – 31 Mar 2027.'],
  ['ELSS lock-in', 'Units of a tax-saving (ELSS) fund cannot be sold for 3 years after each purchase.'],
  ['Arbitrage fund', 'A low-risk fund that holds mostly shares (hedged), so it is taxed like an equity fund.'],
];


// ── Lessons (Guide tab order = the tabs, left to right) ───────────────────────

const GUIDE_LESSONS = [
  {
    title: '1 · Start here',
    intro: [
      'Insights treats everything you invest for growth as one fund — like a mutual fund you manage yourself — and reports on it the way a fund house does in its monthly factsheet.',
      'Once a month (8th–14th) you take a snapshot: the value and cost of every holding. Fund returns, trends, weights and most patterns come from those monthly snapshots, so they appear only once there are enough of them — that is what "needs N more months" means. A 1-year return needs 13 snapshots in a row (12 month-to-month steps). P&L, activity and Tax work from your transactions at today\'s prices instead, so their values can differ from the latest snapshot; stock picks use your transactions but value them at the latest snapshot.',
      'Every page states facts. None of it is a recommendation.',
    ],
    keys: ['snapshots'],
  },
  {
    title: '2 · Factsheet: returns',
    intro: [
      'Why time-weighted? Say you have ₹1 lakh, it grows to ₹1.1 lakh, then you add another ₹1 lakh. Your balance went from ₹1 lakh to ₹2.1 lakh, but your investments earned 10% — not 110%. The time-weighted return (TWR) measures that 10%, so your deposits never look like performance. Insights sees one snapshot a month, so a large deposit in a month with a big market move nudges that month\'s % slightly.',
      'Every return is shown next to a benchmark — Nifty 50 for the fund, a matching index for each holding — and the difference is given in points (pts).',
    ],
    keys: ['fund', 'growth', 'calendar', 'rolling'],
  },
  {
    title: '3 · Factsheet: risk and where the value came from',
    intro: ['Return is half the story; the other half is how bumpy the path was — and how much of today\'s value is your own money.'],
    keys: ['risk', 'contrib', 'note'],
  },
  {
    title: '4 · What\'s happening',
    intro: ['Anything that stands out becomes a short fact card. Below the entry is every kind of pattern card.'],
    keys: ['patterns'],
    patterns: true,
  },
  {
    title: '5 · Trends',
    intro: ['Every holding next to its own index, with how long since it last made a new high.'],
    keys: ['trends_table', 'trends_cards'],
  },
  {
    title: '6 · Attribution',
    intro: ['Attribution splits the fund\'s return into the pieces that made it: which holdings and sleeves added or took away, and how that compares with how much money each holds.'],
    keys: ['attr_holding', 'attr_sleeve', 'attr_vs_bench', 'attr_share'],
  },
  {
    title: '7 · Positions',
    intro: ['Each holding as you bought it: rupee profit and loss, finished trades, how concentrated the fund is, how it compares with your plan, and how the weights moved.'],
    keys: ['pnl', 'closed', 'picks', 'concentration', 'mandate', 'drift', 'activity', 'us_split'],
  },
  {
    title: '8 · Funds',
    intro: ['Your Indian equity mutual funds one by one, with their SIP history, and what selling has locked in so far.'],
    keys: ['funds_mf', 'funds_realized'],
  },
  {
    title: '9 · Tax',
    intro: ['Indian capital-gains tax depends on what you sold and how long you held it. The Tax tab works it out lot by lot with the current rules, per person.'],
    keys: ['tax_estimate', 'tax_lines', 'tax_holdings', 'tax_rules'],
  },
  {
    title: '10 · Net worth',
    intro: ['Everything you own, not only the fund: EPF, bank balances, debt funds and land are included here. The filters at the top of Insights apply to this tab and to Funds.'],
    keys: ['nw_growth', 'nw_split', 'nw_currency', 'nw_yearly', 'nw_streams', 'nw_liquidity'],
  },
];


// ── DOM builders ──────────────────────────────────────────────────────────────

function buildHelpButton(label) {
  return `<button type="button" class="fs-help-btn" aria-expanded="false" aria-label="What ${snapEsc(label)} means">ⓘ</button>`;
}

function buildGuideEntry(key) {
  const g = GUIDE[key];
  if (!g) return '';
  return `<p><b>What it shows.</b> ${snapEsc(g.what)}</p>
    <p><b>How it is worked out.</b> ${snapEsc(g.how)}</p>
    <p><b>How to read it.</b> ${snapEsc(g.read)}</p>`;
}

// The card's ⓘ panel: its guide entry, then a line on the card's own numbers (plain text).
function buildHelpPanel(key, example = '') {
  return `<div class="fs-help" hidden>${buildGuideEntry(key)}
    ${example ? `<p class="fs-help-eg"><b>On your numbers.</b> ${snapEsc(example)}</p>` : ''}</div>`;
}

// One listener for every ⓘ (cards are rebuilt often, and some are copied as HTML): the button
// opens the help panel that sits directly inside its own card.
document.addEventListener('click', e => {
  const btn = e.target.closest && e.target.closest('.fs-help-btn');
  if (!btn) return;
  const box = btn.closest('.wh-card, .chart-card');
  const panel = box && box.querySelector(':scope > .fs-help');
  if (!panel) return;
  panel.hidden = !panel.hidden;
  btn.setAttribute('aria-expanded', String(!panel.hidden));
});


// ── Render ────────────────────────────────────────────────────────────────────

function renderGuideTab(container) {
  container.appendChild(fsCard('How to read Insights', `
    <p class="gd-lead">A short course on every number in Insights. The lessons follow the tabs from left to right; tap an entry
      to open it. The same notes sit behind the ⓘ on each card, most with a line on your own numbers.</p>`));
  GUIDE_LESSONS.forEach(lesson => {
    const entries = lesson.keys.map(k => `<details class="gd-entry"><summary>${snapEsc(GUIDE[k].title)}</summary>
      <div class="gd-body">${buildGuideEntry(k)}</div></details>`).join('');
    const patterns = lesson.patterns ? `<div class="fs-note-month">Pattern cards</div>
      <ul class="gd-list">${Object.values(GUIDE_PATTERNS).map(p => `<li>${snapEsc(p)}</li>`).join('')}</ul>` : '';
    container.appendChild(fsCard(snapEsc(lesson.title), `
      ${lesson.intro.map(p => `<p class="gd-p">${snapEsc(p)}</p>`).join('')}
      ${entries}${patterns}`));
  });
  container.appendChild(fsCard('Glossary', `<dl class="gd-terms">${GUIDE_GLOSSARY.map(([t, d]) =>
    `<div><dt>${snapEsc(t)}</dt><dd>${snapEsc(d)}</dd></div>`).join('')}</dl>`));
}
