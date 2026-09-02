/* ask.js — "VLR Assist": a simulated, fully open Q&A assistant over the demo's live state.
 * Every numeric claim in an answer is read from the store (extractions, tasks, docs, chapters, books)
 * and cited back to its source (document · page, review page, tasks page…), like a grounded RAG assistant.
 */
import { getState, getProject, getProjectDocs, getProjectExtractions, getProjectTasks, getProjectChapters, getProjectBook, projectStats, projectCost, taskStats } from './store.js';
import { fmtValue, GOAL_SUBJECT, targetOf } from './composer.js';
import { SDG_TITLES, fmtCost, fmtNumber, capitalize } from './ui.js';
import { STEP_META, quotePlain } from './seed.js';

const PILLAR_LABEL = { indicators: 'Urban Data', documentary: 'Documentary', projects: 'Projects', stakeholders: 'Stakeholder' };
const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9%€$.\s-]/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(w => w.length > 2 && !STOP.has(w));
const STOP = new Set(['the', 'and', 'for', 'with', 'what', 'whats', 'how', 'much', 'many', 'does', 'about', 'tell', 'show', 'give', 'this', 'that', 'are', 'is', 'was', 'were', 'has', 'have', 'can', 'you', 'per', 'rate', 'level', 'city', 'projects', 'project']);

/* ---------------- scope ---------------- */
export function resolveScope(text, scopeSetting) {
  const t = norm(text);
  const s = getState();
  const byName = s.projects.find(p => t.includes(norm(p.city)) || t.includes(norm(p.name)));
  if (byName) return { project: byName, explicit: true };
  if (scopeSetting && scopeSetting !== 'all') { const p = getProject(scopeSetting); if (p) return { project: p, explicit: false }; }
  const active = s.projects.find(p => p.status === 'active') || s.projects[0];
  return { project: active || null, all: !scopeSetting || scopeSetting === 'all', explicit: false };
}

/* ---------------- helpers ---------------- */
const trendWord = (e) => {
  if (!e.trend || e.trend.length < 2) return null;
  const a = e.trend[0].value, b = e.trend[e.trend.length - 1].value;
  const up = b > a; const better = e.direction === 'lower-better' ? !up : up;
  return Math.abs(b - a) / Math.max(1e-9, Math.abs(a)) < 0.02 ? 'stable' : better ? 'improving' : 'worsening';
};
const reviewCite = (e, p) => ({ label: `${e.source?.docName || 'Source document'} · p. ${e.source?.page ?? '—'}`, href: `#/review/${e.id}`, sub: `SDG ${e.sdg} · ${Math.round(e.confidence)}% confidence · ${PILLAR_LABEL[e.pillar]} pillar` });
const docCite = (e, p) => (e.source?.docId ? { label: 'Open highlighted page in Document Viewer', href: `#/projects/${p.id}/documents/${e.source.docId}?page=${e.source.page}&hl=${e.id}`, sub: `¶${e.source.paragraph ?? 1}` } : null);
const statusWord = { extracted: 'awaiting review', approved: 'approved', rerun_queued: 'queued for re-extraction', manual: 'added manually by a reviewer', rejected: 'rejected' };

