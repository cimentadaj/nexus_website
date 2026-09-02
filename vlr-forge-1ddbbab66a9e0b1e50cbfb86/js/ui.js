/* ui.js — shared UI helpers: icons, formatting, modals, toasts, menus, drawers */

/* ---------- escaping & ids ---------- */
export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let _uid = 0;
export const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}${(++_uid).toString(36)}`;

/* ---------- icons (lucide UMD, vendored) ---------- */
export const icon = (name, cls = '') => `<i data-lucide="${name}" class="icon ${cls}"></i>`;
export function refreshIcons(root = document) {
  if (!window.lucide) return;
  window.lucide.createIcons({ icons: window.lucide.icons, nameAttr: 'data-lucide' });
}

/* ---------- formatting ---------- */
export const pad2 = (n) => String(n).padStart(2, '0');
export function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
export function fmtTimeShort(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
export const fmtDateTime = (ts) => (ts == null ? '—' : `${fmtDate(ts)} ${fmtTime(ts)}`);
/** Two-line timestamp cell used in tables (date on top, time below). */
export const dateTimeCell = (ts) => `<div class="mono" style="line-height:1.35">${fmtDate(ts)}<br>${fmtTime(ts)}</div>`;
export function fmtLongDate(ts) {
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function relTime(ts) {
  if (ts == null || Number.isNaN(Number(ts))) return '—';
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);
  return `${mo} month${mo === 1 ? '' : 's'} ago`;
}
export function relTimeShort(ts) {
  if (ts == null || Number.isNaN(Number(ts))) return '—';
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
export function fmtDuration(ms) {
  if (ms == null) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${pad2(h)}h ${pad2(m % 60)}m`;
  return `${pad2(m)}m ${pad2(s % 60)}s`;
}
export function fmtCost(n, opts = {}) {
  if (n == null) return '—';
  const v = Number(n);
  if (opts.compact && v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(v < 10 ? 2 : 2)}`;
}
export const fmtPct = (n, digits = 0) => `${Number(n).toFixed(digits)}%`;
export const fmtNumber = (n) => Number(n).toLocaleString('en-US');
export function fmtBytes(kb) {
  if (kb == null) return '—';
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
export const titleCase = (s) => String(s).split(/[\s_-]+/).map(capitalize).join(' ');
export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

/* ---------- SDG helpers ---------- */
export const SDG_COLORS = {
  1: '#e5243b', 2: '#dda63a', 3: '#4c9f38', 4: '#c5192d', 5: '#ff3a21', 6: '#26bde2', 7: '#fcc30b', 8: '#a21942', 9: '#fd6925',
  10: '#dd1367', 11: '#fd9d24', 12: '#bf8b2e', 13: '#3f7e44', 14: '#0a97d9', 15: '#56c02b', 16: '#00689d', 17: '#19486a',
};
export const SDG_TITLES = {
  1: 'No Poverty', 2: 'Zero Hunger', 3: 'Good Health and Well-being', 4: 'Quality Education', 5: 'Gender Equality',
  6: 'Clean Water and Sanitation', 7: 'Affordable and Clean Energy', 8: 'Decent Work and Economic Growth',
  9: 'Industry, Innovation and Infrastructure', 10: 'Reduced Inequalities', 11: 'Sustainable Cities and Communities',
  12: 'Responsible Consumption and Production', 13: 'Climate Action', 14: 'Life Below Water', 15: 'Life on Land',
  16: 'Peace, Justice and Strong Institutions', 17: 'Partnerships for the Goals',
};
export function sdgChip(n, { muted = false, large = false, title = true } = {}) {
  const bg = muted ? '' : `style="background:${SDG_COLORS[n]}"`;
  return `<span class="sdg-chip ${muted ? 'muted' : ''} ${large ? 'sdg-chip-lg' : ''}" ${bg} ${title ? `data-tip="SDG ${n}: ${esc(SDG_TITLES[n])}"` : ''}>${n}</span>`;
}
export function sdgChips(list, { max = 6, muted = false } = {}) {
  const sorted = [...list].sort((a, b) => a - b);
  const shown = sorted.slice(0, max);
  const more = sorted.length - shown.length;
  return `<div class="sdg-chips">${shown.map(n => sdgChip(n, { muted })).join('')}${more > 0 ? `<span class="sdg-chip more" data-tip="${esc(sorted.slice(max).map(n => 'SDG ' + n).join(', '))}">+${more}</span>` : ''}</div>`;
}

/* ---------- file type icon ---------- */
export function fileExt(name) { return (String(name).split('.').pop() || '').toLowerCase(); }
export function fileTypeIcon(name) {
  const ext = fileExt(name);
  const icons = { pdf: 'file-text', xlsx: 'table', xls: 'table', csv: 'table-2', docx: 'file-type', doc: 'file-type', xml: 'file-code', json: 'braces', yaml: 'file-code', yml: 'file-code', md: 'file-text', txt: 'file-text', pptx: 'presentation' };
  const cls = ['xlsx', 'xls'].includes(ext) ? 'xlsx' : ext;
  return `<span class="ftype ftype-${cls}" data-ext="${esc(ext.toUpperCase())}" title="${esc(ext.toUpperCase())}">${icon(icons[ext] || 'file', 'icon')}</span>`;
}
export function docTypeFromName(name) {
  const n = name.toLowerCase();
  const ext = fileExt(name);
  if (/(minutes|acta|assembly|workshop|consult)/.test(n)) return 'Minutes';
  if (/(survey|encuesta|feedback)/.test(n)) return 'Survey';
  if (/(budget|presupuesto)/.test(n)) return 'Budget';
  if (/(policy|policies|brief|strategy|estrategia)/.test(n)) return 'Policy';
  if (/(plan)/.test(n)) return 'Plan';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'Data Sheet';
  if (['xml', 'json', 'yaml', 'yml'].includes(ext)) return 'Legacy Data';
  return 'Documentary';
}

/* ---------- generic status badge ---------- */
const STATUS_MAP = {
  active: ['success', 'Active'], archived: ['neutral', 'Archived'], provisioning: ['warning', 'Provisioning'],
  processed: ['success', 'Processed', true], parsing: ['running', 'Parsing', true], uploaded: ['danger', 'Uploaded', false, 'clock'],
  translating: ['running', 'Translating', true], failed: ['danger', 'Failed'], queued: ['neutral', 'Queued'],
  running: ['running', 'Running', true], success: ['success', 'Success'], cancelled: ['neutral', 'Cancelled'],
  extracted: ['info', 'Indicator Extracted'], approved: ['success', 'Approved'], rejected: ['danger', 'Rejected'],
  rerun_queued: ['warning', 'Rerun Queued'], manual: ['sky', 'Added Manually'],
  open: ['info', 'Open'], resolved: ['success', 'Resolved'], pending: ['warning', 'Pending'],
  ready: ['success', 'Ready'], generating: ['running', 'Generating', true],
};
export function statusBadge(status, { label, dot, cls = '' } = {}) {
  const m = STATUS_MAP[status] || ['neutral', titleCase(status)];
  const useDot = dot ?? m[2];
  const pre = m[3] ? icon(m[3], 'icon-xs') : '';
  return `<span class="badge badge-${m[0]} ${useDot ? 'badge-dot' : ''} ${cls}">${pre}${esc(label ?? m[1])}</span>`;
}

/* ---------- progress ---------- */
export const progressHtml = (pct, cls = '') => `<div class="progress ${cls}"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></div>`;

/* ---------- avatar ---------- */
export function avatarHtml(user, cls = '') {
  const name = user?.name || 'Guest';
  return `<span class="avatar ${cls}" title="${esc(name)}">${esc(initials(name))}</span>`;
}

/* ---------- event delegation ---------- */
/**
 * bindActions(root, { actionName: (el, ev) => {} })
 * Elements declare data-action="actionName" (+ any data-* payload).
 */
export function bindActions(root, handlers, evt = 'click') {
  const listener = (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const fn = handlers[el.dataset.action];
    if (fn) { fn(el, ev); }
  };
  root.addEventListener(evt, listener);
  return () => root.removeEventListener(evt, listener);
}

/* ---------- focus preservation across re-render ---------- */
export function preserveFocus(fn) {
  const a = document.activeElement;
  let key = null, sel = null, scroll = { x: window.scrollX, y: window.scrollY };
  if (a && a !== document.body && (a.id || a.dataset?.key || a.name)) {
    key = a.id ? `#${CSS.escape(a.id)}` : a.dataset?.key ? `[data-key="${CSS.escape(a.dataset.key)}"]` : `[name="${CSS.escape(a.name)}"]`;
    if ('selectionStart' in a) { try { sel = [a.selectionStart, a.selectionEnd]; } catch { /* ignore */ } }
  }
  fn();
  if (key) {
    const el = document.querySelector(key);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel && 'setSelectionRange' in el) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* ignore */ } }
    }
  }
  window.scrollTo(scroll.x, scroll.y);
}

