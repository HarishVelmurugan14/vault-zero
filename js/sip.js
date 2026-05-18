// VaultZero — SIP Budget & Allocation Dashboard

// Color palette — assigned by index for any reason name
const REASON_PALETTE = [
  '#22c55e', '#818cf8', '#f59e0b', '#3b82f6',
  '#ec4899', '#14b8a6', '#f97316', '#a78bfa',
];

function reasonColor(reason, reasons) {
  const idx = reasons.indexOf(reason);
  return REASON_PALETTE[idx >= 0 ? idx % REASON_PALETTE.length : 0];
}

// ─── Data helpers ──────────────────────────────────────────────────────────────

async function fetchSIPData(stream) {
  const today = new Date().toISOString().slice(0, 10);

  const [budgetRes, eventsRes, fundsRes, reasonsRes] = await Promise.allSettled([
    API.get(stream.sipBudgetTable,  { limit: 500 }),
    API.get(stream.sipEventsTable,  { limit: 2000 }),
    API.get(stream.assetTable,      { limit: 500 }),
    API.get(stream.sipReasonsTable, { limit: 100 }),
  ]);

  const budgets = (budgetRes.status === 'fulfilled' ? budgetRes.value.rows || [] : [])
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date));
  const events = (eventsRes.status === 'fulfilled' ? eventsRes.value.rows || [] : [])
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date));
  const funds   = fundsRes.status === 'fulfilled'   ? fundsRes.value.rows   || [] : [];
  const reasons = (reasonsRes.status === 'fulfilled' ? reasonsRes.value.rows || [] : [])
    .map(r => r.name).filter(Boolean);

  return { budgets, events, funds, reasons, today };
}

// Latest budget per reason where effective_date ≤ today
function getActiveBudgets(budgets, today, reasons) {
  const result = {};
  reasons.forEach(r => { result[r] = 0; });
  reasons.forEach(r => {
    const match = budgets.find(b => b.reason === r && b.effective_date <= today);
    if (match) result[r] = parseFloat(match.monthly_budget) || 0;
  });
  return result;
}

// One active event per fund_id (latest effective_date ≤ today, STOP excluded)
function getActiveAllocations(events, today) {
  const seen = new Map();
  for (const ev of events) {
    if (ev.effective_date > today) continue;
    const fid = String(ev.fund_id);
    if (!seen.has(fid)) seen.set(fid, ev);
  }
  const active = [];
  seen.forEach(ev => { if (ev.event_type !== 'STOP') active.push(ev); });
  return active;
}

// Tally purely by reason — event_type is irrelevant to the count.
function getAllocatedByReason(activeAllocations, reasons) {
  const result = {};
  reasons.forEach(r => { result[r] = 0; });
  activeAllocations.forEach(ev => {
    const r = ev.reason;
    if (r in result) result[r] += parseFloat(ev.amount) || 0;
  });
  return result;
}

// ─── Entry point ───────────────────────────────────────────────────────────────

async function renderSIPPage(container, stream) {
  container.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const data = await fetchSIPData(stream);
    container.innerHTML = '';
    if (!data.reasons.length) {
      container.innerHTML = `<div class="holdings-empty">No reasons configured.<br>Add rows to <strong>${stream.sipReasonsTable}</strong> in Google Sheets first.</div>`;
      return;
    }
    buildSIPDashboard(container, data, stream);
  } catch (err) {
    container.innerHTML = `<div class="holdings-empty">Failed to load SIP data: ${err.message}</div>`;
  }
}

// ─── Dashboard builder ─────────────────────────────────────────────────────────

function buildSIPDashboard(container, data, stream) {
  const { budgets, events, funds, reasons, today } = data;
  const activeBudgets     = getActiveBudgets(budgets, today, reasons);
  const activeAllocations = getActiveAllocations(events, today);
  const allocatedByReason = getAllocatedByReason(activeAllocations, reasons);

  const fundMap = {};
  funds.forEach(f => { fundMap[String(f.id)] = f[stream.assetNameCol] || f.fund_name || String(f.id); });

  container.appendChild(buildBudgetCard(activeBudgets, allocatedByReason, reasons, stream, data));
  container.appendChild(buildAllocSection(activeAllocations, activeBudgets, reasons, fundMap, stream, data));
  container.appendChild(buildHistorySection(events, fundMap, reasons));
}

