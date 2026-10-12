/* SORT Inventory — offline-capable front end. Talks to the Apps Script API in config.js. */
'use strict';

const APP_VERSION = '1.5.0';
const API_URL = ((window.APP_CONFIG || {}).API_URL || '').trim();

/* =============================== Storage & state =============================== */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('sortinv.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('sortinv.' + k, JSON.stringify(v)); } catch (e) { toast('Device storage is full', 'bad'); } },
  del(k) { try { localStorage.removeItem('sortinv.' + k); } catch (e) {} }
};

const S = {
  token: LS.get('token', null),
  user: LS.get('user', null),
  data: LS.get('data', null),
  outbox: LS.get('outbox', []),
  lastSync: LS.get('lastSync', null),
  syncing: false,
  clock: null,
  route: []
};
const saveData = () => { LS.set('data', S.data); LS.set('lastSync', S.lastSync = new Date().toISOString()); };
const saveOutbox = () => LS.set('outbox', S.outbox);

/* ==================================== Utils ==================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const view = () => $('#view');
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p) => p + '-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const invCount = (n) => n + (n === 1 ? ' inventory' : ' inventories');

/** Re-draw after background data changes, but never under someone mid-task. */
function softRender() {
  const [p0, p1] = S.route;
  if (p0 === 'check' || p0 === 'rig' || p0 === 'scan' || p0 === 'reports' || p0 === 'account' || $('.modal')) return;
  if (p0 === 'admin' && (p1 === 'users' || p1 === 'settings')) return;
  render();
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtDate(ymd) {
  if (!ymd) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(ymd);
  return isNaN(d) ? String(ymd) : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function ago(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso); const now = new Date();
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (days <= 0) return 'Today ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 30) return days + ' days ago';
  return fmtDate(d.toISOString());
}

let toastTimer;
function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3200);
}

const I = {
  chev: '<svg class="chev" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  bang: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 5v9M12 18.5v.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>',
  dots: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>',
  clip: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 4h6v3H9zM8.5 12l2 2 4-4M8.5 17h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M5.5 18.5l2.1-2.1M16.4 7.6l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  chart: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M4 20h16M7 16v-5M12 16V7M17 16v-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.5 20c1.2-3.6 4-5.2 7.5-5.2s6.3 1.6 7.5 5.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  qr: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 18.5h2v1.5h-2zM18.5 14H20v2h-1.5z" fill="currentColor"/></svg>',
  truck: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3.2v2.8h-7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="6.5" cy="17" r="1.8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="17" r="1.8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 9h2.5v4H5zM9 9h2.5v4H9z" fill="currentColor"/></svg>',
  scan: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 015.5 4H8M16 4h2.5A1.5 1.5 0 0120 5.5V8M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16M8 20H5.5A1.5 1.5 0 014 18.5V16M4 12h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  scanSm: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 015.5 4H8M16 4h2.5A1.5 1.5 0 0120 5.5V8M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16M8 20H5.5A1.5 1.5 0 014 18.5V16M4 12h16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  share: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 15V3M7.5 7.5L12 3l4.5 4.5M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  rope: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><ellipse cx="12" cy="12" rx="8" ry="5" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="12" cy="12" rx="4.5" ry="2.6" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
};

/* ================================== Data lookups ================================== */
const D = {
  agency: (id) => (S.data?.agencies || []).find((x) => x.id === id),
  vehicle: (id) => (S.data?.vehicles || []).find((x) => x.id === id),
  bag: (id) => (S.data?.bags || []).find((x) => x.id === id),
  vehiclesOf: (agencyId) => (S.data?.vehicles || []).filter((v) => v.agencyId === agencyId),
  bagsOf: (vehicleId) => (S.data?.bags || []).filter((b) => b.vehicleId === vehicleId),
  itemsOf: (bagId) => (S.data?.items || []).filter((i) => i.bagId === bagId),
  ropesOf: (bagId) => (S.data?.ropes || []).filter((r) => r.bagId === bagId),
  lastCheck: (bagId) => (S.data?.lastChecks || {})[bagId],
  compartment: (id) => (S.data?.compartments || []).find((c) => c.id === id),
  compartmentsOf: (vehicleId) => (S.data?.compartments || []).filter((c) => c.vehicleId === vehicleId),
  largeOf: (vehicleId) => (S.data?.large || []).filter((e) => e.vehicleId === vehicleId),
  lastRig: (vehicleId) => (S.data?.lastRigChecks || {})[vehicleId]
};

/** Compartments of a vehicle (in order) with their bags and large equipment; unassigned last. */
function compGroups(vehicleId) {
  const comps = D.compartmentsOf(vehicleId), bags = D.bagsOf(vehicleId), large = D.largeOf(vehicleId);
  const groups = comps.map((c) => ({ id: c.id, name: c.name, notes: c.notes,
    bags: bags.filter((b) => b.compartmentId === c.id), large: large.filter((e) => e.compartmentId === c.id) }));
  const ub = bags.filter((b) => !b.compartmentId), ul = large.filter((e) => !e.compartmentId);
  if (ub.length || ul.length) groups.push({ id: '', name: comps.length ? 'No compartment assigned' : 'On this vehicle', notes: '', bags: ub, large: ul });
  return groups;
}
const compOpts = (vehicleId) => D.compartmentsOf(vehicleId).map((c) => ({ value: c.id, label: c.name }));
const ropeFlagged = (r) => r.status === 'Damaged - Review' || r.status === 'Out of Service';

/* ===================================== API ===================================== */
async function api(action, payload = {}, opts = {}) {
  if (!API_URL || API_URL.indexOf('PASTE_') === 0) {
    throw new Error('App not connected yet: put your Apps Script URL in config.js.');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // "simple" request: no CORS preflight
      body: JSON.stringify(Object.assign({ action, token: S.token }, payload)),
      signal: ctrl.signal,
      redirect: 'follow'
    });
  } catch (e) {
    const err = new Error(navigator.onLine ? 'Could not reach the server. Check your connection.' : 'You are offline.');
    err.network = true;
    throw err;
  } finally { clearTimeout(timer); }
  let j;
  try { j = await res.json(); } catch (e) {
    const err = new Error('Unexpected server response. Check the Apps Script deployment (access must be "Anyone").');
    err.network = true;
    throw err;
  }
  if (!j.ok) {
    const err = new Error(j.error || 'Request failed.');
    err.auth = !!j.auth;
    if (err.auth && S.token) forceLogout(err.message);
    throw err;
  }
  return j;
}

async function refreshData(quiet) {
  if (!S.token || !navigator.onLine) return false;
  try {
    const res = await api('getData');
    applyData(res.data);
    if (!quiet) toast('Up to date', 'good');
    softRender();
    return true;
  } catch (e) {
    if (!quiet && !e.auth) toast(e.message, 'bad');
    return false;
  }
}

function applyData(data) {
  if (!data) return;
  S.data = data;
  if (data.user) { S.user = data.user; LS.set('user', S.user); }
  saveData();
}

async function trySync(manual) {
  updatePill();
  if (S.syncing || !S.token || !S.user) return;
  const mine = S.outbox.filter((x) => x.by === S.user.email);
  if (!mine.length) { if (manual) refreshData(false); return; }
  if (!navigator.onLine) { if (manual) toast('Offline — will sync when you have a connection'); return; }
  S.syncing = true; updatePill();
  try {
    const res = await api('submitInventory', { inventories: mine.map((x) => x.inv) });
    const done = new Set(res.synced || []);
    S.outbox = S.outbox.filter((x) => !done.has(x.inv.id));
    saveOutbox();
    applyData(res.data);
    toast(invCount(done.size) + ' synced to the sheet', 'good');
    softRender();
  } catch (e) {
    if (manual && !e.auth) toast(e.message, 'bad');
  } finally {
    S.syncing = false; updatePill();
  }
}

function updatePill() {
  const p = $('#syncPill');
  if (!S.token) { p.hidden = true; return; }
  const n = S.user ? S.outbox.filter((x) => x.by === S.user.email).length : 0;
  p.hidden = false;
  p.className = 'sync-pill';
  if (S.syncing) p.textContent = 'Syncing…';
  else if (!navigator.onLine) { p.className += ' offline'; p.textContent = n ? 'Offline · ' + n + ' waiting' : 'Offline'; }
  else if (n) { p.className += ' pending'; p.textContent = n + ' to sync'; }
  else p.textContent = 'Synced';
}

/* ==================================== Modals ==================================== */
function closeModal() { $('#modalRoot').innerHTML = ''; }

function openModal(html) {
  const root = $('#modalRoot');
  root.innerHTML = '<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">' + html + '</div></div>';
  const bd = $('.modal-backdrop', root);
  return bd;
}

function fieldHtml(f, v) {
  const val = v == null ? (f.default == null ? '' : f.default) : v;
  const req = f.required ? ' required' : '';
  const id = 'f_' + f.name;
  let ctl;
  if (f.type === 'select') {
    const opts = (f.options || []).map((o) => {
      const ov = typeof o === 'object' ? o.value : o;
      const ol = typeof o === 'object' ? o.label : o;
      return '<option value="' + esc(ov) + '"' + (String(ov) === String(val) ? ' selected' : '') + '>' + esc(ol) + '</option>';
    }).join('');
    ctl = '<select class="input" id="' + id + '" name="' + esc(f.name) + '"' + req + '>' + (f.placeholder ? '<option value="">' + esc(f.placeholder) + '</option>' : '') + opts + '</select>';
  } else if (f.type === 'textarea') {
    ctl = '<textarea class="input" id="' + id + '" name="' + esc(f.name) + '" placeholder="' + esc(f.placeholder || '') + '"' + req + '>' + esc(val) + '</textarea>';
  } else {
    ctl = '<input class="input" id="' + id + '" name="' + esc(f.name) + '" type="' + (f.type || 'text') + '" value="' + esc(val) + '" placeholder="' + esc(f.placeholder || '') + '"' +
      (f.type === 'number' ? ' inputmode="numeric" min="0"' : '') + (f.autocomplete ? ' autocomplete="' + f.autocomplete + '"' : '') + req + '>';
  }
  return '<label class="field" for="' + id + '"><span>' + esc(f.label) + (f.required ? ' *' : '') + '</span>' + ctl + (f.hint ? '<div class="hint">' + esc(f.hint) + '</div>' : '') + '</label>';
}

/** Generic form sheet. Resolves {values} | {danger:true} | null. */
function formModal(title, fields, values = {}, opts = {}) {
  return new Promise((resolve) => {
    const bd = openModal(
      '<h3>' + esc(title) + '</h3>' + (opts.intro ? '<p class="muted small" style="margin:-8px 4px 14px">' + esc(opts.intro) + '</p>' : '') +
      '<form id="mform" novalidate><div id="merr"></div>' + fields.map((f) => fieldHtml(f, values[f.name])).join('') +
      '<div class="btn-row"><button type="button" class="btn" data-m="cancel">Cancel</button>' +
      '<button type="submit" class="btn primary">' + esc(opts.submit || 'Save') + '</button></div>' +
      (opts.danger ? '<div class="btn-row" style="margin-top:10px"><button type="button" class="btn danger block" data-m="danger">' + esc(opts.danger) + '</button></div>' : '') +
      '</form>');
    const form = $('#mform');
    const done = (r) => { closeModal(); resolve(r); };
    bd.addEventListener('click', (e) => {
      if (e.target === bd) done(null);
      const m = e.target.closest('[data-m]');
      if (m) done(m.dataset.m === 'danger' ? { danger: true } : null);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        out[f.name] = el.value.trim();
        if (f.required && !out[f.name]) { $('#merr').innerHTML = '<div class="error-box">' + esc(f.label) + ' is required.</div>'; el.focus(); return; }
      }
      if (opts.validate) { const msg = opts.validate(out); if (msg) { $('#merr').innerHTML = '<div class="error-box">' + esc(msg) + '</div>'; return; } }
      done({ values: out });
    });
    const first = form.querySelector('input,select,textarea');
    if (first && !opts.noFocus && window.innerWidth > 640) first.focus();
  });
}

function confirmModal(title, message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    const bd = openModal('<h3>' + esc(title) + '</h3><p style="margin:0 4px 18px;color:var(--ink-2)">' + message + '</p>' +
      '<div class="btn-row"><button class="btn" data-m="no">Cancel</button><button class="btn ' + (danger ? 'primary' : 'primary') + '" data-m="yes">' + esc(okLabel) + '</button></div>');
    bd.addEventListener('click', (e) => {
      const m = e.target.closest('[data-m]');
      if (e.target === bd || m) { closeModal(); resolve(!!m && m.dataset.m === 'yes'); }
    });
  });
}

function actionSheet(title, actions) {
  return new Promise((resolve) => {
    const bd = openModal('<h3>' + esc(title) + '</h3><div class="list">' +
      actions.map((a, i) => '<button class="list-item" data-i="' + i + '"><div class="main"><div class="name"' + (a.danger ? ' style="color:var(--bad)"' : '') + '>' + esc(a.label) + '</div>' + (a.sub ? '<div class="sub">' + esc(a.sub) + '</div>' : '') + '</div></button>').join('') +
      '</div><div class="btn-row" style="margin-top:12px"><button class="btn" data-m="x">Cancel</button></div>');
    bd.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) { closeModal(); resolve(actions[+b.dataset.i].value); }
      else if (e.target === bd || e.target.closest('[data-m]')) { closeModal(); resolve(null); }
    });
  });
}

/* ==================================== Router ==================================== */
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

function setHeader(title, crumb, back) {
  $('#title').textContent = title;
  $('#crumb').textContent = crumb || '';
  const b = $('#backBtn');
  b.hidden = !back;
  b.onclick = back ? () => go(back) : null;
  document.title = title + ' · ' + appName();
}
const appName = () => (S.data && S.data.settings && S.data.settings.appName) || 'SORT Inventory';

function render() {
  clearInterval(S.clock);
  if (S.cleanup) { try { S.cleanup(); } catch (e) {} S.cleanup = null; }
  const vw = view(); vw.onclick = vw.oninput = vw.onchange = null;
  const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/').map(decodeURIComponent);
  S.route = parts;
  updatePill();
  if (!S.token) {
    if (parts[0] === 's' && parts[1]) S.pendingScan = parts[1];   // label scanned with the phone camera before signing in
    return renderAuth(parts[0] === 'signup' ? 'signup' : 'login');
  }
  if (!S.data) return renderLoading();
  const isAdmin = !!(S.user && S.user.isAdmin);
  const [p0, p1, p2] = parts;
  window.scrollTo(0, 0);
  switch (p0) {
    case 'inventory': return renderAgencies();
    case 'agency': return renderVehicles(p1);
    case 'vehicle': return renderBags(p1);
    case 'check': return renderCheck(p1, p2);
    case 'rig': return renderRig(p1);
    case 'scan': return renderScan();
    case 's': return resolveScan(p1 || '');
    case 'account': return renderAccount();
    case 'share': return renderShare();
    case 'admin':
      if (!isAdmin) return go('#/home');
      if (p1 === 'agency') return adminAgency(p2);
      if (p1 === 'vehicle') return adminVehicle(p2);
      if (p1 === 'bag') return adminBag(p2);
      if (p1 === 'users') return adminUsers();
      if (p1 === 'settings') return adminSettings();
      if (p1 === 'labels') return adminLabels(p2, parts[3]);
      return adminHome();
    case 'reports':
      if (!isAdmin) return go('#/home');
      return renderReports(p1 || 'build');
    default: return renderHome();
  }
}

