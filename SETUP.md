# VaultZero — Setup Guide

Estimated time: ~20 minutes

---

## 1. Create the Google Spreadsheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet
2. Name it **VaultZero**
3. Copy the Spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/**SPREADSHEET_ID**/edit`

---

## 2. Set up Google Apps Script (backend)

1. In your spreadsheet → **Extensions → Apps Script**
2. Delete the default `myFunction` stub
3. Paste the contents of [`gas/Code.gs`](gas/Code.gs)
4. At the top, set your Spreadsheet ID:
   ```js
   const SS_ID = 'YOUR_SPREADSHEET_ID_HERE';
   ```
5. Click **Save**

---

## 3. Create all sheet tabs

1. In Apps Script, select **setupAllSheets** from the function dropdown
2. Click **Run** → approve permissions when prompted
3. All sheet tabs are created and pre-populated (takes ~10 s)

---

## 4. Deploy as Web App

1. **Deploy → New Deployment → Web app**
2. Set:
   - Execute as: **Me**
   - Who has access: **Anyone**
3. Click **Deploy** → copy the **Web App URL**

---

## 5. Wire the URL into the frontend

Open [`js/config.js`](js/config.js) and paste the URL:

```js
APPS_SCRIPT_URL: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
```

---

## 6. Deploy the frontend

**GitHub Pages (recommended)**
1. Push this repo to GitHub
2. Settings → Pages → Deploy from branch → `main` → `/ (root)`
3. Live at `https://yourusername.github.io/vault-zero/`

**Local preview**
```bash
npx serve -l 5173 .
```

---

## Re-deploying after Code.gs changes

Apps Script → **Deploy → Manage Deployments → Edit → New version → Deploy**. URL stays the same.

---

## Sheet tab reference

These tabs are auto-created by `setupAllSheets`. Key ones to know:

| Tab | Purpose |
|-----|---------|
| `categories` | Asset categories (read by app for subcategory lookup) |
| `subcategories` | Subcategory rows per category |
| `manual_prices` | Manual / script-fetched prices for physical assets and real estate |
| `equity_funds` | MF asset master |
| `equity_transactions` | MF buy/sell/switch transactions |
| `debt_hybrid_funds` | Debt & hybrid MF asset master |
| `debt_hybrid_transactions` | Debt/hybrid transactions |
| `indian_stock_assets` | Indian equity stock master |
| `indian_stock_transactions` | Indian stock transactions |
| `us_stock_assets` | US stock master |
| `us_stock_transactions` | US stock transactions |
| `crypto_assets` | Crypto coin master |
| `crypto_transactions` | Crypto transactions |
| `precious_metal_etf_assets` | Digital gold/silver ETF master |
| `precious_metal_etf_transactions` | ETF transactions |
| `precious_metal_physical_assets` | Physical gold/silver master |
| `precious_metal_physical_transactions` | Physical transactions |
| `real_estate_assets` | Property master |
| `real_estate_transactions` | Property transactions |

---

## Price configuration per asset

### Streams with sheet formulas (auto-updating)

These streams have a `current_price` or `current_nav` column in the asset sheet tab — put a GOOGLEFINANCE formula there:

| Stream | Column | Example formula |
|--------|--------|-----------------|
| Cryptocurrency | `current_price` | `=IFERROR(GOOGLEFINANCE("CURRENCY:"&D2)*IFERROR(GOOGLEFINANCE("CURRENCY:USDINR"),83),0)` where D2 = ticker like `ETHUSD` |
| Indian EQ MF | `current_nav` | Updated via NAV import script or manual entry |
| Debt & Hybrid MF | `current_nav` | Same as above |
| Digital Precious Metals (ETF) | `current_price` | GOOGLEFINANCE or manual |

### Streams with `price_fetch_way` column

Physical precious metals and real estate assets have a `price_fetch_way` column in their asset row:

| Value | Behaviour |
|-------|-----------|
| `manual` | Price read from `manual_prices` table. Enter via Log form's "Update Price" panel, or via the gold price Apps Script |
| `formula` | Price read from `current_price` column in the asset row (put a sheet formula there) |

Set this when adding a new asset — the Log form shows or hides the manual price panel based on it.

### Gold price (physical) — automated fetch

[`gas/fetch_gold_price.gs`](gas/fetch_gold_price.gs) scrapes Chennai 22K gold rate from goodreturns.in daily and appends a row to `manual_prices`.

**Setup:**
1. Paste the script into a second Apps Script file in the same project
2. Verify `GOLD_ASSET_ID` matches the `id` of the Gold Coin row in `precious_metal_physical_assets`
3. Add a trigger: **Triggers → Add Trigger → fetchChennai22KGold → Time-driven → Day timer → 9–10am**

If the scrape stops working, run `debugGoldHTML()` — it logs the relevant HTML so you can update the regex without guessing.

---

## Adding a new category

1. Add a row to the `categories` sheet tab (id, bucket_id, name)
2. Add subcategory rows to `subcategories` if needed
3. Create two sheet tabs: `{slug}_assets` and `{slug}_transactions`
4. Add one entry to `CATEGORIES` in [`js/data.js`](js/data.js) pointing to a stream key
5. Add the stream config to `STREAMS` in `data.js` (copy an existing simple stream as a template)

Subcategories are fetched dynamically from the sheet — no code change needed for those.
