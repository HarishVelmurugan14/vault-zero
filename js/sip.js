// VaultZero — SIP Budget & Allocation Dashboard

// ─── Data helpers ──────────────────────────────────────────────────────────────

async function fetchSIPData(stream) {
  const today = new Date().toISOString().slice(0, 10);

  const [budgetRes, eventsRes, fundsRes] = await Promise.allSettled([
    API.get(stream.sipBudgetTable, { limit: 500 }),
    API.get(stream.sipEventsTable, { limit: 2000 }),
    API.get(stream.assetTable, { limit: 500 }),
  ]);

  const budgets = (budgetRes.status === 'fulfilled' ? budgetRes.value.rows || [] : [])
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date));
  const events = (eventsRes.status === 'fulfilled' ? eventsRes.value.rows || [] : [])
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date));
  const funds = (fundsRes.status === 'fulfilled' ? fundsRes.value.rows || [] : []);

  return { budgets, events, funds, today };
}

function getActiveBudget(budgets, today) {
  return budgets.find(b => b.effective_date <= today) || null;
}

function getActiveAllocations(events, today) {
  const seen = new Map(); // fund_id → latest event
  for (const ev of events) {
    if (ev.effective_date > today) continue;
    const fid = String(ev.fund_id);
    if (!seen.has(fid)) seen.set(fid, ev);
  }
  // Exclude STOP events from the active set
  const active = [];
  seen.forEach(ev => { if (ev.event_type !== 'STOP') active.push(ev); });
  return active;
}

// ─── Entry point ───────────────────────────────────────────────────────────────

async function renderSIPPage(container, stream) {
  container.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const data = await fetchSIPData(stream);
    container.innerHTML = '';
    buildSIPDashboard(container, data, stream);
  } catch (err) {
    container.innerHTML = `<div class="holdings-empty">Failed to load SIP data: ${err.message}</div>`;
  }
}

// ─── Dashboard builder ─────────────────────────────────────────────────────────

function buildSIPDashboard(container, data, stream) {
  const { budgets, events, funds, today } = data;
  const activeBudget = getActiveBudget(budgets, today);
  const activeAllocations = getActiveAllocations(events, today);

  const fundMap = {};
  funds.forEach(f => { fundMap[String(f.id)] = f[stream.assetNameCol] || f.fund_name || String(f.id); });

  // ── Budget card ──────────────────────────────────────────────
  const budgetCard = buildBudgetCard(activeBudget, activeAllocations, stream, data);
  container.appendChild(budgetCard);

  // ── Current allocations section ──────────────────────────────
  const allocSection = buildAllocSection(activeAllocations, activeBudget, fundMap, stream, data);
  container.appendChild(allocSection);

  // ── History section ──────────────────────────────────────────
  const histSection = buildHistorySection(events, fundMap);
  container.appendChild(histSection);
}

// ─── Budget card ───────────────────────────────────────────────────────────────

