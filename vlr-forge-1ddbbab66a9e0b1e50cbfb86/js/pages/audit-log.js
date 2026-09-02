/* Audit log — every governance event (pipeline tasks, runs, uploads, reviews, project changes, exports)
 * with provenance codes, actors and status. Filters live in ctx.local; rows link to documents / projects. */
import { esc, icon, dateTimeCell, statusBadge, avatarHtml, bindActions, toast, download, fmtDate, fmtTime, relTime } from '../ui.js';
import { getState, getProjectActivity } from '../store.js';
import { openDocumentDrawer } from '../modals.js';
import { topbarActions } from '../shell.js';
import { navigate } from '../router.js';

const PAGE_SIZE = 20;
const TYPES = [
  ['task', 'Task', 'info'], ['run', 'Run', 'navy'], ['extraction', 'Extraction', 'sky'], ['upload', 'Upload', 'running'],
  ['review', 'Review', 'success'], ['project', 'Project', 'neutral'], ['export', 'Export', 'warning'],
];
const TYPE_CLS = Object.fromEntries(TYPES.map(t => [t[0], t[2]]));
const TYPE_LABEL = Object.fromEntries(TYPES.map(t => [t[0], t[1]]));
const STATUSES = ['success', 'failed', 'running', 'queued', 'cancelled', 'info'];
const RANGES = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['all', 'All time']];

function rangeStart(key) {
  const now = Date.now();
  if (key === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (key === '7d') return now - 7 * 86_400_000;
  if (key === '30d') return now - 30 * 86_400_000;
  return 0;
}

function typeBadge(type) {
  return `<span class="badge badge-${TYPE_CLS[type] || 'neutral'}">${esc(TYPE_LABEL[type] || type)}</span>`;
}

function docByCode(code) {
  return getState().documents.find(d => d.code === code) || null;
}

function csvFor(rows) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['timestamp', 'project', 'event', 'type', 'provenance', 'actor', 'status'];
  const lines = rows.map(a => [`${fmtDate(a.ts)} ${fmtTime(a.ts)}`, a.projectName, a.title, a.type, a.provenance, a.actor, a.status].map(q).join(','));
  return [head.join(','), ...lines].join('\n');
}

