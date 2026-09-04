/* Chapters workspace — routes #/projects/:id/chapters and #/projects/:id/chapters/:chapterId
 * Three columns: chapter list (280px) | the chapter draft as a paper sheet | Chapter Reviewer chat (380px).
 * All UI state (draft text, inline edits, scroll positions, open panels) lives in ctx.local so the ~350 ms
 * re-render while tasks run never loses typing or scroll.
 */
import { esc, icon, refreshIcons, sdgChip, statusBadge, progressHtml, bindActions, toast, openMenu, confirmDialog, relTime, download, avatarHtml, SDG_TITLES, SDG_COLORS } from '../ui.js';
import { getProject, getProjectChapters, getChapter, getProjectTasks, getExtraction, getProjectExtractions, projectStats, currentUser, getProjectBook } from '../store.js';
import { composeChapters, recomposeChapter, sendChapterFeedback, rewriteUnit, approveChapter, reopenChapter, editChapterBlock, assembleFinalBook } from '../actions.js';
import { openTaskDrawer } from '../modals.js';
import { avatarButton, statusBarHtml, projectStepper, stepLockReason, stepLockedHtml } from '../shell.js';
import { STEP_META, PILLARS, quotePlain } from '../seed.js';
import { navigate } from '../router.js';

const PILLAR_LABEL = { indicators: 'Urban Data', documentary: 'Documentary', projects: 'Projects', stakeholders: 'Stakeholder' };
const TIER_TIP = { few: 'Few evidence items — chapter leans on plans, projects and stakeholder voices', enough: 'Enough evidence — findings across two or more pillars', lots: 'Rich evidence — trended indicators across three or more pillars' };
const COMPOSE_STEPS = ['compose', 'edit'];
const BOOK_STEPS = ['assemble', 'render'];

/* ------------------------------------------------------------------ */
/* Text helpers                                                         */
/* ------------------------------------------------------------------ */
/** Escape, then render **bold** and [^n] footnote markers (as superscript links to the notes). */
function rich(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[\^(\d+)\]/g, (_, n) => `<sup class="ch-fn"><a href="#" data-action="goto-fn" data-fn="${n}" data-tip="Note ${n}">${n}</a></sup>`);
}
const lines = (t) => String(t || '').split('\n');

/** Assistant chat text: paragraphs, with consecutive "• " lines grouped into a list. */
function chatHtml(text) {
  const out = []; let list = [];
  const flush = () => { if (list.length) { out.push(`<ul>${list.map(l => `<li>${rich(l)}</li>`).join('')}</ul>`); list = []; } };
  for (const raw of lines(text)) {
    const l = raw.trim(); if (!l) { flush(); continue; }
    if (/^[•\-–]\s+/.test(l)) list.push(l.replace(/^[•\-–]\s+/, '')); else { flush(); out.push(`<p>${rich(l)}</p>`); }
  }
  flush();
  return out.join('');
}

/* ------------------------------------------------------------------ */
/* Chapter data helpers                                                 */
/* ------------------------------------------------------------------ */
function allBlocks(chapter) {
  const out = [];
  for (const s of chapter.sections || []) {
    (s.blocks || []).forEach(b => out.push({ b, s, ss: null }));
    (s.subsections || []).forEach(ss => (ss.blocks || []).forEach(b => out.push({ b, s, ss })));
  }
  return out;
}
const sectionLabelOf = (chapter, blockId) => { const hit = allBlocks(chapter).find(x => x.b.id === blockId); return hit ? (hit.ss ? `${hit.ss.num} ${hit.ss.heading}` : `${hit.s.num} ${hit.s.heading}`) : '—'; };
const tierBadge = (tier) => `<span class="ch-tier tier-${esc(tier || 'none')}" data-tip="${esc(TIER_TIP[tier] || 'No evidence tier')}">${esc(tier || 'none')}</span>`;
const chapterStatusBadge = (c) => c.status === 'approved' ? statusBadge('approved', { label: 'Approved' }) : `<span class="badge badge-info">In review</span>`;
const pillarChips = (pillars) => (pillars || []).map(p => `<span class="ch-pillar p-${esc(p)}">${esc(PILLAR_LABEL[p] || p)}</span>`).join('');
const isComposeTask = (t) => COMPOSE_STEPS.includes(t.step) && (t.status === 'queued' || t.status === 'running');
const isBookTask = (t) => BOOK_STEPS.includes(t.step) && (t.status === 'queued' || t.status === 'running');

/* ------------------------------------------------------------------ */
/* Block renderers (the paper sheet)                                    */
/* ------------------------------------------------------------------ */
const PILLAR_ABBR = { indicators: 'IND', documentary: 'DOC', projects: 'PRJ', stakeholders: 'STK' };
/* Hierarchical unit lookup: sections and subsections with their DIRECT paragraph blocks */
function chapterUnits(chapter) {
  const out = [];
  for (const s of chapter.sections || []) {
    for (const ss of s.subsections || []) out.push({ key: ss.key, num: ss.num, heading: ss.heading, blocks: ss.blocks || [] });
    out.push({ key: s.key, num: s.num, heading: s.heading, blocks: [...(s.blocks || []), ...(s.subsections || []).flatMap(ss => ss.blocks || [])] });
  }
  return out;
}
function findUnit(chapter, unit) {
  if (!chapter || !unit) return null;
  const units = chapterUnits(chapter);
  if (unit.type === 'sec') {
    const u = units.find(x => x.key === unit.id);
    return u ? { blocks: u.blocks.filter(b => b.type === 'p'), allBlocks: u.blocks, label: `section ${u.num} ${u.heading}`, short: `Section ${u.num}`, heading: u.heading } : null;
  }
  for (const u of units) {
    const b = (u.blocks || []).find(x => x.id === unit.id && x.type === 'p');
    if (b) return { blocks: [b], allBlocks: [b], label: `a paragraph in ${u.num} ${u.heading}`, short: `Paragraph · ${u.num}`, heading: u.heading };
  }
  return null;
}
function lineageIds(chapter, blocks) {
  const ids = new Set();
  for (const b of blocks) {
    if (b.extractionId) ids.add(b.extractionId);
    if (b.basedOn) ids.add(b.basedOn);
    (b.extractionIds || []).forEach(id => ids.add(id));
    (chapter.provenance || []).filter(p => p.blockId === b.id && p.extractionId).forEach(p => ids.add(p.extractionId));
  }
  return [...ids].filter(id => getExtraction(id));
}