function buildBudgetCard(activeBudget, activeAllocations, stream, data) {
  const monthlyBudget = activeBudget ? parseFloat(activeBudget.monthly_budget) || 0 : 0;

  const monthlySIPTotal = activeAllocations
    .filter(ev => ev.event_type === 'Monthly SIP')
    .reduce((s, ev) => s + (parseFloat(ev.amount) || 0), 0);

  const rebalanceSIPTotal = activeAllocations
    .filter(ev => ev.event_type === 'Rebalance SIP')
    .reduce((s, ev) => s + (parseFloat(ev.amount) || 0), 0);

  const swpTotal = activeAllocations
    .filter(ev => ev.event_type === 'Rebalance SWP' || ev.event_type === 'Redeem SWP')
    .reduce((s, ev) => s + (parseFloat(ev.amount) || 0), 0);

  const unallocated = monthlyBudget - monthlySIPTotal;
  const overallocated = unallocated < 0;

  const card = document.createElement('div');
  card.className = 'sip-budget-card';

  card.innerHTML = `
    <div class="sip-budget-label">Monthly SIP Budget</div>
    <div class="sip-budget-total">${activeBudget ? '₹' + fmt(monthlyBudget) + '<span>/month</span>' : '<span class="sip-no-budget">No budget set</span>'}</div>
    <div class="sip-budget-row">
      <div class="sip-budget-item">
        <span class="sip-budget-item-label">Monthly SIP</span>
        <span class="sip-budget-item-value">₹${fmt(monthlySIPTotal)}</span>
      </div>
      <div class="sip-budget-item">
        <span class="sip-budget-item-label">Rebalance SIP</span>
        <span class="sip-budget-item-value">₹${fmt(rebalanceSIPTotal)}</span>
      </div>
      <div class="sip-budget-item">
        <span class="sip-budget-item-label">SWP</span>
        <span class="sip-budget-item-value">₹${fmt(swpTotal)}</span>
      </div>
      <div class="sip-budget-item ${overallocated ? 'sip-overallocated' : 'sip-unallocated'}">
        <span class="sip-budget-item-label">${overallocated ? 'Overallocated' : 'Unallocated'}</span>
        <span class="sip-budget-item-value">${overallocated ? '-' : ''}₹${fmt(Math.abs(unallocated))}</span>
      </div>
    </div>
    <div class="sip-budget-actions">
      <button class="btn-outline btn-sm" id="sip-update-budget-btn">Update Budget</button>
    </div>
    <div id="sip-budget-form-area"></div>
    <div class="sip-budget-history-toggle" id="sip-budget-history-toggle">▾ Budget History</div>
    <div id="sip-budget-history" style="display:none;"></div>
  `;

  card.querySelector('#sip-update-budget-btn').addEventListener('click', () => {
    const formArea = card.querySelector('#sip-budget-form-area');
    if (formArea.innerHTML) { formArea.innerHTML = ''; return; }
    renderBudgetForm(formArea, stream, activeBudget);
  });

  const histToggle = card.querySelector('#sip-budget-history-toggle');
  const histDiv = card.querySelector('#sip-budget-history');
  histToggle.addEventListener('click', () => {
    const open = histDiv.style.display !== 'none';
    histDiv.style.display = open ? 'none' : 'block';
    histToggle.textContent = (open ? '▾' : '▸') + ' Budget History';
    if (!open && !histDiv.innerHTML) {
      buildBudgetHistory(histDiv, data.budgets);
    }
  });

  return card;
}