/* ===================================== Auth ===================================== */
function renderAuth(mode) {
  setHeader(appName(), '', null);
  const signup = mode === 'signup';
  view().innerHTML =
    '<div class="auth">' +
    '<img class="logo" src="icon-192.png" alt="">' +
    '<h2>' + (signup ? 'Create account' : 'Sign in') + '</h2>' +
    '<p class="lead">' + (signup ? 'You need the security code from your admin.' : 'Rescue equipment inventory') + '</p>' +
    (signup ? '<div class="notice"><strong>Use your agency email address</strong> (your department / work email), not a personal account. Your first and last name are kept with every inventory you complete.</div>' : '') +
    '<form id="authForm" class="card" novalidate><div id="aerr"></div>' +
    (signup ? '<div class="two-col">' + fieldHtml({ name: 'firstName', label: 'First name', autocomplete: 'given-name', required: true }) +
      fieldHtml({ name: 'lastName', label: 'Last name', autocomplete: 'family-name', required: true }) + '</div>' : '') +
    fieldHtml({ name: 'email', label: signup ? 'Agency email address' : 'Email', type: 'email', autocomplete: 'email', required: true,
      placeholder: signup ? 'you@yourdepartment.gov' : '', hint: signup ? 'Use your department-issued email — this is your sign-in.' : '' }) +
    fieldHtml({ name: 'password', label: 'Password', type: 'password', autocomplete: signup ? 'new-password' : 'current-password', required: true, hint: signup ? 'At least 8 characters' : '' }) +
    (signup ? fieldHtml({ name: 'password2', label: 'Confirm password', type: 'password', autocomplete: 'new-password', required: true }) +
      fieldHtml({ name: 'code', label: 'Security code', required: true, autocomplete: 'off', hint: 'Provided by your inventory admin' }) : '') +
    '<button class="btn primary block" type="submit">' + (signup ? 'Create account' : 'Sign in') + '</button>' +
    '</form>' +
    '<div class="switch-link">' + (signup ? 'Already have an account? <a href="#/login">Sign in</a>' : 'New member? <a href="#/signup">Create an account</a>') + '</div>' +
    (!navigator.onLine ? '<p class="center muted small" style="margin-top:20px">You are offline. Signing in needs a connection the first time.</p>' : '') +
    '</div>';
  const form = $('#authForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form).entries());
    const err = (m) => { $('#aerr').innerHTML = '<div class="error-box">' + esc(m) + '</div>'; };
    if (!v.email || !v.password) return err('Enter your email and password.');
    if (signup) {
      if (!v.firstName.trim() || !v.lastName.trim()) return err('Enter your first and last name.');
      if (v.password.length < 8) return err('Password must be at least 8 characters.');
      if (v.password !== v.password2) return err('Passwords do not match.');
      if (!v.code) return err('Enter the security code.');
    }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Please wait…';
    try {
      const res = await api(signup ? 'signup' : 'login', signup
        ? { firstName: v.firstName.trim(), lastName: v.lastName.trim(), email: v.email, password: v.password, code: v.code }
        : { email: v.email, password: v.password });
      S.token = res.token; S.user = res.user;
      LS.set('token', S.token); LS.set('user', S.user);
      renderLoading();
      const d = await api('getData');
      applyData(d.data);
      location.hash = S.pendingScan ? '#/s/' + encodeURIComponent(S.pendingScan) : '#/home';
      S.pendingScan = null;
      render();
      trySync();
    } catch (ex) {
      err(ex.message);
      btn.disabled = false; btn.textContent = signup ? 'Create account' : 'Sign in';
    }
  });
}

function forceLogout(msg) {
  S.token = null; S.data = null;
  LS.del('token'); LS.del('data');
  closeModal();
  if (msg) toast(msg, 'bad');
  location.hash = '#/login';
  render();
}

function renderLoading() {
  setHeader(appName(), '', null);
  view().innerHTML = '<div class="spinner"></div><p class="center muted">Loading inventory…</p>';
  if (S.token && !S.data && !navigator.onLine) {
    view().innerHTML = '<div class="card center" style="margin-top:30px"><p><strong>No offline copy yet.</strong></p><p class="muted">Connect once while signed in so the inventory can be saved to this device.</p></div>';
  } else if (S.token && !S.data) {
    refreshData(true).then((ok) => { if (ok) render(); });
  }
}

/* ===================================== Home ===================================== */
function renderHome() {
  setHeader(appName(), S.user ? 'Signed in as ' + (S.user.name || S.user.email) : '', null);
  const isAdmin = S.user && S.user.isAdmin;
  const flagged = (S.data.ropes || []).filter(ropeFlagged).length;
  const pending = S.outbox.filter((x) => x.by === S.user.email).length;
  view().innerHTML =
    (pending ? '<div class="card" style="margin-bottom:12px;border-color:var(--warn)"><strong>' + invCount(pending) + ' saved on this device</strong><div class="muted small">They will upload automatically when you are online.</div></div>' : '') +
    '<div class="tiles">' +
    '<button class="tile primary" data-go="#/inventory"><div class="t-icon">' + I.clip + '</div><div><div class="t-name">Inventory</div><div class="t-sub">Check off vehicles, bags &amp; ropes</div></div></button>' +
    (isAdmin ?
      '<button class="tile" data-go="#/admin"><div class="t-icon">' + I.gear + '</div><div><div class="t-name">Admin</div><div class="t-sub">Vehicles, compartments, bags, equipment, ropes, users</div></div></button>' +
      '<button class="tile" data-go="#/reports"><div class="t-icon">' + I.chart + '</div><div><div class="t-name">Reports</div><div class="t-sub">Agency, vehicle &amp; bag reports, history, rope logs' + (flagged ? ' · <b style="color:var(--bad)">' + plural(flagged, 'rope') + ' flagged</b>' : '') + '</div></div></button>' : '') +
    '<button class="tile" data-go="#/share"><div class="t-icon">' + I.qr + '</div><div><div class="t-name">Share app</div><div class="t-sub">QR code &amp; add-to-phone steps</div></div></button>' +
    '<button class="tile" data-go="#/account"><div class="t-icon">' + I.user + '</div><div><div class="t-name">My account</div><div class="t-sub">Password, sync, sign out</div></div></button>' +
    '</div>' +
    '<p class="center muted small" style="margin-top:22px">' + (S.lastSync ? 'Data updated ' + ago(S.lastSync) : '') + '</p>';
  bindGo();
}

function bindGo() {
  $$('[data-go]', view()).forEach((el) => el.addEventListener('click', () => go(el.dataset.go)));
}

/* ================================ Inventory flow ================================ */
function renderAgencies() {
  setHeader('Choose agency', 'Inventory', '#/home');
  const ags = S.data.agencies || [];
  view().innerHTML = '<button class="btn block" data-go="#/scan">' + I.scanSm + ' Scan a bag or rope label</button>' +
    '<div class="section-title">Agencies</div>' +
    (ags.length ? '<div class="list">' + ags.map((a) => {
      const n = D.vehiclesOf(a.id).length;
      return '<button class="list-item" data-go="#/agency/' + encodeURIComponent(a.id) + '"><div class="main"><div class="name">' + esc(a.name) + '</div><div class="sub">' + plural(n, 'vehicle') + '</div></div>' + I.chev + '</button>';
    }).join('') + '</div>'
      : emptyBox('No agencies yet.' + (S.user.isAdmin ? ' Add one in Admin.' : ' Ask an admin to set one up.')));
  bindGo();
}

function renderVehicles(agencyId) {
  const ag = D.agency(agencyId);
  if (!ag) return go('#/inventory');
  setHeader(ag.name, 'Inventory › Agency', '#/inventory');
  const vs = D.vehiclesOf(ag.id);
  view().innerHTML = '<div class="section-title">Vehicles</div>' +
    (vs.length ? '<div class="list">' + vs.map((v) => {
      const bags = D.bagsOf(v.id);
      const last = bags.map((b) => D.lastCheck(b.id)).filter(Boolean).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
      const flagged = bags.some((b) => D.ropesOf(b.id).some(ropeFlagged));
      return '<button class="list-item" data-go="#/vehicle/' + encodeURIComponent(v.id) + '"><div class="main"><div class="name">' + esc(v.name) + (v.unit ? ' <span class="muted">· ' + esc(v.unit) + '</span>' : '') + '</div>' +
        '<div class="sub">' + plural(bags.length, 'bag') + ' · Last bag check: ' + esc(last ? ago(last.at) : 'Never') + '</div>' +
        '<div class="sub">Full rig check: ' + esc(D.lastRig(v.id) ? ago(D.lastRig(v.id).at) : 'Never') + '</div></div>' +
        (flagged ? '<span class="badge bad">Rope flag</span>' : '') + I.chev + '</button>';
    }).join('') + '</div>' : emptyBox('No vehicles for this agency yet.'));
  bindGo();
}

function renderBags(vehicleId) {
  const v = D.vehicle(vehicleId);
  if (!v) return go('#/inventory');
  const ag = D.agency(v.agencyId);
  setHeader(v.name, (ag ? ag.name : '') + (v.unit ? ' › ' + v.unit : ''), ag ? '#/agency/' + encodeURIComponent(ag.id) : '#/inventory');
  const bags = D.bagsOf(v.id), large = D.largeOf(v.id), comps = D.compartmentsOf(v.id);
  const rig = D.lastRig(v.id), rigDraft = LS.get('draft.rig.' + v.id, null);
  let rigBadge = '';
  if (rigDraft) rigBadge = '<span class="badge warn">In progress</span>';
  else if (rig && (rig.missing || rig.damaged)) rigBadge = '<span class="badge bad">' + (rig.missing ? rig.missing + ' missing' : rig.damaged + ' damaged') + '</span>';
  else if (rig && ago(rig.at).indexOf('Today') === 0) rigBadge = '<span class="badge ok">Done today</span>';
  const bagRow = (b) => {
    const last = D.lastCheck(b.id);
    const ni = D.itemsOf(b.id).length, nr = D.ropesOf(b.id).length;
    const flagged = D.ropesOf(b.id).some(ropeFlagged);
    const draft = LS.get('draft.' + b.id, null);
    let badge = '';
    if (draft) badge = '<span class="badge warn">In progress</span>';
    else if (last && (last.missing || last.damaged)) badge = '<span class="badge bad">' + (last.missing ? last.missing + ' missing' : last.damaged + ' damaged') + '</span>';
    else if (last && ago(last.at).indexOf('Today') === 0) badge = '<span class="badge ok">Done today</span>';
    return '<button class="list-item" data-go="#/check/' + encodeURIComponent(b.id) + '"><div class="main"><div class="name">' + esc(b.name) + '</div>' +
      '<div class="sub">' + (!b.compartmentId && b.compartment ? esc(b.compartment) + ' · ' : '') + plural(ni, 'item') + (nr ? ' · ' + plural(nr, 'rope') : '') + '</div>' +
      '<div class="sub">Last: ' + esc(last ? ago(last.at) + ' by ' + last.by : 'Never checked') + '</div></div>' +
      (flagged ? '<span class="badge bad">Rope flag</span>' : badge) + I.chev + '</button>';
  };
  const groups = compGroups(v.id).filter((g) => g.bags.length);
  view().innerHTML = (v.notes ? '<div class="card small muted" style="margin-bottom:10px">' + esc(v.notes) + '</div>' : '') +
    '<button class="rig-card" data-go="#/rig/' + encodeURIComponent(v.id) + '"><div class="t-icon">' + I.truck + '</div>' +
    '<div class="grow"><div class="t-name">Full rig check</div>' +
    '<div class="t-sub">Confirm every bag and large item is in its compartment</div>' +
    '<div class="t-sub">' + plural(comps.length, 'compartment') + ' · ' + plural(bags.length, 'bag') + ' · ' + plural(large.length, 'large item') + '</div>' +
    '<div class="t-sub">Last: ' + esc(rig ? ago(rig.at) + ' by ' + rig.by : 'Never') + '</div></div>' + rigBadge + I.chev + '</button>' +
    '<div class="section-title" style="margin-top:20px">Bag inventories <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:500">— check what\'s inside each bag</span></div>' +
    (groups.length ? groups.map((g) => (groups.length > 1 || g.id ? '<div class="comp-title">' + esc(g.name) + '</div>' : '') +
      '<div class="list">' + g.bags.map(bagRow).join('') + '</div>').join('') : emptyBox('No bags on this vehicle yet.'));
  bindGo();
}