export default {
  title: () => 'Audit Log',
  render(ctx) {
    const L = ctx.local;
    if (L.init !== true) {
      L.init = true; L.project = ctx.query.project || 'all'; L.type = 'all'; L.status = 'all'; L.range = 'all'; L.q = ''; L.page = 1;
    }
    // honour ?project= when the query changes while already on the page (e.g. user menu / project links)
    if (ctx.query.project && ctx.query.project !== L.lastQueryProject) { L.project = ctx.query.project; L.page = 1; }
    L.lastQueryProject = ctx.query.project;
    const s = ctx.state;
    const projects = s.projects;
    if (L.project !== 'all' && !projects.some(p => p.id === L.project)) L.project = 'all';
    const all = getProjectActivity();
    const q = (L.q || '').trim().toLowerCase();
    const since = rangeStart(L.range);
    const filtered = all.filter(a =>
      (L.project === 'all' || a.projectId === L.project) &&
      (L.type === 'all' || a.type === L.type) &&
      (L.status === 'all' || a.status === L.status) &&
      a.ts >= since &&
      (!q || `${a.title} ${a.projectName} ${a.provenance} ${a.actor} ${a.type} ${a.status} ${docByCode(a.provenance)?.name || ''}`.toLowerCase().includes(q)));
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (L.page > pages) L.page = pages;
    if (L.page < 1) L.page = 1;
    const start = (L.page - 1) * PAGE_SIZE;
    const rows = filtered.slice(start, start + PAGE_SIZE);
    const dayAgo = Date.now() - 86_400_000;
    const failed24 = filtered.filter(a => a.status === 'failed' && a.ts > dayAgo).length;
    const human = filtered.filter(a => a.actor && a.actor !== 'Pipeline' && a.actor !== 'System').length;
    const docsLinked = new Set(filtered.map(a => a.provenance).filter(c => docByCode(c))).size;
    const activeFilters = [L.project !== 'all', L.type !== 'all', L.status !== 'all', L.range !== 'all', !!q].filter(Boolean).length;

    ctx.topbar.innerHTML = `
      <div class="breadcrumb audit-crumb"><a href="#/projects" data-tip="Back to Projects">${icon('arrow-left', 'icon-sm')}Projects</a>${icon('chevron-right', 'icon-sm')}</div>
      <div><div class="topbar-title">Audit Log</div><div class="topbar-subtitle">${filtered.length} events · ${L.project === 'all' ? 'All projects' : esc(projects.find(p => p.id === L.project)?.name || '')}</div></div>
      <span class="grow"></span>
      ${topbarActions()}`;

    ctx.content.innerHTML = `
    <div class="audit-page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Audit Log</h1>
          <p class="page-subtitle">Immutable record of every pipeline, review and governance event with its provenance code.</p>
        </div>
        <div class="row" style="gap:10px">
          <span class="badge badge-pill badge-neutral">Events: ${filtered.length}</span>
          <button class="btn btn-light" data-action="export-csv" data-tip="Download the filtered events as CSV">${icon('download', 'icon-sm')}Export CSV</button>
        </div>
      </div>

      <div class="stat-grid audit-stats">
        <div class="stat-card"><div class="stat-label">Events (filtered)</div><div class="stat-value-row"><span class="stat-value">${String(filtered.length).padStart(2, '0')}</span>${icon('scroll-text', 'stat-icon')}</div></div>
        <div class="stat-card"><div class="stat-label">Failed (24h)</div><div class="stat-value-row"><span class="stat-value ${failed24 ? 'danger' : ''}">${String(failed24).padStart(2, '0')}</span>${icon('alert-circle', 'stat-icon danger')}</div></div>
        <div class="stat-card"><div class="stat-label">Human actions</div><div class="stat-value-row"><span class="stat-value">${String(human).padStart(2, '0')}</span>${icon('user-check', 'stat-icon success')}</div></div>
        <div class="stat-card"><div class="stat-label">Documents referenced</div><div class="stat-value-row"><span class="stat-value">${String(docsLinked).padStart(2, '0')}</span>${icon('shield-check', 'stat-icon')}</div></div>
      </div>

      <div class="card audit-card">
        <div class="table-toolbar">
          <div class="row"><span class="filter-label">Project:</span>
            <select class="select select-sm" id="audit-project" data-action="filter" data-key="project">
              <option value="all" ${L.project === 'all' ? 'selected' : ''}>All Projects</option>
              ${projects.map(p => `<option value="${esc(p.id)}" ${L.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select></div>
          <div class="row"><span class="filter-label">Type:</span>
            <select class="select select-sm" id="audit-type" data-action="filter" data-key="type">
              <option value="all" ${L.type === 'all' ? 'selected' : ''}>All Types</option>
              ${TYPES.map(([k, l]) => `<option value="${k}" ${L.type === k ? 'selected' : ''}>${l}</option>`).join('')}
            </select></div>
          <div class="row"><span class="filter-label">Status:</span>
            <select class="select select-sm" id="audit-status" data-action="filter" data-key="status">
              <option value="all" ${L.status === 'all' ? 'selected' : ''}>All Statuses</option>
              ${STATUSES.map(k => `<option value="${k}" ${L.status === k ? 'selected' : ''}>${esc(k[0].toUpperCase() + k.slice(1))}</option>`).join('')}
            </select></div>
          <div class="range-tabs" role="tablist">
            ${RANGES.map(([k, l]) => `<button class="range-tab ${L.range === k ? 'active' : ''}" data-action="range" data-range="${k}">${l}</button>`).join('')}
          </div>
          <span class="grow"></span>
          <div class="search"><i data-lucide="search" class="icon"></i><input class="input" id="audit-search" type="search" placeholder="Search events, provenance, actor..." value="${esc(L.q || '')}" autocomplete="off"></div>
          ${activeFilters ? `<button class="btn btn-ghost btn-sm" data-action="reset">${icon('x', 'icon-sm')}Reset (${activeFilters})</button>` : ''}
        </div>
        <div style="overflow-x:auto">
        <table class="table audit-table">
          <thead><tr>
            <th>Timestamp</th><th>Project</th><th>Event</th><th>Type</th><th>Provenance</th><th>Actor</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${rows.length ? rows.map(a => {
              const doc = docByCode(a.provenance);
              const proj = a.projectId ? projects.find(p => p.id === a.projectId) : null;
              const projLabel = a.projectName || (a.projectId ? a.projectId : '—');
              const tip = doc ? `Open ${doc.name}` : proj ? `Open ${proj.name}` : a.projectId ? `${projLabel} was deleted` : 'System event';
              return `<tr class="clickable ${a.status === 'failed' ? 'row-failed' : ''}" data-action="open-row" data-id="${esc(a.id)}" title="${esc(tip)}">
                <td>${dateTimeCell(a.ts)}</td>
                <td>${proj ? `<a class="cell-title project-link" href="#/projects/${esc(a.projectId)}" data-action="noop">${esc(projLabel)}</a>` : `<span class="cell-title muted" data-tip="${a.projectId ? 'Project deleted' : 'System event'}">${esc(projLabel)}${a.projectId ? ' <span class="xs">(deleted)</span>' : ''}</span>`}</td>
                <td><div class="cell-title event-title">${esc(a.title)}</div><div class="cell-sub">${esc(relTime(a.ts))} · ${doc ? `${esc(doc.name)} · ${esc(doc.type)} · ${esc(doc.language)}` : esc(TYPE_LABEL[a.type] || a.type) + ' event'}</div></td>
                <td>${typeBadge(a.type)}</td>
                <td><span class="prov ${doc ? 'prov-doc' : ''}" data-action="open-prov" data-code="${esc(a.provenance)}" data-tip="${doc ? 'Document · click for details' : 'System reference'}">${icon('shield-check', 'icon-sm')}<span class="mono">${esc(a.provenance)}</span></span></td>
                <td><span class="actor">${avatarHtml({ name: a.actor }, a.actor === 'Pipeline' || a.actor === 'System' ? 'avatar-sm avatar-sys' : 'avatar-sm')}<span>${esc(a.actor)}</span></span></td>
                <td>${statusBadge(a.status)}</td>
              </tr>`;
            }).join('') : `<tr><td colspan="7"><div class="empty">${icon('search-x')}<div class="empty-title">No events match these filters</div><div class="empty-sub">Try widening the date range or clearing the search.</div><button class="btn btn-light btn-sm" style="margin-top:12px" data-action="reset">Clear filters</button></div></td></tr>`}
          </tbody>
        </table>
        </div>
        <div class="table-footer">
          <span>Showing <strong>${filtered.length ? start + 1 : 0}–${start + rows.length}</strong> of <strong>${filtered.length}</strong> events · page ${L.page} of ${pages}</span>
          <div class="pager">
            <button data-action="page" data-dir="-1" ${L.page <= 1 ? 'disabled' : ''} aria-label="Previous page">${icon('chevron-left', 'icon-sm')}</button>
            <button data-action="page" data-dir="1" ${L.page >= pages ? 'disabled' : ''} aria-label="Next page">${icon('chevron-right', 'icon-sm')}</button>
          </div>
        </div>
      </div>
      <p class="audit-note muted xs">${icon('lock', 'icon-xs')} Events are append-only. Provenance codes (e.g. <span class="mono">MDC-DOC-429</span>) resolve to the uploaded document; <span class="mono">-RUN-</span> and <span class="mono">-PRJ-</span> codes reference pipeline runs and project lifecycle events.</p>
    </div>`;

    const setFilter = (key, value) => { L[key] = value; L.page = 1; ctx.rerender(); };

    const unbindChange = bindActions(ctx.content, {
      // blur first: app.js defers re-renders while a <select> keeps focus
      filter: (el) => { el.blur(); setFilter(el.dataset.key, el.value); },
    }, 'change');

    const search = ctx.content.querySelector('#audit-search');
    const onInput = () => { L.q = search.value; L.page = 1; ctx.rerender(); };
    search.addEventListener('input', onInput);

    const unbindClick = bindActions(ctx.content, {
      noop: (el, ev) => { ev.stopPropagation(); },
      range: (el) => setFilter('range', el.dataset.range),
      reset: () => { L.project = 'all'; L.type = 'all'; L.status = 'all'; L.range = 'all'; L.q = ''; L.page = 1; ctx.rerender(); toast.info('Filters cleared'); },
      page: (el) => { L.page += Number(el.dataset.dir); ctx.rerender(); },
      'export-csv': () => {
        if (!filtered.length) { toast.warning('Nothing to export', 'No events match the current filters.'); return; }
        download('vlr-forge-audit-log.csv', csvFor(filtered), 'text/csv');
        toast.success('Audit log exported', `${filtered.length} events → vlr-forge-audit-log.csv`);
      },
      'open-prov': (el, ev) => {
        ev.stopPropagation();
        const doc = docByCode(el.dataset.code);
        if (doc) { openDocumentDrawer(doc.id); return; }
        const a = all.find(x => x.provenance === el.dataset.code);
        const exists = a && projects.some(p => p.id === a.projectId);
        if (exists && /-RUN-/.test(el.dataset.code)) navigate(`#/projects/${a.projectId}/history`);
        else if (exists) navigate(`#/projects/${a.projectId}`);
        else if (a?.projectId) toast.info('Project deleted', `${a.projectName || a.projectId} no longer exists; this event is kept for the audit trail.`);
        else toast.info('System reference', `${el.dataset.code} is not linked to a document.`);
      },
      'open-row': (el) => {
        const a = all.find(x => x.id === el.dataset.id);
        if (!a) return;
        const doc = docByCode(a.provenance);
        if (doc) { openDocumentDrawer(doc.id); return; }
        if (!projects.some(p => p.id === a.projectId)) {
          toast.info(a.projectId ? 'Project deleted' : 'System event', a.projectId ? `${a.projectName || a.projectId} no longer exists; this event is kept for the audit trail.` : `${a.title} · ${a.provenance}`);
          return;
        }
        if (a.type === 'run' || a.type === 'export' || /-RUN-/.test(a.provenance)) navigate(`#/projects/${a.projectId}/history`);
        else if (a.type === 'task') navigate(`#/tasks?project=${a.projectId}`);
        else navigate(`#/projects/${a.projectId}`);
      },
    });

    return () => { unbindChange(); unbindClick(); search.removeEventListener('input', onInput); };
  },
};
