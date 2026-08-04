// VaultZero — Holdings page

let _holdingsAllRows = null;
// All-Accounts view: merge the same fund held in multiple accounts into one row.
let _holdingsCombine = (() => { try { return localStorage.getItem('vz_holdings_combine') === '1'; } catch (_) { return false; } })();

// ── US Equity (IBKR) shared helpers (used by holdings.js + insights.js) ───────

// Uninvested USD cash = wires in − buys + sells − repats + income.
function usEquityCashUsd(txns, wires, repats, income) {
  const sum = (arr, f) => (arr || []).reduce((s, r) => s + (parseFloat(f(r)) || 0), 0);
  const wiredIn   = sum(wires,  w => w.usd_received);
  const repatOut  = sum(repats, r => r.usd_withdrawn);
  const incomeIn  = sum(income, r => r.usd_amount);
  let bought = 0, sold = 0;
  (txns || []).forEach(t => {
    const amt = parseFloat(t.usd_amount) || 0;
    if (String(t.txn_type).toUpperCase() === 'BUY') bought += amt; else sold += amt;
  });
  return wiredIn - bought + sold - repatOut + incomeIn;
}

// Live ₹/USD: prefer GOOGLEFINANCE-derived spot (INR price ÷ USD price) from any
// priced asset; fall back to avg all-in wire rate; final fallback 88.
function usEquityLiveRate(assets, wires, stream) {
  for (const a of (assets || [])) {
    const inr = parseFloat(a[stream.currentPriceCol] || 0);
    const usd = parseFloat(a[stream.usdPriceCol] || 0);
    if (inr > 0 && usd > 0) return inr / usd;
  }
  const inrDebited = (wires || []).reduce((s, w) => s + (parseFloat(w.inr_debited) || 0), 0);
  const usdRecv    = (wires || []).reduce((s, w) => s + (parseFloat(w.usd_received) || 0), 0);
  return usdRecv > 0 ? inrDebited / usdRecv : 88;
}

// ── Reusable multi-select dropdown (checkbox panel) — shared with insights.js ──
// options: [{ value, label }]. onChange() fires on every toggle.
// Returns { wrapper, getSelected(), clear(), setOptions(opts) }.
function makeMultiSelect(placeholder, options, onChange) {
  const selected = new Set();
  const wrap  = document.createElement('div');
  wrap.className = 'multiselect';
  const btn   = document.createElement('button');
  btn.type = 'button';
  btn.className = 'multiselect-btn holdings-filter-select';
  const panel = document.createElement('div');
  panel.className = 'multiselect-panel';
  panel.style.display = 'none';

  function relabel() {
    btn.textContent = selected.size === 0 ? placeholder : `${placeholder} (${selected.size})`;
  }
  function buildPanel(opts) {
    panel.innerHTML = '';
    if (!opts.length) { panel.innerHTML = '<div class="multiselect-empty">None</div>'; return; }
    opts.forEach(o => {
      const item = document.createElement('label');
      item.className = 'multiselect-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(o.value);
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(o.value); else selected.delete(o.value);
        relabel();
        onChange();
      });
      const span = document.createElement('span');
      span.textContent = o.label;
      item.appendChild(cb);
      item.appendChild(span);
      panel.appendChild(item);
    });
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) panel.style.display = 'none'; });

  buildPanel(options);
  relabel();
  wrap.appendChild(btn);
  wrap.appendChild(panel);

  return {
    wrapper: wrap,
    getSelected: () => [...selected],
    clear: () => { selected.clear(); buildPanel(options); relabel(); },
    setOptions: (opts) => {
      [...selected].forEach(v => { if (!opts.find(o => o.value === v)) selected.delete(v); });
      buildPanel(opts);
      relabel();
    },
  };
}

async function renderHoldings() {
  const container = document.getElementById('holdings-content');
  const header = document.getElementById('holdings-header');

  if (header) {
    header.innerHTML = '';
    const h2 = document.createElement('h2');
    h2.textContent = 'Holdings';
    const btn = document.createElement('button');
    btn.className = 'btn-outline btn-sm';
    btn.textContent = '↻ Refresh';
    btn.addEventListener('click', () => {
      _holdingsAllRows = null;
      LSC.clear('holdings');
      renderHoldings();
    });
    header.appendChild(h2);
    header.appendChild(btn);
  }

  container.innerHTML = '<div class="holdings-loading">Loading holdings…</div>';

  try {
    if (!_holdingsAllRows) _holdingsAllRows = LSC.get('holdings');
    if (!_holdingsAllRows) {
      _holdingsAllRows = await buildHoldingsRows();
    }
    renderHoldingsUI(container, _holdingsAllRows);
  } catch (err) {
    container.innerHTML = `<div class="holdings-empty">Failed to load: ${err.message}</div>`;
  }
}