/* ---------- Full rig check (bags + large equipment present, by compartment) ---------- */
function renderRig(vehicleId) {
  const v = D.vehicle(vehicleId);
  if (!v) return go('#/inventory');
  const ag = D.agency(v.agencyId) || {};
  const key = 'rig.' + v.id;
  const groups = compGroups(v.id).filter((g) => g.bags.length || g.large.length);
  const d = getDraft(key);
  const last = D.lastRig(v.id);
  setHeader('Full rig check', [ag.name, v.name].filter(Boolean).join(' › '), '#/vehicle/' + encodeURIComponent(v.id));
  // entries per group, in display order
  groups.forEach((g) => {
    g.entries = g.bags.map((b) => ({ key: 'B:' + b.id, kind: 'Bag', id: b.id, name: b.name, qty: 1, comp: g.id ? g.name : '' }))
      .concat(g.large.map((e) => ({ key: 'E:' + e.id, kind: 'Large equipment', id: e.id, name: e.name, qty: e.qty, notes: e.notes, comp: g.id ? g.name : '' })));
  });
  const entries = [].concat.apply([], groups.map((g) => g.entries));
  const doneN = entries.filter((e) => (d.items[e.key] || {}).status).length;
  const pct = entries.length ? Math.round(doneN / entries.length * 100) : 0;
  const row = (e) => {
    const st = d.items[e.key] || {};
    const cls = st.status === 'Present' ? 'present' : st.status === 'Damaged' ? 'damaged' : st.status === 'Missing' ? 'missing-explicit' : '';
    const icon = st.status === 'Present' ? I.check : st.status === 'Damaged' ? I.bang : st.status === 'Missing' ? I.x : '';
    return '<div class="check-item ' + cls + '">' +
      '<button class="check-hit" data-act="toggle" data-k="' + esc(e.key) + '"><span class="box">' + icon + '</span><span class="grow">' +
      '<span class="iname">' + esc(e.name) + '</span>' + (e.qty > 1 ? '<span class="qty">×' + e.qty + '</span>' : '') +
      ' <span class="kind ' + (e.kind === 'Bag' ? 'kind-bag' : 'kind-eq') + '">' + (e.kind === 'Bag' ? 'Bag' : 'Equipment') + '</span>' +
      (st.status === 'Damaged' || st.status === 'Missing' ? '<div class="inote">' + esc(st.status) + (st.notes ? ' — ' + esc(st.notes) : '') + '</div>' : st.notes ? '<div class="inote">' + esc(st.notes) + '</div>' : '') +
      (e.notes ? '<div class="sub muted small">' + esc(e.notes) + '</div>' : '') + '</span></button>' +
      '<button class="more-btn" data-act="more" data-k="' + esc(e.key) + '" aria-label="Mark missing or damaged, add note">' + I.dots + '</button></div>';
  };
  view().innerHTML =
    '<div class="inspect-time"><span>🕒</span><div class="grow"><div class="small muted">Date / time inspected (auto)</div><strong id="nowClock"></strong></div></div>' +
    '<div class="card" style="margin-top:10px"><div class="row"><div class="grow small">' +
    '<div>Is each bag and large item <b>in its compartment</b>? Bag contents are checked separately.</div>' +
    '<div><span class="muted">Last full rig check:</span> ' + esc(last ? fmtDateTime(last.at) + ' · ' + last.by : 'Never') + '</div></div>' +
    '<strong>' + pct + '%</strong></div><div class="progress"><i style="width:' + pct + '%"></i></div></div>' +
    (groups.length ? groups.map((g, gi) => {
      const gd = g.entries.filter((e) => (d.items[e.key] || {}).status).length;
      return '<div class="section-title">' + esc(g.name) + ' · ' + gd + '/' + g.entries.length + '<span class="spacer"></span><button class="btn ghost sm" data-act="allc" data-g="' + gi + '">All present</button></div>' +
        (g.notes ? '<div class="muted small" style="margin:-4px 4px 6px">' + esc(g.notes) + '</div>' : '') +
        '<div class="list">' + g.entries.map(row).join('') + '</div>';
    }).join('') : emptyBox('Nothing set up on this vehicle yet. An admin can add compartments, bags and large equipment.')) +
    '<div class="section-title">Notes</div>' +
    '<textarea class="input" id="invNotes" placeholder="Anything the next crew or an admin should know">' + esc(d.notes || '') + '</textarea>' +
    '<div class="row" style="margin-top:14px"><button class="btn sm danger" data-act="reset">Clear this check</button></div>' +
    '<div class="submit-bar"><div class="inner"><div class="grow small"><strong>' + doneN + ' of ' + entries.length + '</strong> <span class="muted">checked</span></div>' +
    '<button class="btn primary" data-act="submit"' + (entries.length ? '' : ' disabled') + '>Complete rig check</button></div></div>';

  const tick = () => { const c = $('#nowClock'); if (c) c.textContent = fmtDateTime(new Date().toISOString()); };
  tick(); S.clock = setInterval(tick, 15000);
  const rerender = () => { const y = window.scrollY; renderRig(v.id); window.scrollTo(0, y); };
  const vw = view();
  vw.onclick = async (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act, k = el.dataset.k;
    const dd = getDraft(key);
    if (act === 'toggle') {
      const cur = dd.items[k] || {};
      dd.items[k] = Object.assign({}, cur, { status: cur.status === 'Present' ? '' : 'Present' });
      putDraft(key, dd); rerender();
    } else if (act === 'more') {
      const e = entries.find((x) => x.key === k), cur = dd.items[k] || {};
      const r = await formModal(e.name, [
        { name: 'status', label: 'Status', type: 'select', options: ['Present', 'Missing', 'Damaged'], required: true },
        { name: 'notes', label: 'Note', type: 'textarea', placeholder: e.kind === 'Bag' ? 'e.g. Bag moved to Rescue 2, left at station' : 'e.g. Out for service, damaged handle' }
      ], { status: cur.status || 'Missing', notes: cur.notes || '' });
      if (r && r.values) { dd.items[k] = r.values; putDraft(key, dd); rerender(); }
    } else if (act === 'allc') {
      groups[+el.dataset.g].entries.forEach((e) => {
        const c = dd.items[e.key] || {}; if (!c.status) dd.items[e.key] = Object.assign({}, c, { status: 'Present' });
      });
      putDraft(key, dd); rerender();
    } else if (act === 'reset') {
      if (await confirmModal('Clear this check?', 'All check marks for this full rig check will be cleared.', 'Clear', true)) { LS.del('draft.' + key); rerender(); }
    } else if (act === 'submit') {
      submitRig(v, ag, entries, key);
    }
  };
  vw.oninput = (ev) => { if (ev.target.id === 'invNotes') { const dd = getDraft(key); dd.notes = ev.target.value; putDraft(key, dd); } };
}

async function submitRig(v, ag, entries, key) {
  const d = getDraft(key);
  const st = (e) => (d.items[e.key] || {}).status;
  const unchecked = entries.filter((e) => !st(e));
  const missing = entries.filter((e) => st(e) === 'Missing').length + unchecked.length;
  const damaged = entries.filter((e) => st(e) === 'Damaged').length;
  if (missing || damaged) {
    const list = unchecked.slice(0, 8).map((e) => esc(e.name)).join(', ') + (unchecked.length > 8 ? '…' : '');
    const ok = await confirmModal('Submit with problems?',
      (missing ? '<strong>' + missing + ' will be recorded as MISSING.</strong>' + (unchecked.length ? '<br><span class="small">Not checked: ' + list + '</span>' : '') + '<br>' : '') +
      (damaged ? '<strong>' + damaged + ' damaged.</strong><br>' : '') +
      '<span class="small">An alert email will go to you and your agency Lead' + (navigator.onLine ? '.' : ' once this syncs.') + '</span>', 'Submit anyway');
    if (!ok) return;
  }
  const performedAt = new Date().toISOString();
  const inv = {
    id: uid('RIG'), type: 'rig', performedAt, agencyId: ag.id || '', vehicleId: v.id, vehicleName: v.name, notes: d.notes || '',
    items: entries.map((e) => { const x = d.items[e.key] || {}; return { kind: e.kind, itemId: e.id, name: e.name, qty: e.qty, compartment: e.comp, status: x.status || 'Missing', notes: x.notes || '' }; }),
    ropes: []
  };
  S.outbox.push({ by: S.user.email, inv });
  saveOutbox();
  LS.del('draft.' + key);
  S.data.lastRigChecks = S.data.lastRigChecks || {};
  S.data.lastRigChecks[v.id] = { at: performedAt, by: S.user.name || S.user.email, missing, damaged };
  LS.set('data', S.data);
  toast((navigator.onLine ? 'Rig check saved — syncing…' : 'Saved offline — will sync when connected') + (missing || damaged ? ' Alert email will be sent.' : ''), 'good');
  go('#/vehicle/' + encodeURIComponent(v.id));
  trySync();
}

function emptyBox(msg) { return '<div class="list"><div class="empty">' + esc(msg) + '</div></div>'; }

/* ---------- Bag check-off ---------- */
function getDraft(bagId) {
  return LS.get('draft.' + bagId, null) || { items: {}, ropes: {}, notes: '' };
}
function putDraft(bagId, d) { LS.set('draft.' + bagId, d); }

function renderCheck(bagId, focusRope) {
  const bag = D.bag(bagId);
  if (!bag) return go('#/inventory');
  const veh = D.vehicle(bag.vehicleId) || {};
  const ag = D.agency(veh.agencyId) || {};
  const items = D.itemsOf(bag.id);
  const ropes = D.ropesOf(bag.id);
  const d = getDraft(bag.id);
  const last = D.lastCheck(bag.id);
  const useTypes = (S.data.settings && S.data.settings.useTypes) || ['Training', 'Rescue', 'Other'];
  setHeader(bag.name, [ag.name, veh.name].filter(Boolean).join(' › '), '#/vehicle/' + encodeURIComponent(veh.id || ''));

  const done = items.filter((i) => d.items[i.id] && d.items[i.id].status).length;
  const ropeDone = ropes.filter((r) => d.ropes[r.id] && d.ropes[r.id].damage).length;
  const total = items.length + ropes.length;
  const pct = total ? Math.round(((done + ropeDone) / total) * 100) : 0;

  const itemRow = (it) => {
    const st = (d.items[it.id] || {});
    const cls = st.status === 'Present' ? 'present' : st.status === 'Damaged' ? 'damaged' : st.status === 'Missing' ? 'missing-explicit' : '';
    const icon = st.status === 'Present' ? I.check : st.status === 'Damaged' ? I.bang : st.status === 'Missing' ? I.x : '';
    return '<div class="check-item ' + cls + '">' +
      '<button class="check-hit" data-act="toggle" data-id="' + esc(it.id) + '" aria-pressed="' + (st.status === 'Present') + '">' +
      '<span class="box">' + icon + '</span><span class="grow"><span class="iname">' + esc(it.name) + '</span>' + (it.qty > 1 ? '<span class="qty">×' + it.qty + '</span>' : '') +
      (st.status === 'Damaged' || st.status === 'Missing' ? '<div class="inote">' + esc(st.status) + (st.notes ? ' — ' + esc(st.notes) : '') + '</div>' : st.notes ? '<div class="inote">' + esc(st.notes) + '</div>' : '') +
      (it.notes ? '<div class="sub muted small">' + esc(it.notes) + '</div>' : '') + '</span></button>' +
      '<button class="more-btn" data-act="more" data-id="' + esc(it.id) + '" aria-label="Mark missing or damaged, add note">' + I.dots + '</button></div>';
  };

  const ropeCard = (r) => {
    const rd = d.ropes[r.id] || {};
    const ok = rd.damage === 'No' && (rd.used !== 'Yes' || (rd.dateUsed && rd.useType));
    return '<div class="rope-card' + (rd.damage === 'Yes' ? ' flag' : ok ? ' done' : '') + '" data-rope="' + esc(r.id) + '">' +
      '<div class="rope-head"><div class="grow"><div class="name">' + I.rope + ' ' + esc(r.label) + '</div>' +
      '<div class="muted small">' + esc([r.type, r.length, r.color].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="muted small">Uses logged: ' + r.uses + (r.lastUsed ? ' · last used ' + esc(fmtDate(r.lastUsed)) : '') + (r.inServiceDate ? ' · in service ' + esc(fmtDate(r.inServiceDate)) : '') + '</div></div>' +
      (ropeFlagged(r) ? '<span class="badge bad">' + esc(r.status) + '</span>' : '') + '</div>' +
      '<div class="rope-q"><label>Used since last inspection?</label>' + seg('used', r.id, rd.used || 'No', false) + '</div>' +
      (rd.used === 'Yes' ? '<div class="rope-sub">' +
        '<label class="field"><span>Date used *</span><input class="input" type="date" data-rin="dateUsed" data-id="' + esc(r.id) + '" value="' + esc(rd.dateUsed || '') + '" max="' + todayStr() + '"></label>' +
        '<label class="field"><span>Type of use *</span><select class="input" data-rin="useType" data-id="' + esc(r.id) + '"><option value="">Select…</option>' +
        useTypes.map((u) => '<option' + (rd.useType === u ? ' selected' : '') + '>' + esc(u) + '</option>').join('') + '</select></label></div>' : '') +
      '<div class="rope-q"><label>Damage found?</label>' + seg('damage', r.id, rd.damage || '', true) + '</div>' +
      (rd.damage === 'Yes' ? '<div class="rope-sub"><label class="field"><span>Describe the damage *</span><textarea class="input" data-rin="damageNotes" data-id="' + esc(r.id) + '" placeholder="Sheath abrasion, glazing, core shot, contamination…">' + esc(rd.damageNotes || '') + '</textarea></label><div class="hint">This rope will be flagged "Damaged - Review" for an admin.</div></div>' : '') +
      '<div class="rope-q" style="border-top:1px solid var(--line)"><span class="muted small">Inspected</span><span class="small"><strong>Auto-filled when you submit</strong></span></div>' +
      '</div>';
  };

  view().innerHTML =
    '<div class="inspect-time"><span>🕒</span><div class="grow"><div class="small muted">Date / time inspected (auto)</div><strong id="nowClock"></strong></div></div>' +
    '<div class="card" style="margin-top:10px"><div class="row"><div class="grow small">' +
    (bag.compartment ? '<div><span class="muted">Compartment:</span> ' + esc(bag.compartment) + '</div>' : '') +
    '<div><span class="muted">Last check:</span> ' + esc(last ? fmtDateTime(last.at) + ' · ' + last.by : 'Never') + '</div></div>' +
    '<strong>' + pct + '%</strong></div><div class="progress"><i style="width:' + pct + '%"></i></div>' +
    (bag.notes ? '<div class="small muted" style="margin-top:8px">' + esc(bag.notes) + '</div>' : '') + '</div>' +

    '<div class="section-title">Equipment · ' + done + '/' + items.length + '<span class="spacer"></span>' +
    (items.length ? '<button class="btn ghost sm" data-act="all">Check all</button>' : '') + '</div>' +
    (items.length ? '<div class="list">' + items.map(itemRow).join('') + '</div>' : emptyBox('No equipment listed for this bag.')) +

    (ropes.length ? '<div class="section-title">Ropes · ' + ropeDone + '/' + ropes.length + ' inspected</div>' + ropes.map(ropeCard).join('') : '') +

    '<div class="section-title">Notes</div>' +
    '<textarea class="input" id="invNotes" placeholder="Anything the next crew or an admin should know">' + esc(d.notes || '') + '</textarea>' +
    '<div class="row" style="margin-top:14px"><button class="btn sm danger" data-act="reset">Clear this check</button></div>' +

    '<div class="submit-bar"><div class="inner"><div class="grow small"><strong>' + (done + ropeDone) + ' of ' + total + '</strong> <span class="muted">checked</span></div>' +
    '<button class="btn primary" data-act="submit">Complete inventory</button></div></div>';

  const tick = () => { const c = $('#nowClock'); if (c) c.textContent = fmtDateTime(new Date().toISOString()); };
  tick(); S.clock = setInterval(tick, 15000);

  if (focusRope) {
    const el = document.querySelector('[data-rope="' + CSS.escape(focusRope) + '"]');
    if (el) { el.classList.add('scanned'); setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150); }
  }
  const rerender = () => { const y = window.scrollY; renderCheck(bag.id); window.scrollTo(0, y); };
  const v = view();
  v.onclick = async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act, id = el.dataset.id;
    const dd = getDraft(bag.id);
    if (act === 'toggle') {
      const cur = dd.items[id] || {};
      dd.items[id] = cur.status === 'Present' ? Object.assign({}, cur, { status: '' }) : Object.assign({}, cur, { status: 'Present' });
      putDraft(bag.id, dd); rerender();
    } else if (act === 'more') {
      const it = items.find((x) => x.id === id);
      const cur = dd.items[id] || {};
      const r = await formModal(it.name, [
        { name: 'status', label: 'Status', type: 'select', options: ['Present', 'Missing', 'Damaged'], required: true },
        { name: 'notes', label: 'Note', type: 'textarea', placeholder: 'e.g. Expired, cracked, only 2 of 3, sent for repair' }
      ], { status: cur.status || 'Missing', notes: cur.notes || '' }, { submit: 'Save' });
      if (r && r.values) { dd.items[id] = r.values; putDraft(bag.id, dd); rerender(); }
    } else if (act === 'all') {
      items.forEach((it) => { const c = dd.items[it.id] || {}; if (!c.status) dd.items[it.id] = Object.assign({}, c, { status: 'Present' }); });
      putDraft(bag.id, dd); rerender();
    } else if (act === 'seg') {
      const rd = dd.ropes[id] || (dd.ropes[id] = {});
      rd[el.dataset.q] = el.dataset.v;
      if (el.dataset.q === 'used' && el.dataset.v === 'Yes' && !rd.dateUsed) rd.dateUsed = todayStr();
      putDraft(bag.id, dd); rerender();
    } else if (act === 'reset') {
      if (await confirmModal('Clear this check?', 'All check marks and rope answers for this bag will be cleared.', 'Clear', true)) {
        LS.del('draft.' + bag.id); rerender();
      }
    } else if (act === 'submit') {
      submitCheck(bag, veh, ag, items, ropes);
    }
  };
  v.oninput = (e) => {
    const t = e.target;
    const dd = getDraft(bag.id);
    if (t.id === 'invNotes') { dd.notes = t.value; putDraft(bag.id, dd); return; }
    if (t.dataset.rin) {
      const rd = dd.ropes[t.dataset.id] || (dd.ropes[t.dataset.id] = {});
      rd[t.dataset.rin] = t.value;
      putDraft(bag.id, dd);
    }
  };
  v.onchange = (e) => { if (e.target.dataset.rin && e.target.tagName === 'SELECT') v.oninput(e); };
}

