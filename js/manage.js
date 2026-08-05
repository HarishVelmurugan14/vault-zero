// VaultZero — Manage (visibility show/hide)

let _manageData = null;

async function renderManage() {
  const header    = document.getElementById('manage-header');
  const container = document.getElementById('manage-content');
  if (!container) return;

  if (header) {
    header.innerHTML = '';
    const h2 = document.createElement('h2');
    h2.textContent = 'Manage Visibility';
    const btn = document.createElement('button');
    btn.className = 'btn-outline btn-sm';
    btn.textContent = '↻ Refresh';
    btn.addEventListener('click', () => { _manageData = null; HIDDEN._loaded = false; renderManage(); });
    header.appendChild(h2);
    header.appendChild(btn);
  }

  container.innerHTML = '<div class="insights-loading"><div class="spinner"></div><p>Loading items…</p></div>';
  const setMsg = m => { const p = container.querySelector('.insights-loading p'); if (p) p.textContent = m; };
  try {
    console.time('[manage] load');
    setMsg('Loading accounts…');
    await ACCOUNTS.load();
    await HIDDEN.load();
    if (!_manageData) {
      setMsg('Fetching holdings…');
      _manageData = await fetchManageData();
    }
    buildManageTree(container, _manageData);
    console.timeEnd('[manage] load');
  } catch (err) {
    console.timeEnd('[manage] load');
    container.innerHTML = `<div class="insights-empty">Failed to load: ${err.message}</div>`;
  }
}

// Asset tables backing a category (precious metals spans two)
function manageCategoryTables(cat) {
  if (cat.stream === 'precious_metals') return ['precious_metal_etf_assets', 'precious_metal_physical_assets'];
  const s = STREAMS[cat.stream];
  return s && s.assetTable ? [s.assetTable] : [];
}

async function fetchManageData() {
  const tables = [...new Set(CATEGORIES.flatMap(manageCategoryTables))];
  const sipReasonsTable = (typeof STREAMS !== 'undefined' && STREAMS.equity_sip && STREAMS.equity_sip.sipReasonsTable) || 'equity_sip_reasons';
  const res = {};

  // Reuse asset rows already fetched by Insights (its background warm-up). Manage
  // only needs id/name/subcategory_id/account_id per asset — the same rows Insights
  // holds — so this avoids a duplicate round-trip that would queue behind the
  // warm-up's heavy transaction pulls (Apps Script serialises per-user requests).
  if (typeof _insightsCache !== 'undefined' && Array.isArray(_insightsCache)) {
    _insightsCache.forEach(e => {
      if (e && e.stream && e.stream.assetTable && Array.isArray(e.assets)) {
        res[e.stream.assetTable] = { rows: e.assets };
      }
    });
  }

  const need = [...tables.filter(t => !res[t]), 'subcategories', sipReasonsTable];
  try {
    Object.assign(res, await API.batchGet(need));
  } catch (_) {
    const results = await Promise.allSettled(need.map(async s => [s, await API.get(s, { limit: 1000 })]));
    results.forEach(r => { if (r.status === 'fulfilled') res[r.value[0]] = r.value[1]; });
  }
  return {
    res,
    subcats: res['subcategories']?.rows || [],
    sipReasons: (res[sipReasonsTable]?.rows || []).filter(r => r && r.name),
    sipReasonsTable,
  };
}

function buildManageTree(container, data) {
  const { res, subcats } = data;
  container.innerHTML = '';

  const hint = document.createElement('p');
  hint.className = 'goal-manage-hint';
  hint.textContent = ACCOUNTS.isAll()
    ? 'Viewing All Accounts — toggles hide items globally (every account). Hidden items are excluded from Log, History, Holdings, Insights and every total.'
    : `Viewing "${ACCOUNTS.currentName()}" — toggles hide items only for this account. Hidden items are excluded from its Log, History, Holdings, Insights and totals.`;
  container.appendChild(hint);

  CATEGORIES.forEach(cat => {
    const box = document.createElement('div');
    box.className = 'manage-cat';

    box.appendChild(makeManageRow(cat.name, 'cat', HIDDEN.isCat(cat.id),
      async () => { await toggleHidden('category', cat.id, cat.name, !HIDDEN.isCat(cat.id)); buildManageTree(container, data); }));

    const tables  = manageCategoryTables(cat);
    const assets  = tables.flatMap(t => (res[t]?.rows || []).map(a => ({ ...a, _table: t })))
      .filter(a => ACCOUNTS.matches(a.account_id));
    const catSubs = subcats.filter(s => String(s.category_id) === String(cat.id));
    const subIds  = new Set(catSubs.map(s => String(s.id)));

    catSubs.forEach(sub => {
      box.appendChild(makeManageRow(sub.name, 'sub', HIDDEN.isSub(sub.id),
        async () => { await toggleHidden('subcategory', sub.id, sub.name, !HIDDEN.isSub(sub.id)); buildManageTree(container, data); }));
      assets.filter(a => String(a.subcategory_id) === String(sub.id))
        .forEach(a => appendAssetRow(box, cat, a, () => buildManageTree(container, data)));
    });

    // Assets with no (or an unlisted) subcategory — directly under the category
    assets.filter(a => !a.subcategory_id || !subIds.has(String(a.subcategory_id)))
      .forEach(a => appendAssetRow(box, cat, a, () => buildManageTree(container, data)));

    container.appendChild(box);
  });

  buildSipManageSection(container, data);
}