/* ---------------- intent handlers ---------------- */
function indicatorAnswer(text, p) {
  const ext = getProjectExtractions(p.id);
  const qw = words(text);
  if (!qw.length) return null;
  const scored = ext.map(e => {
    const hay = norm([e.title, e.indicator, e.topic, GOAL_SUBJECT[e.goal], e.summary, e.group].filter(Boolean).join(' '));
    let score = qw.reduce((a, w) => a + (hay.includes(w) ? 1 : 0), 0);
    if (e.pillar === 'indicators') score += 0.25;
    return { e, score };
  }).filter(x => x.score >= 1.25).sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const { e } = scored[0];
  const trend = trendWord(e);
  const lines = [];
  if (e.pillar === 'indicators') {
    lines.push(`**${e.title}** in ${p.city} stands at **${fmtValue(e)}** (${e.year || p.year - 1}), reported under SDG ${e.sdg} — ${SDG_TITLES[e.goal]}.`);
    if (trend && e.trend) lines.push(`Across the available readings (${e.trend.map(t => `${t.year}: ${t.value}`).join(' · ')}) the measure is **${trend}**.`);
    lines.push(`The value is copied verbatim from the source: “${quotePlain(e.source?.quote || '').slice(0, 220)}${quotePlain(e.source?.quote || '').length > 220 ? '…' : ''}”`);
    lines.push(`Review status: ${statusWord[e.status] || e.status} · AI confidence ${Math.round(e.confidence)}%.`);
  } else if (e.pillar === 'projects') {
    lines.push(`**${e.title}** (${p.city}) — ${e.projectStatus || 'status n/a'}${e.period ? `, ${e.period}` : ''}${e.budget ? `, budget quoted as **${e.budget}**` : ''}${e.lead ? `, led by ${e.lead}` : ''}. Linked to SDG ${e.sdg}.`);
    if (e.summary) lines.push(e.summary);
  } else if (e.pillar === 'documentary') {
    lines.push(`The documentary record for ${p.city} carries a ${e.categoryLabel?.toLowerCase() || 'finding'} (${e.category}) under SDG ${e.sdg}: **${e.title}**.`);
    if (e.summary) lines.push(e.summary);
  } else {
    lines.push(`Stakeholder voices in ${p.city} raised this as a **${(e.category || 'theme').toLowerCase()}** under SDG ${e.sdg}: **${e.title}** (${e.group || 'residents'}, ${(e.engagement || 'consultation').toLowerCase()}).`);
    lines.push(`Verbatim: “${quotePlain(e.source?.quote || '')}”`);
  }
  const others = scored.slice(1, 3).map(x => x.e);
  return {
    text: lines.join('\n'),
    citations: [reviewCite(e, p), docCite(e, p)].filter(Boolean),
    followUps: [
      ...(others.length ? [`What about ${others[0].title.toLowerCase()}?`] : []),
      e.pillar === 'indicators' ? `What is ${p.city} doing about ${(e.topic || e.title).toLowerCase()}?` : `Which indicators do we have for SDG ${e.goal}?`,
      `How confident are we in this and where does it come from?`,
    ],
  };
}

function costAnswer(text, p, all) {
  const s = getState();
  const scopeTasks = all ? s.tasks : getProjectTasks(p.id);
  const done = scopeTasks.filter(t => ['success', 'failed', 'cancelled'].includes(t.status));
  const total = scopeTasks.reduce((a, t) => a + (t.cost || 0), 0);
  const byStep = {};
  done.forEach(t => { byStep[t.label] = (byStep[t.label] || 0) + (t.cost || 0); });
  const top = Object.entries(byStep).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const lines = [
    all ? `Total pipeline spend across all projects is **${fmtCost(total)}** over ${scopeTasks.length} tasks.` : `**${p.name}** has cost **${fmtCost(projectCost(p.id))}** so far, across ${scopeTasks.length} pipeline tasks.`,
    `Every task carries its own cost; the most expensive steps to date:`,
  ];
  if (all) {
    const byProject = s.projects.map(pr => [pr.name, projectCost(pr.id)]).sort((a, b) => b[1] - a[1]);
    return { text: lines[0] + '\nSpend by project:', table: { columns: ['Project', 'Cost'], rows: byProject.map(([n, c]) => [n, fmtCost(c)]) }, citations: [{ label: 'Workflow Orchestration — every task with its cost', href: '#/tasks', sub: 'COST column · Automation Engine total' }], followUps: [`How much has ${s.projects[0]?.city} cost?`, 'Which step is the most expensive?', 'What is our monthly budget?'] };
  }
  return {
    text: lines.join('\n'), table: { columns: ['Step', 'Cost to date'], rows: top.map(([k, v]) => [k, fmtCost(v)]) },
    citations: [{ label: `Task history for ${p.name}`, href: `#/tasks?project=${p.id}`, sub: 'per-task cost in the COST column' }, { label: 'Budget & cost settings', href: '#/settings?tab=budget', sub: 'limits, alerts and spend per project' }],
    followUps: ['What would a full re-run cost?', 'Show the budget limits', `How far along is ${p.city}?`],
  };
}