function seg(q, ropeId, val, colored) {
  const b = (v) => '<button type="button" data-act="seg" data-q="' + q + '" data-v="' + v + '" data-id="' + esc(ropeId) + '" class="' + (val === v ? 'on' : '') +
    (colored && v === 'Yes' ? ' yes-bad' : '') + (colored && v === 'No' ? ' no-good' : '') + '">' + v + '</button>';
  return '<div class="seg">' + b('No') + b('Yes') + '</div>';
}

async function submitCheck(bag, veh, ag, items, ropes) {
  const d = getDraft(bag.id);
  // Rope validation
  for (const r of ropes) {
    const rd = d.ropes[r.id] || {};
    if (!rd.damage) { toast('Answer "Damage found?" for ' + r.label, 'bad'); return scrollToRope(r.id); }
    if (rd.used === 'Yes' && (!rd.dateUsed || !rd.useType)) { toast('Enter date and type of use for ' + r.label, 'bad'); return scrollToRope(r.id); }
    if (rd.damage === 'Yes' && !(rd.damageNotes || '').trim()) { toast('Describe the damage on ' + r.label, 'bad'); return scrollToRope(r.id); }
  }
  const unchecked = items.filter((i) => !(d.items[i.id] && d.items[i.id].status));
  const missing = items.filter((i) => (d.items[i.id] || {}).status === 'Missing').length + unchecked.length;
  const damaged = items.filter((i) => (d.items[i.id] || {}).status === 'Damaged').length;
  if (missing || damaged) {
    const list = unchecked.slice(0, 8).map((i) => esc(i.name)).join(', ') + (unchecked.length > 8 ? '…' : '');
    const ok = await confirmModal('Submit with problems?',
      (missing ? '<strong>' + missing + ' item' + (missing === 1 ? '' : 's') + ' will be recorded as MISSING.</strong>' + (unchecked.length ? '<br><span class="small">Not checked: ' + list + '</span>' : '') + '<br>' : '') +
      (damaged ? '<strong>' + damaged + ' damaged.</strong><br>' : '') +
      '<span class="small">An alert email will go to you and your agency Lead' + (navigator.onLine ? '.' : ' once this syncs.') + '</span>', 'Submit anyway');
    if (!ok) return;
  }
  const performedAt = new Date().toISOString();
  const inv = {
    id: uid('INV'),
    performedAt,
    agencyId: ag.id || '', vehicleId: veh.id || '', bagId: bag.id,
    vehicleName: veh.name || '', bagName: bag.name,
    notes: d.notes || '',
    items: items.map((i) => {
      const st = d.items[i.id] || {};
      return { itemId: i.id, name: i.name, qty: i.qty, status: st.status || 'Missing', notes: st.notes || '' };
    }),
    ropes: ropes.map((r) => {
      const rd = d.ropes[r.id] || {};
      return { ropeId: r.id, label: r.label, used: rd.used === 'Yes' ? 'Yes' : 'No', dateUsed: rd.used === 'Yes' ? rd.dateUsed : '',
               useType: rd.used === 'Yes' ? rd.useType : '', damage: rd.damage, damageNotes: rd.damage === 'Yes' ? rd.damageNotes : '' };
    })
  };
  S.outbox.push({ by: S.user.email, inv });
  saveOutbox();
  LS.del('draft.' + bag.id);
  // Optimistic local updates so the lists reflect the check right away (also offline)
  S.data.lastChecks = S.data.lastChecks || {};
  S.data.lastChecks[bag.id] = { at: performedAt, by: S.user.name || S.user.email, missing, damaged };
  inv.ropes.forEach((rp) => {
    const r = S.data.ropes.find((x) => x.id === rp.ropeId);
    if (!r) return;
    if (rp.damage === 'Yes') r.status = 'Damaged - Review';
    if (rp.used === 'Yes') { r.uses = (r.uses || 0) + 1; if (!r.lastUsed || rp.dateUsed > r.lastUsed) r.lastUsed = rp.dateUsed; }
    r.lastInspected = performedAt;
  });
  LS.set('data', S.data);
  const off = missing || damaged || inv.ropes.some((r) => r.damage === 'Yes');
  toast((navigator.onLine ? 'Inventory saved — syncing…' : 'Saved offline — will sync when connected') + (off ? ' Alert email will be sent.' : ''), 'good');
  go('#/vehicle/' + encodeURIComponent(veh.id || ''));
  trySync();
}

function scrollToRope(id) {
  const el = document.querySelector('[data-rope="' + CSS.escape(id) + '"]');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ==================================== Admin ==================================== */
async function adminDo(action, payload, okMsg) {
  if (!navigator.onLine) { toast('Admin changes need an internet connection', 'bad'); return null; }
  try {
    const res = await api(action, payload);
    if (res.data) applyData(res.data);
    if (okMsg) toast(okMsg, 'good');
    render();
    return res;
  } catch (e) { if (!e.auth) toast(e.message, 'bad'); return null; }
}

function adminHome() {
  setHeader('Admin', 'Manage inventory setup', '#/home');
  const ags = S.data.agencies || [];
  view().innerHTML =
    '<div class="tiles" style="grid-template-columns:1fr 1fr">' +
    '<button class="tile" data-go="#/admin/users" style="padding:14px"><div><div class="t-name" style="font-size:17px">Users</div><div class="t-sub">Accounts &amp; passwords</div></div></button>' +
    '<button class="tile" data-go="#/admin/settings" style="padding:14px"><div><div class="t-name" style="font-size:17px">Settings</div><div class="t-sub">Signup code, lists</div></div></button>' +
    '<button class="tile" data-go="#/admin/labels" style="padding:14px;grid-column:1 / -1"><div class="t-icon">' + I.qr + '</div><div><div class="t-name" style="font-size:17px">Print barcode labels</div><div class="t-sub">For bags and ropes — scan to open their inventory</div></div></button>' +
    '</div>' +
    '<div class="section-title">Agencies<span class="spacer"></span><button class="btn ghost sm" data-act="add">+ Add agency</button></div>' +
    (ags.length ? '<div class="list">' + ags.map((a) => '<button class="list-item" data-go="#/admin/agency/' + encodeURIComponent(a.id) + '"><div class="main"><div class="name">' + esc(a.name) + '</div><div class="sub">' + plural(D.vehiclesOf(a.id).length, 'vehicle') + '</div></div>' + I.chev + '</button>').join('') + '</div>'
      : emptyBox('Start by adding your agency (e.g. your fire department).')) +
    '<p class="muted small" style="margin:14px 4px">Admin changes save straight to the Google Sheet and need a connection. Removing something hides it from the app but keeps its history in the sheet.</p>';
  bindGo();
  $('[data-act=add]').onclick = async () => {
    const r = await formModal('New agency', [{ name: 'Name', label: 'Agency name', required: true, placeholder: 'e.g. Springfield Fire Dept.' }]);
    if (r && r.values) adminDo('saveEntity', { type: 'agency', data: r.values }, 'Agency added');
  };
}

function adminAgency(id) {
  const a = D.agency(id);
  if (!a) return go('#/admin');
  setHeader(a.name, 'Admin › Agency', '#/admin');
  const vs = D.vehiclesOf(a.id);
  view().innerHTML =
    '<div class="card small"><strong>Alert emails go to:</strong> ' + (((S.data.leads || {})[a.id] || []).length
      ? ((S.data.leads || {})[a.id]).map(esc).join(', ')
      : '<span style="color:var(--warn);font-weight:600">No Lead set</span> — all admins get this agency\'s alerts.') +
      '<div class="muted" style="margin-top:4px">Set a Lead in the <b>Admins</b> tab of the sheet: Role = <b>Lead</b>, Agency = <b>' + esc(a.name) + '</b>. Renaming the agency? Update that column too.</div></div>' +
    '<div class="btn-row" style="margin-top:10px"><button class="btn sm" data-act="edit">Rename</button><button class="btn sm danger" data-act="remove">Remove agency</button></div>' +
    '<div class="section-title">Vehicles<span class="spacer"></span><button class="btn ghost sm" data-act="add">+ Add vehicle</button></div>' +
    (vs.length ? '<div class="list">' + vs.map((v) => '<button class="list-item" data-go="#/admin/vehicle/' + encodeURIComponent(v.id) + '"><div class="main"><div class="name">' + esc(v.name) + (v.unit ? ' <span class="muted">· ' + esc(v.unit) + '</span>' : '') + '</div><div class="sub">' + plural(D.bagsOf(v.id).length, 'bag') + '</div></div>' + I.chev + '</button>').join('') + '</div>' : emptyBox('No vehicles yet.'));
  bindGo();
  const vehicleFields = [
    { name: 'Name', label: 'Vehicle name', required: true, placeholder: 'e.g. Rescue 1, Technical Rescue Trailer' },
    { name: 'Unit', label: 'Unit / apparatus number', placeholder: 'e.g. R-51' },
    { name: 'Notes', label: 'Notes', type: 'textarea' }
  ];
  $('[data-act=add]').onclick = async () => {
    const r = await formModal('New vehicle', vehicleFields);
    if (r && r.values) adminDo('saveEntity', { type: 'vehicle', data: Object.assign({ AgencyID: a.id }, r.values) }, 'Vehicle added');
  };
  $('[data-act=edit]').onclick = async () => {
    const r = await formModal('Rename agency', [{ name: 'Name', label: 'Agency name', required: true }], { Name: a.name });
    if (r && r.values) adminDo('saveEntity', { type: 'agency', data: { id: a.id, Name: r.values.Name } }, 'Saved');
  };
  $('[data-act=remove]').onclick = async () => {
    if (await confirmModal('Remove ' + a.name + '?', 'The agency and everything under it will be hidden from the app. History stays in the sheet.', 'Remove', true))
      if (await adminDo('removeEntity', { type: 'agency', id: a.id }, 'Agency removed')) go('#/admin');
  };
}

function adminVehicle(id) {
  const v = D.vehicle(id);
  if (!v) return go('#/admin');
  const a = D.agency(v.agencyId) || {};
  setHeader(v.name, 'Admin › ' + (a.name || 'Vehicle'), '#/admin/agency/' + encodeURIComponent(a.id || ''));
  const bags = D.bagsOf(v.id), comps = D.compartmentsOf(v.id), large = D.largeOf(v.id);
  const compLabel = (x) => x.compartmentId ? esc(x.compartment) : '<span style="color:var(--warn)">No compartment</span>';
  view().innerHTML =
    '<div class="card"><dl class="kv"><dt>Unit</dt><dd>' + esc(v.unit || '—') + '</dd><dt>Notes</dt><dd>' + esc(v.notes || '—') + '</dd></dl></div>' +
    '<div class="btn-row" style="margin-top:10px"><button class="btn sm" data-act="edit">Edit vehicle</button><button class="btn sm danger" data-act="remove">Remove vehicle</button></div>' +

    '<div class="section-title">Compartments (' + comps.length + ')<span class="spacer"></span><button class="btn ghost sm" data-act="bulkComp">Bulk add</button><button class="btn ghost sm" data-act="addComp">+ Add</button></div>' +
    (comps.length ? '<div class="list">' + comps.map((c) => {
      const nb = bags.filter((b) => b.compartmentId === c.id).length, nl = large.filter((e) => e.compartmentId === c.id).length;
      return '<button class="list-item" data-comp="' + esc(c.id) + '"><div class="main"><div class="name">' + esc(c.name) + '</div><div class="sub">' + plural(nb, 'bag') + ' · ' + plural(nl, 'large item') + (c.notes ? ' · ' + esc(c.notes) : '') + '</div></div><span class="muted small">Edit</span></button>';
    }).join('') + '</div>' : emptyBox('No compartments yet. Add each storage location on the rig (e.g. D1, P2, Rear bay, Roof box), then assign bags and large equipment to them.')) +

    '<div class="section-title">Bags (' + bags.length + ')<span class="spacer"></span><button class="btn ghost sm" data-act="add">+ Add bag</button></div>' +
    (bags.length ? '<div class="list">' + bags.map((b) => '<button class="list-item" data-go="#/admin/bag/' + encodeURIComponent(b.id) + '"><div class="main"><div class="name">' + esc(b.name) + '</div><div class="sub">' + compLabel(b) + ' · ' + plural(D.itemsOf(b.id).length, 'item') + ' · ' + plural(D.ropesOf(b.id).length, 'rope') + '</div></div>' + I.chev + '</button>').join('') + '</div>' : emptyBox('No bags yet.')) +

    '<div class="section-title">Large equipment (' + large.length + ')<span class="spacer"></span><button class="btn ghost sm" data-act="bulkLarge">Bulk add</button><button class="btn ghost sm" data-act="addLarge">+ Add</button></div>' +
    '<div class="muted small" style="margin:-4px 4px 8px">Items stored on the rig outside a bag.</div>' +
    (large.length ? '<div class="list">' + large.map((e) => '<button class="list-item" data-large="' + esc(e.id) + '"><div class="main"><div class="name">' + esc(e.name) + (e.qty > 1 ? ' <span class="qty">×' + e.qty + '</span>' : '') + '</div><div class="sub">' + compLabel(e) + (e.notes ? ' · ' + esc(e.notes) : '') + '</div></div><span class="muted small">Edit</span></button>').join('') + '</div>'
      : emptyBox('Items stored loose on the rig — e.g. Stokes basket, tripod, generator, SKED, ladder.')) +
    '<p class="muted small" style="margin:12px 4px">Compartments, bags and large equipment make up the <b>Full rig check</b>. Bag contents are checked in each bag\'s own inventory.</p>';
  bindGo();

  const compSelect = (hint) => ({ name: 'CompartmentID', label: 'Compartment', type: 'select', options: compOpts(v.id), placeholder: '— No compartment —',
    hint: comps.length ? hint || '' : 'No compartments on this vehicle yet — add them first to organize the full rig check.' });
  const parseLines = (txt) => txt.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(.*?)[,;\t]\s*(\d+)\s*$/.exec(l);
    return m ? { Name: m[1].trim(), Qty: +m[2] } : { Name: l, Qty: 1 };
  });
  const compFields = [
    { name: 'Name', label: 'Compartment name', required: true, placeholder: 'e.g. D1, Driver side front, Rear bay, Roof box' },
    { name: 'SortOrder', label: 'Order (optional)', type: 'number', hint: 'Lower numbers come first in the full rig check. Leave blank to sort by name.' },
    { name: 'Notes', label: 'Notes', type: 'textarea' }
  ];
  const largeFields = [
    { name: 'Name', label: 'Equipment name', required: true, placeholder: 'e.g. Stokes basket, Arizona Vortex tripod' },
    { name: 'Qty', label: 'Quantity', type: 'number', default: 1 },
    compSelect(),
    { name: 'Notes', label: 'Notes', type: 'textarea', placeholder: 'Serial number, size, mounting location…' }
  ];

  $('[data-act=addComp]').onclick = async () => {
    const r = await formModal('New compartment on ' + v.name, compFields);
    if (r && r.values) adminDo('saveEntity', { type: 'compartment', data: Object.assign({ VehicleID: v.id }, r.values) }, 'Compartment added');
  };
  $('[data-act=bulkComp]').onclick = async () => {
    const r = await formModal('Bulk add compartments', [{ name: 'lines', label: 'One compartment per line, in walk-around order', type: 'textarea', required: true, placeholder: 'D1\nD2\nD3\nP1\nP2\nRear bay\nRoof box' }]);
    if (!r || !r.values) return;
    const names = r.values.lines.split('\n').map((l) => l.trim()).filter(Boolean);
    const base = comps.reduce((m, c) => Math.max(m, c.sort < 9999 ? c.sort : 0), 0);
    adminDo('bulkAdd', { kind: 'compartment', vehicleId: v.id, startOrder: base + 1, items: names.map((n) => ({ Name: n })) }, plural(names.length, 'compartment') + ' added');
  };
  $$('[data-comp]').forEach((el) => el.onclick = async () => {
    const c = comps.find((x) => x.id === el.dataset.comp);
    const r = await formModal('Edit compartment', compFields, { Name: c.name, SortOrder: c.sort < 9999 ? c.sort : '', Notes: c.notes }, { danger: 'Remove compartment' });
    if (!r) return;
    if (r.danger) {
      const n = bags.filter((b) => b.compartmentId === c.id).length + large.filter((e) => e.compartmentId === c.id).length;
      if (await confirmModal('Remove ' + c.name + '?', (n ? n + ' bag(s) / item(s) in it will show as "No compartment" until you reassign them. ' : '') + 'History stays in the sheet.', 'Remove', true))
        adminDo('removeEntity', { type: 'compartment', id: c.id }, 'Compartment removed');
    } else adminDo('saveEntity', { type: 'compartment', data: Object.assign({ id: c.id }, r.values) }, 'Saved');
  });
  $('[data-act=add]').onclick = async () => {
    const r = await formModal('New bag on ' + v.name, [
      { name: 'Name', label: 'Bag name', required: true, placeholder: 'e.g. Rope Bag A, Rigging Bag, Med Bag' },
      compSelect(), { name: 'Notes', label: 'Notes', type: 'textarea' }
    ]);
    if (r && r.values) adminDo('saveEntity', { type: 'bag', data: Object.assign({ VehicleID: v.id }, r.values) }, 'Bag added');
  };
  $('[data-act=addLarge]').onclick = async () => {
    const r = await formModal('Add large equipment to ' + v.name, largeFields);
    if (r && r.values) adminDo('saveEntity', { type: 'large', data: Object.assign({ VehicleID: v.id }, r.values) }, 'Equipment added');
  };
  $('[data-act=bulkLarge]').onclick = async () => {
    const r = await formModal('Bulk add large equipment', [
      compSelect('All items below go in this compartment.'),
      { name: 'lines', label: 'One item per line — add ", qty" for quantity', type: 'textarea', required: true, placeholder: 'Stokes basket\nBackboard, 2\nTripod\nGenerator 5kW' }
    ]);
    if (!r || !r.values) return;
    const lines = parseLines(r.values.lines);
    adminDo('bulkAdd', { kind: 'large', vehicleId: v.id, compartmentId: r.values.CompartmentID, items: lines }, plural(lines.length, 'item') + ' added');
  };
  $$('[data-large]').forEach((el) => el.onclick = async () => {
    const e = large.find((x) => x.id === el.dataset.large);
    const vehOpts = (S.data.vehicles || []).map((x) => { const aa = D.agency(x.agencyId); return { value: x.id, label: (aa ? aa.name + ' › ' : '') + x.name }; });
    const r = await formModal('Edit large equipment', largeFields.concat([{ name: 'VehicleID', label: 'Vehicle (move item)', type: 'select', options: vehOpts, required: true, hint: 'Moving to another vehicle clears the compartment — set it again there.' }]),
      { Name: e.name, Qty: e.qty, CompartmentID: e.compartmentId, Notes: e.notes, VehicleID: e.vehicleId }, { danger: 'Remove equipment' });
    if (!r) return;
    if (r.danger) {
      if (await confirmModal('Remove ' + e.name + '?', 'It will no longer appear on full rig checks. History stays in the sheet.', 'Remove', true))
        adminDo('removeEntity', { type: 'large', id: e.id }, 'Removed');
    } else adminDo('saveEntity', { type: 'large', data: Object.assign({ id: e.id }, r.values) }, 'Saved');
  });
  $('[data-act=edit]').onclick = async () => {
    const agencyOpts = (S.data.agencies || []).map((x) => ({ value: x.id, label: x.name }));
    const r = await formModal('Edit vehicle', [
      { name: 'Name', label: 'Vehicle name', required: true }, { name: 'Unit', label: 'Unit / apparatus number' },
      { name: 'AgencyID', label: 'Agency', type: 'select', options: agencyOpts, required: true }, { name: 'Notes', label: 'Notes', type: 'textarea' }
    ], { Name: v.name, Unit: v.unit, AgencyID: v.agencyId, Notes: v.notes });
    if (r && r.values) adminDo('saveEntity', { type: 'vehicle', data: Object.assign({ id: v.id }, r.values) }, 'Saved');
  };
  $('[data-act=remove]').onclick = async () => {
    if (await confirmModal('Remove ' + v.name + '?', 'The vehicle, its compartments, bags and equipment will be hidden from the app. History stays in the sheet.', 'Remove', true))
      if (await adminDo('removeEntity', { type: 'vehicle', id: v.id }, 'Vehicle removed')) go('#/admin/agency/' + encodeURIComponent(a.id || ''));
  };
}