function renderHoldingsUI(container, allRows) {
  container.innerHTML = '';

  // ── Filter bar ──────────────────────────────────────────────────────────────
  const filterBar = document.createElement('div');
  filterBar.className = 'holdings-filter-bar';

  const catOptions = [...new Set(allRows.map(r => r.catName))].sort()
    .map(c => ({ value: c, label: c }));

  const subcatOptionsFor = (cats) => [...new Set(
    allRows
      .filter(r => !cats.length || cats.includes(r.catName))
      .map(r => r.subcategory)
      .filter(Boolean)
  )].sort().map(s => ({ value: s, label: s }));

  const catMS = makeMultiSelect('All Categories', catOptions, () => {
    subcatMS.setOptions(subcatOptionsFor(catMS.getSelected()));
    applyFilter();
  });
  const subcatMS = makeMultiSelect('All Subcategories', subcatOptionsFor([]), () => applyFilter());

  filterBar.appendChild(catMS.wrapper);
  filterBar.appendChild(subcatMS.wrapper);

  // "Combine same fund across accounts" — only meaningful in the All-Accounts view
  const multiAcct = (typeof ACCOUNTS !== 'undefined' && ACCOUNTS.isAll() && ACCOUNTS.list.length > 1);
  if (multiAcct) {
    const lbl = document.createElement('label');
    lbl.className = 'holdings-combine-toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = _holdingsCombine;
    cb.addEventListener('change', () => {
      _holdingsCombine = cb.checked;
      try { localStorage.setItem('vz_holdings_combine', cb.checked ? '1' : '0'); } catch (_) {}
      applyFilter();
    });
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' Combine same fund across accounts'));
    filterBar.appendChild(lbl);
  }

  const breakdownWrap = document.createElement('div');
  const tableWrap     = document.createElement('div');

  function applyFilter() {
    const cats = catMS.getSelected();
    const subs = subcatMS.getSelected();
    const filtered = allRows.filter(r =>
      (!cats.length || cats.includes(r.catName)) &&
      (!subs.length || subs.includes(r.subcategory))
    );

    // Per-account breakdown uses the per-account rows (before any combine)
    breakdownWrap.innerHTML = '';
    const bd = buildAccountBreakdown(filtered);
    if (bd) breakdownWrap.appendChild(bd);

    const rowsForTable = (_holdingsCombine && multiAcct) ? combineRowsByFund(filtered) : filtered;
    renderHoldingsTable(tableWrap, rowsForTable, {
      singleCat:    cats.length === 1,
      singleSubcat: subs.length === 1,
    });
  }

  container.appendChild(filterBar);
  container.appendChild(breakdownWrap);
  container.appendChild(tableWrap);

  applyFilter();
}

// Merge rows with the same fund identity (category + subcategory + name) across
// accounts into one row: invested/current summed. Keeps a single account id when
// the fund lives in only one account, else marks it combined with a count.
function combineRowsByFund(rows) {
  const map = {}, order = [];
  rows.forEach(r => {
    const key = `${r.catId}|${r.subcategory}|${r.name}`;
    if (!map[key]) { map[key] = { ...r, _accts: new Set() }; order.push(key); }
    else { map[key].invested += r.invested; map[key].currentValue += r.currentValue; }
    if (r.account) map[key]._accts.add(String(r.account));
  });
  return order.map(k => {
    const m = map[k];
    m.combinedCount = m._accts.size;
    m.account = m._accts.size === 1 ? [...m._accts][0] : null;
    delete m._accts;
    return m;
  });
}

