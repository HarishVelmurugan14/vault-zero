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

  assets
    .filter(a => (typeof ACCOUNTS === 'undefined' || ACCOUNTS.matches(a.account_id)))
    .filter(a => !(typeof HIDDEN !== 'undefined' && HIDDEN.isAsset(stream.assetTable, a.id)))
    .forEach(a => {
      const o = document.createElement('option');
      o.value = a.id;
      const owner = (typeof ACCOUNTS !== 'undefined' && ACCOUNTS.list.length > 1) ? ACCOUNTS.name(a.account_id) : '';
      o.textContent = a[stream.assetNameCol] + (owner ? ' · ' + owner : '');      // same fund in two family accounts
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

  const owner = accountPicker(form);                    // All view with family accounts → pick whose
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
    if (!owner.value()) { showToast('Pick whose account this is', 'error'); return; }
    data.account_id = owner.value();

    try {
      save.disabled = true;
      save.textContent = 'Saving...';
      const result = await API.createAsset(stream, data);
      CACHE.clear(stream.assetTable);
      _insightsCache = null; if (typeof invalidateSnapshots === 'function') invalidateSnapshots();
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
        // Custom log view without #form-fields (e.g. staticBalance) — re-render via router
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
      if (stream.usEquity && f.id !== 'notes') return;   // US: cost basis + wire come from the log form — delete & re-log to change
      // A date comes back as an ISO timestamp; <input type="date"> needs yyyy-mm-dd (local day) or it blanks.
      const raw = txn[f.id] ?? '';                       // keep a stored 0 (bonus shares) — not blank
      const group = renderField(f, f.type === 'date' && raw ? localYMD(raw) : raw);
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
    const out = /^(sell|withdrawal)$/i.test(String(txn.txn_type));   // money out ↓; buys, contributions, interest ↑
    badge.className = `txn-badge ${out ? 'badge-sell' : 'badge-buy'}`;
    badge.textContent = out ? '↓' : '↑';
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
      limit: 1000000,
      filters: { asset_type: stream.manualPriceType, asset_id: assetId },
    });
    const today = localYMD(new Date());
    const rows = (data.rows || []).filter(r => localYMD(r.price_date) <= today);   // a future-dated row is ignored everywhere
    if (rows.length) {
      const sorted = [...rows].sort((a, b) => (new Date(b.price_date) - new Date(a.price_date)) || ((Number(b.id) || 0) - (Number(a.id) || 0)));
      latestPrice = sorted[0].price_per_unit;
      latestDate  = localYMD(sorted[0].price_date);
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
    if (date > localYMD(new Date())) { showToast('The price date is in the future', 'error'); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      const res = await API.updateManualPrice(stream.manualPriceType, assetId, price, date, requestIdFor(panel, { assetId, price, date }));
      requestDone(panel);
      _insightsCache   = null; if (typeof invalidateSnapshots === 'function') invalidateSnapshots();
      _holdingsAllRows = null;
      LSC.clear('insights', 'holdings');
      // Land: the server spreads the new price over the snapshot months since the previous one.
      const spread = (res && res.spread) || {};
      const months = spread.months || [];
      status.textContent = `✓ Saved ₹${formatINR(price)}` +
        (months.length ? ` · spread over ${months.length} snapshot month${months.length === 1 ? '' : 's'} (${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])})` : '');
      status.className = 'manual-price-status saved';
      if (spread.error) showToast(`Price saved; spreading it over the snapshot months failed (${spread.error}) — it retries at the next Take snapshot`, 'error');
      else if ((spread.skipped || []).length) showToast('Price saved; some snapshot months were busy — they update at the next Take snapshot', 'error');
      else showToast('Price updated!');
    } catch (err) {
      showToast('Failed: ' + err.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Update Price';
    }
  });
}