function statusAnswer(text, p) {
  const st = projectStats(p);
  const chapters = getProjectChapters(p.id); const book = getProjectBook(p.id);
  const lines = [
    `**${p.name}** is in **${st.phase}**, at **${st.completion}%** overall completion.`,
    `• Sources: ${st.processed}/${st.docs} documents processed · Extraction ${st.extractionPct}% (${st.extractions} evidence items, ${st.approved} approved)`,
    `• Pipeline: ${st.running} running, ${st.queued} queued, ${st.failed} failed · cost to date ${fmtCost(st.cost)}`,
    chapters.length ? `• VLR: ${st.chaptersApproved}/${chapters.length} chapters approved${book ? ` · final book ${book.status === 'final' ? `**published** (v${book.version}, ${book.stats.pages} pages)` : `assembled (v${book.version}), in review`}` : ''}` : st.allReviewed ? '• Evidence fully reviewed — ready to write the VLR chapters.' : `• Review: ${st.extractions - st.approved} item(s) still awaiting human review.`,
  ];
  return {
    text: lines.join('\n'),
    citations: [{ label: `${p.name} — project overview`, href: `#/projects/${p.id}`, sub: 'lifecycle, task queue, source documents' }, ...(book ? [{ label: 'Final VLR', href: `#/projects/${p.id}/vlr`, sub: `${book.stats.chapters} chapters · ${book.stats.footnotes} footnotes` }] : [])],
    followUps: st.allReviewed && !chapters.length ? ['Write the VLR chapters now', 'What did the pipeline cost?'] : ['What is still awaiting review?', 'How much has it cost so far?', chapters.length ? 'Summarise the final VLR' : 'Which SDGs have the strongest evidence?'],
  };
}

function coverageAnswer(text, p) {
  const ext = getProjectExtractions(p.id);
  if (!ext.length) return { text: `${p.name} has no extracted evidence yet — run the pipeline first.`, citations: [{ label: p.name, href: `#/projects/${p.id}` }], followUps: ['Run the full pipeline', 'What documents do we have?'] };
  const byGoal = {};
  ext.forEach(e => { (byGoal[e.goal] ||= { n: 0, pillars: new Set(), conf: 0 }); byGoal[e.goal].n++; byGoal[e.goal].pillars.add(e.pillar); byGoal[e.goal].conf += e.confidence; });
  const rows = Object.entries(byGoal).map(([g, v]) => ({ goal: Number(g), n: v.n, pillars: v.pillars.size, conf: Math.round(v.conf / v.n) })).sort((a, b) => b.n - a.n);
  const strongest = rows[0]; const weakest = rows[rows.length - 1];
  const wantWeak = /weak|gap|missing|thin|least/.test(norm(text));
  const lead = wantWeak
    ? `The thinnest evidence base in ${p.city} is **SDG ${weakest.goal} — ${SDG_TITLES[weakest.goal]}** (${weakest.n} item${weakest.n === 1 ? '' : 's'} from ${weakest.pillars} pillar${weakest.pillars === 1 ? '' : 's'}); the review will hedge accordingly rather than pad the chapter.`
    : `${p.city} holds evidence on **${rows.length} SDGs**; the strongest base is **SDG ${strongest.goal} — ${SDG_TITLES[strongest.goal]}** (${strongest.n} items, ${strongest.pillars}/4 pillars).`;
  return {
    text: lead + '\nEvidence by goal:',
    table: { columns: ['SDG', 'Items', 'Pillars', 'Avg confidence'], rows: rows.map(r => [`SDG ${r.goal} · ${SDG_TITLES[r.goal]}`, String(r.n), `${r.pillars}/4`, `${r.conf}%`]) },
    citations: [{ label: `${p.name} — pillar tabs`, href: `#/projects/${p.id}`, sub: 'Indicators · Documentary · Projects · Stakeholders' }],
    followUps: [`Why is SDG ${weakest.goal} thin?`, 'Which indicators are still awaiting review?', 'Write the VLR chapters'],
  };
}

