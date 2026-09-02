/* Tasks — Workflow Orchestration (mock-up 04) */
import { esc, icon, refreshIcons, dateTimeCell, fmtDuration, fmtCost, fmtTime, fmtPct, statusBadge, progressHtml, bindActions, toast } from '../ui.js';
import { getState, getProject, getLogs, taskStats } from '../store.js';
import { executeAllTasks, retryTask, cancelTask, setUi } from '../actions.js';
import { openTaskDrawer } from '../modals.js';
import { topbarActions, searchBox } from '../shell.js';
import { STEP_META, STEP_ORDER } from '../seed.js';

const PAGE_SIZE = 8;
const REFRESH_SECS = 30;
const STATUS_ORDER = { running: 0, queued: 1, failed: 2, success: 3, cancelled: 4 };
const STATUS_OPTIONS = [['all', 'All Statuses'], ['running', 'Running'], ['queued', 'Queued'], ['success', 'Success'], ['failed', 'Failed'], ['cancelled', 'Cancelled']];

/** Pipeline visualizer nodes → which step types feed each node. */
const FLOW_NODES = [
  { key: 'ingest', label: 'Ingest', icon: 'log-in', steps: ['xml_extraction'] },
  { key: 'parse', label: 'Parse', icon: 'braces', steps: ['parse'] },
  { key: 'translate', label: 'Translate', icon: 'languages', steps: ['translate'] },
  { key: 'extract', label: 'Extract', icon: 'bar-chart-2', steps: ['extract_indicators', 'documentary', 'projects', 'stakeholders'] },
  { key: 'analyse', label: 'Analyse', icon: 'trending-up', steps: ['analyse', 'validation', 'normalization', 'provenance'] },
  { key: 'export', label: 'Export', icon: 'file-spreadsheet', steps: ['export', 'report'] },
  { key: 'write', label: 'Write VLR', icon: 'pen-line', steps: ['compose', 'edit', 'assemble', 'render'] },
];

function inScope(t, filter) { return filter === 'all' || t.projectId === filter; }

