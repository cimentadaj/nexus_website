/* pipeline.js — simulated orchestration engine.
 * Tasks move queued → running → success with animated progress, dependencies and concurrency.
 * On completion each step applies "effects" (documents become processed, extractions appear, reports are produced, cost accrues).
 */
import { getState, update, getProject, getProjectDocs, getDoc, getProjectExtractions, getTask } from './store.js';
import { STEP_META, PILLARS, buildTemplateExtractions, templatePlan } from './seed.js';
import { composeChapter, assembleBook, planBook } from './composer.js';
import { uid, fmtTime, randInt, pick, clamp } from './ui.js';

const TICK_MS = 350;
let timer = null;

const speedFactor = () => ({ fast: 0.35, demo: 1, realistic: 3.5 }[getState().settings?.pipeline?.simSpeed] || 1);
const concurrency = () => getState().settings?.pipeline?.concurrency || 3;

/* ---------------- logging ---------------- */
export function appendLog(level, msg, projectId = null, { silent = false } = {}) {
  update(s => {
    s.logs.push({ ts: Date.now(), level, msg, projectId });
    if (s.logs.length > 400) s.logs.splice(0, s.logs.length - 400);
  }, { silent });
}

export function logActivity({ projectId, title, provenance, status = 'success', actor, type = 'task' }, { silent = false } = {}) {
  update(s => {
    const p = s.projects.find(x => x.id === projectId);
    s.activity.unshift({ id: uid('act'), projectId, projectName: p?.name || null, title, provenance: provenance || (p ? `${p.id.slice(0, 3).toUpperCase()}-SYS-000` : 'SYS-000'), ts: Date.now(), status, actor: actor || s.auth.user?.name || 'System', type });
    if (s.activity.length > 500) s.activity.length = 500;
  }, { silent });
}

/* ---------------- task creation ---------------- */
export function costFor(step, pages = 0) {
  const m = STEP_META[step];
  const jitter = 1 + (Math.random() * 0.16 - 0.08);
  return Number(((m.base + m.perPage * pages) * jitter).toFixed(2));
}

export function makeTask({ projectId, step, inputDoc, inputDocId = null, runId = null, dependsOn = [], pages = 0, node, goal = null }) {
  const meta = STEP_META[step];
  const project = getProject(projectId);
  return {
    id: uid('task'), projectId, runId, step, label: meta.label, inputDoc, inputDocId, goal, status: 'queued',
    createdAt: Date.now(), startedAt: null, finishedAt: null, durationMs: null, progress: 0, cost: 0,
    node: node || project?.node || 'EU-WEST-1', error: null, logs: [], output: null, dependsOn, pages,
    estimatedMs: Math.round(meta.durationMs * speedFactor() * (0.85 + Math.random() * 0.4)),
  };
}

/** Add tasks to state (queued) and make sure the engine is running. */
export function enqueueTasks(tasks) {
  update(s => { s.tasks.push(...tasks); });
  tasks.forEach(t => appendLog('INFO', `Task ${shortId(t)} queued: '${t.label}' on ${t.inputDoc}`, t.projectId, { silent: true }));
  ensureEngine();
  return tasks;
}

export const shortId = (t) => `#${String(parseInt(t.id.replace(/\D/g, '').slice(-4) || '0', 10) || 9000 + randInt(100, 999))}`;

/**
 * Plan a full pipeline for a project: parse/translate per document, extract indicators per document,
 * then project-level pillars and post-processing. Returns { run, tasks }.
 */
