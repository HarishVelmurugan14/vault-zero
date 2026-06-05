# My Coding Style Guide

> Target: Google Apps Script backend (`Code.gs`) + single-page vanilla JS/CSS dashboard.  
> Any AI refactoring this codebase should follow these rules mechanically.

---

## 1. ES Version & Language Constructs

### 1.1 Variable declarations

Always `const`. Use `let` only when the variable is genuinely reassigned. Never `var`.

```js
// ✅ DO
const stream = STREAMS[key];
let running = 0;
for (const entry of list) { running += entry.value; }

// ❌ DON'T
var data = [];
let name = 'fixed';        // should be const
```

### 1.2 Function declarations vs arrow functions

Top-level named functions → `function` declaration.  
Callbacks, short helpers, inline handlers → arrow functions.  
Never use arrow functions for top-level exported/named logic.

```js
// ✅ DO — top-level function
function buildHoldingsRows(data) { … }

// ✅ DO — callback
rows.forEach(r => { totals[r.catId] = (totals[r.catId] || 0) + r.invested; });

// ✅ DO — short inline
const sorted = items.sort((a, b) => a.date - b.date);

// ❌ DON'T — arrow for top-level named function
const buildHoldingsRows = (data) => { … };
```

### 1.3 Async / await

Always `async/await` — no raw `.then()` chains except fire-and-forget background calls.

```js
// ✅ DO
async function fetchData() {
  const res = await API.get('equity_funds', { limit: 500 });
  return res.rows || [];
}

// ✅ DO — fire-and-forget is fine as .then()
fetchAllInsightsData().then(d => { _cache = d; }).catch(() => {});

// ❌ DON'T — .then() chain for sequential logic
API.get('equity_funds').then(res => API.get('equity_transactions').then(t => …));
```

### 1.4 Optional chaining and nullish coalescing

Use `?.` freely. Prefer `||` for fallback to a default value; use `??` only when `0` or `''` must be preserved.

```js
// ✅ DO
const name  = asset?.fund_name || 'Unknown';
const price = parseFloat(asset?.[stream.currentPriceCol] || 0);
const label = entry.subcatName ?? '';   // empty string is meaningful here

// ❌ DON'T — manual null checks for simple property access
const name = asset && asset.fund_name ? asset.fund_name : 'Unknown';
```

### 1.5 Ternaries

One-level ternaries are fine. Never nest ternaries.

```js
// ✅ DO
const cls = pnl >= 0 ? 'positive' : 'negative';

// ❌ DON'T
const cls = pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : 'neutral';
// → use if/else instead
```

### 1.6 Destructuring

Use for object properties from function parameters or API results. Not for arrays unless the positions are obvious.

```js
// ✅ DO
const { catName, bucketId, stream, assets, txns } = entry;
const { rows = [], total = 0 } = await API.get('equity_funds');

// ❌ DON'T — destructuring that obscures meaning
const [a, b, , d] = someArray;
```

### 1.7 Spread operator

Fine for shallow copies and merging objects.

```js
// ✅ DO
const updated = { ...existing, is_active: true };
const allCfs  = [...cashflows];
```

### 1.8 Array methods

Prefer `forEach`, `map`, `filter`, `find`, `reduce`, `some`, `every`. Use `for...of` when you need `break` or `continue`. Classic `for (let i …)` only for index-sensitive operations.

```js
// ✅ DO — need continue
for (const row of rawData) {
  if (!row.isin) continue;
  process(row);
}

// ❌ DON'T — forEach with flag variable to simulate break
let done = false;
rows.forEach(r => { if (!done && r.id === target) { done = true; result = r; } });
// → use .find() instead
```

### 1.9 Classes

Do not use ES6 classes. Plain objects and functions are sufficient.

```js
// ❌ DON'T
class ApiClient { … }

// ✅ DO — plain object with methods
const API = {
  async get(sheet, opts) { … },
  async _post(payload)   { … },
};
```

### 1.10 Constructs to avoid entirely

- `var` — never
- `with` — never
- `eval` — never
- `arguments` object — use rest params `...args`
- Prototype manipulation
- `instanceof` checks beyond simple type guards
- `==` / `!=` — always `===` / `!==`

---

## 2. Naming

### 2.1 Variables and functions

