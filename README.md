# VaultZero — Investment Tracker

A personal investment tracking web app. Logs transactions across multiple asset streams, stored in Google Sheets, accessible on mobile and desktop.

- **[SETUP.md](SETUP.md)** — How to deploy and configure from scratch
- **[PROGRESS.md](PROGRESS.md)** — Features built, known gaps, deferred work

## Quick file map

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
  insights.js       charts, XIRR, liquidity ladder, tax estimates
  manage.js         show / hide categories, subcategories and assets per account
gas/
  Code.gs           Apps Script backend (CRUD + setupAllSheets)
  schema.gs         relational constraints (PK / UNIQUE / FK / CHECK) + checkConstraints()
  import_from_coin.gs       Zerodha Coin import      ┐ live in the separate TRADEBOOK Apps Script
  import_from_tradebook.gs  Zerodha tradebook import ┘ project; write to VaultZero via the web app
  cleanup_vaultzero.gs      one-off Nov 2026 data cleanup / migration (dry run first)
  stylize_sheets.gs         cosmetic tab colours for the spreadsheet
```