export function planPipeline(projectId, { only = null, label = null } = {}) {
  const project = getProject(projectId);
  const docs = getProjectDocs(projectId);
  const runId = uid('run');
  const tasks = [];
  const pages = docs.reduce((a, d) => a + (d.pages || 0), 0);
  const want = (step) => !only || only.includes(step);

  const parseIds = {};
  const translateIds = {};
  const inflight = (docId, step) => getState().tasks.find(t => t.inputDocId === docId && t.step === step && ['queued', 'running'].includes(t.status));
  for (const d of docs) {
    if (want('parse') && d.status !== 'processed') {
      const step = d.ext === 'xml' ? 'xml_extraction' : 'parse';
      const ex = inflight(d.id, step); if (ex) { parseIds[d.id] = ex.id; continue; }
      const t = makeTask({ projectId, step, inputDoc: d.name, inputDocId: d.id, runId, pages: d.pages });
      tasks.push(t); parseIds[d.id] = t.id;
    }
  }
  for (const d of docs) {
    if (want('translate') && d.language !== 'EN' && !d.translated) {
      const ex = inflight(d.id, 'translate'); if (ex) { translateIds[d.id] = ex.id; continue; }
      const t = makeTask({ projectId, step: 'translate', inputDoc: d.name, inputDocId: d.id, runId, pages: d.pages, dependsOn: parseIds[d.id] ? [parseIds[d.id]] : [] });
      tasks.push(t); translateIds[d.id] = t.id;
    }
  }
  const extractIds = [];
  if (want('extract_indicators')) {
    for (const d of docs) {
      const deps = [parseIds[d.id], translateIds[d.id]].filter(Boolean);
      const t = makeTask({ projectId, step: 'extract_indicators', inputDoc: d.name, inputDocId: d.id, runId, pages: d.pages, dependsOn: deps });
      tasks.push(t); extractIds.push(t.id);
    }
  }
  const allDocsLabel = `All documents (${docs.length})`;
  const docDeps = [...Object.values(parseIds), ...Object.values(translateIds)];
  const analyse = want('analyse') ? makeTask({ projectId, step: 'analyse', inputDoc: allDocsLabel, runId, dependsOn: extractIds }) : null;
  if (analyse) tasks.push(analyse);
  const pillarTasks = [];
  for (const step of ['documentary', 'projects', 'stakeholders']) {
    if (!want(step)) continue;
    const t = makeTask({ projectId, step, inputDoc: allDocsLabel, runId, pages, dependsOn: docDeps });
    tasks.push(t); pillarTasks.push(t.id);
  }
  const post = [];
  let prev = [...pillarTasks, ...(analyse ? [analyse.id] : []), ...extractIds];
  for (const step of ['validation', 'normalization', 'provenance', 'export']) {
    if (!want(step)) continue;
    const t = makeTask({ projectId, step, inputDoc: step === 'export' ? `${project.city}_${project.year}_VLR_Harmonized_Workbook.xlsx` : allDocsLabel, runId, dependsOn: prev });
    tasks.push(t); post.push(t.id); prev = [t.id];
  }
  const runCount = getState().runs.filter(r => r.projectId === projectId).length + 1;
  const run = { id: runId, projectId, label: label || `Full pipeline run #${runCount}`, startedAt: Date.now(), finishedAt: null, status: 'running', taskIds: tasks.map(t => t.id), triggeredBy: getState().auth.user?.name || 'System', note: `${docs.length} source document${docs.length === 1 ? '' : 's'}, ${tasks.length} tasks planned.` };
  return { run, tasks };
}

export function startRun(projectId, opts = {}) {
  const { run, tasks } = planPipeline(projectId, opts);
  if (!tasks.length) return null;
  update(s => { s.runs.unshift(run); s.tasks.push(...tasks); const p = s.projects.find(x => x.id === projectId); if (p && p.status === 'provisioning') p.status = 'active'; });
  appendLog('INFO', `Run '${run.label}' started for ${getProject(projectId)?.name}: ${tasks.length} tasks planned.`, projectId, { silent: true });
  logActivity({ projectId, title: `${run.label} started (${tasks.length} tasks)`, provenance: `${projectId.slice(0, 3).toUpperCase()}-RUN-${String(getState().runs.length).padStart(3, '0')}`, status: 'running', type: 'run' });
  ensureEngine();
  return run;
}

/** Single ad-hoc task (e.g. START PARSE on one document). */
export function startSingleTask({ projectId, step, doc }) {
  const t = makeTask({ projectId, step, inputDoc: doc ? doc.name : `All documents (${getProjectDocs(projectId).length})`, inputDocId: doc?.id ?? null, pages: doc?.pages || 0 });
  enqueueTasks([t]);
  logActivity({ projectId, title: `${STEP_META[step].label} queued: ${t.inputDoc}`, provenance: doc?.code, status: 'queued', type: 'task' });
  return t;
}

