/* Projects list — mock-up design-refs/01-projects-list.png */
import { esc, icon, sdgChips, relTime, bindActions, openMenu, confirmDialog, toast, progressHtml, refreshIcons } from '../ui.js';
import { getState, projectStats, getProjectActivity, getProjectDocs, getProjectExtractions, runningTasks } from '../store.js';
import { runPipeline, archiveProject, unarchiveProject, deleteProject } from '../actions.js';
import { openConfigureProjectModal, openUploadModal } from '../modals.js';
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
/** Project name for activity rows: the card title when the project still exists, else the logged name. */
function activityProjectName(a) {
  const p = a.projectId ? getState().projects.find(x => x.id === a.projectId) : null;
  const logged = a.projectName && a.projectName !== '—' ? a.projectName : '';
  return p ? displayName(p) : (logged || 'System');
}

const STATUS_LABEL = { active: 'Active', archived: 'Archived', provisioning: 'Provisioning' };
const ACTIVITY_BADGE = {
  success: ['success', 'Success'], failed: ['danger', 'Failed'], running: ['running', 'Running'],
  queued: ['neutral', 'Queued'], cancelled: ['neutral', 'Cancelled'], info: ['info', 'Info'],
};

function matches(p, q) {
  if (!q) return true;
  const hay = `${p.name} ${p.city || ''} ${p.country || ''} ${p.jurisdiction || ''} ${p.year || ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

function footerButton(p) {
  if (p.status === 'archived') return `<button class="btn btn-outline btn-block pc-footer-btn" data-action="open-project" data-id="${esc(p.id)}">View Archive ${icon('history', 'icon-sm')}</button>`;
  if (p.status === 'provisioning') return `<button class="btn btn-primary btn-block pc-footer-btn" data-action="configure-project" data-id="${esc(p.id)}">Configure Project ${icon('settings', 'icon-sm')}</button>`;
  return `<button class="btn btn-primary btn-block pc-footer-btn" data-action="open-project" data-id="${esc(p.id)}">View Project ${icon('arrow-right', 'icon-sm')}</button>`;
}

function projectCard(p) {
  const stats = projectStats(p);
  const archived = p.status === 'archived';
  const badgeCls = archived ? 'badge-neutral' : p.status === 'provisioning' ? 'badge-provisioning' : 'badge-success';
  return `
  <article class="card project-card status-${esc(p.status)}" id="pc-${esc(p.id)}" data-action="open-project" data-id="${esc(p.id)}" role="link" tabindex="0" aria-label="Open ${esc(p.name)}">
    <div class="pc-head">
      <div class="grow">
        <h3 class="pc-title">${esc(displayName(p))}</h3>
        <div class="pc-jurisdiction">Jurisdiction: ${esc(p.jurisdiction || '—')}</div>
      </div>
      <div class="pc-head-right">
        <span class="badge ${badgeCls}">${esc(STATUS_LABEL[p.status] || p.status)}</span>
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
    <div class="pc-progress">
      <div class="pc-progress-row"><span>${esc(stats.queueLabel)}</span><span>${esc(stats.queueMeta)}</span></div>
      ${progressHtml(stats.barPct, archived ? 'success' : stats.barCls)}
    </div>
    ${footerButton(p)}
  </article>`;
}

const newVlrCard = () => `
  <button class="new-vlr-card" data-action="new-project" type="button">
    <span class="new-vlr-icon">${icon('plus-circle')}</span>
    <span class="new-vlr-title">Initialize New VLR</span>
    <span class="new-vlr-sub">Create a new data governance project for your local jurisdiction.</span>
  </button>`;

function activityRow(a) {
  const [cls, label] = ACTIVITY_BADGE[a.status] || ['neutral', a.status];
  // only rows whose project still exists navigate (deleted projects would 404)
  const clickable = !!a.projectId && getState().projects.some(p => p.id === a.projectId);
  return `
  <tr class="${clickable ? 'clickable' : ''}" ${clickable ? `data-action="open-project" data-id="${esc(a.projectId)}"` : ''}>
    <td><div class="cell-title">${esc(activityProjectName(a))}</div><div class="cell-sub">${esc(a.title)}</div></td>
    <td><span class="prov">${icon('shield-check', 'icon-sm')}<span class="mono">${esc(a.provenance || '—')}</span></span></td>
    <td class="muted">${esc(relTime(a.ts))}</td>
    <td><span class="badge badge-${cls} act-badge">${esc(label)}</span></td>
  </tr>`;
}

function openCardMenu(anchor, p) {
  const archived = p.status === 'archived';
  openMenu(anchor, [
    { label: 'Open', icon: 'folder-open', onClick: () => navigate(`#/projects/${p.id}`) },
    { label: 'Configure', icon: 'settings', onClick: () => openConfigureProjectModal(p.id) },
    { label: 'Upload documents', icon: 'upload', onClick: () => {
        if (archived) { toast.warning('Project is archived', 'Restore the project before uploading documents.'); return; }
        openUploadModal({ projectId: p.id });
      } },
    { label: 'Run full pipeline', icon: 'play', onClick: () => runFull(p) },
    'divider',
    archived
      ? { label: 'Restore', icon: 'archive-restore', onClick: () => { unarchiveProject(p.id); toast.success('Project restored', `${p.name} is active again.`); } }
      : { label: 'Archive', icon: 'archive', onClick: async () => {
          if (await confirmDialog({ title: 'Archive project?', msg: `${esc(p.name)} will be frozen. Extractions remain readable and reports can still be downloaded.`, confirmText: 'Archive', icon: 'archive' })) {
            archiveProject(p.id); toast.success('Project archived', p.name);
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

function runFull(p) {
  if (p.status === 'archived') { toast.warning('Project is archived', 'Restore the project before running the pipeline.'); return; }
  if (runningTasks(p.id).length) { toast.info('Pipeline already running', `${p.name} has tasks in progress. See the Tasks page.`); return; }
  if (!getProjectDocs(p.id).length) { toast.warning('No documents to process', 'Upload documents before running the pipeline.'); return; }
  const run = runPipeline(p.id);
  if (!run) { toast.info('Nothing to run', 'All documents are already processed.'); return; }
  toast.success('Pipeline run started', `${run.label} · ${run.taskIds?.length ?? ''} tasks queued for ${p.name}`);
}

export default {
  title: () => 'Projects',
  render(ctx) {
    const state = getState();
    const q = ctx.local.q || '';
    const projects = state.projects;
    const visible = projects.filter(p => matches(p, q));
    const total = projects.length;
    const active = projects.filter(p => p.status === 'active').length;
    const activity = getProjectActivity().slice(0, 8);

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

      ${visible.length || !q ? `
      <div class="project-grid">
        ${visible.map(projectCard).join('')}
        ${newVlrCard()}
      </div>
      ${!total ? `<div class="callout projects-none">${icon('info')}<span>No VLR projects yet. Use <strong>Initialize New VLR</strong> or <strong>New Project</strong> to create your first Voluntary Local Review project.</span></div>` : ''}` : `
      <div class="card projects-empty">
        <div class="empty">
          ${icon('search-x')}
          <div class="empty-title">No projects match “${esc(q)}”</div>
          <div class="empty-sub">Try a different city, jurisdiction or year, or create a new VLR project.</div>
          <div class="row projects-empty-actions">
            <button class="btn btn-light" data-action="clear-search">Clear search</button>
            <button class="btn btn-primary" data-action="new-project">${icon('plus', 'icon-sm')}New Project</button>
          </div>
        </div>
      </div>`}

      <section class="card activity-card">
        <div class="card-header tinted">
          <div class="card-title">Recent Processing Activity</div>
          <a class="link-text" href="#/audit-log">View Audit Log</a>
        </div>
        ${activity.length ? `
        <table class="table activity-table">
          <thead><tr><th>Project / Task</th><th>Provenance</th><th>Timestamp</th><th>Status</th></tr></thead>
          <tbody>${activity.map(activityRow).join('')}</tbody>
        </table>` : `
        <div class="empty">${icon('activity')}<div class="empty-title">No processing activity yet</div><div class="empty-sub">Upload documents and run the pipeline to see events here.</div></div>`}
      </section>`;

    const unbindContent = bindActions(ctx.content, {
      'open-project': (el) => navigate(`#/projects/${el.dataset.id}`),
      'configure-project': (el) => openConfigureProjectModal(el.dataset.id),
      'card-menu': (el) => { const p = state.projects.find(x => x.id === el.dataset.id); if (p) openCardMenu(el, p); },
      'clear-search': () => { ctx.local.q = ''; ctx.rerender(); },
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
