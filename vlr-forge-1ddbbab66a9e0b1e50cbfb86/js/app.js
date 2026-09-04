/* app.js — bootstrap: router, shell, auth guard, re-render on state change */
import { createRouter } from './router.js';
import { getState, subscribe, isLoggedIn, getProject } from './store.js';
import { bindActions, preserveFocus, refreshIcons, toast, closeMenu, esc, fmtCost } from './ui.js';
import { mainNavHtml, globalActionHandlers } from './shell.js';
import { bootEngine, onRunFinished, onTaskFinished } from './pipeline.js';

import login from './pages/login.js';
import projects from './pages/projects.js';
import projectDetail from './pages/project-detail.js';
import documentViewer from './pages/document-viewer.js';
import tasks from './pages/tasks.js';
import review from './pages/review.js';
import settings from './pages/settings.js';
import support from './pages/support.js';
import documentation from './pages/documentation.js';
import auditLog from './pages/audit-log.js';
import chapters from './pages/chapters.js';
import askPage from './pages/ask.js';
import finalVlr from './pages/final-vlr.js';

const routes = [
  { path: '/login', page: login, public: true, nav: null, bare: true },
  { path: '/', redirect: '#/projects' },
  { path: '/projects', page: projects, nav: 'projects' },
  { path: '/projects/:id', page: projectDetail, nav: 'projects' },
  { path: '/projects/:id/history', page: projectDetail, nav: 'projects', tab: 'history' },
  { path: '/projects/:id/preprocessing', page: projectDetail, nav: 'projects', tab: 'preprocess' },
  { path: '/projects/:id/overview', page: projectDetail, nav: 'projects', tab: 'overview' },
  { path: '/projects/:id/documents/:docId', page: documentViewer, nav: 'projects' },
  { path: '/projects/:id/chapters', page: chapters, nav: 'projects' },
  { path: '/projects/:id/chapters/:chapterId', page: chapters, nav: 'projects' },
  { path: '/projects/:id/vlr', page: finalVlr, nav: 'projects' },
  { path: '/review/:id', page: review, nav: 'projects' },
  { path: '/tasks', page: tasks, nav: 'tasks' },
  { path: '/ask', page: askPage, nav: 'ask' },
  { path: '/settings', page: settings, nav: 'settings' },
  { path: '/support', page: support, nav: 'support' },
  { path: '/documentation', page: documentation, nav: 'documentation' },
  { path: '/audit-log', page: auditLog, nav: 'projects' },
  { path: '*', redirect: '#/projects' },
];

const app = document.getElementById('app');
let current = null;        // { route, params, query }
let local = {};            // per-route UI state (tabs, filters, pagination)
let localKey = null;
let cleanup = null;
let renderQueued = false;

function buildShell(navKey) {
  app.innerHTML = `<div class="app-shell no-sidebar"><div class="main">
    <header class="topbar">
      <a class="topbar-brand" href="#/projects" data-tip="VLR Forge — Governance Dashboard"><span class="brand-mark">VF</span><span class="topbar-brand-name">VLR Forge</span></a>
      ${mainNavHtml(navKey)}
      <div class="topbar-page" id="topbar"></div>
    </header>
    <main class="content" id="content"></main><div id="footer"></div></div></div>`;
  refreshIcons(app);
}

function ctx() {
  return {
    route: current.route, params: current.params, query: current.query, local, state: getState(),
    topbar: document.getElementById('topbar'), content: document.getElementById('content'), footer: document.getElementById('footer'),
    rerender: () => scheduleRender(),
  };
}

