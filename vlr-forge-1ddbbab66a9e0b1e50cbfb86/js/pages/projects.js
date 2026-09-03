/* Projects list — mock-up design-refs/01-projects-list.png */
import { esc, icon, sdgChips, bindActions, openMenu, confirmDialog, toast, refreshIcons } from '../ui.js';
import { getState, projectStats, getProjectDocs, getProjectExtractions } from '../store.js';
import { archiveProject, unarchiveProject, deleteProject } from '../actions.js';
import { openConfigureProjectModal } from '../modals.js';
import { topbarActions, searchBox, topbarTabs } from '../shell.js';
import { navigate } from '../router.js';

const pad2 = (n) => String(n).padStart(2, '0');
/** Card title as in the mock-up: "Madrid 2024" (falls back to the full project name). */
/** A custom (renamed) project keeps its full name so the rename is visible on the card. */
const displayName = (p) => {
  if (!p.city || !p.year) return p.name;
  const auto = `${p.city} ${p.year}`;
  return !p.name || p.name === auto || p.name === `${auto} VLR` ? auto : p.name;
};


function matches(p, q) {
  if (!q) return true;
  const hay = `${p.name} ${p.city || ''} ${p.country || ''} ${p.jurisdiction || ''} ${p.year || ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

/** Lifecycle stages shown on each card: completed → green check, current → navy, upcoming → grey. */
const STAGES = [
  { key: 'extraction', label: 'Urban data' },
  { key: 'review', label: 'Review' },
  { key: 'chapters', label: 'Chapters' },
  { key: 'final', label: 'Final VLR' },
];
function stageState(stats) {
  const done = {
    extraction: stats.extractions > 0 && stats.pillarsDone === 4,
    review: stats.allReviewed,
    chapters: stats.chapters > 0 && stats.chaptersApproved === stats.chapters,
    final: stats.bookFinal,
  };
  const current = STAGES.find(st => !done[st.key])?.key || null; // null → everything done
  return { done, current };
}
function stagePills(stats) {
  const { done, current } = stageState(stats);
  return `<div class="pc-stages">${STAGES.map(st => {
    const cls = done[st.key] ? 'done' : st.key === current ? 'current' : 'todo';
    return `<span class="pc-stage ${cls}" data-tip="${st.key === current ? 'Current stage' : done[st.key] ? 'Completed' : 'Upcoming'}">${done[st.key] ? icon('check', 'icon-xs') : ''}${esc(st.label)}</span>`;
  }).join('')}</div>`;
}

function footerButton(p) {
  if (p.status === 'archived') return `<button class="btn btn-outline btn-block pc-footer-btn" data-action="open-project" data-id="${esc(p.id)}">View Archive ${icon('history', 'icon-sm')}</button>`;
  if (p.status === 'provisioning') return `<button class="btn btn-primary btn-block pc-footer-btn" data-action="configure-project" data-id="${esc(p.id)}">Configure Project ${icon('settings', 'icon-sm')}</button>`;
  return `<button class="btn btn-primary btn-block pc-footer-btn" data-action="open-project" data-id="${esc(p.id)}">View Project ${icon('arrow-right', 'icon-sm')}</button>`;
}

function projectCard(p) {
  const stats = projectStats(p);
  const archived = p.status === 'archived';
  return `
  <article class="card project-card status-${esc(p.status)}" id="pc-${esc(p.id)}" data-action="open-project" data-id="${esc(p.id)}" role="link" tabindex="0" aria-label="Open ${esc(p.name)}">
    <div class="pc-head">
      <div class="grow">
        <h3 class="pc-title">${esc(displayName(p))}</h3>
        <div class="pc-jurisdiction">Jurisdiction: ${esc(p.jurisdiction || '—')}</div>
      </div>
      <div class="pc-head-right">
        ${p.status === 'provisioning' ? `<span class="badge badge-provisioning">Provisioning</span>` : ''}
        <button class="btn-icon pc-kebab" data-action="card-menu" data-id="${esc(p.id)}" aria-label="Project actions" data-tip="More actions">${icon('more-horizontal')}</button>
      </div>
    </div>
    <div class="pc-sdgs">${p.sdgs?.length ? sdgChips(p.sdgs, { max: 6, muted: archived }) : `<span class="muted xs">No target SDGs configured</span>`}</div>
    <div class="pc-divider"></div>
    <div class="pc-stats">
      <div>
        <div class="pc-stat-label">Sources</div>
        <span class="pc-stat-value">${icon('file-text', 'icon-sm')}<span>${pad2(stats.docs)} Documents</span></span>
      </div>
    </div>
    ${stagePills(stats)}
    ${footerButton(p)}
  </article>`;
}

const newVlrCard = () => `
  <button class="new-vlr-card" data-action="new-project" type="button">
    <span class="new-vlr-icon">${icon('plus-circle')}</span>
    <span class="new-vlr-title">Initialize New VLR</span>
    <span class="new-vlr-sub">Create a new data governance project for your local jurisdiction.</span>
  </button>`;

function openCardMenu(anchor, p) {
  const archived = p.status === 'archived';
  openMenu(anchor, [
    { label: 'Open', icon: 'folder-open', onClick: () => navigate(`#/projects/${p.id}`) },
    { label: 'Configure', icon: 'settings', onClick: () => openConfigureProjectModal(p.id) },
    'divider',
    archived
      ? { label: 'Restore', icon: 'archive-restore', onClick: () => { unarchiveProject(p.id); toast.success('Project restored', `${p.name} moved back to the Active tab.`); } }
      : { label: 'Archive', icon: 'archive', onClick: async () => {
          if (await confirmDialog({ title: 'Archive project?', msg: `${esc(p.name)} will be frozen. Extractions remain readable and reports can still be downloaded.`, confirmText: 'Archive', icon: 'archive' })) {
            archiveProject(p.id); toast.success('Project archived', `${p.name} moved to the Archived tab.`);
          }
        } },
    { label: 'Delete', icon: 'trash-2', danger: true, onClick: async () => {
        const docs = getProjectDocs(p.id).length, exts = getProjectExtractions(p.id).length;
        if (await confirmDialog({ title: 'Delete project?', msg: `This permanently removes <strong>${esc(p.name)}</strong> with ${docs} documents and ${exts} extractions.`, confirmText: 'Delete permanently', danger: true, icon: 'trash-2' })) {
          deleteProject(p.id); toast.success('Project deleted', p.name);
        }
      } },
  ], { minWidth: '210px' });
}

