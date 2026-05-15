// VaultZero — Holdings page

let _holdingsAllRows = null;

async function renderHoldings() {
  const container = document.getElementById('holdings-content');
  const header = document.getElementById('holdings-header');
  if (header) header.innerHTML = '<h2>Holdings</h2>';

  container.innerHTML = '<div class="holdings-loading">Loading holdings…</div>';

  try {
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
  const rows = [];

  const streamEntries = [
    { cat: CATEGORIES.find(c => c.id === 1), stream: STREAMS.equity_mf, subcatName: null },
    { cat: CATEGORIES.find(c => c.id === 2), stream: STREAMS.indian_stocks, subcatName: null },
    { cat: CATEGORIES.find(c => c.id === 3), stream: STREAMS.us_stocks, subcatName: null },
    { cat: CATEGORIES.find(c => c.id === 4), stream: STREAMS.real_estate, subcatName: null },
    { cat: CATEGORIES.find(c => c.id === 5), stream: STREAMS.debt_hybrid_mf, subcatName: null },
    { cat: CATEGORIES.find(c => c.id === 6), stream: STREAMS.precious_metals_digital, subcatName: 'Digital' },
    { cat: CATEGORIES.find(c => c.id === 6), stream: STREAMS.precious_metals_physical, subcatName: 'Physical' },
    { cat: CATEGORIES.find(c => c.id === 7), stream: STREAMS.crypto, subcatName: null },
  ];

  for (const entry of streamEntries) {
    const { cat, stream, subcatName } = entry;
    if (!stream) continue;

    const [assetsData, txnsData] = await Promise.all([
      API.get(stream.assetTable, { limit: 500 }),
      API.get(stream.txnTable, { limit: 5000 }),
    ]);

    const assets = assetsData.rows || [];
    const txns = txnsData.rows || [];
    if (!assets.length) continue;

    const byAsset = {};
    txns.forEach(t => {
      const aid = String(t[stream.assetIdCol]);
      const sign = t.txn_type === 'Buy' ? 1 : -1;
      let amt = 0;
      if (stream.amountCol) {
        amt = parseFloat(t[stream.amountCol] || 0);
      } else {
        amt = parseFloat(t.quantity || 0) * parseFloat(t.price_per_unit || 0)
            + parseFloat(t.registration_cost || 0)
            + parseFloat(t.other_expenses || 0);
      }
      byAsset[aid] = (byAsset[aid] || 0) + sign * amt;
    });

    assets.forEach(a => {
      const invested = byAsset[String(a.id)] || 0;
      if (!invested) return;
      const resolvedSubcat = subcatName || SUBCAT_NAMES[a.subcategory_id] || '';
      rows.push({
        catId: cat.id,
        catName: cat.name,
        subcategory: resolvedSubcat,
        name: a[stream.assetNameCol],
        invested,
      });
    });
  }

  const catOrder = CATEGORIES.reduce((m, c, i) => { m[c.id] = i; return m; }, {});
  rows.sort((a, b) =>
    catOrder[a.catId] - catOrder[b.catId] ||
    a.subcategory.localeCompare(b.subcategory) ||
    a.name.localeCompare(b.name)
  );

  return rows;
}

function renderHoldingsTable(wrap, rows, { singleCat = false, singleSubcat = false } = {}) {
  wrap.innerHTML = '';

  if (!rows.length) {
    wrap.innerHTML = '<div class="holdings-empty">No holdings match the selected filter.</div>';
    return;
  }

  const tableWrap = document.createElement('div');
  tableWrap.className = 'holdings-table-wrap';

  const table = document.createElement('table');
  table.className = 'holdings-table';

  table.innerHTML = `
    <thead>
      <tr>
        ${!singleCat ? '<th>Category</th>' : ''}
        ${!singleSubcat ? '<th>Subcategory</th>' : ''}
        <th>Name</th>
        <th class="num">Invested (₹)</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement('tbody');

  let currentCatId = null;
  let catTotal = 0;
  let grandTotal = 0;

  rows.forEach((r, idx) => {
    if (!singleCat && r.catId !== currentCatId) {
      if (currentCatId !== null) {
        const totalRow = document.createElement('tr');
        totalRow.className = 'cat-total';
        totalRow.innerHTML = `<td colspan="${colSpan(singleCat, singleSubcat) - 1}">${rows[idx - 1].catName} Total</td><td class="num">₹${formatINR(catTotal)}</td>`;
        tbody.appendChild(totalRow);
      }
      currentCatId = r.catId;
      catTotal = 0;

      const groupRow = document.createElement('tr');
      groupRow.className = 'cat-group';
      groupRow.innerHTML = `<td colspan="${colSpan(singleCat, singleSubcat)}">${r.catName}</td>`;
      tbody.appendChild(groupRow);
    }

    catTotal += r.invested;
    grandTotal += r.invested;

    const tr = document.createElement('tr');
    const cells = [];
    if (!singleCat) cells.push(`<td></td>`);
    if (!singleSubcat) cells.push(`<td class="subcat-label">${r.subcategory}</td>`);
    cells.push(`<td class="asset-name">${r.name}</td>`);
    cells.push(`<td class="num">₹${formatINR(r.invested)}</td>`);
    tr.innerHTML = cells.join('');
    tbody.appendChild(tr);
  });

  if (!singleCat && currentCatId !== null) {
    const totalRow = document.createElement('tr');
    totalRow.className = 'cat-total';
    totalRow.innerHTML = `<td colspan="${colSpan(singleCat, singleSubcat) - 1}">${rows[rows.length - 1].catName} Total</td><td class="num">₹${formatINR(catTotal)}</td>`;
    tbody.appendChild(totalRow);
  }

  const grandRow = document.createElement('tr');
  grandRow.className = 'grand-total';
  grandRow.innerHTML = `<td colspan="${colSpan(singleCat, singleSubcat) - 1}">Total</td><td class="num">₹${formatINR(grandTotal)}</td>`;
  tbody.appendChild(grandRow);

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  wrap.appendChild(tableWrap);
}

function colSpan(singleCat, singleSubcat) {
  return 4 - (singleCat ? 1 : 0) - (singleSubcat ? 1 : 0);
}
