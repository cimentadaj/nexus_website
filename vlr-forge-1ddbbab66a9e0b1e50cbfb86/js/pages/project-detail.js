/* Project detail — Overview (mock-up 02) and History view. Route #/projects/:id and #/projects/:id/history */
import { esc, icon, fmtCost, fmtDateTime, fmtDuration, fmtBytes, relTime, relTimeShort, fileTypeIcon, statusBadge, progressHtml, bindActions, toast, openMenu, confirmDialog, sum, fmtPct, fmtTime, sdgChip, SDG_COLORS, SDG_TITLES } from '../ui.js';
import { getProject, getProjectDocs, getProjectTasks, getProjectExtractions, getProjectRuns, getProjectReports, getProjectActivity, projectStats, getTask, getDoc, getLogs } from '../store.js';
import { runPipeline, runStep, approveAll, startParse, translateDocument, deleteDocument, composeChapters, runPreprocessing, reprocessDocument, approveExtraction, unapproveExtraction } from '../actions.js';
import { openConfigureProjectModal, openAddExtractionModal, openTaskDrawer, openDocumentDrawer, downloadReport } from '../modals.js';
import { topbarActions, searchBox, topbarTabs, statusBarHtml, projectStepper } from '../shell.js';
import { PILLARS, STEP_META, STEP_ORDER, parsedDocMeta, quotePlain, fillTemplate, INDICATOR_OBSERVATIONS, defaultObservation } from '../seed.js';
import { navigate } from '../router.js';

const PILLAR_KEYS = PILLARS.map(p => p.key);
const DOCS_PREVIEW = 6;
const EXT_FILTERS = [
  { key: 'all', label: 'All statuses' },
  { key: 'pending', label: 'Pending review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rerun_queued', label: 'Rerun queued' },
];

/* ---------- helpers ---------- */
const isPending = (e) => e.status === 'extracted' || e.status === 'manual';
const matchQ = (q, ...fields) => !q || fields.some(f => String(f || '').toLowerCase().includes(q));

function extValueLine(e) {
  if (e.pillar === 'indicators') {
    const unit = e.unit || '';
    const v = /%/.test(unit) ? `${esc(e.value)}%` : `${esc(e.value)}${unit ? ' ' + esc(unit) : ''}`;
    return `<span class="ext-k">Val:</span> <span class="ext-v">${v}</span>`;
  }
  if (e.pillar === 'documentary') return `<span class="ext-v">${esc(e.category || '—')}</span> <span class="ext-sep">·</span> <span class="ext-k">${esc(e.categoryLabel || '')}</span>`;
  if (e.pillar === 'projects') return `<span class="ext-k">Status:</span> <span class="ext-v">${esc(e.projectStatus || '—')}</span>${e.budget ? ` <span class="ext-sep">·</span> <span class="ext-v">${esc(e.budget)}</span>` : ''}`;
  return `<span class="ext-k">Group:</span> <span class="ext-v">${esc(e.group || '—')}</span>${e.engagement ? ` <span class="ext-sep">·</span> <span class="ext-k">${esc(e.engagement)}</span>` : ''}`;
}

/* Indicators pillar: wide year-matrix — one column per year (2000..today), each
 * number is its own extraction, inspectable and confirmable on its own */
