/* store.js — single in-memory state persisted to localStorage, with subscriptions and selectors */
import { buildSeed, expectedExtractions, PILLARS } from './seed.js';

export const STORAGE_KEY = 'vlrforge.demo.v10';

let state = load();
const listeners = new Set();
let persistTimer = null;
let notifyScheduled = false;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1 && Array.isArray(parsed.projects)) {
        // merge in any top-level keys added by newer code so an older persisted state never crashes the app
        const defaults = buildSeed();
        for (const k of Object.keys(defaults)) if (parsed[k] === undefined) parsed[k] = defaults[k];
        parsed.settings = { ...defaults.settings, ...(parsed.settings || {}) };
        return parsed;
      }
    }
  } catch { /* ignore */ }
  const s = buildSeed();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  return s;
}

export function getState() { return state; }

/** Mutate state inside fn(state); persists (throttled) and notifies subscribers (rAF-batched). */
export function update(fn, { silent = false } = {}) {
  const r = fn(state);
  persist();
  if (!silent) notify();
  return r;
}

const replacer = (k, v) => (typeof k === 'string' && k.startsWith('_') ? undefined : v);
function writeNow() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state, replacer)); } catch (e) { console.warn('persist failed', e); } }
export function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(writeNow, 150);
}
window.addEventListener('pagehide', () => { clearTimeout(persistTimer); try { if (localStorage.getItem(STORAGE_KEY) !== null) writeNow(); } catch { /* ignore */ } });

export function notify() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  const run = () => { notifyScheduled = false; listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); };
  // rAF never fires in a hidden tab; fall back to a timer so state changes still reach subscribers
  if (typeof document !== 'undefined' && document.hidden) setTimeout(run, 0); else requestAnimationFrame(run);
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function resetState({ keepAuth = true } = {}) {
  const user = state.auth?.user;
  state = buildSeed();
  if (keepAuth) state.auth.user = user;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  notify();
  return state;
}

/* ---------------- selectors ---------------- */
export const currentUser = () => state.auth.user;
export const isLoggedIn = () => !!state.auth.user;
export const getProject = (id) => state.projects.find(p => p.id === id);
export const getProjectDocs = (pid) => state.documents.filter(d => d.projectId === pid);
export const getDoc = (id) => state.documents.find(d => d.id === id);
export const getProjectTasks = (pid) => state.tasks.filter(t => t.projectId === pid);
export const getTask = (id) => state.tasks.find(t => t.id === id);
export const getProjectRuns = (pid) => state.runs.filter(r => r.projectId === pid);
export const getExtraction = (id) => state.extractions.find(e => e.id === id);
export const getProjectExtractions = (pid, pillar) => state.extractions.filter(e => e.projectId === pid && (!pillar || e.pillar === pillar));
export const getComments = (extractionId) => state.comments.filter(c => c.extractionId === extractionId).sort((a, b) => a.createdAt - b.createdAt);
export const getProjectActivity = (pid) => state.activity.filter(a => !pid || a.projectId === pid).sort((a, b) => b.ts - a.ts);
export const getProjectReports = (pid) => state.reports.filter(r => r.projectId === pid).sort((a, b) => b.createdAt - a.createdAt);
export const getLogs = (pid) => state.logs.filter(l => !pid || pid === 'all' || l.projectId === pid);

export const getProjectChapters = (pid) => state.chapters.filter(c => c.projectId === pid).sort((a, b) => a.goal - b.goal);
export const getChapter = (id) => state.chapters.find(c => c.id === id);
export const getProjectBook = (pid) => state.books.find(b => b.projectId === pid);
export const getBook = (id) => state.books.find(b => b.id === id);
export const runningTasks = (pid) => state.tasks.filter(t => t.status === 'running' && (!pid || pid === 'all' || t.projectId === pid));
export const queuedTasks = (pid) => state.tasks.filter(t => t.status === 'queued' && (!pid || pid === 'all' || t.projectId === pid));

export const taskCost = (t) => Number(t.cost || 0);
export const projectCost = (pid) => getProjectTasks(pid).reduce((a, t) => a + taskCost(t), 0);
export const totalCost = () => state.tasks.reduce((a, t) => a + taskCost(t), 0);