`camelCase`. Verbs for functions, nouns for data.

| Pattern | Example |
|---|---|
| Data variable | `assetMap`, `totalInvested`, `byCategory` |
| Boolean | `isActive`, `hasSells`, `hasSubcategories` |
| DOM-building fn | `makeAssetRow`, `makeChartCard`, `makeSectionHeader` |
| Render fn (side-effect) | `renderInsights`, `renderBalanceUpdateForm` |
| Draw fn (Chart.js) | `drawBucketChart`, `drawMFReport` |
| Build fn (returns value) | `buildHoldingsRows`, `buildPortfolioHero` |
| Fetch fn | `fetchAllInsightsData`, `fetchAssetsCached` |
| Compute fn (pure) | `computeXIRR`, `computeFIFOMFMetrics`, `computeAssetMetrics` |
| Format fn | `fmtCurrency`, `fmtAxis`, `fmtXIRR`, `fmtDate` |

### 2.2 Module-level constants

`SCREAMING_SNAKE_CASE` for data constants (config, lookup tables, maps).

```js
// ✅ DO
const STREAMS      = { … };
const CATEGORIES   = [ … ];
const BUCKET_COLORS = ['#a855f7', …];
const TAX_CONFIG   = { … };
const SS_ID        = '1R4y…';

// ❌ DON'T
const streams = { … };
const BucketColors = [ … ];
```

### 2.3 Private / internal helpers

No underscore prefix for "private" functions — just use descriptive names and rely on file structure. Exception: `_post` on the API object (single leading underscore on object methods only).

```js
// ✅ DO — object method
const API = { async _post(payload) { … } };

// ❌ DON'T — underscore on top-level functions
function _buildRow() { … }   // just name it buildRow
```

### 2.4 Ignored error / variable

Use `_` as the catch variable or ignored parameter when the value is intentionally unused.

```js
// ✅ DO
try { … } catch (_) {}
items.forEach((_, i) => { … });
```

### 2.5 CSS class names

`kebab-case`. Use short component prefixes for namespaced component parts, not full BEM.

```
✅  .holdings-tree        — component root
    .ht-bucket            — child (ht = holdings-tree)
    .ht-bucket-name       — element within child
    .ht-toggle            — modifier element
    .mf-badge             — component root
    .mf-badge-active      — variant
    .sip-budget-card      — component root
    .chart-card           — shared utility component
    .chart-card-full      — variant

❌  .holdingsTree          — camelCase
    .holdings-tree__bucket — BEM double-underscore
    .HT_bucket             — mixed case
```

Utility classes (apply anywhere): `.positive`, `.negative`, `.btn-primary`, `.btn-secondary`, `.spinner`.

### 2.6 IDs

`kebab-case`. Used sparingly — only for unique page sections or chart canvas targets.

```html
<!-- ✅ DO -->
<div id="log-content"></div>
<canvas id="chart-bucket"></canvas>
<div id="report-mf-detail"></div>

<!-- ❌ DON'T -->
<div id="logContent"></div>
<div id="log_content"></div>
```

---

## 3. Formatting

### 3.1 Indentation

**2 spaces.** No tabs.

### 3.2 Quotes

**Single quotes** for all JS strings. Double quotes only inside HTML attribute values in template literals.

```js
// ✅ DO
const key  = 'vz_api_token';
const html = `<div class="chart-card" id="${id}">`;

// ❌ DON'T
const key = "vz_api_token";
```

### 3.3 Semicolons

Always. No ASI reliance.

### 3.4 Line length

Soft limit ~120 characters. Break long lines at logical points — after commas in argument lists, after `||`/`&&`, before ternary `?`.

```js
// ✅ DO — break after comma
rows.push({ catId: cat.id, catName: cat.name, bucketId: cat.bucket_id,
            subcategory: '', name: a[stream.assetNameCol], invested, currentValue });

// ✅ DO — break at logical operator
const price = stream.currentPriceCol
  ? parseFloat(asset[stream.currentPriceCol] || 0)
  : _manualPricesMap[`${stream.manualPriceType}|${assetId}`] || 0;
```

### 3.5 Braces and spacing

Opening brace on same line. Space before `{`. Space after keywords (`if`, `for`, `while`). Space around binary operators. No space before `(` in function calls.

