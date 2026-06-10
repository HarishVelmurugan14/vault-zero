// VaultZero — Dynamic form rendering

// Render a field element
function renderField(field, value = '') {
  const wrapper = document.createElement('div');
  wrapper.className = 'field-group';
  wrapper.dataset.fieldId = field.id;

  const label = document.createElement('label');
  label.textContent = field.label + (field.required ? ' *' : '');
  label.htmlFor = `field-${field.id}`;
  wrapper.appendChild(label);

  let input;

  if (field.type === 'select') {
    input = document.createElement('select');
    input.id = `field-${field.id}`;
    input.name = field.id;
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = `Select ${field.label}`;
    input.appendChild(blank);
    (field.options || []).forEach(opt => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === value) o.selected = true;
      input.appendChild(o);
    });
  } else {
    input = document.createElement('input');
    input.type = field.type === 'number' ? 'number' : (field.type === 'date' ? 'date' : 'text');
    input.id = `field-${field.id}`;
    input.name = field.id;
    if (field.step) input.step = field.step;
    if (field.placeholder) input.placeholder = field.placeholder;
    if (field.readonly) {
      input.readOnly = true;
      input.classList.add('readonly');
    }
    if (value !== '' && value !== undefined) input.value = value;
  }

  if (field.required) input.required = true;
  wrapper.appendChild(input);

  const err = document.createElement('span');
  err.className = 'field-error';
  wrapper.appendChild(err);

  return wrapper;
}

// Render the asset name dropdown (with existing assets + Add New option)
function renderAssetDropdown(assets, stream, selectedId = '') {
  const wrapper = document.createElement('div');
  wrapper.className = 'field-group';

  const label = document.createElement('label');
  label.textContent = 'Name *';
  label.htmlFor = 'field-asset-name';
  wrapper.appendChild(label);

  const select = document.createElement('select');
  select.id = 'field-asset-name';
  select.name = 'asset_id';
  select.required = true;

  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Select or add...';
  select.appendChild(blank);

  assets.forEach(a => {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = a[stream.assetNameCol];
    o.dataset.asset = JSON.stringify(a);
    if (String(a.id) === String(selectedId)) o.selected = true;
    select.appendChild(o);
  });

  const addOpt = document.createElement('option');
  addOpt.value = '__new__';
  addOpt.textContent = '+ Add New Asset';
  select.appendChild(addOpt);

  wrapper.appendChild(select);

  const err = document.createElement('span');
  err.className = 'field-error';
  wrapper.appendChild(err);

  return { wrapper, select };
}

// Render the transaction form for a stream
async function renderTransactionForm(container, stream, category, subcategory) {
  container.innerHTML = '';

  // Fetch existing assets for the dropdown, filtered by subcategory if set
  let assets = [];
  try {
    const all = await fetchAssetsCached(stream);
    assets = subcategory
      ? all.filter(a => String(a.subcategory_id) === String(subcategory.id))
      : all;
  } catch (e) {
    showToast('Could not load assets. Check connection.', 'error');
  }

  // Asset name dropdown
  const { wrapper: assetWrapper, select: assetSelect } = renderAssetDropdown(assets, stream);
  container.appendChild(assetWrapper);

  // Subcategory display (auto-filled, locked)
  if (subcategory) {
    const subWrapper = document.createElement('div');
    subWrapper.className = 'field-group';
    const subLabel = document.createElement('label');
    subLabel.textContent = 'Sub Category';
    const subVal = document.createElement('div');
    subVal.className = 'field-locked';
    subVal.textContent = subcategory.name;
    subWrapper.appendChild(subLabel);
    subWrapper.appendChild(subVal);
    container.appendChild(subWrapper);
  }

  // Transaction fields (hidden until asset selected)
  const txnSection = document.createElement('div');
  txnSection.id = 'txn-fields';
  txnSection.style.display = 'none';
  stream.txnFields.forEach(f => {
    const el = renderField(f, f.type === 'date' ? todayStr() : '');
    txnSection.appendChild(el);
  });
  container.appendChild(txnSection);

  // Submit button
  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.className = 'btn-primary';
  btn.textContent = 'Save Transaction';
  btn.style.display = 'none';
  btn.id = 'txn-submit-btn';
  container.appendChild(btn);

  // Wire asset selection
  assetSelect.addEventListener('change', () => {
    const val = assetSelect.value;
    if (val === '__new__') {
      assetSelect.value = '';
      renderAssetForm(container, stream, category, subcategory);
      return;
    }
    txnSection.style.display = val ? 'block' : 'none';
    btn.style.display         = val ? 'block' : 'none';

    // Pre-fill monthly SIP amount when a SIP plan is selected
    if (val && stream.sipAmountCol) {
      try {
        const opt   = assetSelect.options[assetSelect.selectedIndex];
        const asset = JSON.parse(opt.dataset.asset || '{}');
        const amountEl = txnSection.querySelector('#field-amount');
        if (amountEl && asset[stream.sipAmountCol]) {
          amountEl.value = parseFloat(asset[stream.sipAmountCol]).toFixed(2);
        }
      } catch (_) {}
    }

    const opt   = assetSelect.options[assetSelect.selectedIndex];
    const asset = JSON.parse(opt?.dataset?.asset || '{}');
    const usesFormula = asset.price_fetch_way === 'formula';
    if (!usesFormula) renderManualPricePanel(container, stream, val);
    else { const old = container.querySelector('.manual-price-panel'); if (old) old.remove(); }
  });

  // Wire auto-compute fields
  txnSection.addEventListener('input', e => {
    autoCompute(stream.txnFields, txnSection);
  });
}