// A compact "by account" panel (net worth split per account) for the All view.
function buildAccountBreakdown(rows) {
  if (!(typeof ACCOUNTS !== 'undefined' && ACCOUNTS.isAll() && ACCOUNTS.list.length > 1)) return null;
  const byAcct = {};
  rows.forEach(r => {
    const val = r.currentValue > 0 ? r.currentValue : r.invested;
    const key = r.account ? String(r.account) : '';
    byAcct[key] = (byAcct[key] || 0) + val;
  });
  const total = Object.values(byAcct).reduce((s, v) => s + v, 0);
  if (total <= 0) return null;

  const entries = Object.entries(byAcct)
    .map(([k, v]) => ({ name: k ? (ACCOUNTS.name(k) || 'Account') : 'Shared / Unattributed', value: v, pct: v / total * 100 }))
    .sort((a, b) => b.value - a.value);

  const card = document.createElement('div');
  card.className = 'holdings-acct-breakdown';
  let html = '<div class="hab-title">By account</div>';
  entries.forEach(e => {
    html += `<div class="hab-row">
      <span class="hab-name">${e.name}</span>
      <span class="hab-bar"><span class="hab-fill" style="width:${e.pct.toFixed(1)}%"></span></span>
      <span class="hab-val">₹${formatINR(e.value)}</span>
      <span class="hab-pct">${e.pct.toFixed(1)}%</span>
    </div>`;
  });
  html += `<div class="hab-row hab-total">
      <span class="hab-name">Total</span>
      <span class="hab-bar"></span>
      <span class="hab-val">₹${formatINR(total)}</span>
      <span class="hab-pct">100%</span>
    </div>`;
  card.innerHTML = html;
  return card;
}