export function retryTask(taskId) {
  const t = getTask(taskId);
  if (!t) return;
  if (t.inputDocId && !getDoc(t.inputDocId)) { appendLog('WARN', `Cannot retry ${shortId(t)} '${t.label}': the source document was deleted.`, t.projectId); return null; }
  update(s => {
    const x = s.tasks.find(q => q.id === taskId);
    x.status = 'queued'; x.progress = 0; x.error = null; x.startedAt = null; x.finishedAt = null; x.durationMs = null; x.retries = (x.retries || 0) + 1;
    x.estimatedMs = Math.round(STEP_META[x.step].durationMs * speedFactor() * 0.8);
    x.createdAt = Date.now();
  });
  appendLog('INFO', `Retrying task ${shortId(t)} '${t.label}' on ${t.inputDoc} (attempt ${(t.retries || 0) + 2})`, t.projectId, { silent: true });
  logActivity({ projectId: t.projectId, title: `Retry: ${t.label} — ${t.inputDoc}`, status: 'queued', type: 'task' });
  ensureEngine();
}

export function cancelTask(taskId) {
  const t = getTask(taskId);
  if (!t) return;
  update(s => {
    const x = s.tasks.find(q => q.id === taskId);
    x.status = 'cancelled'; x.finishedAt = Date.now(); x.durationMs = x.startedAt ? Date.now() - x.startedAt : 0;
    x.cost = Number((x.cost * 0.5).toFixed(2));
    if (x.inputDocId) { const d = s.documents.find(q => q.id === x.inputDocId); if (d && d.status === 'parsing') { d.status = 'uploaded'; d.progress = 0; } if (d && d.status === 'translating') d.status = x._prevDocStatus || 'uploaded'; }
    if (x.rerunOf) { const e = s.extractions.find(q => q.id === x.rerunOf); if (e?.status === 'rerun_queued') e.status = 'rejected'; }
  });
  appendLog('WARN', `Task ${shortId(t)} '${t.label}' cancelled by ${getState().auth.user?.name || 'operator'}.`, t.projectId, { silent: true });
  logActivity({ projectId: t.projectId, title: `Cancelled: ${t.label} — ${t.inputDoc}`, status: 'cancelled', type: 'task' });
}

/** Re-queue every failed/queued task (optionally for one project) and kick the engine. */
export function executeAll(projectId = 'all') {
  const s = getState();
  const archived = new Set(s.projects.filter(p => p.status === 'archived').map(p => p.id));
  const live = (t) => !archived.has(t.projectId) && (!t.inputDocId || s.documents.some(d => d.id === t.inputDocId));
  const targets = s.tasks.filter(t => (projectId === 'all' || t.projectId === projectId) && live(t) && (t.status === 'failed' || t.status === 'queued' || t.status === 'cancelled'));
  targets.forEach(t => { if (t.status !== 'queued') retryTask(t.id); });
  // Also (re)start parsing for documents still in "uploaded" state
  const docs = s.documents.filter(d => (projectId === 'all' || d.projectId === projectId) && !archived.has(d.projectId) && d.status === 'uploaded');
  const created = docs.filter(d => !s.tasks.some(t => t.inputDocId === d.id && ['queued', 'running'].includes(t.status)))
    .map(d => makeTask({ projectId: d.projectId, step: d.ext === 'xml' ? 'xml_extraction' : 'parse', inputDoc: d.name, inputDocId: d.id, pages: d.pages }));
  if (created.length) enqueueTasks(created);
  const restarted = targets.filter(t => t.status !== 'queued').length;
  appendLog('INFO', `Batch execution triggered: ${restarted + created.length} task(s) scheduled (${targets.length - restarted} already queued).`, projectId === 'all' ? null : projectId, { silent: true });
  ensureEngine();
  return restarted + created.length;
}

/* ---------------- engine ---------------- */
export function ensureEngine() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  tick();
}