export default {
  title: () => 'Projects',
  render(ctx) {
    const state = getState();
    const q = ctx.local.q || '';
    const view = ctx.local.view || 'active';
    const projects = state.projects;
    const archivedCount = projects.filter(p => p.status === 'archived').length;
    const pool = projects.filter(p => (view === 'archived' ? p.status === 'archived' : p.status !== 'archived'));
    const visible = pool.filter(p => matches(p, q));
    const total = projects.length;
    const active = projects.filter(p => p.status === 'active').length;

    ctx.topbar.innerHTML = `
      ${searchBox({ id: 'projects-search', placeholder: 'Search VLR Projects...', value: q })}
      ${topbarTabs([
        { key: 'projects', label: 'Projects', to: '#/projects' },
        { key: 'tasks', label: 'Tasks', to: '#/tasks' },
        { key: 'settings', label: 'Settings', to: '#/settings' },
      ], 'projects')}
      <span class="grow"></span>
      ${topbarActions()}`;

    ctx.content.innerHTML = `
      <div class="page-header projects-header">
        <div>
          <h1 class="page-title">VLR Projects</h1>
          <p class="page-subtitle">Manage and monitor Voluntary Local Review progress across urban jurisdictions.</p>
        </div>
        <div class="projects-pills">
          <span class="pill pill-neutral" data-tip="All projects in this organisation">Total: ${total}</span>
          <span class="pill pill-success" data-tip="Projects currently in extraction or review">Active: ${active}</span>
        </div>
      </div>

      <div class="proj-view-tabs" role="tablist">
        <button class="proj-view-tab ${view === 'active' ? 'on' : ''}" role="tab" aria-selected="${view === 'active'}" data-action="switch-view" data-view="active">${icon('folder-open', 'icon-sm')}Active<span class="pvt-count">${total - archivedCount}</span></button>
        <button class="proj-view-tab ${view === 'archived' ? 'on' : ''}" role="tab" aria-selected="${view === 'archived'}" data-action="switch-view" data-view="archived">${icon('archive', 'icon-sm')}Archived<span class="pvt-count">${archivedCount}</span></button>
      </div>

      ${visible.length || (!q && view === 'active') ? `
      <div class="project-grid">
        ${visible.map(projectCard).join('')}
        ${view === 'active' ? newVlrCard() : ''}
      </div>
      ${!total && view === 'active' ? `<div class="callout projects-none">${icon('info')}<span>No VLR projects yet. Use <strong>Initialize New VLR</strong> or <strong>New Project</strong> to create your first Voluntary Local Review project.</span></div>` : ''}` : q ? `
      <div class="card projects-empty">
        <div class="empty">
          ${icon('search-x')}
          <div class="empty-title">No ${view === 'archived' ? 'archived ' : ''}projects match “${esc(q)}”</div>
          <div class="empty-sub">Try a different city, jurisdiction or year${view === 'archived' ? ', or check the Active tab' : ', or create a new VLR project'}.</div>
          <div class="row projects-empty-actions">
            <button class="btn btn-light" data-action="clear-search">Clear search</button>
            ${view === 'active' ? `<button class="btn btn-primary" data-action="new-project">${icon('plus', 'icon-sm')}New Project</button>` : ''}
          </div>
        </div>
      </div>` : `
      <div class="card projects-empty">
        <div class="empty">
          ${icon('archive')}
          <div class="empty-title">No archived projects</div>
          <div class="empty-sub">Archive a project from its card menu (⋯ → Archive) and it will move here, frozen but fully readable.</div>
          <div class="row projects-empty-actions"><button class="btn btn-light" data-action="switch-view" data-view="active">${icon('folder-open', 'icon-sm')}Back to Active</button></div>
        </div>
      </div>`}`;

    const unbindContent = bindActions(ctx.content, {
      'open-project': (el) => navigate(`#/projects/${el.dataset.id}`),
      'configure-project': (el) => openConfigureProjectModal(el.dataset.id),
      'card-menu': (el) => { const p = state.projects.find(x => x.id === el.dataset.id); if (p) openCardMenu(el, p); },
      'clear-search': () => { ctx.local.q = ''; ctx.rerender(); },
      'switch-view': (el) => { ctx.local.view = el.dataset.view; ctx.rerender(); },
    });

    // keyboard: Enter on a focused card opens it
    const onKey = (ev) => {
      if (ev.key !== 'Enter') return;
      const card = ev.target.closest?.('.project-card');
      if (card && ev.target === card) navigate(`#/projects/${card.dataset.id}`);
    };
    ctx.content.addEventListener('keydown', onKey);

    const search = ctx.topbar.querySelector('#projects-search');
    const onInput = () => { ctx.local.q = search.value; ctx.rerender(); };
    search?.addEventListener('input', onInput);

    refreshIcons(ctx.content);
    ctx.footer.innerHTML = '';

    return () => { unbindContent(); ctx.content.removeEventListener('keydown', onKey); search?.removeEventListener('input', onInput); };
  },
};
