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
  sip.js            SIP budget & allocation dashboard
gas/
  Code.gs           Apps Script backend (CRUD + setupAllSheets)
  fetch_gold_price.gs  daily Chennai 22K gold price → manual_prices sheet
  bulkImport.gs     one-time bulk import helpers
  import_from_tradebook.gs  Zerodha tradebook import
```