function stakeholderAnswer(text, p) {
  const st = getProjectExtractions(p.id, 'stakeholders');
  if (!st.length) return null;
  const qw = words(text);
  const pick = st.map(e => ({ e, s: qw.reduce((a, w) => a + (norm(e.title + ' ' + (e.source?.quote || '')).includes(w) ? 1 : 0), 0) })).sort((a, b) => b.s - a.s)[0].e;
  const rest = st.filter(e => e !== pick).slice(0, 2);
  return {
    text: [`Residents of ${p.city} have been heard through ${[...new Set(st.map(e => (e.engagement || 'consultations').toLowerCase()))].join(', ')}. On **${pick.title.toLowerCase()}** (${pick.group}):`,
      `“${quotePlain(pick.source?.quote || '')}”`,
      rest.length ? `Other voices: ${rest.map(e => `**${e.category}** — ${e.title.toLowerCase()} (${e.group})`).join('; ')}.` : ''].filter(Boolean).join('\n'),
    citations: [reviewCite(pick, p), docCite(pick, p)].filter(Boolean),
    followUps: ['How do these voices show up in the final VLR?', 'What is the city doing about it?', 'Which stakeholder groups were engaged?'],
  };
}

function documentsAnswer(text, p) {
  const docs = getProjectDocs(p.id);
  const byType = {}; docs.forEach(d => { byType[d.type] = (byType[d.type] || 0) + 1; });
  const langs = [...new Set(docs.map(d => d.language))];
  return {
    text: `**${p.name}** draws on **${docs.length} source documents** (${Object.entries(byType).map(([t, n]) => `${n} ${t}`).join(', ')}), in ${langs.join(', ')}. ${docs.filter(d => d.status === 'processed').length} are parsed; non-English sources are translated to EN before the qualitative pillars run. Documents are uploaded once at project level — every pillar extractor scans the whole pool.`,
    table: { columns: ['Document', 'Type', 'Lang', 'Status'], rows: docs.slice(0, 6).map(d => [d.name, d.type, d.language, capitalize(d.status)]) },
    citations: [{ label: 'Source documents table', href: `#/projects/${p.id}`, sub: 'parse / translate / delete per document' }],
    followUps: ['Upload more documents', 'Which document produced the housing figure?', 'How does parsing work?'],
  };
}

function chaptersAnswer(text, p) {
  const chs = getProjectChapters(p.id); const book = getProjectBook(p.id); const st = projectStats(p);
  if (!chs.length) return { text: st.allReviewed ? `${p.name} has no chapters yet, but every evidence item is approved — you can start composition now: one Chapter Composer per reported SDG, following the canonical VLR chapter spine.` : `${p.name} is not ready for chapters yet: ${st.extractions - st.approved} evidence item(s) still await review. Approve them, then “Write VLR chapters”.`, citations: [{ label: 'Chapters workspace', href: `#/projects/${p.id}/chapters` }], followUps: ['What is still awaiting review?', 'What does a chapter contain?'] };
  const lines = [
    `**${p.name}** has **${chs.length} chapters** (${st.chaptersApproved} approved): ${chs.map(c => `SDG ${c.goal} (${c.tier}, v${c.version})`).join(', ')}.`,
    book ? `The final VLR is ${book.status === 'final' ? `**published** — v${book.version}, ${book.stats.pages} pages, ${book.stats.figures} figures, ${book.stats.footnotes} footnotes, ${book.comments.filter(c => c.status === 'open').length} open reader comment(s)` : `assembled and in review (v${book.version}); highlight any passage there to comment or ask the editor to revise`}.` : `When all chapters are approved, “Assemble final VLR” builds the book with front matter, consolidated recommendations and a provenance annex.`,
  ];
  return {
    text: lines.join('\n'),
    citations: [{ label: 'Chapters workspace', href: `#/projects/${p.id}/chapters`, sub: 'review each chapter with the Chapter Reviewer' }, ...(book ? [{ label: 'Final VLR', href: `#/projects/${p.id}/vlr`, sub: 'highlight · comment · download DOCX/PDF' }] : [])],
    followUps: book ? ['Download the final VLR as Word', 'What comments are still open?'] : ['Open the first chapter', 'What feedback can the Chapter Reviewer apply?'],
  };
}