/** Derived numbers for a project (completion %, extraction %, phase, queue labels, cost). */
export function projectStats(project) {
  const p = typeof project === 'string' ? getProject(project) : project;
  if (!p) return null;
  const docs = getProjectDocs(p.id);
  const ext = getProjectExtractions(p.id);
  const tasks = getProjectTasks(p.id);
  const processed = docs.filter(d => d.status === 'processed').length;
  const processedRatio = docs.length ? processed / docs.length : 0;
  const pillarsDone = PILLARS.filter(pl => ext.some(e => e.pillar === pl.key)).length;
  const approved = ext.filter(e => e.status === 'approved').length;
  const approvedRatio = ext.length ? approved / ext.length : 0;
  const running = tasks.filter(t => t.status === 'running').length;
  const queued = tasks.filter(t => t.status === 'queued').length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  const cost = tasks.reduce((a, t) => a + taskCost(t), 0);
  const chapters = state.chapters.filter(c => c.projectId === p.id);
  const chaptersApproved = chapters.filter(c => c.status === 'approved').length;
  const chaptersRatio = chapters.length ? chaptersApproved / chapters.length : 0;
  const book = state.books.find(b => b.projectId === p.id);
  const bookFinal = book?.status === 'final';
  const allReviewed = ext.length > 0 && approved === ext.length;
  let completion = p.status === 'archived' ? 100 : Math.round(10 * processedRatio + 40 * (pillarsDone / PILLARS.length) + 20 * approvedRatio + 20 * chaptersRatio + (book ? 5 : 0) + (bookFinal ? 5 : 0));
  completion = Math.max(0, Math.min(100, completion));
  const extractionPct = p.status === 'archived' ? 100 : Math.min(100, Math.round(100 * ext.length / Math.max(1, expectedExtractions(p))));
  let phase;
  if (p.status === 'archived') phase = 'Finalized';
  else if (p.status === 'provisioning') phase = 'Phase 1 (Provisioning)';
  else if (bookFinal) phase = 'Phase 5 (Published)';
  else if (book) phase = 'Phase 5 (Final VLR review)';
  else if (chapters.length) phase = 'Phase 4 (Chapter composition)';
  else if (allReviewed) phase = 'Phase 3 (Review complete)';
  else if (completion < 15) phase = 'Phase 1 (Ingestion)';
  else if (approved > 0 && pillarsDone === PILLARS.length) phase = 'Phase 3 (Review)';
  else phase = 'Phase 2 (Extraction)';
  let queueLabel, queueMeta, barPct, barCls;
  if (p.status === 'archived') { queueLabel = 'Reporting Complete'; queueMeta = 'Finalized'; barPct = 100; barCls = 'success'; }
  else if (p.status === 'provisioning') { queueLabel = 'Ingesting Metadata...'; queueMeta = `Pending: ${docs.length - processed}`; barPct = Math.round(processedRatio * 100); barCls = ''; }
  else if (bookFinal) { queueLabel = 'VLR Published'; queueMeta = `v${book.version} · ${book.stats?.pages || '—'} pages`; barPct = 100; barCls = 'success'; }
  else if (book) { queueLabel = 'Final VLR Review'; queueMeta = `${book.comments.filter(c => c.status === 'open').length} open comment${book.comments.filter(c => c.status === 'open').length === 1 ? '' : 's'}`; barPct = completion; barCls = 'sky'; }
  else if (chapters.length) { queueLabel = running || queued ? 'Composing Chapters' : 'Chapter Review'; queueMeta = `Chapters approved: ${chaptersApproved}/${chapters.length}`; barPct = completion; barCls = 'sky'; }
  else { queueLabel = running || queued ? 'Processing Queue' : allReviewed ? 'Ready to Write VLR' : 'Review Pending'; queueMeta = failed ? `Critical: ${failed}` : queued ? `Queued: ${queued}` : running ? `Running: ${running}` : allReviewed ? 'All evidence approved' : `Awaiting review: ${ext.length - approved}`; barPct = completion; barCls = ''; }
  return { docs: docs.length, processed, processedRatio, extractions: ext.length, approved, pillarsDone, running, queued, failed, cost, completion, extractionPct, phase, queueLabel, queueMeta, barPct, barCls, preprocessed: !!p.preprocessedAt,
    chapters: chapters.length, chaptersApproved, allReviewed, hasBook: !!book, bookFinal, bookId: book?.id || null,
    lastSyncedAt: p.lastSyncedAt || p.createdAt };
}

/** Global counts for the tasks page. */
export function taskStats(pid) {
  const all = state.tasks.filter(t => !pid || pid === 'all' || t.projectId === pid);
  const dayAgo = Date.now() - 86_400_000;
  const running = all.filter(t => t.status === 'running').length;
  const failed24h = all.filter(t => t.status === 'failed' && (t.finishedAt || t.createdAt) > dayAgo).length;
  const finished = all.filter(t => ['success', 'failed'].includes(t.status));
  const ok = finished.filter(t => t.status === 'success').length;
  const completionRate = finished.length ? (100 * ok / finished.length) : 100;
  const cost = all.reduce((a, t) => a + taskCost(t), 0);
  return { running, failed24h, completionRate, cost, total: all.length, queued: all.filter(t => t.status === 'queued').length };
}