function tick() {
  const s = getState();
  const running = s.tasks.filter(t => t.status === 'running');
  const queued = s.tasks.filter(t => t.status === 'queued');
  if (!running.length && !queued.length) { clearInterval(timer); timer = null; return; }

  update(st => {
    const now = Date.now();
    // 1) schedule queued tasks whose dependencies are satisfied (concurrency is per project, with a global ceiling)
    const runningBy = {};
    st.tasks.filter(t => t.status === 'running').forEach(t => { runningBy[t.projectId] = (runningBy[t.projectId] || 0) + 1; });
    let globalSlots = Math.max(concurrency() * 3, 8) - st.tasks.filter(t => t.status === 'running').length;
    for (const t of st.tasks.filter(t => t.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)) {
      if (globalSlots <= 0) break;
      if ((runningBy[t.projectId] || 0) >= concurrency()) continue;
      const depsOk = (t.dependsOn || []).every(id => { const d = st.tasks.find(x => x.id === id); return !d || d.status === 'success' || d.status === 'cancelled'; });
      const depsFailed = (t.dependsOn || []).some(id => { const d = st.tasks.find(x => x.id === id); return d && d.status === 'failed'; });
      if (depsFailed) { t.status = 'cancelled'; t.finishedAt = now; t.durationMs = 0; t.error = 'Skipped: an upstream task failed.'; t.logs.push({ ts: now, level: 'WARN', msg: t.error }); continue; }
      if (!depsOk) continue;
      t.status = 'running'; t.startedAt = now; t.progress = 1; globalSlots--; runningBy[t.projectId] = (runningBy[t.projectId] || 0) + 1;
      if (!t.estimatedMs) t.estimatedMs = Math.round(STEP_META[t.step].durationMs * speedFactor());
      onStart(st, t);
    }
    // 2) advance running tasks (seeded "running" tasks without estimatedMs get one)
    for (const t of st.tasks.filter(t => t.status === 'running')) {
      if (!t.estimatedMs) { t.estimatedMs = Math.round(STEP_META[t.step].durationMs * speedFactor() * 1.6); t.startedAt = t.startedAt || now; t._progressBase = t.progress; }
      const elapsed = now - (t.startedAt || now);
      const target = clamp(Math.round((t._progressBase || 0) + (100 - (t._progressBase || 0)) * (elapsed / t.estimatedMs)), 1, 100);
      t.progress = Math.max(t.progress, target);
      // cost accrues progressively while running (finalised with jitter on completion)
      const m = STEP_META[t.step]; t.cost = Number(((m.base + m.perPage * (t.pages || 0)) * t.progress / 100).toFixed(2));
      maybeLog(st, t);
      if (t.progress >= 100) complete(st, t);
    }
    // 3) finish runs
    for (const r of st.runs.filter(r => r.status === 'running')) {
      const ts = r.taskIds.map(id => st.tasks.find(t => t.id === id)).filter(Boolean);
      if (ts.every(t => ['success', 'failed', 'cancelled'].includes(t.status))) {
        r.status = ts.some(t => t.status === 'failed') ? 'failed' : 'success';
        r.finishedAt = now;
        r.totalCost = Number(ts.reduce((a, t) => a + (t.cost || 0), 0).toFixed(2));
        const p = st.projects.find(x => x.id === r.projectId);
        if (p) p.lastSyncedAt = now;
        st.logs.push({ ts: now, level: r.status === 'success' ? 'INFO' : 'WARN', msg: `Run '${r.label}' ${r.status === 'success' ? 'completed' : 'finished with failures'} — total cost $${r.totalCost.toFixed(2)}.`, projectId: r.projectId });
        st.activity.unshift({ id: uid('act'), projectId: r.projectId, projectName: p?.name, title: `${r.label} ${r.status === 'success' ? 'completed' : 'finished with failures'}`, provenance: `${r.projectId.slice(0, 3).toUpperCase()}-RUN-${String(st.runs.indexOf(r) + 1).padStart(3, '0')}`, ts: now, status: r.status, actor: 'Pipeline', type: 'run' });
        (st._runsFinished ||= []).push({ runId: r.id, projectId: r.projectId, status: r.status, cost: r.totalCost });
      }
    }
  });
  // expose completion events for toasts
  const st = getState();
  if (st._runsFinished?.length) { const evs = st._runsFinished; delete st._runsFinished; evs.forEach(ev => runListeners.forEach(fn => fn(ev))); }
}

const runListeners = new Set();
export function onRunFinished(fn) { runListeners.add(fn); return () => runListeners.delete(fn); }
const taskListeners = new Set();
export function onTaskFinished(fn) { taskListeners.add(fn); return () => taskListeners.delete(fn); }

function onStart(st, t) {
  const meta = STEP_META[t.step];
  st.logs.push({ ts: Date.now(), level: 'INFO', msg: `Starting '${t.label}' on ${t.inputDoc} [${meta.engine}]`, projectId: t.projectId });
  t.logs.push({ ts: Date.now(), level: 'INFO', msg: `Task started on node ${t.node} using ${meta.engine}.` });
  if (t.inputDocId) {
    const d = st.documents.find(x => x.id === t.inputDocId);
    if (d) {
      if (t.step === 'parse' || t.step === 'xml_extraction') { d.status = 'parsing'; d.progress = 0; }
      if (t.step === 'translate') { t._prevDocStatus = d.status; d.status = 'translating'; }
    }
  }
}