// ─── Budget card ───────────────────────────────────────────────────────────────

function buildBudgetCard(activeBudgets, allocatedByReason, reasons, stream, data) {
  const card = document.createElement('div');
  card.className = 'sip-budget-card';

  const label = document.createElement('div');
  label.className = 'sip-budget-label';
  label.textContent = 'Monthly SIP Budgets';
  card.appendChild(label);

  const reasonGrid = document.createElement('div');
  reasonGrid.className = 'sip-reason-grid';

  reasons.forEach(reason => {
    const budget    = activeBudgets[reason] || 0;
    const allocated = allocatedByReason[reason] || 0;
    const unalloc   = budget - allocated;
    const over      = unalloc < 0;
    const color     = reasonColor(reason, reasons);

    const sub = document.createElement('div');
    sub.className = 'sip-reason-card';
    sub.style.setProperty('--rc', color);

    sub.innerHTML = `
      <div class="sip-reason-name" style="color:${color}">${reason}</div>
      <div class="sip-reason-budget">${budget > 0 ? '₹' + fmt(budget) : '<span class="sip-no-budget">Not set</span>'}<span class="sip-reason-per">/month</span></div>
      <div class="sip-reason-row">
        <span class="sip-reason-stat-label">Allocated</span>
        <span class="sip-reason-stat-value">₹${fmt(allocated)}</span>
      </div>
      <div class="sip-reason-row ${over ? 'sip-overallocated' : (budget > 0 ? 'sip-unallocated' : '')}">
        <span class="sip-reason-stat-label">${over ? 'Over by' : 'Free'}</span>
        <span class="sip-reason-stat-value">${over ? '-' : ''}₹${fmt(Math.abs(unalloc))}</span>
      </div>
    `;
    reasonGrid.appendChild(sub);
  });

  card.appendChild(reasonGrid);

  const actions = document.createElement('div');
  actions.className = 'sip-budget-actions';
  actions.innerHTML = `<button class="btn-outline btn-sm" id="sip-update-budget-btn">Update Budget</button>`;
  card.appendChild(actions);

  const formArea = document.createElement('div');
  formArea.id = 'sip-budget-form-area';
  card.appendChild(formArea);

  const histToggle = document.createElement('div');
  histToggle.className = 'sip-budget-history-toggle';
  histToggle.textContent = '▾ Budget History';
  card.appendChild(histToggle);

  const histDiv = document.createElement('div');
  histDiv.id = 'sip-budget-history';
  histDiv.style.display = 'none';
  card.appendChild(histDiv);

  card.querySelector('#sip-update-budget-btn').addEventListener('click', () => {
    if (formArea.innerHTML) { formArea.innerHTML = ''; return; }
    renderBudgetForm(formArea, stream, reasons);
  });

  histToggle.addEventListener('click', () => {
    const open = histDiv.style.display !== 'none';
    histDiv.style.display = open ? 'none' : 'block';
    histToggle.textContent = (open ? '▾' : '▸') + ' Budget History';
    if (!open && !histDiv.innerHTML) buildBudgetHistory(histDiv, data.budgets, reasons);
  });

  return card;
}