function compareAnswer(text) {
  const s = getState(); const t = norm(text);
  const named = s.projects.filter(p => t.includes(norm(p.city)));
  const pair = named.length >= 2 ? named.slice(0, 2) : s.projects.slice(0, 2);
  if (pair.length < 2) return null;
  const rows = pair.map(p => { const st = projectStats(p); return [p.name, st.phase, `${st.completion}%`, `${st.docs}`, `${st.extractions}`, fmtCost(st.cost)]; });
  return {
    text: `Side by side:`,
    table: { columns: ['Project', 'Phase', 'Completion', 'Docs', 'Evidence', 'Cost'], rows },
    citations: pair.map(p => ({ label: p.name, href: `#/projects/${p.id}` })),
    followUps: [`Why is ${pair[0].city} ahead?`, 'Which SDGs overlap between them?'],
  };
}

function howWorksAnswer(text) {
  const t = norm(text);
  const topics = [
    { re: /(parse|parsing|parser|llama)/, slug: 'parser', label: 'Parser', body: 'Documents are parsed with **LlamaParse v4** into structured markdown (layout, tables, OCR fallback), page by page — the page numbers you see in every citation come from here.' },
    { re: /translat/, slug: 'translation', label: 'Translation', body: 'Non-English sources are translated to English with **Gemini 2.5 Flash** before the qualitative pillars run; Pillar A extracts directly from the native language and translates only the free-text fields.' },
    { re: /(extract|pillar|indicator)/, slug: 'pillar-a', label: 'Indicator extraction (Pillar A)', body: 'Four pillars scan the whole document pool: **Urban Data** (indicator values with exact quotes), **Documentary** (challenges C1 / commitments C2 / policies C3), **Projects**, and **Stakeholder voices**. Every item carries document, page and verbatim quotation.' },
    { re: /(provenance|traceab|source|cite|citation)/, slug: 'provenance', label: 'Traceability & provenance', body: 'Every value is traceable to a document, a page and an exact quote; the review page shows the highlighted evidence, and the final VLR footnotes it. Nothing is published that fails verification.' },
    { re: /(chapter|compose|book|vlr\b|write)/, slug: 'chapters', label: 'Chapter composition', body: 'Once evidence is approved, the **Chapter Composer** writes one chapter per reported SDG following the canonical spine (global → regional → national → city, progress by target, alignment, recommendations), and the **Chapter Reviewer** rewrites on your feedback until you approve.' },
    { re: /(cost|price)/, slug: 'steps-costs', label: 'Steps & costs', body: 'Each step is metered: ' + ['parse', 'translate', 'extract_indicators', 'documentary'].map(k => `${STEP_META[k].label} from ${fmtCost(STEP_META[k].base)}`).join(', ') + ' — the exact cost lands on every task row.' },
  ];
  const hit = topics.find(x => x.re.test(t)) || topics[2];
  return { text: hit.body, citations: [{ label: `Documentation — ${hit.label}`, href: `#/documentation?doc=${hit.slug}`, sub: 'product manual' }], followUps: ['How much does a full run cost?', 'How is provenance kept?', 'What does a chapter contain?'] };
}

function capabilitiesAnswer(p) {
  return {
    text: [`I answer questions about your VLR data with **grounded, cited answers** — every number I quote comes from a source document with a page and an exact quotation. Try me on:`,
      `• **Values** — “What is ${p ? p.city + '’s' : 'the'} unemployment rate?”`,
      `• **Progress** — “How far along is ${p ? p.city : 'the project'}?”`,
      `• **Costs** — “How much has the pipeline cost?”`,
      `• **Evidence** — “Which SDG has the weakest evidence?”`,
      `• **Voices** — “What do residents say about housing?”`,
      `• **The book** — “Summarise the final VLR.”`].join('\n'),
    citations: [], followUps: [`How far along is ${p ? p.city : 'Madrid'}?`, 'Which SDG has the weakest evidence?', 'What do residents say about housing?'],
  };
}