function ropeFields(r, isNew) {
  const types = ((S.data.settings || {}).ropeTypes || []).slice();
  if (r && r.type && types.indexOf(r.type) < 0) types.push(r.type);
  const f = [
    { name: 'Label', label: 'Rope ID / label', required: true, placeholder: 'e.g. R1-200-BLU or "Main line #1"' },
    { name: 'Type', label: 'Rope type', type: 'select', options: types, placeholder: 'Select…' },
    { name: 'Length', label: 'Length', placeholder: 'e.g. 200 ft' },
    { name: 'Color', label: 'Color', placeholder: 'e.g. Blue / white' },
    { name: 'Manufacturer', label: 'Manufacturer / model' },
    { name: 'MfgDate', label: 'Manufacture date', type: 'date' },
    { name: 'InServiceDate', label: 'In-service date', type: 'date', default: isNew ? todayStr() : '' }
  ];
  if (!isNew) f.push({ name: 'Status', label: 'Status', type: 'select', options: ['In Service', 'Damaged - Review', 'Out of Service'] });
  return f;
}
const ropeVals = (r) => ({ Label: r.label, Type: r.type, Length: r.length, Color: r.color, Manufacturer: r.manufacturer, MfgDate: r.mfgDate, InServiceDate: r.inServiceDate, Status: r.status });

function adminBag(id) {
  const b = D.bag(id);
  if (!b) return go('#/admin');
  const v = D.vehicle(b.vehicleId) || {};
  setHeader(b.name, 'Admin › ' + (v.name || 'Bag'), '#/admin/vehicle/' + encodeURIComponent(v.id || ''));
  const items = D.itemsOf(b.id), ropes = D.ropesOf(b.id);
  view().innerHTML =
    '<div class="card"><dl class="kv"><dt>Vehicle</dt><dd>' + esc(v.name || '—') + '</dd><dt>Compartment</dt><dd>' + esc(b.compartment || '—') + '</dd><dt>Notes</dt><dd>' + esc(b.notes || '—') + '</dd></dl></div>' +
    '<div class="btn-row" style="margin-top:10px"><button class="btn sm" data-act="edit">Edit / move bag</button><button class="btn sm" data-go="#/admin/labels/bag/' + encodeURIComponent(b.id) + '">Print labels</button><button class="btn sm danger" data-act="remove">Remove bag</button></div>' +

    '<div class="section-title">Equipment (' + items.length + ')<span class="spacer"></span><button class="btn ghost sm" data-act="bulk">Bulk add</button><button class="btn ghost sm" data-act="addItem">+ Add</button></div>' +
    (items.length ? '<div class="list">' + items.map((i) => '<button class="list-item" data-item="' + esc(i.id) + '"><div class="main"><div class="name">' + esc(i.name) + (i.qty > 1 ? ' <span class="qty">×' + i.qty + '</span>' : '') + '</div>' + (i.notes ? '<div class="sub">' + esc(i.notes) + '</div>' : '') + '</div><span class="muted small">Edit</span></button>').join('') + '</div>' : emptyBox('No equipment yet. Tap + Add or Bulk add.')) +

    '<div class="section-title">Ropes (' + ropes.length + ')<span class="spacer"></span><button class="btn ghost sm" data-act="addRope">+ Add rope</button></div>' +
    (ropes.length ? '<div class="list">' + ropes.map((r) => '<button class="list-item" data-rope-admin="' + esc(r.id) + '"><div class="main"><div class="name">' + esc(r.label) + '</div><div class="sub">' + esc([r.type, r.length, r.color].filter(Boolean).join(' · ') || '—') + '</div><div class="sub">' + r.uses + ' uses' + (r.inServiceDate ? ' · in service ' + esc(fmtDate(r.inServiceDate)) : '') + '</div></div>' +
      '<span class="badge ' + (ropeFlagged(r) ? 'bad' : 'ok') + '">' + esc(r.status) + '</span></button>').join('') + '</div>' : emptyBox('No ropes in this bag.'));

  bindGo();
  const itemFields = (withMove) => {
    const f = [{ name: 'Name', label: 'Equipment name', required: true, placeholder: 'e.g. Carabiner, steel locking' },
               { name: 'Qty', label: 'Expected quantity', type: 'number', default: 1 },
               { name: 'Notes', label: 'Notes', type: 'textarea', placeholder: 'Size, serial, expiry, etc.' }];
    if (withMove) {
      const opts = (S.data.bags || []).map((x) => { const vv = D.vehicle(x.vehicleId); return { value: x.id, label: (vv ? vv.name + ' › ' : '') + x.name }; });
      f.push({ name: 'BagID', label: 'Bag', type: 'select', options: opts, required: true });
    }
    return f;
  };

  $('[data-act=addItem]').onclick = async () => {
    const r = await formModal('Add equipment to ' + b.name, itemFields(false));
    if (r && r.values) adminDo('saveEntity', { type: 'item', data: Object.assign({ BagID: b.id }, r.values) }, 'Equipment added');
  };
  $('[data-act=bulk]').onclick = async () => {
    const r = await formModal('Bulk add equipment', [{ name: 'lines', label: 'One item per line — add ", qty" for quantity', type: 'textarea', required: true, placeholder: 'Carabiner steel locking, 6\nPrusik loop 8mm, 4\nRescue 8 descender\nEdge protector, 2' }]);
    if (!r || !r.values) return;
    const lines = r.values.lines.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = /^(.*?)[,;\t]\s*(\d+)\s*$/.exec(l);
      return m ? { Name: m[1].trim(), Qty: +m[2] } : { Name: l, Qty: 1 };
    });
    adminDo('bulkAddItems', { bagId: b.id, items: lines }, plural(lines.length, 'item') + ' added');
  };
  $$('[data-item]').forEach((el) => el.onclick = async () => {
    const it = items.find((x) => x.id === el.dataset.item);
    const r = await formModal('Edit equipment', itemFields(true), { Name: it.name, Qty: it.qty, Notes: it.notes, BagID: it.bagId }, { danger: 'Remove from bag' });
    if (!r) return;
    if (r.danger) {
      if (await confirmModal('Remove ' + it.name + '?', 'It will no longer appear on inventories for this bag.', 'Remove', true))
        adminDo('removeEntity', { type: 'item', id: it.id }, 'Removed');
    } else adminDo('saveEntity', { type: 'item', data: Object.assign({ id: it.id }, r.values) }, 'Saved');
  });
  $('[data-act=addRope]').onclick = async () => {
    const r = await formModal('Add rope to ' + b.name, ropeFields(null, true));
    if (r && r.values) adminDo('saveEntity', { type: 'rope', data: Object.assign({ BagID: b.id }, r.values) }, 'Rope added');
  };
  $$('[data-rope-admin]').forEach((el) => el.onclick = async () => {
    const rope = ropes.find((x) => x.id === el.dataset.ropeAdmin);
    const choice = await actionSheet(rope.label, [
      { label: 'Edit details / status', sub: 'Change info or return a flagged rope to service', value: 'edit' },
      { label: 'Replace rope', sub: 'Retire this rope and put a new one in its place', value: 'replace' },
      { label: 'Retire rope', sub: 'Remove from service with no replacement', value: 'retire', danger: true }
    ]);
    if (choice === 'edit') {
      const r = await formModal('Edit rope', ropeFields(rope, false), ropeVals(rope));
      if (r && r.values) adminDo('saveEntity', { type: 'rope', data: Object.assign({ id: rope.id }, r.values) }, 'Rope saved');
    } else if (choice === 'replace') {
      const nf = [{ name: 'reason', label: 'Reason for replacing the old rope', type: 'textarea', required: true, placeholder: 'e.g. Core shot found on 10/12 inspection' }]
        .concat(ropeFields(null, true).map((f) => f.name === 'Label' ? Object.assign({}, f, { label: 'New rope ID / label' }) : f));
      const r = await formModal('Replace ' + rope.label, nf, { Type: rope.type, Length: rope.length, Color: rope.color }, { submit: 'Replace rope', intro: 'The old rope is marked Retired (kept in the sheet with its full log). The new rope starts with a clean log.' });
      if (r && r.values) {
        const { reason, ...rest } = r.values;
        adminDo('replaceRope', { ropeId: rope.id, reason, rope: rest }, 'Rope replaced');
      }
    } else if (choice === 'retire') {
      const r = await formModal('Retire ' + rope.label, [{ name: 'reason', label: 'Reason', type: 'textarea', required: true, placeholder: 'e.g. Reached service life, failed inspection' }], {}, { submit: 'Retire rope' });
      if (r && r.values) adminDo('removeEntity', { type: 'rope', id: rope.id, reason: r.values.reason }, 'Rope retired');
    }
  });
  $('[data-act=edit]').onclick = async () => {
    const opts = (S.data.vehicles || []).map((x) => { const aa = D.agency(x.agencyId); return { value: x.id, label: (aa ? aa.name + ' › ' : '') + x.name }; });
    const r = await formModal('Edit bag', [
      { name: 'Name', label: 'Bag name', required: true },
      { name: 'CompartmentID', label: 'Compartment', type: 'select', options: compOpts(b.vehicleId), placeholder: '— No compartment —',
        hint: D.compartmentsOf(b.vehicleId).length ? '' : 'Add compartments on the vehicle\'s admin page first.' },
      { name: 'VehicleID', label: 'Vehicle (move bag)', type: 'select', options: opts, required: true, hint: 'Moving to another vehicle clears the compartment — set it again there.' },
      { name: 'Notes', label: 'Notes', type: 'textarea' }
    ], { Name: b.name, CompartmentID: b.compartmentId, VehicleID: b.vehicleId, Notes: b.notes });
    if (r && r.values) adminDo('saveEntity', { type: 'bag', data: Object.assign({ id: b.id }, r.values) }, 'Bag saved');
  };
  $('[data-act=remove]').onclick = async () => {
    if (await confirmModal('Remove ' + b.name + '?', 'The bag and its contents will be hidden from the app. History stays in the sheet.', 'Remove', true))
      if (await adminDo('removeEntity', { type: 'bag', id: b.id }, 'Bag removed')) go('#/admin/vehicle/' + encodeURIComponent(v.id || ''));
  };
}