function maybeLog(st, t) {
  const milestones = { parse: [[25, 'Layout analysis complete, OCR fallback not required.'], [60, 'Tables detected: extracting structured cells.'], [85, 'Writing markdown artefact to object store.']],
    translate: [[30, 'Source language confirmed; chunking into 2k-token windows.'], [70, 'Glossary applied (SDG terminology, 148 terms).']],
    extract_indicators: [[20, 'Uploading document to LlamaCloud (purpose=extract).'], [55, 'Schema DocumentExtractionOutput applied; 251 indicator rows scanned.'], [80, 'Translating free-text fields to EN.']],
    analyse: [[35, 'A0 classification: A-SDG / A-Proxy / A-Context.'], [70, 'A2 trend analysis: annual rate of change vs 2030 target.']],
    documentary: [[25, 'Map phase: dispatching (document × SDG) agents.'], [65, 'Reduce phase: aggregating C1/C2/C3 facts.'], [90, 'C5 consistency check: scanning for contradictions.']],
    projects: [[30, 'Map phase: (document × SDG) agents dispatched.'], [75, 'Merge agent: deduplicating projects across SDGs.']],
    stakeholders: [[30, 'Map phase: extracting challenges, priorities, recommendations.'], [75, 'Clustering thematically identical insights (quotes preserved).']],
    validation: [[50, 'Pydantic validation: 0 schema violations so far.']], normalization: [[50, 'Linear rescaling 0–100 with threshold registry.']],
    provenance: [[50, 'Linking extractions → pages → quotes.']], export: [[50, 'Seeding Urban Data tab with 251 reference rows.']], report: [[50, 'Composing chapters from approved extractions.']],
    xml_extraction: [[50, 'Mapping legacy schema to un_sdg_schema_map.yaml.']] };
  const list = milestones[t.step] || [];
  t._logged = t._logged || [];
  for (const [pct, msg] of list) {
    if (t.progress >= pct && !t._logged.includes(pct)) {
      t._logged.push(pct);
      t.logs.push({ ts: Date.now(), level: 'INFO', msg });
      if (pct === list[Math.floor(list.length / 2)][0]) st.logs.push({ ts: Date.now(), level: 'INFO', msg: `${t.label} (${t.inputDoc}): ${msg}`, projectId: t.projectId });
    }
  }
  // update document progress
  if (t.inputDocId && (t.step === 'parse' || t.step === 'xml_extraction')) { const d = st.documents.find(x => x.id === t.inputDocId); if (d) d.progress = t.progress; }
}