```js
// ✅ DO
if (isActive) {
  return currentValue * nav;
}

function compute(stream, txns) {
  const total = a + b;
}

// ❌ DON'T
if(isActive){
  return currentValue*nav;
}
```

### 3.6 Object literals

Compact single-line for short objects (≤3 short keys). Multi-line for longer ones with each key on its own line. Trailing comma on last property in multi-line.

```js
// ✅ DO — short, one line
const point = { x: 0, y: 0 };

// ✅ DO — multi-line, trailing comma
const stream = {
  label: 'EPF',
  staticBalance: true,
  currentBalanceCol: 'current_balance',
  assetTable: 'epf_assets',
  txnTable: null,
};

// ❌ DON'T — no trailing comma on multi-line (makes diffs noisier)
const stream = {
  label: 'EPF',
  assetTable: 'epf_assets'
};
```

### 3.7 Array literals

Same rule as objects — short arrays on one line, long arrays one element per line with trailing comma.

### 3.8 Blank lines

- One blank line between top-level function declarations.
- One blank line between logical blocks within a function.
- Two blank lines between major sections within a file (use section headers instead — see §6).
- No trailing blank lines inside a function body.

### 3.9 Alignment in object literals

Align values when a group of related constants will be read side-by-side. Spaces used for alignment are acceptable.

```js
// ✅ DO — aligned for readability
const C = {
  isin:    headerRow.indexOf('isin'),
  mode:    headerRow.indexOf('transaction_mode'),
  date:    headerRow.indexOf('trade_date'),
  orderId: headerRow.indexOf('exchange_order_id'),
};

// ❌ DON'T — inconsistent, no alignment benefit
const C = { isin: headerRow.indexOf('isin'), mode: headerRow.indexOf('transaction_mode'), date: headerRow.indexOf('trade_date') };
```

---

## 4. Function Design

### 4.1 Size and focus

One logical job per function. If a function needs more than ~40 lines, it should probably be split. Exception: render/draw functions that build complex DOM/chart configs can be longer.

### 4.2 Early returns (guard clauses)

Always early-return on guard conditions — don't nest the happy path.

```js
// ✅ DO
function processAsset(asset, stream) {
  if (!asset) return;
  if (!stream.currentPriceCol) return;
  const price = parseFloat(asset[stream.currentPriceCol] || 0);
  // … happy path
}

// ❌ DON'T
function processAsset(asset, stream) {
  if (asset) {
    if (stream.currentPriceCol) {
      const price = parseFloat(asset[stream.currentPriceCol] || 0);
      // … happy path
    }
  }
}
```

### 4.3 `continue` in loops

Use `continue` to skip loop iterations early instead of wrapping the body in `if`.

```js
// ✅ DO
for (const row of rawData) {
  if (!row.isin || !row.orderId) continue;
  if (row.status !== 'COMPLETE') continue;
  process(row);
}

// ❌ DON'T
for (const row of rawData) {
  if (row.isin && row.orderId && row.status === 'COMPLETE') {
    process(row);
  }
}
```

### 4.4 Default parameters

Use default parameter syntax — not `opts = opts || {}` inside the body.

```js
// ✅ DO
async function get(sheet, { limit = CONFIG.PAGE_SIZE, offset = 0, filters = {} } = {}) { … }

// ❌ DON'T
async function get(sheet, opts) {
  opts = opts || {};
  const limit = opts.limit || CONFIG.PAGE_SIZE;
}
```

### 4.5 Pure vs side-effecting functions

- `compute*`, `build*` (returning DOM), `fmt*` → pure — no global state changes.
- `render*`, `draw*` → side-effecting (DOM mutation, Chart.js) — clearly named.
- Global caches (`_insightsCache`, `_holdingsAllRows`) → only modified in their designated fetch functions.

### 4.6 Try/catch conventions

```js
// ✅ DO — surface to user via toast
try {
  await API.insert(stream.txnTable, data);
  showToast('Saved!');
} catch (err) {
  showToast('Failed: ' + err.message, 'error');
}

// ✅ DO — silently swallow background/non-critical errors
try { chart.destroy(); } catch (_) {}

// ✅ DO — partial try/catch so happy path is readable
async function fetchAllInsightsData() {
  try {
    const res = await API.batchGet(allSheets);
    return buildEntries(res);
  } catch (_) {
    return fallbackFetch();   // graceful degradation
  }
}

// ❌ DON'T — catch and silently swallow user-triggered errors
try {
  await API.insert(stream.txnTable, data);
} catch (_) {}   // user never knows it failed
```