/* ---------- toasts ---------- */
export function toast({ title, msg = '', type = 'info', timeout = 4200 } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const icons = { info: 'info', success: 'check-circle-2', error: 'alert-circle', warning: 'alert-triangle' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(icons[type] || 'info')}<div class="grow"><div class="toast-title">${esc(title)}</div>${msg ? `<div class="toast-msg">${esc(msg)}</div>` : ''}</div><button class="close" aria-label="Dismiss">${icon('x', 'icon-sm')}</button>`;
  // collapse identical titles, cap the stack at 4 (oldest removed)
  [...root.children].filter(x => x.querySelector('.toast-title')?.textContent === title).forEach(x => x.remove());
  while (root.children.length >= 4) root.firstElementChild.remove();
  root.appendChild(el);
  refreshIcons(el);
  const remove = () => { el.style.opacity = '0'; el.style.transition = 'opacity .2s'; setTimeout(() => el.remove(), 200); };
  el.querySelector('.close').addEventListener('click', remove);
  if (timeout) setTimeout(remove, timeout);
  return remove;
}
toast.success = (title, msg) => toast({ title, msg, type: 'success' });
toast.error = (title, msg) => toast({ title, msg, type: 'error' });
toast.info = (title, msg) => toast({ title, msg, type: 'info' });
toast.warning = (title, msg) => toast({ title, msg, type: 'warning' });

/* ---------- modals ---------- */
let modalStack = [];
/**
 * openModal({ title, sub, body, footer, size: 'sm'|'lg', onMount(modalEl, api), closable })
 * body/footer are HTML strings. Returns api { el, close, setBody, setFooter }.
 */
export function openModal({ title = '', sub = '', body = '', footer = '', size = '', onMount, onClose, closable = true, backdropClose = true, cls = '' } = {}) {
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${size ? 'modal-' + size : ''} ${cls}" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div><div class="modal-title">${title}</div>${sub ? `<div class="modal-sub">${sub}</div>` : ''}</div>
        ${closable ? `<button class="btn-icon modal-close" aria-label="Close">${icon('x')}</button>` : ''}
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    </div>`;
  root.appendChild(backdrop);
  const el = backdrop.querySelector('.modal');
  const api = {
    el,
    backdrop,
    close() {
      if (!backdrop.isConnected) return;
      backdrop.remove();
      modalStack = modalStack.filter(m => m !== api);
      document.removeEventListener('keydown', onKey);
      onClose?.();
    },
    setBody(html) { el.querySelector('.modal-body').innerHTML = html; refreshIcons(el); },
    setFooter(html) {
      let f = el.querySelector('.modal-footer');
      if (!f) { f = document.createElement('div'); f.className = 'modal-footer'; el.appendChild(f); }
      f.innerHTML = html; refreshIcons(el);
    },
    setTitle(t, s) {
      el.querySelector('.modal-title').innerHTML = t;
      const subEl = el.querySelector('.modal-sub');
      if (subEl) subEl.innerHTML = s ?? '';
    },
  };
  const onKey = (e) => { if (e.key === 'Escape' && closable && modalStack[modalStack.length - 1] === api) api.close(); };
  document.addEventListener('keydown', onKey);
  if (closable) {
    el.querySelector('.modal-close')?.addEventListener('click', api.close);
    if (backdropClose) backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) api.close(); });
  }
  modalStack.push(api);
  refreshIcons(el);
  onMount?.(el, api);
  // autofocus first input
  setTimeout(() => el.querySelector('[autofocus], input:not([type=hidden]), select, textarea, button.btn-primary')?.focus(), 30);
  return api;
}
export function closeAllModals() { [...modalStack].forEach(m => m.close()); }