async function buildHoldingsRows() {
  const streamEntries = [
    { cat: CATEGORIES.find(c => c.id === 1), stream: STREAMS.equity_mf,               subcatName: null },
    { cat: CATEGORIES.find(c => c.id === 2), stream: STREAMS.indian_stocks,            subcatName: null },
    { cat: CATEGORIES.find(c => c.id === 3), stream: STREAMS.us_stocks,                subcatName: null },
    { cat: CATEGORIES.find(c => c.id === 4), stream: STREAMS.real_estate,              subcatName: null },
    { cat: CATEGORIES.find(c => c.id === 5), stream: STREAMS.debt_hybrid_mf,           subcatName: null },
    { cat: CATEGORIES.find(c => c.id === 6), stream: STREAMS.precious_metals_digital,  subcatName: 'Digital' },
    { cat: CATEGORIES.find(c => c.id === 6), stream: STREAMS.precious_metals_physical, subcatName: 'Physical' },
    { cat: CATEGORIES.find(c => c.id === 7), stream: STREAMS.crypto,                   subcatName: null },
    { cat: CATEGORIES.find(c => c.id === 8), stream: STREAMS.equity_sip,               subcatName: null },
    { cat: CATEGORIES.find(c => c.id === 9), stream: STREAMS.debt_hybrid_sip,          subcatName: null },
    { cat: CATEGORIES.find(c => c.id === 10), stream: STREAMS.epf,                     subcatName: null },
    { cat: CATEGORIES.find(c => c.id === 11), stream: STREAMS.bank_accounts,           subcatName: null },
    { cat: CATEGORIES.find(c => c.id === 12), stream: STREAMS.us_equity_ibkr,          subcatName: null },
  ];

  await HIDDEN.load();
  await ACCOUNTS.load();

  const allSheets = [...new Set(streamEntries.flatMap(e => [e.stream.assetTable, e.stream.txnTable, ...(e.stream.auxTables || [])]).filter(Boolean)), 'manual_prices'];
  let res = {};
  try {
    res = await API.batchGet(allSheets);
  } catch (_) {
    // batchGet failed (e.g. new sheets not yet created) — fall back to per-stream fetches
    const results = await Promise.allSettled(
      [...new Set(allSheets)].map(async sheet => {
        const data = await API.get(sheet, { limit: 5000 });
        return [sheet, data];
      })
    );
    results.forEach(r => {
      if (r.status === 'fulfilled') res[r.value[0]] = r.value[1];
    });
  }
  const manualPricesMap = buildManualPricesMap(res['manual_prices']?.rows || []);

  const rows = [];
  for (const entry of streamEntries) {
    const { cat, stream, subcatName } = entry;
    if (HIDDEN.isCat(cat.id)) continue;   // hidden category — excluded everywhere
    const assets = (res[stream.assetTable]?.rows || [])
      .filter(a => ACCOUNTS.matches(a.account_id)
                && !HIDDEN.isAsset(stream.assetTable, a.id) && !HIDDEN.isSub(a.subcategory_id));
    // US equity may have cash (from a wire) before any asset exists — don't skip it.
    if (!assets.length && !stream.usEquity) continue;

    // ── staticBalance streams (EPF, Bank) — no transactions, read balance directly ──
    if (stream.staticBalance) {
      assets
        .filter(a => String(a.is_active).toUpperCase() === 'TRUE')
        .forEach(a => {
          const balance = parseFloat(a[stream.currentBalanceCol] || 0);
          if (!balance) return;
          rows.push({ catId: cat.id, catName: cat.name, bucketId: cat.bucket_id,
                      subcategory: '', name: a[stream.assetNameCol], account: a.account_id,
                      invested: balance, currentValue: balance });
        });
      continue;
    }

    // ── US Equity (IBKR) — INR cost basis from wires; current value via INR price ──
    if (stream.usEquity) {
      const visibleIds = new Set(assets.map(a => String(a.id)));   // account+hidden filtered
      const usTxns = (res[stream.txnTable]?.rows || []).filter(t => visibleIds.has(String(t[stream.assetIdCol])));
      const buyUnits = {}, buyCostINR = {}, netQty = {};
      usTxns.forEach(t => {
        const aid = String(t[stream.assetIdCol]);
        const u = parseFloat(t.units || 0);
        if (String(t.txn_type).toUpperCase() === 'BUY') {
          buyUnits[aid]   = (buyUnits[aid]   || 0) + u;
          buyCostINR[aid] = (buyCostINR[aid] || 0) + parseFloat(t[stream.costBasisCol] || 0);
          netQty[aid]     = (netQty[aid]     || 0) + u;
        } else {
          netQty[aid] = (netQty[aid] || 0) - u;
        }
      });
      assets
        .filter(a => String(a.is_active).toUpperCase() === 'TRUE')
        .forEach(a => {
          const aid = String(a.id);
          const tbu = buyUnits[aid] || 0, tbc = buyCostINR[aid] || 0, nq = netQty[aid] || 0;
          if (tbu <= 0 || nq <= 0) return;
          const invested = nq * (tbc / tbu);                          // remaining units × avg INR cost
          const price = parseFloat(a[stream.currentPriceCol] || 0);   // INR/share (GOOGLEFINANCE)
          const currentValue = price > 0 ? nq * price : 0;
          rows.push({ catId: cat.id, catName: cat.name, bucketId: cat.bucket_id,
                      subcategory: SUBCAT_NAMES[a.subcategory_id] || '', account: a.account_id,
                      name: a[stream.assetNameCol], invested, currentValue });
        });

      // ── Derived US cash line (wires − buys + sells − repats + income) ──
      const wires   = (res[stream.wireTable]?.rows   || []).filter(w => ACCOUNTS.matches(w.account_id));
      const repats  = (res[stream.repatTable]?.rows  || []).filter(r => ACCOUNTS.matches(r.account_id));
      const income  = (res[stream.incomeTable]?.rows || []).filter(i => ACCOUNTS.matches(i.account_id));
      const cashUsd = usEquityCashUsd(usTxns, wires, repats, income);
      if (Math.abs(cashUsd) > 0.01) {
        const rate = usEquityLiveRate(assets, wires, stream);
        const cashInr = cashUsd * rate;
        rows.push({ catId: cat.id, catName: cat.name, bucketId: cat.bucket_id,
                    subcategory: 'Cash', name: 'Uninvested Cash (USD)',
                    invested: cashInr, currentValue: cashInr });
      }
      continue;
    }

    const txns = res[stream.txnTable]?.rows || [];

    // Per-asset: track buy units + buy amount separately for avg cost method
    const buyUnitsByAsset = {};
    const buyAmtByAsset   = {};
    const netQtyByAsset   = {};

    txns.forEach(t => {
      const aid = String(t[stream.assetIdCol]);
      const qty = parseFloat(t.units || t.quantity || 0);
      let amt = 0;
      if (stream.amountCol) {
        const u = parseFloat(t.units || t.quantity || 0);
        const n = parseFloat(t.nav || t.price_per_unit || 0);
        amt = (u > 0 && n > 0) ? u * n : parseFloat(t[stream.amountCol] || 0);
      } else {
        amt = parseFloat(t.quantity || 0) * parseFloat(t.price_per_unit || 0)
            + parseFloat(t.registration_cost || 0)
            + parseFloat(t.other_expenses    || 0);
      }
      if (t.txn_type === 'Buy') {
        buyUnitsByAsset[aid] = (buyUnitsByAsset[aid] || 0) + qty;
        buyAmtByAsset[aid]   = (buyAmtByAsset[aid]   || 0) + amt;
        netQtyByAsset[aid]   = (netQtyByAsset[aid]   || 0) + qty;
      } else {
        netQtyByAsset[aid] = (netQtyByAsset[aid] || 0) - qty;
      }
    });

    // Only active assets; skip fully-exited (netQty ≤ 0)
    assets
      .filter(a => String(a.is_active).toUpperCase() === 'TRUE')
      .forEach(a => {
        const aid           = String(a.id);
        const totalBuyUnits = buyUnitsByAsset[aid] || 0;
        const totalBuyAmt   = buyAmtByAsset[aid]   || 0;
        const netQty        = netQtyByAsset[aid]    || 0;

        if (totalBuyUnits <= 0 || netQty <= 0) return;

        // Invested = remaining units × average buy cost
        const avgCost = totalBuyAmt / totalBuyUnits;
        const invested = netQty * avgCost;

        const resolvedSubcat = subcatName || SUBCAT_NAMES[a.subcategory_id] || '';

        let currentValue = 0;
        if (stream.currentPriceCol) {
          const price = parseFloat(a[stream.currentPriceCol] || 0);
          if (price > 0) currentValue = netQty * price;
        } else if (stream.manualPriceType) {
          let price = 0;
          if (a.price_fetch_way === 'formula') {
            price = parseFloat(a['current_price'] || 0);
          } else {
            price = manualPricesMap[`${stream.manualPriceType}|${aid}`] || 0;
          }
          if (price > 0) currentValue = netQty * price;
        }

        rows.push({ catId: cat.id, catName: cat.name, bucketId: cat.bucket_id, subcategory: resolvedSubcat, name: a[stream.assetNameCol], account: a.account_id, invested, currentValue });
      });
  }

  const bucketOrder = BUCKETS.reduce((m, b, i) => { m[b.id] = i; return m; }, {});
  const catOrder    = CATEGORIES.reduce((m, c, i) => { m[c.id] = i; return m; }, {});
  rows.sort((a, b) =>
    bucketOrder[a.bucketId] - bucketOrder[b.bucketId] ||
    catOrder[a.catId]       - catOrder[b.catId] ||
    a.subcategory.localeCompare(b.subcategory) ||
    a.name.localeCompare(b.name) ||
    String(a.account || '').localeCompare(String(b.account || ''))
  );

  LSC.set('holdings', rows);
  return rows;
}

