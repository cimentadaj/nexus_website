/* shell.js — sidebar, topbar building blocks, avatar menu, status bar */
import { icon, esc, avatarHtml, openMenu, refreshIcons } from './ui.js';
import { getState, currentUser, projectStats } from './store.js';
import { navigate, inAppNavigations } from './router.js';
import { logout } from './actions.js';
import { APP_VERSION, PILLARS, CONTEXT_SCOPES, SCOPE_META } from './seed.js';
import { openNewReportModal, openNewProjectModal, openUploadModal } from './modals.js';

export const NAV = [
  { key: 'projects', label: 'Projects', icon: 'folder', to: '#/projects' },
];

export function sidebarHtml(activeKey) {
  return `
  <aside class="sidebar">
    <a class="brand" href="#/projects">
      <span class="brand-mark">VF</span>
      <span><div class="brand-name">VLR Forge</div><div class="brand-sub">Governance Dashboard</div></span>
    </a>
    <nav class="nav">
      ${NAV.map(n => `<a class="nav-item ${activeKey === n.key ? 'active' : ''}" href="${n.to}" data-nav="${n.key}">${icon(n.icon)}<span>${n.label}</span></a>`).join('')}
    </nav>
  </aside>`;
}

/** Global navigation shown in the top bar next to the brand (the app has no sidebar). */
export function mainNavHtml(activeKey) {
  return `<nav class="topbar-tabs topbar-mainnav">${NAV.map(n => `<a class="topbar-tab ${activeKey === n.key ? 'active' : ''}" href="${n.to}" data-nav="${n.key}">${n.label}</a>`).join('')}</nav>`;
}

/** Avatar button that opens the user menu. */
export function avatarButton() {
  return `<button class="avatar-btn" data-action="user-menu" aria-label="Account menu">${avatarHtml(currentUser())}</button>`;
}
export function openUserMenu(anchor) {
  const u = currentUser();
  openMenu(anchor, [
    { header: `${u?.name || 'Guest'} · ${u?.role || ''}` },
    { label: 'Sign out', icon: 'log-out', danger: true, onClick: () => { logout(); navigate('#/login'); } },
  ], { minWidth: '230px' });
}

/** Standard right-hand cluster: [Upload Documents] [New Project] (avatar). */
export function topbarActions({ upload = true, newProject = true, projectId = null } = {}) {
  void upload; void projectId; // upload button removed from the top bar (project-level upload lives on the project page)
  return `
    ${newProject ? `<button class="btn btn-primary" data-action="new-project">${icon('plus', 'icon-sm')}New Project</button>` : ''}
    ${avatarButton()}`;
}

export function searchBox({ id = 'global-search', placeholder = 'Search...', value = '', cls = 'search-wide' } = {}) {
  return `<div class="search ${cls}">${icon('search')}<input class="input" id="${id}" type="search" placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete="off"></div>`;
}

/** Sequential lifecycle stepper: Preprocessing → Urban data → Chapters → Final VLR (connected circles). */
export function projectStepper(project, active, { compact = false } = {}) {
  const stats = projectStats(project);
  const done = {
    preprocess: !!project.preprocessedAt,
    overview: stats.allReviewed,
    chapters: stats.chapters > 0 && stats.chaptersApproved === stats.chapters,
    vlr: stats.bookFinal,
  };
  const steps = [
    { key: 'preprocess', label: 'Preprocessing', to: `#/projects/${project.id}/preprocessing` },
    { key: 'overview', label: 'Urban data', to: `#/projects/${project.id}/overview` },
    { key: 'chapters', label: 'Chapters', to: `#/projects/${project.id}/chapters` },
    { key: 'vlr', label: 'Final VLR', to: `#/projects/${project.id}/vlr` },
  ];
  /* hard sequential gate: each step opens only when the previous one is fully
   * done — preprocessing run, then pipeline run AND every extraction confirmed,
   * then every chapter approved */
  const lockReason = {
    preprocess: '',
    overview: project.preprocessedAt ? '' : 'Finish preprocessing first',
    chapters: !project.preprocessedAt ? 'Finish preprocessing first'
      : !stats.extractions ? 'Run the pipeline first'
      : stats.pillarsDone < PILLARS.length ? `Run every extraction step first (${stats.pillarsDone} of ${PILLARS.length} pillars extracted)`
      : !stats.allReviewed ? 'Confirm every extraction first'
      : '',
    vlr: !project.preprocessedAt ? 'Finish preprocessing first'
      : !stats.extractions || stats.pillarsDone < PILLARS.length ? 'Run every extraction step first'
      : !stats.allReviewed ? 'Confirm every extraction first'
      : !stats.chapters ? 'Write the chapters first'
      : stats.chaptersApproved !== stats.chapters ? 'Approve every chapter first'
      : '',
  };
  const locked = (k) => !!lockReason[k];
  return `<nav class="proj-stepper ${compact ? 'compact' : ''}" aria-label="VLR lifecycle">${steps.map((st, i) => {
    const state = st.key === active ? 'current' : done[st.key] ? 'done' : 'todo';
    const inner = `<span class="ps-circle">${done[st.key] && st.key !== active ? icon('check', 'icon-xs') : i + 1}</span><span class="ps-label">${esc(st.label)}</span>`;
    const node = locked(st.key) && st.key !== active
      ? `<span class="ps-step ${state} disabled" data-tip="${esc(lockReason[st.key])}">${inner}</span>`
      : `<a class="ps-step ${state}" href="${st.to}">${inner}</a>`;
    return `${i ? `<span class="ps-line ${done[steps[i - 1].key] ? 'done' : ''}"></span>` : ''}${node}`;
  }).join('')}</nav>`;
}