export function confirmDialog({ title = 'Are you sure?', msg = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false, icon: ic } = {}) {
  return new Promise((resolve) => {
    const api = openModal({
      title, size: 'sm',
      body: `<div class="row" style="align-items:flex-start;gap:14px">${ic ? icon(ic, `icon-lg ${danger ? 'danger-text' : 'navy'}`) : ''}<p style="color:var(--text-secondary);line-height:1.55">${msg}</p></div>`,
      footer: `<button class="btn btn-light" data-role="cancel">${esc(cancelText)}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-role="ok">${esc(confirmText)}</button>`,
      onClose: () => resolve(false),
      onMount(el) {
        el.querySelector('[data-role=cancel]').onclick = () => { api.close(); };
        el.querySelector('[data-role=ok]').onclick = () => { resolve(true); api.close(); };
      },
    });
  });
}

export function promptDialog({ title, msg = '', label = 'Value', placeholder = '', value = '', confirmText = 'Save', multiline = false } = {}) {
  return new Promise((resolve) => {
    const api = openModal({
      title, size: 'sm',
      body: `${msg ? `<p class="muted">${msg}</p>` : ''}<div class="field"><label class="label">${esc(label)}</label>${multiline ? `<textarea class="textarea" id="prompt-input" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="input" id="prompt-input" value="${esc(value)}" placeholder="${esc(placeholder)}">`}</div>`,
      footer: `<button class="btn btn-light" data-role="cancel">Cancel</button><button class="btn btn-primary" data-role="ok">${esc(confirmText)}</button>`,
      onClose: () => resolve(null),
      onMount(el) {
        const input = el.querySelector('#prompt-input');
        el.querySelector('[data-role=cancel]').onclick = () => { api.close(); };
        el.querySelector('[data-role=ok]').onclick = () => { resolve(input.value); api.close(); };
        if (!multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { resolve(input.value); api.close(); } });
      },
    });
  });
}