function renderHoldingsTable(wrap, rows, { singleCat = false, singleSubcat = false } = {}) {
  wrap.innerHTML = '';
  if (!rows.length) {
    wrap.innerHTML = '<div class="holdings-empty">No holdings match the selected filter.</div>';
    return;
  }

  const tree = document.createElement('div');
  tree.className = 'holdings-tree';

  const hdr = document.createElement('div');
  hdr.className = 'holdings-tree-header';
  hdr.innerHTML = `
    <span>${singleSubcat ? 'Asset' : singleCat ? 'Subcategory / Asset' : 'Bucket / Category / Asset'}</span>
    <span>Invested</span>
    <span>Current Value</span>
    <span>Unrealized P&L</span>
  `;
  tree.appendChild(hdr);

  // Aggregate totals
  const bucketMap = {};
  const catMap    = {};
  const subcatMap = {};

  rows.forEach(r => {
    const bucket = BUCKETS.find(b => b.id === r.bucketId) || { name: '', color: '#4f46e5' };
    if (!bucketMap[r.bucketId]) bucketMap[r.bucketId] = { name: bucket.name, color: bucket.color, invested: 0, currentValue: 0 };
    bucketMap[r.bucketId].invested     += r.invested;
    bucketMap[r.bucketId].currentValue += r.currentValue;

    if (!catMap[r.catId]) catMap[r.catId] = { name: r.catName, invested: 0, currentValue: 0 };
    catMap[r.catId].invested     += r.invested;
    catMap[r.catId].currentValue += r.currentValue;

    const sk = `${r.catId}|${r.subcategory}`;
    if (!subcatMap[sk]) subcatMap[sk] = { invested: 0, currentValue: 0 };
    subcatMap[sk].invested     += r.invested;
    subcatMap[sk].currentValue += r.currentValue;
  });

  if (singleSubcat) {
    rows.forEach(r => tree.appendChild(makeAssetRow(r)));
  } else if (singleCat) {
    const subcats = [...new Set(rows.map(r => r.subcategory))];
    subcats.forEach(sc => {
      const scRows  = rows.filter(r => r.subcategory === sc);
      const sk      = `${scRows[0].catId}|${sc}`;
      const totals  = subcatMap[sk] || { invested: 0, currentValue: 0 };
      const scSection = document.createElement('div');
      scSection.className = 'ht-subcat-section';
      scSection.dataset.collapsed = 'false';
      if (sc) {
        const scRow = makeSubcatRow(sc, totals);
        scRow.addEventListener('click', () => toggleSection(scSection, scRow.querySelector('.ht-toggle')));
        scSection.appendChild(scRow);
      }
      scRows.forEach(r => scSection.appendChild(makeAssetRow(r)));
      tree.appendChild(scSection);
    });
  } else {
    const bucketIds = [...new Set(rows.map(r => r.bucketId))];
    bucketIds.forEach(bid => {
      const bRows   = rows.filter(r => r.bucketId === bid);
      const bTotals = bucketMap[bid] || { invested: 0, currentValue: 0 };
      const bBucket = BUCKETS.find(b => b.id === bid) || { name: '', color: '#4f46e5' };

      const bSection = document.createElement('div');
      bSection.className = 'ht-section';
      bSection.dataset.collapsed = 'false';

      const bRow = makeBucketRow(bBucket, bTotals);
      bRow.addEventListener('click', () => toggleSection(bSection, bRow.querySelector('.ht-toggle')));
      bSection.appendChild(bRow);

      const catIds = [...new Set(bRows.map(r => r.catId))];
      catIds.forEach(cid => {
        const cRows   = bRows.filter(r => r.catId === cid);
        const cTotals = catMap[cid] || { invested: 0, currentValue: 0 };

        const cSection = document.createElement('div');
        cSection.className = 'ht-cat-section';
        cSection.dataset.collapsed = 'false';

        const cRow = makeCategoryRow(cRows[0].catName, cTotals);
        cRow.addEventListener('click', () => toggleSection(cSection, cRow.querySelector('.ht-toggle')));
        cSection.appendChild(cRow);

        const subcats = [...new Set(cRows.map(r => r.subcategory))];
        subcats.forEach(sc => {
          const scRows  = cRows.filter(r => r.subcategory === sc);
          const sk      = `${cid}|${sc}`;
          const sTotals = subcatMap[sk] || { invested: 0, currentValue: 0 };

          const scSection = document.createElement('div');
          scSection.className = 'ht-subcat-section';
          scSection.dataset.collapsed = 'false';

          if (sc) {
            const scRow = makeSubcatRow(sc, sTotals);
            scRow.addEventListener('click', () => toggleSection(scSection, scRow.querySelector('.ht-toggle')));
            scSection.appendChild(scRow);
          }
          scRows.forEach(r => scSection.appendChild(makeAssetRow(r)));
          cSection.appendChild(scSection);
        });

        bSection.appendChild(cSection);
      });

      tree.appendChild(bSection);
    });
  }

  // Grand total
  const grandInvested = rows.reduce((s, r) => s + r.invested, 0);
  const grandCurrent  = rows.reduce((s, r) => s + r.currentValue, 0);
  const grandPnL      = grandCurrent > 0 ? grandCurrent - grandInvested : null;
  const gRow = document.createElement('div');
  gRow.className = 'ht-grand';
  gRow.innerHTML = `
    <div class="ht-grand-label">Total</div>
    <div class="ht-grand-num">₹${formatINR(grandInvested)}</div>
    <div class="ht-grand-num">${grandCurrent > 0 ? '₹' + formatINR(grandCurrent) : '—'}</div>
    <div class="ht-grand-num ${grandPnL !== null ? (grandPnL >= 0 ? 'positive' : 'negative') : ''}">${grandPnL !== null ? (grandPnL >= 0 ? '+' : '-') + '₹' + formatINR(Math.abs(grandPnL)) : '—'}</div>
  `;
  tree.appendChild(gRow);
  wrap.appendChild(tree);
}