/** Hard route gate: reason the given lifecycle step is still locked, or '' when open. */
export function stepLockReason(project, step) {
  const stats = projectStats(project);
  if (step === 'chapters') {
    if (!project.preprocessedAt) return 'Finish preprocessing first';
    if (!stats.extractions) return 'Run the pipeline first';
    if (stats.pillarsDone < PILLARS.length) return `Run every extraction step first (${stats.pillarsDone} of ${PILLARS.length} pillars extracted)`;
    if (!stats.allReviewed) return 'Confirm every extraction first';
    return '';
  }
  if (step === 'vlr') {
    if (!project.preprocessedAt) return 'Finish preprocessing first';
    if (!stats.extractions || stats.pillarsDone < PILLARS.length) return 'Run every extraction step first';
    if (!stats.allReviewed) return 'Confirm every extraction first';
    if (!stats.chapters) return 'Write the chapters first';
    if (stats.chaptersApproved !== stats.chapters) return 'Approve every chapter first';
    return '';
  }
  return step === 'preprocess' ? '' : (project.preprocessedAt ? '' : 'Finish preprocessing first');
}

/** Locked-step page body: stepper + explanation, used when a gated route is opened directly. */
export function stepLockedHtml(project, step, reason) {
  return `<div class="pd-page">
  <div class="page-header"><div><h1 class="page-title">${esc(project.city)} ${esc(project.year)}</h1></div></div>
  ${projectStepper(project, step)}
  <div class="card"><div class="empty">${icon('lock')}<div class="empty-title">This step is locked</div><div class="empty-sub">${esc(reason)}. Each step opens once the previous one is fully completed and confirmed.</div><a class="btn btn-primary btn-sm mt-12" href="#/projects/${esc(project.id)}">Go to the current step</a></div></div>
</div>`;
}

/** Warning shown across a project's pages once preprocessing is done but
 * context layers (national / regional / global) are still missing. */
export function contextGapBanner(project) {
  if (!project?.preprocessedAt) return '';
  const docs = getState().documents.filter(d => d.projectId === project.id);
  const missing = CONTEXT_SCOPES.filter(sc => !docs.some(d => d.scope === sc));
  if (!missing.length) return '';
  const labels = missing.map(sc => SCOPE_META[sc].label.toLowerCase());
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `<div class="callout warning ctxgap-banner">${icon('alert-triangle')}<div class="grow"><strong>Results are incomplete</strong> — no ${list} context document${labels.length === 1 ? '' : 's'} uploaded yet. Without ${labels.length === 1 ? 'it' : 'them'} the review misses the ${list} reporting layer${labels.length === 1 ? '' : 's'}.</div><a class="btn btn-light btn-sm" href="#/projects/${esc(project.id)}/preprocessing">${icon('upload', 'icon-sm')}Upload in Preprocessing</a></div>`;
}

export function topbarTabs(items, activeKey) {
  return `<div class="topbar-tabs">${items.map(t => t.disabled
    ? `<span class="topbar-tab disabled" data-tip="${esc(t.disabled)}">${esc(t.label)}</span>`
    : `<a class="topbar-tab ${t.key === activeKey ? 'active' : ''}" href="${t.to}">${esc(t.label)}</a>`).join('')}</div>`;
}

export function statusBarHtml(project) {
  return '';
  const s = getState();
  const node = project?.node || s.meta?.node || 'EU-WEST-1';
  const latency = 18 + Math.floor((Date.now() / 10000) % 14);
  return `<div class="status-bar">
    <div><span><span class="dot"></span>SYSTEM: OPERATIONAL</span><span>NODE: ${esc(node)}</span></div>
    <div><span>IP: ${esc(s.meta?.ip || '192.168.1.104')}</span><span>LATENCY: ${latency}ms</span><span><strong>VLR FORGE ${APP_VERSION}</strong></span></div>
  </div>`;
}

/** Global actions shared by every page (bound once on the app root). */
export const globalActionHandlers = {
  'user-menu': (el) => openUserMenu(el),
  'new-project': () => openNewProjectModal(),
  'upload-documents': (el) => openUploadModal({ projectId: el.dataset.project || null }),
  'new-report': (el) => openNewReportModal({ projectId: el.dataset.project || null }),
  'nav': (el) => navigate(el.dataset.to),
  'back': () => { if (inAppNavigations() > 1) history.back(); else navigate('#/projects'); },
};

export { refreshIcons };
