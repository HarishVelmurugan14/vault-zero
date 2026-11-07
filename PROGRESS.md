# VaultZero — Progress

---

## Done

### Core app
- Google Sheets as database via Apps Script web app (GET / INSERT / UPDATE / DELETE)
- 7 investment streams: Indian EQ MF, Indian Equity Stocks, US Stocks, Debt & Hybrid MF, Precious Metals (Digital + Physical), Cryptocurrency, Real Estate
- Dynamic transaction form — field types, computed fields (amount = qty × price), auto-triggers
- Asset creation inline from the Log form
- History tab — paginated, inline edit + delete with confirmation
- Bulk import scripts (Zerodha tradebook, sheet-to-sheet)

### Holdings
- Hierarchy tree: Bucket → Category → Subcategory → Asset, collapsible at every level
- Columns: Invested, Current Value, Unrealized P&L (color-coded)
- Grand total row; mobile collapses P&L column
- Invested amount precision: uses `units × nav` where available (avoids rounding from stored `amount`)

### Insights
- Portfolio hero card + 4-metric strip (Net Invested, Current Value, XIRR, Unrealized P&L)
- Tabs (Nov 2026, AMC-factsheet rebuild — facts only, no advice wording):
  - Factsheet — the fund (Indian equity, US, metals, crypto) as one mutual fund: time-weighted returns vs Nifty 50, growth of ₹100, calendar / rolling returns, risk, money put in vs market, monthly manager's note, top patterns; Take snapshot
  - What's happening — pattern cards (16 detectors), history kept per month
  - Trends — every holding vs its own benchmark, stagnation rules
  - Attribution — contribution to return by holding and sleeve, vs own benchmark, share of move vs capital
  - Positions — P&L by holding, closed positions, stock picks vs index twin, concentration, weights vs mandate, weight drift, activity, US stock vs USD/INR
  - Funds — per-fund FIFO P&L with SIP streaks, realized P&L by category
  - Tax — capital-gains estimate per person, FIFO lots, rules from 23 Jul 2024 (12.5% / 20% / ₹1.25L …), ELSS lock-in, US sales at Rule 115 month-end rate
  - Net worth — everything owned: portfolio growth, bucket / category / currency pies, yearly summary, stream-wise P&L with XIRR, liquidity ladder
  - Guide — lessons + glossary; the same notes sit behind the ⓘ on every card
- Data gates: a number shows only with enough consecutive monthly snapshots ("needs N more months")

### Pricing
- `price_fetch_way` column on physical asset and real estate rows (`manual` / `formula`)
  - `manual` → reads latest entry from `manual_prices` table; manual price panel in Log form
  - `formula` → reads `current_price` column directly (Google Finance formula in sheet)
- Gold price Apps Script: scrapes Chennai 22K rate daily → appends to `manual_prices`
- Manual price panel: shown in Log form for assets with `price_fetch_way = manual`; hidden for `formula`

### Styling
- Pure black dark theme (`#080808` bg, `#111111` surface)
- Gold `#f59e0b` for data / content accents; Violet `#a855f7` for UI chrome (nav, buttons, focus)
- Glass nav, gradient logo, rounded pill active tab
- Modern bar charts: rounded tops, `borderSkipped: bottom`, tight bar width, subtle grid
- Transaction rows: colored left accent (green=buy, red=sell) + amount color via CSS `:has()`

---

## In progress / planned

### SIP Budget & Allocation (`js/sip.js`)
- Schema designed: `equity_sip_budget`, `equity_sip_events`, `equity_sip_transactions` (and debt equivalents)
- Dashboard planned: budget card, current allocations table, event history with reason filter
- Not yet wired into the app — `startLogForm()` check for `isSIPStream` not yet added

### Deferred (needs data / new sheet tables)
- **Goal progress tracker** — needs a `goals` table (name, target_amount, target_date)
- **FD maturity calendar** — needs `maturity_date` in debt asset table
- **Net worth tracker** — needs a liabilities table
- **Correlation heatmap** — needs monthly historical price per stream
- **EPFO / PPF / Savings / Lending** — new categories, need sheet tabs + stream config

---

## Known gaps

- Current value for MF streams (`—`) until NAV column is populated in the asset sheet
- SIP transactions in `equity_sip_transactions` not yet shown in History tab (stream not wired)
- Insights XIRR shows `—` for streams with only one transaction (need at least one buy + a current price)
