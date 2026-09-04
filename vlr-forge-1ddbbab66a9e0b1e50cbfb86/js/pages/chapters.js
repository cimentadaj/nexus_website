/* Chapters workspace — routes #/projects/:id/chapters and #/projects/:id/chapters/:chapterId
 * Three columns: chapter list (280px) | the chapter draft as a paper sheet | Chapter Reviewer chat (380px).
 * All UI state (draft text, inline edits, scroll positions, open panels) lives in ctx.local so the ~350 ms
 * re-render while tasks run never loses typing or scroll.
 */
import { esc, icon, refreshIcons, sdgChip, statusBadge, progressHtml, bindActions, toast, openMenu, confirmDialog, relTime, download, avatarHtml, SDG_TITLES } from '../ui.js';
import { getProject, getProjectChapters, getChapter, getProjectTasks, getExtraction, projectStats, currentUser, getProjectBook } from '../store.js';
import { composeChapters, recomposeChapter, sendChapterFeedback, approveChapter, reopenChapter, editChapterBlock, assembleFinalBook } from '../actions.js';
import { openTaskDrawer } from '../modals.js';
import { avatarButton, statusBarHtml, projectStepper, stepLockReason, stepLockedHtml } from '../shell.js';
import { STEP_META } from '../seed.js';
import { REVIEW_CHIPS } from '../reviewer.js';
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
function blockHtml(b, chapter, ctx) {
  const changed = (chapter.changedBlocks || []).includes(b.id);
  const marker = changed ? `<span class="ch-changed-mark">${icon('sparkles', 'icon-xs')}changed in v${chapter.version}</span>` : '';
  const wrap = (inner, cls = '') => `<div class="ch-block ch-${esc(b.type)} ${changed ? 'is-changed' : ''} ${cls}" data-block="${esc(b.id)}" id="blk-${esc(b.id)}">${marker}${inner}</div>`;
  switch (b.type) {
    case 'p': {
      const editing = ctx.local.editing?.blockId === b.id;
      const srcIds = [...(b.extractionId ? [b.extractionId] : []), ...(b.extractionIds || [])];
      const meta = (b.pillars?.length || srcIds.length) ? `<div class="ch-p-meta">${pillarChips(b.pillars)}${srcIds.map(id => {
        const e = getExtraction(id);
        if (e) return `<a class="ch-src" href="#/review/${esc(id)}" data-tip="Source: ${esc(e.sdg)} ${esc(e.title)}">${icon('link', 'icon-xs')}</a>`;
        // evidence no longer in the review store → fall back to the provenance map (document · page)
        const pv = (chapter.provenance || []).find(p => p.blockId === b.id && p.extractionId === id) || (chapter.provenance || []).find(p => p.blockId === b.id);
        return pv ? `<span class="ch-src is-static" data-tip="Source: ${esc(pv.doc || 'document')}${pv.page != null ? ` · p. ${esc(pv.page)}` : ''}">${icon('link', 'icon-xs')}</span>` : '';
      }).join('')}</div>` : '';
      if (editing) {
        return wrap(`<div class="ch-edit">
          <textarea class="textarea ch-edit-ta" id="ch-edit-${esc(b.id)}" data-key="ch-edit" rows="6">${esc(ctx.local.editing.text)}</textarea>
          <div class="ch-edit-actions"><span class="xs muted">Editing paragraph · saves as a new version</span><span class="grow"></span><button class="btn btn-light btn-sm" data-action="edit-cancel">Cancel</button><button class="btn btn-primary btn-sm" data-action="edit-save" data-block="${esc(b.id)}">${icon('check', 'icon-sm')}Save</button></div>
        </div>`, 'is-editing');
      }
      return wrap(`<p class="ch-text" data-action="edit-block" data-block="${esc(b.id)}" data-tip="Click to edit this paragraph">${rich(b.text)}</p>${meta}`);
    }
    case 'box':
      return wrap(`<div class="ch-box-inner"><div class="ch-box-title">${icon('bookmark', 'icon-sm')}${esc(b.title)}</div><ul>${(b.items || []).map(i => `<li>${rich(i.text)}${i.fn ? `<sup class="ch-fn"><a href="#" data-action="goto-fn" data-fn="${Number(i.fn)}">${Number(i.fn)}</a></sup>` : ''}</li>`).join('')}</ul>${b.nexus ? `<div class="ch-box-nexus">${icon('git-merge', 'icon-xs')}Cross-reference: SDG ${Number(b.nexus)} — ${esc(SDG_TITLES[b.nexus] || '')}</div>` : ''}</div>`);
    case 'figure':
      return wrap(`<figure class="ch-figure"><div class="ch-figure-ph"><div class="ch-figure-ph-inner">${icon('image', 'icon-lg')}<span>Regional dashboard — image placeholder</span><span class="xs">SDG ${Number(b.goal) || ''} · inserted at layout</span></div></div><figcaption>${esc(b.caption)}</figcaption></figure>`);
    case 'table':
      return wrap(`<figure class="ch-table"><figcaption>${esc(b.title)}</figcaption><div class="ch-table-wrap"><table><thead><tr>${(b.columns || []).map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${(b.rows || []).map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${b.source ? `<div class="ch-table-src">${esc(b.source)}${b.extractionId ? ` <a href="#/review/${esc(b.extractionId)}" class="ch-src-link">${icon('link', 'icon-xs')}view evidence</a>` : ''}</div>` : ''}</figure>`);
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
        ${b.basedOn && getExtraction(b.basedOn) ? `<a class="ch-src-link" href="#/review/${esc(b.basedOn)}">${icon('link', 'icon-xs')}Based on: ${esc(getExtraction(b.basedOn).title)}</a>` : ''}
      </div>`);
    default:
      return b.text ? wrap(`<p class="ch-text">${rich(b.text)}</p>`) : '';
  }
}

function sheetHtml(chapter, ctx) {
  const panels = ctx.local.panels || (ctx.local.panels = { gap: false, prov: false });
  const notes = [...(chapter.footnotes || [])].sort((a, b) => a.n - b.n);
  const prov = chapter.provenance || [];
  return `
  <article class="ch-sheet" id="ch-sheet">
    <div class="ch-sheet-eyebrow">Voluntary Local Review · ${esc(getProject(chapter.projectId)?.name || '')}</div>
    <h1 class="ch-h1">${esc(chapter.title)}</h1>
    <div class="ch-sheet-sub">${esc(chapter.subject ? chapter.subject[0].toUpperCase() + chapter.subject.slice(1) : '')} · version ${chapter.version} · ${Number(chapter.wordCount || 0).toLocaleString('en-US')} words · ${notes.length} notes</div>
    ${(chapter.sections || []).map(s => `
      <section class="ch-section" id="sec-${esc(s.key)}">
        <h2 class="ch-h2"><span class="ch-num">${esc(s.num)}</span>${esc(s.heading)}</h2>
        ${(s.blocks || []).filter(b => b.type !== 'box').map(b => blockHtml(b, chapter, ctx)).join('')}
        ${(s.subsections || []).map(ss => `
          <div class="ch-subsection" id="sec-${esc(ss.key)}">
            <h3 class="ch-h3"><span class="ch-num">${esc(ss.num)}</span>${esc(ss.heading)}</h3>
            ${(ss.blocks || []).map(b => blockHtml(b, chapter, ctx)).join('')}
          </div>`).join('')}
        ${(s.blocks || []).filter(b => b.type === 'box').map(b => blockHtml(b, chapter, ctx)).join('')}
      </section>`).join('')}
    <section class="ch-notes" id="ch-notes">
      <h2 class="ch-h2 ch-h2-notes">Notes</h2>
      ${notes.length ? `<ol class="ch-notes-list">${notes.map(f => `<li id="fn-${f.n}" value="${f.n}"><span class="ch-note-n">${f.n}</span>${esc(f.text)}</li>`).join('')}</ol>` : '<p class="muted">No footnotes in this chapter.</p>'}
    </section>
    <div class="ch-panels">
      <div class="ch-panel ${panels.gap ? 'open' : ''}">
        <button class="ch-panel-head" data-action="toggle-panel" data-panel="gap">${icon(panels.gap ? 'chevron-down' : 'chevron-right', 'icon-sm')}<span>Gap report</span><span class="ch-panel-count">${(chapter.gapReport || []).length}</span><span class="grow"></span><span class="xs muted">What was excluded and why</span></button>
        ${panels.gap ? `<div class="ch-panel-body">${(chapter.gapReport || []).length ? `<ul class="ch-gap-list">${chapter.gapReport.map(g => `<li>${icon('alert-circle', 'icon-xs')}<span>${esc(g)}</span></li>`).join('')}</ul>` : '<p class="muted xs">Nothing was excluded.</p>'}</div>` : ''}
      </div>
      <div class="ch-panel ${panels.prov ? 'open' : ''}">
        <button class="ch-panel-head" data-action="toggle-panel" data-panel="prov">${icon(panels.prov ? 'chevron-down' : 'chevron-right', 'icon-sm')}<span>Provenance map</span><span class="ch-panel-count">${prov.length}</span><span class="grow"></span><span class="xs muted">Every finding → evidence → document · page</span></button>
        ${panels.prov ? `<div class="ch-panel-body">${prov.length ? `<div class="ch-prov-wrap"><table class="table table-compact ch-prov"><thead><tr><th>Passage</th><th>Evidence</th><th>Document</th><th>Page</th><th></th></tr></thead><tbody>${prov.map(p => { const e = getExtraction(p.extractionId); return `<tr>
            <td><button class="ch-prov-jump" data-action="goto-block" data-block="${esc(p.blockId)}">${icon('corner-down-right', 'icon-xs')}${esc(sectionLabelOf(chapter, p.blockId))}</button></td>
            <td>${e ? `<span class="badge badge-sdg">SDG ${esc(e.sdg)}</span> <span class="ch-prov-title">${esc(e.title)}</span>` : '<span class="muted">removed</span>'}</td>
            <td class="mono">${esc(p.doc || e?.source?.docName || '—')}</td>
            <td class="mono">${esc(p.page ?? e?.source?.page ?? '—')}</td>
            <td class="td-right">${e ? `<a class="btn btn-light btn-sm" href="#/review/${esc(e.id)}">${icon('external-link', 'icon-sm')}Open</a>` : ''}</td>
          </tr>`; }).join('')}</tbody></table></div>` : '<p class="muted xs">No city evidence was cited in this chapter.</p>'}</div>` : ''}
      </div>
    </div>
  </article>`;
}

/* ------------------------------------------------------------------ */
/* Left column — chapter list + composition state                       */
/* ------------------------------------------------------------------ */
function listHtml(project, chapters, active, tasks, stats) {
  const composing = tasks.filter(isComposeTask).sort((a, b) => (a.status === b.status ? a.createdAt - b.createdAt : a.status === 'running' ? -1 : 1));
  const goalsPending = composing.filter(t => t.step === 'compose' && t.goal != null && !chapters.some(c => c.goal === t.goal)).map(t => t.goal);
  const editing = composing.find(t => t.step === 'edit');
  const ok = stats.allReviewed && project.status !== 'archived';
  const tip = project.status === 'archived' ? 'Project is archived' : !stats.extractions ? 'Run the pipeline and approve the evidence first' : !stats.allReviewed ? `${stats.extractions - stats.approved} extraction(s) still await review` : '';
  const rows = chapters.map(c => `
    <a class="ch-row ${c.id === active?.id ? 'active' : ''}" href="#/projects/${esc(project.id)}/chapters/${esc(c.id)}">
      ${sdgChip(c.goal, { title: false })}
      <div class="ch-row-main">
        <div class="ch-row-top"><span class="ch-row-n">Chapter ${Number(c.number)}</span>${(c.changedBlocks || []).length ? `<span class="ch-dot" data-tip="${(c.changedBlocks || []).length} passage(s) changed in v${c.version}"></span>` : ''}${c.reviewing ? `<span class="ch-row-spin">${icon('loader-2', 'icon-xs spin')}</span>` : ''}</div>
        <div class="ch-row-title">${esc(SDG_TITLES[c.goal] || c.title)}</div>
        <div class="ch-row-meta">${chapterStatusBadge(c)}${tierBadge(c.tier)}</div>
        <div class="ch-row-sub">v${Number(c.version)} · ${Number(c.wordCount || 0).toLocaleString('en-US')} words</div>
      </div>
    </a>`).join('');
  const skeletons = goalsPending.map(g => `
    <div class="ch-row ch-row-skel">
      ${sdgChip(g, { title: false, muted: true })}
      <div class="ch-row-main">
        <div class="ch-row-top"><span class="ch-row-n">SDG ${Number(g)}</span><span class="ch-row-spin">${icon('loader-2', 'icon-xs spin')}</span></div>
        <div class="ch-row-title muted">Composing…</div>
        <div class="skeleton" style="width:70%;margin-top:6px"></div><div class="skeleton" style="width:45%;margin-top:6px"></div>
      </div>
    </div>`).join('');
  const taskList = composing.length ? `
    <div class="ch-compose">
      <div class="ch-compose-head">${icon('loader-2', 'icon-sm spin')}<span>Composition in progress</span><span class="badge badge-sky">${composing.length} active</span></div>
      ${composing.map(t => { const m = STEP_META[t.step] || {}; return `<button class="ch-task" data-action="open-task" data-task="${esc(t.id)}">
        <div class="ch-task-top"><span>${icon(m.icon || 'box', 'icon-xs')}${esc(m.label || t.label)}</span><span class="ch-task-pct">${t.status === 'running' ? `${Math.round(t.progress || 0)}%` : 'Queued'}</span></div>
        <div class="ch-task-sub mono">${esc(t.inputDoc)}</div>
        ${t.status === 'running' ? progressHtml(t.progress || 0, 'sky sm striped') : progressHtml(0, 'sm')}
      </button>`; }).join('')}
      ${editing && editing.status === 'queued' ? `<div class="xs muted ch-compose-note">The Chapter Editor consolidates numbering and cross-references once every chapter is written.</div>` : ''}
    </div>` : '';
  const empty = !chapters.length && !composing.length ? `
    <div class="ch-empty">
      ${icon('pen-line')}
      <div class="empty-title">No chapters yet</div>
      <div class="empty-sub">One Chapter Composer task per reported SDG writes a chapter along the canonical spine, then the Chapter Editor consolidates numbering and cross-references.</div>
      <span ${tip ? `data-tip="${esc(tip)}"` : ''}><button class="btn btn-primary btn-sm mt-12" data-action="write-vlr" ${ok ? '' : 'disabled'}>${icon('pen-line', 'icon-sm')}Write VLR chapters</button></span>
      <div class="ch-spine">
        <div class="ch-spine-title">The spine every chapter follows</div>
        <ol>
          <li><b>N.1 Introduction</b> — why the goal was selected → global → regional → national → city; national-initiatives box; regional figure</li>
          <li><b>N.2 Overview</b> — what local evidence exists and what it lacks</li>
          <li><b>N.3 Progress by Target</b> — one subsection per evidenced target, “Theme (Target n.n)”, pillar-tagged evidence, time-series tables</li>
          <li><b>N.4 National–Local Alignment</b></li>
          <li><b>N.5 Policy recommendations</b> and means of implementation</li>
        </ol>
      </div>
    </div>` : '';
  return `
  <aside class="ch-list card" id="ch-list">
    <div class="card-header tinted"><div class="card-title-caps">${icon('book-open')}Chapters</div><span class="xs muted">${chapters.length ? `${stats.chaptersApproved}/${chapters.length} approved` : goalsPending.length ? `${goalsPending.length} composing` : '—'}</span></div>
    <div class="ch-list-scroll" id="ch-list-scroll">
      ${rows}${skeletons}${taskList}${empty}
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
        <div><div class="ch-strip-title">${esc(chapter.title)}</div><div class="ch-strip-meta">${chapterStatusBadge(chapter)}${tierBadge(chapter.tier)}<span class="ch-strip-kv"><b>v${Number(chapter.version)}</b></span><span class="ch-strip-kv"><b>${Number(chapter.wordCount || 0).toLocaleString('en-US')}</b> words</span><span class="ch-strip-kv"><b>${(chapter.footnotes || []).length}</b> notes</span><span class="ch-strip-kv muted">updated ${esc(relTime(chapter.updatedAt))}</span></div></div>
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
  const revisions = chapter ? [...(chapter.revisions || [])].sort((a, b) => b.version - a.version) : [];
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
      : `<div class="empty"><div class="empty-sub">No messages yet.</div></div>`}
    </div>
    <div class="ch-chips">${REVIEW_CHIPS.map((c, i) => `<button class="ch-chip" data-action="chip" data-i="${i}" ${!chapter || busy ? 'disabled' : ''} data-tip="${esc(c.text)}">${esc(c.label)}</button>`).join('')}</div>
    <div class="ch-compose-box">
      <textarea class="textarea" id="ch-draft" rows="3" placeholder="${chapter ? 'Tell the reviewer what to change… (Enter to send, Shift+Enter for a new line)' : 'Select a chapter first'}" ${!chapter || busy ? 'disabled' : ''}>${esc(draft)}</textarea>
      <div class="ch-compose-actions"><span class="xs muted">${busy ? 'The reviewer is rewriting — hang on.' : 'Feedback is applied as a new version; changes are highlighted.'}</span><span class="grow"></span><button class="btn btn-primary btn-sm" data-action="send" ${!chapter || busy || !draft.trim() ? 'disabled' : ''}>${icon('send', 'icon-sm')}Send</button></div>
    </div>
    <div class="ch-history">
      <div class="ch-history-head">${icon('history', 'icon-sm')}Revision history</div>
      ${revisions.length ? `<ul class="ch-history-list">${revisions.map(r => `<li><span class="ch-ver">v${Number(r.version)}</span><div class="grow"><div class="ch-history-by">${esc(r.by || 'System')} <span class="muted">· ${esc(relTime(r.at))}</span></div><div class="ch-history-sum">${esc(r.summary || '')}</div>${r.feedback ? `<div class="ch-history-fb">“${esc(r.feedback)}”</div>` : ''}</div></li>`).join('')}</ul>` : `<div class="xs muted" style="padding:6px 0">No revisions yet.</div>`}
    </div>
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
    ctx.content.innerHTML = `<div class="ch-page">${listHtml(project, chapters, chapter, tasks, stats)}${centreHtml(project, chapter, chapters, ctx)}${chatPanelHtml(chapter, ctx)}</div>`;
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
      'toggle-panel': (el) => { const p = ctx.local.panels || (ctx.local.panels = {}); p[el.dataset.panel] = !p[el.dataset.panel]; ctx.rerender(); },
      'goto-fn': (el, ev) => {
        ev.preventDefault();
        const li = document.getElementById(`fn-${el.dataset.fn}`);
        if (li) { scrollDocTo(li); li.classList.add('is-flash'); setTimeout(() => li.classList.remove('is-flash'), 1600); }
      },
      'goto-block': (el) => {
        const b = document.getElementById(`blk-${el.dataset.block}`);
        if (b) { scrollDocTo(b); flashBlock(b); } else toast.info('Passage not found', 'It may have been rewritten in a later version.');
      },
      'chip': (el) => {
        if (!chapter || chapter.reviewing) return;
        const c = REVIEW_CHIPS[Number(el.dataset.i)];
        if (!c) return;
        sendChapterFeedback(chapter.id, c.text);
        ctx.local.draft = '';
        toast.info(`“${c.label}” sent`, 'The Chapter Reviewer is rewriting the chapter.');
      },
      'send': sendDraft,
    });

    return () => { unbindTop(); unbindContent(); offs.forEach(f => f()); };
  },
};
