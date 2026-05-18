// VaultZero — App routing and navigation

// State
const STATE = {
  page: 'log',           // 'log' | 'history'
  bucket: null,
  category: null,
  subcategory: null,
  stream: null,
  historyOffset: 0,
  historyTotal: 0,
  historyRows: [],
  assetMap: {},          // asset id → asset object (for name display in history)
  editMode: false,
};

// Boot
document.addEventListener('DOMContentLoaded', () => {
  renderNav();
  showPage('log');
  // Warm insights + holdings cache in the background so first tab click is instant
  setTimeout(() => {
    if (!LSC.get('insights')) {
      fetchAllInsightsData().then(d => { _insightsCache = d; }).catch(() => {});
    }
    if (!LSC.get('holdings') && !_holdingsAllRows) {
      buildHoldingsRows().then(r => { _holdingsAllRows = r; }).catch(() => {});
    }
  }, 3000);
});

// Top nav tab switching
function renderNav() {
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      showPage(btn.dataset.nav);
    });
  });
}

function showPage(page) {
  STATE.page = page;
  STATE.bucket = null;
  STATE.category = null;
  STATE.subcategory = null;
  STATE.stream = null;
  STATE.editMode = false;

  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === page));
  document.getElementById('page-log').style.display = page === 'log' ? 'block' : 'none';
  document.getElementById('page-history').style.display = page === 'history' ? 'block' : 'none';
  document.getElementById('page-holdings').style.display = page === 'holdings' ? 'block' : 'none';
  document.getElementById('page-insights').style.display = page === 'insights' ? 'block' : 'none';

  if (page === 'log') renderBuckets('log');
  if (page === 'history') renderHistoryPage();
  if (page === 'holdings') renderHoldings();
  if (page === 'insights') renderInsights();
}

// ─── LOG PAGE ──────────────────────────────────────────────────────────────────

function renderBuckets(page) {
  const containerId = page === 'log' ? 'log-content' : 'history-content';
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'bucket-grid';

  BUCKETS.forEach(b => {
    const card = document.createElement('div');
    card.className = 'bucket-card';
    card.innerHTML = `<span class="bucket-icon">${b.icon}</span><span class="bucket-name">${b.name}</span>`;
    card.style.setProperty('--accent', b.color);
    card.addEventListener('click', () => {
      STATE.bucket = b;
      if (page === 'log') renderCategories('log');
      else renderCategories('history');
    });
    grid.appendChild(card);
  });

  container.appendChild(grid);
  setHeader(containerId, CONFIG.APP_NAME, null);
}

function renderCategories(page) {
  const containerId = page === 'log' ? 'log-content' : 'history-content';
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const cats = CATEGORIES.filter(c => c.bucket_id === STATE.bucket.id);
  const list = document.createElement('div');
  list.className = 'list';

  cats.forEach(c => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.textContent = c.name;
    item.addEventListener('click', () => {
      STATE.category = c;
      if (page === 'log') {
        if (c.hasSubcategories) renderSubcategories('log');
        else startLogForm();
      } else {
        if (c.hasSubcategories) renderSubcategories('history');
        else renderHistory();
      }
    });
    list.appendChild(item);
  });

  container.appendChild(list);
  setHeader(containerId, STATE.bucket.name, () => renderBuckets(page));
}

function renderSubcategories(page) {
  const containerId = page === 'log' ? 'log-content' : 'history-content';
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  API.getSubcategories(STATE.category.id).then(data => {
    const list = document.createElement('div');
    list.className = 'list';

    (data.rows || []).forEach(s => {
      const item = document.createElement('div');
      item.className = 'list-item';
      item.textContent = s.name;
      item.addEventListener('click', () => {
        STATE.subcategory = s;
        STATE.stream = resolveStream(STATE.category, s.name);
        if (page === 'log') startLogForm();
        else renderHistory();
      });
      list.appendChild(item);
    });

    container.appendChild(list);
    setHeader(containerId, STATE.category.name, () => renderCategories(page));
  }).catch(() => showToast('Failed to load subcategories', 'error'));
}