### 4.7 Logging

**GAS (`Code.gs`):** `Logger.log('message')` for debug/info. Never `console.log`.  
**Frontend JS:** No `console.log` in committed code. Temporary debug logs must be removed before commit.

---

## 5. Comments and Documentation

### 5.1 Section banner headers

Every logical section in a file gets a banner comment. Format exactly:

```js
// ── Section Title ─────────────────────────────────────────────────────────────
```

Em-dash (`──`) after `//`, space, title, space, then em-dashes filling to ~80 chars.  
Sub-sections use shorter banners or a plain `// ── Sub-title ──` without fill.

```js
// ── Data Fetching ─────────────────────────────────────────────────────────────

// ── Amount helpers ────────────────────────────────────────────────────────────

// ── P&L: average cost method ──────────────────────────────────────────────────
```

### 5.2 File header comment

First line of every file: `// ComponentName — one-line description`.

```js
// VaultZero — API layer (Google Apps Script calls)
// VaultZero — Stream definitions, field configs, validation rules
// VaultZero — Google Apps Script Backend
```

### 5.3 Inline comments

Use for non-obvious logic, workarounds, or domain knowledge. Same line preferred; above the line for multi-line context. Never restate the code.

```js
// ✅ DO — explains WHY
const endDate = isActive ? today : lastDate;  // inactive fund: XIRR to actual exit, not today

// ✅ DO — explains domain rule
// FIFO: India's MF redemption rule — oldest units redeemed first

// ❌ DON'T — restates code
const price = parseFloat(asset.nav || 0);  // parse the nav to float
```

### 5.4 JSDoc

Not used in this codebase. Do not add JSDoc unless the function is a pure utility exported to multiple files.

### 5.5 What NOT to comment

- Every line of a straightforward function
- Closing braces (`} // end if`)
- Variable declarations that name themselves
- Obvious type conversions

---

## 6. File Organization

### 6.1 Declaration order (JS files)

```
1. File header comment
2. Module-level constants (SCREAMING_SNAKE_CASE) — config, lookup tables
3. Module-level state variables (prefixed with _)
4. Utility / pure helper functions
5. Data fetch functions
6. Computation / aggregation functions
7. DOM build functions (return elements, no side effects)
8. Render / draw functions (mutate DOM, side effects)
9. Event wiring / init
```

### 6.2 GAS file order (`Code.gs`)

```
1. File header comment
2. SS_ID constant
3. getSpreadsheet()
4. Token gate (checkToken, TEST_setApiToken)
5. doGet() / doPost() — request handlers
6. Sheet CRUD helpers (readSheet, appendRow, updateRow, deleteRow, seedSheet)
7. respond() utility
8. Price formula helpers
9. Migration / setup functions (migrateAddPriceColumns, setupAllSheets, seedReferenceData)
```

### 6.3 Section headers

Every logical group of functions gets a `// ── Title ──` banner. No function should be orphaned without a section.

### 6.4 State variables

Module-level mutable state uses `_` prefix and is declared near the top, after constants.

```js
let _insightsCache   = null;
let _holdingsAllRows = null;
let _manualPricesMap = {};
```

---

## 7. HTML Structure

### 7.1 Single-page structure

One `index.html`. All CSS in `<link>` tags. All JS in `<script src="…">` tags at bottom of `<body>`. No inline `<style>` or `onclick` attributes.

```html
<!-- ✅ DO -->
<link rel="stylesheet" href="css/styles.css">
…
<script src="js/config.js"></script>
<script src="js/api.js"></script>
<script src="js/app.js"></script>
</body>

<!-- ❌ DON'T -->
<div style="color:red" onclick="doSomething()">
```

### 7.2 DOM building in JS

For static, non-interactive HTML blobs → `innerHTML` template literal (fast, readable).  
For interactive components with event listeners → `createElement` + `appendChild` chain.

```js
// ✅ DO — static display content
card.innerHTML = `
  <div class="portfolio-hero-label">${label}</div>
  <div class="portfolio-hero-value">${value}</div>