// Auto-compute amount and conv_rate fields
function autoCompute(fields, container) {
  const values = {};
  fields.forEach(f => {
    const el = container.querySelector(`#field-${f.id}`);
    if (el) values[f.id] = el.value;
  });
  const computed = computeFields(fields, values);
  fields.forEach(f => {
    if (f.computed) {
      const el = container.querySelector(`#field-${f.id}`);
      if (el && computed[f.id] && !isNaN(computed[f.id])) {
        el.value = parseFloat(computed[f.id]).toFixed(2);
      }
    }
  });
}

// Render the "Add New Asset" form inline
function renderAssetForm(container, stream, category, subcategory) {
  const overlay = document.createElement('div');
  overlay.className = 'asset-form-overlay';

  const box = document.createElement('div');
  box.className = 'asset-form-box';

  const title = document.createElement('h3');
  title.textContent = 'Add New Asset';
  box.appendChild(title);

  const form = document.createElement('form');
  form.id = 'asset-form';

  stream.assetFields.forEach(f => {
    if (f.type === 'subcategory') {
      // Show as locked display if subcategory is known
      if (subcategory) {
        const wrapper = document.createElement('div');
        wrapper.className = 'field-group';
        const lbl = document.createElement('label');
        lbl.textContent = 'Sub Category';
        const val = document.createElement('div');
        val.className = 'field-locked';
        val.textContent = subcategory.name;
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = 'subcategory_id';
        hidden.value = subcategory.id;
        wrapper.appendChild(lbl);
        wrapper.appendChild(val);
        wrapper.appendChild(hidden);
        form.appendChild(wrapper);
      }
    } else {
      form.appendChild(renderField(f));
    }
  });

  const actions = document.createElement('div');
  actions.className = 'form-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn-secondary';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => overlay.remove();

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn-primary';
  save.textContent = 'Save Asset';

  actions.appendChild(cancel);
  actions.appendChild(save);
  form.appendChild(actions);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = collectFormData(form, stream.assetFields);
    if (subcategory) data.subcategory_id = subcategory.id;

    try {
      save.disabled = true;
      save.textContent = 'Saving...';
      const result = await API.createAsset(stream, data);
      CACHE.clear(stream.assetTable);
      _insightsCache = null;
      _holdingsAllRows = null;
      LSC.clear('insights', 'holdings');
      overlay.remove();
      // Reload the transaction form with new asset pre-selected
      const formContainer = document.getElementById('form-fields');
      if (formContainer) {
        await renderTransactionForm(formContainer, stream, category, subcategory);
        // Pre-select the newly created asset
        const assetSel = formContainer.querySelector('#field-asset-name');
        if (assetSel) {
          // Re-fetch to get new asset in list
          const assets = await fetchAssetsCached(stream);
          const newAsset = assets.find(a => a.id === result.id);
          if (newAsset) {
            const opts = assetSel.querySelectorAll('option');
            opts.forEach(o => { if (o.value == result.id) { o.selected = true; assetSel.dispatchEvent(new Event('change')); } });
          }
        }
      } else {
        // Goal flow (no #form-fields) — re-render via the router
        await startLogForm();
      }
      showToast('Asset saved!');
    } catch (err) {
      showToast('Failed to save asset: ' + err.message, 'error');
      save.disabled = false;
      save.textContent = 'Save Asset';
    }
  });

  box.appendChild(form);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// Collect all field values from a form/container