function makeBucketRow(bucket, totals) {
  const pnl    = totals.currentValue > 0 ? totals.currentValue - totals.invested : null;
  const pnlCls = pnl !== null ? (pnl >= 0 ? 'positive' : 'negative') : '';
  const row    = document.createElement('div');
  row.className = 'ht-bucket';
  row.innerHTML = `
    <div class="ht-bucket-name">
      <span class="ht-toggle">▾</span>
      <span>${bucket.icon || ''} ${bucket.name}</span>
    </div>
    <div class="ht-bucket-num">₹${formatINR(totals.invested)}</div>
    <div class="ht-bucket-num">${totals.currentValue > 0 ? '₹' + formatINR(totals.currentValue) : '—'}</div>
    <div class="ht-bucket-num ${pnlCls}">${pnl !== null ? (pnl >= 0 ? '+' : '-') + '₹' + formatINR(Math.abs(pnl)) : '—'}</div>
  `;
  return row;
}

function makeCategoryRow(catName, totals) {
  const pnl    = totals.currentValue > 0 ? totals.currentValue - totals.invested : null;
  const pnlCls = pnl !== null ? (pnl >= 0 ? 'positive' : 'negative') : '';
  const row    = document.createElement('div');
  row.className = 'ht-category';
  row.innerHTML = `
    <div class="ht-category-name"><span class="ht-toggle">▾</span>${catName}</div>
    <div class="ht-category-num">₹${formatINR(totals.invested)}</div>
    <div class="ht-category-num">${totals.currentValue > 0 ? '₹' + formatINR(totals.currentValue) : '—'}</div>
    <div class="ht-category-num ${pnlCls}">${pnl !== null ? (pnl >= 0 ? '+' : '-') + '₹' + formatINR(Math.abs(pnl)) : '—'}</div>
  `;
  return row;
}