function buildBudgetHistory(container, budgets, reasons) {
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
      <th style="text-align:left">Reason</th>
      <th style="text-align:left">Effective Date</th>
      <th>Budget (₹/month)</th>
      <th style="text-align:left">Notes</th>
    </tr></thead>
  `;
  const tbody = document.createElement('tbody');
  [...budgets]
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date))
    .forEach(b => {
      const color = reasonColor(b.reason, reasons);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align:left"><span class="sip-type-badge" style="background:${color}22;color:${color}">${b.reason || '—'}</span></td>
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

function renderBudgetForm(container, stream, reasons) {
  const today = new Date().toISOString().slice(0, 10);
  const form = document.createElement('form');
  form.className = 'sip-inline-form';

  const reasonOptions = reasons.map(r => `<option value="${r}">${r}</option>`).join('');

  form.innerHTML = `
    <div class="sip-inline-form-fields">
      <div class="form-group">
        <label>Reason <span class="required">*</span></label>
        <select name="reason" required class="form-input">
          <option value="">Select reason…</option>
          ${reasonOptions}
        </select>
      </div>
      <div class="form-group">
        <label>Monthly Budget (₹) <span class="required">*</span></label>
        <input type="number" step="0.01" name="monthly_budget" required placeholder="32000" class="form-input">
      </div>
      <div class="form-group">
        <label>Effective Date <span class="required">*</span></label>
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
    <div class="form-error" style="display:none"></div>
  `;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn    = form.querySelector('[type=submit]');
    const errDiv = form.querySelector('.form-error');
    const fd     = new FormData(form);
    if (!fd.get('reason')) {
      errDiv.textContent = 'Please select a reason.';
      errDiv.style.display = 'block';
      return;
    }
    const row = {
      reason:         fd.get('reason'),
      monthly_budget: parseFloat(fd.get('monthly_budget')),
      effective_date: fd.get('effective_date'),
      notes:          fd.get('notes') || '',
    };
    btn.disabled = true; btn.textContent = 'Saving...';
    errDiv.style.display = 'none';
    try {
      await API.insert(stream.sipBudgetTable, row);
      LSC.clear('insights', 'holdings');
      location.reload();
    } catch (err) {
      errDiv.textContent = 'Save failed: ' + err.message;
      errDiv.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Save Budget';
    }
  });

  container.appendChild(form);
}

// ─── Current allocations section ───────────────────────────────────────────────

function buildAllocSection(activeAllocations, activeBudgets, reasons, fundMap, stream, data) {
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
    section.appendChild(Object.assign(document.createElement('div'), {
      className: 'sip-empty',
      textContent: 'No active allocations. Add a fund to get started.',
    }));
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'report-table-wrap';
    const tbl = document.createElement('table');
    tbl.className = 'report-table';
    tbl.innerHTML = `
      <thead><tr>
        <th style="text-align:left">Fund</th>
        <th style="text-align:left">Type</th>
        <th style="text-align:left">Reason</th>
        <th>₹/month</th>
        <th>% of Budget</th>
        <th>SIP Day</th>
        <th style="text-align:left">Since</th>
      </tr></thead>
    `;
    const tbody = document.createElement('tbody');

    const sorted = [...activeAllocations].sort((a, b) => {
      const rCmp = (a.reason || '').localeCompare(b.reason || '');
      return rCmp !== 0 ? rCmp : (fundMap[String(a.fund_id)] || '').localeCompare(fundMap[String(b.fund_id)] || '');
    });

    let lastReason = null;
    const reasonTotals = {};

    sorted.forEach(ev => {
      const amount  = parseFloat(ev.amount) || 0;
      const reason  = ev.reason || '';
      const budget  = activeBudgets[reason] || 0;
      const pct     = budget > 0 ? ((amount / budget) * 100).toFixed(1) + '%' : '—';
      const typeKey = ev.event_type.replace(/\s+/g, '-');
      const color   = reasonColor(reason, reasons);

      if (!reasonTotals[reason]) reasonTotals[reason] = 0;
      reasonTotals[reason] += amount;

      if (reason !== lastReason) {
        lastReason = reason;
        const sepTr = document.createElement('tr');
        sepTr.className = 'sip-reason-sep-row';
        sepTr.innerHTML = `<td colspan="7" style="text-align:left;padding:10px 14px 4px"><span class="sip-type-badge" style="background:${color}22;color:${color}">${reason}</span></td>`;
        tbody.appendChild(sepTr);
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align:left">${fundMap[String(ev.fund_id)] || ev.fund_id}</td>
        <td style="text-align:left"><span class="sip-type-badge sip-type-${typeKey}">${ev.event_type}</span></td>
        <td style="text-align:left"></td>
        <td>₹${fmt(amount)}</td>
        <td>${pct}</td>
        <td>${ev.sip_date || '—'}</td>
        <td style="text-align:left">${ev.effective_date || '—'}</td>
      `;
      tbody.appendChild(tr);
    });

    // Per-reason subtotal rows
    reasons.forEach(reason => {
      const total  = reasonTotals[reason];
      if (!total) return;
      const budget = activeBudgets[reason] || 0;
      const unalloc = budget - total;
      const over   = unalloc < 0;
      const color  = reasonColor(reason, reasons);
      const subTr  = document.createElement('tr');
      subTr.className = 'total-row';
      subTr.innerHTML = `
        <td style="text-align:left" colspan="3"><span style="color:${color};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">${reason} subtotal</span></td>
        <td>₹${fmt(total)}</td>
        <td>${budget > 0 ? ((total / budget) * 100).toFixed(1) + '%' : '—'}</td>
        <td colspan="2" style="text-align:left;color:${over ? 'var(--negative)' : 'var(--positive)'}">
          ${budget > 0 ? (over ? 'Over by ₹' + fmt(Math.abs(unalloc)) : 'Free ₹' + fmt(unalloc)) : ''}
        </td>
      `;
      tbody.appendChild(subTr);
    });

    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    section.appendChild(wrap);
  }

  section.querySelector('#sip-add-fund-btn').addEventListener('click', () => {
    renderSIPEventForm(section, data, stream, fundMap, reasons);
  });

  return section;
}