async function adminUsers() {
  setHeader('Users', 'Admin', '#/admin');
  view().innerHTML = '<div class="spinner"></div>';
  let users;
  try { users = (await api('listUsers')).users; } catch (e) { view().innerHTML = emptyBox(e.message); return; }
  const byLast = (a, b) => ((a.lastName || a.name || a.email) + ' ' + (a.firstName || '')).localeCompare((b.lastName || b.name || b.email) + ' ' + (b.firstName || ''));
  users.sort(byLast);
  const draw = () => {
    view().innerHTML = '<p class="muted small" style="margin:0 4px 12px">People sign up with the security code from Admin → Settings. To make someone an admin, add their email to the <b>Admins</b> tab in the Google Sheet.</p>' +
      '<div class="list">' + users.map((u, i) => '<button class="list-item" data-u="' + i + '"><div class="main"><div class="name">' + esc(u.lastName ? u.lastName + ', ' + u.firstName : (u.name || u.email)) + '</div><div class="sub">' + esc(u.email) + '</div><div class="sub">Last sign-in: ' + esc(u.lastLogin ? ago(u.lastLogin) : 'Never') + '</div></div>' +
        (u.isAdmin ? '<span class="badge brand">Admin</span>' : '') + (!u.active ? '<span class="badge bad">Disabled</span>' : '') + '</button>').join('') + '</div>';
    $$('[data-u]').forEach((el) => el.onclick = async () => {
      const u = users[+el.dataset.u];
      const c = await actionSheet(u.name || u.email, [
        { label: 'Set a new password', sub: 'Give them a temporary password', value: 'pw' },
        u.active ? { label: 'Disable account', sub: 'Signs them out and blocks access', value: 'off', danger: true } : { label: 'Re-enable account', value: 'on' }
      ]);
      if (c === 'pw') {
        const r = await formModal('New password for ' + u.email, [{ name: 'password', label: 'Temporary password', required: true, hint: 'At least 8 characters. Share it with them privately.' }], {}, { validate: (v) => v.password.length < 8 ? 'At least 8 characters.' : '' });
        if (r && r.values) { try { await api('setUserPassword', { email: u.email, password: r.values.password }); toast('Password updated', 'good'); } catch (e) { toast(e.message, 'bad'); } }
      } else if (c === 'off' || c === 'on') {
        try { users = (await api('setUserActive', { email: u.email, active: c === 'on' })).users.sort(byLast); toast(c === 'on' ? 'Account enabled' : 'Account disabled', 'good'); draw(); } catch (e) { toast(e.message, 'bad'); }
      }
    });
  };
  draw();
}

async function adminSettings() {
  setHeader('Settings', 'Admin', '#/admin');
  view().innerHTML = '<div class="spinner"></div>';
  let s;
  try { s = (await api('getSettings')).settings; } catch (e) { view().innerHTML = emptyBox(e.message); return; }
  view().innerHTML =
    '<div class="section-title">Signup security code</div>' +
    '<div class="card"><div class="row"><div class="grow"><div class="code-big">' + esc(s.signupCode || '—') + '</div><div class="muted small">Anyone creating an account must enter this.</div></div><button class="btn sm" data-act="code">Change</button></div></div>' +
    '<div class="section-title">App &amp; lists</div>' +
    '<form id="setForm" class="card">' +
    fieldHtml({ name: 'appName', label: 'App name' }, s.appName) +
    fieldHtml({ name: 'ropeTypes', label: 'Rope types (comma-separated)', type: 'textarea' }, s.ropeTypes) +
    fieldHtml({ name: 'useTypes', label: 'Rope "type of use" choices (comma-separated)', type: 'textarea' }, s.useTypes) +
    '<button class="btn primary block" type="submit">Save settings</button></form>' +
    '<div class="section-title">Alert emails</div>' +
    '<div class="card"><div class="row"><div class="grow"><strong>' + (s.alertEmails ? 'On' : 'Off') + '</strong><div class="muted small">When an inventory has missing or damaged items or a damaged rope, the inspector and that agency\'s Lead get an email.</div></div>' +
    '<button class="btn sm" data-act="alerts">' + (s.alertEmails ? 'Turn off' : 'Turn on') + '</button></div>' +
    '<button class="btn sm block" style="margin-top:10px" data-act="test">Send me a test email</button></div>' +
    '<div class="section-title">Admins &amp; Leads</div><div class="list">' + (s.admins.length ? s.admins.map((ad) =>
      '<div class="list-item"><div class="main"><div class="name">' + esc(ad.name || ad.email) + '</div><div class="sub">' + esc(ad.email) + (ad.agency ? ' · ' + esc(ad.agency) : '') + '</div></div>' +
      '<span class="badge ' + (/^lead$/i.test(ad.role) ? 'brand' : '') + '">' + esc(/^lead$/i.test(ad.role) ? 'Lead' : 'Admin') + '</span></div>').join('') : '<div class="empty">—</div>') + '</div>' +
    '<p class="muted small" style="margin:8px 4px 0">Manage these in the <b>Admins</b> tab of the sheet. <b>Role</b>: Lead or Admin. <b>Agency</b>: which agency a Lead gets alerts for (one per row; add a second row to lead another agency). Both have full admin access.</p>' +
    '<div class="section-title">Spreadsheet</div><a class="btn block" href="' + esc(s.sheetUrl) + '" target="_blank" rel="noopener">Open the Google Sheet</a>';
  $('[data-act=code]').onclick = async () => {
    const r = await formModal('Change signup code', [{ name: 'signupCode', label: 'New security code', required: true, hint: 'At least 4 characters. Existing accounts are not affected.' }], { signupCode: s.signupCode }, { validate: (v) => v.signupCode.length < 4 ? 'At least 4 characters.' : '' });
    if (r && r.values) { const res = await adminDo('saveSettings', { settings: { signupCode: r.values.signupCode } }, 'Security code updated'); }
  };
  $('[data-act=alerts]').onclick = () => adminDo('saveSettings', { settings: { alertEmails: !s.alertEmails } }, s.alertEmails ? 'Alert emails off' : 'Alert emails on');
  $('[data-act=test]').onclick = async (e) => {
    e.target.disabled = true;
    try { const r = await api('sendTestEmail'); toast('Test email sent to ' + r.sentTo, 'good'); }
    catch (err) { if (!err.auth) toast(/permission|authoriz/i.test(err.message) ? 'Email not authorized yet — run sendTestEmail once in the Apps Script editor (see README).' : err.message, 'bad'); }
    e.target.disabled = false;
  };
  $('#setForm').onsubmit = (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target).entries());
    adminDo('saveSettings', { settings: v }, 'Settings saved');
  };
}