/* ---------- drawer ---------- */
let currentDrawer = null;
export function openDrawer({ title = '', sub = '', body = '', footer = '', onMount, onClose, width } = {}) {
  closeDrawer();
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  const drawer = document.createElement('div');
  drawer.className = 'drawer';
  if (width) drawer.style.width = width;
  drawer.innerHTML = `
    <div class="drawer-header">
      <div><div class="modal-title">${title}</div>${sub ? `<div class="modal-sub">${sub}</div>` : ''}</div>
      <button class="btn-icon drawer-close" aria-label="Close">${icon('x')}</button>
    </div>
    <div class="drawer-body">${body}</div>
    <div class="drawer-footer ${footer ? '' : 'hidden'}">${footer}</div>`;
  root.appendChild(backdrop);
  root.appendChild(drawer);
  const api = {
    el: drawer,
    close() { if (!drawer.isConnected) return; backdrop.remove(); drawer.remove(); document.removeEventListener('keydown', onKey); if (currentDrawer === api) currentDrawer = null; onClose?.(); },
    setBody(html) { drawer.querySelector('.drawer-body').innerHTML = html; refreshIcons(drawer); },
    setFooter(html) { const f = drawer.querySelector('.drawer-footer'); if (f) { f.innerHTML = html; f.classList.toggle('hidden', !html); refreshIcons(f); } },
  };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('#modal-root .modal-backdrop')) api.close(); };
  document.addEventListener('keydown', onKey);
  drawer.querySelector('.drawer-close').addEventListener('click', api.close);
  backdrop.addEventListener('click', api.close);
  refreshIcons(drawer);
  onMount?.(drawer, api);
  currentDrawer = api;
  return api;
}
export function closeDrawer() { currentDrawer?.close(); }

/* ---------- dropdown menu ---------- */
let currentMenu = null;
/**
 * openMenu(anchorEl, items, { align: 'left'|'right' })
 * items: { label, icon, onClick, danger, active, sub } | 'divider' | { header: 'Label' }
 */
export function openMenu(anchor, items, { align = 'right', minWidth } = {}) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  if (minWidth) menu.style.minWidth = minWidth;
  menu.innerHTML = items.map((it, i) => {
    if (it === 'divider') return '<div class="menu-divider"></div>';
    if (it.header) return `<div class="menu-label">${esc(it.header)}</div>`;
    return `<button class="menu-item ${it.danger ? 'danger' : ''} ${it.active ? 'active' : ''}" data-i="${i}">${it.icon ? icon(it.icon) : ''}<span class="grow">${esc(it.label)}${it.sub ? `<div class="xs muted">${esc(it.sub)}</div>` : ''}</span>${it.active ? icon('check', 'icon-sm') : ''}</button>`;
  }).join('');
  document.body.appendChild(menu);
  refreshIcons(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  let left = align === 'right' ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  let top = r.bottom + 6 + window.scrollY;
  if (top + menu.offsetHeight > window.scrollY + window.innerHeight - 8) top = r.top + window.scrollY - menu.offsetHeight - 6;
  menu.style.left = `${left + window.scrollX}px`;
  menu.style.top = `${top}px`;
  menu.querySelectorAll('.menu-item').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const it = items[Number(b.dataset.i)];
    closeMenu();
    it.onClick?.(e);
  }));
  const onDoc = (e) => { if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
  setTimeout(() => { document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey); }, 0);
  currentMenu = { close() { menu.remove(); document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); currentMenu = null; } };
  return currentMenu;
}
export function closeMenu() { currentMenu?.close(); }

/* ---------- misc ---------- */
export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function copyToClipboard(text) {
  const fallback = () => { try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); } catch { /* ignore */ } };
  try { const p = navigator.clipboard?.writeText(text); if (p?.catch) p.catch(fallback); else fallback(); } catch { fallback(); }
}
export const rand = (min, max) => Math.random() * (max - min) + min;
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const sum = (arr, f = (x) => x) => arr.reduce((a, b) => a + (Number(f(b)) || 0), 0);
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