// SIP reasons (from the sheet) + the fixed SIP type list. Both are shared config,
// so their hides are always global (every account). Reasons can also be deleted.
function buildSipManageSection(container, data) {
  const redraw  = () => buildManageTree(container, data);
  const reasons = data.sipReasons || [];
  const table   = data.sipReasonsTable || 'equity_sip_reasons';

  // ── SIP Reasons ──
  const rBox = document.createElement('div');
  rBox.className = 'manage-cat';
  rBox.appendChild(makeManageHeader('SIP Reasons'));
  rBox.appendChild(makeManageNote('Shared across all accounts. Hiding drops a reason from the budget cards, dropdowns and history filter. Delete removes the row — past budgets/events keep pointing at it but lose their label.'));
  if (!reasons.length) {
    rBox.appendChild(makeManageNote('No reasons configured yet.'));
  } else {
    reasons.forEach(r => {
      const ref = `${table}|${r.id}`;
      rBox.appendChild(makeManageRow(r.name || ('#' + r.id), 'asset', HIDDEN.isReason(table, r.id),
        async () => { await toggleHiddenGlobal('sip_reason', ref, r.name, !HIDDEN.isReason(table, r.id)); redraw(); },
        () => deleteSipReason(table, r, redraw)));
    });
  }
  container.appendChild(rBox);

  // ── SIP Types (fixed list) ──
  const tBox = document.createElement('div');
  tBox.className = 'manage-cat';
  tBox.appendChild(makeManageHeader('SIP Types'));
  tBox.appendChild(makeManageNote('Fixed set — some carry behaviour (STOP clears a slot, SWPs skip the SIP-day). Hide the ones you don\'t use so they drop from the Type dropdown.'));
  (typeof SIP_EVENT_TYPES !== 'undefined' ? SIP_EVENT_TYPES : []).forEach(t => {
    tBox.appendChild(makeManageRow(t, 'asset', HIDDEN.isType(t),
      async () => { await toggleHiddenGlobal('sip_type', t, t, !HIDDEN.isType(t)); redraw(); }));
  });
  container.appendChild(tBox);
}

function makeManageHeader(title) {
  const row = document.createElement('div');
  row.className = 'manage-row manage-cat';
  const name = document.createElement('span');
  name.className = 'manage-label';
  name.textContent = title;
  row.appendChild(name);
  return row;
}

function makeManageNote(text) {
  const el = document.createElement('div');
  el.className = 'manage-section-note';
  el.textContent = text;
  return el;
}

async function deleteSipReason(table, reason, redraw) {
  const ok = confirm(`Delete reason "${reason.name}"?\n\nHistorical budgets and events tagged to it will lose their label (they are not deleted). This can't be undone.`);
  if (!ok) return;
  try {
    await API.delete(table, reason.id);
    if (_manageData && Array.isArray(_manageData.sipReasons)) {
      _manageData.sipReasons = _manageData.sipReasons.filter(r => String(r.id) !== String(reason.id));
    }
    LSC.clear('insights', 'holdings');
    showToast('Reason deleted');
    redraw();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

async function toggleHiddenGlobal(kind, ref, name, hide) {
  try {
    if (hide) await HIDDEN.hide(kind, ref, name, true);
    else      await HIDDEN.unhide(kind, ref, true);
    CACHE._store = {};
    showToast(hide ? 'Hidden (all accounts)' : 'Shown again');
  } catch (e) {
    showToast('Failed: ' + e.message, 'error');
  }
}

function appendAssetRow(box, cat, a, redraw) {
  let streamKey = cat.stream;
  if (cat.stream === 'precious_metals') streamKey = a._table.includes('physical') ? 'precious_metals_physical' : 'precious_metals_digital';
  const stream  = STREAMS[streamKey];
  const nameCol = stream?.assetNameCol || 'name';
  const name    = a[nameCol] || a.name || a.fund_name || a.company_name || a.account_name || ('#' + a.id);
  const key     = HIDDEN.assetKey(a._table, a.id);

  box.appendChild(makeManageRow(name, 'asset', HIDDEN.isAsset(a._table, a.id),
    async () => { await toggleHidden('asset', key, name, !HIDDEN.isAsset(a._table, a.id)); redraw(); }));
}

function makeManageRow(label, level, hidden, onToggle, onDelete) {
  const row = document.createElement('div');
  row.className = `manage-row manage-${level}` + (hidden ? ' manage-hidden' : '');
  const name = document.createElement('span');
  name.className = 'manage-label';
  name.textContent = label;
  row.appendChild(name);

  const actions = document.createElement('div');
  actions.className = 'manage-actions';
  if (onDelete) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'manage-delete';
    del.textContent = '🗑 Delete';
    del.addEventListener('click', () => onDelete());
    actions.appendChild(del);
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'manage-toggle' + (hidden ? ' is-hidden' : '');
  btn.textContent = hidden ? '🙈 Hidden' : '👁 Shown';
  btn.addEventListener('click', () => onToggle());
  actions.appendChild(btn);

  row.appendChild(actions);
  return row;
}

async function toggleHidden(kind, ref, name, hide) {
  try {
    if (hide) await HIDDEN.hide(kind, ref, name);
    else      await HIDDEN.unhide(kind, ref);
    CACHE._store = {};   // asset dropdowns re-fetch
    showToast(hide ? 'Hidden everywhere' : 'Shown again');
  } catch (e) {
    showToast('Failed: ' + e.message, 'error');
  }
}
