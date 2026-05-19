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

    renderManualPricePanel(container, stream, val);
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
