/**
 * VaultZero — one-time COSMETIC styling for the backend spreadsheet.
 *
 * Applies tab colors, header shading, subtle row banding and frozen headers,
 * colour-grouped by category (Indian EQ MF, Debt, US Equity, SIP, Screener, …).
 * FORMATTING ONLY — it never reads or writes a single cell value, so your data
 * is untouched. Safe to re-run; use resetVaultZeroStyles() to revert.
 *
 *   Run:  stylizeSheets()
 *   Undo: resetVaultZeroStyles()
 */

// Light, subtle shades per group:  tab (soft) · header (light) · band (very light)
var VZ_STYLE = {
  reference:  { tab: '#B0B7C3', header: '#E8EAED', band: '#F5F6F8' }, // buckets/categories/accounts/…
  eqmf:       { tab: '#8FB0DD', header: '#DCE8F6', band: '#F2F7FC' }, // Indian EQ MF
  eqsip:      { tab: '#9E97E2', header: '#E3E1F8', band: '#F5F4FC' }, // EQ SIP
  debt:       { tab: '#8FCBA1', header: '#DEEFE3', band: '#F3FAF5' }, // Debt & Hybrid
  debtsip:    { tab: '#83CCC1', header: '#DDEEEB', band: '#F2FBF9' }, // Debt SIP
  stocks:     { tab: '#80C6D2', header: '#D8EDF1', band: '#F1FAFB' }, // Indian Equity Stocks
  usind:      { tab: '#AE95D5', header: '#E9E0F3', band: '#F8F4FC' }, // US Equity (IndMoney)
  usibkr:     { tab: '#A28FDA', header: '#E4DCF4', band: '#F6F3FC' }, // US Equity (IBKR) + wires/repat/income
  metals:     { tab: '#DCBD79', header: '#F5ECD9', band: '#FCF8EE' }, // Precious Metals
  crypto:     { tab: '#E3AD7F', header: '#F7E6D8', band: '#FDF6EF' }, // Cryptocurrency
  realestate: { tab: '#C7AD8F', header: '#EDE5DB', band: '#FAF6F0' }, // Real Estate
  cash:       { tab: '#98C3A8', header: '#E5EEE8', band: '#F5F9F6' }, // EPF / Bank
  screener:   { tab: '#9AA5B1', header: '#E7EAEE', band: '#F6F7F9' }, // separate SCREENER_* app
  scratch:    { tab: '#CFD4DA', header: null,      band: null      }, // _GF_SCRATCH etc. (tab colour only)
};

function vzGroupFor_(name) {
  var n = name.toLowerCase();
  if (name.charAt(0) === '_') return 'scratch';
  if (n.indexOf('screener') === 0)                 return 'screener';
  if (n.indexOf('equity_sip') === 0)               return 'eqsip';
  if (n.indexOf('equity_') === 0)                  return 'eqmf';      // equity_funds / equity_transactions
  if (n.indexOf('debt_sip') === 0)                 return 'debtsip';
  if (n.indexOf('debt_hybrid') === 0)              return 'debt';
  if (n.indexOf('indian_equity_stocks') === 0)     return 'stocks';
  if (n.indexOf('us_eq_indmoney') === 0)           return 'usind';
  if (n.indexOf('us_equity') === 0 || n.indexOf('us_wire') === 0 ||
      n.indexOf('us_repat') === 0 || n.indexOf('us_income') === 0) return 'usibkr';
  if (n.indexOf('precious_metal') === 0)           return 'metals';
  if (n.indexOf('crypto') === 0)                   return 'crypto';
  if (n.indexOf('real_estate') === 0)              return 'realestate';
  if (n === 'epf_assets' || n === 'bank_assets')   return 'cash';
  return 'reference'; // buckets, categories, subcategories, accounts, hidden_items, manual_prices
}

function stylizeSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var count = 0;

  sheets.forEach(function (sh) {
    var name  = sh.getName();
    var style = VZ_STYLE[vzGroupFor_(name)] || VZ_STYLE.reference;

    sh.setTabColor(style.tab);            // tab colour (always)

    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastCol < 1 || lastRow < 1) { count++; return; }   // truly empty
    if (style.header === null)      { count++; return; }   // scratch tab → tab colour only

    // Frozen, shaded header row with a soft bottom border
    sh.setFrozenRows(1);
    var header = sh.getRange(1, 1, 1, lastCol);
    header.setBackground(style.header)
          .setFontWeight('bold')
          .setFontColor('#1f2937')
          .setVerticalAlignment('middle');
    header.setBorder(null, null, true, null, null, null, '#c3c8ce', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

    // Subtle alternating row banding on the data region (custom colours)
    sh.getBandings().forEach(function (b) { b.remove(); });   // idempotent
    if (lastRow >= 2) {
      var banding = sh.getRange(2, 1, lastRow - 1, lastCol)
                      .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
      banding.setFirstRowColor('#ffffff').setSecondRowColor(style.band);
    }

    // Tidy, uniform layout — clip (no wrap), middle-aligned, even row heights.
    // (This is what fixes the ragged row sizes; forced height wins over auto-size.)
    sh.getRange(1, 1, lastRow, lastCol)
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)
      .setVerticalAlignment('middle');
    sh.setRowHeightsForced(1, 1, 30);                              // header
    if (lastRow >= 2) sh.setRowHeightsForced(2, lastRow - 1, 25);  // data rows

    count++;
  });

  ss.toast(count + ' sheets styled — formatting only, no data touched.', 'VaultZero', 6);
}

// Revert everything stylizeSheets() applied (tab colours, banding, header shading).
function resetVaultZeroStyles() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(function (sh) {
    sh.setTabColor(null);
    sh.getBandings().forEach(function (b) { b.remove(); });
    sh.setFrozenRows(0);
    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastCol >= 1 && lastRow >= 1) {
      var header = sh.getRange(1, 1, 1, lastCol);
      header.setBackground(null).setFontWeight('normal').setFontColor(null);
      header.setBorder(false, false, false, false, false, false);
      sh.getRange(1, 1, lastRow, lastCol)
        .setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW)
        .setVerticalAlignment('bottom');
      sh.setRowHeights(1, lastRow, 21);   // Sheets default height
    }
  });
  ss.toast('VaultZero styles removed.', 'VaultZero', 5);
}