function renderPage() {
  if (!current?.route) return;
  const r = current.route;
  if (r.redirect) { location.replace(r.redirect); return; }
  if (!r.public && !isLoggedIn()) { location.replace('#/login?next=' + encodeURIComponent(current.hash)); return; }
  if (r.public && isLoggedIn() && r.path === '/login') { location.replace('#/projects'); return; }

  if (r.bare) {
    if (!app.querySelector('.auth-shell')) app.innerHTML = '';
    try { cleanup?.(); } catch { /* ignore */ }
    cleanup = r.page.render({ root: app, params: current.params, query: current.query, local, state: getState() }) || null;
    refreshIcons(app);
    return;
  }
  if (!app.querySelector('.app-shell')) buildShell(r.nav);
  // main-nav active state
  app.querySelectorAll('.topbar-mainnav .topbar-tab').forEach(el => el.classList.toggle('active', el.dataset.nav === r.nav));
  try { cleanup?.(); } catch { /* ignore */ }
  // Replace the page containers with fresh clones: every listener a page attached to them is dropped,
  // so delegated handlers never accumulate across the ~350ms re-renders.
  for (const id of ['topbar', 'content', 'footer']) { const el = document.getElementById(id); if (el) { const fresh = el.cloneNode(false); el.replaceWith(fresh); } }
  const c = ctx();
  cleanup = r.page.render(c) || null;
  refreshIcons(app);
  document.title = `${r.page.title ? r.page.title(c) + ' · ' : ''}VLR Forge`;
}

let deferredRender = false;
function scheduleRender(force = false) {
  const a = document.activeElement;
  // Don't tear down an open native <select> popup mid-interaction: defer until it blurs/changes (safety timeout 4s).
  if (!force && a && a.tagName === 'SELECT' && app.contains(a)) {
    if (!deferredRender) {
      deferredRender = true;
      const go = () => { deferredRender = false; a.removeEventListener('blur', go); a.removeEventListener('change', go); clearTimeout(t); scheduleRender(true); };
      const t = setTimeout(go, 4000);
      a.addEventListener('blur', go, { once: true }); a.addEventListener('change', go, { once: true });
    }
    return;
  }
  if (renderQueued) return;
  renderQueued = true;
  const run = () => { renderQueued = false; preserveFocus(renderPage); };
  if (document.hidden) setTimeout(run, 0); else requestAnimationFrame(run);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRender(true); });
// A select keeps focus after a choice; release it so the deferred render (and the page's filter change) applies immediately.
app.addEventListener('change', (e) => { if (e.target?.tagName === 'SELECT') { e.target.blur(); scheduleRender(true); } });
// Surface unexpected errors instead of freezing silently mid-demo
window.addEventListener('error', (e) => { console.error(e.error || e.message); toast.error('Something went wrong', String(e.message || '').slice(0, 120)); });
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); });

const router = createRouter(routes, {
  onChange(match) {
    closeMenu();
    current = match;
    const key = match.route?.path + '|' + JSON.stringify(match.params);
    if (key !== localKey) { localKey = key; local = {}; }
    // full shell rebuild when switching between bare (login) and app layouts
    if (match.route?.bare) app.innerHTML = app.querySelector('.auth-shell') ? app.innerHTML : '';
    else if (!app.querySelector('.app-shell')) app.innerHTML = '';
    window.scrollTo(0, 0);
    renderPage();
  },
});

// global delegated actions (user menu, new project, upload, new report)
bindActions(app, globalActionHandlers);

// re-render on every state change (rAF-batched, focus preserved); bare routes (login) manage themselves
subscribe(() => { if (!current?.route?.bare) scheduleRender(); });

// pipeline notifications
onRunFinished((ev) => {
  const p = getProject(ev.projectId);
  if (ev.status === 'success') toast.success('Pipeline run completed', `${p?.name || 'Project'} · total cost ${fmtCost(ev.cost)}`);
  else toast.warning('Pipeline run finished with failures', `${p?.name || 'Project'} · check the Tasks page`);
});
onTaskFinished((t) => {
  if (t.step === 'export' || t.step === 'report') toast.success('Report ready', `${t.inputDoc} is available in the project History tab.`);
});

bootEngine();
router.start();

// expose for debugging / QA
window.__vlr = { getState, router, esc };
