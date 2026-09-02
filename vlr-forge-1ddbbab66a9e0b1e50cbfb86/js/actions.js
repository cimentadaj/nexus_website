/* actions.js — every user-facing mutation. Pages call these; they never mutate state directly. */
import { getState, update, resetState, getProject, getProjectDocs, getDoc, getExtraction, getTask, getProjectExtractions, getChapter, getProjectChapters, getBook, getProjectBook } from './store.js';
import { applyFeedback, reviseBlockFromComment } from './reviewer.js';
import { answerQuestion } from './ask.js';
import { startRun, startSingleTask, retryTask as _retryTask, cancelTask as _cancelTask, executeAll as _executeAll, appendLog, logActivity, makeTask, enqueueTasks, bootEngine } from './pipeline.js';
import { uid, docTypeFromName, fileExt, titleCase, initials, SDG_TITLES } from './ui.js';
import { buildTemplateExtractions, STEP_META } from './seed.js';

/* ---------------- auth ---------------- */
export function login({ email, password, remember = true }) {
  const local = (email || 'demo@vlrforge.io').split('@')[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  const known = getState().settings.team.find(m => m.email.toLowerCase() === String(email).toLowerCase());
  const name = known ? known.name : parts.length >= 2 ? parts.map(titleCase).join(' ') : `${titleCase(parts[0] || 'Demo')} Analyst`;
  const domain = String(email || 'demo@vlrforge.io').split('@')[1] || '';
  const orgFromDomain = domain && !/nexuslab/i.test(domain) ? titleCase(domain.split('.')[0]) : null;
  const user = { name, email: email || 'demo@vlrforge.io', role: known?.role || 'Admin', org: known ? getState().settings.org.name : (orgFromDomain || getState().settings.org.name), loggedInAt: Date.now() };
  update(s => {
    s.auth.user = user; s.auth.remember = remember;
    if (!s.settings.team.some(m => m.email.toLowerCase() === user.email.toLowerCase())) s.settings.team.push({ id: uid('mem'), name: user.name, email: user.email, role: user.role, status: 'active', lastActive: Date.now() });
    else { const me = s.settings.team.find(m => m.email.toLowerCase() === user.email.toLowerCase()); me.lastActive = Date.now(); }
  });
  appendLog('INFO', `User ${user.email} authenticated (SSO session, role ${user.role}).`, null, { silent: true });
  return user;
}
export function logout() { update(s => { s.auth.user = null; }); }
export function updateProfile(patch) {
  update(s => { Object.assign(s.auth.user, patch); const me = s.settings.team.find(m => m.email === s.auth.user.email); if (me) Object.assign(me, { name: s.auth.user.name }); });
}

/* ---------------- projects ---------------- */
export function createProject({ name, city, country, jurisdiction, year, sdgs = [], languages = ['EN'], description = '', files = [], lead }) {
  const base = `${city}-${year}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let id = base, n = 2;
  while (getProject(id)) id = `${base}-${n++}`;
  const project = {
    id, name: name || `${city} ${year} VLR`, city, country, jurisdiction: jurisdiction || `${city} City Council`, year: Number(year), status: files.length ? 'active' : 'provisioning',
    sdgs: [...sdgs].sort((a, b) => a - b), languages, createdAt: Date.now(), node: getState().settings.org.region || 'EU-WEST-1', description, lastSyncedAt: Date.now(), lead: lead || getState().auth.user?.name,
  };
  update(s => { s.projects.unshift(project); });
  logActivity({ projectId: id, title: `Project initialised: ${project.name}`, provenance: `${id.slice(0, 3).toUpperCase()}-PRJ-001`, status: 'success', type: 'project' });
  appendLog('INFO', `Project '${project.name}' created (${project.sdgs.length} target SDGs, node ${project.node}).`, id, { silent: true });
  if (files.length) addDocuments(id, files);
  return project;
}
export function updateProject(id, patch) {
  update(s => { const p = s.projects.find(x => x.id === id); if (p) Object.assign(p, patch, { lastSyncedAt: Date.now() }); });
  logActivity({ projectId: id, title: `Project settings updated: ${getProject(id)?.name}`, status: 'success', type: 'project' });
}
export function activateProject(id) {
  update(s => { const p = s.projects.find(x => x.id === id); if (p) p.status = 'active'; });
  logActivity({ projectId: id, title: `Project activated: ${getProject(id)?.name}`, status: 'success', type: 'project' });
}
export function archiveProject(id) {
  update(s => { const p = s.projects.find(x => x.id === id); if (p) { p.status = 'archived'; p.archivedAt = Date.now(); } });
  logActivity({ projectId: id, title: `Project archived: ${getProject(id)?.name}`, status: 'success', type: 'project' });
}
export function unarchiveProject(id) {
  update(s => { const p = s.projects.find(x => x.id === id); if (p) { p.status = 'active'; delete p.archivedAt; } });
  logActivity({ projectId: id, title: `Project restored from archive: ${getProject(id)?.name}`, status: 'success', type: 'project' });
}
export function deleteProject(id) {
  const name = getProject(id)?.name;
  update(s => {
    s.projects = s.projects.filter(p => p.id !== id);
    s.documents = s.documents.filter(d => d.projectId !== id);
    s.tasks = s.tasks.filter(t => t.projectId !== id);
    s.runs = s.runs.filter(r => r.projectId !== id);
    const extIds = new Set(s.extractions.filter(e => e.projectId === id).map(e => e.id));
    s.extractions = s.extractions.filter(e => e.projectId !== id);
    s.comments = s.comments.filter(c => !extIds.has(c.extractionId));
    s.reports = s.reports.filter(r => r.projectId !== id);
    if (s.ui.tasksProjectFilter === id) s.ui.tasksProjectFilter = 'all';
  });
  logActivity({ projectId: null, title: `Project deleted: ${name}`, provenance: 'SYS-PRJ-DEL', status: 'success', type: 'project' });
}

/* ---------------- documents ---------------- */
export function addDocuments(projectId, files, { language, type } = {}) {
  const project = getProject(projectId);
  const prefix = projectId.slice(0, 3).toUpperCase();
  const maxCode = Math.max(400, ...getProjectDocs(projectId).map(d => Number(String(d.code).split('-').pop()) || 0));
  const docs = files.map((f, i) => {
    const name = typeof f === 'string' ? f : f.name;
    const ext = fileExt(name);
    const sizeKb = f.size ? Math.max(1, Math.round(f.size / 1024)) : (ext === 'pdf' ? 8200 : 240) + i * 37;
    const pages = f.pages || (ext === 'pdf' ? Math.max(4, Math.round(sizeKb / 180)) : ext === 'docx' ? Math.max(2, Math.round(sizeKb / 40)) : ['xlsx', 'csv'].includes(ext) ? Math.max(1, Math.round(sizeKb / 60)) : 12);
    return {
      id: uid('doc'), projectId, name, ext, type: f.type && f.type.length < 20 && !f.type.includes('/') ? f.type : type || docTypeFromName(name),
      language: f.language || language || (project?.languages?.[0] || 'EN'), status: 'uploaded', pages: Math.min(pages, 600), sizeKb,
      uploadedAt: Date.now() + i, translated: (f.language || language || project?.languages?.[0] || 'EN') === 'EN', translatedTo: 'EN',
      code: `${prefix}-DOC-${maxCode + 1 + i}`, progress: 0, parsedAt: null, uploadedBy: getState().auth.user?.name,
    };
  });
  update(s => { s.documents.push(...docs); const p = s.projects.find(x => x.id === projectId); if (p) p.lastSyncedAt = Date.now(); });
  docs.forEach(d => logActivity({ projectId, title: `Document uploaded: ${d.name}`, provenance: d.code, status: 'success', type: 'upload' }));
  appendLog('INFO', `${docs.length} document(s) uploaded to ${project?.name}: ${docs.map(d => d.name).join(', ')}`, projectId, { silent: true });
  return docs;
}
export function deleteDocument(docId) {
  const d = getDoc(docId);
  if (!d) return;
  update(s => {
    s.documents = s.documents.filter(x => x.id !== docId);
    s.tasks.filter(t => t.inputDocId === docId && ['queued', 'running'].includes(t.status)).forEach(t => { t.status = 'cancelled'; t.finishedAt = Date.now(); });
  });
  logActivity({ projectId: d.projectId, title: `Document removed: ${d.name}`, provenance: d.code, status: 'success', type: 'upload' });
}
export function updateDocument(docId, patch) { update(s => { const d = s.documents.find(x => x.id === docId); if (d) Object.assign(d, patch); }); }
export function startParse(docId) {
  const d = getDoc(docId);
  if (!d) return null;
  return startSingleTask({ projectId: d.projectId, step: d.ext === 'xml' ? 'xml_extraction' : 'parse', doc: d });
}
export function translateDocument(docId) {
  const d = getDoc(docId);
  if (!d) return null;
  return startSingleTask({ projectId: d.projectId, step: 'translate', doc: d });
}

/* ---------------- pipeline ---------------- */
export function runPipeline(projectId, opts) { return startRun(projectId, opts); }
export function runStep(projectId, step) {
  const project = getProject(projectId);
  const meta = STEP_META[step];
  if (meta.scope === 'document') {
    const docs = getProjectDocs(projectId).filter(d => step === 'translate' ? (d.language !== 'EN' && !d.translated) : step === 'parse' ? d.status !== 'processed' : true);
    const tasks = docs.map(d => makeTask({ projectId, step, inputDoc: d.name, inputDocId: d.id, pages: d.pages }));
    if (!tasks.length) return [];
    enqueueTasks(tasks);
    logActivity({ projectId, title: `${meta.label} queued for ${tasks.length} document(s)`, status: 'queued', type: 'task' });
    return tasks;
  }
  const t = startSingleTask({ projectId, step, doc: null });
  return [t];
}
export const retryTask = _retryTask;
export const cancelTask = _cancelTask;
export const executeAllTasks = _executeAll;

/* ---------------- extractions / review ---------------- */
export function updateExtraction(id, patch) {
  update(s => { const e = s.extractions.find(x => x.id === id); if (e) { Object.assign(e, patch, { updatedAt: Date.now(), editedBy: s.auth.user?.name }); } });
  const e = getExtraction(id);
  if (e) logActivity({ projectId: e.projectId, title: `Extraction edited: SDG ${e.sdg} ${e.title}`, provenance: getDoc(e.source?.docId)?.code, status: 'success', type: 'review' });
}
export function approveExtraction(id) {
  update(s => { const e = s.extractions.find(x => x.id === id); if (e) { e.status = 'approved'; e.reviewedBy = s.auth.user?.name; e.reviewedAt = Date.now(); e.updatedAt = Date.now(); } });
  const e = getExtraction(id);
  if (e) { logActivity({ projectId: e.projectId, title: `Approved: SDG ${e.sdg} ${e.title}`, provenance: getDoc(e.source?.docId)?.code, status: 'success', type: 'review' }); appendLog('INFO', `Extraction SDG ${e.sdg} '${e.title}' approved by ${getState().auth.user?.name}.`, e.projectId, { silent: true }); }
}
export function unapproveExtraction(id) {
  update(s => { const e = s.extractions.find(x => x.id === id); if (e) { e.status = 'extracted'; e.reviewedBy = null; e.reviewedAt = null; } });
}
export function rejectAndRerun(id, reason = '', { comment = true } = {}) {
  const e = getExtraction(id);
  if (!e) return null;
  update(s => { const x = s.extractions.find(q => q.id === id); x.status = 'rerun_queued'; x.rejectedReason = reason; x.reviewedBy = s.auth.user?.name; x.reviewedAt = Date.now(); x.updatedAt = Date.now(); });
  if (reason && comment) addComment(id, reason, 'rejection');
  const doc = getDoc(e.source?.docId);
  const step = e.pillar === 'indicators' ? 'extract_indicators' : e.pillar;
  const task = makeTask({ projectId: e.projectId, step, inputDoc: doc?.name || e.source?.docName || 'All documents', inputDocId: doc?.id ?? null, pages: doc?.pages || 0 });
  task.rerunOf = id;
  enqueueTasks([task]);
  logActivity({ projectId: e.projectId, title: `Reject & rerun: SDG ${e.sdg} ${e.title}`, provenance: doc?.code, status: 'queued', type: 'review' });
  return task;
}
export function addComment(extractionId, text, kind = 'comment') {
  const c = { id: uid('cmt'), extractionId, author: getState().auth.user?.name || 'Anonymous', kind, text, createdAt: Date.now() };
  update(s => { s.comments.push(c); });
  const e = getExtraction(extractionId);
  if (e && kind === 'mis-highlight') logActivity({ projectId: e.projectId, title: `Mis-highlight reported: SDG ${e.sdg} ${e.title}`, provenance: getDoc(e.source?.docId)?.code, status: 'info', type: 'review' });
  return c;
}
export function deleteComment(id) { update(s => { s.comments = s.comments.filter(c => c.id !== id); }); }
export function addManualExtraction(projectId, pillar, data) {
  const doc = data.docId ? getDoc(data.docId) : null;
  const e = {
    id: uid('ext'), projectId, pillar, sdg: data.sdg, goal: Number(String(data.sdg).split('.')[0]) || null, title: data.title, indicator: data.indicator, value: data.value, unit: data.unit, year: data.year,
    category: data.category, categoryLabel: data.categoryLabel, summary: data.summary, projectStatus: data.projectStatus, budget: data.budget, period: data.period, lead: data.lead, group: data.group, engagement: data.engagement,
    confidence: 100, status: 'manual', source: { docId: doc?.id ?? null, docName: doc?.name || data.docName || 'Manual entry', page: Number(data.page) || 1, paragraph: Number(data.paragraph) || 1, quote: data.quote || '' },
    createdAt: Date.now(), updatedAt: Date.now(), addedBy: getState().auth.user?.name,
  };
  update(s => { s.extractions.push(e); });
  logActivity({ projectId, title: `Manual entry added: SDG ${e.sdg} ${e.title}`, provenance: doc?.code, status: 'success', type: 'review' });
  return e;
}
export function deleteExtraction(id) {
  const e = getExtraction(id);
  update(s => { s.extractions = s.extractions.filter(x => x.id !== id); s.comments = s.comments.filter(c => c.extractionId !== id); });
  if (e) logActivity({ projectId: e.projectId, title: `Extraction removed: SDG ${e.sdg} ${e.title}`, status: 'success', type: 'review' });
}
export function approveAll(projectId, pillar) {
  update(s => { s.extractions.filter(e => e.projectId === projectId && (!pillar || e.pillar === pillar) && ['extracted', 'manual'].includes(e.status)).forEach(e => { e.status = 'approved'; e.reviewedBy = s.auth.user?.name; e.reviewedAt = Date.now(); }); });
  logActivity({ projectId, title: `Bulk approval: ${pillar ? titleCase(pillar) : 'all pillars'}`, status: 'success', type: 'review' });
}

/* ---------------- reports ---------------- */
export function generateReport(projectId, { format = 'xlsx', sections = [], approvedOnly = false } = {}) {
  const project = getProject(projectId);
  const names = { xlsx: `${project.city}_${project.year}_VLR_Harmonized_Workbook.xlsx`, pdf: `${project.city}_${project.year}_VLR_Report.pdf`, md: `${project.city}_${project.year}_VLR_Obsidian_Vault.md`, docx: `${project.city}_${project.year}_VLR_Report.docx` };
  const t = makeTask({ projectId, step: format === 'xlsx' ? 'export' : 'report', inputDoc: names[format] || names.xlsx });
  t.sections = sections; t.approvedOnly = !!approvedOnly;
  enqueueTasks([t]);
  logActivity({ projectId, title: `Report generation queued: ${names[format]}`, status: 'queued', type: 'export' });
  return t;
}

/* ---------------- settings ---------------- */
export function saveSettings(section, patch) {
  update(s => { s.settings[section] = { ...(s.settings[section] || {}), ...patch }; });
  appendLog('INFO', `Settings updated: ${section}.`, null, { silent: true });
}
export function regenerateApiKey(id) {
  const key = 'vlrf_live_' + Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  update(s => { const k = s.settings.apiKeys.find(x => x.id === id); if (k) { k.key = key; k.createdAt = Date.now(); k.lastUsedAt = null; } });
  return key;
}
export function createApiKey(label) {
  const k = { id: uid('key'), label, key: 'vlrf_live_' + Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''), createdAt: Date.now(), lastUsedAt: null };
  update(s => { s.settings.apiKeys.push(k); });
  return k;
}
export function revokeApiKey(id) { update(s => { s.settings.apiKeys = s.settings.apiKeys.filter(k => k.id !== id); }); }
export function inviteMember({ name, email, role }) {
  const m = { id: uid('mem'), name: name || email.split('@')[0], email, role, status: 'invited', lastActive: null, invitedAt: Date.now() };
  update(s => { s.settings.team.push(m); });
  return m;
}
export function updateMember(id, patch) { update(s => { const m = s.settings.team.find(x => x.id === id); if (m) Object.assign(m, patch); }); }
export function removeMember(id) { update(s => { s.settings.team = s.settings.team.filter(m => m.id !== id); }); }

/* ---------------- support ---------------- */
export function createTicket({ subject, category, message, priority = 'Normal' }) {
  const n = Math.max(1041, ...getState().tickets.map(t => Number(String(t.id).replace('TCK-', '')) || 0)) + 1;
  const t = { id: `TCK-${n}`, subject, category, status: 'open', priority, createdAt: Date.now(), updatedAt: Date.now(), author: getState().auth.user?.name || 'You', messages: [{ author: getState().auth.user?.name || 'You', ts: Date.now(), text: message }] };
  update(s => { s.tickets.unshift(t); });
  // simulated support auto-reply
  setTimeout(() => {
    update(s => { const x = s.tickets.find(q => q.id === t.id); if (x && x.status === 'open') { x.messages.push({ author: 'VLR Forge Support', ts: Date.now(), text: `Thanks ${getState().auth.user?.name?.split(' ')[0] || ''} — ticket ${t.id} has been assigned to an engineer. Expected first response: under 2 business hours (Enterprise SLA).` }); x.updatedAt = Date.now(); } });
  }, 6000);
  return t;
}
export function replyTicket(id, text) { update(s => { const t = s.tickets.find(x => x.id === id); if (t) { t.messages.push({ author: s.auth.user?.name || 'You', ts: Date.now(), text }); t.updatedAt = Date.now(); if (t.status === 'resolved') t.status = 'open'; } }); }
export function resolveTicket(id) { update(s => { const t = s.tickets.find(x => x.id === id); if (t) { t.status = 'resolved'; t.updatedAt = Date.now(); } }); }

/* ---------------- misc ---------------- */
export function setUi(patch) { update(s => { Object.assign(s.ui, patch); }); }
export function resetDemo() { resetState({ keepAuth: true }); bootEngine(); }
export function touchSync(projectId) { update(s => { const p = s.projects.find(x => x.id === projectId); if (p) p.lastSyncedAt = Date.now(); }); }

/* ---------------- VLR composition (chapters) ---------------- */
/** Queue one Chapter Composer task per reported SDG (goals with approved evidence) + a consolidating Chapter Editor task. */
export function composeChapters(projectId, { goals = null } = {}) {
  const project = getProject(projectId);
  const approved = getProjectExtractions(projectId).filter(e => e.status === 'approved');
  const counts = approved.reduce((a, e) => { a[e.goal] = (a[e.goal] || 0) + 1; return a; }, {});
  const rich = Object.keys(counts).filter(g => counts[g] >= 2).map(Number);
  const targetGoals = (goals || (rich.length ? rich : Object.keys(counts).map(Number))).sort((a, b) => a - b);
  if (!targetGoals.length) return [];
  const tasks = targetGoals.map(g => makeTask({ projectId, step: 'compose', inputDoc: `SDG ${g} — ${SDG_TITLES[g]}`, goal: g, pages: approved.filter(e => e.goal === g).length }));
  const editor = makeTask({ projectId, step: 'edit', inputDoc: `All chapters (${targetGoals.length})`, dependsOn: tasks.map(t => t.id) });
  enqueueTasks([...tasks, editor]);
  logActivity({ projectId, title: `VLR composition started: ${targetGoals.length} chapter(s) queued`, provenance: `${projectId.slice(0, 3).toUpperCase()}-CH-000`, status: 'queued', type: 'chapter' });
  appendLog('INFO', `Chapter composition started for ${project?.name}: SDG ${targetGoals.join(', ')} (${approved.length} accepted snippets).`, projectId, { silent: true });
  return [...tasks, editor];
}
export function recomposeChapter(chapterId) {
  const c = getChapter(chapterId);
  if (!c) return null;
  const t = makeTask({ projectId: c.projectId, step: 'compose', inputDoc: `SDG ${c.goal} — ${SDG_TITLES[c.goal]}`, goal: c.goal, pages: getProjectExtractions(c.projectId).filter(e => e.goal === c.goal && e.status === 'approved').length });
  enqueueTasks([t]);
  logActivity({ projectId: c.projectId, title: `Chapter re-composition queued: ${c.title}`, status: 'queued', type: 'chapter' });
  return t;
}
/** Chat with the Chapter Reviewer: the user message is stored immediately, the assistant "thinks" for a moment, then rewrites. */
export function sendChapterFeedback(chapterId, text) {
  const c = getChapter(chapterId);
  if (!c || !String(text).trim()) return null;
  const userMsg = { id: uid('msg'), role: 'user', at: Date.now(), text: String(text).trim(), by: getState().auth.user?.name };
  const pendingId = uid('msg');
  update(s => { const x = s.chapters.find(q => q.id === chapterId); x.chat.push(userMsg, { id: pendingId, role: 'assistant', at: Date.now(), text: '', pending: true }); x.reviewing = true; });
  const delay = 1100 + Math.min(2200, String(text).length * 12);
  setTimeout(() => {
    update(s => {
      const x = s.chapters.find(q => q.id === chapterId);
      if (!x) return;
      const project = s.projects.find(p => p.id === x.projectId);
      const res = applyFeedback(x, text, { project, docs: s.documents.filter(d => d.projectId === x.projectId) });
      const m = x.chat.find(q => q.id === pendingId);
      if (m) { m.text = res.reply; m.pending = false; m.at = Date.now(); m.changes = res.changes; m.version = x.version; m.changedBlockIds = res.changedBlockIds; }
      x.reviewing = false;
      const p = s.projects.find(q => q.id === x.projectId); if (p) p.lastSyncedAt = Date.now();
      s.activity.unshift({ id: uid('act'), projectId: x.projectId, projectName: project?.name, title: `Chapter rewritten (v${x.version}): ${x.title}`, provenance: `${x.projectId.slice(0, 3).toUpperCase()}-CH-${String(x.number).padStart(2, '0')}`, ts: Date.now(), status: 'success', actor: 'Chapter Reviewer', type: 'chapter' });
      s.logs.push({ ts: Date.now(), level: 'INFO', msg: `Chapter Reviewer rewrote '${x.title}' → v${x.version} (${res.changes.length} change(s)) after feedback: "${String(text).slice(0, 60)}"`, projectId: x.projectId });
    });
  }, delay);
  return pendingId;
}
export function approveChapter(chapterId) {
  update(s => { const x = s.chapters.find(q => q.id === chapterId); if (x) { x.status = 'approved'; x.approvedBy = s.auth.user?.name; x.approvedAt = Date.now(); x.updatedAt = Date.now(); x.changedBlocks = []; } });
  const c = getChapter(chapterId);
  if (c) logActivity({ projectId: c.projectId, title: `Chapter approved: ${c.title} (v${c.version})`, provenance: `${c.projectId.slice(0, 3).toUpperCase()}-CH-${String(c.number).padStart(2, '0')}`, status: 'success', type: 'chapter' });
}
export function reopenChapter(chapterId) {
  update(s => { const x = s.chapters.find(q => q.id === chapterId); if (x) { x.status = 'in_review'; x.approvedBy = null; x.approvedAt = null; } });
  const c = getChapter(chapterId);
  if (c) logActivity({ projectId: c.projectId, title: `Chapter reopened for review: ${c.title}`, status: 'info', type: 'chapter' });
}
export function editChapterBlock(chapterId, blockId, text) {
  update(s => {
    const x = s.chapters.find(q => q.id === chapterId); if (!x) return;
    for (const sec of x.sections) { for (const b of sec.blocks || []) if (b.id === blockId) { b.text = text; } for (const ss of sec.subsections || []) for (const b of ss.blocks) if (b.id === blockId) b.text = text; }
    x.version += 1; x.updatedAt = Date.now(); x.changedBlocks = [blockId];
    x.revisions.push({ version: x.version, at: Date.now(), by: s.auth.user?.name || 'Reviewer', summary: 'manual edit of one paragraph' });
    if (x.status === 'approved') x.status = 'in_review';
  });
}
/** Assemble the final VLR from approved chapters (Book Assembly + DOCX Rendering tasks). */
export function assembleFinalBook(projectId) {
  const chs = getProjectChapters(projectId);
  if (!chs.length) return null;
  const t = makeTask({ projectId, step: 'assemble', inputDoc: `${chs.length} approved chapter(s)` });
  const r = makeTask({ projectId, step: 'render', inputDoc: `${getProject(projectId)?.city}_${getProject(projectId)?.year}_VLR.docx`, dependsOn: [t.id] });
  enqueueTasks([t, r]);
  logActivity({ projectId, title: `Final VLR assembly queued (${chs.length} chapters)`, provenance: `${projectId.slice(0, 3).toUpperCase()}-VLR-000`, status: 'queued', type: 'book' });
  return t;
}
/* ---------------- Final VLR review (comments on highlighted passages) ---------------- */
export function addBookComment(bookId, { sectionKey, chapterId = null, blockId, quote, text }) {
  const c = { id: uid('cmt'), sectionKey, chapterId, blockId, quote: String(quote || '').slice(0, 240), text: String(text || '').trim(), author: getState().auth.user?.name || 'Reviewer', at: Date.now(), status: 'open', replies: [] };
  update(s => { const b = s.books.find(x => x.id === bookId); if (b) b.comments.push(c); });
  const b = getBook(bookId);
  if (b) logActivity({ projectId: b.projectId, title: `Comment on final VLR: “${c.quote.slice(0, 50)}${c.quote.length > 50 ? '…' : ''}”`, provenance: `${b.projectId.slice(0, 3).toUpperCase()}-VLR-${String(b.version).padStart(3, '0')}`, status: 'info', type: 'book' });
  return c;
}
export function replyBookComment(bookId, commentId, text) {
  update(s => { const b = s.books.find(x => x.id === bookId); const c = b?.comments.find(q => q.id === commentId); if (c) c.replies.push({ author: s.auth.user?.name || 'Reviewer', at: Date.now(), text: String(text).trim() }); });
}
export function resolveBookComment(bookId, commentId, resolved = true) {
  update(s => { const b = s.books.find(x => x.id === bookId); const c = b?.comments.find(q => q.id === commentId); if (c) { c.status = resolved ? 'resolved' : 'open'; c.resolvedBy = resolved ? s.auth.user?.name : null; c.resolvedAt = resolved ? Date.now() : null; } });
}
export function deleteBookComment(bookId, commentId) { update(s => { const b = s.books.find(x => x.id === bookId); if (b) b.comments = b.comments.filter(c => c.id !== commentId); }); }
/** Ask the VLR Editor (simulated) to revise the commented passage; the block is rewritten in place (front/back matter or chapter). */
export function reviseFromComment(bookId, commentId) {
  const b0 = getBook(bookId); const c0 = b0?.comments.find(q => q.id === commentId);
  if (!b0 || !c0) return null;
  update(s => { const b = s.books.find(x => x.id === bookId); const c = b.comments.find(q => q.id === commentId); c.revising = true; });
  setTimeout(() => {
    update(s => {
      const b = s.books.find(x => x.id === bookId); if (!b) return;
      const c = b.comments.find(q => q.id === commentId); if (!c) return;
      const project = s.projects.find(p => p.id === b.projectId);
      let target = null;
      const scan = (blocks) => { for (const blk of blocks || []) if (blk.id === c.blockId) target = blk; };
      b.front.forEach(f => { scan(f.blocks); (f.subsections || []).forEach(ss => scan(ss.blocks)); });
      b.back.forEach(f => scan(f.blocks));
      s.chapters.filter(ch => b.chapterIds.includes(ch.id)).forEach(ch => ch.sections.forEach(sec => { scan(sec.blocks); (sec.subsections || []).forEach(ss => scan(ss.blocks)); }));
      let what = 'no matching passage found';
      if (target && target.text) { const r = reviseBlockFromComment(target, c.text, { project }); target.text = r.text; target.revised = true; what = r.what; }
      c.revising = false; c.replies.push({ author: 'VLR Editor', at: Date.now(), text: `Revised: ${what}. The passage now reads: “${(target?.text || '').replace(/\[\^\d+\]/g, '').replace(/\*\*/g, '').slice(0, 160)}…”` });
      c.status = 'resolved'; c.resolvedBy = 'VLR Editor'; c.resolvedAt = Date.now();
      b.version += 1; b.revisions.push({ version: b.version, at: Date.now(), by: 'VLR Editor', summary: `revised a passage from a reader comment (${what})` });
      if (b.status === 'final') b.status = 'draft';
      s.logs.push({ ts: Date.now(), level: 'INFO', msg: `VLR Editor revised '${b.title}' → v${b.version} from reader comment (${what}).`, projectId: b.projectId });
    });
  }, 1400);
  return true;
}
export function finalizeBook(bookId) {
  update(s => { const b = s.books.find(x => x.id === bookId); if (b) { b.status = 'final'; b.finalizedAt = Date.now(); b.finalizedBy = s.auth.user?.name; b.revisions.push({ version: b.version, at: Date.now(), by: s.auth.user?.name || 'Reviewer', summary: 'Finalised — ready for publication and export.' }); } });
  const b = getBook(bookId);
  if (b) logActivity({ projectId: b.projectId, title: `Final VLR published: ${b.title} (v${b.version})`, provenance: `${b.projectId.slice(0, 3).toUpperCase()}-VLR-${String(b.version).padStart(3, '0')}`, status: 'success', type: 'book' });
}
export function reopenBook(bookId) {
  update(s => { const b = s.books.find(x => x.id === bookId); if (b) { b.status = 'draft'; b.finalizedAt = null; } });
}

/* ---------------- Ask (VLR Assist) ---------------- */
export function askQuestion(text) {
  const q = String(text || '').trim();
  if (!q) return null;
  if (getState().ask.messages.some(m => m.pending)) return null;
  const pendingId = uid('msg');
  update(s => {
    s.ask.messages.push({ id: uid('msg'), role: 'user', at: Date.now(), text: q, by: s.auth.user?.name },
      { id: pendingId, role: 'assistant', at: Date.now(), pending: true, text: '' });
    if (s.ask.messages.length > 80) s.ask.messages.splice(0, s.ask.messages.length - 80);
  });
  const delay = 900 + Math.min(1800, q.length * 14);
  setTimeout(() => {
    update(s => {
      const m = s.ask.messages.find(x => x.id === pendingId);
      if (!m) return;
      let a;
      try { a = answerQuestion(q, { scope: s.ask.scope }); } catch (e) { console.error(e); a = { text: 'I hit a snag reading the evidence base — try rephrasing the question.', citations: [], followUps: [] }; }
      Object.assign(m, a, { pending: false, at: Date.now() });
    });
  }, delay);
  return pendingId;
}
export function setAskScope(scope) { update(s => { s.ask.scope = scope; }); }
export function clearAsk() { update(s => { s.ask.messages = []; }); }