`;

// ✅ DO — interactive with event listener
const btn = document.createElement('button');
btn.className = 'btn-primary';
btn.textContent = 'Save';
btn.addEventListener('click', handleSave);
form.appendChild(btn);

// ❌ DON'T — mix both carelessly
el.innerHTML = `<button onclick="handleSave()">Save</button>`;
```

### 7.3 Inline styles in JS

Only for **dynamic values** that can't be expressed as a CSS class — CSS custom property overrides, computed widths, generated colors.

```js
// ✅ DO — dynamic CSS variable
row.style.setProperty('--lt-color', tier.color);
card.style.setProperty('--mc-color', '#f59e0b');

// ❌ DON'T — static styles via JS
el.style.fontSize = '13px';     // put in CSS
el.style.display  = 'none';     // use .hidden class instead
```

---

## 8. CSS Conventions

### 8.1 CSS custom properties

All colors, spacing, radii, and transitions go through CSS variables defined in `:root`. Never hardcode colors directly in component rules.

```css
/* ✅ DO */
.chart-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

/* ❌ DON'T */
.chart-card {
  background: #1e2130;
  border: 1px solid #2e3248;
  border-radius: 12px;
}
```

### 8.2 Section headers

Same `/* ── Title ──… */` pattern as JS, using `/* */`.

```css
/* ── Holdings Tree Table ──────────────────────────────────── */
/* ── Metric Strip ─────────────────────────────────────────── */
```

### 8.3 Rule ordering within a selector

Box model first → typography → visual → transitions.

```css
.metric-card {
  /* box model */
  display: flex;
  padding: 14px 16px;
  position: relative;
  overflow: hidden;
  /* typography */
  font-size: 13px;
  font-weight: 600;
  /* visual */
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  /* transition */
  transition: transform 0.15s;
}
```

### 8.4 Dark theme

The app is dark-first. Never write light-mode rules without a dark override. Default color tokens are already dark — do not override with literal light colors.

### 8.5 Responsive

Mobile-first. Media queries at the bottom of a component block or at the end of the file. Breakpoints: `480px`, `600px`, `640px`, `900px`.

```css
/* ✅ DO — mobile-first, breakpoint at bottom */
.metric-strip { grid-template-columns: repeat(2, 1fr); }
@media (min-width: 640px) { .metric-strip { grid-template-columns: repeat(4, 1fr); } }
```

### 8.6 Pseudo-elements for decoration

Use `::before` / `::after` for decorative accents (glow overlays, border highlights) to keep HTML clean.

```css
/* ✅ DO */
.chart-card::before {
  content: '';
  position: absolute;
  top: 0; right: 0;
  width: 180px; height: 180px;
  background: radial-gradient(circle, rgba(245,158,11,0.06) 0%, transparent 70%);
  pointer-events: none;
}
```

### 8.7 Utility classes

Keep these global and minimal:

```css
.positive  { color: var(--positive); }
.negative  { color: var(--negative); }
.btn-primary   { … }
.btn-secondary { … }
.btn-sm        { … }
.spinner       { … }
```

---

## 9. Idiosyncratic Rules

These are patterns observed consistently — follow them exactly.

### 9.1 Numeric helpers

- `parseFloat(x || 0)` — not `Number(x)`, not `+x`
- `Math.round(x)` for amounts displayed as integers
- `(x).toFixed(1)` for percentages
- `Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })` for currency display

### 9.2 String coercion

`String(x)` — not `x.toString()`, not `` `${x}` `` unless in a larger template.

```js
// ✅ DO
const id = String(row[0]).trim();

// ❌ DON'T
const id = row[0].toString().trim();
```

### 9.3 GAS sheet reads

Always call `.getDataRange().getValues()` then slice `data.slice(1)` for rows. Never use `.getRange(row, col)` to read individual cells in a loop.

### 9.4 `requestAnimationFrame` for charts

All Chart.js `new Chart()` calls go inside `requestAnimationFrame(() => { … })` to avoid rendering before DOM is painted.

### 9.5 Cache clearing pattern

When data is mutated, clear all three layers together:

```js
CACHE.clear(stream.assetTable);
_insightsCache   = null;
_holdingsAllRows = null;
LSC.clear('insights', 'holdings');
```

### 9.6 Toast over alert/confirm

