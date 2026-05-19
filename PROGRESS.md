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
- XIRR via Newton-Raphson on transaction cashflows, per-category and overall
- Allocation charts: Bucket pie, Category pie, Subcategory pie, Current Value allocation
- Stream-wise P&L table — sortable by any column
- Monthly and yearly invest/redeem bar charts
- Cumulative portfolio growth line
- Top 10 holdings bar chart
- Liquidity ladder (Instant → Days → Weeks → Months+)
- Currency exposure pie (INR / USD / Crypto)
- Equity cap split (Large / Mid / Small) vs target bars
- Tax liability estimator (LTCG / STCG per stream, flat 30% crypto)
- Section grouping: Allocation, Performance, Risk & Liquidity, Tax Intelligence

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
