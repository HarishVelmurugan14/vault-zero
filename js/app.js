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
  assetFilter: null,     // asset id string or null = all
};

// Load all subcategory names from the sheet into SUBCAT_NAMES (extends the static map)
async function loadSubcatNames() {
  try {
    const data = await API.get('subcategories', { limit: 500 });
    (data.rows || []).forEach(s => { SUBCAT_NAMES[s.id] = s.name; });
  } catch (_) {}
}

// ── API token modal ───────────────────────────────────────────────────────────

function showTokenModal(invalid = false) {
  document.getElementById('vz-token-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'vz-token-modal';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    background:rgba(10,11,15,0.92);backdrop-filter:blur(8px);
    display:flex;align-items:center;justify-content:center;padding:20px;
  `;

  overlay.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
                padding:32px 28px;max-width:380px;width:100%;text-align:center;">
      <div style="font-size:28px;margin-bottom:12px;">🔑</div>
      <div style="font-size:17px;font-weight:700;color:var(--text);margin-bottom:6px;">VaultZero</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:24px;">Enter your API key to continue</div>
      ${invalid ? `<div style="font-size:12px;color:#ef4444;margin-bottom:14px;background:rgba(239,68,68,0.1);padding:8px 12px;border-radius:6px;">
        Invalid key — try again</div>` : ''}
      <input id="vz-token-input" type="password" placeholder="Paste your API key"
        style="width:100%;box-sizing:border-box;background:var(--surface2);border:1px solid var(--border);
               border-radius:8px;padding:11px 14px;color:var(--text);font-size:14px;
               outline:none;margin-bottom:14px;"
        autocomplete="off" />
      <button id="vz-token-submit"
        style="width:100%;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;
               border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:600;
               cursor:pointer;">
        Unlock
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  const input  = overlay.querySelector('#vz-token-input');
  const submit = overlay.querySelector('#vz-token-submit');

  input.focus();

  async function tryToken() {
    const token = input.value.trim();
    if (!token) return;
    submit.disabled = true;
    submit.textContent = 'Checking…';
    AUTH.set(token);
    try {
      // Test with a lightweight call
      await API.get('buckets', { limit: 1 });
      overlay.remove();          // success — app is now unlocked
      loadSubcatNames();
      renderNav();
      showPage('log');
    } catch (err) {
      if (err.message === 'unauthorized') {
        AUTH.clear();
        showTokenModal(true);    // show invalid-key message
      } else {
        // Network/other error — token might be fine, let them in
        overlay.remove();
        renderNav();
        showPage('log');
      }
    }
  }

  submit.addEventListener('click', tryToken);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') tryToken(); });
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  // If no token saved yet, show the key modal before anything else
  if (!AUTH.get()) {
    showTokenModal();
    return;
  }

  loadSubcatNames(); // fire-and-forget — populates SUBCAT_NAMES before user reaches Holdings/Insights
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

  if (STATE.stream?.isSIPStream) {
    const container = document.getElementById('log-content');
    container.innerHTML = '';
    setHeader('log-content', STATE.category.name, () => renderCategories('log'));
    await renderSIPPage(container, STATE.stream);
    return;
  }

  if (STATE.stream?.staticBalance) {
    const container = document.getElementById('log-content');
    container.innerHTML = '';
    setHeader('log-content', STATE.category.name, () => renderCategories('log'));
    await renderBalanceUpdateForm(container, STATE.stream);
    return;
  }

  // US Equity (IBKR) — custom wire-aware log screen
  if (STATE.stream?.usEquity) {
    const usContainer = document.getElementById('log-content');
    usContainer.innerHTML = '';
    setHeader('log-content', STATE.subcategory?.name || STATE.category.name, () => {
      STATE.category.hasSubcategories ? renderSubcategories('log') : renderCategories('log');
    });
    await renderUsEquityForm(usContainer, STATE.stream, STATE.category, STATE.subcategory);
    return;
  }

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
      subcatSelect.innerHTML = '<option value="">All Subcategories</option>';
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
      // Show all transactions for the category right away; subcat dropdown narrows.
      STATE.stream = resolveStream(cat, null);
      await renderHistoryInArea(txnArea);
    } else {
      STATE.stream = resolveStream(cat, null);
      await renderHistoryInArea(txnArea);
    }
  });

  subcatSelect.addEventListener('change', async () => {
    const opt = subcatSelect.options[subcatSelect.selectedIndex];
    txnArea.innerHTML = '';
    STATE.editMode = false;
    if (!opt || !opt.value) {
      // "All Subcategories" — show the whole category again
      STATE.subcategory = null;
      STATE.stream = resolveStream(STATE.category, null);
      await renderHistoryInArea(txnArea);
      return;
    }
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
  STATE.historyRows   = [];
  STATE.editMode      = false;
  STATE.assetFilter   = null;
  area.innerHTML = '';

  // ── Toolbar (edit button) ──────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.className = 'history-toolbar';
  const editBtn = document.createElement('button');
  editBtn.className = 'btn-outline btn-sm';
  editBtn.textContent = 'Edit';
  editBtn.id = 'history-edit-btn';
  toolbar.appendChild(editBtn);
  area.appendChild(toolbar);

  // ── Asset filter bar (shown after load if >1 unique asset) ─
  const assetFilterBar = document.createElement('div');
  assetFilterBar.className = 'history-asset-filter-bar';
  assetFilterBar.style.display = 'none';

  const assetSel = document.createElement('select');
  assetSel.className = 'holdings-filter-select';

  const selectAllBtn = document.createElement('button');
  selectAllBtn.className = 'btn-outline btn-sm';
  selectAllBtn.textContent = 'Select All';

  assetFilterBar.appendChild(assetSel);
  assetFilterBar.appendChild(selectAllBtn);
  area.appendChild(assetFilterBar);

  // ── Summary card area ─────────────────────────────────────
  const summaryEl = document.createElement('div');
  summaryEl.id = 'history-summary';
  area.appendChild(summaryEl);

  // ── Transaction list ──────────────────────────────────────
  const txnList = document.createElement('div');
  txnList.id = 'txn-list';
  area.appendChild(txnList);

  const loadMoreBtn = document.createElement('button');
  loadMoreBtn.className = 'btn-outline load-more';
  loadMoreBtn.textContent = 'Load More';
  loadMoreBtn.style.display = 'none';
  loadMoreBtn.addEventListener('click', () => loadMoreTxns(txnList, loadMoreBtn, assetSel, summaryEl));
  area.appendChild(loadMoreBtn);

  // ── Edit action bar ───────────────────────────────────────
  const actionBar = document.createElement('div');
  actionBar.className = 'edit-action-bar';
  actionBar.id = 'edit-action-bar';
  actionBar.style.display = 'none';
  actionBar.innerHTML = `
    <button class="btn-secondary" id="edit-cancel-btn">Cancel</button>
    <button class="btn-primary" id="edit-save-btn">Save All</button>
  `;
  area.appendChild(actionBar);

  // ── Wire up events ────────────────────────────────────────
  editBtn.addEventListener('click', () => toggleEditMode(txnList, editBtn, summaryEl));

  actionBar.querySelector('#edit-cancel-btn').addEventListener('click', () => {
    STATE.editMode = false;
    renderHistoryInArea(area);
  });
  actionBar.querySelector('#edit-save-btn').addEventListener('click', () => saveEdits(txnList, area));

  assetSel.addEventListener('change', () => {
    STATE.assetFilter = assetSel.value || null;
    renderFilteredList(txnList, summaryEl);
  });

  selectAllBtn.addEventListener('click', async () => {
    selectAllBtn.disabled = true;
    selectAllBtn.textContent = 'Loading…';
    while (STATE.historyOffset < STATE.historyTotal) {
      await loadTxns(txnList, loadMoreBtn, assetSel, summaryEl);
    }
    loadMoreBtn.style.display = 'none';
    selectAllBtn.style.display = 'none';
    selectAllBtn.disabled = false;
    selectAllBtn.textContent = 'Select All';
  });

  await loadTxns(txnList, loadMoreBtn, assetSel, summaryEl);
}

async function loadTxns(txnList, loadMoreBtn, assetSel, summaryEl) {
  const stream = STATE.stream || resolveStream(STATE.category, STATE.subcategory?.name);
  STATE.stream = stream;

  try {
    const assets = await fetchAssetsCached(stream);
    assets.forEach(a => { STATE.assetMap[a.id] = a; });
  } catch (_) {}

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
    STATE.historyRows.push(txn);
  });

  STATE.historyOffset += data.rows.length;
  loadMoreBtn.style.display = STATE.historyOffset < STATE.historyTotal ? 'block' : 'none';

  populateAssetFilter(assetSel, stream);
  renderFilteredList(txnList, summaryEl);
}

async function loadMoreTxns(txnList, loadMoreBtn, assetSel, summaryEl) {
  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = 'Loading…';
  await loadTxns(txnList, loadMoreBtn, assetSel, summaryEl);
  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = 'Load More';
}

// ─── Asset filter helpers ───────────────────────────────────────────────────

function populateAssetFilter(assetSel, stream) {
  const prev = assetSel.value;
  const uniqueAssets = new Map();
  STATE.historyRows.forEach(txn => {
    const id = String(txn[stream.assetIdCol]);
    if (!uniqueAssets.has(id)) uniqueAssets.set(id, txn._assetName || id);
  });

  assetSel.innerHTML = '<option value="">All Assets</option>';
  [...uniqueAssets.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([id, name]) => {
      const o = document.createElement('option');
      o.value = id; o.textContent = name;
      assetSel.appendChild(o);
    });

  const bar = assetSel.closest('.history-asset-filter-bar');
  if (bar) bar.style.display = uniqueAssets.size >= 1 ? 'flex' : 'none';
  // Hide the dropdown when there's only one asset — filtering is redundant,
  // but "Select All" still matters for pagination
  assetSel.style.display = uniqueAssets.size > 1 ? '' : 'none';

  if (prev && [...uniqueAssets.keys()].includes(prev)) assetSel.value = prev;
}

function renderFilteredList(txnList, summaryEl) {
  const stream = STATE.stream;
  const rows = STATE.assetFilter
    ? STATE.historyRows.filter(t => String(t[stream.assetIdCol]) === STATE.assetFilter)
    : STATE.historyRows;

  txnList.innerHTML = '';
  rows.forEach(txn => txnList.appendChild(renderTxnRow(txn, stream, STATE.editMode)));

  if (STATE.editMode) wireDeleteButtons(txnList, stream, summaryEl);
  renderHistorySummary(summaryEl, rows, stream);
}

function wireDeleteButtons(txnList, stream, summaryEl) {
  txnList.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this transaction? This cannot be undone.')) return;
      try {
        await API.delete(stream.txnTable, btn.dataset.id);
        btn.closest('.txn-row').remove();
        STATE.historyRows = STATE.historyRows.filter(r => String(r.id) !== String(btn.dataset.id));
        const filtered = STATE.assetFilter
          ? STATE.historyRows.filter(t => String(t[stream.assetIdCol]) === STATE.assetFilter)
          : STATE.historyRows;
        renderHistorySummary(summaryEl, filtered, stream);
        showToast('Transaction deleted.');
      } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
      }
    });
  });
}

function toggleEditMode(txnList, editBtn, summaryEl) {
  STATE.editMode = !STATE.editMode;
  editBtn.textContent = STATE.editMode ? 'Cancel' : 'Edit';
  editBtn.classList.toggle('active', STATE.editMode);

  const actionBar = document.getElementById('edit-action-bar');
  if (actionBar) actionBar.style.display = STATE.editMode ? 'flex' : 'none';

  renderFilteredList(txnList, summaryEl);
}

// ─── History summary ────────────────────────────────────────────────────────

function renderHistorySummary(el, rows, stream) {
  el.innerHTML = '';
  if (!rows.length) return;

  const qtyField = stream.txnFields?.find(f => ['units', 'quantity'].includes(f.id));
  const qtyCol   = qtyField?.id || null;
  const amtCol   = stream.amountCol || 'amount';
  const BUY      = ['Buy', 'SIP'];
  const SELL     = ['Sell', 'SWP'];

  // Per-asset aggregation so current value is computed correctly across assets
  const byAsset = {};
  rows.forEach(txn => {
    const aid = String(txn[stream.assetIdCol]);
    if (!byAsset[aid]) byAsset[aid] = { buyQty: 0, sellQty: 0, buyAmt: 0 };
    const qty = qtyCol ? (parseFloat(txn[qtyCol]) || 0) : 0;
    const amt = parseFloat(txn[amtCol]) || 0;
    if (BUY.includes(txn.txn_type))  { byAsset[aid].buyQty  += qty; byAsset[aid].buyAmt  += amt; }
    if (SELL.includes(txn.txn_type)) { byAsset[aid].sellQty += qty; }
  });

  let totalNetQty = 0, totalBuyQty = 0, totalBuyAmt = 0, totalCurVal = 0, hasPrice = false;
  Object.entries(byAsset).forEach(([aid, d]) => {
    const netQty = d.buyQty - d.sellQty;
    const price  = stream.currentPriceCol
      ? parseFloat(STATE.assetMap[aid]?.[stream.currentPriceCol]) || 0 : 0;
    totalNetQty += netQty;
    totalBuyQty += d.buyQty;
    totalBuyAmt += d.buyAmt;
    if (price > 0) { totalCurVal += netQty * price; hasPrice = true; }
  });

  const avgPrice = totalBuyQty > 0 ? totalBuyAmt / totalBuyQty : 0;
  // Remaining invested = net qty × avg buy price
  const invested = totalBuyQty > 0 ? totalNetQty * avgPrice : totalBuyAmt;
  const pnl      = hasPrice ? totalCurVal - invested : null;
  const pnlPct   = pnl !== null && invested > 0 ? (pnl / invested) * 100 : null;
  const qtyLabel = qtyField?.label || 'Quantity';

  const items = [
    { label: qtyLabel, value: totalNetQty.toLocaleString('en-IN', { maximumFractionDigits: 6 }) },
    { label: 'Avg Price', value: avgPrice > 0 ? '₹' + formatINR(avgPrice) : '—' },
    { label: 'Invested', value: '₹' + formatINR(invested) },
  ];

  if (hasPrice) {
    items.push({ label: 'Current Value', value: '₹' + formatINR(totalCurVal) });
    if (pnl !== null) items.push({
      label: 'Unrealized P&L',
      value: (pnl >= 0 ? '+₹' : '-₹') + formatINR(Math.abs(pnl)),
      sub:   pnlPct !== null ? `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%` : '',
      cls:   pnl >= 0 ? 'positive' : 'negative',
    });
  }

  const card = document.createElement('div');
  card.className = 'history-summary-card';
  card.innerHTML = `<div class="history-summary-grid">${
    items.map(it => `
      <div class="history-summary-item">
        <span class="history-summary-label">${it.label}</span>
        <span class="history-summary-value ${it.cls || ''}">${it.value}${
          it.sub ? `<span class="history-summary-pct"> ${it.sub}</span>` : ''
        }</span>
      </div>
    `).join('')
  }</div>`;
  el.appendChild(card);
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
