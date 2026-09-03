/* shell.js — sidebar, topbar building blocks, avatar menu, status bar */
import { icon, esc, avatarHtml, openMenu, refreshIcons } from './ui.js';
import { getState, currentUser, projectStats } from './store.js';
import { navigate, inAppNavigations } from './router.js';
import { logout } from './actions.js';
import { APP_VERSION } from './seed.js';
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
    { label: 'Profile & preferences', icon: 'user', onClick: () => navigate('#/settings?tab=profile') },
    { label: 'Organization settings', icon: 'building-2', onClick: () => navigate('#/settings?tab=organization') },
    { label: 'Audit log', icon: 'scroll-text', onClick: () => navigate('#/audit-log') },
    'divider',
    { label: 'Documentation', icon: 'book-open', onClick: () => navigate('#/documentation') },
    { label: 'Support', icon: 'life-buoy', onClick: () => navigate('#/support') },
    'divider',
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
    { key: 'overview', label: 'Urban data', to: `#/projects/${project.id}` },
    { key: 'chapters', label: 'Chapters', to: `#/projects/${project.id}/chapters` },
    { key: 'vlr', label: 'Final VLR', to: `#/projects/${project.id}/vlr` },
  ];
  const locked = (k) => k !== 'preprocess' && !project.preprocessedAt;
  return `<nav class="proj-stepper ${compact ? 'compact' : ''}" aria-label="VLR lifecycle">${steps.map((st, i) => {
    const state = st.key === active ? 'current' : done[st.key] ? 'done' : 'todo';
    const inner = `<span class="ps-circle">${done[st.key] && st.key !== active ? icon('check', 'icon-xs') : i + 1}</span><span class="ps-label">${esc(st.label)}</span>`;
    const node = locked(st.key)
      ? `<span class="ps-step ${state} disabled" data-tip="Finish preprocessing first">${inner}</span>`
      : `<a class="ps-step ${state}" href="${st.to}">${inner}</a>`;
    return `${i ? `<span class="ps-line ${done[steps[i - 1].key] ? 'done' : ''}"></span>` : ''}${node}`;
  }).join('')}</nav>`;
}

export function topbarTabs(items, activeKey) {
  return `<div class="topbar-tabs">${items.map(t => t.disabled
    ? `<span class="topbar-tab disabled" data-tip="${esc(t.disabled)}">${esc(t.label)}</span>`
    : `<a class="topbar-tab ${t.key === activeKey ? 'active' : ''}" href="${t.to}">${esc(t.label)}</a>`).join('')}</div>`;
}

export function statusBarHtml(project) {
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
