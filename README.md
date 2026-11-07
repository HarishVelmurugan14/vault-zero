# VaultZero — Investment Tracker

A personal investment tracking web app. Logs transactions across multiple asset streams, stored in Google Sheets, accessible on mobile and desktop.

- **[SETUP.md](SETUP.md)** — How to deploy and configure from scratch
- **[PROGRESS.md](PROGRESS.md)** — Features built, known gaps, deferred work

## Quick file map
-
```
index.html          entry point
css/styles.css      all styling (dark theme, components)
js/
  config.js         Apps Script URL + page size
  data.js           BUCKETS, CATEGORIES, STREAMS — add new asset classes here
  api.js            Sheets API (GET / INSERT / UPDATE / DELETE)
  app.js            routing, navigation, state
  form.js           dynamic transaction + asset forms, manual price panel
  holdings.js       holdings tree (bucket → category → subcategory → asset)
  insights.js       Insights shell (filters, hero, tabs), snapshots card, Funds + Net worth charts, XIRR
  fund-engine.js    pure maths for the fund factsheet: TWR, benchmarks, attribution, positions, patterns, trends, tax
  factsheet.js      Insights → Factsheet (returns vs Nifty 50, risk, money put in vs market, manager's note)
  happening.js      Insights → What's happening (pattern cards)
  trends.js         Insights → Trends (each holding vs its own benchmark, stagnation rules)
  attribution.js    Insights → Attribution (contribution to return by holding / sleeve)
  positions.js      Insights → Positions (P&L, closed, stock picks, concentration, mandate, drift, activity, US split)
  tax.js            Insights → Tax (capital-gains estimate per person, FIFO lots, current rules)
  guide.js          Insights → Guide + the ⓘ note behind every card (plain-English definitions)
  manage.js         show / hide categories, subcategories and assets per account
gas/
  Code.gs           Apps Script backend (CRUD + setupAllSheets)
  schema.gs         relational constraints (PK / UNIQUE / FK / CHECK) + checkConstraints()
  import_from_coin.gs       Zerodha Coin import      ┐ live in the separate TRADEBOOK Apps Script
  import_from_tradebook.gs  Zerodha tradebook import ┘ project; write to VaultZero via the web app
  snapshot.gs               frozen monthly snapshots (setupSnapshots / backfillSnapshots; monthly via the app's "Take snapshot")
  cleanup_vaultzero.gs      one-off Nov 2026 data cleanup / migration (dry run first)
  stylize_sheets.gs         cosmetic tab colours for the spreadsheet
```