function makeSubcatRow(subcatName, totals) {
  const pnl    = totals.currentValue > 0 ? totals.currentValue - totals.invested : null;
  const pnlCls = pnl !== null ? (pnl >= 0 ? 'positive' : 'negative') : '';
  const row    = document.createElement('div');
  row.className = 'ht-subcat';
  row.innerHTML = `
    <div class="ht-subcat-name"><span class="ht-toggle">▾</span>${subcatName}</div>
    <div class="ht-subcat-num">₹${formatINR(totals.invested)}</div>
    <div class="ht-subcat-num">${totals.currentValue > 0 ? '₹' + formatINR(totals.currentValue) : '—'}</div>
    <div class="ht-subcat-num ${pnlCls}">${pnl !== null ? (pnl >= 0 ? '+' : '-') + '₹' + formatINR(Math.abs(pnl)) : '—'}</div>
  `;
  return row;
}

function makeAssetRow(r) {
  const pnl    = r.currentValue > 0 ? r.currentValue - r.invested : null;
  const pnlCls = pnl !== null ? (pnl >= 0 ? 'positive' : 'negative') : '';
  const row    = document.createElement('div');
  row.className = 'ht-asset';
  // In the All-Accounts view, tag each holding with its owner so the same fund
  // held in two accounts is distinguishable. When rows are combined, show the
  // number of accounts instead of a single owner.
  let tag = '';
  if (typeof ACCOUNTS !== 'undefined' && ACCOUNTS.isAll() && ACCOUNTS.list.length > 1) {
    if (r.combinedCount > 1) {
      tag = ` <span class="ht-acct-tag">👪 ${r.combinedCount} accounts</span>`;
    } else if (r.account) {
      const an = ACCOUNTS.name(r.account);
      if (an) tag = ` <span class="ht-acct-tag">${an}</span>`;
    }
  }
  row.innerHTML = `
    <div class="ht-asset-name">${r.name}${tag}</div>
    <div class="ht-asset-num">₹${formatINR(r.invested)}</div>
    <div class="ht-asset-num">${r.currentValue > 0 ? '₹' + formatINR(r.currentValue) : '—'}</div>
    <div class="ht-asset-num ${pnlCls}">${pnl !== null ? (pnl >= 0 ? '+' : '-') + '₹' + formatINR(Math.abs(pnl)) : '—'}</div>
  `;
  return row;
}

function toggleSection(section, toggleEl) {
  const collapsed = section.dataset.collapsed === 'true';
  section.dataset.collapsed = String(!collapsed);
  if (toggleEl) toggleEl.classList.toggle('collapsed', !collapsed);
}