Never use `window.alert()` or `window.confirm()` in the frontend. Use `showToast(message)` for success, `showToast(message, 'error')` for errors.  
Exception: GAS scripts may use `SpreadsheetApp.getUi().alert()` for import scripts.

### 9.7 Empty arrays/objects as defaults

`|| []` and `|| {}` are preferred over `?? []` — assuming 0/false/empty-string are not meaningful defaults in these contexts.

```js
const rows = data.rows || [];
const filters = e.parameter.filters ? JSON.parse(e.parameter.filters) : {};
```

### 9.8 Boolean checks on string `'TRUE'`

Sheet values come back as strings. Always normalise before comparing:

```js
// ✅ DO
assets.filter(a => String(a.is_active).toUpperCase() === 'TRUE')

// ❌ DON'T
assets.filter(a => a.is_active === true)
assets.filter(a => a.is_active)
```

### 9.9 HTML in template literals

Multi-line HTML in template literals: each tag on its own line, indented to match logical nesting. No more than 3 levels of nesting before splitting into a helper function.

---

## 10. Open Questions

Things not clearly established in the codebase — do not guess, ask the developer:

1. **Max function length** — there's no hard line count rule observed. Is ~40 lines the actual limit?
2. **JSDoc** — should utility functions in `data.js` (like `resolveStream`, `validateTxn`) get JSDoc?
3. **Error boundary** — when `batchGet` partially fails, should partial data be rendered or should the whole tab show an error?
4. **CSS variable naming convention** — `--radius-sm` vs `--radius` vs `--radius-lg`: is there a defined scale?
5. **Test files** — no test files observed. Is there a preferred test runner if tests are added?
6. **Module system** — currently global scripts. If the project grows, is ESM (`import/export`) acceptable or stay global?
7. **Emoji in UI** — used in some places (bucket icons, category icons). Is there a rule for when emoji is appropriate?

---

## Apply This — One-Page Checklist

Run through this before submitting any refactor.

### Variables & Types
- [ ] No `var` anywhere
- [ ] `const` used where value never reassigns; `let` only where it does
- [ ] `===` / `!==` used everywhere (no `==`)
- [ ] `parseFloat(x || 0)` for numeric conversions from sheet data
- [ ] `String(x)` for string coercion
- [ ] `String(x).toUpperCase() === 'TRUE'` for sheet boolean checks

### Functions
- [ ] Top-level named functions use `function` keyword (not arrow)
- [ ] Callbacks and short helpers use arrow functions
- [ ] Guard clauses return early — happy path is not nested
- [ ] `continue` used in loops instead of nested `if`
- [ ] Default parameters in signature, not reassigned inside body
- [ ] `try/catch` shows `showToast` on user-triggered failures; silent `catch (_) {}` only for background/non-critical

### Naming
- [ ] Functions follow verb pattern: `render*`, `draw*`, `build*`, `compute*`, `fetch*`, `fmt*`, `make*`
- [ ] Constants are `SCREAMING_SNAKE_CASE`
- [ ] CSS classes are `kebab-case` with component prefix
- [ ] IDs are `kebab-case`

### Formatting
- [ ] 2-space indent throughout
- [ ] Single quotes in JS
- [ ] Semicolons present
- [ ] Trailing commas on multi-line objects/arrays
- [ ] Lines under ~120 chars
- [ ] Opening brace on same line

### Comments
- [ ] File header `// ComponentName — description` present
- [ ] All logical sections have `// ── Title ──…` banners
- [ ] Inline comments explain WHY, not WHAT
- [ ] No `console.log` in frontend; `Logger.log` in GAS only

### HTML / CSS
- [ ] No inline `<style>` or `onclick` attributes in HTML
- [ ] Static HTML → `innerHTML`; interactive with listeners → `createElement`
- [ ] JS inline styles only for dynamic CSS variable overrides
- [ ] All colors via `var(--token)` — no hardcoded hex in component rules
- [ ] CSS sections use `/* ── Title ──… */` banners

### Data / State
- [ ] After any mutation: `CACHE.clear()` + `_insightsCache = null` + `_holdingsAllRows = null` + `LSC.clear()`
- [ ] No `window.alert()` or `window.confirm()` in frontend
- [ ] All Chart.js draws inside `requestAnimationFrame`
