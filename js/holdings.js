// VaultZero — Holdings page

let _holdingsAllRows = null;

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

  const catSelect = document.createElement('select');
  catSelect.className = 'holdings-filter-select';
  catSelect.innerHTML = '<option value="">All Categories</option>';
  const cats = [...new Set(allRows.map(r => r.catName))];
  cats.forEach(c => {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = c;
    catSelect.appendChild(o);
  });

  const subcatSelect = document.createElement('select');
  subcatSelect.className = 'holdings-filter-select';
  subcatSelect.innerHTML = '<option value="">All Subcategories</option>';

  function populateSubcats(catName) {
    subcatSelect.innerHTML = '<option value="">All Subcategories</option>';
    const subcats = [...new Set(
      allRows
        .filter(r => !catName || r.catName === catName)
        .map(r => r.subcategory)
        .filter(Boolean)
    )].sort();
    subcats.forEach(s => {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s;
      subcatSelect.appendChild(o);
    });
    subcatSelect.disabled = subcats.length === 0;
  }

  populateSubcats('');

  catSelect.addEventListener('change', () => {
    subcatSelect.value = '';
    populateSubcats(catSelect.value);
    applyFilter();
  });

  subcatSelect.addEventListener('change', applyFilter);

  const tableWrap = document.createElement('div');

  function applyFilter() {
    const cat = catSelect.value;
    const subcat = subcatSelect.value;
    const filtered = allRows.filter(r =>
      (!cat || r.catName === cat) &&
      (!subcat || r.subcategory === subcat)
    );
    renderHoldingsTable(tableWrap, filtered, { singleCat: !!cat, singleSubcat: !!subcat });
  }

  filterBar.appendChild(catSelect);
  filterBar.appendChild(subcatSelect);
  container.appendChild(filterBar);
  container.appendChild(tableWrap);

  applyFilter();
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
  ];

  const allSheets = [...new Set(streamEntries.flatMap(e => [e.stream.assetTable, e.stream.txnTable])), 'manual_prices'];
  const res = await API.batchGet(allSheets);
  const manualPricesMap = buildManualPricesMap(res['manual_prices']?.rows || []);

  const rows = [];
  for (const entry of streamEntries) {
    const { cat, stream, subcatName } = entry;
    const assets = res[stream.assetTable]?.rows || [];
    const txns   = res[stream.txnTable]?.rows   || [];
    if (!assets.length) continue;

    const investedByAsset = {};
    const qtyByAsset      = {};
    txns.forEach(t => {
      const aid  = String(t[stream.assetIdCol]);
      const sign = t.txn_type === 'Buy' ? 1 : -1;
      let amt = 0;
      if (stream.amountCol) {
        amt = parseFloat(t[stream.amountCol] || 0);
      } else {
        amt = parseFloat(t.quantity || 0) * parseFloat(t.price_per_unit || 0)
            + parseFloat(t.registration_cost || 0)
            + parseFloat(t.other_expenses    || 0);
      }
      investedByAsset[aid] = (investedByAsset[aid] || 0) + sign * amt;
      const qty = parseFloat(t.units || t.quantity || 0);
      qtyByAsset[aid] = (qtyByAsset[aid] || 0) + sign * qty;
    });

    assets.forEach(a => {
      const invested = investedByAsset[String(a.id)] || 0;
      if (!invested) return;
      const resolvedSubcat = subcatName || SUBCAT_NAMES[a.subcategory_id] || '';

      let currentValue = 0;
      const qty = qtyByAsset[String(a.id)] || 0;
      if (stream.currentPriceCol) {
        const price = parseFloat(a[stream.currentPriceCol] || 0);
        if (price > 0 && qty > 0) currentValue = qty * price;
      } else if (stream.manualPriceType) {
        const price = manualPricesMap[`${stream.manualPriceType}|${String(a.id)}`] || 0;
        if (price > 0 && qty > 0) currentValue = qty * price;
      }

      rows.push({ catId: cat.id, catName: cat.name, bucketId: cat.bucket_id, subcategory: resolvedSubcat, name: a[stream.assetNameCol], invested, currentValue });
    });
  }

  const bucketOrder = BUCKETS.reduce((m, b, i) => { m[b.id] = i; return m; }, {});
  const catOrder    = CATEGORIES.reduce((m, c, i) => { m[c.id] = i; return m; }, {});
  rows.sort((a, b) =>
    bucketOrder[a.bucketId] - bucketOrder[b.bucketId] ||
    catOrder[a.catId]       - catOrder[b.catId] ||
    a.subcategory.localeCompare(b.subcategory) ||
    a.name.localeCompare(b.name)
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
    <div class="ht-grand-num ${grandPnL !== null ? (grandPnL >= 0 ? 'positive' : 'negative') : ''}">${grandPnL !== null ? (grandPnL >= 0 ? '+' : '') + '₹' + formatINR(Math.abs(grandPnL)) : '—'}</div>
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
    <div class="ht-bucket-num ${pnlCls}">${pnl !== null ? (pnl >= 0 ? '+' : '') + '₹' + formatINR(Math.abs(pnl)) : '—'}</div>
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
    <div class="ht-category-num ${pnlCls}">${pnl !== null ? (pnl >= 0 ? '+' : '') + '₹' + formatINR(Math.abs(pnl)) : '—'}</div>
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
    <div class="ht-subcat-num ${pnlCls}">${pnl !== null ? (pnl >= 0 ? '+' : '') + '₹' + formatINR(Math.abs(pnl)) : '—'}</div>
  `;
  return row;
}

function makeAssetRow(r) {
  const pnl    = r.currentValue > 0 ? r.currentValue - r.invested : null;
  const pnlCls = pnl !== null ? (pnl >= 0 ? 'positive' : 'negative') : '';
  const row    = document.createElement('div');
  row.className = 'ht-asset';
  row.innerHTML = `
    <div class="ht-asset-name">${r.name}</div>
    <div class="ht-asset-num">₹${formatINR(r.invested)}</div>
    <div class="ht-asset-num">${r.currentValue > 0 ? '₹' + formatINR(r.currentValue) : '—'}</div>
    <div class="ht-asset-num ${pnlCls}">${pnl !== null ? (pnl >= 0 ? '+' : '') + '₹' + formatINR(Math.abs(pnl)) : '—'}</div>
  `;
  return row;
}

function toggleSection(section, toggleEl) {
  const collapsed = section.dataset.collapsed === 'true';
  section.dataset.collapsed = String(!collapsed);
  if (toggleEl) toggleEl.classList.toggle('collapsed', !collapsed);
}