// ─── History section ───────────────────────────────────────────────────────────

function buildHistorySection(events, fundMap, reasons) {
  const section = document.createElement('div');
  section.className = 'sip-section';

  const header = document.createElement('div');
  header.className = 'sip-section-header';
  header.innerHTML = '<span class="sip-section-title">History</span>';
  section.appendChild(header);

  const filterBar = document.createElement('div');
  filterBar.className = 'sip-filter-bar';
  const reasonFilter = document.createElement('select');
  reasonFilter.className = 'holdings-filter-select';
  reasonFilter.innerHTML = '<option value="">All Reasons</option>' +
    reasons.map(r => `<option value="${r}">${r}</option>`).join('');
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
        <th style="text-align:left">Reason</th>
        <th>Amount (₹)</th>
        <th>SIP Day</th>
        <th style="text-align:left">Effective Date</th>
      </tr></thead>
    `;
    const tbody = document.createElement('tbody');
    [...filtered]
      .sort((a, b) => b.effective_date.localeCompare(a.effective_date))
      .forEach(ev => {
        const typeKey = ev.event_type.replace(/\s+/g, '-');
        const color   = reasonColor(ev.reason, reasons);
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="text-align:left">${fundMap[String(ev.fund_id)] || ev.fund_id}</td>
          <td style="text-align:left"><span class="sip-type-badge sip-type-${typeKey}">${ev.event_type}</span></td>
          <td style="text-align:left"><span class="sip-type-badge" style="background:${color}22;color:${color}">${ev.reason || '—'}</span></td>
          <td>${ev.amount ? '₹' + fmt(parseFloat(ev.amount) || 0) : '—'}</td>
          <td>${ev.sip_date || '—'}</td>
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

function renderSIPEventForm(parentSection, data, stream, fundMap, reasons) {
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
  const fundGroup = mkGroup('Fund', true);
  const fundSel = document.createElement('select');
  fundSel.className = 'form-input'; fundSel.name = 'fund_id'; fundSel.required = true;
  fundSel.innerHTML = '<option value="">Select fund…</option>';
  data.funds
    .sort((a, b) => (a[stream.assetNameCol] || '').localeCompare(b[stream.assetNameCol] || ''))
    .forEach(f => {
      const o = document.createElement('option');
      o.value = f.id; o.textContent = f[stream.assetNameCol] || String(f.id);
      fundSel.appendChild(o);
    });
  fundGroup.appendChild(fundSel);
  form.appendChild(fundGroup);

  // Event type select
  const typeGroup = mkGroup('Type', true);
  const typeSel = document.createElement('select');
  typeSel.className = 'form-input'; typeSel.name = 'event_type'; typeSel.required = true;
  typeSel.innerHTML = '<option value="">Select type…</option>';
  ['Monthly SIP', 'Rebalance SIP', 'Rebalance SWP', 'Redeem SWP', 'STOP'].forEach(opt => {
    const o = document.createElement('option'); o.value = opt; o.textContent = opt;
    typeSel.appendChild(o);
  });
  typeGroup.appendChild(typeSel);
  form.appendChild(typeGroup);

  // Reason select — populated from sheet
  const reasonGroup = mkGroup('Reason', true);
  const reasonSel = document.createElement('select');
  reasonSel.className = 'form-input'; reasonSel.name = 'reason'; reasonSel.required = true;
  reasonSel.innerHTML = '<option value="">Select reason…</option>' +
    reasons.map(r => `<option value="${r}">${r}</option>`).join('');
  reasonGroup.appendChild(reasonSel);
  form.appendChild(reasonGroup);

  // Amount
  const amountGroup = mkGroup('Amount (₹/month)', true);
  const amountInput = document.createElement('input');
  amountInput.type = 'number'; amountInput.step = '0.01';
  amountInput.name = 'amount'; amountInput.className = 'form-input';
  amountInput.placeholder = '5000'; amountInput.required = true;
  amountGroup.appendChild(amountInput);
  form.appendChild(amountGroup);

  // SIP Day
  const sipDayGroup = mkGroup('SIP Day of Month (1–28)', false);
  const sipDayInput = document.createElement('input');
  sipDayInput.type = 'number'; sipDayInput.step = '1';
  sipDayInput.min = '1'; sipDayInput.max = '28';
  sipDayInput.name = 'sip_date'; sipDayInput.className = 'form-input';
  sipDayInput.placeholder = '5';
  sipDayGroup.appendChild(sipDayInput);
  form.appendChild(sipDayGroup);

  // Effective date
  const today = new Date().toISOString().slice(0, 10);
  const effGroup = mkGroup('Effective Date', true);
  const effInput = document.createElement('input');
  effInput.type = 'date'; effInput.name = 'effective_date';
  effInput.required = true; effInput.value = today;
  effInput.className = 'form-input';
  effGroup.appendChild(effInput);
  form.appendChild(effGroup);

  // Dynamic visibility on type change
  typeSel.addEventListener('change', () => {
    const val   = typeSel.value;
    const isStop = val === 'STOP';
    const isSWP  = val === 'Rebalance SWP' || val === 'Redeem SWP';
    amountGroup.style.display  = isStop ? 'none' : 'block';
    amountInput.required       = !isStop;
    if (isStop) amountInput.value = '0';
    sipDayGroup.style.display  = (isSWP || isStop) ? 'none' : 'block';
  });

  const errDiv = document.createElement('div');
  errDiv.className = 'form-error'; errDiv.style.display = 'none';
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
      fund_id:        fd.get('fund_id'),
      event_type:     fd.get('event_type'),
      reason:         fd.get('reason'),
      amount:         parseFloat(fd.get('amount')) || 0,
      sip_date:       fd.get('sip_date') ? parseInt(fd.get('sip_date')) : null,
      effective_date: fd.get('effective_date'),
    };
    if (!row.fund_id || !row.event_type || !row.reason || !row.effective_date) {
      errDiv.textContent = 'Please fill all required fields.';
      errDiv.style.display = 'block';
      return;
    }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Saving...';
    errDiv.style.display = 'none';
    try {
      await API.insert(stream.sipEventsTable, row);
      LSC.clear('insights', 'holdings');
      overlay.remove();
      location.reload();
    } catch (err) {
      errDiv.textContent = 'Save failed: ' + err.message;
      errDiv.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Save';
    }
  });

  box.appendChild(form);
  box.querySelector('#sip-event-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function mkGroup(labelText, required) {
  const g   = document.createElement('div');
  g.className = 'form-group';
  const lbl = document.createElement('label');
  lbl.textContent = labelText;
  if (required) {
    const star = document.createElement('span');
    star.className = 'required'; star.textContent = ' *';
    lbl.appendChild(star);
  }
  g.appendChild(lbl);
  return g;
}

function fmt(n) {
  return typeof formatINR === 'function' ? formatINR(n) : n.toLocaleString('en-IN');
}
