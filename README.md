# VaultZero — Investment Tracker

A production-grade investment tracking web app. Logs transactions across 7 investment streams, stored in Google Sheets, accessible on mobile and desktop.

---

## Setup (one-time, ~15 minutes)

### Step 1 — Create the Google Spreadsheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet
2. Name it **VaultZero**
3. Copy the Spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

---

### Step 2 — Set up Google Apps Script

1. In your spreadsheet, click **Extensions → Apps Script**
2. Delete the default `myFunction` code
3. Copy the entire contents of [`gas/Code.gs`](gas/Code.gs) and paste it
4. At the top of the file, paste your Spreadsheet ID:
   ```js
   const SS_ID = 'YOUR_SPREADSHEET_ID_HERE';
   ```
5. Click **Save**

---

### Step 3 — Create all sheet tabs

1. In Apps Script, click the function dropdown and select **setupAllSheets**
2. Click **Run**
3. When prompted, click **Review Permissions → Allow**
4. Wait ~10 seconds — all 24 sheet tabs are created and pre-populated

---

### Step 4 — Deploy as Web App

1. In Apps Script, click **Deploy → New Deployment**
2. Click the gear icon next to "Select type" → choose **Web app**
3. Set:
   - **Execute as**: Me
   - **Who has access**: Anyone
4. Click **Deploy**
5. Copy the **Web app URL**

---

### Step 5 — Wire the URL into the app

Open [`js/config.js`](js/config.js) and replace the placeholder:
```js
APPS_SCRIPT_URL: 'https://script.google.com/macros/s/YOUR_ID/exec',
```

---

### Step 6 — Deploy to GitHub Pages

1. Push this repo to GitHub
2. Go to **Settings → Pages → Deploy from branch → main → / (root)**
3. Your app will be live at `https://yourusername.github.io/vault-zero/`

---

## Usage

### Log a Transaction
1. Tap a **Bucket** → **Category** → (Subcategory if shown)
2. Select an existing asset or tap **+ Add New Asset**
3. Fill in the fields — Amount auto-calculates
4. Tap **Save Transaction**

### View & Edit History
1. Switch to **History** tab → drill down to the stream
2. Last 10 transactions shown read-only
3. Tap **Edit** — all rows become editable; changed rows highlight yellow
4. Tap **Delete** on a row (edit mode) to remove it — requires confirmation
5. Tap **Save All** to commit or **Cancel** to discard
6. Tap **Load More** for older transactions

---

## Investment Streams

| Stream | Bucket | Subcategories |
|--------|--------|---------------|
| Indian EQ Mutual Fund | Wealth Builder | Large Cap, Mid Cap, Small Cap, Flexi Cap, ELSS, Index, Sectoral |
| Indian Equity Stocks | Wealth Builder | None |
| US Equity Stocks | Wealth Builder | None |
| Real Estate | Wealth Builder | None |
| Debt & Hybrid Mutual Fund | Safety Net | Liquid, Overnight, UST, Money Market, Short/Medium Duration, Dynamic Bond, Arbitrage, Credit Risk, Balanced Advantage, Conservative Hybrid, Equity Savings |
| Precious Metals | Hedge & Opportunities | Digital, Physical |
| Cryptocurrency | Hedge & Opportunities | None |

---

## File Structure

```
/
├── index.html
├── css/styles.css
├── js/
│   ├── config.js    ← paste your Apps Script URL here
│   ├── data.js      ← stream & field definitions
│   ├── api.js       ← Sheets API calls
│   ├── form.js      ← dynamic form rendering
│   └── app.js       ← routing & navigation
└── gas/Code.gs      ← Google Apps Script backend
```

---

## Re-deploying after Code.gs changes

Apps Script → **Deploy → Manage Deployments** → edit → **New version** → Deploy. URL stays the same.

---

## Phase 2 (deferred)
EPFO, Savings Account, Amount Lent, Amount Borrowed