function buildBudgetHistory(container, budgets) {
  if (!budgets.length) {
    container.innerHTML = '<div class="sip-empty">No budget records yet.</div>';
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'report-table-wrap';
  const tbl = document.createElement('table');
  tbl.className = 'report-table';
  tbl.innerHTML = `
    <thead><tr>
      <th style="text-align:left">Effective Date</th>
      <th>Budget (₹/month)</th>
      <th style="text-align:left">Notes</th>
    </tr></thead>
  `;
  const tbody = document.createElement('tbody');
  budgets.forEach(b => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align:left">${b.effective_date}</td>
      <td>₹${fmt(parseFloat(b.monthly_budget) || 0)}</td>
      <td style="text-align:left">${b.notes || '—'}</td>
    `;
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  container.appendChild(wrap);
}

function renderBudgetForm(container, stream) {
  const today = new Date().toISOString().slice(0, 10);
  const form = document.createElement('form');
  form.className = 'sip-inline-form';
  form.innerHTML = `
    <div class="sip-inline-form-fields">
      <div class="form-group">
        <label>New Monthly Budget (₹)</label>
        <input type="number" step="0.01" name="monthly_budget" required placeholder="32000" class="form-input">
      </div>
      <div class="form-group">
        <label>Effective Date</label>
        <input type="date" name="effective_date" required value="${today}" class="form-input">
      </div>
      <div class="form-group">
        <label>Notes</label>
        <input type="text" name="notes" placeholder="Optional" class="form-input">
      </div>
    </div>
    <div class="sip-form-actions">
      <button type="submit" class="btn-primary">Save Budget</button>
    </div>
    <div id="sip-budget-form-err" class="form-error" style="display:none"></div>
  `;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const errDiv = form.querySelector('#sip-budget-form-err');
    const fd = new FormData(form);
    const row = {
      monthly_budget: parseFloat(fd.get('monthly_budget')),
      effective_date: fd.get('effective_date'),
      notes: fd.get('notes') || '',
    };
    btn.disabled = true;
    btn.textContent = 'Saving...';
    errDiv.style.display = 'none';
    try {
      await API.insert(stream.sipBudgetTable, row);
      LSC.clear('insights', 'holdings');
      location.reload();
    } catch (err) {
      errDiv.textContent = 'Save failed: ' + err.message;
      errDiv.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Save Budget';
    }
  });

  container.appendChild(form);
}

// ─── Current allocations section ───────────────────────────────────────────────

function buildAllocSection(activeAllocations, activeBudget, fundMap, stream, data) {
  const monthlyBudget = activeBudget ? parseFloat(activeBudget.monthly_budget) || 0 : 0;
  const section = document.createElement('div');
  section.className = 'sip-section';

  const header = document.createElement('div');
  header.className = 'sip-section-header';
  header.innerHTML = `
    <span class="sip-section-title">Current Allocations</span>
    <button class="btn-outline btn-sm" id="sip-add-fund-btn">＋ Add / Change Fund</button>
  `;
  section.appendChild(header);

  if (!activeAllocations.length) {
    const empty = document.createElement('div');
    empty.className = 'sip-empty';
    empty.textContent = 'No active allocations. Add a fund to get started.';
    section.appendChild(empty);
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'report-table-wrap';
    const tbl = document.createElement('table');
    tbl.className = 'report-table';
    tbl.innerHTML = `
      <thead><tr>
        <th style="text-align:left">Fund</th>
        <th style="text-align:left">Type</th>
        <th>₹/month</th>
        <th>% of Budget</th>
        <th>SIP Day</th>
        <th style="text-align:left">Reason</th>
        <th style="text-align:left">Since</th>
      </tr></thead>
    `;
    const tbody = document.createElement('tbody');

    let totalSIP = 0, totalSWP = 0;

    activeAllocations
      .sort((a, b) => (fundMap[String(a.fund_id)] || '').localeCompare(fundMap[String(b.fund_id)] || ''))
      .forEach(ev => {
        const amount = parseFloat(ev.amount) || 0;
        const isSIP = ev.event_type === 'Monthly SIP' || ev.event_type === 'Rebalance SIP';
        const isSWP = ev.event_type === 'Rebalance SWP' || ev.event_type === 'Redeem SWP';
        if (isSIP) totalSIP += amount;
        if (isSWP) totalSWP += amount;

        const pct = monthlyBudget > 0 && isSIP ? ((amount / monthlyBudget) * 100).toFixed(1) + '%' : '—';
        const typeKey = ev.event_type.replace(/\s+/g, '-');
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="text-align:left">${fundMap[String(ev.fund_id)] || ev.fund_id}</td>
          <td style="text-align:left"><span class="sip-type-badge sip-type-${typeKey}">${ev.event_type}</span></td>
          <td>₹${fmt(amount)}</td>
          <td>${pct}</td>
          <td>${ev.sip_date || '—'}</td>
          <td style="text-align:left">${ev.reason || '—'}</td>
          <td style="text-align:left">${ev.effective_date || '—'}</td>
        `;
        tbody.appendChild(tr);
      });

    // Footer totals row
    const totalTr = document.createElement('tr');
    totalTr.className = 'total-row';
    totalTr.innerHTML = `
      <td style="text-align:left">Total</td>
      <td></td>
      <td>₹${fmt(totalSIP + totalSWP)}</td>
      <td>${monthlyBudget > 0 ? ((totalSIP / monthlyBudget) * 100).toFixed(1) + '%' : '—'}</td>
      <td></td>
      <td></td>
      <td></td>
    `;
    tbody.appendChild(totalTr);

    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    section.appendChild(wrap);
  }

  section.querySelector('#sip-add-fund-btn').addEventListener('click', () => {
    renderSIPEventForm(section, data, stream, fundMap);
  });

  return section;
}

// ─── History section ───────────────────────────────────────────────────────────