function collectFormData(container, fields) {
  const data = {};
  fields.forEach(f => {
    const el = container.querySelector(`[name="${f.id}"], #field-${f.id}`);
    if (el) data[f.id] = el.value;
  });
  return data;
}

// Collect and validate transaction form data
function collectAndValidateTxn(stream) {
  const txnSection = document.getElementById('txn-fields');
  const assetSel = document.getElementById('field-asset-name');
  const errors = [];

  if (!assetSel || !assetSel.value) {
    errors.push('Please select an asset');
  }

  const values = {};
  stream.txnFields.forEach(f => {
    const el = txnSection.querySelector(`#field-${f.id}`);
    if (el) values[f.id] = el.value;
  });

  const fieldErrors = validateTxn(stream.txnFields, values);
  errors.push(...fieldErrors);

  return { errors, values, assetId: assetSel ? assetSel.value : '' };
}

// Render a read-only transaction row for History page
function renderTxnRow(txn, stream, editMode = false) {
  const row = document.createElement('div');
  row.className = 'txn-row' + (editMode ? ' edit-mode' : '');
  row.dataset.id = txn.id;
  row.dataset.dirty = 'false';

  if (editMode) {
    const nameLabel = document.createElement('div');
    nameLabel.className = 'txn-name-static';
    nameLabel.textContent = txn._assetName || '';
    row.appendChild(nameLabel);

    stream.txnFields.forEach(f => {
      if (f.readonly) return;
      const group = renderField(f, txn[f.id] || '');
      group.classList.add('inline');
      const input = group.querySelector('input, select');
      if (input) {
        input.addEventListener('input', () => {
          row.dataset.dirty = 'true';
          row.classList.add('dirty');
          autoComputeRow(stream.txnFields, row);
        });
      }
      row.appendChild(group);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger btn-sm';
    delBtn.textContent = 'Delete';
    delBtn.dataset.action = 'delete';
    delBtn.dataset.id = txn.id;
    row.appendChild(delBtn);
  } else {
    const badge = document.createElement('span');
    badge.className = `txn-badge ${txn.txn_type === 'Buy' ? 'badge-buy' : 'badge-sell'}`;
    badge.textContent = txn.txn_type === 'Buy' ? '↑' : '↓';
    badge.title = txn.txn_type;

    const info = document.createElement('div');
    info.className = 'txn-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'txn-name';
    nameEl.textContent = txn._assetName || '';

    const subEl = document.createElement('div');
    subEl.className = 'txn-sub';
    subEl.textContent = [formatDate(txn.txn_date), buildTxnMeta(txn, stream)].filter(Boolean).join('  ·  ');

    info.appendChild(nameEl);
    info.appendChild(subEl);

    const amtEl = document.createElement('div');
    amtEl.className = 'txn-amount';
    const amt = parseFloat(txn.amount_inr || txn.amount || 0);
    amtEl.textContent = amt ? '₹' + formatINR(amt) : '';

    row.appendChild(badge);
    row.appendChild(info);
    row.appendChild(amtEl);
  }

  return row;
}

function autoComputeRow(fields, row) {
  const values = {};
  fields.forEach(f => {
    const el = row.querySelector(`#field-${f.id}`);
    if (el) values[f.id] = el.value;
  });
  const computed = computeFields(fields, values);
  fields.forEach(f => {
    if (f.computed) {
      const el = row.querySelector(`#field-${f.id}`);
      if (el && computed[f.id] && !isNaN(computed[f.id])) {
        el.value = parseFloat(computed[f.id]).toFixed(2);
      }
    }
  });
}

function buildTxnMeta(txn, stream) {
  const parts = [];
  if (txn.units) parts.push(`Units: ${txn.units}`);
  if (txn.quantity) parts.push(`Qty: ${txn.quantity}`);
  if (txn.nav) parts.push(`NAV: ₹${txn.nav}`);
  if (txn.price_per_share) parts.push(`₹${txn.price_per_share}/share`);
  if (txn.price_per_unit) parts.push(`₹${txn.price_per_unit}/unit`);
  if (txn.price_usd) parts.push(`$${txn.price_usd}`);
  return parts.join('  ·  ');
}

// Collect edited row data for batch save
function collectEditedRows(container, stream) {
  const rows = container.querySelectorAll('.txn-row[data-dirty="true"]');
  return Array.from(rows).map(row => {
    const id = row.dataset.id;
    const data = {};
    stream.txnFields.forEach(f => {
      const el = row.querySelector(`#field-${f.id}`);
      if (el && !f.readonly) data[f.id] = el.value;
    });
    return { id, data };
  });
}

// Show/update the manual price panel for streams with manualPrice: true
async function renderManualPricePanel(container, stream, assetId) {
  const old = container.querySelector('.manual-price-panel');
  if (old) old.remove();
  if (!stream.manualPrice || !assetId) return;

  const panel = document.createElement('div');
  panel.className = 'manual-price-panel';
  panel.innerHTML = `<div class="manual-price-header"><span class="manual-price-title">Current Price</span><span class="manual-price-current">Loading…</span></div>`;

  const assetWrapper = container.querySelector('#field-asset-name')?.closest('.field-group');
  if (assetWrapper) assetWrapper.after(panel);
  else container.prepend(panel);

  let latestPrice = '', latestDate = '';
  try {
    const data = await API.get('manual_prices', {
      limit: 100,
      filters: { asset_type: stream.manualPriceType, asset_id: assetId },
    });
    if (data.rows?.length) {
      const sorted = [...data.rows].sort((a, b) => new Date(b.price_date) - new Date(a.price_date));
      latestPrice = sorted[0].price_per_unit;
      latestDate  = sorted[0].price_date?.substring(0, 10) || '';
    }
  } catch (_) {}

  const lastText = latestPrice
    ? `Last: ₹${formatINR(latestPrice)} on ${formatDate(latestDate)}`
    : 'No price recorded yet';

  panel.innerHTML = `
    <div class="manual-price-header">
      <span class="manual-price-title">Current Price</span>
      <span class="manual-price-current">${lastText}</span>
    </div>
    <div class="manual-price-fields">
      <div class="field-group">
        <label for="manual-price-val">${stream.manualPriceLabel} (₹) *</label>
        <input type="number" id="manual-price-val" step="0.01" placeholder="Enter current price" />
        <span class="field-error"></span>
      </div>
      <div class="field-group">
        <label for="manual-price-date">As of Date *</label>
        <input type="date" id="manual-price-date" value="${todayStr()}" />
        <span class="field-error"></span>
      </div>
    </div>
    <button type="button" class="btn-secondary btn-sm manual-price-save">Update Price</button>
    <span class="manual-price-status"></span>
  `;

  panel.querySelector('.manual-price-save').addEventListener('click', async () => {
    const priceInput = panel.querySelector('#manual-price-val');
    const dateInput  = panel.querySelector('#manual-price-date');
    const status     = panel.querySelector('.manual-price-status');
    const saveBtn    = panel.querySelector('.manual-price-save');

    const price = parseFloat(priceInput.value);
    const date  = dateInput.value;

    if (!price || price <= 0) { showToast('Enter a valid price', 'error'); return; }
    if (!date)                 { showToast('Enter a date', 'error'); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      await API.updateManualPrice(stream.manualPriceType, assetId, price, date);
      _insightsCache   = null;
      _holdingsAllRows = null;
      LSC.clear('insights', 'holdings');
      status.textContent = `✓ Saved ₹${formatINR(price)}`;
      status.className = 'manual-price-status saved';
      showToast('Price updated!');
    } catch (err) {
      showToast('Failed: ' + err.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Update Price';
    }
  });
}

// ── Balance update form for staticBalance streams (EPF, Bank Accounts) ───────

async function renderBalanceUpdateForm(container, stream) {
  let assets = [];
  try { assets = (await API.getAssets(stream)).rows || []; } catch (_) {}
  const active = assets.filter(a => String(a.is_active).toUpperCase() === 'TRUE');

  const wrap = document.createElement('div');
  wrap.className = 'form-fields';

  // Asset selector
  const { wrapper: assetWrapper, select: assetSelect } = renderAssetDropdown(active, stream);
  wrap.appendChild(assetWrapper);

  // Balance panel (shown after asset selected)
  const panel = document.createElement('div');
  panel.className = 'manual-price-panel';
  panel.style.display = 'none';
  wrap.appendChild(panel);

  container.appendChild(wrap);

  // Add new asset button
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-secondary btn-sm';
  addBtn.style.marginTop = '12px';
  addBtn.textContent = '+ Add New Account';
  addBtn.addEventListener('click', () => renderNewAssetForm(container, stream, active));
  wrap.appendChild(addBtn);

  assetSelect.addEventListener('change', async () => {
    const assetId = assetSelect.value;
    panel.style.display = assetId ? 'block' : 'none';
    if (!assetId) return;

    const asset = active.find(a => String(a.id) === assetId) || {};
    const currentBal = parseFloat(asset[stream.currentBalanceCol] || 0);

    panel.innerHTML = `
      <div class="manual-price-header">
        <span class="manual-price-title">Balance</span>
        <span class="manual-price-current">${currentBal > 0 ? 'Current: ₹' + formatINR(currentBal) : 'Not set'}</span>
      </div>
      <div class="manual-price-fields">
        <div class="field-group">
          <label for="new-balance">New Balance (₹) *</label>
          <input type="number" id="new-balance" step="0.01" placeholder="Enter current balance" />
          <span class="field-error"></span>
        </div>
      </div>
      <button type="button" class="btn-primary btn-sm balance-save">Update Balance</button>
      <span class="manual-price-status"></span>
    `;

    panel.querySelector('.balance-save').addEventListener('click', async () => {
      const input   = panel.querySelector('#new-balance');
      const status  = panel.querySelector('.manual-price-status');
      const saveBtn = panel.querySelector('.balance-save');
      const val = parseFloat(input.value);
      if (!val || val < 0) { showToast('Enter a valid balance', 'error'); return; }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        await API.update(stream.assetTable, assetId, { [stream.currentBalanceCol]: val });
        _insightsCache   = null;
        _holdingsAllRows = null;
        LSC.clear('insights', 'holdings');
        status.textContent = `✓ Updated to ₹${formatINR(val)}`;
        status.className = 'manual-price-status saved';
        showToast('Balance updated!');
      } catch (err) {
        showToast('Failed: ' + err.message, 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Update Balance';
      }
    });
  });
}

// ── Goal-tracked transaction form (debt Commitment / Yearly Bills) ────────────

// Fetch active goals for a subcategory
async function fetchActiveGoals(stream, subcategoryId) {
  if (!stream.goalTable) return [];
  try {
    const res = await API.get(stream.goalTable, { limit: 200, filters: { subcategory_id: subcategoryId } });
    return (res.rows || []).filter(g => String(g.is_active).toUpperCase() === 'TRUE');
  } catch (_) { return []; }
}

async function renderGoalTransactionForm(container, stream, category, subcategory, goals) {
  container.innerHTML = '';

  // Manage goals bar
  const manageBar = document.createElement('div');
  manageBar.className = 'goal-manage-bar';
  const manageBtn = document.createElement('button');
  manageBtn.type = 'button';
  manageBtn.className = 'btn-secondary btn-sm';
  manageBtn.textContent = '⚙ Manage Goals';
  manageBtn.addEventListener('click', () => renderManageGoalsOverlay(stream, subcategory, () => startLogForm()));
  manageBar.appendChild(manageBtn);
  container.appendChild(manageBar);

  // No goals yet — prompt to add via Manage Goals
  if (!goals.length) {
    const empty = document.createElement('div');
    empty.className = 'goal-empty-state';
    empty.textContent = `No goals yet for ${subcategory.name}. Tap "⚙ Manage Goals" above to add your first one.`;
    container.appendChild(empty);
    return;
  }

  // Funds for this subcategory
  let assets = [];
  try {
    const all = await fetchAssetsCached(stream);
    assets = all.filter(a => String(a.subcategory_id) === String(subcategory.id));
  } catch (_) { showToast('Could not load funds.', 'error'); }

  // Fund dropdown
  const { wrapper: assetWrapper, select: assetSelect } = renderAssetDropdown(assets, stream);
  container.appendChild(assetWrapper);

  // Body (shown once a fund is selected)
  const body = document.createElement('div');
  body.id = 'goal-form-body';
  body.style.display = 'none';
  container.appendChild(body);

  assetSelect.addEventListener('change', () => {
    const val = assetSelect.value;
    if (val === '__new__') {
      assetSelect.value = '';
      renderAssetForm(container, stream, category, subcategory);
      return;
    }
    body.style.display = val ? 'block' : 'none';
    if (val) buildGoalBody(body, stream, goals, val);
  });
}

function buildGoalBody(body, stream, goals, fundId) {
  body.innerHTML = '';

  // Shared fields: type, date, NAV
  body.appendChild(renderField({ id: 'goal-type', label: 'Type', type: 'select', options: ['Buy', 'Sell'], required: true }, 'Buy'));
  body.appendChild(renderField({ id: 'goal-date', label: 'Date', type: 'date', required: true }, todayStr()));
  body.appendChild(renderField({ id: 'goal-nav', label: 'NAV (₹)', type: 'number', step: '0.0001', required: true }));

  const section = document.createElement('div');
  section.id = 'goal-section';
  body.appendChild(section);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-primary';
  btn.textContent = 'Save Transaction';
  body.appendChild(btn);

  const typeSel = body.querySelector('#field-goal-type');

  function renderSection() {
    section.innerHTML = '';
    if (typeSel.value === 'Buy') {
      const grid = document.createElement('div');
      grid.className = 'goal-buy-grid';
      goals.forEach(g => {
        const row = document.createElement('div');
        row.className = 'goal-buy-row';
        const name = document.createElement('span');
        name.className = 'goal-buy-name';
        name.textContent = g.name;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = '0.01';
        inp.className = 'goal-amount-input';
        inp.placeholder = '0';
        inp.dataset.goalId = g.id;
        if (g.default_amount !== '' && g.default_amount !== undefined && g.default_amount !== null) {
          inp.value = parseFloat(g.default_amount);
        }
        row.appendChild(name);
        row.appendChild(inp);
        grid.appendChild(row);
      });
      section.appendChild(grid);
    } else {
      // Sell — single goal + amount + reason
      const gWrap = document.createElement('div');
      gWrap.className = 'field-group';
      const lbl = document.createElement('label');
      lbl.textContent = 'Goal *';
      const gSel = document.createElement('select');
      gSel.id = 'goal-sell-select';
      gSel.innerHTML = '<option value="">Select goal</option>' +
        goals.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
      gWrap.appendChild(lbl);
      gWrap.appendChild(gSel);
      section.appendChild(gWrap);
      section.appendChild(renderField({ id: 'goal-sell-amount', label: 'Amount (₹)', type: 'number', step: '0.01', required: true }));
      section.appendChild(renderField({ id: 'goal-sell-notes', label: 'Reason', type: 'text', placeholder: 'e.g. Amma recharge done' }));
    }
  }

  typeSel.addEventListener('change', renderSection);
  renderSection();

  btn.addEventListener('click', () => submitGoalTxn(stream, fundId, body, btn, renderSection));
}

async function submitGoalTxn(stream, fundId, body, btn, renderSection) {
  const txnType = body.querySelector('#field-goal-type').value;
  const txnDate = body.querySelector('#field-goal-date').value;
  const nav     = parseFloat(body.querySelector('#field-goal-nav').value);

  if (!txnDate)        { showToast('Select a date', 'error'); return; }
  if (!nav || nav <= 0) { showToast('Enter a valid NAV', 'error'); return; }

  const rows = [];

  if (txnType === 'Buy') {
    body.querySelectorAll('.goal-amount-input').forEach(inp => {
      const amount = parseFloat(inp.value);
      if (amount && amount > 0) {
        rows.push({
          [stream.assetIdCol]: fundId,
          txn_type: 'Buy',
          txn_date: txnDate,
          nav,
          amount: Math.round(amount * 100) / 100,
          units: Math.round((amount / nav) * 1e6) / 1e6,
          [stream.goalIdCol]: inp.dataset.goalId,
          notes: '',
        });
      }
    });
    if (!rows.length) { showToast('Enter at least one amount', 'error'); return; }
  } else {
    const goalId = body.querySelector('#goal-sell-select').value;
    const amount = parseFloat(body.querySelector('#field-goal-sell-amount').value);
    const notes  = body.querySelector('#field-goal-sell-notes').value;
    if (!goalId)          { showToast('Select a goal', 'error'); return; }
    if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }
    rows.push({
      [stream.assetIdCol]: fundId,
      txn_type: 'Sell',
      txn_date: txnDate,
      nav,
      amount: Math.round(amount * 100) / 100,
      units: Math.round((amount / nav) * 1e6) / 1e6,
      [stream.goalIdCol]: goalId,
      notes,
    });
  }

  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    for (const row of rows) {
      await API.insert(stream.txnTable, row);
    }
    _insightsCache   = null;
    _holdingsAllRows = null;
    LSC.clear('insights', 'holdings');
    showToast(`${rows.length} transaction${rows.length > 1 ? 's' : ''} saved!`);
    renderSection();  // reset inputs
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Transaction';
  }
}

// ── Manage Goals overlay (add / remove goals for a subcategory) ───────────────

async function renderManageGoalsOverlay(stream, subcategory, onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'asset-form-overlay';

  const box = document.createElement('div');
  box.className = 'asset-form-box';

  const title = document.createElement('h3');
  title.textContent = `Manage Goals — ${subcategory.name}`;
  box.appendChild(title);

  const hint = document.createElement('p');
  hint.className = 'goal-manage-hint';
  hint.textContent = 'Set a Default Amount for recurring bills (prefilled each month), or a Target Amount for goals you save toward.';
  box.appendChild(hint);

  // Existing goals list
  const listWrap = document.createElement('div');
  listWrap.className = 'goal-manage-list';
  box.appendChild(listWrap);

  // Add-goal form
  const addTitle = document.createElement('div');
  addTitle.className = 'goal-manage-add-title';
  addTitle.textContent = 'Add Goal';
  box.appendChild(addTitle);

  const nameField = renderField({ id: 'goalmgr-name', label: 'Goal Name', type: 'text', required: true, placeholder: 'e.g. Bike, Insurance' });
  const defField  = renderField({ id: 'goalmgr-default', label: 'Default Amount (₹/month)', type: 'number', step: '0.01' });
  const tgtField  = renderField({ id: 'goalmgr-target', label: 'Target Amount (₹)', type: 'number', step: '0.01' });
  box.appendChild(nameField);
  box.appendChild(defField);
  box.appendChild(tgtField);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-primary btn-sm';
  addBtn.textContent = '+ Add Goal';
  box.appendChild(addBtn);

  // Footer
  const actions = document.createElement('div');
  actions.className = 'form-actions';
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'btn-secondary';
  doneBtn.textContent = 'Done';
  actions.appendChild(doneBtn);
  box.appendChild(actions);

  async function loadGoals() {
    const goals = await fetchActiveGoals(stream, subcategory.id);
    listWrap.innerHTML = '';
    if (!goals.length) {
      listWrap.innerHTML = '<div class="goal-manage-empty">No goals yet — add one below.</div>';
      return;
    }
    goals.forEach(g => {
      const row = document.createElement('div');
      row.className = 'goal-manage-row';
      const meta = (g.default_amount !== '' && g.default_amount != null && g.default_amount !== '')
        ? `₹${parseFloat(g.default_amount).toLocaleString('en-IN')}/mo`
        : ((g.target_amount !== '' && g.target_amount != null && g.target_amount !== '')
            ? `target ₹${parseFloat(g.target_amount).toLocaleString('en-IN')}` : '');
      const name = document.createElement('span');
      name.className = 'goal-manage-name';
      name.textContent = g.name;
      const metaEl = document.createElement('span');
      metaEl.className = 'goal-manage-meta';
      metaEl.textContent = meta;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'btn-secondary btn-sm';
      rm.textContent = 'Remove';
      rm.addEventListener('click', async () => {
        rm.disabled = true;
        try {
          await API.update(stream.goalTable, g.id, { is_active: false });
          _insightsCache = null;
          LSC.clear('insights', 'holdings');
          await loadGoals();
        } catch (e) {
          showToast('Failed: ' + e.message, 'error');
          rm.disabled = false;
        }
      });
      row.appendChild(name);
      row.appendChild(metaEl);
      row.appendChild(rm);
      listWrap.appendChild(row);
    });
  }

  addBtn.addEventListener('click', async () => {
    const name = box.querySelector('#field-goalmgr-name').value.trim();
    const def  = box.querySelector('#field-goalmgr-default').value;
    const tgt  = box.querySelector('#field-goalmgr-target').value;
    if (!name) { showToast('Enter a goal name', 'error'); return; }

    addBtn.disabled = true;
    addBtn.textContent = 'Adding…';
    try {
      await API.insert(stream.goalTable, {
        subcategory_id: subcategory.id,
        name,
        default_amount: def === '' ? '' : parseFloat(def),
        target_amount:  tgt === '' ? '' : parseFloat(tgt),
        is_active: true,
      });
      _insightsCache = null;
      LSC.clear('insights', 'holdings');
      box.querySelector('#field-goalmgr-name').value = '';
      box.querySelector('#field-goalmgr-default').value = '';
      box.querySelector('#field-goalmgr-target').value = '';
      await loadGoals();
      showToast('Goal added');
    } catch (e) {
      showToast('Failed: ' + e.message, 'error');
    } finally {
      addBtn.disabled = false;
      addBtn.textContent = '+ Add Goal';
    }
  });

  doneBtn.addEventListener('click', () => { overlay.remove(); if (onDone) onDone(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); if (onDone) onDone(); } });

  await loadGoals();
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// ── Add new account overlay for staticBalance streams ─────────────────────────

function renderNewAssetForm(container, stream) {
  const overlay = document.createElement('div');
  overlay.className = 'asset-form-overlay';

  const box = document.createElement('div');
  box.className = 'asset-form-box';

  const title = document.createElement('h3');
  title.textContent = 'Add New Account';
  box.appendChild(title);

  const form = document.createElement('form');
  stream.assetFields.forEach(f => form.appendChild(renderField(f)));

  const actions = document.createElement('div');
  actions.className = 'form-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn-secondary';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => overlay.remove();

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn-primary';
  save.textContent = 'Save Account';

  actions.appendChild(cancel);
  actions.appendChild(save);
  form.appendChild(actions);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = collectFormData(form, stream.assetFields);
    data.is_active = true;
    try {
      save.disabled = true;
      save.textContent = 'Saving...';
      await API.createAsset(stream, data);
      CACHE.clear(stream.assetTable);
      _insightsCache   = null;
      _holdingsAllRows = null;
      LSC.clear('insights', 'holdings');
      overlay.remove();
      // Reload the balance update form so new account appears in dropdown
      container.innerHTML = '';
      await renderBalanceUpdateForm(container, stream);
      showToast('Account saved!');
    } catch (err) {
      showToast('Failed: ' + err.message, 'error');
      save.disabled = false;
      save.textContent = 'Save Account';
    }
  });

  box.appendChild(form);
  overlay.appendChild(box);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// Utility helpers
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatINR(n) {
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}