/* =================================== Reports =================================== */
async function renderReports(tab) {
  setHeader('Reports', 'Inventory history', '#/home');
  const tabs = [['build', 'Build report'], ['inventories', 'Inventories'], ['attention', 'Needs attention'], ['ropes', 'Rope log']];
  const head = '<div class="tabs">' + tabs.map(([k, l]) => '<button data-go="#/reports/' + k + '" class="' + (k === tab ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
  if (tab === 'build') { view().innerHTML = head; bindGo(); return renderReportBuilder(); }
  view().innerHTML = head + '<div class="spinner"></div>';
  bindGo();
  let h;
  try { h = await api('history', { limit: 150 }); } catch (e) { view().innerHTML = head + emptyBox(e.message); bindGo(); return; }
  if (S.route[0] !== 'reports' || (S.route[1] || 'inventories') !== tab) return;
  let body = '';
  if (tab === 'inventories') {
    body = h.inventories.length ? h.inventories.map((r) =>
      '<div class="report-card"><div class="top"><div class="what">' + esc(r.vehicle) + ' › ' + esc(r.bag) + '</div><div class="when">' + esc(fmtDateTime(r.at)) + '</div></div>' +
      '<div class="small muted">' + esc(r.by) + ' · ' + r.present + '/' + r.total + ' present' + (r.ropes ? ' · ' + plural(r.ropes, 'rope') + ' inspected' : '') + '</div>' +
      ((r.problems.length || r.ropesDamaged) ? '<ul class="problems">' + r.problems.map((p) => '<li class="badge ' + (p.status === 'Missing' ? 'bad' : 'warn') + '">' + esc(p.status) + ': ' + esc(p.name) + (p.compartment ? ' [' + esc(p.compartment) + ']' : '') + (p.notes ? ' — ' + esc(p.notes) : '') + '</li>').join('') +
        (r.ropesDamaged ? '<li class="badge bad">' + plural(r.ropesDamaged, 'rope') + ' damaged</li>' : '') + '</ul>' : '<ul class="problems"><li class="badge ok">All present</li></ul>') +
      (r.notes ? '<div class="small" style="margin-top:6px">📝 ' + esc(r.notes) + '</div>' : '') + '</div>').join('') : emptyBox('No inventories yet.');
  } else if (tab === 'attention') {
    const flagged = (S.data.ropes || []).filter(ropeFlagged);
    const latestByBag = {};
    h.inventories.forEach((r) => { const k = r.vehicle + '›' + r.bag; if (!latestByBag[k]) latestByBag[k] = r; });
    const probs = Object.values(latestByBag).filter((r) => r.problems.length);
    body = '<div class="section-title">Flagged ropes</div>' +
      (flagged.length ? '<div class="list">' + flagged.map((r) => { const bg = D.bag(r.bagId) || {}; return '<button class="list-item" data-go="#/admin/bag/' + encodeURIComponent(r.bagId) + '"><div class="main"><div class="name">' + esc(r.label) + '</div><div class="sub">' + esc(bg.name || '') + ' · last inspected ' + esc(r.lastInspected ? ago(r.lastInspected) : '—') + '</div></div><span class="badge bad">' + esc(r.status) + '</span></button>'; }).join('') + '</div>' : emptyBox('No ropes flagged.')) +
      '<div class="section-title">Missing / damaged on the latest checks</div>' +
      (probs.length ? probs.map((r) => '<div class="report-card"><div class="top"><div class="what">' + esc(r.vehicle) + ' › ' + esc(r.bag) + '</div><div class="when">' + esc(ago(r.at)) + '</div></div><ul class="problems">' + r.problems.map((p) => '<li class="badge ' + (p.status === 'Missing' ? 'bad' : 'warn') + '">' + esc(p.status) + ': ' + esc(p.name) + (p.compartment ? ' [' + esc(p.compartment) + ']' : '') + '</li>').join('') + '</ul></div>').join('') : emptyBox('Everything accounted for on the latest checks.'));
  } else {
    body = h.ropeLogs.length ? h.ropeLogs.map((l) =>
      '<div class="report-card"><div class="top"><div class="what">' + esc(l.rope) + '</div><div class="when">' + esc(fmtDateTime(l.at)) + '</div></div>' +
      '<div class="small muted">' + esc(l.vehicle) + ' › ' + esc(l.bag) + ' · inspected by ' + esc(l.by) + '</div>' +
      '<ul class="problems">' + (l.used === 'Yes' ? '<li class="badge">Used ' + esc(fmtDate(l.dateUsed)) + ' · ' + esc(l.useType) + '</li>' : '<li class="badge">Not used</li>') +
      (l.damage === 'Yes' ? '<li class="badge bad">Damage: ' + esc(l.damageNotes) + '</li>' : '<li class="badge ok">No damage</li>') + '</ul></div>').join('') : emptyBox('No rope inspections yet.');
  }
  view().innerHTML = head + body + '<a class="btn block" style="margin-top:16px" href="' + esc(h.sheetUrl) + '" target="_blank" rel="noopener">Open full records in Google Sheets</a>';
  bindGo();
}

/* ================================ Report builder ================================ */
function renderReportBuilder() {
  const rb = S.rb || (S.rb = { scope: 'agency', agencyId: '', vehicleId: '', bagId: '' });
  const ags = S.data.agencies || [];
  if (!rb.agencyId || !D.agency(rb.agencyId)) rb.agencyId = ags[0] ? ags[0].id : '';
  const vs = D.vehiclesOf(rb.agencyId);
  if (!vs.some((v) => v.id === rb.vehicleId)) rb.vehicleId = vs[0] ? vs[0].id : '';
  const bs = D.bagsOf(rb.vehicleId);
  if (!bs.some((b) => b.id === rb.bagId)) rb.bagId = bs[0] ? bs[0].id : '';
  const opt = (list, sel, lab) => list.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(lab(x)) + '</option>').join('');
  const scopeBtn = (k, l) => '<button type="button" data-scope="' + k + '" class="' + (rb.scope === k ? 'on' : '') + '">' + l + '</button>';
  const wrap = document.createElement('div');
  wrap.className = 'rb-form no-print';
  wrap.innerHTML =
    '<div class="card">' +
    '<div class="field"><span>Report on</span><div class="seg seg-wide">' + scopeBtn('agency', 'Agency') + scopeBtn('vehicle', 'Vehicle') + scopeBtn('bag', 'Bag') + '</div>' +
    '<div class="hint">' + ({ agency: 'Every vehicle and bag in the agency.', vehicle: 'Every bag on one vehicle.', bag: 'One bag.' })[rb.scope] +
    ' Rope bags include each rope\'s history since it went into service; other bags show Good or their deficiencies.' +
    (rb.scope !== 'bag' ? ' Each vehicle also shows its latest full rig check (bags and large equipment by compartment).' : '') + '</div></div>' +
    '<label class="field"><span>Agency</span><select class="input" data-rb="agencyId">' + opt(ags, rb.agencyId, (a) => a.name) + '</select></label>' +
    (rb.scope !== 'agency' ? '<label class="field"><span>Vehicle</span><select class="input" data-rb="vehicleId">' + (vs.length ? opt(vs, rb.vehicleId, (v) => v.name + (v.unit ? ' (' + v.unit + ')' : '')) : '<option value="">No vehicles</option>') + '</select></label>' : '') +
    (rb.scope === 'bag' ? '<label class="field"><span>Bag</span><select class="input" data-rb="bagId">' + (bs.length ? opt(bs, rb.bagId, (b) => b.name + (D.ropesOf(b.id).length ? '  — rope bag' : '')) : '<option value="">No bags</option>') + '</select></label>' : '') +
    '<button class="btn primary block" data-act="gen">Generate report</button></div>';
  view().appendChild(wrap);
  const out = document.createElement('div');
  out.id = 'reportOut';
  view().appendChild(out);
  if (S.lastReport) drawReport(S.lastReport);

  wrap.onclick = async (e) => {
    const sc = e.target.closest('[data-scope]');
    if (sc) { rb.scope = sc.dataset.scope; return rerenderBuilder(); }
    if (e.target.closest('[data-act=gen]')) {
      const id = rb.scope === 'agency' ? rb.agencyId : rb.scope === 'vehicle' ? rb.vehicleId : rb.bagId;
      if (!id) return toast('Nothing to report on yet — pick a ' + rb.scope, 'bad');
      if (!navigator.onLine) return toast('Reports need an internet connection', 'bad');
      out.innerHTML = '<div class="spinner"></div>';
      try {
        const r = await api('report', { scope: rb.scope, id });
        S.lastReport = r.report;
        drawReport(r.report);
        out.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) { out.innerHTML = ''; if (!err.auth) toast(err.message, 'bad'); }
    }
  };
  wrap.onchange = (e) => {
    const k = e.target.dataset.rb;
    if (!k) return;
    rb[k] = e.target.value;
    if (k === 'agencyId') { rb.vehicleId = ''; rb.bagId = ''; }
    if (k === 'vehicleId') rb.bagId = '';
    rerenderBuilder();
  };
}
function rerenderBuilder() { const y = window.scrollY; renderReports('build'); window.scrollTo(0, y); }

function serviceAge(days) {
  if (days == null) return '';
  if (days < 0) return 'starts in ' + -days + ' days';
  if (days < 60) return days + ' day' + (days === 1 ? '' : 's');
  const y = Math.floor(days / 365.25), m = Math.floor((days - y * 365.25) / 30.44);
  return (y ? y + ' yr' + (y > 1 ? 's' : '') + ' ' : '') + (m ? m + ' mo' : '');
}

function drawReport(r) {
  const out = $('#reportOut');
  if (!out) return;
  const sm = r.summary;
  const statusBadge = (st) => '<span class="badge ' + (st === 'Good' ? 'ok' : st === 'Deficient' ? 'bad' : 'warn') + '">' + (st === 'Good' ? '✓ Good' : esc(st)) + '</span>';

  const ropeBlock = (rp) => {
    const types = Object.keys(rp.useByType).map((t) => esc(t) + ': ' + rp.useByType[t]).join(' · ');
    return '<div class="rpt-rope">' +
      '<div class="rpt-rope-head"><div><strong>' + esc(rp.label) + '</strong><div class="muted small">' + esc([rp.type, rp.length, rp.color, rp.manufacturer].filter(Boolean).join(' · ')) + '</div></div>' +
      '<span class="badge ' + (rp.status === 'In Service' ? 'ok' : 'bad') + '">' + esc(rp.status) + '</span></div>' +
      '<div class="rpt-stats">' +
      '<div><b>' + esc(rp.inServiceDate ? fmtDate(rp.inServiceDate) : '—') + '</b><span>In service' + (rp.daysInService != null ? ' · ' + esc(serviceAge(rp.daysInService)) : '') + '</span></div>' +
      '<div><b>' + rp.useCount + '</b><span>Uses since in service</span></div>' +
      '<div><b>' + rp.inspections + '</b><span>Inspections</span></div>' +
      '<div><b>' + rp.damage.length + '</b><span>Damage reports</span></div></div>' +
      (rp.mfgDate ? '<div class="small muted">Manufactured ' + esc(fmtDate(rp.mfgDate)) + '</div>' : '') +
      (types ? '<div class="small" style="margin-top:4px"><span class="muted">Use by type:</span> ' + types + '</div>' : '') +
      '<div class="small" style="margin-top:2px"><span class="muted">Last inspected:</span> ' + esc(rp.lastInspected ? fmtDateTime(rp.lastInspected) + ' · ' + rp.lastInspectedBy : 'Not yet inspected') + '</div>' +
      (rp.damage.length ? '<div class="rpt-sub">Damage reports</div><ul class="rpt-list">' + rp.damage.map((d) => '<li><span class="bad-t">' + esc(fmtDate(d.at)) + '</span> — ' + esc(d.notes || 'No description') + ' <span class="muted">(' + esc(d.by) + ')</span></li>').join('') + '</ul>' : '') +
      (rp.uses.length ? '<div class="rpt-sub">Usage history</div><table class="rpt-table"><thead><tr><th>Date used</th><th>Type of use</th><th>Logged by</th></tr></thead><tbody>' +
        rp.uses.map((u) => '<tr><td>' + esc(u.date ? fmtDate(u.date) : '—') + '</td><td>' + esc(u.type) + (u.damage ? ' <span class="bad-t">· damage</span>' : '') + '</td><td>' + esc(u.by) + '</td></tr>').join('') + '</tbody></table>'
        : '<div class="small muted" style="margin-top:6px">No uses logged since going into service.</div>') +
      '</div>';
  };

  const bagBlock = (b) =>
    '<div class="rpt-bag">' +
    '<div class="rpt-bag-head"><div><div class="rpt-bag-name">' + esc(b.name) + (b.isRopeBag ? ' <span class="badge">Rope bag</span>' : '') + '</div>' +
    '<div class="muted small">' + (b.compartment ? esc(b.compartment) + ' · ' : '') + (b.lastCheck ? 'Last inventory ' + esc(fmtDateTime(b.lastCheck.at)) + ' by ' + esc(b.lastCheck.by) + ' · ' + b.lastCheck.present + '/' + b.lastCheck.total + ' present' : 'No inventory on record') + '</div></div>' +
    statusBadge(b.status) + '</div>' +
    (b.status === 'Good' ? '<div class="ok-t small">All equipment accounted for on the last inventory.</div>' : '') +
    (b.status === 'Never checked' ? '<div class="small" style="color:var(--warn)">This bag has never been inventoried.</div>' : '') +
    (b.deficiencies.length ? '<div class="rpt-sub">Deficiencies</div><ul class="rpt-list">' + b.deficiencies.map((d) => '<li><span class="' + (d.status === 'Missing' ? 'bad-t' : 'warn-t') + '">' + esc(d.status) + '</span> — ' + esc(d.name) + (d.qty > 1 ? ' (×' + d.qty + ')' : '') + (d.notes ? ' <span class="muted">· ' + esc(d.notes) + '</span>' : '') + '</li>').join('') + '</ul>' : '') +
    (b.ropeFlags ? '<div class="small bad-t" style="margin-top:4px">' + plural(b.ropeFlags, 'rope') + ' flagged for review</div>' : '') +
    (b.lastCheck && b.lastCheck.notes ? '<div class="small" style="margin-top:4px"><span class="muted">Inventory notes:</span> ' + esc(b.lastCheck.notes) + '</div>' : '') +
    (b.ropes.length ? b.ropes.map(ropeBlock).join('') : '') +
    '</div>';

  const rigBlock = (g) => !g ? '' :
    '<div class="rpt-bag rpt-rig">' +
    '<div class="rpt-bag-head"><div><div class="rpt-bag-name">Full rig check</div>' +
    '<div class="muted small">' + plural(g.compartments, 'compartment') + ' · ' + plural(g.bags, 'bag') + ' · ' + plural(g.large.length, 'large item') + '</div>' +
    '<div class="muted small">' + (g.lastCheck ? 'Last full rig check ' + esc(fmtDateTime(g.lastCheck.at)) + ' by ' + esc(g.lastCheck.by) + ' · ' + g.lastCheck.present + '/' + g.lastCheck.total + ' present' : 'No full rig check on record') + '</div></div>' +
    statusBadge(g.status) + '</div>' +
    (g.status === 'Good' ? '<div class="ok-t small">Every bag and large item was in place on the last full rig check.</div>' : '') +
    (g.deficiencies.length ? '<div class="rpt-sub">Deficiencies</div><ul class="rpt-list">' + g.deficiencies.map((d) => '<li><span class="' + (d.status === 'Missing' ? 'bad-t' : 'warn-t') + '">' + esc(d.status) + '</span> — ' +
      '<span class="muted">' + esc(d.kind === 'Bag' ? 'Bag' : 'Equipment') + ':</span> ' + esc(d.name) + (d.qty > 1 ? ' (×' + d.qty + ')' : '') + (d.compartment ? ' <span class="muted">[' + esc(d.compartment) + ']</span>' : '') + (d.notes ? ' <span class="muted">· ' + esc(d.notes) + '</span>' : '') + '</li>').join('') + '</ul>' : '') +
    (g.lastCheck && g.lastCheck.notes ? '<div class="small" style="margin-top:4px"><span class="muted">Check notes:</span> ' + esc(g.lastCheck.notes) + '</div>' : '') +
    (g.large.length ? '<div class="rpt-sub">Large equipment on this vehicle</div><div class="small">' + g.large.map((e) => esc(e.name) + (e.qty > 1 ? ' ×' + e.qty : '') + (e.compartment ? ' <span class="muted">(' + esc(e.compartment) + ')</span>' : '')).join(' · ') + '</div>' : '') +
    '</div>';

  // group by vehicle (keeps order): vehicles with a rig section first, then any others with bags
  const groups = [];
  (r.rigs || []).forEach((g) => groups.push({ id: g.vehicleId, name: g.vehicle, unit: g.unit, rig: g, bags: [] }));
  r.bags.forEach((b) => { let g = groups.find((x) => x.id === b.vehicleId); if (!g) groups.push(g = { id: b.vehicleId, name: b.vehicle, unit: b.unit, bags: [] }); g.bags.push(b); });

  out.innerHTML =
    '<div class="rpt">' +
    '<div class="rpt-title"><div><div class="rpt-kicker">' + esc(appName()) + ' · ' + esc(r.subtitle) + '</div><h2>' + esc(r.title) + '</h2>' +
    '<div class="muted small">Generated ' + esc(fmtDateTime(r.generatedAt)) + ' by ' + esc(S.user.name || S.user.email) + '</div></div>' +
    '<button class="btn sm no-print" data-act="print">Print / Save PDF</button></div>' +
    '<div class="rpt-summary">' +
    '<div><b>' + sm.bags + '</b><span>Bags</span></div>' +
    '<div class="ok-t"><b>' + sm.good + '</b><span>Good</span></div>' +
    '<div class="bad-t"><b>' + sm.deficient + '</b><span>Deficient</span></div>' +
    '<div class="warn-t"><b>' + sm.never + '</b><span>Never checked</span></div>' +
    '<div><b>' + sm.ropes + '</b><span>Ropes</span></div>' +
    '<div class="' + (sm.ropesFlagged ? 'bad-t' : '') + '"><b>' + sm.ropesFlagged + '</b><span>Ropes flagged</span></div></div>' +
    (sm.rigs ? '<div class="rpt-rigline">Full rig checks: <b class="ok-t">' + sm.rigGood + ' good</b> · <b class="bad-t">' + sm.rigDeficient + ' deficient</b> · <b class="warn-t">' + sm.rigNever + ' never checked</b></div>' : '') +
    (groups.length ? groups.map((g) => (r.scope === 'bag' ? '' : '<h3 class="rpt-veh">' + esc(g.name) + (g.unit ? ' <span class="muted">(' + esc(g.unit) + ')</span>' : '') + '</h3>') +
      rigBlock(g.rig) + (g.bags.length ? (g.rig ? '<div class="rpt-sub" style="margin-top:14px">Bag inventories</div>' : '') + g.bags.map(bagBlock).join('') : '')).join('')
      : '<div class="empty">Nothing in this selection.</div>') +
    '</div>';
  $('[data-act=print]', out).onclick = () => window.print();
}

/* ================================ Barcode scanning ================================ */
const LABEL_ID = /\b([BR]-[A-Z0-9]{6,16})\b/i;
const labelUrl = (id) => appLink() + '#/s/' + id;

/** Opens the inventory for a scanned label. Accepts a full label URL or a bare code. */
async function resolveScan(text, opts = {}) {
  const m = LABEL_ID.exec(String(text || ''));
  if (!m) { toast('That barcode is not a ' + appName() + ' label', 'bad'); if (!opts.stay) go('#/scan'); return false; }
  const id = m[1].toUpperCase();
  const find = () => {
    if (id[0] === 'B') { const b = D.bag(id); return b ? { hash: '#/check/' + encodeURIComponent(b.id), label: b.name } : null; }
    const r = (S.data.ropes || []).find((x) => x.id === id);
    return r ? { hash: '#/check/' + encodeURIComponent(r.bagId) + '/' + encodeURIComponent(r.id), label: r.label } : null;
  };
  let hit = find();
  if (!hit && navigator.onLine) { await refreshData(true); hit = find(); }
  if (!hit) {
    toast((id[0] === 'R' ? 'Rope' : 'Bag') + ' ' + id + ' not found — it may have been retired or removed' + (navigator.onLine ? '' : ', or this phone needs to sync'), 'bad');
    if (!opts.stay) go('#/scan');
    return false;
  }
  if (navigator.vibrate) navigator.vibrate(60);
  toast('Scanned: ' + hit.label, 'good');
  location.replace(hit.hash);
  return true;
}

function renderScan() {
  setHeader('Scan label', 'Bag or rope barcode', '#/home');
  view().innerHTML =
    '<div class="scanner" id="scanner"><video id="scanVideo" playsinline muted autoplay></video><div class="scan-frame"><i></i><i></i><i></i><i></i><div class="scan-line"></div></div>' +
    '<button class="torch-btn" id="torchBtn" hidden aria-label="Flashlight">🔦</button></div>' +
    '<p class="center" id="scanStatus" style="margin:12px 0 4px">Starting camera…</p>' +
    '<p class="center muted small" style="margin:0 0 16px">Hold the label inside the frame, about 6–10 inches away.</p>' +
    '<form id="codeForm" class="card"><label class="field" style="margin-bottom:10px"><span>Or type the code printed under the barcode</span>' +
    '<input class="input" name="code" placeholder="e.g. B-1EADE131C9" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>' +
    '<button class="btn block" type="submit">Open</button></form>';
  $('#codeForm').onsubmit = (e) => { e.preventDefault(); resolveScan(e.target.elements.code.value, { stay: true }); };
  startScanner();
}

async function startScanner() {
  const status = (t, bad) => { const el = $('#scanStatus'); if (el) { el.textContent = t; el.style.color = bad ? 'var(--bad)' : ''; } };
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return status(window.isSecureContext ? 'This browser cannot use the camera. Type the code below.' : 'Camera needs the app to be opened over https://. Type the code below.', true);
  }
  let stream, stopped = false, timer = null;
  S.cleanup = () => { stopped = true; clearTimeout(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (e) {
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    return status(denied ? 'Camera permission is off. Allow camera access for this app in your phone settings, or type the code below.' : 'Could not start the camera. Type the code below.', true);
  }
  if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
  const video = $('#scanVideo');
  if (!video) { stream.getTracks().forEach((t) => t.stop()); return; }
  video.srcObject = stream;
  try { await video.play(); } catch (e) { /* iOS sometimes needs a tap; autoplay+muted usually works */ }
  status('Looking for a label…');

  // Flashlight (Android Chrome supports it; iPhone does not expose it to web apps)
  const track = stream.getVideoTracks()[0];
  try {
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.torch) {
      const tb = $('#torchBtn'); tb.hidden = false; let on = false;
      tb.onclick = async () => { on = !on; try { await track.applyConstraints({ advanced: [{ torch: on }] }); tb.classList.toggle('on', on); } catch (e) {} };
    }
  } catch (e) {}

  let detector = null;
  try { if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) {}
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let lastBad = '';
  const tick = async () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const vw = video.videoWidth, vh = video.videoHeight, sc = Math.min(1, 800 / Math.max(vw, vh));
      canvas.width = Math.round(vw * sc); canvas.height = Math.round(vh * sc);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      let txt = null;
      if (detector) { try { const r = await detector.detect(canvas); if (r.length) txt = r[0].rawValue; } catch (e) { detector = null; } }
      if (!txt && !detector) { try { txt = window.decodeQR(ctx.getImageData(0, 0, canvas.width, canvas.height)); } catch (e) {} }
      if (txt && !stopped) {
        if (LABEL_ID.test(txt)) { S.cleanup(); status('Opening…'); resolveScan(txt); return; }
        if (txt !== lastBad) { lastBad = txt; status('That barcode is not a ' + appName() + ' label.', true); }
      }
    }
    timer = setTimeout(tick, 90);
  };
  tick();
}