async function startLogForm() {
  STATE.stream = STATE.stream || resolveStream(STATE.category, STATE.subcategory?.name);
  const container = document.getElementById('log-content');
  container.innerHTML = '';

  const formEl = document.createElement('form');
  formEl.id = 'txn-form';

  const fieldsDiv = document.createElement('div');
  fieldsDiv.id = 'form-fields';
  formEl.appendChild(fieldsDiv);

  container.appendChild(formEl);
  setHeader('log-content', STATE.category.name, () => {
    STATE.category.hasSubcategories ? renderSubcategories('log') : renderCategories('log');
  });

  await renderTransactionForm(fieldsDiv, STATE.stream, STATE.category, STATE.subcategory);

  formEl.addEventListener('submit', async e => {
    e.preventDefault();
    const { errors, values, assetId } = collectAndValidateTxn(STATE.stream);

    if (errors.length) {
      showToast(errors[0], 'error');
      return;
    }

    const btn = document.getElementById('txn-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      values[STATE.stream.assetIdCol] = assetId;
      await API.createTransaction(STATE.stream, values);
      _insightsCache = null;
      _holdingsAllRows = null;
      LSC.clear('insights', 'holdings');
      showToast('Transaction saved!');
      // Reset form
      fieldsDiv.innerHTML = '';
      await renderTransactionForm(fieldsDiv, STATE.stream, STATE.category, STATE.subcategory);
    } catch (err) {
      showToast('Failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Transaction';
    }
  });
}

// ─── HISTORY PAGE ──────────────────────────────────────────────────────────────

async function renderHistoryPage() {
  const container = document.getElementById('history-content');
  const header = document.getElementById('history-header');
  if (header) header.innerHTML = '<h2>History</h2>';
  container.innerHTML = '';

  STATE.category = null;
  STATE.subcategory = null;
  STATE.stream = null;
  STATE.editMode = false;

  // ── Filter bar ────────────────────────────────────────────
  const filterBar = document.createElement('div');
  filterBar.className = 'holdings-filter-bar';

  const catSelect = document.createElement('select');
  catSelect.className = 'holdings-filter-select';
  catSelect.innerHTML = '<option value="">Select Category…</option>';
  CATEGORIES.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    catSelect.appendChild(o);
  });

  const subcatSelect = document.createElement('select');
  subcatSelect.className = 'holdings-filter-select';
  subcatSelect.style.display = 'none';

  const txnArea = document.createElement('div');
  txnArea.id = 'history-txn-area';

  catSelect.addEventListener('change', async () => {
    const catId = parseInt(catSelect.value);
    txnArea.innerHTML = '';
    subcatSelect.style.display = 'none';
    subcatSelect.innerHTML = '';
    STATE.subcategory = null;
    STATE.editMode = false;

    if (!catId) { STATE.category = null; STATE.stream = null; return; }

    const cat = CATEGORIES.find(c => c.id === catId);
    STATE.category = cat;

    if (cat.hasSubcategories) {
      subcatSelect.innerHTML = '<option value="">Select Subcategory…</option>';
      subcatSelect.style.display = 'block';
      try {
        const data = await API.getSubcategories(cat.id);
        (data.rows || []).forEach(s => {
          const o = document.createElement('option');
          o.value = s.id;
          o.dataset.name = s.name;
          o.textContent = s.name;
          subcatSelect.appendChild(o);
        });
      } catch (_) { showToast('Failed to load subcategories', 'error'); }
      STATE.stream = null;
    } else {
      STATE.stream = resolveStream(cat, null);
      await renderHistoryInArea(txnArea);
    }
  });

  subcatSelect.addEventListener('change', async () => {
    const opt = subcatSelect.options[subcatSelect.selectedIndex];
    txnArea.innerHTML = '';
    STATE.editMode = false;
    if (!opt || !opt.value) { STATE.subcategory = null; STATE.stream = null; return; }
    STATE.subcategory = { id: parseInt(opt.value), name: opt.dataset.name };
    STATE.stream = resolveStream(STATE.category, opt.dataset.name);
    await renderHistoryInArea(txnArea);
  });

  filterBar.appendChild(catSelect);
  filterBar.appendChild(subcatSelect);
  container.appendChild(filterBar);
  container.appendChild(txnArea);
}