// ── EPF entry form: Account (default Self) · Type (default Contribution) · Date · Amount · Notes ──
// Entries belong to the account; its one EPF row is created on the first entry if missing.
async function renderEpfEntryForm(container, stream) {
  const accounts = (ACCOUNTS.list || []).filter(a => String(a.is_active).toUpperCase() !== 'FALSE');
  const self = accounts.find(a => String(a.name).trim().toLowerCase() === 'self') || accounts[0] || {};
  const initial = ACCOUNTS.isAll() ? String(self.id || '') : String(ACCOUNTS.current);

  const wrap = document.createElement('div');
  wrap.className = 'form-fields';
  const acctGroup = renderField({ id: 'account_id', label: 'Account', type: 'select', options: [], required: true });
  const acctSel = acctGroup.querySelector('select');
  acctSel.innerHTML = '';
  accounts.forEach(a => {
    const o = document.createElement('option');
    o.value = String(a.id); o.textContent = a.name;
    if (String(a.id) === initial) o.selected = true;
    acctSel.appendChild(o);
  });
  wrap.appendChild(acctGroup);
  stream.txnFields.forEach(f => wrap.appendChild(renderField(f, f.id === 'txn_type' ? 'Contribution' : f.type === 'date' ? todayStr() : '')));
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-primary';
  btn.textContent = 'Save Entry';
  wrap.appendChild(btn);
  container.appendChild(wrap);

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    const values = {};
    stream.txnFields.forEach(f => { const el = wrap.querySelector(`#field-${f.id}`); if (el) values[f.id] = el.value; });
    const errors = validateTxn(stream.txnFields, values);
    if (!acctSel.value) errors.unshift('Pick an account');
    if (errors.length) { showToast(errors[0], 'error'); return; }
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const accountId = acctSel.value;
      // Fresh, unfiltered lookup (not the cached active-only list): the account's one EPF row.
      const epf = ((await API.get(stream.assetTable, { limit: 5, filters: { account_id: accountId } })).rows || [])[0];
      if (epf && String(epf.is_active).toUpperCase() === 'FALSE') {
        showToast(`${epf[stream.assetNameCol] || 'This EPF'} is marked inactive — set is_active TRUE in the epf_assets tab first`, 'error');
        return;
      }
      if (!epf) {                                                        // first EPF for this account
        await API.insert(stream.assetTable, { account_id: accountId, account_name: 'EPF · ' + (ACCOUNTS.name(accountId) || accountId), is_active: true });
        CACHE.clear(stream.assetTable);
      } else {
        const typed = parseFloat(epf[stream.currentBalanceCol] || 0) || 0;
        const have = typed > 0 ? await API.get(stream.txnTable, { limit: 1, filters: { account_id: accountId } }) : { total: 1 };
        if (!(have.total > 0) && !confirm(`This is the first passbook entry for ${epf[stream.assetNameCol] || 'this EPF'}. ` +
            `From now on its balance is calculated from entries — the typed ₹${formatINR(typed)} will no longer count. ` +
            `Add your full passbook history so the balance stays right. Continue?`)) return;
      }
      const entry = Object.assign({}, values, { account_id: accountId });
      await API.createTransaction(stream, entry, requestIdFor(wrap, entry));
      requestDone(wrap);
      showToast('EPF entry saved!');
      ['amount', 'notes'].forEach(id => { const el = wrap.querySelector('#field-' + id); if (el) el.value = ''; });
    } catch (err) {
      showToast('Failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Entry';
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
      if (input.value.trim() === '' || isNaN(val) || val < 0) { showToast('Enter a valid balance (0 or more)', 'error'); return; }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        await API.update(stream.assetTable, assetId, { [stream.currentBalanceCol]: val });
        _insightsCache   = null; if (typeof invalidateSnapshots === 'function') invalidateSnapshots();
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
  const owner = accountPicker(form);                    // All view with family accounts → pick whose

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
    if (!owner.value()) { showToast('Pick whose account this is', 'error'); return; }
    data.account_id = owner.value();
    try {
      save.disabled = true;
      save.textContent = 'Saving...';
      await API.createAsset(stream, data);
      CACHE.clear(stream.assetTable);
      _insightsCache   = null; if (typeof invalidateSnapshots === 'function') invalidateSnapshots();
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

// ── US Equity (IBKR) log form ─────────────────────────────────────────────────

async function fetchWires(stream) {
  try { const r = await API.get(stream.wireTable, { limit: 1000000 }); return r.rows || []; }
  catch (_) { return []; }
}

// Latest wire whose wire_date ≤ the given date — drives BUY cost basis.
function latestWireOnOrBefore(wires, dateStr) {
  const d = new Date(dateStr);
  return wires
    .filter(w => new Date(w.wire_date) <= d)
    .sort((a, b) => new Date(b.wire_date) - new Date(a.wire_date))[0] || null;
}

async function renderUsEquityForm(container, stream, category, subcategory) {
  container.innerHTML = '';

  // Toolbar — Wires & Repatriations (currency movements feed cost basis)
  const bar = document.createElement('div');
  bar.className = 'us-toolbar';
  const wiresBtn = document.createElement('button');
  wiresBtn.type = 'button'; wiresBtn.className = 'btn-secondary btn-sm';
  wiresBtn.textContent = '💵 Wires';
  wiresBtn.addEventListener('click', () => renderWiresOverlay(stream));
  const repatBtn = document.createElement('button');
  repatBtn.type = 'button'; repatBtn.className = 'btn-secondary btn-sm';
  repatBtn.textContent = '↩ Repatriations';
  repatBtn.addEventListener('click', () => renderRepatOverlay(stream));
  const incomeBtn = document.createElement('button');
  incomeBtn.type = 'button'; incomeBtn.className = 'btn-secondary btn-sm';
  incomeBtn.textContent = '💲 Income';
  incomeBtn.addEventListener('click', () => renderIncomeOverlay(stream));
  bar.appendChild(wiresBtn);
  bar.appendChild(repatBtn);
  bar.appendChild(incomeBtn);
  container.appendChild(bar);

  // Assets for this subcategory
  let assets = [];
  try {
    const all = await fetchAssetsCached(stream);
    assets = subcategory ? all.filter(a => String(a.subcategory_id) === String(subcategory.id)) : all;
  } catch (_) { showToast('Could not load assets.', 'error'); }

  const { wrapper: assetWrapper, select: assetSelect } = renderAssetDropdown(assets, stream);
  container.appendChild(assetWrapper);

  const body = document.createElement('div');
  body.id = 'us-form-body';
  body.style.display = 'none';
  container.appendChild(body);

  assetSelect.addEventListener('change', () => {
    const val = assetSelect.value;
    if (val === '__new__') { assetSelect.value = ''; renderAssetForm(container, stream, category, subcategory); return; }
    body.style.display = val ? 'block' : 'none';
    if (val) buildUsTxnBody(body, stream, val);
  });
}

function buildUsTxnBody(body, stream, assetId) {
  body.innerHTML = '';
  body.appendChild(renderField({ id: 'us-type', label: 'Type', type: 'select', options: ['BUY', 'SELL'], required: true }, 'BUY'));
  body.appendChild(renderField({ id: 'us-date', label: 'Date', type: 'date', required: true }, todayStr()));
  body.appendChild(renderField({ id: 'us-units', label: 'Units', type: 'number', step: '0.000001', required: true }));
  body.appendChild(renderField({ id: 'us-price', label: 'Price / Share ($)', type: 'number', step: '0.0001', required: true }));
  body.appendChild(renderField({ id: 'us-usd', label: 'USD Amount ($)', type: 'number', step: '0.01', readonly: true }));
  body.appendChild(renderField({ id: 'us-notes', label: 'Notes', type: 'text' }));

  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'btn-primary'; btn.textContent = 'Save Transaction';
  body.appendChild(btn);

  const unitsEl = body.querySelector('#field-us-units');
  const priceEl = body.querySelector('#field-us-price');
  const usdEl   = body.querySelector('#field-us-usd');
  function recompute() {
    const u = parseFloat(unitsEl.value) || 0, p = parseFloat(priceEl.value) || 0;
    usdEl.value = (u && p) ? Math.round(u * p * 100) / 100 : '';
  }
  unitsEl.addEventListener('input', recompute);
  priceEl.addEventListener('input', recompute);

  btn.addEventListener('click', () => submitUsTxn(stream, assetId, body, btn));
}

async function submitUsTxn(stream, assetId, body, btn) {
  const txnType = body.querySelector('#field-us-type').value;
  const txnDate = body.querySelector('#field-us-date').value;
  const units   = parseFloat(body.querySelector('#field-us-units').value);
  const price   = parseFloat(body.querySelector('#field-us-price').value);
  const notes   = body.querySelector('#field-us-notes').value;

  if (!txnDate)            { showToast('Select a date', 'error'); return; }
  if (txnDate > localYMD(new Date(Date.now() + 86400000))) { showToast('The date is in the future', 'error'); return; }
  if (!units || units <= 0) { showToast('Enter valid units', 'error'); return; }
  if (!price || price <= 0) { showToast('Enter a valid price', 'error'); return; }
  const usdAmount = Math.round(units * price * 100) / 100;

  const row = {
    [stream.assetIdCol]: assetId,
    txn_type: txnType,
    txn_date: txnDate,
    units,
    price_per_share_usd: price,
    usd_amount: usdAmount,
    notes,
  };

  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    if (txnType === 'BUY') {
      const asset = (await fetchAssetsCached(stream)).find(a => String(a.id) === String(assetId)) || {};
      const wire = latestWireOnOrBefore((await fetchWires(stream)).filter(w => String(w.account_id) === String(asset.account_id)), txnDate);
      if (!wire) {
        showToast(`No wire on/before this date for ${ACCOUNTS.name(asset.account_id) || 'this account'} — add one via 💵 Wires first.`, 'error');
        btn.disabled = false; btn.textContent = 'Save Transaction'; return;
      }
      row.wire_id = wire.id;
      row.inr_cost_basis = Math.round(usdAmount * parseFloat(wire.effective_rate || 0) * 100) / 100;
    } else {
      // SELL — realized USD P&L vs weighted-avg USD cost of prior buys
      const res = await API.get(stream.txnTable, { limit: 5000, filters: { [stream.assetIdCol]: assetId } });
      const buys = (res.rows || []).filter(t => String(t.txn_type).toUpperCase() === 'BUY');
      const bu = buys.reduce((s, t) => s + parseFloat(t.units || 0), 0);
      const ba = buys.reduce((s, t) => s + parseFloat(t.usd_amount || 0), 0);
      const avgUsd = bu > 0 ? ba / bu : 0;
      row.realized_pnl_usd = Math.round((price - avgUsd) * units * 100) / 100;
    }
    await API.insert(stream.txnTable, row, requestIdFor(body, row));
    requestDone(body);
    _insightsCache = null; if (typeof invalidateSnapshots === 'function') invalidateSnapshots(); _holdingsAllRows = null; LSC.clear('insights', 'holdings');
    showToast('Transaction saved!');
    ['#field-us-units', '#field-us-price', '#field-us-usd', '#field-us-notes'].forEach(s => { body.querySelector(s).value = ''; });
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Transaction';
  }
}

// ── Wires overlay (INR → USD) ─────────────────────────────────────────────────

// ' · Thulasi' after a row in the All view with several accounts (else nothing).
function ownerTag(accountId) {
  const n = ACCOUNTS.isAll() && ACCOUNTS.list.length > 1 ? ACCOUNTS.name(accountId) : '';
  return n ? ` <small>· ${String(n).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</small>` : '';
}

// Whose wire / repatriation / income this is. Viewing one account → that account; in the All view
// with several accounts → you must pick (it would otherwise be filed under the first account).
function accountPicker(box) {
  const many = ACCOUNTS.isAll() && ACCOUNTS.list.length > 1;
  if (!many) return { value: () => ACCOUNTS.writeAccountId() };
  const g = renderField({ id: 'owner_account', label: 'Account', type: 'select', options: [], required: true });
  const sel = g.querySelector('select');
  ACCOUNTS.list.forEach(a => { const o = document.createElement('option'); o.value = String(a.id); o.textContent = a.name; sel.appendChild(o); });
  box.appendChild(g);
  return { value: () => sel.value };
}

async function renderWiresOverlay(stream) {
  const overlay = document.createElement('div'); overlay.className = 'asset-form-overlay';
  const box = document.createElement('div'); box.className = 'asset-form-box';
  const title = document.createElement('h3'); title.textContent = 'US Wires (INR → USD)'; box.appendChild(title);

  const hint = document.createElement('p');
  hint.className = 'goal-manage-hint';
  hint.textContent = 'inr_debited = principal + commission + GST + correspondent. effective_rate = inr_debited ÷ usd_received.';
  box.appendChild(hint);

  const listWrap = document.createElement('div'); listWrap.className = 'us-ledger-list'; box.appendChild(listWrap);

  const addTitle = document.createElement('div'); addTitle.className = 'goal-manage-add-title'; addTitle.textContent = 'Add Wire'; box.appendChild(addTitle);
  const owner = accountPicker(box);
  stream.wireFields.forEach(f => box.appendChild(renderField(f, f.id === 'wire_date' ? todayStr() : '')));

  const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'btn-primary btn-sm'; addBtn.textContent = '+ Add Wire'; box.appendChild(addBtn);
  const actions = document.createElement('div'); actions.className = 'form-actions';
  const doneBtn = document.createElement('button'); doneBtn.type = 'button'; doneBtn.className = 'btn-secondary'; doneBtn.textContent = 'Done';
  actions.appendChild(doneBtn); box.appendChild(actions);

  function num(id) { return parseFloat(box.querySelector('#field-' + id).value) || 0; }
  function val(id) { return box.querySelector('#field-' + id).value; }

  async function loadWires() {
    const wires = (await fetchWires(stream)).filter(w => ACCOUNTS.matches(w.account_id));
    listWrap.innerHTML = '';
    if (!wires.length) { listWrap.innerHTML = '<div class="goal-manage-empty">No wires yet.</div>'; return; }
    wires.sort((a, b) => new Date(b.wire_date) - new Date(a.wire_date));
    wires.forEach(w => {
      const row = document.createElement('div'); row.className = 'us-ledger-row';
      row.innerHTML = `<span>${formatDate(w.wire_date)}${ownerTag(w.account_id)}</span>
        <span>$${parseFloat(w.usd_received || 0).toLocaleString('en-US')}</span>
        <span>@ ₹${parseFloat(w.effective_rate || 0).toFixed(2)}${w.actual_rate ? ` <small>(mkt ₹${parseFloat(w.actual_rate).toFixed(2)})</small>` : ''}</span>
        <span class="us-ledger-status">${w.status || ''}</span>`;
      listWrap.appendChild(row);
    });
  }

  addBtn.addEventListener('click', async () => {
    const usdReceived = num('usd_received');
    if (!val('wire_date'))         { showToast('Enter wire date', 'error'); return; }
    if (!owner.value()) { showToast('Pick whose account this is', 'error'); return; }
    if (val('wire_date') > localYMD(new Date(Date.now() + 86400000))) { showToast('The wire date is in the future', 'error'); return; }
    if (num('inr_principal') <= 0) { showToast('Enter INR principal', 'error'); return; }
    if (usdReceived <= 0)          { showToast('Enter USD received', 'error'); return; }

    const inrDebited = Math.round((num('inr_principal') + num('commission') + num('gst') + num('correspondent_charge')) * 100) / 100;
    const effRate    = Math.round(inrDebited / usdReceived * 10000) / 10000;
    const usdSent    = num('usd_sent');
    const actualRate = usdSent > 0 ? Math.round(num('inr_principal') / usdSent * 10000) / 10000 : 0;

    addBtn.disabled = true; addBtn.textContent = 'Adding…';
    try {
      const newRow = {
        account_id: owner.value(),
        wire_date: val('wire_date'),
        payment_reference: val('payment_reference'),
        inr_principal: num('inr_principal'),
        commission: num('commission'),
        gst: num('gst'),
        correspondent_charge: num('correspondent_charge'),
        inr_debited: inrDebited,
        usd_sent: usdSent,
        usd_received: usdReceived,
        effective_rate: effRate,
        actual_rate: actualRate,
        status: val('status') || 'received',
        notes: val('notes'),
      };
      await API.insert(stream.wireTable, newRow, requestIdFor(box, newRow));
      requestDone(box);
      showToast(`Wire added — effective ₹${effRate.toFixed(2)}/USD`);
      stream.wireFields.forEach(f => { const el = box.querySelector('#field-' + f.id); if (el) el.value = f.id === 'wire_date' ? todayStr() : ''; });
      await loadWires();
    } catch (e) { showToast('Failed: ' + e.message, 'error'); }
    finally { addBtn.disabled = false; addBtn.textContent = '+ Add Wire'; }
  });

  doneBtn.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  await loadWires();
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// ── Repatriations overlay (USD → INR) ─────────────────────────────────────────

async function renderRepatOverlay(stream) {
  const overlay = document.createElement('div'); overlay.className = 'asset-form-overlay';
  const box = document.createElement('div'); box.className = 'asset-form-box';
  const title = document.createElement('h3'); title.textContent = 'US Repatriations (USD → INR)'; box.appendChild(title);

  const hint = document.createElement('p');
  hint.className = 'goal-manage-hint';
  hint.textContent = 'effective_rate_back = inr_received ÷ usd_withdrawn (true round-trip-home ₹/USD).';
  box.appendChild(hint);

  const listWrap = document.createElement('div'); listWrap.className = 'us-ledger-list'; box.appendChild(listWrap);

  const addTitle = document.createElement('div'); addTitle.className = 'goal-manage-add-title'; addTitle.textContent = 'Add Repatriation'; box.appendChild(addTitle);
  const owner = accountPicker(box);
  stream.repatFields.forEach(f => box.appendChild(renderField(f, f.id === 'repat_date' ? todayStr() : '')));

  const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'btn-primary btn-sm'; addBtn.textContent = '+ Add Repatriation'; box.appendChild(addBtn);
  const actions = document.createElement('div'); actions.className = 'form-actions';
  const doneBtn = document.createElement('button'); doneBtn.type = 'button'; doneBtn.className = 'btn-secondary'; doneBtn.textContent = 'Done';
  actions.appendChild(doneBtn); box.appendChild(actions);

  function num(id) { return parseFloat(box.querySelector('#field-' + id).value) || 0; }
  function val(id) { return box.querySelector('#field-' + id).value; }

  async function loadRepats() {
    let repats = [];
    try { const r = await API.get(stream.repatTable, { limit: 1000000 }); repats = (r.rows || []).filter(x => ACCOUNTS.matches(x.account_id)); } catch (_) {}
    listWrap.innerHTML = '';
    if (!repats.length) { listWrap.innerHTML = '<div class="goal-manage-empty">No repatriations yet.</div>'; return; }
    repats.sort((a, b) => new Date(b.repat_date) - new Date(a.repat_date));
    repats.forEach(r => {
      const row = document.createElement('div'); row.className = 'us-ledger-row';
      row.innerHTML = `<span>${formatDate(r.repat_date)}${ownerTag(r.account_id)}</span>
        <span>$${parseFloat(r.usd_withdrawn || 0).toLocaleString('en-US')}</span>
        <span>@ ₹${parseFloat(r.effective_rate_back || 0).toFixed(2)}${r.actual_rate_back ? ` <small>(mkt ₹${parseFloat(r.actual_rate_back).toFixed(2)})</small>` : ''}</span>
        <span class="us-ledger-status">${r.status || ''}</span>`;
      listWrap.appendChild(row);
    });
  }

  addBtn.addEventListener('click', async () => {
    const usdWithdrawn = num('usd_withdrawn');
    const inrReceived  = num('inr_received');
    if (!val('repat_date')) { showToast('Enter repat date', 'error'); return; }
    if (!owner.value()) { showToast('Pick whose account this is', 'error'); return; }
    if (val('repat_date') > localYMD(new Date(Date.now() + 86400000))) { showToast('The date is in the future', 'error'); return; }
    if (usdWithdrawn <= 0)  { showToast('Enter USD withdrawn', 'error'); return; }
    if (inrReceived <= 0)   { showToast('Enter INR received', 'error'); return; }

    const effBack    = Math.round(inrReceived / usdWithdrawn * 10000) / 10000;
    const grossUsd   = usdWithdrawn - num('ibkr_withdrawal_fee');
    const actualBack = grossUsd > 0
      ? Math.round((inrReceived + num('correspondent_charge')) / grossUsd * 10000) / 10000
      : 0;
    addBtn.disabled = true; addBtn.textContent = 'Adding…';
    try {
      const newRow = {
        account_id: owner.value(),
        repat_date: val('repat_date'),
        usd_withdrawn: usdWithdrawn,
        ibkr_withdrawal_fee: num('ibkr_withdrawal_fee'),
        correspondent_charge: num('correspondent_charge'),
        inr_received: inrReceived,
        effective_rate_back: effBack,
        actual_rate_back: actualBack,
        status: val('status') || 'received',
        notes: val('notes'),
      };
      await API.insert(stream.repatTable, newRow, requestIdFor(box, newRow));
      requestDone(box);
      showToast(`Repatriation added — ₹${effBack.toFixed(2)}/USD back`);
      stream.repatFields.forEach(f => { const el = box.querySelector('#field-' + f.id); if (el) el.value = f.id === 'repat_date' ? todayStr() : ''; });
      await loadRepats();
    } catch (e) { showToast('Failed: ' + e.message, 'error'); }
    finally { addBtn.disabled = false; addBtn.textContent = '+ Add Repatriation'; }
  });

  doneBtn.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  await loadRepats();
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// ── Income overlay (USD dividends / interest → feeds the US cash balance) ──────

async function renderIncomeOverlay(stream) {
  const overlay = document.createElement('div'); overlay.className = 'asset-form-overlay';
  const box = document.createElement('div'); box.className = 'asset-form-box';
  const title = document.createElement('h3'); title.textContent = 'US Income (Dividends / Interest)'; box.appendChild(title);

  const hint = document.createElement('p');
  hint.className = 'goal-manage-hint';
  hint.textContent = 'Log each USD dividend/interest credit. It adds to your US cash balance shown in Holdings.';
  box.appendChild(hint);

  const listWrap = document.createElement('div'); listWrap.className = 'us-ledger-list'; box.appendChild(listWrap);

  const addTitle = document.createElement('div'); addTitle.className = 'goal-manage-add-title'; addTitle.textContent = 'Add Income'; box.appendChild(addTitle);
  const owner = accountPicker(box);
  stream.incomeFields.forEach(f => box.appendChild(renderField(f, f.id === 'income_date' ? todayStr() : '')));

  const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'btn-primary btn-sm'; addBtn.textContent = '+ Add Income'; box.appendChild(addBtn);
  const actions = document.createElement('div'); actions.className = 'form-actions';
  const doneBtn = document.createElement('button'); doneBtn.type = 'button'; doneBtn.className = 'btn-secondary'; doneBtn.textContent = 'Done';
  actions.appendChild(doneBtn); box.appendChild(actions);

  function num(id) { return parseFloat(box.querySelector('#field-' + id).value) || 0; }
  function val(id) { return box.querySelector('#field-' + id).value; }

  async function loadIncome() {
    let rows = [];
    try { const r = await API.get(stream.incomeTable, { limit: 1000000 }); rows = (r.rows || []).filter(x => ACCOUNTS.matches(x.account_id)); } catch (_) {}
    listWrap.innerHTML = '';
    if (!rows.length) { listWrap.innerHTML = '<div class="goal-manage-empty">No income logged yet.</div>'; return; }
    rows.sort((a, b) => new Date(b.income_date) - new Date(a.income_date));
    rows.forEach(r => {
      const row = document.createElement('div'); row.className = 'us-ledger-row';
      row.innerHTML = `<span>${formatDate(r.income_date)}${ownerTag(r.account_id)}</span>
        <span>${r.income_type || ''}</span>
        <span>$${parseFloat(r.usd_amount || 0).toLocaleString('en-US')}</span>
        <span class="us-ledger-status"></span>`;
      listWrap.appendChild(row);
    });
  }

  addBtn.addEventListener('click', async () => {
    if (!val('income_date')) { showToast('Enter a date', 'error'); return; }
    if (!owner.value()) { showToast('Pick whose account this is', 'error'); return; }
    if (val('income_date') > localYMD(new Date(Date.now() + 86400000))) { showToast('The date is in the future', 'error'); return; }
    if (num('usd_amount') <= 0) { showToast('Enter a USD amount', 'error'); return; }
    addBtn.disabled = true; addBtn.textContent = 'Adding…';
    try {
      const newRow = {
        account_id: owner.value(),
        income_type: val('income_type') || 'Dividend',
        income_date: val('income_date'),
        usd_amount: num('usd_amount'),
        notes: val('notes'),
      };
      await API.insert(stream.incomeTable, newRow, requestIdFor(box, newRow));
      requestDone(box);
      _insightsCache = null; if (typeof invalidateSnapshots === 'function') invalidateSnapshots(); _holdingsAllRows = null; LSC.clear('insights', 'holdings');
      showToast('Income added');
      stream.incomeFields.forEach(f => { const el = box.querySelector('#field-' + f.id); if (el) el.value = f.id === 'income_date' ? todayStr() : ''; });
      await loadIncome();
    } catch (e) { showToast('Failed: ' + e.message, 'error'); }
    finally { addBtn.disabled = false; addBtn.textContent = '+ Add Income'; }
  });

  doneBtn.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  await loadIncome();
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// Utility helpers
function todayStr() {
  return localYMD(new Date());                    // the local day (toISOString is UTC: yesterday before 05:30 IST)
}

function formatDate(d) {
  const day = localDate(d);
  return day ? day.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
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