function complete(st, t) {
  const now = Date.now();
  t.status = 'success'; t.progress = 100; t.finishedAt = now; t.durationMs = now - (t.startedAt || now);
  t.cost = costFor(t.step, t.pages || 0);
  const project = st.projects.find(p => p.id === t.projectId);
  const docs = st.documents.filter(d => d.projectId === t.projectId);
  const doc = t.inputDocId ? st.documents.find(d => d.id === t.inputDocId) : null;
  let outputMsg = '';

  switch (t.rerunOf ? 'rerun' : t.step) {
    case 'rerun': break; // targeted re-extraction handled below
    case 'parse':
    case 'xml_extraction':
      if (doc) { doc.status = 'processed'; doc.progress = 100; doc.parsedAt = now; if (doc.language === 'EN') doc.translated = true; }
      if (project && project.status === 'provisioning' && docs.every(d => d.status === 'processed')) { project.status = 'active'; st.logs.push({ ts: now, level: 'INFO', msg: `All source documents ingested — ${project.name} moved from Provisioning to Active.`, projectId: project.id }); }
      outputMsg = doc ? `${doc.pages} pages → markdown (${Math.round(doc.pages * 1.8)} KB), ${randInt(2, 14)} tables detected.` : 'Parsed.';
      t.output = { pages: doc?.pages, tables: randInt(2, 14), artefact: doc ? doc.name.replace(/\.[a-z]+$/, '.md') : null };
      break;
    case 'translate':
      if (doc) { doc.translated = true; doc.translatedTo = 'EN'; if (doc.status === 'translating') doc.status = t._prevDocStatus === 'processed' ? 'processed' : (t._prevDocStatus || 'uploaded'); }
      outputMsg = doc ? `${doc.language} → EN, ${Math.round((doc.pages || 10) * 420)} tokens translated.` : 'Translated.';
      t.output = { from: doc?.language, to: 'EN', tokens: Math.round((doc?.pages || 10) * 420) };
      break;
    case 'extract_indicators': {
      const existing = st.extractions.filter(e => e.projectId === t.projectId);
      const perDoc = Math.ceil(templatePlan(project, 'indicators').length / Math.max(1, docs.length));
      const all = buildTemplateExtractions(project, docs, { pillar: 'indicators', existing });
      // assign to this document a slice of the remaining indicator templates
      const slice = all.slice(0, perDoc).map(e => ({ ...e, source: { ...e.source, docId: doc?.id ?? e.source.docId, docName: doc?.name ?? e.source.docName, page: Math.min(e.source.page, doc?.pages || e.source.page) }, createdAt: now, updatedAt: now }));
      st.extractions.push(...slice);
      outputMsg = `${slice.length} indicator value(s) extracted, ${slice.length ? 'avg confidence ' + Math.round(slice.reduce((a, e) => a + e.confidence, 0) / slice.length) + '%' : 'no new matches'}.`;
      t.output = { extracted: slice.length, sdgs: [...new Set(slice.map(e => e.sdg))] };
      break;
    }
    case 'analyse': {
      const ind = st.extractions.filter(e => e.projectId === t.projectId && e.pillar === 'indicators');
      ind.forEach(e => { e.analysed = true; e.rating = pick(['On track', 'Moderately improving', 'Stagnating', 'On track']); });
      outputMsg = `${ind.length} indicators normalised (0–100) and projected to 2030.`;
      t.output = { indicators: ind.length, bands: { achievement: Math.round(ind.length * .3), challenges: Math.round(ind.length * .4), major: ind.length - Math.round(ind.length * .3) - Math.round(ind.length * .4) } };
      break;
    }
    case 'documentary':
    case 'projects':
    case 'stakeholders': {
      const existing = st.extractions.filter(e => e.projectId === t.projectId);
      const built = buildTemplateExtractions(project, docs, { pillar: t.step, existing }).map(e => ({ ...e, createdAt: now, updatedAt: now }));
      st.extractions.push(...built);
      const lbl = PILLARS.find(p => p.key === t.step).label;
      outputMsg = `${built.length} ${lbl.toLowerCase()} entr${built.length === 1 ? 'y' : 'ies'} extracted across ${docs.length} document(s).`;
      t.output = { extracted: built.length, pillar: t.step };
      break;
    }
    case 'wiki_load': {
      if (project) project.wikiLoaded = true;
      const goals = project?.sdgs?.length || 5;
      t.output = { goals, targets: goals * 9, indicators: goals * 12 };
      outputMsg = `SDG metadata loaded from wiki: ${goals} goals, ${goals * 9} targets, ${goals * 12} indicators.`;
      break;
    }
    case 'validation': outputMsg = `${st.extractions.filter(e => e.projectId === t.projectId).length} records validated against Pydantic schemas — 0 violations.`; t.output = { violations: 0 }; break;
    case 'normalization': outputMsg = 'Indicator values rescaled to 0–100 (SDG Transformation Center method).'; t.output = { rescaled: st.extractions.filter(e => e.projectId === t.projectId && e.pillar === 'indicators').length }; break;
    case 'provenance': {
      const n = st.extractions.filter(e => e.projectId === t.projectId).length;
      outputMsg = `Lineage graph built: ${n} extractions linked to ${docs.length} sources (page + quote level).`; t.output = { nodes: n + docs.length, edges: n * 2 };
      break;
    }
    case 'export':
    case 'report': {
      const isReport = t.step === 'report';
      const name = t.inputDoc.endsWith('.xlsx') || t.inputDoc.endsWith('.pdf') || t.inputDoc.endsWith('.md') || t.inputDoc.endsWith('.docx') ? t.inputDoc : `${project.city}_${project.year}_VLR_${isReport ? 'Report.pdf' : 'Harmonized_Workbook.xlsx'}`;
      const format = name.split('.').pop();
      const kinds = { xlsx: 'Harmonized Excel Workbook', pdf: 'VLR Report (PDF)', md: 'Obsidian Markdown Vault', docx: 'VLR Report (Word)' };
      st.reports.unshift({ id: uid('rep'), projectId: t.projectId, name, format, kind: kinds[format] || 'Report', createdAt: now, sizeKb: randInt(900, 4200), status: 'ready', generatedBy: st.auth.user?.name || 'Pipeline', taskId: t.id, sections: t.sections || [], approvedOnly: !!t.approvedOnly });
      outputMsg = `${name} written (${kinds[format] || 'Report'}).`;
      t.output = { file: name };
      break;
    }
    case 'compose': {
      const counts = st.extractions.filter(e => e.projectId === t.projectId && e.status === 'approved').reduce((a, e) => { a[e.goal] = (a[e.goal] || 0) + 1; return a; }, {});
      const rich = Object.keys(counts).filter(g => counts[g] >= 2).map(Number);
      const goals = [...new Set([...(rich.length ? rich : Object.keys(counts).map(Number)), t.goal])].sort((a, b) => a - b);
      const plan = planBook(project, goals).find(p => p.goal === t.goal) || { goal: t.goal, number: goals.indexOf(t.goal) + 1 || 1 };
      // continuous figure/box/footnote series across the book: start after the previous chapter's counters
      const prev = st.chapters.filter(c => c.projectId === t.projectId && c.goal < t.goal).sort((a, b) => b.goal - a.goal)[0];
      const counters = prev ? { figureStart: prev.counters.figureNext, boxStart: prev.counters.boxNext, footnoteStart: prev.counters.footnoteNext } : { figureStart: 1, boxStart: 1, footnoteStart: 1 };
      const ch = composeChapter(project, t.goal, st.extractions.filter(e => e.projectId === t.projectId && e.goal === t.goal), docs, { number: plan.number, reported: goals, ...counters });
      st.chapters = st.chapters.filter(c => !(c.projectId === t.projectId && c.goal === t.goal));
      st.chapters.push(ch);
      outputMsg = `Chapter ${ch.number} composed (tier ${ch.tier}, ${ch.wordCount} words, ${ch.footnotes.length} footnotes, ${ch.gapReport.length} gap-report entries).`;
      t.output = { chapterId: ch.id, tier: ch.tier, words: ch.wordCount, footnotes: ch.footnotes.length };
      st.activity.unshift({ id: uid('act'), projectId: t.projectId, projectName: project?.name, title: `Chapter composed: ${ch.title}`, provenance: `${t.projectId.slice(0, 3).toUpperCase()}-CH-${String(ch.number).padStart(2, '0')}`, ts: now, status: 'success', actor: 'Chapter Composer', type: 'chapter' });
      break;
    }
    case 'edit': {
      const chs = st.chapters.filter(c => c.projectId === t.projectId).sort((a, b) => a.goal - b.goal);
      chs.forEach((c, i) => { c.number = i + 1; c.title = c.title.replace(/^Chapter \d+/, `Chapter ${i + 1}`); c.sections.forEach((s, k) => { s.num = `${i + 1}.${k + 1}`; (s.subsections || []).forEach((ss, j) => { ss.num = `${i + 1}.${k + 1}.${j + 1}`; }); }); });
      outputMsg = `${chs.length} chapter(s) consolidated: numbering, cross-references and duplicate subjects checked; 0 duplicates found.`;
      t.output = { chapters: chs.length, duplicatesRemoved: 0, crossReferences: chs.length > 1 ? chs.length : 0 };
      break;
    }
    case 'assemble': {
      const chs = st.chapters.filter(c => c.projectId === t.projectId);
      const book = assembleBook(project, chs, st.extractions.filter(e => e.projectId === t.projectId), docs);
      const existing = st.books.find(b => b.projectId === t.projectId);
      if (existing) { book.comments = existing.comments || []; book.version = (existing.version || 1) + 1; book.revisions.unshift(...existing.revisions); }
      st.books = st.books.filter(b => b.projectId !== t.projectId);
      st.books.push(book);
      outputMsg = `${book.title}: ${book.stats.chapters} chapters, ${book.stats.pages} pages, ${book.stats.figures} figures, ${book.stats.footnotes} footnotes.`;
      t.output = { bookId: book.id, ...book.stats };
      st.activity.unshift({ id: uid('act'), projectId: t.projectId, projectName: project?.name, title: `Final VLR assembled: ${book.title} (v${book.version})`, provenance: `${t.projectId.slice(0, 3).toUpperCase()}-VLR-${String(book.version).padStart(3, '0')}`, ts: now, status: 'success', actor: 'Book Assembly', type: 'book' });
      break;
    }
    case 'render': {
      const book = st.books.find(b => b.projectId === t.projectId);
      if (book) { const name = `${project.city}_${project.year}_VLR_v${book.version}.docx`; st.reports.unshift({ id: uid('rep'), projectId: t.projectId, name, format: 'docx', kind: 'Final VLR (Word)', createdAt: now, sizeKb: Math.round(book.stats.words * 0.9 + 120), status: 'ready', generatedBy: 'Pipeline', taskId: t.id, bookId: book.id }); outputMsg = `${name} rendered (${book.stats.pages} pages).`; t.output = { file: name }; }
      break;
    }
    default: outputMsg = 'Completed.';
  }
  // Targeted rerun (Reject & Rerun): re-extract the rejected entry with fresh evidence instead of adding duplicates
  if (t.rerunOf) {
    const e = st.extractions.find(x => x.id === t.rerunOf);
    if (e) {
      e.status = 'extracted'; e.confidence = Math.min(99, (e.confidence || 80) + 2); e.updatedAt = now; e.rerunCount = (e.rerunCount || 0) + 1; e.reviewedBy = null; e.reviewedAt = null;
      outputMsg = `Re-extracted SDG ${e.sdg} '${e.title}' with reviewer feedback applied (confidence ${e.confidence}%).`;
      t.output = { rerunOf: e.id, sdg: e.sdg, confidence: e.confidence };
      st.activity.unshift({ id: uid('act'), projectId: t.projectId, projectName: project?.name, title: `Re-extracted after review: SDG ${e.sdg} ${e.title}`, provenance: doc?.code, ts: now, status: 'success', actor: 'Pipeline', type: 'review' });
    }
  }
  // preprocessing gate: when every document is parsed+translated and the wiki is loaded, stamp the project
  if (['parse', 'xml_extraction', 'translate', 'wiki_load'].includes(t.step) && project && project.wikiLoaded && !project.preprocessedAt) {
    if (docs.length && docs.every(d => d.status === 'processed' && (d.language === 'EN' || d.translated))) {
      project.preprocessedAt = now;
      st.logs.push({ ts: now, level: 'INFO', msg: `Preprocessing complete for ${project.name} — documents parsed, translated and SDG reference loaded.`, projectId: project.id });
      st.activity.unshift({ id: uid('act'), projectId: project.id, projectName: project.name, title: `Preprocessing complete: ${project.name}`, provenance: `${project.id.slice(0, 3).toUpperCase()}-PRE-001`, ts: now, status: 'success', actor: 'Pipeline', type: 'task' });
    }
  }
  t.logs.push({ ts: now, level: 'INFO', msg: `Completed in ${Math.round(t.durationMs / 1000)}s — cost $${t.cost.toFixed(2)}. ${outputMsg}` });
  st.logs.push({ ts: now, level: 'INFO', msg: `'${t.label}' completed on ${t.inputDoc} (${fmtDurationShort(t.durationMs)}, $${t.cost.toFixed(2)}). ${outputMsg}`, projectId: t.projectId });
  st.activity.unshift({ id: uid('act'), projectId: t.projectId, projectName: project?.name, title: `${t.label}: ${t.inputDoc}`, provenance: doc?.code || `${t.projectId.slice(0, 3).toUpperCase()}-TSK-${String(st.tasks.indexOf(t) + 1).padStart(3, '0')}`, ts: now, status: 'success', actor: 'Pipeline', type: 'task' });
  if (project) project.lastSyncedAt = now;
  taskListeners.forEach(fn => { try { fn(t); } catch { /* ignore */ } });
}

function fmtDurationShort(ms) { const s = Math.round(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}m ${String(s % 60).padStart(2, '0')}s`; }

// Background tabs get their timers throttled by the browser; catch up the moment the tab is visible again.
if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) tick(); });

/** Resume any running tasks after a page reload. */
export function bootEngine() {
  const s = getState();
  // Resume running tasks from their current progress (their startedAt may be long in the past after a reload).
  update(st => { st.tasks.filter(t => t.status === 'running').forEach(t => {
    if (!t.estimatedMs) t.estimatedMs = Math.round(STEP_META[t.step].durationMs * speedFactor() * 1.6);
    // resume from the current progress: only the remaining share of the estimated duration is still to run
    const remaining = Math.max(4000, Math.round(t.estimatedMs * (1 - (t.progress || 0) / 100)));
    t._progressBase = t.progress || 1; t.startedAt = Date.now(); t.estimatedMs = remaining;
  }); }, { silent: true });
  if (s.tasks.some(t => t.status === 'running' || t.status === 'queued')) ensureEngine();
}