function sortTasks(list) {
  return [...list].sort((a, b) => {
    const sa = STATUS_ORDER[a.status] ?? 9, sb = STATUS_ORDER[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

function durationCell(t) {
  if (t.status === 'running') return fmtDuration(Math.max(0, Date.now() - (t.startedAt || t.createdAt || Date.now())));
  if (t.status === 'queued') return '—';
  return fmtDuration(t.durationMs);
}

function costCell(t) {
  if (t.status === 'queued') return '<span class="cost muted">—</span>';
  if (t.status === 'running') {
    const meta = STEP_META[t.step];
    const est = t.cost || (meta ? meta.base + meta.perPage * (t.pages || 0) : 0);
    return `<span class="cost muted" data-tip="Estimated — accruing while the task runs">${fmtCost(est)}</span>`;
  }
  return `<span class="cost">${fmtCost(t.cost || 0)}</span>`;
}

function statusCell(t) {
  if (t.status === 'running') {
    return `<div class="task-status-running">${statusBadge('running')}${progressHtml(t.progress || 0, 'sm sky')}</div>`;
  }
  return statusBadge(t.status);
}

function actionCell(t) {
  if (t.status === 'running' || t.status === 'queued') {
    return `<button class="task-action danger" data-action="cancel-task" data-id="${esc(t.id)}" data-tip="Cancel task">${icon('x-circle', 'icon-sm')}Cancel</button>`;
  }
  if (t.status === 'failed' || t.status === 'cancelled') {
    return `<button class="task-action" data-action="retry-task" data-id="${esc(t.id)}" data-tip="Retry task">${icon('rotate-ccw', 'icon-sm')}Retry</button>`;
  }
  return `<button class="btn-icon" data-action="open-task" data-id="${esc(t.id)}" data-tip="View details" aria-label="View task">${icon('eye')}</button>`;
}

function flowNodeHtml(node, tasks, filter) {
  const mine = tasks.filter(t => node.steps.includes(t.step));
  const running = mine.filter(t => t.status === 'running').length;
  const done = mine.filter(t => t.status === 'success').length;
  let cls = 'idle';
  let counter;
  if (node.key === 'ingest') {
    // Ingest has no task step of its own: it reflects document ingestion (upload → parse hand-off) in scope.
    const docs = getState().documents.filter(d => filter === 'all' || d.projectId === filter);
    const ingesting = docs.filter(d => d.status === 'parsing').length + running;
    const pending = docs.filter(d => d.status === 'uploaded').length;
    const ingested = docs.filter(d => !['uploaded', 'parsing', 'failed'].includes(d.status)).length;
    cls = ingesting ? 'running' : ingested ? 'done' : 'idle';
    counter = docs.length ? `${ingested} done${ingesting ? ` · ${ingesting} running` : ''}${pending ? ` · ${pending} pending` : ''}` : 'no documents';
  } else {
    cls = running ? 'running' : done ? 'done' : 'idle';
    counter = mine.length ? `${done} done${running ? ` · ${running} running` : ''}` : 'no tasks';
  }
  return `<div class="flow-node ${cls}"><div class="flow-box">${icon(node.icon)}</div><div class="flow-label">${esc(node.label)}</div><div class="flow-count">${esc(counter)}</div></div>`;
}

export default {
  title: () => 'Workflow Orchestration',
  render(ctx) {
    const { local, query } = ctx;
    const state = getState();

    /* ---- local UI state (initialised once per route visit) ---- */
    // `?project=` deep link: applied on first render AND whenever the query changes while staying on #/tasks
    // (ctx.local survives query-only hash changes, so we track which query value was last applied).
    const qProject = query?.project && getProject(query.project) ? query.project : null;
    if (local.filter === undefined || (qProject && local.appliedQuery !== qProject)) {
      local.filter = qProject || (state.ui?.tasksProjectFilter && (state.ui.tasksProjectFilter === 'all' || getProject(state.ui.tasksProjectFilter)) ? state.ui.tasksProjectFilter : 'all');
      local.appliedQuery = qProject;
      local.page = 1; local.logsSnapshot = null;
      if (qProject && state.ui?.tasksProjectFilter !== qProject) setUi({ tasksProjectFilter: qProject });
    }
    local.q ??= '';
    local.step ??= 'all';
    local.status ??= 'all';
    local.page ??= 1;
    local.auto ??= state.ui?.autoRefresh !== false;
    local.logsPaused ??= false;
    // Auto-refresh countdown is driven by a wall-clock deadline so it survives the ~350 ms re-renders while tasks run.
    if (local.auto) {
      if (!local.nextRefreshAt || local.nextRefreshAt <= Date.now()) local.nextRefreshAt = Date.now() + REFRESH_SECS * 1000;
      local.countdown = Math.max(0, Math.ceil((local.nextRefreshAt - Date.now()) / 1000));
    } else { local.nextRefreshAt = null; local.countdown = REFRESH_SECS; }

    const filter = local.filter;
    const project = filter === 'all' ? null : getProject(filter);
    const stats = taskStats(filter);
    const allTasks = state.tasks.filter(t => inScope(t, filter));
    const runningList = allTasks.filter(t => t.status === 'running');
    const isRunning = runningList.length > 0;
    const queuedCount = allTasks.filter(t => t.status === 'queued').length;
    // Work "Execute All Tasks" would actually (re)start: failed/cancelled tasks + uploaded docs with no pending task yet.
    // Queued tasks are already owned by the engine, so they don't count as new work.
    const runnable = allTasks.filter(t => ['failed', 'cancelled'].includes(t.status)).length
      + state.documents.filter(d => inScope(d, filter) && d.status === 'uploaded'
          && !state.tasks.some(t => t.inputDocId === d.id && ['queued', 'running'].includes(t.status))).length;
    // Per spec the button is disabled while a batch runs — unless there is new work it can schedule (never a dead click).
    const executeDisabled = isRunning && !runnable;
    const executeTip = runnable ? `${runnable} task${runnable === 1 ? '' : 's'} ready to run`
      : isRunning ? `${runningList.length} task${runningList.length === 1 ? '' : 's'} running` + (queuedCount ? ` · ${queuedCount} queued` : '')
      : queuedCount ? `${queuedCount} task${queuedCount === 1 ? '' : 's'} already queued` : 'Nothing queued';

    /* ---- filtered / sorted / paged rows ---- */
    const q = local.q.trim().toLowerCase();
    let rows = allTasks.filter(t =>
      (local.step === 'all' || t.step === local.step) &&
      (local.status === 'all' || t.status === local.status) &&
      (!q || t.label.toLowerCase().includes(q) || (t.inputDoc || '').toLowerCase().includes(q) || t.id.toLowerCase().includes(q)));
    rows = sortTasks(rows);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (local.page > pages) local.page = pages;
    if (local.page < 1) local.page = 1;
    const pageRows = rows.slice((local.page - 1) * PAGE_SIZE, local.page * PAGE_SIZE);

    /* ---- active node ---- */
    const latestRunning = [...runningList].sort((a, b) => (b.startedAt || b.createdAt) - (a.startedAt || a.createdAt))[0];
    const activeNode = project?.node || (filter === 'all' ? (state.settings?.org?.region || state.meta?.node) : latestRunning?.node) || state.meta?.node || 'EU-WEST-1';

    /* ---- logs ---- */
    if (!local.logsPaused || !local.logsSnapshot) {
      local.logsSnapshot = [...getLogs(filter)].sort((a, b) => b.ts - a.ts).slice(0, 40);
    }
    const logs = local.logsSnapshot;

    /* ================= top bar ================= */
    ctx.topbar.innerHTML = `
      ${searchBox({ id: 'tasks-search', placeholder: 'Search tasks...', value: local.q })}
      <label class="project-filter" for="tasks-project"><span class="project-filter-label">Project:</span>
        <select class="select project-select" id="tasks-project" data-action="filter-project">
          <option value="all" ${filter === 'all' ? 'selected' : ''}>All Projects</option>
          ${state.projects.map(p => `<option value="${esc(p.id)}" ${filter === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
      </label>
      <span class="grow"></span>
      ${topbarActions()}`;

    /* ================= content ================= */
    ctx.content.innerHTML = `
      <div class="page-header tasks-header">
        <div>
          <h1 class="page-title">Workflow Orchestration</h1>
          <p class="page-subtitle">Real-time task monitoring and pipeline management for UN SDG data reporting.</p>
        </div>
        <div class="automation-panel ${isRunning ? 'is-running' : ''}">
          <div class="automation-text">
            <div class="automation-label">Automation Engine</div>
            <div class="automation-state">${isRunning ? `<span class="pulse-dot"></span>Batch Process<br>Running` : 'Batch Process<br>Ready'}</div>
            <div class="automation-cost">Total cost: ${fmtCost(stats.cost)}</div>
          </div>
          <div class="automation-divider"></div>
          <button class="btn btn-sky automation-btn" data-action="execute-all" ${executeDisabled ? 'disabled' : ''} data-tip="${esc(executeTip)}">
            ${executeDisabled ? `${icon('loader-2', 'spin-slow')}Running (${runningList.length})…` : `${icon('play')}Execute All Tasks`}
          </button>
        </div>
      </div>

      <div class="stat-grid tasks-stats">
        <div class="stat-card"><div class="stat-label">Running Tasks</div><div class="stat-value-row"><span class="stat-value">${String(stats.running).padStart(2, '0')}</span>${icon('refresh-cw', `stat-icon ${isRunning ? 'spin-slow' : ''}`)}</div></div>
        <div class="stat-card"><div class="stat-label">Failed (24h)</div><div class="stat-value-row"><span class="stat-value danger">${String(stats.failed24h).padStart(2, '0')}</span>${icon('alert-circle', 'stat-icon danger')}</div></div>
        <div class="stat-card"><div class="stat-label">Completion Rate</div><div class="stat-value-row"><span class="stat-value">${fmtPct(stats.completionRate, 1)}</span>${icon('check-circle', 'stat-icon success')}</div></div>
        <div class="stat-card"><div class="stat-label">Active Node</div><div class="stat-value-row"><span class="stat-value mono-sm">${esc(activeNode)}</span>${icon('server', 'stat-icon node')}</div></div>
      </div>

      <div class="card tasks-table-card">
        <div class="table-toolbar">
          <span class="filter-label">Step type:</span>
          <select class="select select-sm" id="tasks-step" data-action="filter-step">
            <option value="all" ${local.step === 'all' ? 'selected' : ''}>All Steps</option>
            ${STEP_ORDER.map(k => `<option value="${k}" ${local.step === k ? 'selected' : ''}>${esc(STEP_META[k].label)}</option>`).join('')}
          </select>
          <span class="filter-label">Status:</span>
          <select class="select select-sm" id="tasks-status" data-action="filter-status">
            ${STATUS_OPTIONS.map(([v, l]) => `<option value="${v}" ${local.status === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <span class="grow"></span>
          <button class="auto-refresh ${local.auto ? 'on' : ''}" data-action="toggle-auto" data-tip="${local.auto ? 'Click to pause auto-refresh' : 'Click to enable auto-refresh'}">
            ${icon('refresh-cw', 'icon-sm')}<span>Auto-refresh:</span><strong>${local.auto ? `${local.countdown}s` : 'Off'}</strong>
          </button>
        </div>
        <div class="table-wrap">
        <table class="table tasks-table">
          <thead><tr>
            <th>Step Name</th><th>Input Document</th><th>Status</th><th>Created At</th><th>Duration</th><th>Cost</th><th class="th-right">Actions</th>
          </tr></thead>
          <tbody>
            ${pageRows.length ? pageRows.map(t => `
              <tr class="clickable ${t.status === 'failed' ? 'row-failed' : ''}" data-action="open-task" data-id="${esc(t.id)}">
                <td><div class="step-name">${icon(STEP_META[t.step]?.icon || 'box', `step-icon ${t.status === 'failed' ? 'danger-text' : ''}`)}<span class="cell-title">${esc(t.label)}</span></div></td>
                <td class="mono">${esc(t.inputDoc || '—')}</td>
                <td>${statusCell(t)}</td>
                <td>${dateTimeCell(t.createdAt)}</td>
                <td class="mono">${durationCell(t)}</td>
                <td>${costCell(t)}</td>
                <td class="td-right"><div class="table-actions">${actionCell(t)}</div></td>
              </tr>`).join('') : `
              <tr><td colspan="7"><div class="empty">${icon('clipboard-list')}<div class="empty-title">No tasks match</div><div class="empty-sub">${allTasks.length ? 'Try a different step type, status or search term.' : 'Run a pipeline from a project to see tasks here.'}</div>${(q || local.step !== 'all' || local.status !== 'all') ? `<button class="btn btn-light btn-sm mt-12" data-action="clear-filters">Clear filters</button>` : ''}</div></td></tr>`}
          </tbody>
        </table>
        </div>
        <div class="table-footer">
          <span>Showing <strong>${pageRows.length}</strong> of <strong>${rows.length}</strong> tasks${rows.length !== allTasks.length ? ` <span class="muted">(${allTasks.length} total)</span>` : ''}</span>
          <div class="pager-wrap"><span class="muted xs">Page ${local.page} / ${pages}</span>
            <div class="pager">
              <button data-action="page-prev" ${local.page <= 1 ? 'disabled' : ''} aria-label="Previous page">${icon('chevron-left', 'icon-sm')}</button>
              <button data-action="page-next" ${local.page >= pages ? 'disabled' : ''} aria-label="Next page">${icon('chevron-right', 'icon-sm')}</button>
            </div>
          </div>
        </div>
      </div>

      <div class="tasks-bottom">
        <div class="card flow-card">
          <div class="card-header"><div class="card-title">Pipeline Visualizer</div><span class="badge badge-sky live-pill ${isRunning ? 'pulse' : ''}">Live Flow</span></div>
          <div class="card-body flow-body">
            <div class="flow">
              ${FLOW_NODES.map((n, i) => `${i ? `<div class="flow-link ${flowLinkCls(n, allTasks)}"></div>` : ''}${flowNodeHtml(n, allTasks, filter)}`).join('')}
            </div>
            <div class="flow-legend"><span><i class="lg done"></i>Completed</span><span><i class="lg running"></i>Running</span><span><i class="lg idle"></i>Idle</span><span class="grow"></span><span class="mono muted">${allTasks.length} tasks · ${fmtCost(stats.cost)} total</span></div>
          </div>
        </div>
        <div class="console logs-console">
          <div class="console-title"><span>Orchestrator Logs</span>
            <span class="console-tools">
              <button class="console-btn" data-action="copy-logs" data-tip="Copy logs">${icon('copy', 'icon-sm')}</button>
              <button class="console-btn ${local.logsPaused ? 'active' : ''}" data-action="toggle-logs" data-tip="${local.logsPaused ? 'Resume live logs' : 'Pause live logs'}">${icon(local.logsPaused ? 'play' : 'pause', 'icon-sm')}</button>
              <span class="live-dot ${isRunning && !local.logsPaused ? 'on' : ''}"></span>
            </span>
          </div>
          <div class="logs-body">
            ${logs.length ? logs.map(l => `<div class="log-line ${l.level.toLowerCase()}"><span class="ts">[${fmtTime(l.ts)}]</span> <span class="lvl">${esc(l.level)}:</span> ${esc(l.msg)}</div>`).join('') : '<div class="log-line debug">No log entries for this scope yet.</div>'}
          </div>
        </div>
      </div>`;
    ctx.footer.innerHTML = '';

    /* ================= events ================= */
    const unbinds = [];
    unbinds.push(bindActions(ctx.topbar, {
      'filter-project': (el) => {
        local.filter = el.value; local.page = 1; local.logsSnapshot = null;
        setUi({ tasksProjectFilter: el.value });
        ctx.rerender();
        const p = el.value === 'all' ? null : getProject(el.value);
        toast.info('Project filter updated', p ? p.name : 'All projects');
      },
    }, 'change'));
    const searchEl = ctx.topbar.querySelector('#tasks-search');
    searchEl?.addEventListener('input', () => { local.q = searchEl.value; local.page = 1; ctx.rerender(); });

    unbinds.push(bindActions(ctx.content, {
      'filter-step': (el) => { local.step = el.value; local.page = 1; ctx.rerender(); },
      'filter-status': (el) => { local.status = el.value; local.page = 1; ctx.rerender(); },
    }, 'change'));

    unbinds.push(bindActions(ctx.content, {
      'execute-all': (el) => {
        if (el.disabled || local.executing) return;
        local.executing = true; // guard against double clicks before the re-render swaps the button
        setTimeout(() => { local.executing = false; }, 600);
        if (!runnable) {
          if (queuedCount) {
            executeAllTasks(filter); // nudges the engine for tasks that are already queued
            toast.info('Nothing new to run', `${queuedCount} task${queuedCount === 1 ? '' : 's'} already queued${project ? ` for ${project.name}` : ''} — the engine will pick them up.`);
          } else {
            toast.info('Nothing queued', 'No failed or cancelled tasks and no unprocessed documents in this scope.');
          }
          return;
        }
        executeAllTasks(filter);
        toast.success('Batch execution started', `${runnable} task${runnable === 1 ? '' : 's'} scheduled${project ? ` for ${project.name}` : ' across all projects'}.`);
      },
      'toggle-auto': () => {
        local.auto = !local.auto; local.nextRefreshAt = local.auto ? Date.now() + REFRESH_SECS * 1000 : null;
        setUi({ autoRefresh: local.auto });
        toast.info(local.auto ? 'Auto-refresh enabled' : 'Auto-refresh paused', local.auto ? `Refreshing every ${REFRESH_SECS}s` : 'Table will update only on state changes.');
      },
      'open-task': (el) => openTaskDrawer(el.dataset.id),
      'cancel-task': (el, ev) => {
        ev.stopPropagation();
        const t = state.tasks.find(x => x.id === el.dataset.id);
        cancelTask(el.dataset.id);
        toast.warning('Task cancelled', t ? `${t.label} — ${t.inputDoc}` : el.dataset.id);
      },
      'retry-task': (el, ev) => {
        ev.stopPropagation();
        const t = state.tasks.find(x => x.id === el.dataset.id);
        retryTask(el.dataset.id);
        toast.info('Task re-queued', t ? `${t.label} — ${t.inputDoc}` : el.dataset.id);
      },
      'clear-filters': () => { local.q = ''; local.step = 'all'; local.status = 'all'; local.page = 1; ctx.rerender(); },
      'page-prev': () => { if (local.page > 1) { local.page -= 1; ctx.rerender(); } },
      'page-next': () => { if (local.page < pages) { local.page += 1; ctx.rerender(); } },
      'copy-logs': () => {
        const text = logs.map(l => `[${fmtTime(l.ts)}] ${l.level}: ${l.msg}`).join('\n');
        // navigator.clipboard.writeText rejects (unhandled) when the document isn't focused / permission is denied:
        // swallow the rejection and fall back to the legacy execCommand path so the button never throws.
        const fallback = () => {
          try {
            const ta = document.createElement('textarea');
            ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
          } catch { /* ignore */ }
        };
        try {
          const p = navigator.clipboard?.writeText(text);
          if (p && typeof p.catch === 'function') p.catch(fallback); else fallback();
        } catch { fallback(); }
        toast.success('Logs copied', `${logs.length} lines copied to clipboard.`);
      },
      'toggle-logs': () => {
        local.logsPaused = !local.logsPaused;
        if (!local.logsPaused) local.logsSnapshot = null;
        toast.info(local.logsPaused ? 'Logs paused' : 'Logs resumed');
        ctx.rerender();
      },
    }));

    refreshIcons(ctx.content);

    /* ---- auto-refresh countdown ---- */
    let timer = null;
    if (local.auto) {
      timer = setInterval(() => {
        if (Date.now() >= local.nextRefreshAt) {
          // wrap-around: full re-render (keeps elapsed durations / relative times fresh even when nothing runs)
          local.nextRefreshAt = Date.now() + REFRESH_SECS * 1000;
          ctx.rerender();
          return;
        }
        local.countdown = Math.max(0, Math.ceil((local.nextRefreshAt - Date.now()) / 1000));
        const el = ctx.content.querySelector('.auto-refresh strong');
        if (el) el.textContent = `${local.countdown}s`;
      }, 1000);
    }

    return () => { clearInterval(timer); unbinds.forEach(u => u()); };
  },
};

function flowLinkCls(node, tasks) {
  const mine = tasks.filter(t => node.steps.includes(t.step));
  if (mine.some(t => t.status === 'running')) return 'running';
  if (mine.some(t => t.status === 'success')) return 'done';
  return '';
}