function buildHistorySection(events, fundMap) {
  const section = document.createElement('div');
  section.className = 'sip-section';

  const header = document.createElement('div');
  header.className = 'sip-section-header';
  header.innerHTML = `
    <span class="sip-section-title">History</span>
  `;
  section.appendChild(header);

  // Reason filter
  const filterBar = document.createElement('div');
  filterBar.className = 'sip-filter-bar';
  const reasonFilter = document.createElement('select');
  reasonFilter.className = 'holdings-filter-select';
  reasonFilter.innerHTML = `
    <option value="">All Reasons</option>
    <option value="Regular">Regular</option>
    <option value="Rebalance">Rebalance</option>
    <option value="Redeem">Redeem</option>
  `;
  filterBar.appendChild(reasonFilter);
  section.appendChild(filterBar);

  const tableWrap = document.createElement('div');
  section.appendChild(tableWrap);

  function renderHistoryTable(filterReason) {
    tableWrap.innerHTML = '';
    const filtered = filterReason ? events.filter(ev => ev.reason === filterReason) : events;

    if (!filtered.length) {
      tableWrap.innerHTML = '<div class="sip-empty">No history found.</div>';
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'report-table-wrap';
    const tbl = document.createElement('table');
    tbl.className = 'report-table';
    tbl.innerHTML = `
      <thead><tr>
        <th style="text-align:left">Fund</th>
        <th style="text-align:left">Type</th>
        <th>Amount (₹)</th>
        <th>SIP Day</th>
        <th style="text-align:left">Reason</th>
        <th style="text-align:left">Effective Date</th>
      </tr></thead>
    `;
    const tbody = document.createElement('tbody');
    [...filtered]
      .sort((a, b) => b.effective_date.localeCompare(a.effective_date))
      .forEach(ev => {
        const typeKey = ev.event_type.replace(/\s+/g, '-');
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="text-align:left">${fundMap[String(ev.fund_id)] || ev.fund_id}</td>
          <td style="text-align:left"><span class="sip-type-badge sip-type-${typeKey}">${ev.event_type}</span></td>
          <td>${ev.amount ? '₹' + fmt(parseFloat(ev.amount) || 0) : '—'}</td>
          <td>${ev.sip_date || '—'}</td>
          <td style="text-align:left">${ev.reason || '—'}</td>
          <td style="text-align:left">${ev.effective_date || '—'}</td>
        `;
        tbody.appendChild(tr);
      });
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    tableWrap.appendChild(wrap);
  }

  renderHistoryTable('');
  reasonFilter.addEventListener('change', () => renderHistoryTable(reasonFilter.value));

  return section;
}

// ─── SIP Event form overlay ────────────────────────────────────────────────────

function renderSIPEventForm(parentSection, data, stream, fundMap) {
  // Remove any existing overlay
  document.querySelector('.asset-form-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'asset-form-overlay';

  const box = document.createElement('div');
  box.className = 'asset-form-box';

  const title = document.createElement('h3');
  title.className = 'asset-form-title';
  title.textContent = 'Add / Change Fund Allocation';
  box.appendChild(title);

  const form = document.createElement('form');
  form.id = 'sip-event-form';

  // Fund select
  const fundGroup = document.createElement('div');
  fundGroup.className = 'form-group';
  fundGroup.innerHTML = '<label>Fund <span class="required">*</span></label>';
  const fundSel = document.createElement('select');
  fundSel.className = 'form-input';
  fundSel.name = 'fund_id';
  fundSel.required = true;
  fundSel.innerHTML = '<option value="">Select fund…</option>';
  data.funds
    .sort((a, b) => (a[stream.assetNameCol] || '').localeCompare(b[stream.assetNameCol] || ''))
    .forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f[stream.assetNameCol] || String(f.id);
      fundSel.appendChild(opt);
    });
  fundGroup.appendChild(fundSel);
  form.appendChild(fundGroup);

  // Event type select
  const typeGroup = document.createElement('div');
  typeGroup.className = 'form-group';
  typeGroup.innerHTML = '<label>Type <span class="required">*</span></label>';
  const typeSel = document.createElement('select');
  typeSel.className = 'form-input';
  typeSel.name = 'event_type';
  typeSel.required = true;
  typeSel.innerHTML = '<option value="">Select type…</option>';
  ['Monthly SIP', 'Rebalance SIP', 'Rebalance SWP', 'Redeem SWP', 'STOP'].forEach(opt => {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    typeSel.appendChild(o);
  });
  typeGroup.appendChild(typeSel);
  form.appendChild(typeGroup);

  // Amount field (hidden for STOP)
  const amountGroup = document.createElement('div');
  amountGroup.className = 'form-group';
  amountGroup.innerHTML = `
    <label>Amount (₹/month) <span class="required">*</span></label>
    <input type="number" step="0.01" name="amount" class="form-input" placeholder="5000">
  `;
  form.appendChild(amountGroup);

  // SIP Day field
  const sipDayGroup = document.createElement('div');
  sipDayGroup.className = 'form-group';
  sipDayGroup.innerHTML = `
    <label>SIP Day of Month (1–28)</label>
    <input type="number" step="1" min="1" max="28" name="sip_date" class="form-input" placeholder="5">
  `;
  form.appendChild(sipDayGroup);

  // Effective date
  const today = new Date().toISOString().slice(0, 10);
  const effGroup = document.createElement('div');
  effGroup.className = 'form-group';
  effGroup.innerHTML = `
    <label>Effective Date <span class="required">*</span></label>
    <input type="date" name="effective_date" required value="${today}" class="form-input">
  `;
  form.appendChild(effGroup);

  // Reason select
  const reasonGroup = document.createElement('div');
  reasonGroup.className = 'form-group';
  reasonGroup.innerHTML = `
    <label>Reason <span class="required">*</span></label>
    <select name="reason" required class="form-input">
      <option value="">Select reason…</option>
      <option value="Regular">Regular</option>
      <option value="Rebalance">Rebalance</option>
      <option value="Redeem">Redeem</option>
    </select>
  `;
  form.appendChild(reasonGroup);

  // Dynamic visibility: hide amount when STOP selected
  const amountInput = amountGroup.querySelector('input');
  typeSel.addEventListener('change', () => {
    const val = typeSel.value;
    const hideAmount = val === 'STOP';
    amountGroup.style.display = hideAmount ? 'none' : 'block';
    amountInput.required = !hideAmount;
    if (hideAmount) amountInput.value = '0';
    // Hide SIP day for SWP types
    sipDayGroup.style.display = (val === 'Rebalance SWP' || val === 'Redeem SWP' || val === 'STOP') ? 'none' : 'block';
  });

  const errDiv = document.createElement('div');
  errDiv.className = 'form-error';
  errDiv.style.display = 'none';
  form.appendChild(errDiv);

  const btnRow = document.createElement('div');
  btnRow.className = 'sip-form-actions';
  btnRow.innerHTML = `
    <button type="button" class="btn-secondary" id="sip-event-cancel">Cancel</button>
    <button type="submit" class="btn-primary">Save</button>
  `;
  form.appendChild(btnRow);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const row = {
      fund_id: fd.get('fund_id'),
      event_type: fd.get('event_type'),
      amount: parseFloat(fd.get('amount')) || 0,
      sip_date: fd.get('sip_date') ? parseInt(fd.get('sip_date')) : null,
      effective_date: fd.get('effective_date'),
      reason: fd.get('reason'),
    };

    if (!row.fund_id || !row.event_type || !row.effective_date || !row.reason) {
      errDiv.textContent = 'Please fill all required fields.';
      errDiv.style.display = 'block';
      return;
    }

    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    errDiv.style.display = 'none';

    try {
      await API.insert(stream.sipEventsTable, row);
      LSC.clear('insights', 'holdings');
      overlay.remove();
      location.reload();
    } catch (err) {
      errDiv.textContent = 'Save failed: ' + err.message;
      errDiv.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  });

  box.appendChild(form);

  box.querySelector('#sip-event-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// ─── Number formatter ──────────────────────────────────────────────────────────

function fmt(n) {
  return typeof formatINR === 'function' ? formatINR(n) : n.toLocaleString('en-IN');
}
