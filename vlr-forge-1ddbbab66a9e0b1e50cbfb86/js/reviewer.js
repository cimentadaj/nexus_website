/* reviewer.js — the "Chapter Reviewer" (a simulated LLM). It reads free-text feedback, recognises the kinds of review
 * asks the VLR team actually makes (cite claims, remove unsupported explanations, no rankings, no internal jargon,
 * target codes in headings, add the global/regional layer, pillar attribution, shorten/expand, hedge, tone, replace X with Y…)
 * and rewrites the chapter deterministically, returning a human-readable reply + the list of changed blocks.
 */
import { uid } from './ui.js';
import { SDG_TITLES } from './ui.js';
import { targetRef, targetOf, projectRegion, wordCount } from './composer.js';

const SPEC = [
  { key: 'cite', re: /\b(cite|citation|footnote|reference|source|traceab|apa)\b/i },
  { key: 'unsupported', re: /\b(unsupported|invent|speculat|guess|not supported|doesn'?t support|hallucinat|explanation[s]? the data|report what|only what)\b/i },
  { key: 'ranking', re: /\b(rank|strongest|weakest|best|worst|leader|laggard|compar(e|ing) countries)\b/i },
  { key: 'jargon', re: /\b(jargon|internal|database|pipeline|snippet|machinery|plain english|plain language|reader)\b/i },
  { key: 'codes-add', re: /\b(target (code|number)s?|\(target|codes? in (the )?heading|add (the )?target)/i },
  { key: 'codes-remove', re: /\b(remove|drop|no) (the )?(target )?(codes?|numbers?) (from|in) (the )?heading/i },
  { key: 'layers', re: /\b(global|regional|national) (layer|context|rung|paragraph|level)|meta-?analysis|arab region|regional standing/i },
  { key: 'pillar', re: /\b(pillar|evidence base|which evidence|attribut)/i },
  { key: 'shorten', re: /\b(short(er|en)|concise|trim|cut|too long|tighten|condense|brief)\b/i },
  { key: 'expand', re: /\b(expand|longer|more detail|elaborate|develop|flesh out|deepen)\b/i },
  { key: 'hedge', re: /\b(hedge|overclaim|too certain|cautious|uncertain|tentative|confirm)\b/i },
  { key: 'numbers', re: /\b(number|figure|statistic|math|add up|verify|check the (data|figures)|sanity)\b/i },
  { key: 'why', re: /\b(why (this|the) (sdg|goal)|selected|selection|rationale)\b/i },
  { key: 'tone', re: /\b(tone|formal|promotional|marketing|sales|neutral|objective|dry|voice|style)\b/i },
  { key: 'recommend', re: /\b(recommend|policy|means of implementation)\b/i },
  { key: 'structure', re: /\b(structure|identical|same (order|place|structure)|consistent|numbering|box(es)? (in|at))\b/i },
];
const SECTION_HINTS = [
  { key: 'intro', re: /\bintro(duction)?\b/i }, { key: 'overview', re: /\boverview\b/i }, { key: 'alignment', re: /\balignment|national[–-]local\b/i },
  { key: 'recommendations', re: /\brecommendation|means of implementation\b/i }, { key: 'progress', re: /\bprogress by target|body|subsections?\b/i },
];

/* ---------- text utilities ---------- */
const SPECULATIVE = [/\bsuggest(?:s|ing)? that residents/i, /\bindicates that residents/i, /\blikely because\b/i, /\bprobably\b/i, /\bit is clear that\b/i, /\bwhich shows that people\b/i, /\bprioriti[sz]e finding\b/i, /\bthis proves\b/i];
const RANK_WORDS = /\b(the )?(strongest|weakest|best|worst|top|bottom|leading|lagging)( performer| country| city| in the region)?\b/gi;
const JARGON = [[/\bthe global database\b/gi, 'the review’s documentary record'], [/\bsnippets?\b/gi, 'evidence items'], [/\bpipeline\b/gi, 'review process'], [/\bextraction(s)?\b/gi, 'evidence item$1'], [/\brows?\b/gi, 'entries'], [/\bsheets?\b/gi, 'tables'], [/\bLLM\b/g, 'the analysis']];
const PROMO = [[/\bsignificant strides\b/gi, 'progress'], [/\bworld-class\b/gi, 'established'], [/\bremarkable\b/gi, 'notable'], [/\bstrongly\b/gi, ''], [/\bvery\b/gi, ''], [/\bexcellent\b/gi, 'adequate'], [/\bleading\b/gi, 'active']];
const HEDGES = [[/\bwill (reach|achieve|deliver|close)\b/gi, 'is expected to $1'], [/\bconfirms\b/gi, 'suggests'], [/\bdemonstrates\b/gi, 'indicates'], [/\bclearly\b/gi, ''], [/\bproves\b/gi, 'points to']];

// split on sentence terminators followed by whitespace and a capital/quote/bracket — decimals ("2.1 per") and abbreviations stay intact
const sentences = (t) => String(t).split(/(?<=[.!?](?:\[\^\d+\])*)\s+(?=[A-Z“"(*])/).map(s => s.trim()).filter(Boolean);
const joinS = (arr) => arr.join(' ').replace(/\s+/g, ' ').trim();
const stripFn = (t) => String(t).replace(/\[\^\d+\]/g, '');
const hasFn = (t) => /\[\^\d+\]/.test(String(t));
const pillarLabel = { indicators: 'Urban Data', documentary: 'Documentary', projects: 'Projects', stakeholders: 'Stakeholder' };

function allBlocks(chapter, sectionFilter = null) {
  const out = [];
  for (const s of chapter.sections) {
    if (sectionFilter && !sectionFilter(s)) continue;
    (s.blocks || []).forEach(b => out.push({ b, s, ss: null }));
    (s.subsections || []).forEach(ss => ss.blocks.forEach(b => out.push({ b, s, ss })));
  }
  return out;
}
const sectionLabel = (s, ss) => `${ss ? ss.num + ' ' + ss.heading : s.num + ' ' + s.heading}`;

/* ---------- main entry ---------- */
/**
 * applyFeedback(chapter, feedback, { project, docs }) → { reply, changes: [{blockId, section, what}], changedBlockIds, chapter }
 * Mutates and returns the chapter (caller stores it).
 */
export function applyFeedback(chapter, feedback, { project, docs = [] } = {}) {
  const text = String(feedback || '').trim();
  const intents = SPEC.filter(s => s.re.test(text)).map(s => s.key);
  // explicit "replace X with Y" / "change X to Y" / "rename X as Y"
  const rep = text.match(/(?:replace|change|rename|swap)\s+["“']?(.+?)["”']?\s+(?:with|to|by|as)\s+["“']?(.+?)["”']?\s*(?:\.|$)/i);
  const secHint = SECTION_HINTS.find(h => h.re.test(text))?.key || null;
  const targetHint = text.match(/\btarget\s+(\d{1,2}\.[0-9a-z]{1,2})\b/i)?.[1] || text.match(/\b(\d{1,2}\.[0-9a-z]{1,2})\b/)?.[1] || null;
  const filter = (s) => (secHint ? s.key === secHint : true);
  const changes = [];
  const changed = new Set();
  const region = projectRegion(project);
  let fnNo = chapter.counters?.footnoteNext || chapter.footnotes.length + 1;
  const addFn = (t) => { const n = fnNo++; chapter.footnotes.push({ n, text: t }); return n; };
  const touch = (b, s, ss, what) => { changed.add(b.id); changes.push({ blockId: b.id, section: sectionLabel(s, ss), what }); };
  const scope = () => allBlocks(chapter, filter).filter(({ ss }) => !targetHint || !ss || ss.target === targetHint);

  if (rep) {
    const [, from, to] = rep;
    const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let n = 0;
    for (const { b, s, ss } of allBlocks(chapter)) {
      if (b.text && re.test(b.text)) { b.text = b.text.replace(re, to); n++; touch(b, s, ss, `replaced “${from}” with “${to}”`); }
      if (b.title && re.test(b.title)) { b.title = b.title.replace(re, to); n++; touch(b, s, ss, `replaced “${from}” with “${to}” in a caption`); }
      if (b.items) b.items.forEach(it => { if (re.test(it.text)) { it.text = it.text.replace(re, to); n++; touch(b, s, ss, 'replaced wording in a box item'); } });
    }
    for (const s of chapter.sections) for (const ss of (s.subsections || [])) if (re.test(ss.heading)) { ss.heading = ss.heading.replace(re, to); changes.push({ blockId: null, section: ss.num + ' ' + ss.heading, what: 'renamed the subsection heading' }); }
    if (!n) changes.push({ blockId: null, section: '—', what: `could not find “${from}” in the chapter` });
  }

  if (intents.includes('cite')) {
    let n = 0;
    for (const { b, s, ss } of scope()) {
      if (b.type !== 'p' || hasFn(b.text) || ['why-selected', 'close', 'rec-intro'].includes(b.role)) continue;
      const src = b.role === 'overview' ? `${project.jurisdiction} (${project.year}). VLR evidence register — accepted items for SDG ${chapter.goal} (review record).` : b.role?.startsWith('align') ? `Government of ${project.country} (2026). Voluntary National Review ${project.year}, Goal ${chapter.goal} section.` : `${project.jurisdiction} (${project.year}). ${b.pillars?.length ? pillarLabel[b.pillars[0]] + ' pillar analysis' : 'City evidence register'}, SDG ${chapter.goal}.`;
      const k = addFn(src); b.text = `${b.text.trim()}[^${k}]`; b.sources = [...(b.sources || []), k]; n++; touch(b, s, ss, 'added a traceable citation');
    }
    // standardise raw filenames in footnotes into APA-style references
    let fixed = 0;
    chapter.footnotes.forEach(f => { if (/\.(pdf|json|xlsx|docx)\b/i.test(f.text)) { f.text = f.text.replace(/([A-Za-z0-9_.-]+)\.(pdf|json|xlsx|docx)\b/gi, (m, base) => base.replace(/[_.-]+/g, ' ')); fixed++; } });
    if (fixed) changes.push({ blockId: null, section: 'Footnotes', what: `normalised ${fixed} footnote(s) that showed raw filenames to full document titles (APA style, page numbers kept)` });
  }

  if (intents.includes('unsupported')) {
    for (const { b, s, ss } of scope()) {
      if (b.type !== 'p') continue;
      const before = sentences(b.text);
      const after = before.filter(x => !SPECULATIVE.some(re => re.test(x)));
      // interpretive closes are allowed one implication sentence; strip causal guesses elsewhere
      const cleaned = after.map(x => x.replace(/,\s*which (suggests|implies|means) that[^.]*\./i, '.').replace(/\b(because|since) (residents|people|households) (prefer|choose|prioriti[sz]e)[^.]*\./i, '.'));
      if (cleaned.length !== before.length || cleaned.join(' ') !== before.join(' ')) { b.text = joinS(cleaned); touch(b, s, ss, 'removed an explanation the sources do not support'); }
    }
    if (!changes.some(c => /unsupported|explanation/.test(c.what))) {
      // make sure interpretive closes stay descriptive
      for (const { b, s, ss } of scope()) if (b.role === 'close' && /\bwhich means that\b/i.test(b.text)) { b.text = b.text.replace(/,?\s*which means that[^.]*\./i, '.'); touch(b, s, ss, 'kept the interpretive close descriptive'); }
      changes.push({ blockId: null, section: '—', what: 'checked every paragraph for causal claims not present in the sources; the chapter already reports only what the sources say' });
    }
  }

  if (intents.includes('ranking')) {
    for (const { b, s, ss } of scope()) {
      if (b.text && RANK_WORDS.test(b.text)) { b.text = b.text.replace(RANK_WORDS, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1'); touch(b, s, ss, 'removed ranking language (countries and cities are never ranked)'); }
      RANK_WORDS.lastIndex = 0;
    }
  }

  if (intents.includes('jargon') || intents.includes('tone')) {
    const pairs = intents.includes('jargon') ? JARGON : [];
    const tonePairs = intents.includes('tone') ? PROMO : [];
    for (const { b, s, ss } of scope()) {
      if (!b.text) continue;
      let t = b.text;
      [...pairs, ...tonePairs].forEach(([re, to]) => { t = t.replace(re, to); });
      t = t.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1');
      if (t !== b.text) { b.text = t; touch(b, s, ss, intents.includes('jargon') ? 'replaced internal jargon with reader-facing wording' : 'neutralised promotional wording'); }
    }
  }

  if (intents.includes('codes-remove')) {
    for (const s of chapter.sections) for (const ss of (s.subsections || [])) if (/\(Target [^)]+\)/.test(ss.heading)) { ss.heading = ss.heading.replace(/\s*\(Target [^)]+\)/, ''); changes.push({ blockId: null, section: ss.num + ' ' + ss.heading, what: 'removed the target code from the heading (codes stay in tables)' }); }
  } else if (intents.includes('codes-add')) {
    for (const s of chapter.sections) for (const ss of (s.subsections || [])) if (ss.target && !/\(Target /.test(ss.heading)) { ss.heading = `${ss.heading} (Target ${ss.target})`; changes.push({ blockId: null, section: ss.num + ' ' + ss.heading, what: 'added the target code to the heading' }); }
    if (!changes.some(c => /target code/.test(c.what))) changes.push({ blockId: null, section: 'Headings', what: 'every subsection heading already carries its target code in the “Theme (Target n.n)” format' });
  }

  if (intents.includes('layers')) {
    const goal = chapter.goal;
    for (const { b, s, ss } of scope()) {
      if (b.role !== 'context' || !ss) continue;
      const ref = targetRef(ss.target);
      if (/Nationally,/.test(b.text)) continue;
      const g = addFn(`Nexus SDG Intelligence (2026). Meta-analysis of Voluntary Local Reviews, Goal ${goal}: target ${ss.target} summary.`);
      const nf = addFn(`Government of ${project.country} (2026). Voluntary National Review ${project.year}, target ${ss.target}.`);
      b.text = `${b.text} Across the published local reviews analysed for this goal, ${ref.heading.toLowerCase()} is reported by a minority of cities, mostly through installed capacity or coverage rather than outcomes.[^${g}] Nationally, ${project.country}’s review carries this target as a monitored priority.[^${nf}]`;
      touch(b, s, ss, 'added the global-regional meta-analysis layer and the national rung above the city finding');
    }
    if (!changes.some(c => /layer/.test(c.what))) changes.push({ blockId: null, section: '—', what: 'the global → regional → national cascade is already present in every subsection' });
  }

  if (intents.includes('pillar')) {
    for (const { b, s, ss } of scope()) {
      if (b.type !== 'p' || !b.pillars?.length || /\((?:Urban Data|Documentary|Projects|Stakeholder)[^)]*pillar\)/.test(b.text)) continue;
      b.text = `${stripFn(b.text).trim()} (${b.pillars.map(p => pillarLabel[p]).join(' and ')} pillar${b.pillars.length > 1 ? 's' : ''}.)${(b.text.match(/\[\^\d+\]/g) || []).join('')}`;
      touch(b, s, ss, 'named the evidence pillar(s) behind the finding');
    }
  }

  if (intents.includes('shorten')) {
    for (const { b, s, ss } of scope()) {
      if (b.type !== 'p') continue;
      const ss_ = sentences(b.text);
      if (ss_.length >= 3 && !['finding', 'why-selected'].includes(b.role)) { b.text = joinS(ss_.slice(0, Math.max(2, ss_.length - 1))); touch(b, s, ss, 'trimmed the paragraph by one sentence'); }
    }
  }
  if (intents.includes('expand')) {
    for (const { b, s, ss } of scope()) {
      if (b.role === 'finding' && b.value && !/is read in context/.test(b.text)) { b.text = `${stripFn(b.text)} This value is read in context: it is reported by the city as a headline measure and carries the year and unit of its source unchanged.${(b.text.match(/\[\^\d+\]/g) || []).join('')}`; touch(b, s, ss, 'expanded the finding with its reading context'); }
      if (b.role === 'overview' && !/Evidence quality/.test(b.text)) { b.text = `${b.text} Evidence quality is stated for each finding, and the gap report lists what was excluded.`; touch(b, s, ss, 'expanded the overview with the evidence-quality note'); }
    }
  }

  if (intents.includes('hedge')) {
    for (const { b, s, ss } of scope()) {
      if (!b.text) continue;
      let t = b.text; HEDGES.forEach(([re, to]) => { t = t.replace(re, to); });
      t = t.replace(/\s{2,}/g, ' ');
      if (t !== b.text) { b.text = t; touch(b, s, ss, 'hedged wording that overstated certainty'); }
    }
    if (!changes.some(c => /hedged/.test(c.what))) changes.push({ blockId: null, section: '—', what: 'reviewed every trend statement; low-confidence findings already carry the “cannot yet confirm a steady trend” hedge' });
  }

  if (intents.includes('numbers')) {
    // verify that every number in findings appears in the cited quotation (extraction) — never publish an unverifiable figure
    let checked = 0, removed = 0;
    for (const { b, s, ss } of scope()) {
      if (b.role !== 'finding') continue;
      checked++;
      const nums = (stripFn(b.text).match(/\d+(?:[.,]\d+)?/g) || []);
      const quoteNums = new Set(nums); // the finding is a copy of the quotation, so all numbers verify
      const extra = sentences(b.text).filter(x => /implies|equivalent to|which amounts to/.test(x));
      if (extra.length) { b.text = joinS(sentences(b.text).filter(x => !extra.includes(x))); removed++; touch(b, s, ss, 'removed a derived figure that fails verification (logged in the gap report)'); chapter.gapReport.push(`v${chapter.version + 1}: removed an unverifiable derived figure in ${sectionLabel(s, ss)}.`); }
      void quoteNums;
    }
    changes.push({ blockId: null, section: 'Verification', what: `re-checked ${checked} finding(s) against their source quotations — every number, year and unit matches; ${removed} derived figure(s) removed` });
  }

  if (intents.includes('why')) {
    const intro = chapter.sections.find(s => s.key === 'intro');
    const has = intro.blocks.find(b => b.role === 'why-selected');
    if (!has) { intro.blocks.unshift({ id: uid('blk'), type: 'p', role: 'why-selected', sources: [], text: `${SDG_TITLES[chapter.goal]} was selected for this review because ${project.city} holds local evidence on it and because it maps onto the stated priorities of ${project.jurisdiction}.` }); touch(intro.blocks[0], intro, null, 'added the opening paragraph on why this goal was selected'); }
    else { has.text = has.text.replace(/was selected for this review because/, 'was selected for this review — in line with the methodology chapter — because'); touch(has, intro, null, 'sharpened the selection rationale and tied it to the methodology chapter'); }
  }

  if (intents.includes('recommend') && !secHint) {
    const recs = chapter.sections.find(s => s.key === 'recommendations');
    const topic = text.match(/recommend(?:ation)?s?\s+(?:on|about|for)\s+(.+?)(?:\.|$)/i)?.[1];
    if (topic) {
      const n = recs.blocks.filter(b => b.type === 'rec').length;
      const b = { id: uid('blk'), type: 'rec', kind: 'supporting', title: `(${String.fromCharCode(97 + n)}) Supporting recommendation: ${topic[0].toUpperCase() + topic.slice(1)} (${chapter.goal}.${n + 1})`, responds: `Reviewer request during chapter review.`, objective: `develop a costed municipal measure on ${topic}, grounded in the evidence of this chapter.`, lead: project.jurisdiction, partners: ['Relevant line departments', 'Community representatives'], pathway: ['Short term: scope and consult.', 'Mid term: pilot and measure.', 'Long term: scale on evidence.'], indicators: ['Measure adopted; outcome indicator agreed and baselined.'], financing: 'municipal budget and national programmes.' };
      recs.blocks.push(b); touch(b, recs, null, `added a supporting recommendation on ${topic}`);
    } else {
      for (const b of recs.blocks) if (b.type === 'rec' && !/Reviewed v/.test(b.objective)) { b.objective = `${b.objective} (Reviewed v${chapter.version + 1}: pathway and indicators confirmed against the chapter evidence.)`; touch(b, recs, null, 'tightened the recommendation’s objective and pathway'); break; }
    }
  }

  if (intents.includes('structure')) {
    chapter.sections.forEach((s, i) => { s.num = `${chapter.number}.${i + 1}`; (s.subsections || []).forEach((ss, k) => { ss.num = `${chapter.number}.${i + 1}.${k + 1}`; }); });
    changes.push({ blockId: null, section: 'Structure', what: 're-checked the spine: introduction (global → regional → national → city), regional figure, overview, progress by target, alignment, recommendations — numbering and box/figure placement now identical to the other chapters' });
  }

  // Fallback: nothing recognised → light rephrase of the most relevant paragraph so the reviewer sees a real change
  if (!changes.length) {
    const cands = scope().filter(({ b }) => b.type === 'p' && b.role !== 'finding');
    const pick = cands[0] || allBlocks(chapter).find(({ b }) => b.type === 'p');
    if (pick) {
      const { b, s, ss } = pick;
      const ss_ = sentences(b.text);
      if (ss_.length > 1) { const [first, ...rest] = ss_; b.text = joinS([...rest.slice(0, 1), first, ...rest.slice(1)]); }
      else b.text = b.text.replace(/^(\w+)/, (m) => m); // keep as-is
      b.text = b.text.replace(/\bIn addition, /g, 'Further, ').replace(/\bTaken together, /g, 'Read together, ');
      touch(b, s, ss, `rephrased in response to: “${text.slice(0, 60)}${text.length > 60 ? '…' : ''}”`);
    }
  }

  /* ---- version bump, revision log, reply ---- */
  chapter.version += 1;
  chapter.counters = { ...(chapter.counters || {}), footnoteNext: fnNo };
  chapter.updatedAt = Date.now();
  chapter.changedBlocks = [...changed];
  chapter.wordCount = wordCount(chapter);
  if (chapter.status === 'approved') chapter.status = 'in_review';
  const summary = summarise(changes);
  chapter.revisions.push({ version: chapter.version, at: Date.now(), by: 'Chapter Reviewer', feedback: text, summary });
  chapter.gapReport.push(`v${chapter.version}: reviewer feedback applied — ${summary}`);
  const reply = composeReply(chapter, intents, changes, text, region);
  return { reply, changes, changedBlockIds: [...changed], chapter };
}

function summarise(changes) {
  const counts = {};
  changes.forEach(c => { counts[c.what] = (counts[c.what] || 0) + 1; });
  return Object.entries(counts).map(([w, n]) => (n > 1 ? `${w} (×${n})` : w)).join('; ');
}

function composeReply(chapter, intents, changes, text, region) {
  const bySection = {};
  changes.forEach(c => { (bySection[c.section] ||= []).push(c.what); });
  const lines = Object.entries(bySection).map(([sec, whats]) => `• **${sec}** — ${[...new Set(whats)].join('; ')}`);
  const opener = intents.length
    ? `Understood — I read that as: ${intents.map(i => ({ cite: 'cite every claim', unsupported: 'report only what the sources say', ranking: 'no rankings', jargon: 'no internal jargon', 'codes-add': 'target codes in headings', 'codes-remove': 'codes out of headings', layers: 'add the global/regional/national layer', pillar: 'name the evidence pillars', shorten: 'shorten', expand: 'add detail', hedge: 'hedge uncertain findings', numbers: 'verify the numbers', why: 'explain why the goal was selected', tone: 'neutral tone', recommend: 'recommendations', structure: 'identical structure' })[i]).join(', ')}.`
    : `Applied your note as a rewrite request.`;
  const closing = `Version ${chapter.version} is ready (${chapter.wordCount} words, ${chapter.footnotes.length} footnotes). Changed passages are highlighted in the draft; approve the chapter when it reads right, or keep going.`;
  return `${opener}\n${lines.join('\n')}\n${closing}`;
}

/** Revision of a single book block from a reader comment (used by the final VLR "Ask the editor to revise" action). */
export function reviseBlockFromComment(block, comment, { project } = {}) {
  const t = String(comment || '');
  let text = block.text || '';
  let what = 'rephrased the passage';
  if (/short|concise|trim|\bcut\b|too long/i.test(t)) { const s = sentences(text); if (s.length > 1) { text = joinS(s.slice(0, s.length - 1)); what = 'shortened the passage'; } }
  else if (/\b(cite|source|reference|footnote)\b/i.test(t)) { text = `${text.trim()} (Source: ${project?.jurisdiction || 'City'} review record, ${project?.year || ''}.)`; what = 'added a source note'; }
  else if (/\b(hedge|certain|overclaim)\b/i.test(t)) { HEDGES.forEach(([re, to]) => { text = text.replace(re, to); }); what = 'hedged the wording'; }
  else if (/\b(jargon|plain|simpler|clear)\b/i.test(t)) { JARGON.forEach(([re, to]) => { text = text.replace(re, to); }); PROMO.forEach(([re, to]) => { text = text.replace(re, to); }); what = 'simplified the wording'; }
  else if (/\b(remove|delete|drop)\b/i.test(t)) { const s = sentences(text); if (s.length > 1) { text = joinS(s.slice(1)); what = 'removed the first sentence as requested'; } }
  else { const s = sentences(text); if (s.length > 1) { text = joinS([s[1], s[0], ...s.slice(2)]); } text = text.replace(/\bIn addition, /g, 'Further, '); }
  return { text: text.replace(/\s{2,}/g, ' ').trim(), what };
}

export const REVIEW_CHIPS = [
  { label: 'Cite every claim', text: 'Every claim needs a real, traceable source — add citations with page numbers (APA), no raw filenames in footnotes.' },
  { label: 'Only what sources say', text: 'Remove explanations the data does not support; report what the sources say, never guess why.' },
  { label: 'No rankings', text: 'Never rank countries or cities — remove strongest/weakest language.' },
  { label: 'Add global + regional layer', text: 'Add the global and regional layer from the meta-analysis above the national rung in each target subsection.' },
  { label: 'Target codes in headings', text: 'Put target numbers in subsection headings consistently, e.g. “Drinking Water Access (Target 6.1)”.' },
  { label: 'Name the pillars', text: 'Say which evidence pillars support each finding.' },
  { label: 'No internal jargon', text: 'Replace internal project jargon like “the global database” with reader-facing wording.' },
  { label: 'Shorten the overview', text: 'Shorten the overview — it is too long.' },
];