async function renderHistoryInArea(area) {
  STATE.historyOffset = 0;
  STATE.historyRows = [];
  STATE.editMode = false;
  area.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'history-toolbar';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-outline btn-sm';
  editBtn.textContent = 'Edit';
  editBtn.id = 'history-edit-btn';
  toolbar.appendChild(editBtn);
  area.appendChild(toolbar);

  const txnList = document.createElement('div');
  txnList.id = 'txn-list';
  area.appendChild(txnList);

  const loadMoreBtn = document.createElement('button');
  loadMoreBtn.className = 'btn-outline load-more';
  loadMoreBtn.textContent = 'Load More';
  loadMoreBtn.style.display = 'none';
  loadMoreBtn.addEventListener('click', () => loadMoreTxns(txnList, loadMoreBtn));
  area.appendChild(loadMoreBtn);

  const actionBar = document.createElement('div');
  actionBar.className = 'edit-action-bar';
  actionBar.id = 'edit-action-bar';
  actionBar.style.display = 'none';
  actionBar.innerHTML = `
    <button class="btn-secondary" id="edit-cancel-btn">Cancel</button>
    <button class="btn-primary" id="edit-save-btn">Save All</button>
  `;
  area.appendChild(actionBar);

  editBtn.addEventListener('click', () => toggleEditMode(txnList, editBtn));
  actionBar.querySelector('#edit-cancel-btn').addEventListener('click', () => {
    STATE.editMode = false;
    renderHistoryInArea(area);
  });
  actionBar.querySelector('#edit-save-btn').addEventListener('click', () => saveEdits(txnList, area));

  await loadTxns(txnList, loadMoreBtn);
}

async function loadTxns(list, loadMoreBtn) {
  const stream = STATE.stream || resolveStream(STATE.category, STATE.subcategory?.name);
  STATE.stream = stream;

  try {
    const assets = await fetchAssetsCached(stream);
    assets.forEach(a => { STATE.assetMap[a.id] = a; });
  } catch (_) {}

  // Build a set of asset IDs belonging to the selected subcategory (if any)
  const subcatAssetIds = STATE.subcategory
    ? new Set(
        Object.values(STATE.assetMap)
          .filter(a => String(a.subcategory_id) === String(STATE.subcategory.id))
          .map(a => String(a.id))
      )
    : null;

  const data = await API.getTransactions(stream, {}, STATE.historyOffset);
  STATE.historyTotal = data.total;

  data.rows.forEach(txn => {
    const assetId = String(txn[stream.assetIdCol]);
    if (subcatAssetIds && !subcatAssetIds.has(assetId)) return;
    txn._assetName = STATE.assetMap[txn[stream.assetIdCol]]?.[stream.assetNameCol] || '';
    const row = renderTxnRow(txn, stream, STATE.editMode);
    list.appendChild(row);
    STATE.historyRows.push(txn);
  });

  STATE.historyOffset += data.rows.length;

  loadMoreBtn.style.display =
    STATE.historyOffset < STATE.historyTotal ? 'block' : 'none';
}

async function loadMoreTxns(list, loadMoreBtn) {
  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = 'Loading...';
  await loadTxns(list, loadMoreBtn);
  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = 'Load More';
}

function toggleEditMode(txnList, editBtn) {
  STATE.editMode = !STATE.editMode;
  editBtn.textContent = STATE.editMode ? 'Cancel' : 'Edit';
  editBtn.classList.toggle('active', STATE.editMode);

  const actionBar = document.getElementById('edit-action-bar');
  if (actionBar) actionBar.style.display = STATE.editMode ? 'flex' : 'none';

  // Re-render all rows in edit or read mode
  const stream = STATE.stream;
  txnList.innerHTML = '';
  STATE.historyRows.forEach(txn => {
    const row = renderTxnRow(txn, stream, STATE.editMode);
    txnList.appendChild(row);
  });

  // Wire delete buttons
  txnList.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this transaction? This cannot be undone.')) return;
      try {
        await API.delete(stream.txnTable, btn.dataset.id);
        btn.closest('.txn-row').remove();
        STATE.historyRows = STATE.historyRows.filter(r => String(r.id) !== String(btn.dataset.id));
        showToast('Transaction deleted.');
      } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
      }
    });
  });
}

async function saveEdits(txnList, area) {
  const stream = STATE.stream;
  const edited = collectEditedRows(txnList, stream);

  if (!edited.length) {
    showToast('No changes to save.');
    return;
  }

  const saveBtn = document.getElementById('edit-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    await API.batchUpdate(stream.txnTable, edited);
    showToast(`${edited.length} transaction(s) saved.`);
    STATE.editMode = false;
    if (area) renderHistoryInArea(area);
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save All';
  }
}

// ─── SHARED HEADER ─────────────────────────────────────────────────────────────

function setHeader(containerId, title, backFn) {
  let header = document.getElementById('history-header');
  if (containerId === 'log-content') header = document.getElementById('log-header');

  if (!header) return;
  header.innerHTML = '';

  if (backFn) {
    const back = document.createElement('button');
    back.className = 'btn-back';
    back.textContent = '← Back';
    back.addEventListener('click', backFn);
    header.appendChild(back);
  }

  const h2 = document.createElement('h2');
  h2.textContent = title;
  header.appendChild(h2);
}