/* ---------------- entry ---------------- */
export function answerQuestion(text, { scope = 'all' } = {}) {
  const t = norm(text);
  const { project: p, all } = resolveScope(text, scope);
  if (!p) return { text: 'There are no projects yet — create one and run the pipeline, then ask me anything about it.', citations: [], followUps: ['Create a new project'] };
  const scopedAll = all && !/(madrid|bogot|vancouver|lisbon)/.test(t);

  if (/^(hi|hello|hey|hola)\b/.test(t) || /what can you (do|answer)|help me|who are you/.test(t)) return capabilitiesAnswer(p);
  if (/\b(compare|versus|vs)\b/.test(t)) { const r = compareAnswer(text); if (r) return r; }
  if (/(cost|spen[dt]|expensive|how much.*(run|pipeline|paid)|budget consumed|\$)/.test(t) && !/budget of the|project budget/.test(t)) return costAnswer(text, p, scopedAll);
  if (/(status|progress|phase|how far|where (are|is)|complete|ready)/.test(t)) return statusAnswer(text, p);
  if (/(which sdg|coverage|gap|missing|weakest|strongest|thin|evidence base|how many (sdg|goal))/.test(t)) return coverageAnswer(text, p);
  if (/(resident|community|stakeholder|voices?|citizen|neighbou?r|what do people|consultation)/.test(t)) { const r = stakeholderAnswer(text, p); if (r) return r; }
  if (/(document|sources?\b|files?\b|upload|pdf|corpus)/.test(t)) return documentsAnswer(text, p);
  if (/(chapter|final vlr|the book|publish|docx|summari[sz]e the (vlr|book|review))/.test(t)) return chaptersAnswer(text, p);
  if (/(how (does|do|is)|works|methodolog|pipeline|parser|translat|provenance|traceab)/.test(t)) return howWorksAnswer(text);
  const ind = indicatorAnswer(text, p);
  if (ind) return ind;
  if (/(team|who (has|is)|member)/.test(t)) {
    const team = getState().settings.team;
    return { text: `The workspace has ${team.length} members: ${team.map(m => `**${m.name}** (${m.role})`).join(', ')}.`, citations: [{ label: 'Team settings', href: '#/settings?tab=team' }], followUps: ['Invite a member', 'Who approved the evidence?'] };
  }
  // graceful grounded fallback: project overview + suggestions
  const st = projectStats(p);
  return {
    text: [`I could not match that to a specific evidence item, so here is where **${p.name}** stands: ${st.phase}, ${st.completion}% complete, ${st.extractions} evidence items (${st.approved} approved) from ${st.docs} documents, ${fmtCost(st.cost)} spent.`,
      `Ask me about a specific measure (housing, transport, water, unemployment, air quality…), costs, coverage, stakeholder voices, or the chapters.`].join('\n'),
    citations: [{ label: p.name, href: `#/projects/${p.id}` }],
    followUps: [`What is ${p.city}’s public transport accessibility?`, 'Which SDG has the weakest evidence?', 'How much has the pipeline cost?'],
  };
}

/** Grounded suggestion chips for the empty state. */
export function suggestedQuestions(scope = 'all') {
  const { project: p } = resolveScope('', scope);
  const s = getState();
  const withBook = s.projects.find(pr => getProjectBook(pr.id));
  const ind = p ? getProjectExtractions(p.id, 'indicators')[0] : null;
  return [
    p && ind ? `What is ${p.city}’s ${ind.title.toLowerCase()}?` : 'What is Madrid’s public transport accessibility?',
    p ? `How far along is ${p.city}?` : 'How far along is Madrid?',
    `How much has the pipeline cost so far?`,
    p ? `Which SDG has the weakest evidence in ${p.city}?` : 'Which SDG has the weakest evidence?',
    p ? `What do residents of ${p.city} say about housing?` : 'What do residents say about housing?',
    withBook ? `Summarise the final VLR for ${withBook.city}` : 'What does a chapter contain?',
    'How is provenance kept?',
    'Compare Madrid and Bogotá',
  ];
}