/* ---------------- Printable labels (admin) ---------------- */
function adminLabels(scope, id) {
  setHeader('Barcode labels', 'Admin', '#/admin');
  const L = S.labels || (S.labels = { scope: 'agency', agencyId: '', vehicleId: '', bagId: '', bags: true, ropes: true, size: 'medium' });
  if (scope === 'bag' && id && D.bag(id)) {   // deep link from a bag page
    const b = D.bag(id), v = D.vehicle(b.vehicleId) || {};
    Object.assign(L, { scope: 'bag', bagId: b.id, vehicleId: v.id, agencyId: v.agencyId });
    history.replaceState(null, '', '#/admin/labels');
  }
  const ags = S.data.agencies || [];
  if (!D.agency(L.agencyId)) L.agencyId = ags[0] ? ags[0].id : '';
  const vs = D.vehiclesOf(L.agencyId);
  if (!vs.some((v) => v.id === L.vehicleId)) L.vehicleId = vs[0] ? vs[0].id : '';
  const bs = D.bagsOf(L.vehicleId);
  if (!bs.some((b) => b.id === L.bagId)) L.bagId = bs[0] ? bs[0].id : '';

  let bags = [];
  if (L.scope === 'agency') vs.forEach((v) => { bags = bags.concat(D.bagsOf(v.id)); });
  else if (L.scope === 'vehicle') bags = D.bagsOf(L.vehicleId);
  else bags = L.bagId ? [D.bag(L.bagId)] : [];
  const labels = [];
  bags.forEach((b) => {
    const v = D.vehicle(b.vehicleId) || {}, a = D.agency(v.agencyId) || {};
    if (L.bags) labels.push({ kind: 'Bag', id: b.id, title: b.name, sub: [v.name + (v.unit ? ' (' + v.unit + ')' : ''), b.compartment].filter(Boolean).join(' · '), agency: a.name });
    if (L.ropes) D.ropesOf(b.id).forEach((r) => labels.push({ kind: 'Rope', id: r.id, title: r.label, sub: [r.type, r.length, r.color].filter(Boolean).join(' · ') || b.name, agency: (v.name || '') + ' › ' + b.name }));
  });

  const opt = (list, sel, lab) => list.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(lab(x)) + '</option>').join('');
  const segB = (k, l) => '<button type="button" data-scope="' + k + '" class="' + (L.scope === k ? 'on' : '') + '">' + l + '</button>';
  const sizeB = (k, l) => '<button type="button" data-size="' + k + '" class="' + (L.size === k ? 'on' : '') + '">' + l + '</button>';
  const link = appLink();
  const local = /^(http:\/\/)?(localhost|127\.|file:)/.test(link);
  view().innerHTML =
    '<div class="card no-print">' +
    '<div class="field"><span>Print labels for</span><div class="seg seg-wide">' + segB('agency', 'Agency') + segB('vehicle', 'Vehicle') + segB('bag', 'One bag') + '</div></div>' +
    '<label class="field"><span>Agency</span><select class="input" data-l="agencyId">' + opt(ags, L.agencyId, (a) => a.name) + '</select></label>' +
    (L.scope !== 'agency' ? '<label class="field"><span>Vehicle</span><select class="input" data-l="vehicleId">' + (vs.length ? opt(vs, L.vehicleId, (v) => v.name + (v.unit ? ' (' + v.unit + ')' : '')) : '<option>No vehicles</option>') + '</select></label>' : '') +
    (L.scope === 'bag' ? '<label class="field"><span>Bag</span><select class="input" data-l="bagId">' + (bs.length ? opt(bs, L.bagId, (b) => b.name) : '<option>No bags</option>') + '</select></label>' : '') +
    '<div class="field"><span>Include</span><label class="chk"><input type="checkbox" data-c="bags"' + (L.bags ? ' checked' : '') + '> Bag labels</label>' +
    '<label class="chk"><input type="checkbox" data-c="ropes"' + (L.ropes ? ' checked' : '') + '> Rope labels</label></div>' +
    '<div class="field"><span>Label size</span><div class="seg seg-wide">' + sizeB('small', 'Small 1¼″') + sizeB('medium', 'Medium 2″') + sizeB('large', 'Large 3″') + '</div>' +
    '<div class="hint">Small fits rope tags; medium/large for bags. Print at 100% scale (no "fit to page").</div></div>' +
    '<button class="btn primary block" data-act="print"' + (labels.length ? '' : ' disabled') + '>Print ' + plural(labels.length, 'label') + '</button>' +
    (local ? '<div class="error-box" style="margin:12px 0 0">You are on a test address (' + esc(link) + '). Print labels from the real hosted app, or set SHARE_URL in config.js, so phone cameras open the right link.</div>' : '') +
    '<p class="muted small" style="margin:10px 0 0">Tip: use weatherproof label stock or laminate; for ropes, attach to the bag tag or a rope tag, not the rope itself.</p></div>' +
    '<div class="section-title no-print">Preview</div>' +
    '<div class="label-sheet size-' + L.size + '">' + (labels.length ? labels.map((l) =>
      '<div class="label"><div class="label-qr">' + window.makeQR(labelUrl(l.id)) + '</div><div class="label-text">' +
      '<div class="label-kind">' + esc(l.kind) + ' · ' + esc(appName()) + '</div><div class="label-title">' + esc(l.title) + '</div>' +
      '<div class="label-sub">' + esc(l.sub) + '</div>' + (l.agency ? '<div class="label-sub">' + esc(l.agency) + '</div>' : '') +
      '<div class="label-code">' + esc(l.id) + '</div></div></div>').join('') : '<div class="empty no-print">Nothing to print for this selection.</div>') + '</div>';

  view().onclick = (e) => {
    const sc = e.target.closest('[data-scope]'); if (sc) { L.scope = sc.dataset.scope; return redraw(); }
    const sz = e.target.closest('[data-size]'); if (sz) { L.size = sz.dataset.size; return redraw(); }
    if (e.target.closest('[data-act=print]')) window.print();
  };
  view().onchange = (e) => {
    const k = e.target.dataset.l, c = e.target.dataset.c;
    if (k) { L[k] = e.target.value; if (k === 'agencyId') { L.vehicleId = ''; L.bagId = ''; } if (k === 'vehicleId') L.bagId = ''; }
    if (c) L[c] = e.target.checked;
    if (k || c) redraw();
  };
  function redraw() { const y = window.scrollY; adminLabels(); window.scrollTo(0, y); }
}

/* ================================== Share app ================================== */
function appLink() {
  const cfg = (window.APP_CONFIG || {}).SHARE_URL;
  if (cfg && cfg.indexOf('http') === 0) return cfg;
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

function renderShare() {
  setHeader('Share app', 'Scan to install', '#/home');
  const link = appLink();
  let qr = '';
  try { qr = window.makeQR(link); } catch (e) { qr = '<p class="muted">QR code unavailable.</p>'; }
  const step = (n, html) => '<li><span class="step-n">' + n + '</span><span>' + html + '</span></li>';
  view().innerHTML =
    '<div class="card center qr-card">' +
    '<div class="qr-box">' + qr + '</div>' +
    '<div class="qr-name">' + esc(appName()) + '</div>' +
    '<div class="qr-link">' + esc(link) + '</div>' +
    '<div class="btn-row" style="justify-content:center;margin-top:12px">' +
    (navigator.share ? '<button class="btn primary sm" data-act="share">' + I.share + ' Share link</button>' : '') +
    '<button class="btn sm" data-act="copy">Copy link</button></div>' +
    '<p class="muted small" style="margin:12px 0 0">Point a phone camera at the code, then tap the link that pops up.</p></div>' +

    '<div class="section-title">Then add it to the home screen</div>' +
    '<div class="tabs" role="tablist"><button data-os="ios" class="on">iPhone / iPad</button><button data-os="android">Android</button></div>' +
    '<div class="card" id="os-ios"><ol class="steps">' +
    step(1, 'Open the link in <b>Safari</b>. (Home-screen install only works from Safari on iPhone.)') +
    step(2, 'Tap the <b>Share</b> button — the square with an arrow pointing up, at the bottom of the screen (top on iPad).') +
    step(3, 'Scroll down and tap <b>Add to Home Screen</b>.') +
    step(4, 'Tap <b>Add</b> in the top-right corner. The Inventory icon appears on your home screen.') +
    step(5, 'Open it from the home screen and create your account with your <b>agency email</b> and the security code from your admin.') +
    '</ol></div>' +
    '<div class="card" id="os-android" hidden><ol class="steps">' +
    step(1, 'Open the link in <b>Chrome</b>.') +
    step(2, 'Tap the <b>⋮</b> menu in the top-right corner.') +
    step(3, 'Tap <b>Add to Home screen</b> (some phones say <b>Install app</b>).') +
    step(4, 'Tap <b>Install</b> / <b>Add</b> to confirm. The Inventory icon appears on your home screen.') +
    step(5, 'Open it from the home screen and create your account with your <b>agency email</b> and the security code from your admin.') +
    '</ol></div>' +
    '<div class="card small muted" style="margin-top:12px"><strong style="color:var(--ink)">Works offline after first sign-in.</strong> Sign in once with a connection; after that you can run inventories with no signal and they upload automatically later.</div>' +
    '<p class="muted small" style="margin:12px 4px">The security code is not shown here on purpose — share it separately with people who should have access.</p>';
  if (/android/i.test(navigator.userAgent)) switchOs('android');
  view().onclick = async (e) => {
    const os = e.target.closest('[data-os]');
    if (os) return switchOs(os.dataset.os);
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'copy') {
      try { await navigator.clipboard.writeText(link); toast('Link copied', 'good'); }
      catch (err) { toast(link); }
    } else if (a.dataset.act === 'share') {
      try { await navigator.share({ title: appName(), text: 'Rescue inventory app — open this link, then add it to your home screen.', url: link }); } catch (err) { /* cancelled */ }
    }
  };
}

function switchOs(os) {
  $$('[data-os]').forEach((b) => b.classList.toggle('on', b.dataset.os === os));
  $('#os-ios').hidden = os !== 'ios';
  $('#os-android').hidden = os !== 'android';
}

/* =================================== Account =================================== */
function renderAccount() {
  setHeader('My account', '', '#/home');
  const pending = S.outbox.filter((x) => x.by === S.user.email).length;
  view().innerHTML =
    '<div class="card"><dl class="kv"><dt>Name</dt><dd>' + esc(S.user.name) + '</dd><dt>Email</dt><dd>' + esc(S.user.email) + '</dd><dt>Role</dt><dd>' + (S.user.isAdmin ? 'Admin' : 'Member') + '</dd>' +
    '<dt>Waiting to sync</dt><dd>' + pending + '</dd><dt>Data updated</dt><dd>' + esc(S.lastSync ? fmtDateTime(S.lastSync) : '—') + '</dd></dl></div>' +
    '<div class="stack" style="margin-top:14px">' +
    '<button class="btn block" data-act="sync">Sync &amp; refresh now</button>' +
    '<button class="btn block" data-act="pw">Change password</button>' +
    '<button class="btn block danger" data-act="logout">Sign out</button></div>' +
    '<div class="card small muted" style="margin-top:18px"><strong style="color:var(--ink)">Offline use</strong><br>Once you have signed in and loaded data, you can run inventories with no signal. Checks are saved on this device and upload automatically when you reconnect. ' +
    'To install it or help someone else install it, use <a href="#/share">Share app</a>.</div>' +
    '<p class="center muted small">Version ' + APP_VERSION + '</p>';
  $('[data-act=sync]').onclick = () => trySync(true);
  $('[data-act=pw]').onclick = async () => {
    const r = await formModal('Change password', [
      { name: 'oldPassword', label: 'Current password', type: 'password', required: true, autocomplete: 'current-password' },
      { name: 'newPassword', label: 'New password', type: 'password', required: true, autocomplete: 'new-password', hint: 'At least 8 characters' }
    ], {}, { validate: (v) => v.newPassword.length < 8 ? 'New password must be at least 8 characters.' : '' });
    if (!r || !r.values) return;
    try { await api('changePassword', r.values); toast('Password changed', 'good'); } catch (e) { if (!e.auth) toast(e.message, 'bad'); }
  };
  $('[data-act=logout]').onclick = async () => {
    const msg = pending ? '<strong>' + invCount(pending) + ' have not synced yet.</strong> They stay on this device and upload next time you sign in here.' : 'You will need a connection to sign back in.';
    if (!(await confirmModal('Sign out?', msg, 'Sign out', true))) return;
    try { if (navigator.onLine) await api('logout', {}, { timeout: 8000 }); } catch (e) { /* ignore */ }
    S.token = null; S.data = null; S.user = null;
    LS.del('token'); LS.del('data'); LS.del('user');
    location.hash = '#/login';
    render();
  };
}

/* ==================================== Boot ==================================== */
function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.addEventListener('hashchange', render);
  window.addEventListener('online', () => { updatePill(); trySync(); refreshData(true); });
  window.addEventListener('offline', updatePill);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) trySync(); });
  $('#syncPill').addEventListener('click', () => trySync(true));
  render();
  if (S.token) { trySync(); refreshData(true); }
  setInterval(() => trySync(), 60000);
}

boot();