function indicatorsMatrixHtml(ctx, exts) {
  const sel = ctx.local.mxSdg && ctx.local.mxSdg !== 'all' ? Number(ctx.local.mxSdg) : null;
  const shown = sel ? exts.filter(e => e.goal === sel) : exts;
  // fixed grid: 2000, 2010, 2015, then annually 2016-2025
  const years = [2000, 2010, 2015];
  for (let y = 2016; y <= 2025; y++) years.push(y);
  const rows = []; const byKey = new Map();
  for (const e of shown) {
    const k = e.sdg + '|' + e.title;
    if (!byKey.has(k)) { byKey.set(k, { sdg: e.sdg, goal: e.goal, title: e.title, name: e.indicator || e.title, unit: e.unit, cells: {} }); rows.push(byKey.get(k)); }
    if (e.year) byKey.get(k).cells[e.year] = e;
  }
  const dir = ctx.local.mxSort;
  if (dir) rows.sort((a, b) => dir === 'az' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
  return `<div class="pd-mx-wrap"><table class="table pd-mx-table">
    <thead><tr><th class="pd-mx-sdgcol pd-mx-sortable" data-action="mx-sdg-menu" data-tip="Filter by SDG">${sel ? sdgChip(sel, { title: false }) : 'SDG'} ${icon('chevron-down', 'icon-xs faint')}</th><th class="pd-mx-sticky pd-mx-sortable" data-action="mx-sort" data-tip="Sort by indicator name">Indicator ${dir ? icon(dir === 'az' ? 'arrow-down-a-z' : 'arrow-up-a-z', 'icon-xs') : icon('arrow-up-down', 'icon-xs faint')}</th>${years.map(y => `<th class="pd-mx-year">${y}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => { const key = r.sdg + '|' + r.title; return `<tr class="clickable ${ctx.local.extRow === key ? 'row-sel' : ''}" data-action="ext-row" data-key="${esc(key)}">
      <td class="pd-mx-sdgcol">${sdgChip(r.goal)}</td>
      <td class="pd-mx-sticky" style="border-left:3px solid ${SDG_COLORS[r.goal]}"><div class="pd-mx-namewrap"><div><span class="pd-mx-code mono">${esc(r.sdg)}</span><span class="pd-mx-name">${esc(r.name)}</span></div>${Object.values(r.cells).some(isPending)
        ? `<span data-tip="Confirm every number in this row"><button class="btn-icon pd-mx-rowok" data-action="row-confirm-all" data-key="${esc(key)}">${icon('check-check', 'icon-sm')}</button></span>`
        : `<span class="pd-mx-rowdone" data-tip="All numbers confirmed">${icon('check-circle', 'icon-sm')}</span>`}</div></td>
      ${years.map(y => { const e = r.cells[y];
        return `<td class="pd-mx-td">${e ? `<span class="pd-mx-cell st-${esc(e.status)}">${esc(e.value)}</span>` : ''}</td>`; }).join('')}
    </tr>`; }).join('')}</tbody>
  </table></div>`;
}

/* Documentary pillar: key-insight table — SDG chip, one-two sentence insight, category */
const DOC_CAT_CLASS = { Challenge: 'cat-challenge', Commitment: 'cat-commitment', Policy: 'cat-policy' };
function documentaryTableHtml(ctx, exts) {
  const sel = ctx.local.docSdg && ctx.local.docSdg !== 'all' ? Number(ctx.local.docSdg) : null;
  const cat = ctx.local.docCat && ctx.local.docCat !== 'all' ? ctx.local.docCat : null;
  const shown = exts.filter(e => (!sel || e.goal === sel) && (!cat || e.categoryLabel === cat));
  return `<div class="pd-table-wrap"><table class="table pd-doc-table">
    <thead><tr>
      <th class="pd-doc-sdgth pd-mx-sortable" data-action="doc-sdg-menu" data-tip="Filter by SDG">${sel ? sdgChip(sel, { title: false }) : 'SDG'} ${icon('chevron-down', 'icon-xs faint')}</th>
      <th class="pd-mx-sortable" data-action="doc-cat-menu" data-tip="Filter by category">${cat ? `<span class="badge pd-doc-cat ${DOC_CAT_CLASS[cat] || ''}">${esc(cat)}</span>` : 'Category'} ${icon('chevron-down', 'icon-xs faint')}</th>
      <th class="pd-doc-okth">Confirm</th>
      <th>Key insight</th></tr></thead>
    <tbody>${shown.map(e => `
      <tr class="clickable ${ctx.local.extSel === e.id ? 'row-sel' : ''}" data-action="ext-sel" data-id="${esc(e.id)}">
        <td class="pd-doc-sdgtd">${sdgChip(e.goal)}</td>
        <td><span class="badge pd-doc-cat ${DOC_CAT_CLASS[e.categoryLabel] || ''}">${esc(e.categoryLabel || '—')}</span></td>
        <td class="pd-doc-oktd">${e.status === 'approved'
          ? `<span data-tip="Approved${e.reviewedBy ? ' by ' + esc(e.reviewedBy) : ''} — click to undo"><button class="btn-icon success-text" data-action="ext-unapprove" data-id="${esc(e.id)}">${icon('check-circle', 'icon-sm')}</button></span>`
          : `<button class="btn btn-light btn-xs" data-action="ext-approve" data-id="${esc(e.id)}">${icon('check', 'icon-xs')}Confirm</button>`}</td>
        <td class="pd-doc-insight">${esc(e.summary || e.title)}</td>
      </tr>`).join('')}</tbody>
  </table></div>
  ${!shown.length ? `<div class="empty"><div class="empty-sub">No entries match the current filters.</div></div>` : ''}`;
}

/* Projects pillar: SDG | status | confirm | project name | period — documentary conventions */
const PROJ_STATUS_LABEL = { 'In execution': 'Ongoing', Planned: 'Planned', Completed: 'Completed' };
const PROJ_STATUS_CLASS = { 'In execution': 'st-ongoing', Planned: 'st-planned', Completed: 'st-completed' };
function projectsTableHtml(ctx, exts) {
  const sel = ctx.local.projSdg && ctx.local.projSdg !== 'all' ? Number(ctx.local.projSdg) : null;
  const st = ctx.local.projStatus && ctx.local.projStatus !== 'all' ? ctx.local.projStatus : null;
  const shown = exts.filter(e => (!sel || e.goal === sel) && (!st || e.projectStatus === st));
  return `<div class="pd-table-wrap"><table class="table pd-doc-table">
    <thead><tr>
      <th class="pd-doc-sdgth pd-mx-sortable" data-action="proj-sdg-menu" data-tip="Filter by SDG">${sel ? sdgChip(sel, { title: false }) : 'SDG'} ${icon('chevron-down', 'icon-xs faint')}</th>
      <th class="pd-mx-sortable" data-action="proj-status-menu" data-tip="Filter by status">${st ? `<span class="badge pd-doc-cat ${PROJ_STATUS_CLASS[st] || ''}">${esc(PROJ_STATUS_LABEL[st] || st)}</span>` : 'Status'} ${icon('chevron-down', 'icon-xs faint')}</th>
      <th class="pd-doc-okth">Confirm</th>
      <th>Project</th>
      <th>Start / End</th></tr></thead>
    <tbody>${shown.map(e => `
      <tr class="clickable ${ctx.local.extSel === e.id ? 'row-sel' : ''}" data-action="ext-sel" data-id="${esc(e.id)}">
        <td class="pd-doc-sdgtd">${sdgChip(e.goal)}</td>
        <td><span class="badge pd-doc-cat ${PROJ_STATUS_CLASS[e.projectStatus] || ''}">${esc(PROJ_STATUS_LABEL[e.projectStatus] || e.projectStatus || '—')}</span></td>
        <td class="pd-doc-oktd">${e.status === 'approved'
          ? `<span data-tip="Approved${e.reviewedBy ? ' by ' + esc(e.reviewedBy) : ''} — click to undo"><button class="btn-icon success-text" data-action="ext-unapprove" data-id="${esc(e.id)}">${icon('check-circle', 'icon-sm')}</button></span>`
          : `<button class="btn btn-light btn-xs" data-action="ext-approve" data-id="${esc(e.id)}">${icon('check', 'icon-xs')}Confirm</button>`}</td>
        <td class="pd-doc-insight">${esc(e.title)}</td>
        <td class="xs mono">${esc(e.period || '—')}</td>
      </tr>`).join('')}</tbody>
  </table></div>
  ${!shown.length ? `<div class="empty"><div class="empty-sub">No projects match the current filters.</div></div>` : ''}`;
}

/* per-project UI memory: active pillar tab, selected extraction, filter — survives
 * navigating away (e.g. into the document viewer) and back */
const uiMemo = {};

function extCells(e) {
  if (e.pillar === 'indicators') return [e.value ?? '—', e.unit || '—'];
  if (e.pillar === 'documentary') return [e.category || '—', e.categoryLabel || '—'];
  if (e.pillar === 'projects') return [e.projectStatus || '—', e.budget || '—'];
  return [e.group || '—', e.engagement || '—'];
}

function extStatusMark(e) {
  if (e.status === 'approved') return `<span class="ext-mark approved" data-tip="Approved${e.reviewedBy ? ' by ' + esc(e.reviewedBy) : ''}">${icon('check', 'icon-xs')}</span>`;
  if (e.status === 'rerun_queued') return `<span class="ext-mark rerun" data-tip="Rerun queued">${icon('rotate-ccw', 'icon-xs')}</span>`;
  if (e.status === 'manual') return `<span class="ext-mark manual" data-tip="Added manually">${icon('pencil', 'icon-xs')}</span>`;
  if (e.status === 'rejected') return `<span class="ext-mark rejected" data-tip="Rejected">${icon('x', 'icon-xs')}</span>`;
  return '';
}

function taskMilestone(t, project) {
  const docs = getProjectDocs(project.id).length;
  const ext = getProjectExtractions(project.id);
  const nInd = ext.filter(e => e.pillar === 'indicators').length;
  const map = {
    analyse: `Analysing trends for ${nInd} indicators`,
    documentary: `Scanning ${docs} documents for challenges, commitments & policies`,
    projects: `Merging city projects across ${docs} documents`,
    stakeholders: `Clustering community voices across ${docs} documents`,
    validation: `Validating ${ext.length} extractions against the VLR schema`,
    normalization: `Rescaling ${nInd} indicators to the 0–100 SDG-TC band`,
    provenance: `Generating source lineage for ${nInd} indicators`,
    export: `Writing harmonized workbook (${ext.length} rows)`,
    report: `Composing ${t.inputDoc}`,
  };
  return map[t.step] || `Processing ${t.inputDoc}`;
}

function taskSubLine(t, project) {
  const meta = STEP_META[t.step] || {};
  if (t.step === 'parse' || t.step === 'xml_extraction') return `Parsing: <span class="mono">${esc(t.inputDoc)}</span>`;
  if (t.step === 'translate') {
    const d = t.inputDocId ? getDoc(t.inputDocId) : null;
    const from = d?.language || project.languages?.find(l => l !== 'EN') || 'ES';
    return `Target: <span class="mono">${esc(from)} → EN</span>`;
  }
  if (t.step === 'extract_indicators') return `Extracting: <span class="mono">${esc(t.inputDoc)}</span>`;
  if (meta.scope === 'document') return `Input: <span class="mono">${esc(t.inputDoc)}</span>`;
  return `Action: ${esc(taskMilestone(t, project))}`;
}

const hasPendingTask = (docId, steps) => getProjectTasks(getDoc(docId)?.projectId || '').some(t => t.inputDocId === docId && steps.includes(t.step) && (t.status === 'queued' || t.status === 'running'));
const depsPending = (t) => (t.dependsOn || []).some(id => { const d = getTask(id); return d && d.status !== 'success' && d.status !== 'cancelled'; });

function runTasks(r) { return getProjectTasks(r.projectId).filter(t => t.runId === r.id); }
function runCost(r) { return r.totalCost != null ? Number(r.totalCost) : sum(runTasks(r), t => t.cost); }
function runDuration(r) { return (r.finishedAt || Date.now()) - r.startedAt; }

function docFilterLabel(f) {
  if (!f || f === 'all') return 'Filter';
  if (f === 'translation') return 'Filter: Translation pending';
  const [kind, val] = f.split(':');
  return `Filter: ${kind === 'status' ? val[0].toUpperCase() + val.slice(1) : val}`;
}
function applyDocFilter(docs, f) {
  if (!f || f === 'all') return docs;
  if (f === 'translation') return docs.filter(d => d.language !== 'EN' && !d.translated);
  const [kind, val] = f.split(':');
  return docs.filter(d => kind === 'status' ? d.status === val : d.type === val);
}

/* ---------- top bar ---------- */
function topbarHtml(ctx, project, active) {
  return `
    <div class="breadcrumb"><span class="crumb-current">${esc(project.name)}</span></div>
    ${searchBox({ id: 'pd-search', placeholder: 'Search project data...', value: ctx.local.q || '' })}
    <span class="grow"></span>
    ${topbarActions({ projectId: project.id, upload: false })}`;
}

/* =========================================================================
 * Preprocessing landing (step 1: parse · translate · wiki load)
 * ======================================================================= */
const PP_PILL = {
  done: (l) => `<span class="pp-pill done">${icon('check', 'icon-xs')}${l}</span>`,
  running: (l) => `<span class="pp-pill running"><span class="pp-dot"></span>${l}</span>`,
  pending: (l) => `<span class="pp-pill pending">${l}</span>`,
  failed: (l, taskId) => `<span class="pp-pill failed" data-action="pp-open-task" data-task="${taskId || ''}" data-tip="Open the task log">${icon('alert-circle', 'icon-xs')}${l}</span>`,
  na: (l) => `<span class="pp-pill na">${l}</span>`,
};
function ppDocState(doc, tasks) {
  const latest = (steps) => tasks.filter(x => x.inputDocId === doc.id && steps.includes(x.step)).sort((a, b) => b.createdAt - a.createdAt)[0];
  const parseTask = latest(['parse', 'xml_extraction']);
  const trTask = latest(['translate']);
  const parse = doc.status === 'processed' ? 'done' : parseTask?.status === 'failed' ? 'failed' : (doc.status === 'parsing' || ['queued', 'running'].includes(parseTask?.status)) ? 'running' : 'pending';
  const translate = doc.language === 'EN' ? 'na' : doc.translated ? 'done' : trTask?.status === 'failed' ? 'failed' : (doc.status === 'translating' || ['queued', 'running'].includes(trTask?.status)) ? 'running' : 'pending';
  return { parse, translate, parseTask, trTask };
}
function ppDocDetail(doc, project, st) {
  const x = parsedDocMeta(doc, project);
  const logs = [...(st.parseTask?.logs || []), ...(st.trTask?.logs || [])].sort((a, b) => a.ts - b.ts);
  const live = st.parse === 'running' || st.translate === 'running';
  const meta = st.parse === 'done' ? `
    <div class="pp-meta-head">${icon('scan-text', 'icon-sm')}Metadata extracted by the parser</div>
    <dl class="kv pp-kv">
      <dt>Document Title</dt><dd>${esc(x.title)}</dd>
      <dt>Document Type</dt><dd>${esc(x.type)}</dd>
      <dt>Document Type Extension</dt><dd class="mono">${esc(x.ext)}</dd>
      <dt>Year of Publication</dt><dd>${esc(x.year)}</dd>
      <dt>Issuing Body</dt><dd>${esc(x.issuing)}</dd>
    </dl>
    <div class="pp-meta-head mt-12">${icon('file-output', 'icon-sm')}Markdown artefact</div>
    <dl class="kv pp-kv">
      <dt>Output</dt><dd class="mono">${esc(x.artefact)}</dd>
      <dt>Pages</dt><dd>${doc.pages} (page numbers preserved for citations)</dd>
      <dt>Tables</dt><dd>${x.tables} rendered as markdown</dd>
      <dt>Images</dt><dd>${x.images} placeholder${x.images === 1 ? '' : 's'} with captions</dd>
    </dl>
    ${doc.language !== 'EN' ? `<div class="pp-meta-head mt-12">${icon('languages', 'icon-sm')}Translation</div>
    <dl class="kv pp-kv">
      <dt>Route</dt><dd>${esc(doc.language)} → EN · ${x.chunks} chunks (Gemini)</dd>
      <dt>Output</dt><dd class="mono">${doc.translated ? esc(x.tArtefact) : '<span class="muted">pending</span>'}</dd>
    </dl>` : `<div class="xs muted mt-12">${icon('languages', 'icon-xs')} Already in English — translation skipped.</div>`}
    <div class="mt-12"><a class="link-text xs" href="#/projects/${esc(project.id)}/documents/${esc(doc.id)}">${icon('eye', 'icon-xs')} Open in Document Viewer</a></div>`
  : `<div class="pp-meta-wait">${st.parse === 'running' ? `${icon('loader-2', 'icon-sm spin')} Parsing — extracting the metadata header, page-by-page markdown and tables…` : st.parse === 'failed' ? `${icon('alert-circle', 'icon-sm danger-text')} Parse failed — see the log; retry from the task.` : `${icon('clock', 'icon-sm')} Not parsed yet — run preprocessing to extract this document.`}</div>`;
  return `
  <tr class="pp-detail-row"><td colspan="4">
    <div class="pp-detail">
      <div class="pp-detail-meta">${meta}</div>
      <div class="pp-detail-log">
        <div class="pp-meta-head">${icon('terminal', 'icon-sm')}Processing log${live ? '<span class="pp-dot" style="margin-left:8px"></span>' : ''}</div>
        <div class="console pp-doc-console">${logs.length ? logs.map(l => `<div class="log-line ${esc(String(l.level || 'INFO').toLowerCase())}"><span class="ts">[${fmtTime(l.ts)}]</span> ${esc(l.msg)}</div>`).join('') : '<div class="log-line debug">No log output yet for this document.</div>'}${live ? '<div class="log-line debug">▊</div>' : ''}</div>
      </div>
    </div>
  </td></tr>`;
}
function preprocessHtml(ctx, project) {
  const docs = getProjectDocs(project.id);
  const tasks = getProjectTasks(project.id);
  const ppTasks = tasks.filter(t => ['parse', 'xml_extraction', 'translate', 'wiki_load'].includes(t.step));
  const running = ppTasks.some(t => ['queued', 'running'].includes(t.status));
  const failed = ppTasks.filter(t => t.status === 'failed').length;
  const done = !!project.preprocessedAt;
  const pendingWork = docs.some(d => d.status !== 'processed' || (d.language !== 'EN' && !d.translated)) || !project.wikiLoaded;
  // expansion is inspection-only: a document opens on click once it is done (or failed) — nothing streams open on its own
  const states = new Map(docs.map(d => [d.id, ppDocState(d, tasks)]));
  const openId = ctx.local.ppSel ?? null;
  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">${esc(project.city)} ${esc(project.year)}</h1>
      <p class="page-subtitle">${icon('layers', 'icon-sm')} Step 1 — Preprocessing · parse the source documents and translate them to English (the SDG reference loads behind the scenes). Once a document is done, click it to inspect what was extracted and its log.</p>
    </div>
    <div class="row gap-6">
      ${running
        ? `<span class="pp-runstate"><span class="pp-dot"></span>Preprocessing running</span>`
        : done && !pendingWork
          ? ''
          : `<button class="btn btn-primary" data-action="run-preprocess" ${docs.length ? '' : 'disabled data-tip="Upload documents first"'}>${icon('play', 'icon-sm')}Run preprocessing</button>`}
    </div>
  </div>
  ${projectStepper(project, 'preprocess')}
  ${failed ? `<div class="callout danger mb-16">${icon('alert-circle')}<span>${failed} preprocessing task${failed === 1 ? '' : 's'} failed — click the red pill on the document to inspect its log and retry.</span></div>` : ''}
  <section class="card">
    <div class="card-header tinted"><div class="card-title-caps">${icon('folder-open')}Source documents (${docs.length})</div><button class="btn btn-light btn-sm" data-action="upload-documents" data-project="${esc(project.id)}">${icon('upload', 'icon-sm')}Upload more documents</button></div>
    ${docs.length ? `<table class="table pp-table">
      <thead><tr><th>Filename</th><th>Language</th><th>Preprocessing</th><th class="th-right"></th></tr></thead>
      <tbody>${docs.map(d => { const st = states.get(d.id); const busy = st.parse === 'running' || st.translate === 'running';
        const docDone = st.parse === 'done' && (st.translate === 'done' || st.translate === 'na');
        const docFailed = st.parse === 'failed' || st.translate === 'failed';
        const inspectable = docDone || docFailed;
        const open = openId === d.id && inspectable;
        const pills = busy ? PP_PILL.running('Processing…')
          : docDone ? `${PP_PILL.done('Parsed')}${st.translate === 'na' ? PP_PILL.na('Translate · not needed (EN)') : PP_PILL.done('Translated')}`
          : docFailed ? `${st.parse === 'failed' ? PP_PILL.failed('Parse failed', st.parseTask?.id) : PP_PILL.done('Parsed')}${st.translate === 'failed' ? PP_PILL.failed('Translation failed', st.trTask?.id) : ''}`
          : PP_PILL.pending('Not processed');
        return `
        <tr class="${inspectable ? 'clickable' : ''} ${open ? 'pp-open' : ''}" ${inspectable ? `data-action="pp-doc" data-doc="${esc(d.id)}"` : ''}>
          <td><div class="row gap-12">${inspectable ? icon(open ? 'chevron-down' : 'chevron-right', 'icon-sm faint') : '<span style="width:15px"></span>'}${fileTypeIcon(d.name)}<span class="cell-title mono">${esc(d.name)}</span></div></td>
          <td><span class="badge badge-lang">${esc(d.language)}</span></td>
          <td><div class="row gap-6 wrap">${pills}</div></td>
          <td class="td-right"><div class="table-actions">
            ${docDone ? `<a class="btn-icon" href="#/projects/${esc(project.id)}/documents/${esc(d.id)}" data-tip="Open in Document Viewer" onclick="event.stopPropagation()">${icon('eye', 'icon-sm')}</a>` : ''}
            <span data-tip="${busy ? 'Processing…' : docDone || docFailed ? 'Reprocess this document (fresh parse and translation)' : 'Preprocess this document only'}"><button class="btn-icon" data-action="pp-run-doc" data-doc="${esc(d.id)}" ${busy ? 'disabled' : ''}>${icon(busy ? 'loader-2' : docDone || docFailed ? 'rotate-ccw' : 'play', busy ? 'icon-sm spin' : 'icon-sm')}</button></span>
          </div></td>
        </tr>${open ? ppDocDetail(d, project, st) : ''}`; }).join('')}</tbody>
    </table>` : `<div class="empty">${icon('file-plus-2')}<div class="empty-title">No source documents yet</div><div class="empty-sub">Upload the city's documents to begin preprocessing.</div><div class="mt-12"><button class="btn btn-primary btn-sm" data-action="upload-documents" data-project="${esc(project.id)}">${icon('upload', 'icon-sm')}Upload documents</button></div></div>`}
  </section>`;
}

function overviewHtml(ctx, project, stats) {
  const q = (ctx.local.q || '').trim().toLowerCase();
  const tab = ctx.local.tab;
  const pillar = PILLARS.find(p => p.key === tab);
  const allExt = getProjectExtractions(project.id);
  const unapproved = allExt.filter(isPending).length;
  const tasks = getProjectTasks(project.id);
  const runActive = getProjectRuns(project.id).some(r => r.status === 'running');
  const docs = getProjectDocs(project.id);
  const cantRun = project.status === 'archived' ? 'Project is archived — restore it to run the pipeline' : runActive ? 'A pipeline run is already in progress' : !docs.length ? 'Upload documents first' : '';
  /* tasks still queued/running per document (so a doc with a pending parse/translate does not offer the same action twice) */
  const pendingByDoc = {};
  tasks.filter(t => t.inputDocId && (t.status === 'queued' || t.status === 'running')).forEach(t => { (pendingByDoc[t.inputDocId] ||= {})[t.step] = t; });

  /* extractions of the active pillar */
  const filter = ctx.local.filter || 'all';
  let exts = allExt.filter(e => e.pillar === tab);
  const pillarTotal = exts.length;
  if (filter === 'pending') exts = exts.filter(isPending);
  else if (filter === 'approved') exts = exts.filter(e => e.status === 'approved');
  else if (filter === 'rerun_queued') exts = exts.filter(e => e.status === 'rerun_queued');
  exts = exts.filter(e => matchQ(q, e.title, e.sdg, e.source?.docName, e.value, e.category, e.group, e.projectStatus));

  /* documents */
  const docFilter = ctx.local.docFilter || 'all';
  const filteredDocs = applyDocFilter(docs, docFilter).filter(d => matchQ(q, d.name, d.type, d.language, d.code, d.status));
  const showAll = !!ctx.local.showAllDocs;
  const shownDocs = showAll ? filteredDocs : filteredDocs.slice(0, DOCS_PREVIEW);

  return `
  <div class="pd-header">
    <div class="pd-header-row">
    <div class="pd-heading">
      <h1 class="page-title">${esc(project.city)} ${esc(project.year)}</h1>
      <div class="pd-meta">${icon('map-pin', 'icon-sm')}<span>${esc(project.city)}, ${esc(project.country)}</span><span class="pd-meta-sep">|</span><span>SDG Reporting Lifecycle: ${esc(stats.phase)}</span></div>
    </div>

    </div>
      ${projectStepper(project, 'overview')}
      <div class="pd-actions">
        <span ${cantRun ? `data-tip="${esc(cantRun)}"` : ''}><button class="btn btn-primary" data-action="run-pipeline" ${cantRun ? 'disabled' : ''}>${icon('play', 'icon-sm')}Run Full Pipeline</button></span>
        <button class="btn btn-light" data-action="configure">${icon('settings', 'icon-sm')}Configure</button>
        ${(() => {
          const st = stats;
          if (st.bookFinal) return `<a class="btn btn-outline" href="#/projects/${project.id}/vlr">${icon('book-open-check', 'icon-sm')}Open final VLR</a>`;
          if (st.hasBook) return `<a class="btn btn-outline" href="#/projects/${project.id}/vlr">${icon('book-open', 'icon-sm')}Review final VLR</a>`;
          if (st.chapters) return `<a class="btn btn-outline" href="#/projects/${project.id}/chapters">${icon('pen-line', 'icon-sm')}Review chapters <span class="pd-count">${st.chaptersApproved}/${st.chapters}</span></a>`;
          const composing = tasks.some(t => t.step === 'compose' && ['queued', 'running'].includes(t.status));
          if (composing) return `<a class="btn btn-outline" href="#/projects/${project.id}/chapters">${icon('loader-2', 'icon-sm spin')}Composing chapters…</a>`;
          return '';
        })()}
      </div>
  </div>

  <div class="pd-grid">
    <section class="card pd-extractions">
      <div class="tabs pd-tabs-actions">
        ${PILLARS.map(p => `<button class="tab ${p.key === tab ? 'active' : ''}" data-action="tab" data-tab="${p.key}">${icon(p.icon)}${esc(p.label)}</button>`).join('')}
        <span class="grow"></span>
        ${exts.some(isPending) ? `<button class="btn btn-primary btn-sm" data-action="confirm-all-shown">${icon('check-check', 'icon-sm')}Confirm all ${tab === 'indicators' ? 'SDG indicators' : esc(pillar.label.toLowerCase())}</button>` : ''}
        <button class="btn btn-light btn-sm" data-action="add-entry">${icon('plus', 'icon-sm')}Add entry</button>
      </div>
      <div class="card-body">
        ${exts.length ? tab === 'indicators' ? indicatorsMatrixHtml(ctx, exts) : tab === 'documentary' ? documentaryTableHtml(ctx, exts) : tab === 'projects' ? projectsTableHtml(ctx, exts) : `<div class="pd-table-wrap"><table class="table pd-ext-table">
          <thead><tr><th>SDG</th><th>Extraction</th><th>Value</th><th>Unit</th><th>Source</th><th></th></tr></thead>
          <tbody>${exts.map(e => { const [val, unit] = extCells(e); return `
            <tr class="clickable ${ctx.local.extSel === e.id ? 'row-sel' : ''}" data-action="ext-sel" data-id="${esc(e.id)}">
              <td><span class="badge badge-sdg">SDG ${esc(e.sdg)}</span></td>
              <td><span class="cell-title">${esc(e.title)}</span></td>
              <td>${esc(val)}</td>
              <td>${esc(unit)}</td>
              <td class="xs muted">${e.source?.page ? `p. ${esc(e.source.page)} · ¶${esc(e.source.paragraph || 1)}` : 'Manual entry'}</td>
              <td class="td-right"><div class="table-actions">${e.status === 'approved'
                ? `<span data-tip="Approved${e.reviewedBy ? ' by ' + esc(e.reviewedBy) : ''} — click to undo"><button class="btn-icon success-text" data-action="ext-unapprove" data-id="${esc(e.id)}">${icon('check-circle')}</button></span>`
                : `<button class="btn btn-light btn-xs" data-action="ext-approve" data-id="${esc(e.id)}">${icon('check', 'icon-xs')}Approve</button>`}</div></td>
            </tr>`; }).join('')}</tbody>
        </table></div>`
        : pillarTotal ? `<div class="empty">${icon('search-x')}<div class="empty-title">No matches</div><div class="empty-sub">No ${esc(pillar.label.toLowerCase())} match the current filter${q ? ' and search' : ''}.</div><button class="btn btn-light btn-sm mt-12" data-action="clear-filters">Clear filters</button></div>`
        : `<div class="empty">${icon(pillar.icon)}<div class="empty-title">No ${esc(pillar.label.toLowerCase())} extracted yet</div><div class="empty-sub">${esc(pillar.desc)}</div><button class="btn btn-primary btn-sm mt-12" data-action="run-pillar" data-step="${esc(pillar.step)}">${icon('play', 'icon-sm')}Run ${esc(pillar.label.toLowerCase())} extraction</button></div>`}
      </div>
    </section>

    <aside class="card pd-queue">
      <div class="card-header tinted"><div class="card-title-caps">${icon('scan-search')}Extraction details</div></div>
      ${(() => {
        if (tab === 'indicators') {
          const key = ctx.local.extRow;
          const group = key ? allExt.filter(e => e.pillar === 'indicators' && e.sdg + '|' + e.title === key).sort((a, b) => (a.year || 0) - (b.year || 0)) : [];
          if (!group.length) return `<div class="empty tq-empty">${icon('mouse-pointer-click')}<div class="empty-title">Nothing selected</div><div class="empty-sub">Click an indicator row to review all of its numbers.</div></div>`;
          const first = group[0];
          const pend = group.filter(isPending);
          const obs = fillTemplate(INDICATOR_OBSERVATIONS[first.sdg] || INDICATOR_OBSERVATIONS.default, project);
          return `<div class="pd-ext-detail">
            <div class="row gap-8 mb-8">${sdgChip(first.goal)}<strong class="pd-rowd-title">${esc(first.indicator || first.title)}</strong></div>
            <div class="row gap-8 mb-8"><span class="grow"></span>
              ${pend.length ? `<button class="btn btn-primary btn-xs" data-action="row-confirm-all" data-key="${esc(key)}">${icon('check-check', 'icon-xs')}Confirm all (${pend.length})</button>` : `<span class="xs success-text">${icon('check-circle', 'icon-xs')} All confirmed</span>`}
            </div>
            <div class="pd-rowd-obs">
              <div class="card-title-caps">${icon('notebook-pen', 'icon-sm')}Observations</div>
              <div class="pd-obs-static">${esc(obs)}</div>
            </div>
            <div class="pd-rowd-list">${group.map(e => { const openCard = !!(ctx.local.rowdOpen || {})[e.id]; return `
              <div class="pd-rowd-item ${e.status === 'approved' ? 'ok' : ''}">
                <div class="pd-rowd-head clickable" data-action="rowd-toggle" data-id="${esc(e.id)}">
                  ${icon(openCard ? 'chevron-down' : 'chevron-right', 'icon-xs faint')}
                  <strong class="mono">${esc(e.year || '—')}</strong>
                  <span class="pd-rowd-val mono">${esc(e.value)}</span><span class="pd-rowd-unit">${esc(e.unit || '')}</span>
                  <span class="grow"></span>
                  ${e.source?.docId ? `<a class="btn-icon" href="#/projects/${esc(project.id)}/documents/${esc(e.source.docId)}?page=${esc(e.source.page || 1)}&hl=${esc(e.id)}" data-tip="See in document (p. ${esc(e.source.page)})" onclick="event.stopPropagation()">${icon('eye', 'icon-sm')}</a>` : ''}
                  ${e.status === 'approved'
                    ? `<span data-tip="Confirmed — click to undo"><button class="btn-icon success-text" data-action="ext-unapprove" data-id="${esc(e.id)}">${icon('check-circle', 'icon-sm')}</button></span>`
                    : `<button class="btn btn-light btn-xs" data-action="ext-approve" data-id="${esc(e.id)}">${icon('check', 'icon-xs')}Confirm</button>`}
                </div>
                ${openCard && e.source?.quote ? `<div class="pd-rowd-quote">${esc(quotePlain(e.source.quote))} <span class="pd-rowd-src">— ${esc(e.source.docName || '')}, p. ${esc(e.source.page || '—')} ¶${esc(e.source.paragraph || 1)}</span></div>` : ''}
              </div>`; }).join('')}</div>
          </div>`;
        }
        const e = allExt.find(x => x.id === ctx.local.extSel);
        if (!e) return `<div class="empty tq-empty">${icon('mouse-pointer-click')}<div class="empty-title">Nothing selected</div><div class="empty-sub">Click a row in the table to inspect the extraction.</div></div>`;
        const srcDoc = e.source?.docId ? getDoc(e.source.docId) : null;
        const dm = srcDoc ? parsedDocMeta(srcDoc, project) : null;
        const obs = defaultObservation(e, project);
        return `<div class="pd-ext-detail">
          <div class="row gap-8 mb-8">${sdgChip(e.goal)}<strong class="pd-rowd-title">${esc(e.title)}</strong></div>
          <div class="pd-rowd-item ${e.status === 'approved' ? 'ok' : ''}">
            <div class="pd-rowd-head">
              <span class="pd-rowd-src">${esc(e.source?.docName || 'Manual entry')}${e.source?.page ? `, p. ${esc(e.source.page)} ¶${esc(e.source.paragraph || 1)}` : ''}</span>
              <span class="grow"></span>
              ${e.source?.docId ? `<a class="btn-icon" href="#/projects/${esc(project.id)}/documents/${esc(e.source.docId)}?page=${esc(e.source.page || 1)}&hl=${esc(e.id)}" data-tip="See in document — switch to the original language there to see the same paragraph highlighted">${icon('eye', 'icon-sm')}</a>` : ''}
              ${e.status === 'approved'
                ? `<span data-tip="Confirmed — click to undo"><button class="btn-icon success-text" data-action="ext-unapprove" data-id="${esc(e.id)}">${icon('check-circle', 'icon-sm')}</button></span>`
                : `<button class="btn btn-light btn-xs" data-action="ext-approve" data-id="${esc(e.id)}">${icon('check', 'icon-xs')}Confirm</button>`}
            </div>
            ${e.source?.quote ? `<div class="pd-rowd-quote">${esc(quotePlain(e.source.quote))}</div>` : ''}
          </div>
          ${e.pillar === 'projects' ? `<dl class="kv mt-12">
            <dt>Description</dt><dd class="pd-dd-wrap">${esc(e.summary || '—')}</dd>
            <dt>Lead department</dt><dd>${esc(e.lead || '—')}</dd>
            <dt>External partner</dt><dd>${esc(e.partner || '—')}</dd>
            <dt>Sector</dt><dd>${esc(e.sector || '—')}</dd>
            <dt>Status</dt><dd>${esc(PROJ_STATUS_LABEL[e.projectStatus] || e.projectStatus || '—')}</dd>
            <dt>Start / End</dt><dd>${esc(e.period || '—')}</dd>
            <dt>Data source</dt><dd>${esc(e.dataSource || '—')}</dd>
          </dl>` : ''}
          ${dm ? `<dl class="kv mt-12">
            <dt>Source document</dt><dd class="mono xs">${esc(srcDoc.name)}</dd>
            <dt>Document title</dt><dd>${esc(dm.title)}</dd>
            <dt>Document type</dt><dd>${esc(dm.type)}</dd>
            <dt>Year published</dt><dd>${esc(dm.year)}</dd>
            <dt>Issuing body</dt><dd>${esc(dm.issuing)}</dd>
            <dt>Page number</dt><dd>${e.source?.page ? esc(e.source.page) : '—'}</dd>
          </dl>` : ''}
          <div class="pd-rowd-obs mt-12">
            <div class="card-title-caps">${icon('notebook-pen', 'icon-sm')}Observations</div>
            <div class="pd-obs-static">${esc(obs)}</div>
          </div>
        </div>`;
      })()}
    </aside>
  </div>`;
}

/* =========================================================================
 * History
 * ======================================================================= */
function historyHtml(ctx, project) {
  const q = (ctx.local.q || '').trim().toLowerCase();
  const runs = getProjectRuns(project.id).sort((a, b) => b.startedAt - a.startedAt);
  const tasks = getProjectTasks(project.id);
  const finished = runs.filter(r => r.status !== 'running');
  const okRuns = finished.filter(r => r.status === 'success').length;
  const successRate = finished.length ? (100 * okRuns / finished.length) : 100;
  const avgMs = finished.length ? sum(finished, r => runDuration(r)) / finished.length : 0;
  const totalCost = sum(tasks, t => t.cost);
  if (!ctx.local.openRuns) ctx.local.openRuns = runs.length ? { [runs[0].id]: true } : {};
  const open = ctx.local.openRuns;
  const shownRuns = runs.filter(r => matchQ(q, r.label, r.note, r.triggeredBy, r.status));
  const reports = getProjectReports(project.id).filter(r => matchQ(q, r.name, r.kind, r.generatedBy));
  const activity = getProjectActivity(project.id).filter(a => ['review', 'upload', 'project'].includes(a.type)).slice(0, 10);

  return `
  <div class="page-header">
    <div><h1 class="page-title">Pipeline History</h1><p class="page-subtitle">Every run, task and deliverable for ${esc(project.name)}, with cost per step and full provenance.</p>${projectStepper(project, 'overview')}</div>
    <div class="row"><button class="btn btn-light" data-action="goto-tasks">${icon('clipboard-list', 'icon-sm')}Open task board</button><button class="btn btn-primary" data-action="new-report" data-project="${esc(project.id)}">${icon('file-output', 'icon-sm')}New Report</button></div>
  </div>

  <div class="stat-grid pd-hist-stats">
    <div class="stat-card"><div class="stat-label">Total runs</div><div class="stat-value-row"><span class="stat-value">${String(runs.length).padStart(2, '0')}</span>${icon('history', 'stat-icon')}</div></div>
    <div class="stat-card"><div class="stat-label">Total cost</div><div class="stat-value-row"><span class="stat-value">${fmtCost(totalCost)}</span>${icon('coins', 'stat-icon')}</div><div class="stat-sub">${tasks.length} tasks · ${tasks.filter(t => t.status === 'success').length} successful</div></div>
    <div class="stat-card"><div class="stat-label">Success rate</div><div class="stat-value-row"><span class="stat-value">${fmtPct(successRate, 1)}</span>${icon('check-circle', 'stat-icon success')}</div></div>
    <div class="stat-card"><div class="stat-label">Avg run duration</div><div class="stat-value-row"><span class="stat-value">${fmtDuration(avgMs)}</span>${icon('timer', 'stat-icon')}</div></div>
  </div>

  <div class="pd-hist-grid">
    <section class="card">
      <div class="card-header tinted"><div class="card-title-caps">${icon('git-commit-horizontal')}Runs</div><span class="xs muted">${shownRuns.length} run${shownRuns.length === 1 ? '' : 's'}</span></div>
      <div class="card-body">
        ${shownRuns.length ? `<div class="timeline">${shownRuns.map(r => {
          const rt = runTasks(r).sort((a, b) => a.createdAt - b.createdAt);
          const isOpen = !!open[r.id];
          return `<div class="timeline-item ${esc(r.status)}">
            <button class="run-head" data-action="toggle-run" data-run="${esc(r.id)}">
              <div class="run-title"><strong>${esc(r.label)}</strong>${statusBadge(r.status)}${icon(isOpen ? 'chevron-up' : 'chevron-down', 'icon-sm muted run-chev')}</div>
              <div class="run-meta"><span>${icon('user', 'icon-xs')}${esc(r.triggeredBy || 'System')}</span><span>${icon('calendar', 'icon-xs')}<span class="mono">${fmtDateTime(r.startedAt)}</span></span><span>${icon('timer', 'icon-xs')}${fmtDuration(runDuration(r))}${r.status === 'running' ? ' (elapsed)' : ''}</span><span>${icon('coins', 'icon-xs')}<span class="cost">${fmtCost(runCost(r))}</span></span><span class="muted">${rt.length} task${rt.length === 1 ? '' : 's'}</span></div>
              ${r.note ? `<div class="run-note">${esc(r.note)}</div>` : ''}
            </button>
            ${isOpen ? `<div class="run-tasks">${rt.length ? `<table class="table table-compact"><thead><tr><th>Step</th><th>Input</th><th>Status</th><th>Duration</th><th>Cost</th><th class="th-right"></th></tr></thead><tbody>${rt.map(t => `<tr class="clickable ${t.status === 'failed' ? 'row-failed' : ''}" data-action="open-task" data-task="${esc(t.id)}">
                <td><span class="row">${icon(STEP_META[t.step]?.icon || 'box', 'icon-sm navy')}<span class="cell-title">${esc(t.label)}</span></span></td>
                <td class="mono">${esc(t.inputDoc)}</td>
                <td>${statusBadge(t.status)}</td>
                <td class="mono">${t.status === 'running' ? fmtDuration(Date.now() - (t.startedAt || Date.now())) : fmtDuration(t.durationMs)}</td>
                <td class="cost">${t.status === 'queued' ? '—' : fmtCost(t.cost)}</td>
                <td class="td-right"><button class="btn-icon" data-action="open-task" data-task="${esc(t.id)}" aria-label="Task details">${icon('eye')}</button></td>
              </tr>`).join('')}</tbody></table>` : '<div class="xs muted" style="padding:10px 0">No task records attached to this run.</div>'}</div>` : ''}
          </div>`; }).join('')}</div>`
        : `<div class="empty">${icon('history')}<div class="empty-title">No pipeline runs yet</div><div class="empty-sub">Start a full pipeline from the Overview tab.</div><button class="btn btn-primary btn-sm mt-12" data-action="run-pipeline-empty">${icon('play', 'icon-sm')}Run Full Pipeline</button></div>`}
      </div>
    </section>

    <div class="pd-hist-side">
      <section class="card">
        <div class="card-header tinted"><div class="card-title-caps">${icon('file-output')}Reports</div><button class="btn btn-light btn-sm" data-action="new-report" data-project="${esc(project.id)}">${icon('plus', 'icon-sm')}New Report</button></div>
        ${reports.length ? `<div class="report-list">${reports.map(r => `<div class="report-row">
            ${fileTypeIcon(r.name)}
            <div class="grow"><div class="report-name">${esc(r.name)}</div><div class="report-meta">${esc(r.kind || r.format.toUpperCase())} · ${fmtBytes(r.sizeKb)} · ${esc(relTime(r.createdAt))}${r.generatedBy ? ` · ${esc(r.generatedBy)}` : ''}</div></div>
            <button class="btn btn-light btn-sm" data-action="download-report" data-report="${esc(r.id)}">${icon('download', 'icon-sm')}Download</button>
          </div>`).join('')}</div>`
        : `<div class="empty">${icon('file-output')}<div class="empty-title">No reports generated</div><div class="empty-sub">Generate a harmonized workbook or a VLR report.</div></div>`}
      </section>

      <section class="card">
        <div class="card-header tinted"><div class="card-title-caps">${icon('activity')}Review activity</div><a class="xs link-text" href="#/audit-log?project=${esc(project.id)}">Audit log</a></div>
        ${activity.length ? `<div class="act-list">${activity.map(a => `<div class="act-row">
            <span class="act-dot ${esc(a.status)}"></span>
            <div class="grow"><div class="act-title">${esc(a.title)}</div><div class="act-meta">${esc(a.actor || 'Pipeline')} · ${esc(relTime(a.ts))}${a.provenance ? ` · <span class="mono">${esc(a.provenance)}</span>` : ''}</div></div>
            ${statusBadge(a.status)}
          </div>`).join('')}</div>`
        : `<div class="empty"><div class="empty-sub">No review activity yet.</div></div>`}
      </section>
    </div>
  </div>`;
}

/* =========================================================================
 * Page module
 * ======================================================================= */
export default {
  title: (ctx) => { const p = getProject(ctx.params.id); return p ? (ctx.route.tab === 'history' ? `${p.name} · History` : p.name) : 'Project'; },
  render(ctx) {
    const project = getProject(ctx.params.id);
    if (!project) {
      ctx.topbar.innerHTML = `<div class="breadcrumb"><span class="crumb-current">Not found</span></div><span class="grow"></span>${topbarActions()}`;
      ctx.content.innerHTML = `<div class="card"><div class="empty">${icon('folder-x')}<div class="empty-title">Project not found</div><div class="empty-sub">The project "${esc(ctx.params.id)}" does not exist or was deleted.</div><a class="btn btn-primary btn-sm mt-12" href="#/projects">Back to projects</a></div></div>`;
      ctx.footer.innerHTML = '';
      return;
    }
    const isHistory = ctx.route.tab === 'history';
    // entering the bare project route while un-preprocessed pins the preprocessing view:
    // finishing the run does NOT auto-advance — the user moves on via the stepper
    const isPre = ctx.route.tab === 'preprocess'
      || (!isHistory && ctx.route.tab !== 'overview' && (!project.preprocessedAt || ctx.local.stickyPre));
    if (isPre) ctx.local.stickyPre = true;
    const memo = (uiMemo[project.id] ||= {});
    if (!ctx.local.tab) {
      ctx.local.tab = PILLAR_KEYS.includes(ctx.query?.tab) ? ctx.query.tab : (memo.tab || 'indicators');
      if (memo.extSel !== undefined) ctx.local.extSel = memo.extSel;
      if (memo.filter) ctx.local.filter = memo.filter;
      if (memo.extRow) ctx.local.extRow = memo.extRow;
      if (memo.mxSdg) ctx.local.mxSdg = memo.mxSdg;
      if (memo.docSdg) ctx.local.docSdg = memo.docSdg;
      if (memo.projSdg) ctx.local.projSdg = memo.projSdg;
      if (memo.projStatus) ctx.local.projStatus = memo.projStatus;
      if (memo.docCat) ctx.local.docCat = memo.docCat;
      if (memo.mxSort) ctx.local.mxSort = memo.mxSort;
    }
    const stats = projectStats(project);

    ctx.topbar.innerHTML = topbarHtml(ctx, project, isHistory ? 'history' : isPre ? 'preprocess' : 'overview');
    ctx.content.innerHTML = `<div class="pd-page">${isHistory ? historyHtml(ctx, project) : isPre ? preprocessHtml(ctx, project) : overviewHtml(ctx, project, stats)}</div>`;
    ctx.footer.innerHTML = statusBarHtml(project);

    /* search (topbar) */
    ctx.topbar.querySelector('#pd-search')?.addEventListener('input', (e) => { ctx.local.q = e.target.value; ctx.rerender(); });

    const pid = project.id;
    const doRunPipeline = () => {
      if (project.status === 'archived') { toast.warning('Project is archived', 'Restore it from the Projects list before running the pipeline.'); return; }
      if (getProjectRuns(pid).some(r => r.status === 'running')) { toast.warning('Run in progress', 'Wait for the current pipeline run to finish.'); return; }
      if (!getProjectDocs(pid).length) { toast.warning('No documents', 'Upload source documents before running the pipeline.'); return; }
      const run = runPipeline(pid);
      if (run) toast.success('Pipeline started', `${run.label} · ${run.taskIds.length} tasks planned`);
      else toast.warning('Nothing to run', 'All documents are already processed and extracted.');
    };
    const doRunStep = (step) => {
      const meta = STEP_META[step];
      const res = runStep(pid, step);
      if (res && res.length) toast.info(`${meta.label} queued`, `${res.length} task${res.length === 1 ? '' : 's'} added to the queue`);
      else toast.warning('Nothing to run', `No documents need "${meta.label}" right now.`);
    };

    const mw = ctx.content.querySelector('.pd-mx-wrap');
    if (mw) {
      mw.scrollLeft = ctx.local.mxScroll ?? mw.scrollWidth;
      mw.addEventListener('scroll', () => { ctx.local.mxScroll = mw.scrollLeft; }, { passive: true });
    }
    const unbindClick = bindActions(ctx.content, {
      'tab': (el) => { ctx.local.tab = el.dataset.tab; ctx.local.filter = 'all'; ctx.local.extSel = null; ctx.local.extRow = null; Object.assign(memo, { tab: el.dataset.tab, filter: 'all', extSel: null, extRow: null }); ctx.rerender(); },
      'confirm-all-shown': () => {
        const sel = ctx.local.mxSdg && ctx.local.mxSdg !== 'all' ? Number(ctx.local.mxSdg) : null;
        const list = getProjectExtractions(pid).filter(e => e.pillar === ctx.local.tab && isPending(e) && (!sel || ctx.local.tab !== 'indicators' || e.goal === sel));
        list.forEach(e => approveExtraction(e.id));
        toast.success('Confirmed', `${list.length} extraction${list.length === 1 ? '' : 's'} approved.`);
        ctx.rerender();
      },
      'rowd-toggle': (el) => { (ctx.local.rowdOpen ||= {})[el.dataset.id] = !(ctx.local.rowdOpen[el.dataset.id]); ctx.rerender(); },
      'ext-row': (el, ev) => { if (ev.target.closest('a, button, textarea')) return; ctx.local.extRow = ctx.local.extRow === el.dataset.key ? null : el.dataset.key; memo.extRow = ctx.local.extRow; ctx.rerender(); },
      'row-confirm-all': (el) => {
        const list = getProjectExtractions(pid).filter(e => e.pillar === 'indicators' && e.sdg + '|' + e.title === el.dataset.key && isPending(e));
        list.forEach(e => approveExtraction(e.id));
        toast.success('Confirmed', `${list.length} number${list.length === 1 ? '' : 's'} approved.`);
        ctx.rerender();
      },
      'doc-sdg-menu': (el, ev) => {
        ev.stopPropagation();
        const setGoal = (g) => { ctx.local.docSdg = g; memo.docSdg = g; ctx.rerender(); };
        const cur = ctx.local.docSdg && ctx.local.docSdg !== 'all' ? Number(ctx.local.docSdg) : null;
        const goals = [...new Set(getProjectExtractions(pid).filter(e => e.pillar === 'documentary').map(e => e.goal))].sort((a, b) => a - b);
        openMenu(el, [
          { label: 'All SDGs', active: !cur, onClick: () => setGoal('all') },
          'divider',
          ...goals.map(g => ({ labelHtml: `${sdgChip(g, { title: false })} <span style="margin-left:6px">SDG ${g} — ${esc(SDG_TITLES[g])}</span>`, active: cur === g, onClick: () => setGoal(String(g)) })),
        ], { align: 'left', minWidth: '280px' });
      },
      'doc-cat-menu': (el, ev) => {
        ev.stopPropagation();
        const setCat = (c) => { ctx.local.docCat = c; memo.docCat = c; ctx.rerender(); };
        const cur = ctx.local.docCat && ctx.local.docCat !== 'all' ? ctx.local.docCat : null;
        openMenu(el, [
          { label: 'All categories', active: !cur, onClick: () => setCat('all') },
          'divider',
          ...['Challenge', 'Commitment', 'Policy'].map(c => ({ label: c, active: cur === c, onClick: () => setCat(c) })),
        ], { align: 'left', minWidth: '200px' });
      },
      'proj-sdg-menu': (el, ev) => {
        ev.stopPropagation();
        const setGoal = (g) => { ctx.local.projSdg = g; memo.projSdg = g; ctx.rerender(); };
        const cur = ctx.local.projSdg && ctx.local.projSdg !== 'all' ? Number(ctx.local.projSdg) : null;
        const goals = [...new Set(getProjectExtractions(pid).filter(e => e.pillar === 'projects').map(e => e.goal))].sort((a, b) => a - b);
        openMenu(el, [
          { label: 'All SDGs', active: !cur, onClick: () => setGoal('all') },
          'divider',
          ...goals.map(g => ({ labelHtml: `${sdgChip(g, { title: false })} <span style="margin-left:6px">SDG ${g} — ${esc(SDG_TITLES[g])}</span>`, active: cur === g, onClick: () => setGoal(String(g)) })),
        ], { align: 'left', minWidth: '280px' });
      },
      'proj-status-menu': (el, ev) => {
        ev.stopPropagation();
        const setSt = (c) => { ctx.local.projStatus = c; memo.projStatus = c; ctx.rerender(); };
        const cur = ctx.local.projStatus && ctx.local.projStatus !== 'all' ? ctx.local.projStatus : null;
        openMenu(el, [
          { label: 'All statuses', active: !cur, onClick: () => setSt('all') },
          'divider',
          ...['In execution', 'Planned', 'Completed'].map(c => ({ label: PROJ_STATUS_LABEL[c] || c, active: cur === c, onClick: () => setSt(c) })),
        ], { align: 'left', minWidth: '200px' });
      },
      'mx-sdg-menu': (el, ev) => {
        ev.stopPropagation();
        const setGoal = (g) => { ctx.local.mxSdg = g; memo.mxSdg = g; ctx.rerender(); };
        const cur = ctx.local.mxSdg && ctx.local.mxSdg !== 'all' ? Number(ctx.local.mxSdg) : null;
        const goals = [...new Set(getProjectExtractions(pid).filter(e => e.pillar === 'indicators').map(e => e.goal))].sort((a, b) => a - b);
        openMenu(el, [
          { label: 'All SDGs', active: !cur, onClick: () => setGoal('all') },
          'divider',
          ...goals.map(g => ({ labelHtml: `${sdgChip(g, { title: false })} <span style="margin-left:6px">SDG ${g} — ${esc(SDG_TITLES[g])}</span>`, active: cur === g, onClick: () => setGoal(String(g)) })),
        ], { align: 'left', minWidth: '280px' });
      },
      'mx-sort': () => { ctx.local.mxSort = ctx.local.mxSort === 'az' ? 'za' : 'az'; memo.mxSort = ctx.local.mxSort; ctx.rerender(); },
      'ext-sel': (el) => { ctx.local.extSel = ctx.local.extSel === el.dataset.id ? null : el.dataset.id; memo.extSel = ctx.local.extSel; ctx.rerender(); },
      'ext-approve': (el, ev) => { ev.stopPropagation(); approveExtraction(el.dataset.id); ctx.rerender(); },
      'ext-unapprove': (el, ev) => { ev.stopPropagation(); unapproveExtraction(el.dataset.id); ctx.rerender(); },
      'run-pipeline': doRunPipeline,
      'run-preprocess': () => { const run = runPreprocessing(project.id); if (!run) { toast.info('Nothing to preprocess', 'Every document is already parsed and translated.'); return; } toast.success('Preprocessing started', `${run.taskIds.length} task${run.taskIds.length === 1 ? '' : 's'} queued — open the logs to follow each document.`); },
      'pp-doc': (el) => { const cur = ctx.local.ppSel; ctx.local.ppSel = cur === el.dataset.doc ? null : el.dataset.doc; ctx.rerender(); },
      'pp-run-doc': (el, ev) => { ev.stopPropagation(); const d = getDoc(el.dataset.doc); if (!d) return; const ts = reprocessDocument(d.id); if (!ts) { toast.info('Already processing', d.name); return; } toast.success('Preprocessing queued', `${d.name} — fresh parse${d.language !== 'EN' ? ' and translation' : ''}.`); },
      'pp-open-task': (el, ev) => { ev.stopPropagation(); if (el.dataset.task) openTaskDrawer(el.dataset.task); },
      'write-vlr': () => { const ts = composeChapters(project.id); if (!ts.length) { toast.warning('Nothing to compose', 'Approve evidence first.'); return; } toast.success('VLR composition started', `${ts.length - 1} chapter${ts.length - 1 === 1 ? '' : 's'} queued — follow them in the Task Queue.`); navigate(`#/projects/${project.id}/chapters`); },
      'run-pipeline-empty': doRunPipeline,
      'run-pillar': (el) => doRunStep(el.dataset.step),
      'run-step-menu': (el) => openMenu(el, [
        { header: 'Run a single step' },
        ...STEP_ORDER.map(step => ({ label: STEP_META[step].label, icon: STEP_META[step].icon, sub: STEP_META[step].engine, onClick: () => doRunStep(step) })),
      ], { align: 'left', minWidth: '280px' }),
      'configure': () => openConfigureProjectModal(pid),
      'approve-all': async (el) => {
        const n = Number(el.dataset.count) || 0;
        if (await confirmDialog({ title: 'Approve all extractions?', msg: `${n} pending extraction${n === 1 ? '' : 's'} across all four pillars will be marked as approved by you. You can unapprove individual entries later.`, confirmText: `Approve ${n}`, icon: 'check-check' })) {
          approveAll(pid); toast.success('All extractions approved', `${n} entr${n === 1 ? 'y' : 'ies'} marked as reviewed`);
        }
      },
      'add-entry': () => openAddExtractionModal(pid, ctx.local.tab),
      'clear-filters': () => { ctx.local.filter = 'all'; ctx.local.q = ''; ctx.rerender(); },
      'open-task': (el, ev) => { ev.preventDefault(); openTaskDrawer(el.dataset.task); },
      'doc-filter-menu': (el) => {
        const docs = getProjectDocs(pid);
        const cur = ctx.local.docFilter || 'all';
        const set = (f) => { ctx.local.docFilter = f; ctx.local.showAllDocs = false; ctx.rerender(); };
        openMenu(el, [
          { label: 'All documents', icon: 'files', active: cur === 'all', onClick: () => set('all') },
          { label: 'Processed', icon: 'check-circle', active: cur === 'status:processed', onClick: () => set('status:processed') },
          { label: 'Parsing', icon: 'loader-2', active: cur === 'status:parsing', onClick: () => set('status:parsing') },
          { label: 'Uploaded', icon: 'clock', active: cur === 'status:uploaded', onClick: () => set('status:uploaded') },
          { label: 'Translation pending', icon: 'languages', active: cur === 'translation', onClick: () => set('translation') },
        ], { align: 'right', minWidth: '220px' });
      },
      'clear-doc-filter': () => { ctx.local.docFilter = 'all'; ctx.local.q = ''; ctx.rerender(); },
      'toggle-docs': () => { ctx.local.showAllDocs = !ctx.local.showAllDocs; ctx.rerender(); },
      'translate': (el) => {
        const d = getDoc(el.dataset.doc);
        if (!d) return;
        if (el.dataset.disabled === 'lang') { toast.info(d.language === 'EN' ? 'Already in English' : 'Already translated', `${d.name} needs no translation.`); return; }
        if (el.dataset.disabled === 'busy') { toast.info('Document is busy', `${d.name} is currently being processed.`); return; }
        if (el.dataset.disabled === 'queued') { toast.info('Translation already queued', `${d.name} is waiting for a translation slot.`); return; }
        /* guard against double clicks / stale DOM: check live state, not the rendered attributes */
        if (d.status === 'translating' || d.translated || hasPendingTask(d.id, ['translate'])) { toast.info('Translation already in progress', d.name); return; }
        translateDocument(d.id); toast.info('Translation queued', `${d.name} (${d.language} → EN)`);
      },
      'doc-details': (el) => openDocumentDrawer(el.dataset.doc),
      'start-parse': (el) => {
        const d = getDoc(el.dataset.doc); if (!d) return;
        if (d.status === 'parsing' || hasPendingTask(d.id, ['parse', 'xml_extraction'])) { toast.info('Parsing already queued', d.name); return; }
        startParse(d.id); toast.info('Parsing queued', `${d.name} · ${STEP_META[d.ext === 'xml' ? 'xml_extraction' : 'parse'].engine}`);
      },
      'delete-doc': async (el) => {
        const d = getDoc(el.dataset.doc);
        if (!d) return;
        if (await confirmDialog({ title: 'Delete document?', msg: `<strong>${esc(d.name)}</strong> will be removed from ${esc(project.name)}. Extractions already produced remain, but lose their live link to the source.`, confirmText: 'Delete', danger: true, icon: 'trash-2' })) {
          deleteDocument(d.id); toast.success('Document deleted', d.name);
        }
      },
      /* history */
      'toggle-run': (el) => { const o = ctx.local.openRuns || (ctx.local.openRuns = {}); o[el.dataset.run] = !o[el.dataset.run]; ctx.rerender(); },
      'download-report': (el) => { const r = getProjectReports(pid).find(x => x.id === el.dataset.report); downloadReport(r); },
      'goto-tasks': () => navigate(`#/tasks?project=${encodeURIComponent(pid)}`),
    });
    const unbindChange = bindActions(ctx.content, {
      'ext-filter': (el) => { ctx.local.filter = el.value; memo.filter = el.value; ctx.rerender(); },
    }, 'change');
    /* #content persists across the ~350 ms re-renders while tasks run: listeners must be removed or every click fires N times */
    return () => { unbindClick(); unbindChange(); };
  },
};