function blockHtml(b, chapter, ctx) {
  const changed = (chapter.changedBlocks || []).includes(b.id);
  const marker = '';
  const wrap = (inner, cls = '') => `<div class="ch-block ch-${esc(b.type)} ${changed ? 'is-changed' : ''} ${cls}" data-block="${esc(b.id)}" id="blk-${esc(b.id)}">${marker}${inner}</div>`;
  switch (b.type) {
    case 'p': {
      const editing = ctx.local.editing?.blockId === b.id;
      if (editing) {
        return wrap(`<div class="ch-edit">
          <textarea class="textarea ch-edit-ta" id="ch-edit-${esc(b.id)}" data-key="ch-edit" rows="6">${esc(ctx.local.editing.text)}</textarea>
          <div class="ch-edit-actions"><span class="xs muted">Editing paragraph · saves as a new version</span><span class="grow"></span><button class="btn btn-light btn-sm" data-action="edit-cancel">Cancel</button><button class="btn btn-primary btn-sm" data-action="edit-save" data-block="${esc(b.id)}">${icon('check', 'icon-sm')}Save</button></div>
        </div>`, 'is-editing');
      }
      const sel = ctx.local.unit?.type === 'block' && ctx.local.unit.id === b.id;
      return wrap(`<p class="ch-text" data-action="sel-unit" data-block="${esc(b.id)}" data-tip="Click to see the evidence this paragraph was written from">${rich(b.text)}</p>`, sel ? 'is-sel' : '');
    }
    case 'box':
      return wrap(`<div class="ch-box-inner"><div class="ch-box-title">${icon('bookmark', 'icon-sm')}${esc(b.title)}</div><ul>${(b.items || []).map(i => `<li>${rich(i.text)}${i.fn ? `<sup class="ch-fn"><a href="#" data-action="goto-fn" data-fn="${Number(i.fn)}">${Number(i.fn)}</a></sup>` : ''}</li>`).join('')}</ul></div>`);
    case 'figure':
      return wrap(`<figure class="ch-figure"><div class="ch-figure-ph"><div class="ch-figure-ph-inner">${icon('image', 'icon-lg')}<span>Regional dashboard — image placeholder</span><span class="xs">SDG ${Number(b.goal) || ''} · inserted at layout</span></div></div><figcaption>${esc(b.caption)}</figcaption></figure>`);
    case 'table':
      return wrap(`<figure class="ch-table"><figcaption>${esc(b.title)}</figcaption><div class="ch-table-wrap"><table><thead><tr>${(b.columns || []).map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${(b.rows || []).map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${b.source ? `<div class="ch-table-src">${esc(b.source)}</div>` : ''}</figure>`);
    case 'rec':
      return wrap(`<div class="ch-rec kind-${esc(b.kind)}">
        <div class="ch-rec-head"><span class="ch-rec-kind">${b.kind === 'priority' ? 'Priority' : 'Supporting'}</span><h4>${esc(b.title)}</h4></div>
        <dl class="ch-rec-grid">
          <dt>Responds to</dt><dd>${esc(b.responds)}</dd>
          <dt>Policy objective</dt><dd>${esc(b.objective)}</dd>
          <dt>Responsible institution</dt><dd>${esc(b.lead)}</dd>
          <dt>Supporting partners</dt><dd>${(b.partners || []).length ? `<ul>${b.partners.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '—'}</dd>
          <dt>Implementation pathway</dt><dd>${(b.pathway || []).length ? `<ol>${b.pathway.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : '—'}</dd>
          <dt>Indicators and targets</dt><dd>${(b.indicators || []).length ? `<ul>${b.indicators.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '—'}</dd>
          <dt>Financing route</dt><dd>${esc(b.financing)}</dd>
        </dl>
      </div>`);
    default:
      return b.text ? wrap(`<p class="ch-text">${rich(b.text)}</p>`) : '';
  }
}

function sheetHtml(chapter, ctx) {
  const notes = [...(chapter.footnotes || [])].sort((a, b) => a.n - b.n);
  return `
  <article class="ch-sheet" id="ch-sheet">
    <div class="ch-sheet-eyebrow">Voluntary Local Review · ${esc(getProject(chapter.projectId)?.name || '')}</div>
    <h1 class="ch-h1">${esc(chapter.title)}</h1>
    <div class="ch-sheet-sub">${esc(chapter.subject ? chapter.subject[0].toUpperCase() + chapter.subject.slice(1) : '')} · ${Number(chapter.wordCount || 0).toLocaleString('en-US')} words</div>
    ${(chapter.sections || []).map(s => `
      <section class="ch-section" id="sec-${esc(s.key)}">
        <h2 class="ch-h2 ch-h-sel ${ctx.local.unit?.type === 'sec' && ctx.local.unit.id === s.key ? 'is-sel' : ''}" data-action="sel-sec" data-sec="${esc(s.key)}" data-tip="Click to see the evidence this section was written from"><span class="ch-num">${esc(s.num)}</span>${esc(s.heading)}</h2>
        ${(s.blocks || []).filter(b => b.type !== 'box').map(b => blockHtml(b, chapter, ctx)).join('')}
        ${(s.subsections || []).map(ss => `
          <div class="ch-subsection" id="sec-${esc(ss.key)}">
            <h3 class="ch-h3 ch-h-sel ${ctx.local.unit?.type === 'sec' && ctx.local.unit.id === ss.key ? 'is-sel' : ''}" data-action="sel-sec" data-sec="${esc(ss.key)}" data-tip="Click to see the evidence this subsection was written from"><span class="ch-num">${esc(ss.num)}</span>${esc(ss.heading)}</h3>
            ${(ss.blocks || []).map(b => blockHtml(b, chapter, ctx)).join('')}
          </div>`).join('')}
        ${(s.blocks || []).filter(b => b.type === 'box').map(b => blockHtml(b, chapter, ctx)).join('')}
      </section>`).join('')}
    <section class="ch-notes" id="ch-notes">
      <h2 class="ch-h2 ch-h2-notes">Notes</h2>
      ${notes.length ? `<ol class="ch-notes-list">${notes.map(f => `<li id="fn-${f.n}" value="${f.n}"><span class="ch-note-n">${f.n}</span>${esc(f.text)}</li>`).join('')}</ol>` : '<p class="muted">No footnotes in this chapter.</p>'}
    </section>
  </article>`;
}

/* ------------------------------------------------------------------ */
/* Left column — chapter list + composition state                       */
/* ------------------------------------------------------------------ */
function listHtml(project, chapters, active, tasks, stats, ctx) {
  const composing = tasks.filter(isComposeTask).sort((a, b) => (a.status === b.status ? a.createdAt - b.createdAt : a.status === 'running' ? -1 : 1));
  const goalsPending = composing.filter(t => t.step === 'compose' && t.goal != null && !chapters.some(c => c.goal === t.goal)).map(t => t.goal);
  const editing = composing.find(t => t.step === 'edit');
  const ok = stats.allReviewed && project.status !== 'archived';
  const tip = project.status === 'archived' ? 'Project is archived' : !stats.extractions ? 'Run the pipeline and approve the evidence first' : !stats.allReviewed ? `${stats.extractions - stats.approved} extraction(s) still await review` : '';
  const goals = [...new Set([...(project.sdgs || []), ...chapters.map(c => c.goal), ...goalsPending])].sort((a, b) => a - b);
  const writeBtn = (g, c) => `<span data-tip="${c ? 'Rewrite this chapter from the approved evidence' : 'Write this chapter'}"><button class="btn-icon ch-row-write" data-action="write-goal" data-goal="${Number(g)}" ${c ? `data-chapter="${esc(c.id)}"` : ''}>${icon('pen-line', 'icon-sm')}</button></span>`;
  const rows = goals.map(g => {
    const c = chapters.find(x => x.goal === g);
    if (c) return `
    <a class="ch-row ${c.id === active?.id ? 'active' : ''}" href="#/projects/${esc(project.id)}/chapters/${esc(c.id)}">
      ${sdgChip(c.goal, { title: false })}
      <div class="ch-row-main">
        <div class="ch-row-top"><span class="ch-row-n">Chapter ${Number(c.number)}</span>${(c.changedBlocks || []).length ? `<span class="ch-dot" data-tip="${(c.changedBlocks || []).length} passage(s) changed in v${c.version}"></span>` : ''}${c.reviewing ? `<span class="ch-row-spin">${icon('loader-2', 'icon-xs spin')}</span>` : ''}</div>
        <div class="ch-row-title">${esc(SDG_TITLES[c.goal] || c.title)}</div>
        <div class="ch-row-meta">${chapterStatusBadge(c)}</div>
        <div class="ch-row-sub">${Number(c.wordCount || 0).toLocaleString('en-US')} words</div>
      </div>
      ${writeBtn(g, c)}
    </a>`;
    if (goalsPending.includes(g)) return `
    <div class="ch-row ch-row-todo">
      ${sdgChip(g, { title: false })}
      <div class="ch-row-main">
        <div class="ch-row-top"><span class="ch-row-n">SDG ${Number(g)}</span></div>
        <div class="ch-row-title">${esc(SDG_TITLES[g] || `Goal ${g}`)}</div>
      </div>
      <span class="ch-row-spin">${icon('loader-2', 'icon-sm spin')}</span>
    </div>`;
    return `
    <div class="ch-row ch-row-todo">
      ${sdgChip(g, { title: false })}
      <div class="ch-row-main">
        <div class="ch-row-top"><span class="ch-row-n">SDG ${Number(g)}</span></div>
        <div class="ch-row-title">${esc(SDG_TITLES[g] || `Goal ${g}`)}</div>
        <div class="ch-row-sub muted">Not written yet</div>
      </div>
      ${writeBtn(g, null)}
    </div>`;
  }).join('');
  const skeletons = '';
  const empty = !chapters.length && !composing.length ? `
    <div class="ch-list-foot"><span ${tip ? `data-tip="${esc(tip)}"` : ''}><button class="btn btn-primary btn-sm" data-action="write-vlr" ${ok ? '' : 'disabled'}>${icon('pen-line', 'icon-sm')}Write all chapters</button></span></div>` : '';
  return `
  <aside class="ch-list card" id="ch-list">
    <div class="card-header tinted"><div class="card-title-caps">${icon('book-open')}Chapters</div><span class="xs muted">${chapters.length ? `${stats.chaptersApproved}/${chapters.length} approved` : goalsPending.length ? `${goalsPending.length} composing` : '—'}</span></div>
    <div class="ch-list-scroll" id="ch-list-scroll">
      ${rows}
      ${skeletons}${empty}
      ${chapters.length && !composing.length && project.status !== 'archived' ? `<div class="ch-list-foot"><button class="btn btn-ghost btn-sm" data-action="recompose-all" data-tip="Queue a fresh composition of every chapter">${icon('rotate-ccw', 'icon-sm')}Recompose all</button></div>` : ''}
    </div>
  </aside>`;
}

/* ------------------------------------------------------------------ */
/* Centre — header strip + sheet                                        */
/* ------------------------------------------------------------------ */
function centreHtml(project, chapter, chapters, ctx) {
  if (!chapter) {
    const composing = getProjectTasks(project.id).filter(isComposeTask);
    return `<section class="ch-centre" id="ch-centre"><div class="ch-centre-empty card"><div class="empty">${icon(composing.length ? 'loader-2' : 'file-text', composing.length ? 'spin' : '')}<div class="empty-title">${composing.length ? 'Chapters are being written' : 'No chapter selected'}</div><div class="empty-sub">${composing.length ? `${composing.length} composition task${composing.length === 1 ? '' : 's'} in the queue — the draft appears here the moment the Chapter Composer finishes.` : 'Write the VLR chapters from the approved evidence, then review them here with the Chapter Reviewer.'}</div></div></div></section>`;
  }
  const idx = chapters.findIndex(c => c.id === chapter.id);
  const nextUnapproved = chapters.find((c, i) => i > idx && c.status !== 'approved') || chapters.find(c => c.id !== chapter.id && c.status !== 'approved') || chapters[idx + 1] || null;
  const approved = chapter.status === 'approved';
  const busy = !!chapter.reviewing;
  return `
  <section class="ch-centre" id="ch-centre">
    <div class="ch-strip card">
      <div class="ch-strip-left">
        ${sdgChip(chapter.goal)}
        <div><div class="ch-strip-title">${esc(chapter.title)}</div><div class="ch-strip-meta">${chapterStatusBadge(chapter)}<span class="ch-strip-kv"><b>${Number(chapter.wordCount || 0).toLocaleString('en-US')}</b> words</span></div></div>
      </div>
      <div class="ch-strip-actions">
        ${approved
          ? `<span class="badge badge-success badge-lg">${icon('check-circle-2', 'icon-sm')}Approved ✓</span><button class="btn btn-light" data-action="reopen" data-tip="Back to in-review">${icon('undo-2', 'icon-sm')}Reopen</button>${nextUnapproved ? `<a class="btn btn-primary" href="#/projects/${esc(project.id)}/chapters/${esc(nextUnapproved.id)}">Next chapter${icon('arrow-right', 'icon-sm')}</a>` : ''}`
          : `<span ${busy ? 'data-tip="Wait for the reviewer to finish rewriting"' : ''}><button class="btn btn-primary" data-action="approve" ${busy ? 'disabled' : ''}>${icon('check-circle-2', 'icon-sm')}Approve chapter</button></span>`}
        <button class="btn btn-light" data-action="recompose" ${busy ? 'disabled' : ''}>${icon('rotate-ccw', 'icon-sm')}Recompose</button>
        <button class="btn btn-light" data-action="download-menu">${icon('download', 'icon-sm')}Download${icon('chevron-down', 'icon-sm')}</button>
      </div>
    </div>
    <div class="ch-doc" id="ch-doc">
      ${busy ? `<div class="ch-rewriting">${icon('loader-2', 'icon-sm spin')}Chapter Reviewer is rewriting this chapter… changed passages will be highlighted.</div>` : ''}
      ${sheetHtml(chapter, ctx)}
    </div>
  </section>`;
}

/* ------------------------------------------------------------------ */
/* Right — Chapter Reviewer chat + revision history                     */
/* ------------------------------------------------------------------ */
function chatPanelHtml(chapter, ctx) {
  const me = currentUser();
  const msgs = chapter ? (chapter.chat || []) : [];
  const busy = !!chapter?.reviewing;
  const draft = ctx.local.draft || '';
  return `
  <aside class="ch-chat card" id="ch-chat">
    <div class="card-header tinted ch-chat-head">
      <div class="card-title-caps">${icon('bot')}Chapter Reviewer</div>
      <span class="ch-live"><span class="ch-live-dot ${busy ? 'busy' : ''}"></span>${busy ? 'Rewriting' : 'Gemini 2.5 Pro'}</span>
    </div>
    <div class="ch-msgs" id="ch-msgs">
      ${!chapter ? `<div class="empty"><div class="empty-sub">Select a chapter to review it with the Chapter Reviewer.</div></div>` : msgs.length ? msgs.map(m => m.role === 'user'
        ? `<div class="ch-msg user"><div class="ch-msg-avatar">${avatarHtml({ name: m.by || me?.name || 'You' })}</div><div class="ch-msg-body"><div class="ch-msg-meta"><b>${esc(m.by || me?.name || 'You')}</b><span>${esc(relTime(m.at))}</span></div><div class="ch-msg-text">${esc(m.text)}</div></div></div>`
        : `<div class="ch-msg assistant ${m.pending ? 'pending' : ''}"><div class="ch-msg-avatar ai">${icon('bot', 'icon-sm')}</div><div class="ch-msg-body"><div class="ch-msg-meta"><b>Chapter Reviewer</b>${m.version ? `<span class="ch-ver">v${Number(m.version)}</span>` : ''}<span>${esc(relTime(m.at))}</span></div>
            ${m.pending ? `<div class="ch-typing"><span></span><span></span><span></span><em>Rewriting chapter…</em></div>` : `<div class="ch-msg-text">${chatHtml(m.text)}</div>${(m.changedBlockIds || []).length ? `<button class="ch-msg-jump" data-action="goto-block" data-block="${esc(m.changedBlockIds[0])}">${icon('locate', 'icon-xs')}Show ${m.changedBlockIds.length} changed passage${m.changedBlockIds.length === 1 ? '' : 's'}</button>` : ''}`}
          </div></div>`).join('')
      : ''}
    </div>
    ${(() => {
      if (!chapter) return '';
      const u = findUnit(chapter, ctx.local.unit);
      const ctxSel = ctx.local.ctxSel || {};
      const all = getProjectExtractions(chapter.projectId).filter(e => e.status === 'approved');
      const selected = Object.keys(ctxSel).filter(k => ctxSel[k]).map(id => all.find(e => e.id === id) || getExtraction(id)).filter(Boolean);
      const resPillar = ctx.local.resPillar || 'indicators';
      const resGoal = ctx.local.resGoal || null;
      const pool = all.filter(e => !ctxSel[e.id]);
      const pillarPool = pool.filter(e => e.pillar === resPillar);
      const goalList = [...new Set(pillarPool.map(e => e.goal))].sort((a, b) => a - b);
      const avail = pillarPool.filter(e => !resGoal || e.goal === resGoal);
      const mini = (e, on) => `<button class="ch-ctx-mini ${on ? 'on' : ''}" data-action="ctx-toggle" data-id="${esc(e.id)}"><span class="mono">${esc(e.sdg)}</span>${icon(on ? 'x' : 'plus', 'icon-xs')}</button>`;
      const miniSeries = (g, on) => `<button class="ch-ctx-mini ${on ? 'on' : ''}" data-action="ctx-toggle" data-ids="${esc(g.map(x => x.id).join(','))}"><span class="mono">${esc(g[0].sdg)}</span>${g.length > 1 ? `<span class="ch-yrs">×${g.length}</span>` : ''}${icon(on ? 'x' : 'plus', 'icon-xs')}</button>`;
      const groupInd = (list) => { const m = new Map(); for (const e of list.filter(x => x.pillar === 'indicators')) { const k = e.sdg + '|' + e.title; if (!m.has(k)) m.set(k, []); m.get(k).push(e); } return [...m.values()].map(g => [...g].sort((a, b) => (a.year || 0) - (b.year || 0))); };
      return `
    <div class="ch-unit">
      ${u ? `
      <div class="ch-unit-head">
        <span class="ch-unit-tag">${icon('text-select', 'icon-xs')}${esc(u.short)} — ${esc(u.heading)}</span>
        <span class="grow"></span>
        <button class="btn-icon" data-action="unit-clear" data-tip="Clear selection" aria-label="Clear selection">${icon('x', 'icon-sm')}</button>
      </div>
      <div class="ch-ctx-bar">
        <span class="ch-unit-lbl">Context · ${selected.length} resource${selected.length === 1 ? '' : 's'}</span>
        <span class="grow"></span>
        <button class="btn btn-light btn-xs ${ctx.local.resOpen ? 'is-active' : ''}" data-action="res-toggle">${icon(ctx.local.resOpen ? 'minus' : 'plus', 'icon-xs')}Add</button>
      </div>
      ${selected.length ? `<div class="ch-ctx-cols">${PILLARS.map(p => { const list = selected.filter(e => e.pillar === p.key); return `
        <div class="ch-ctx-col col-${esc(p.key)}">
          <div class="ch-ctx-col-h"><span class="ch-pillar p-${esc(p.key)}">${PILLAR_ABBR[p.key]}</span></div>
          ${p.key === 'indicators' ? groupInd(list).map(g => miniSeries(g, true)).join('') : list.map(e => mini(e, true)).join('')}
        </div>`; }).join('')}</div>` : `<div class="ch-ctx-pills"><span class="xs muted">Empty — add resources to rewrite from.</span></div>`}
      ${ctx.local.resOpen ? `
      <div class="ch-res-pillars">${PILLARS.map(p => `<button class="ch-res-pillar ${p.key === resPillar ? 'on' : ''}" data-action="res-pillar" data-pillar="${esc(p.key)}">${icon(p.icon, 'icon-xs')}${esc(p.label)}<span class="ch-res-n">${pool.filter(e => e.pillar === p.key).length}</span></button>`).join('')}</div>
      ${goalList.length > 1 ? `<div class="ch-res-goals">${goalList.map(g => `<button class="ch-res-goal ${resGoal === g ? 'on' : ''}" style="background:${resGoal && resGoal !== g ? '#cbd5e1' : SDG_COLORS[g]}" data-action="res-goal" data-goal="${g}" data-tip="SDG ${g}: ${esc(SDG_TITLES[g])}">${g}</button>`).join('')}</div>` : ''}
      <div class="ch-ctx-avail">${resPillar === 'indicators'
        ? (groupInd(avail).length ? groupInd(avail).map(g => `<button class="ch-ctx-mini" data-action="ctx-toggle" data-ids="${esc(g.map(x => x.id).join(','))}"><span class="ch-pillar p-indicators">${PILLAR_ABBR.indicators}</span><span class="mono">${esc(g[0].sdg)}</span><span class="ch-res-t">${esc(g[0].title)}</span>${g.length > 1 ? `<span class="ch-yrs">${g.length} yrs</span>` : ''}${icon('plus', 'icon-xs')}</button>`).join('') : `<span class="xs muted">Everything here is already in context.</span>`)
        : avail.length ? avail.map(e => `<button class="ch-ctx-mini" data-action="ctx-toggle" data-id="${esc(e.id)}"><span class="ch-pillar p-${esc(e.pillar)}">${PILLAR_ABBR[e.pillar] || '·'}</span><span class="mono">${esc(e.sdg)}</span><span class="ch-res-t">${esc(e.title)}</span>${icon('plus', 'icon-xs')}</button>`).join('') : `<span class="xs muted">Everything here is already in context.</span>`}</div>` : ''}`
      : ''}
    </div>
    <div class="ch-compose-box">
      <textarea class="textarea" id="ch-draft" rows="2" placeholder="${u ? 'Optional instruction — e.g. lead with the 2023 figure, mention the flood plan…' : chapter ? 'Tell the reviewer what to change… (Enter to send)' : 'Select a chapter first'}" ${!chapter || busy ? 'disabled' : ''}>${esc(draft)}</textarea>
      <div class="ch-compose-actions"><span class="xs muted">${busy ? 'The reviewer is rewriting — hang on.' : u ? 'The unit is rewritten from exactly the selected resources.' : 'Feedback is applied as a new version; changes are highlighted.'}</span><span class="grow"></span><button class="btn btn-primary btn-sm" data-action="send" ${!chapter || busy || (u ? !selected.length : !draft.trim()) ? 'disabled' : ''}>${icon(u ? 'refresh-cw' : 'send', 'icon-sm')}${u ? `Rewrite ${ctx.local.unit.type === 'sec' ? 'section' : 'paragraph'}` : 'Send'}</button></div>
    </div>`;
    })()}
  </aside>`;
}

/* ------------------------------------------------------------------ */
/* Chapter exports (Markdown + printable HTML)                          */
/* ------------------------------------------------------------------ */
function chapterMarkdown(chapter) {
  const L = [`# ${chapter.title}`, '', `_Version ${chapter.version} · ${chapter.wordCount} words_`, ''];
  const blk = (b) => {
    switch (b.type) {
      case 'p': L.push(b.text, ''); break;
      case 'box': L.push(`> **${b.title}**`, ...(b.items || []).map(i => `> - ${i.text}${i.fn ? `[^${i.fn}]` : ''}`), ''); break;
      case 'figure': L.push('[Image placeholder]', '', `*${b.caption}*`, ''); break;
      case 'table': L.push(`**${b.title}**`, '', `| ${b.columns.join(' | ')} |`, `| ${b.columns.map(() => '---').join(' | ')} |`, ...b.rows.map(r => `| ${r.join(' | ')} |`), '', b.source ? `_${b.source}_` : '', ''); break;
      case 'rec': L.push(`#### ${b.title}`, '', `**Responds to:** ${b.responds}`, '', `**Policy objective:** ${b.objective}`, '', `**Responsible institution:** ${b.lead}`, '', `**Supporting partners:** ${(b.partners || []).join('; ')}`, '', '**Implementation pathway:**', ...(b.pathway || []).map(x => `- ${x}`), '', '**Indicators and targets:**', ...(b.indicators || []).map(x => `- ${x}`), '', `**Financing route:** ${b.financing}`, ''); break;
      default: break;
    }
  };
  for (const s of chapter.sections || []) { L.push(`## ${s.num} ${s.heading}`, ''); (s.blocks || []).forEach(blk); for (const ss of s.subsections || []) { L.push(`### ${ss.num} ${ss.heading}`, ''); (ss.blocks || []).forEach(blk); } }
  L.push('', '## Notes', '', ...[...(chapter.footnotes || [])].sort((a, b) => a.n - b.n).map(f => `[^${f.n}]: ${f.text}`), '');
  if (chapter.gapReport?.length) L.push('', '## Gap report', '', ...chapter.gapReport.map(g => `- ${g}`), '');
  return L.join('\n');
}
function chapterPrintHtml(chapter, ctx) {
  const body = sheetHtml(chapter, { local: { panels: { gap: true, prov: false }, editing: null } })
    .replace(/<button[^>]*data-action="toggle-panel"[^>]*>[\s\S]*?<\/button>/g, (m) => m.replace(/<button/, '<div').replace(/<\/button>$/, '</div>'))
    .replace(/ data-action="[^"]*"/g, '').replace(/ data-tip="[^"]*"/g, '');
  const p = getProject(chapter.projectId);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(chapter.title)}</title>
  <style>body{font-family:Georgia,'Times New Roman',serif;color:#111;max-width:820px;margin:48px auto;padding:0 28px;line-height:1.6;font-size:15px}.ch-sheet-eyebrow{font-family:Inter,Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#1d6fb8;font-size:11px;font-weight:700}.ch-h1{font-family:Inter,Arial,sans-serif;color:#0f2f5c;font-size:28px;margin:10px 0 4px}.ch-sheet-sub{font-family:Inter,Arial,sans-serif;color:#64748b;font-size:12px;margin-bottom:32px}.ch-h2{font-family:Inter,Arial,sans-serif;color:#0f2f5c;font-size:19px;margin:34px 0 10px}.ch-h3{font-family:Inter,Arial,sans-serif;color:#1d6fb8;font-size:15.5px;margin:22px 0 8px}.ch-num{margin-right:10px;color:#94a3b8;font-weight:600}.ch-changed-mark,.ch-p-meta,.ch-src,.ch-panel-count,.ch-panels .xs{display:none}sup.ch-fn a{color:#1d6fb8;text-decoration:none;font-size:10px}.ch-box .ch-box-inner{border:1px solid #cbd9ea;background:#eef5fd;padding:12px 16px;margin:16px 0;font-family:Inter,Arial,sans-serif;font-size:13.5px}.ch-box-title{font-weight:700;color:#0f2f5c;margin-bottom:6px}.ch-box .icon{display:none}.ch-figure-ph{height:180px;background:repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9 10px,#e2e8f0 10px,#e2e8f0 20px);display:grid;place-items:center;color:#64748b;font-family:Inter,Arial,sans-serif;font-size:12px;border:1px solid #cbd5e1}.ch-figure-ph .icon{display:none}figure{margin:18px 0}figcaption{font-family:Inter,Arial,sans-serif;font-size:12.5px;font-weight:700;color:#0f2f5c;margin:6px 0}table{border-collapse:collapse;width:100%;font-family:Inter,Arial,sans-serif;font-size:12.5px}th,td{border:1px solid #cbd5e1;padding:6px 9px;text-align:left}th{background:#e9f1fb}.ch-table-src{font-size:11px;color:#64748b;margin-top:4px}.ch-src-link{display:none}.ch-rec{border-left:3px solid #0f2f5c;padding:4px 16px;margin:16px 0;background:#f8fafc;font-family:Inter,Arial,sans-serif;font-size:13.5px}.ch-rec-kind{display:inline-block;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#1d6fb8;font-weight:700}.ch-rec h4{margin:4px 0 8px;color:#0f2f5c}.ch-rec-grid{display:grid;grid-template-columns:170px 1fr;gap:6px 14px}.ch-rec-grid dt{font-weight:700;color:#334155}.ch-rec-grid dd{margin:0}.ch-notes{margin-top:36px;border-top:1px solid #cbd5e1;padding-top:10px;font-size:11.5px;color:#334155}.ch-notes-list{padding-left:22px}.ch-note-n{display:none}.ch-panel-head{font-family:Inter,Arial,sans-serif;font-weight:700;color:#0f2f5c;margin-top:24px}.ch-panel-head .icon{display:none}.ch-gap-list{font-family:Inter,Arial,sans-serif;font-size:12.5px;color:#334155}.ch-gap-list .icon{display:none}.ch-text{margin:0 0 12px}@media print{body{margin:0;max-width:none}}</style></head>
  <body><div style="font-family:Inter,Arial,sans-serif;font-size:11px;color:#94a3b8;margin-bottom:24px">${esc(p?.name || '')} · Chapter draft v${chapter.version} · exported ${new Date().toLocaleString()} by VLR Forge</div>${body}
  <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),500));</script></body></html>`;
}

/* ------------------------------------------------------------------ */
/* Scroll helpers                                                       */
/* ------------------------------------------------------------------ */
function flashBlock(el) {
  if (!el) return;
  el.classList.add('is-flash');
  setTimeout(() => el.classList.remove('is-flash'), 1600);
}
function scrollDocTo(el) {
  const doc = document.getElementById('ch-doc');
  if (!doc || !el) return;
  const top = el.getBoundingClientRect().top - doc.getBoundingClientRect().top + doc.scrollTop - 24;
  doc.scrollTop = Math.max(0, top); // direct assignment: smooth scrollTo stalls when the tab is not painting
}

/* ------------------------------------------------------------------ */
/* Page module                                                          */
/* ------------------------------------------------------------------ */
export default {
  title: (ctx) => { const p = getProject(ctx.params.id); return p ? `${p.name} · Chapters` : 'Chapters'; },
  render(ctx) {
    const project = getProject(ctx.params.id);
    if (!project) {
      ctx.topbar.innerHTML = `<div class="breadcrumb"><span class="crumb-current">Not found</span></div><span class="grow"></span>${avatarButton()}`;
      ctx.content.innerHTML = `<div class="card"><div class="empty">${icon('folder-x')}<div class="empty-title">Project not found</div><div class="empty-sub">The project "${esc(ctx.params.id)}" does not exist or was deleted.</div><a class="btn btn-primary btn-sm mt-12" href="#/projects">Back to projects</a></div></div>`;
      ctx.footer.innerHTML = '';
      return;
    }
    const stats = projectStats(project);
    const lockReason = stepLockReason(project, 'chapters');
    if (lockReason) {
      ctx.topbar.innerHTML = `<div class="breadcrumb"><a href="#/projects/${esc(project.id)}">${esc(project.city)} ${esc(project.year)}</a>${icon('chevron-right', 'icon-sm')}<span class="crumb-current">Chapters</span></div><span class="grow"></span>${avatarButton()}`;
      ctx.content.innerHTML = stepLockedHtml(project, 'chapters', lockReason);
      ctx.footer.innerHTML = '';
      refreshIcons(ctx.content); refreshIcons(ctx.topbar);
      return;
    }
    const chapters = getProjectChapters(project.id);
    const tasks = getProjectTasks(project.id);
    const book = getProjectBook(project.id);

    /* ---- resolve the active chapter (route param → same goal after a recompose → first unapproved → first) ---- */
    let chapter = ctx.params.chapterId ? getChapter(ctx.params.chapterId) : null;
    if (chapter && chapter.projectId !== project.id) chapter = null;
    if (!chapter && chapters.length) {
      // stale/missing id (e.g. after a recompose) → same goal, else first unapproved, else first; render it now and fix the URL
      const byGoal = ctx.local.goal != null ? chapters.find(c => c.goal === ctx.local.goal) : null;
      chapter = byGoal || chapters.find(c => c.status !== 'approved') || chapters[0];
      navigate(`#/projects/${project.id}/chapters/${chapter.id}`, { replace: true });
    }
    if (chapter) ctx.local.goal = chapter.goal;

    /* ---- top bar ---- */
    const allApproved = chapters.length > 0 && chapters.every(c => c.status === 'approved');
    const bookBusy = tasks.some(isBookTask);
    const composing = tasks.some(isComposeTask);
    let assembleBtn;
    if (book) assembleBtn = `<a class="btn btn-primary" href="#/projects/${esc(project.id)}/vlr">${icon(book.status === 'final' ? 'book-open-check' : 'book-open', 'icon-sm')}${book.status === 'final' ? 'Open final VLR' : 'Review final VLR'}</a>`;
    else if (bookBusy) assembleBtn = `<a class="btn btn-primary" href="#/projects/${esc(project.id)}/vlr">${icon('loader-2', 'icon-sm spin')}Assembling…</a>`;
    else {
      const tip = !chapters.length ? 'Write the chapters first' : composing ? 'Wait for composition to finish' : !allApproved ? `${chapters.length - stats.chaptersApproved} chapter(s) still in review` : '';
      assembleBtn = `<span ${tip ? `data-tip="${esc(tip)}"` : ''}><button class="btn btn-primary" data-action="assemble" ${tip ? 'disabled' : ''}>${icon('book-open-check', 'icon-sm')}Assemble final VLR</button></span>`;
    }
    ctx.topbar.innerHTML = `
      <div class="breadcrumb"><a href="#/projects/${esc(project.id)}">${esc(project.name)}</a>${icon('chevron-right', 'icon-sm')}<span class="crumb-current">Chapters</span></div>
      <span class="grow"></span>
      ${projectStepper(project, 'chapters', { compact: true })}
      <span class="badge badge-pill ${allApproved ? 'badge-success' : 'badge-neutral'} ch-progress-pill">${icon(allApproved ? 'check-circle-2' : 'pen-line', 'icon-xs')}${stats.chaptersApproved}/${chapters.length} chapters approved</span>
      ${assembleBtn}
      ${avatarButton()}`;

    /* ---- content ---- */
    ctx.content.innerHTML = `<div class="ch-page">${listHtml(project, chapters, chapter, tasks, stats, ctx)}${centreHtml(project, chapter, chapters, ctx)}${chatPanelHtml(chapter, ctx)}</div>`;
    ctx.footer.innerHTML = statusBarHtml(project);

    /* ---- restore scroll positions + auto-scroll behaviours ---- */
    const sc = ctx.local.scroll || (ctx.local.scroll = {});
    const listEl = document.getElementById('ch-list-scroll');
    const docEl = document.getElementById('ch-doc');
    const msgsEl = document.getElementById('ch-msgs');
    if (listEl && sc.list != null) listEl.scrollTop = sc.list;
    if (docEl && sc.doc != null && ctx.local.docKey === chapter?.id) docEl.scrollTop = sc.doc;
    if (docEl && ctx.local.docKey !== chapter?.id) { ctx.local.docKey = chapter?.id || null; sc.doc = 0; }
    const chatLen = chapter?.chat?.length || 0;
    if (msgsEl) {
      if (ctx.local.chatKey !== chapter?.id || ctx.local.chatLen !== chatLen || chapter?.reviewing) msgsEl.scrollTop = msgsEl.scrollHeight;
      else if (sc.chat != null) msgsEl.scrollTop = sc.chat;
      ctx.local.chatKey = chapter?.id || null; ctx.local.chatLen = chatLen;
    }
    // first render of a chapter: remember its version; when a reply arrives (version bump, not reviewing) → jump to the first changed block
    if (chapter) {
      if (ctx.local.seenKey !== chapter.id) { ctx.local.seenKey = chapter.id; ctx.local.seenVersion = chapter.version; }
      else if (!chapter.reviewing && chapter.version > ctx.local.seenVersion) {
        ctx.local.seenVersion = chapter.version;
        const first = (chapter.changedBlocks || [])[0];
        const el = first ? document.getElementById(`blk-${first}`) : null;
        if (el) { setTimeout(() => { scrollDocTo(el); flashBlock(el); }, 60); }
      }
    }
    // leaving edit mode if the block vanished (recompose)
    if (ctx.local.editing && chapter && !allBlocks(chapter).some(x => x.b.id === ctx.local.editing.blockId)) ctx.local.editing = null;

    const onScroll = (key, el) => { const h = () => { sc[key] = el.scrollTop; }; el.addEventListener('scroll', h, { passive: true }); return () => el.removeEventListener('scroll', h); };
    const offs = [];
    if (listEl) offs.push(onScroll('list', listEl));
    if (docEl) offs.push(onScroll('doc', docEl));
    if (msgsEl) offs.push(onScroll('chat', msgsEl));

    /* ---- inputs (draft + inline edit) keep their text in ctx.local ---- */
    const draftEl = document.getElementById('ch-draft');
    const sendDraft = () => {
      if (!chapter || chapter.reviewing) return;
      const text = (ctx.local.draft || '').trim();
      const u = findUnit(chapter, ctx.local.unit);
      if (u) {
        const ids = Object.keys(ctx.local.ctxSel || {}).filter(k => ctx.local.ctxSel[k]);
        if (!ids.length) { toast.warning('No context selected', 'Pick at least one resource to rewrite from.'); return; }
        rewriteUnit(chapter.id, { blockIds: u.blocks.map(b => b.id), extractionIds: ids, instruction: text, unitLabel: u.label });
        ctx.local.draft = '';
        toast.info('Rewrite queued', `The reviewer is rewriting ${u.label} from ${ids.length} resource${ids.length === 1 ? '' : 's'}.`);
        ctx.rerender();
        return;
      }
      if (!text) return;
      sendChapterFeedback(chapter.id, text);
      ctx.local.draft = '';
      toast.info('Feedback sent', 'The Chapter Reviewer is rewriting the chapter.');
    };
    if (draftEl) {
      draftEl.addEventListener('input', (e) => {
        const was = !!(ctx.local.draft || '').trim();
        ctx.local.draft = e.target.value;
        const now = !!ctx.local.draft.trim();
        const btn = ctx.content.querySelector('[data-action="send"]');
        if (btn && was !== now) btn.disabled = !now;
      });
      draftEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDraft(); } });
    }
    /* hovering a resource pill shows the full evidence inline — value, quote, source — no page change */
    const hideCard = () => document.getElementById('ch-hovercard')?.remove();
    const showCard = (pillEl) => {
      hideCard();
      if (pillEl.dataset.ids) {
        const items = pillEl.dataset.ids.split(',').map(getExtraction).filter(Boolean).sort((a, b) => (a.year || 0) - (b.year || 0));
        if (!items.length) return;
        const f = items[0];
        const u = (e) => /%/.test(e.unit || '') ? '%' : e.unit ? ` ${e.unit}` : '';
        const card = document.createElement('div');
        card.id = 'ch-hovercard';
        card.innerHTML = `
          <div class="hv-top"><span class="ch-pillar p-indicators">Urban data · indicator series</span><span class="badge badge-sdg">SDG ${esc(f.sdg)}</span></div>
          <div class="hv-title">${esc(f.title)}</div>
          ${f.indicator ? `<div class="hv-sum">${esc(f.indicator)}</div>` : ''}
          <div class="hv-series">${items.map(e => `<div class="hv-yr"><b>${esc(e.year || '—')}</b><span class="mono">${esc(e.value)}${esc(u(e))}</span><span class="hv-yr-src">p. ${esc(e.source?.page ?? '—')}</span></div>`).join('')}</div>
          <div class="hv-src">${esc(f.source?.docName || 'Manual entry')}</div>`;
        document.body.appendChild(card);
        const r = pillEl.getBoundingClientRect();
        const w = card.offsetWidth, h = card.offsetHeight;
        let x = r.left - w - 10;
        if (x < 8) x = Math.min(window.innerWidth - w - 8, r.right + 10);
        card.style.left = `${x}px`;
        card.style.top = `${Math.max(8, Math.min(r.top + r.height / 2 - h / 2, window.innerHeight - h - 8))}px`;
        return;
      }
      const e = getExtraction(pillEl.dataset.id);
      if (!e) return;
      const PA = { indicators: 'Urban data · indicator', documentary: 'Documentary evidence', projects: 'Project', stakeholders: 'Stakeholder voice' };
      const fact = e.pillar === 'indicators' ? `<b>${esc(e.value)}</b>${/%/.test(e.unit || '') ? '%' : e.unit ? ` ${esc(e.unit)}` : ''}${e.year ? ` · ${esc(e.year)}` : ''}`
        : e.pillar === 'documentary' ? `${esc(e.categoryLabel || e.category || '')}`
        : e.pillar === 'projects' ? `${esc(e.projectStatus || '')}${e.period ? ` · ${esc(e.period)}` : ''}`
        : `${esc(e.group || '')}${e.category ? ` · ${esc(e.category)}` : ''}`;
      const card = document.createElement('div');
      card.id = 'ch-hovercard';
      card.innerHTML = `
        <div class="hv-top"><span class="ch-pillar p-${esc(e.pillar)}">${esc(PA[e.pillar] || e.pillar)}</span><span class="badge badge-sdg">SDG ${esc(e.sdg)}</span></div>
        <div class="hv-title">${esc(e.title)}</div>
        ${fact ? `<div class="hv-fact">${fact}</div>` : ''}
        ${e.summary && e.pillar !== 'indicators' ? `<div class="hv-sum">${esc(e.summary)}</div>` : ''}
        ${e.source?.quote ? `<div class="hv-quote">${esc(quotePlain(e.source.quote))}</div>` : ''}
        <div class="hv-src">${esc(e.source?.docName || 'Manual entry')}${e.source?.page != null ? ` · p. ${esc(e.source.page)} ¶${esc(e.source.paragraph || 1)}` : ''}</div>`;
      document.body.appendChild(card);
      const r = pillEl.getBoundingClientRect();
      const w = card.offsetWidth, h = card.offsetHeight;
      let x = r.left - w - 10;
      if (x < 8) x = Math.min(window.innerWidth - w - 8, r.right + 10);
      let y = Math.max(8, Math.min(r.top + r.height / 2 - h / 2, window.innerHeight - h - 8));
      card.style.left = `${x}px`; card.style.top = `${y}px`;
    };
    ctx.content.addEventListener('mouseover', (e) => { const p = e.target.closest('.ch-ctx-mini'); if (p) showCard(p); });
    ctx.content.addEventListener('mouseout', (e) => { const p = e.target.closest('.ch-ctx-mini'); if (p && !p.contains(e.relatedTarget)) hideCard(); });
    ctx.content.addEventListener('click', (e) => { if (e.target.closest('.ch-ctx-mini')) hideCard(); });
    const editTa = ctx.local.editing ? document.getElementById(`ch-edit-${ctx.local.editing.blockId}`) : null;
    if (editTa) {
      editTa.addEventListener('input', (e) => { ctx.local.editing.text = e.target.value; });
      editTa.addEventListener('keydown', (e) => { if (e.key === 'Escape') { ctx.local.editing = null; ctx.rerender(); } });
      if (ctx.local.editFocus) { ctx.local.editFocus = false; setTimeout(() => { editTa.focus(); editTa.setSelectionRange(editTa.value.length, editTa.value.length); }, 0); }
    }

    /* ---- actions ---- */
    const pid = project.id;
    const unbindTop = bindActions(ctx.topbar, {
      'assemble': () => {
        if (!chapters.length || !chapters.every(c => c.status === 'approved')) { toast.warning('Not ready', 'Approve every chapter before assembling the final VLR.'); return; }
        if (getProjectTasks(pid).some(isBookTask)) { toast.info('Already assembling', 'Book Assembly is running.'); return; }
        const t = assembleFinalBook(pid);
        if (t) { toast.success('Final VLR assembly started', `${chapters.length} chapter${chapters.length === 1 ? '' : 's'} · Book Assembly → DOCX Rendering`); navigate(`#/projects/${pid}/vlr`); }
        else toast.warning('Nothing to assemble', 'No chapters found.');
      },
    });
    const unbindContent = bindActions(ctx.content, {
      'write-goal': (el, ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const g = Number(el.dataset.goal);
        if (el.dataset.chapter) {
          const t = recomposeChapter(el.dataset.chapter);
          if (t) toast.info('Recomposition queued', `Chapter for SDG ${g} is being rewritten.`);
          return;
        }
        const ts = composeChapters(project.id, { goals: [g] });
        if (!ts.length) { toast.warning('Nothing to compose', `No approved evidence for SDG ${g} yet.`); return; }
        toast.success('Composition started', `Writing the SDG ${g} chapter from the approved evidence.`);
      },
      'write-vlr': () => {
        if (project.status === 'archived') { toast.warning('Project is archived', 'Restore it before composing chapters.'); return; }
        const st = projectStats(project);
        if (!st.allReviewed) { toast.warning('Evidence still under review', `${st.extractions - st.approved} extraction(s) await approval.`); return; }
        const ts = composeChapters(pid);
        if (!ts.length) { toast.warning('Nothing to compose', 'Approve evidence first.'); return; }
        toast.success('VLR composition started', `${ts.length - 1} chapter${ts.length - 1 === 1 ? '' : 's'} queued`);
      },
      'recompose-all': async () => {
        if (await confirmDialog({ title: 'Recompose every chapter?', msg: `All ${chapters.length} chapters will be rewritten from the approved evidence. Reviewer conversations and manual edits are replaced by fresh drafts.`, confirmText: 'Recompose all', icon: 'rotate-ccw' })) {
          const ts = composeChapters(pid);
          toast.success('Recomposition queued', `${Math.max(0, ts.length - 1)} chapter task${ts.length - 1 === 1 ? '' : 's'} added to the queue`);
        }
      },
      'open-task': (el) => openTaskDrawer(el.dataset.task),
      'approve': () => {
        if (!chapter) return;
        if (chapter.reviewing) { toast.info('Please wait', 'The reviewer is still rewriting.'); return; }
        approveChapter(chapter.id);
        const rest = getProjectChapters(pid).filter(c => c.status !== 'approved');
        toast.success('Chapter approved', rest.length ? `${rest.length} chapter${rest.length === 1 ? '' : 's'} left to review` : 'All chapters approved — you can assemble the final VLR.');
        const next = getProjectChapters(pid).find((c, i, arr) => i > arr.findIndex(x => x.id === chapter.id) && c.status !== 'approved') || rest[0];
        if (next) navigate(`#/projects/${pid}/chapters/${next.id}`);
      },
      'reopen': () => { if (!chapter) return; reopenChapter(chapter.id); toast.info('Chapter reopened', `${chapter.title} is back in review.`); },
      'recompose': async () => {
        if (!chapter) return;
        if (await confirmDialog({ title: 'Recompose this chapter?', msg: `<strong>${esc(chapter.title)}</strong> will be rewritten from the approved evidence by the Chapter Composer. The current draft (v${chapter.version}), its reviewer conversation and manual edits will be replaced.`, confirmText: 'Recompose', icon: 'rotate-ccw' })) {
          const t = recomposeChapter(chapter.id);
          if (t) toast.success('Recomposition queued', `${chapter.title} · ${STEP_META.compose.engine}`);
        }
      },
      'download-menu': (el) => {
        if (!chapter) return;
        const base = `${project.city}_${project.year}_Chapter${chapter.number}_SDG${chapter.goal}_v${chapter.version}`.replace(/\s+/g, '_');
        openMenu(el, [
          { header: 'Download chapter' },
          { label: 'Markdown (.md)', icon: 'file-text', sub: 'With footnotes and gap report', onClick: () => { download(`${base}.md`, chapterMarkdown(chapter), 'text/markdown'); toast.success('Download started', `${base}.md`); } },
          { label: 'Printable HTML / PDF', icon: 'printer', sub: 'Opens in a new tab with the print dialog', onClick: () => {
            const html = chapterPrintHtml(chapter, ctx);
            const w = window.open('', '_blank');
            if (w) { w.document.open(); w.document.write(html); w.document.close(); toast.info('Chapter opened in a new tab', 'Use the print dialog to save it as PDF.'); }
            else { download(`${base}.html`, html, 'text/html'); toast.success('Download started', `${base}.html`); }
          } },
        ], { align: 'right', minWidth: '260px' });
      },
      'edit-block': (el, ev) => {
        if (ev.target.closest('a')) return; // footnote / source links inside the paragraph
        if (!chapter) return;
        if (chapter.reviewing) { toast.info('Please wait', 'The reviewer is rewriting this chapter.'); return; }
        const hit = allBlocks(chapter).find(x => x.b.id === el.dataset.block);
        if (!hit) return;
        ctx.local.editing = { blockId: hit.b.id, text: hit.b.text };
        ctx.local.editFocus = true;
        ctx.rerender();
      },
      'edit-cancel': () => { ctx.local.editing = null; ctx.rerender(); },
      'edit-save': (el) => {
        if (!chapter || !ctx.local.editing) return;
        const text = String(ctx.local.editing.text || '').trim();
        const hit = allBlocks(chapter).find(x => x.b.id === el.dataset.block);
        if (!text) { toast.warning('Paragraph is empty', 'Write something or cancel the edit.'); return; }
        if (!hit || hit.b.text === text) { ctx.local.editing = null; ctx.rerender(); toast.info('No changes', 'The paragraph is unchanged.'); return; }
        editChapterBlock(chapter.id, hit.b.id, text);
        ctx.local.editing = null;
        ctx.local.seenVersion = chapter.version + 1; // do not auto-scroll for our own edit
        toast.success('Paragraph saved', `${chapter.title} → v${chapter.version + 1}${chapter.status === 'approved' ? ' · chapter back in review' : ''}`);
      },
      'goto-fn': (el, ev) => {
        ev.preventDefault();
        const li = document.getElementById(`fn-${el.dataset.fn}`);
        if (li) { scrollDocTo(li); li.classList.add('is-flash'); setTimeout(() => li.classList.remove('is-flash'), 1600); }
      },
      'goto-block': (el) => {
        const b = document.getElementById(`blk-${el.dataset.block}`);
        if (b) { scrollDocTo(b); flashBlock(b); } else toast.info('Passage not found', 'It may have been rewritten in a later version.');
      },
      'sel-unit': (el, ev) => {
        if (ev.target.closest('a, sup, button')) return;
        const unit = { type: 'block', id: el.dataset.block };
        if (ctx.local.unit?.type === 'block' && ctx.local.unit.id === unit.id) { ctx.local.unit = null; ctx.local.ctxSel = null; ctx.rerender(); return; }
        ctx.local.unit = unit;
        ctx.local.ctxSel = Object.fromEntries(getProjectExtractions(project.id).filter(e => e.status === 'approved' && (e.goal === chapter.goal || (e.goals || []).includes(chapter.goal))).map(e => [e.id, true]));
        ctx.local.resQ = '';
        ctx.rerender();
      },
      'sel-sec': (el, ev) => {
        if (ev.target.closest('a, sup, button')) return;
        const unit = { type: 'sec', id: el.dataset.sec };
        if (ctx.local.unit?.type === 'sec' && ctx.local.unit.id === unit.id) { ctx.local.unit = null; ctx.local.ctxSel = null; ctx.rerender(); return; }
        ctx.local.unit = unit;
        ctx.local.ctxSel = Object.fromEntries(getProjectExtractions(project.id).filter(e => e.status === 'approved' && (e.goal === chapter.goal || (e.goals || []).includes(chapter.goal))).map(e => [e.id, true]));
        ctx.local.resQ = '';
        ctx.rerender();
      },
      'unit-clear': () => { ctx.local.unit = null; ctx.local.ctxSel = null; ctx.local.resOpen = false; ctx.rerender(); },
      'res-toggle': () => { ctx.local.resOpen = !ctx.local.resOpen; ctx.rerender(); },
      'res-pillar': (el) => { ctx.local.resPillar = el.dataset.pillar; ctx.local.resGoal = null; ctx.rerender(); },
      'res-goal': (el) => { const g = Number(el.dataset.goal); ctx.local.resGoal = ctx.local.resGoal === g ? null : g; ctx.rerender(); },
      'ctx-toggle': (el, ev) => {
        ev.stopPropagation();
        // a selected chip only leaves the context via its ✕ — clicking the body does nothing
        if (el.classList.contains('on') && !ev.target.closest('svg, i')) return;
        const ids = el.dataset.ids ? el.dataset.ids.split(',') : [el.dataset.id];
        const on = ids.some(id => (ctx.local.ctxSel || {})[id]);
        ids.forEach(id => { (ctx.local.ctxSel ||= {})[id] = !on; });
        ctx.rerender();
      },
      'send': sendDraft,
    });

    return () => { unbindTop(); unbindContent(); offs.forEach(f => f()); document.getElementById('ch-hovercard')?.remove(); };
  },
};
