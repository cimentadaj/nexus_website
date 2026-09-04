/* Final VLR — route #/projects/:id/vlr
 * The assembled book (front matter · chapters · consolidated recommendations · provenance annex) rendered as
 * continuous paper sheets, with highlight-and-comment on any passage, a comments panel, VLR Editor revisions,
 * finalize / reopen and real DOCX / PDF / Markdown exports. All UI state lives in ctx.local (re-renders are frequent).
 */
import { esc, icon, initials, relTime, fmtDateTime, sdgChips, progressHtml, bindActions, toast, confirmDialog, openMenu, download, refreshIcons, clamp } from '../ui.js';
import { getProject, getProjectBook, getProjectChapters, getProjectTasks, projectStats, currentUser } from '../store.js';
import { assembleFinalBook, addBookComment, replyBookComment, resolveBookComment, deleteBookComment, reviseFromComment, finalizeBook, reopenBook } from '../actions.js';
import { bookOutline, bookExport } from '../export.js';
import { avatarButton, statusBarHtml, projectStepper, stepLockReason, stepLockedHtml } from '../shell.js';
import { STEP_META } from '../seed.js';
import { navigate } from '../router.js';

const PILLAR_LABEL = { indicators: 'Urban Data', documentary: 'Documentary', projects: 'Projects', stakeholders: 'Stakeholder' };
const PART_ICON = { foreword: 'quote', 'executive-summary': 'file-text', introduction: 'book-open', profile: 'map-pin', recommendations: 'list-checks', annex: 'shield-check' };
const TOPBAR_OFFSET = 62 + 18;
const DEFAULT_REVISE_TEXT = 'Please revise this passage for clarity and precision, keeping every figure and citation unchanged.';

/* =========================================================================
 * Rich text: **bold**, [^n] footnote markers and comment marks over plain-text offsets
 * ======================================================================= */
function parseRich(text) {
  const runs = []; const fns = []; let pos = 0;
  for (const p of String(text ?? '').split(/(\*\*[^*]+\*\*|\[\^\d+\])/g)) {
    if (!p) continue;
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) { const t = p.slice(2, -2); runs.push({ t, b: true, s: pos }); pos += t.length; }
    else if (/^\[\^\d+\]$/.test(p)) fns.push({ pos, n: p.replace(/\D/g, '') });
    else { runs.push({ t: p, b: false, s: pos }); pos += p.length; }
  }
  return { runs, fns, plain: runs.map(r => r.t).join('') };
}

const supHtml = (n) => `<sup class="vlr-fn"><a data-action="goto-fn" data-fn="${esc(n)}" href="#" title="Note ${esc(n)}">${esc(n)}</a></sup>`;

/** marks: [{ id, quote, cls }] — the first occurrence of each quote inside the plain text is wrapped in <mark>. */
function richHtml(text, marks = []) {
  const { runs, fns, plain } = parseRich(text);
  const ranges = [];
  for (const m of marks) {
    const q = String(m.quote || '').trim();
    if (!q) continue;
    let i = plain.indexOf(q);
    if (i < 0) i = plain.toLowerCase().indexOf(q.toLowerCase());
    let len = q.length;
    if (i < 0) { const head = q.split(/\s+/).slice(0, 4).join(' '); if (head.length >= 12) { i = plain.indexOf(head); len = head.length; } }
    if (i < 0) continue;
    if (ranges.some(g => i < g.e && i + len > g.s)) continue; // never overlap an earlier mark
    ranges.push({ s: i, e: i + len, id: m.id, cls: m.cls });
  }
  let html = ''; let fi = 0;
  const fnAt = (p) => { let s = ''; while (fi < fns.length && fns[fi].pos <= p) { s += supHtml(fns[fi].n); fi++; } return s; };
  for (const r of runs) {
    const end = r.s + r.t.length;
    const cuts = new Set([r.s, end]);
    ranges.forEach(g => { if (g.s > r.s && g.s < end) cuts.add(g.s); if (g.e > r.s && g.e < end) cuts.add(g.e); });
    fns.forEach(f => { if (f.pos > r.s && f.pos < end) cuts.add(f.pos); });
    const pts = [...cuts].sort((a, b) => a - b);
    let seg = '';
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      seg += fnAt(a);
      const g = ranges.find(x => x.s <= a && x.e >= b);
      const t = esc(plain.slice(a, b));
      seg += g ? (g.id ? `<mark class="hl-comment ${g.cls}" data-action="focus-comment" data-comment="${esc(g.id)}" title="Open comment">${t}</mark>` : `<mark class="hl-comment ${g.cls}">${t}</mark>`) : t;
    }
    html += r.b ? `<b>${seg}</b>` : seg;
  }
  html += fnAt(Infinity);
  return html;
}

/* =========================================================================
 * Outline → sheets (pages) with section / chapter tracking
 * ======================================================================= */
function buildSheets(book) {
  const out = bookOutline(book);
  const sheets = [[]];
  let sectionKey = 'cover', chapterId = null;
  for (const it of out) {
    if (it.kind === 'pagebreak') { if (sheets[sheets.length - 1].length) sheets.push([]); continue; }
    if (it.kind === 'cover') { sectionKey = 'cover'; chapterId = null; }
    else if (it.kind === 'h1') { chapterId = it.chapterId || null; sectionKey = chapterId ? 'chapter' : it.key; }
    else if (it.kind === 'h2' || it.kind === 'h3') { sectionKey = chapterId && it.key.startsWith(chapterId + ':') ? it.key.slice(chapterId.length + 1) : it.key; }
    sheets[sheets.length - 1].push({ ...it, _section: sectionKey, _chapter: chapterId });
  }
  return sheets.filter(s => s.length);
}

function tocItems(book) {
  const items = [{ key: 'cover', label: 'Cover', level: 0, icon: 'book' }];
  let cur = null;
  for (const it of bookOutline(book)) {
    if (it.kind === 'h1') { cur = { key: it.key, label: it.text, level: 0, icon: it.chapterId ? null : (PART_ICON[it.key] || 'file-text'), chapterId: it.chapterId || null, children: [] }; items.push(cur); }
    else if (it.kind === 'h2' && cur) cur.children.push({ key: it.key, label: it.text, level: 1 });
  }
  return items;
}

/* =========================================================================
 * Block renderers
 * ======================================================================= */
function pBlockHtml(it, { commentsByBlock, sel, project }) {
  const marks = (commentsByBlock[it.id] || []).map(c => ({ id: c.id, quote: c.quote, cls: c.status === 'resolved' ? 'resolved' : 'open' }));
  const selected = sel && sel.blockId === it.id;
  if (selected) marks.push({ id: '', quote: sel.quote, cls: 'pending' });
  const cls = ['vlr-p', it.revised ? 'is-revised' : '', selected ? 'is-selected' : '', it.role ? `role-${it.role}` : ''].filter(Boolean).join(' ');
  const pillars = (it.pillars || []).map(p => `<span class="vlr-chip pillar-${esc(p)}">${esc(PILLAR_LABEL[p] || p)}</span>`).join('');
  const src = it.extractionId ? `<a class="vlr-chip vlr-chip-link" href="#/review/${esc(it.extractionId)}" title="Open the source extraction">${icon('link', 'icon-xs')}source</a>` : '';
  const revised = it.revised ? `<span class="vlr-chip revised">${icon('pen-line', 'icon-xs')}revised by editor</span>` : '';
  const chap = it.chapterId && !it._chapter ? `<a class="vlr-chip vlr-chip-link" href="#/projects/${esc(project.id)}/chapters/${esc(it.chapterId)}" title="Open the chapter">${icon('book-open', 'icon-xs')}chapter</a>` : '';
  const meta = pillars || src || revised || chap ? `<div class="vlr-p-meta">${pillars}${src}${chap}${revised}</div>` : '';
  const nOpen = (commentsByBlock[it.id] || []).filter(c => c.status === 'open').length;
  const gutter = nOpen ? `<button class="vlr-gutter" data-action="focus-block-comments" data-block="${esc(it.id)}" title="${nOpen} open comment${nOpen === 1 ? '' : 's'}">${icon('message-square', 'icon-xs')}${nOpen}</button>` : '';
  return `<div class="${cls}" data-block="${esc(it.id)}" data-section="${esc(it._section)}" ${it._chapter ? `data-chapter="${esc(it._chapter)}"` : ''}>
    ${gutter}
    <p>${richHtml(it.text, marks)}</p>
    ${meta}
    ${selected ? selectionUiHtml(sel) : ''}
  </div>`;
}

function selectionUiHtml(sel) {
  if (sel.mode === 'comment' || sel.mode === 'revise') {
    const revise = sel.mode === 'revise';
    return `<div class="vlr-cform" data-vlr-keep>
      <div class="vlr-cform-quote">${icon(revise ? 'sparkles' : 'message-square-plus', 'icon-sm')}<span>“${esc(sel.quote.length > 140 ? sel.quote.slice(0, 140) + '…' : sel.quote)}”</span></div>
      <textarea class="textarea vlr-cform-text" id="vlr-cmt-text" data-action="draft" rows="3" placeholder="${revise ? 'What should the VLR Editor change? (optional — leave empty for a general revision)' : 'Write your comment…'}">${esc(sel.draft || '')}</textarea>
      <div class="vlr-cform-actions">
        <span class="xs muted">${revise ? 'The editor rewrites the passage and replies in the comments panel.' : 'Ctrl + Enter to submit'}</span>
        <span class="grow"></span>
        <button class="btn btn-light btn-sm" data-action="cancel-sel">Cancel</button>
        ${revise ? `<button class="btn btn-primary btn-sm" data-action="send-revise">${icon('sparkles', 'icon-sm')}Send to VLR Editor</button>`
                 : `<button class="btn btn-primary btn-sm" data-action="add-comment">${icon('message-square-plus', 'icon-sm')}Add comment</button>`}
      </div>
    </div>`;
  }
  return `<div class="vlr-seltip" data-vlr-keep style="top:${Math.round(sel.top)}px;left:${Math.round(sel.left)}px">
    <button data-action="sel-comment">${icon('message-square-plus', 'icon-sm')}Comment</button>
    <span class="vlr-seltip-sep"></span>
    <button data-action="sel-revise">${icon('sparkles', 'icon-sm')}Ask editor to revise</button>
  </div>`;
}

function blockHtml(it, data) {
  switch (it.kind) {
    case 'cover': return '';
    case 'h1': return `<h1 class="vlr-h1" data-anchor="${esc(it.key)}">${esc(it.text)}</h1>`;
    case 'h2': return `<h2 class="vlr-h2" data-anchor="${esc(it.key)}">${esc(it.text)}</h2>`;
    case 'h3': return `<h3 class="vlr-h3" data-anchor="${esc(it.key)}">${esc(it.text)}</h3>`;
    case 'p': return pBlockHtml(it, data);
    case 'signature': return `<div class="vlr-sig">${esc(it.text).replace(/\n/g, '<br>')}</div>`;
    case 'box': return `<aside class="vlr-box ${it.nexus ? 'nexus' : ''}"><div class="vlr-box-title">${icon(it.nexus ? 'git-merge' : 'landmark', 'icon-sm')}${esc(it.title)}</div><ul>${(it.items || []).map(i => `<li>${esc(i.text)}${i.fn ? supHtml(i.fn) : ''}</li>`).join('')}</ul></aside>`;
    case 'figure': return `<figure class="vlr-figure"><div class="vlr-figure-ph"><div class="vlr-figure-bars">${[62, 78, 45, 90, 70, 55, 84].map((h, i) => `<span style="height:${h}%;animation-delay:${i * 60}ms"></span>`).join('')}</div><div class="vlr-figure-label">${icon('image', 'icon-sm')}Regional dashboard — figure placeholder${it.goal ? ` · SDG ${esc(it.goal)}` : ''}</div></div><figcaption>${esc(it.caption)}</figcaption></figure>`;
    case 'table': return `<figure class="vlr-table"><figcaption>${esc(it.title)}</figcaption><div class="vlr-table-wrap"><table><thead><tr>${(it.columns || []).map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${(it.rows || []).map(r => `<tr>${r.map((c, i) => `<td class="${i > 0 && /^[\d.,%\s–-]+$/.test(String(c)) ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${it.source ? `<div class="vlr-table-src">${esc(it.source)}</div>` : ''}${it.extractionId ? `<a class="vlr-chip vlr-chip-link vlr-table-link" href="#/review/${esc(it.extractionId)}">${icon('link', 'icon-xs')}source extraction</a>` : ''}</figure>`;
    case 'kv': return `<table class="vlr-kv"><tbody>${(it.rows || []).map(r => `<tr><th>${esc(r[0])}</th><td>${esc(r[1])}</td></tr>`).join('')}</tbody></table>`;
    case 'list': return `<ul class="vlr-list">${(it.items || []).map(i => `<li>${esc(i.text)}</li>`).join('')}</ul>`;
    case 'rec': return `<article class="vlr-rec ${esc(it.kind || 'supporting')} rec-${esc(it.kind === 'priority' ? 'priority' : 'supporting')}">
        <div class="vlr-rec-head">${icon(it.kind === 'priority' ? 'star' : 'circle-dot', 'icon-sm')}<h4>${esc(it.title)}</h4></div>
        <dl class="vlr-rec-grid">
          <dt>Responds to</dt><dd>${esc(it.responds)}</dd>
          <dt>Policy objective</dt><dd>${esc(it.objective)}</dd>
          <dt>Responsible institution</dt><dd>${esc(it.lead)}</dd>
          <dt>Supporting partners</dt><dd>${esc((it.partners || []).join('; '))}</dd>
          <dt>Implementation pathway</dt><dd><ul>${(it.pathway || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></dd>
          <dt>Indicators and targets</dt><dd><ul>${(it.indicators || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></dd>
          <dt>Financing route</dt><dd>${esc(it.financing)}</dd>
        </dl>
        ${it.basedOn ? `<a class="vlr-chip vlr-chip-link" href="#/review/${esc(it.basedOn)}">${icon('link', 'icon-xs')}based on evidence</a>` : ''}
      </article>`;
    case 'footnotes': return (it.items || []).length ? `<section class="vlr-notes"><h4>Notes</h4><ol>${it.items.map(f => `<li value="${esc(f.n)}" data-fnote="${esc(f.n)}"><span class="vlr-note-n">${esc(f.n)}</span>${esc(f.text)}</li>`).join('')}</ol></section>` : '';
    default: return '';
  }
}

function coverHtml(book, project, chapters) {
  return `<section class="vlr-sheet vlr-cover" data-anchor="cover">
    <div class="vlr-cover-eyebrow">Voluntary Local Review</div>
    <h1 class="vlr-cover-title">${esc(book.title)}</h1>
    <p class="vlr-cover-sub">${esc(book.subtitle)}</p>
    <div class="vlr-cover-rule"></div>
    <div class="vlr-cover-meta"><span>${esc(project.jurisdiction)}</span><span class="dot"></span><span>${esc(project.city)}, ${esc(project.country)}</span><span class="dot"></span><span>${esc(project.year)}</span></div>
    <div class="vlr-cover-goals"><div class="caps">Goals reported</div>${sdgChips(chapters.map(c => c.goal), { max: 17 })}</div>
    <div class="vlr-cover-foot"><span>${book.status === 'final' ? 'Published edition' : 'Review draft'} · v${esc(book.version)}</span><span>${esc(book.stats?.pages || '—')} pages · ${esc(book.stats?.chapters || chapters.length)} chapters · ${esc(book.stats?.footnotes || 0)} notes</span></div>
  </section>`;
}

function sheetsHtml(book, project, chapters, data) {
  const sheets = buildSheets(book);
  return sheets.map((items, i) => {
    if (items[0]?.kind === 'cover') {
      const rest = items.slice(1);
      return coverHtml(book, project, chapters) + (rest.length ? `<section class="vlr-sheet">${rest.map(it => blockHtml(it, data)).join('')}</section>` : '');
    }
    const h1 = items.find(it => it.kind === 'h1');
    const chapter = h1?.chapterId ? chapters.find(c => c.id === h1.chapterId) : null;
    const runner = chapter ? `<div class="vlr-runner"><span>${esc(book.title)}</span><span>Chapter ${esc(chapter.number)} · SDG ${esc(chapter.goal)}${chapter.status === 'approved' ? ` · approved v${esc(chapter.version)}` : ''}</span></div>` : `<div class="vlr-runner"><span>${esc(book.title)}</span><span>${esc(h1?.text || '')}</span></div>`;
    return `<div class="vlr-pagebreak"><span>${icon('scissors', 'icon-xs')}page break</span></div><section class="vlr-sheet" data-sheet="${i}">${runner}${items.map(it => blockHtml(it, data)).join('')}</section>`;
  }).join('');
}

/* =========================================================================
 * TOC / comments panel / empty state
 * ======================================================================= */
function tocHtml(book, chapters, active, commentsAll) {
  const items = tocItems(book);
  const openByChapter = {};
  commentsAll.filter(c => c.status === 'open' && c.chapterId).forEach(c => { openByChapter[c.chapterId] = (openByChapter[c.chapterId] || 0) + 1; });
  return `<nav class="vlr-toc card" aria-label="Contents">
    <div class="card-header tinted"><div class="card-title-caps">${icon('list')}Contents</div></div>
    <div class="vlr-toc-list">
      ${items.map(it => {
        const ch = it.chapterId ? chapters.find(c => c.id === it.chapterId) : null;
        const label = ch ? `Chapter ${ch.number} — SDG ${ch.goal}: ${it.label.replace(/^Chapter \d+ — SDG \d+:\s*/, '')}` : it.label;
        const lead = ch ? `<span class="vlr-toc-goal" style="background:var(--sdg-${esc(ch.goal)})">${esc(ch.goal)}</span>` : icon(it.icon || 'file-text', 'icon-sm');
        const badge = ch && openByChapter[ch.id] ? `<span class="vlr-toc-badge" title="${openByChapter[ch.id]} open comment(s)">${openByChapter[ch.id]}</span>` : '';
        return `<button class="vlr-toc-item lvl0 ${active === it.key ? 'active' : ''}" data-action="toc" data-key="${esc(it.key)}">${lead}<span class="grow truncate">${esc(label)}</span>${badge}</button>
          ${(it.children || []).map(c => `<button class="vlr-toc-item lvl1 ${active === c.key ? 'active' : ''}" data-action="toc" data-key="${esc(c.key)}"><span class="grow truncate">${esc(c.label)}</span></button>`).join('')}`;
      }).join('')}
    </div>
  </nav>`;
}

function commentCardHtml(c, { me, focus, replyOpen, replyDraft, project }) {
  const own = c.author === me;
  const isEditor = (a) => a === 'VLR Editor';
  const chapterLbl = c.chapterId ? (getProjectChapters(project.id).find(x => x.id === c.chapterId)?.title || 'Chapter').replace(/ — .*$/, '') : (c.sectionKey || '').replace(/-/g, ' ');
  return `<article class="vlr-cmt ${c.status} ${focus === c.id ? 'is-focus' : ''} ${c.revising ? 'is-revising' : ''}" data-comment-card="${esc(c.id)}">
    <div class="vlr-cmt-head">
      <span class="avatar avatar-sm">${esc(initials(c.author))}</span>
      <div class="grow"><div class="vlr-cmt-author">${esc(c.author)}${own ? ' <span class="muted">(you)</span>' : ''}</div><div class="vlr-cmt-meta">${esc(relTime(c.at))} · <span class="caps-inline">${esc(chapterLbl)}</span></div></div>
      <span class="vlr-cmt-status ${c.status}" title="${c.status === 'resolved' ? `Resolved${c.resolvedBy ? ' by ' + esc(c.resolvedBy) : ''}` : 'Open'}">${icon(c.status === 'resolved' ? 'check-circle-2' : 'circle-dot', 'icon-xs')}${c.status === 'resolved' ? 'Resolved' : 'Open'}</span>
    </div>
    <button class="vlr-cmt-quote" data-action="goto-comment" data-comment="${esc(c.id)}" title="Jump to the passage">“${esc(c.quote.length > 110 ? c.quote.slice(0, 110) + '…' : c.quote)}”</button>
    <div class="vlr-cmt-text">${esc(c.text)}</div>
    ${(c.replies || []).length ? `<div class="vlr-replies">${c.replies.map(r => `<div class="vlr-reply ${isEditor(r.author) ? 'editor' : ''}"><span class="vlr-reply-av">${isEditor(r.author) ? icon('bot', 'icon-sm') : esc(initials(r.author))}</span><div><div class="vlr-reply-head"><strong>${esc(r.author)}</strong><span class="muted">${esc(relTime(r.at))}</span></div><div class="vlr-reply-text">${esc(r.text)}</div></div></div>`).join('')}</div>` : ''}
    ${c.revising ? `<div class="vlr-revising">${icon('loader-2', 'icon-sm spin')}Revising… the VLR Editor is rewriting the passage</div>` : ''}
    ${replyOpen === c.id ? `<div class="vlr-replybox" data-vlr-keep><input class="input" id="vlr-reply-${esc(c.id)}" data-action="reply-draft" data-comment="${esc(c.id)}" placeholder="Write a reply…" value="${esc(replyDraft || '')}" autocomplete="off"><button class="btn btn-primary btn-sm" data-action="send-reply" data-comment="${esc(c.id)}">Send</button><button class="btn btn-light btn-sm" data-action="cancel-reply">Cancel</button></div>` : ''}
    <div class="vlr-cmt-actions">
      <button class="vlr-cmt-btn" data-action="reply" data-comment="${esc(c.id)}">${icon('reply', 'icon-xs')}Reply</button>
      ${c.status === 'open' ? `<button class="vlr-cmt-btn" data-action="resolve" data-comment="${esc(c.id)}">${icon('check', 'icon-xs')}Resolve</button>` : `<button class="vlr-cmt-btn" data-action="reopen" data-comment="${esc(c.id)}">${icon('rotate-ccw', 'icon-xs')}Reopen</button>`}
      ${!c.revising ? `<button class="vlr-cmt-btn accent" data-action="revise" data-comment="${esc(c.id)}">${icon('sparkles', 'icon-xs')}Ask editor to revise</button>` : ''}
      ${own ? `<button class="vlr-cmt-btn danger" data-action="delete" data-comment="${esc(c.id)}">${icon('trash-2', 'icon-xs')}Delete</button>` : ''}
    </div>
  </article>`;
}

function panelHtml(book, project, local) {
  const all = book.comments || [];
  const open = all.filter(c => c.status === 'open').length;
  const resolved = all.length - open;
  const filter = local.cfilter || 'all';
  const shown = all.filter(c => filter === 'all' || c.status === filter).sort((a, b) => (a.status === b.status ? b.at - a.at : a.status === 'open' ? -1 : 1));
  const me = currentUser()?.name;
  const revs = [...(book.revisions || [])].sort((a, b) => b.at - a.at);
  return `<aside class="vlr-panel card" data-vlr-keep>
    <div class="card-header tinted">
      <div class="card-title-caps">${icon('message-square')}Comments</div>
      <div class="vlr-counts"><span class="badge badge-warning">${open} open</span><span class="badge badge-success">${resolved} resolved</span></div>
    </div>
    <div class="vlr-cfilters">
      ${[['all', 'All', all.length], ['open', 'Open', open], ['resolved', 'Resolved', resolved]].map(([k, l, n]) => `<button class="vlr-cfilter ${filter === k ? 'active' : ''}" data-action="cfilter" data-filter="${k}">${l}<span>${n}</span></button>`).join('')}
    </div>
    <div class="vlr-clist" id="vlr-clist">
      ${shown.length ? shown.map(c => commentCardHtml(c, { me, focus: local.focusComment, replyOpen: local.replyOpen, replyDraft: local.replyDraft, project })).join('')
        : `<div class="empty vlr-cempty">${icon(all.length ? 'filter' : 'highlighter')}<div class="empty-title">${all.length ? 'No comments match' : 'No comments yet'}</div><div class="empty-sub">${all.length ? 'Switch the filter to see the rest.' : 'Select any passage in the book to comment on it or ask the VLR Editor to revise it.'}</div></div>`}
    </div>
    <div class="card-header tinted vlr-panel-sub"><div class="card-title-caps">${icon('history')}Revision history</div><span class="badge badge-neutral">v${esc(book.version)}</span></div>
    <div class="vlr-revs">
      ${revs.map(r => `<div class="vlr-rev"><span class="vlr-rev-v">v${esc(r.version)}</span><div class="grow"><div class="vlr-rev-sum">${esc(r.summary)}</div><div class="vlr-rev-meta">${esc(r.by)} · ${esc(relTime(r.at))}</div></div></div>`).join('') || '<div class="empty-sub" style="padding:14px 18px">No revisions recorded.</div>'}
    </div>
  </aside>`;
}

function emptyStateHtml(project, stats, chapters, tasks) {
  const active = tasks.filter(t => ['assemble', 'render'].includes(t.step) && ['queued', 'running'].includes(t.status)).sort((a, b) => a.createdAt - b.createdAt);
  const allApproved = chapters.length > 0 && chapters.every(c => c.status === 'approved');
  let action;
  if (active.length) {
    action = `<div class="vlr-empty-tasks">${active.map(t => { const m = STEP_META[t.step] || {}; return `<div class="vlr-empty-task"><div class="row-between"><span class="row">${icon(m.icon || 'loader-2', 'icon-sm')}<strong>${esc(m.label || t.label)}</strong><span class="muted xs">${esc(t.inputDoc || '')}</span></span><span class="mono xs">${t.status === 'running' ? `${Math.round(t.progress || 0)}%` : 'Queued'}</span></div>${progressHtml(t.status === 'running' ? (t.progress || 0) : 0, 'sky sm striped')}</div>`; }).join('')}</div>`;
  } else if (allApproved) {
    action = `<button class="btn btn-primary" data-action="assemble">${icon('book-open-check', 'icon-sm')}Assemble final VLR</button>`;
  } else {
    action = `<a class="btn btn-primary" href="#/projects/${esc(project.id)}/chapters">${icon('pen-line', 'icon-sm')}${chapters.length ? 'Go to the chapters' : 'Write VLR chapters'}</a>`;
  }
  const phases = [
    { k: 'ev', label: 'Evidence approved', done: stats.allReviewed, meta: `${stats.approved}/${stats.extractions} extractions` },
    { k: 'ch', label: 'Chapters approved', done: allApproved, meta: `${stats.chaptersApproved}/${stats.chapters} chapters` },
    { k: 'as', label: 'Book assembled', done: false, meta: active.length ? 'in progress…' : 'pending', running: !!active.length },
    { k: 'fi', label: 'Final VLR published', done: false, meta: 'pending' },
  ];
  return `<div class="vlr-empty">
    <div class="card vlr-empty-card">
      <div class="vlr-empty-icon">${icon(active.length ? 'loader-2' : 'book-open', active.length ? 'spin' : '')}</div>
      <h2>${active.length ? 'Assembling the final VLR…' : 'No final VLR yet'}</h2>
      <p class="muted">${active.length
        ? 'Book Assembly stitches the approved chapters together with the front matter, consolidated recommendations and provenance annex; DOCX Rendering then produces the downloadable file. This page will show the book as soon as it is ready.'
        : allApproved ? `All ${chapters.length} chapters are approved. Assemble the final VLR to produce the complete book — front matter, chapters, consolidated recommendations and the provenance annex — ready for review, comments and export.`
        : chapters.length ? `${stats.chaptersApproved} of ${stats.chapters} chapters are approved. The final VLR can be assembled once every chapter has been reviewed and approved in the Chapters workspace.`
        : stats.allReviewed ? 'The evidence is fully reviewed. Write the VLR chapters first — one Chapter Composer per reported goal — then approve them to unlock the final assembly.'
        : 'The final VLR is assembled after every extraction has been reviewed and every chapter approved. Finish the review in the project Overview and the Chapters workspace first.'}</p>
      <div class="vlr-phases">${phases.map(p => `<div class="vlr-phase ${p.done ? 'done' : p.running ? 'running' : ''}"><span class="vlr-phase-dot">${p.done ? icon('check', 'icon-xs') : p.running ? icon('loader-2', 'icon-xs spin') : ''}</span><div><div class="vlr-phase-label">${esc(p.label)}</div><div class="vlr-phase-meta">${esc(p.meta)}</div></div></div>`).join('')}</div>
      <div class="vlr-empty-action">${action}</div>
    </div>
  </div>`;
}

/* =========================================================================
 * Helpers for scrolling / selection
 * ======================================================================= */
function scrollToEl(el, extra = 0) {
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - TOPBAR_OFFSET - extra;
  window.scrollTo({ top: Math.max(0, top), behavior: document.hidden ? 'auto' : 'smooth' });
}
function anchorEl(root, key) { return root.querySelector(`[data-anchor="${CSS.escape(key)}"]`); }
function blockOf(node) { const el = node?.nodeType === 1 ? node : node?.parentElement; return el?.closest?.('.vlr-p[data-block]') || null; }

/* =========================================================================
 * Page
 * ======================================================================= */
export default {
  title: (ctx) => { const p = getProject(ctx.params.id); return p ? `Final VLR — ${p.name}` : 'Final VLR'; },
  render(ctx) {
    const project = getProject(ctx.params.id);
    if (!project) {
      ctx.topbar.innerHTML = `<button class="btn-icon vlr-back" data-action="back" aria-label="Back">${icon('arrow-left', 'icon-lg')}</button><span class="topbar-title">Final VLR</span><span class="grow"></span>${avatarButton()}`;
      ctx.content.innerHTML = `<div class="empty">${icon('folder-x')}<div class="empty-title">Project not found</div><div class="empty-sub">The project may have been deleted.</div><a class="btn btn-light btn-sm mt-12" href="#/projects">Back to projects</a></div>`;
      ctx.footer.innerHTML = '';
      return;
    }
    const local = ctx.local;
    const stats = projectStats(project);
    const lockReason = stepLockReason(project, 'vlr');
    if (lockReason) {
      ctx.topbar.innerHTML = `<div class="breadcrumb"><a href="#/projects/${esc(project.id)}">${esc(project.city)} ${esc(project.year)}</a>${icon('chevron-right', 'icon-sm')}<span class="crumb-current">Final VLR</span></div><span class="grow"></span>${avatarButton()}`;
      ctx.content.innerHTML = stepLockedHtml(project, 'vlr', lockReason);
      ctx.footer.innerHTML = '';
      refreshIcons(ctx.content); refreshIcons(ctx.topbar);
      return;
    }
    const book = getProjectBook(project.id);
    const chapters = getProjectChapters(project.id);
    const tasks = getProjectTasks(project.id);
    const me = currentUser()?.name || 'Reviewer';
    const isFinal = book?.status === 'final';
    const tabs = projectStepper(project, 'vlr', { compact: true });

    /* ---------- top bar ---------- */
    const sub = book
      ? `v${book.version} · ${isFinal ? 'Final' : 'Draft'} · ${book.stats?.pages ?? '—'} pages · ${book.stats?.figures ?? 0} figures · ${book.stats?.footnotes ?? 0} footnotes`
      : `${stats.phase} · ${chapters.length} chapter${chapters.length === 1 ? '' : 's'}`;
    ctx.topbar.innerHTML = `
      <button class="btn-icon vlr-back" data-action="back" aria-label="Back">${icon('arrow-left', 'icon-lg')}</button>
      <div class="vlr-heading"><div class="topbar-title">Final VLR — ${esc(project.name)}</div><div class="topbar-subtitle">${esc(sub)}</div></div>
      <span class="grow"></span>
      ${tabs}
      ${book ? `
        ${isFinal ? `<span class="badge badge-success badge-dot vlr-status">Published</span>` : `<span class="badge badge-warning vlr-status">Draft</span>`}
        <button class="btn btn-light" data-action="download-menu">${icon('download', 'icon-sm')}Download${icon('chevron-down', 'icon-sm')}</button>
        ${isFinal ? `<button class="btn btn-light" data-action="reopen-book">${icon('unlock', 'icon-sm')}Reopen for edits</button>`
                  : `<button class="btn btn-primary" data-action="finalize">${icon('badge-check', 'icon-sm')}Finalize VLR</button>`}` : ''}
      ${avatarButton()}`;

    /* ---------- content ---------- */
    if (!book) {
      local.sel = null;
      ctx.content.innerHTML = `<div class="vlr-page">${emptyStateHtml(project, stats, chapters, tasks)}</div>`;
      ctx.footer.innerHTML = statusBarHtml(project);
      const unbind = bindActions(ctx.content, {
        'assemble': () => { const t = assembleFinalBook(project.id); if (t) toast.success('Final VLR assembly started', 'Book Assembly → DOCX Rendering. The book appears here when both finish.'); else toast.warning('Nothing to assemble', 'No chapters found for this project.'); },
      });
      const unbindTop = bindActions(ctx.topbar, {});
      return () => { unbind(); unbindTop(); };
    }

    const commentsByBlock = {};
    (book.comments || []).forEach(c => { (commentsByBlock[c.blockId] ||= []).push(c); });
    /* drop a stale selection whose block no longer exists in the book */
    const sel = local.sel && local.sel.blockId ? local.sel : null;
    const activeTasks = tasks.filter(t => ['assemble', 'render'].includes(t.step) && ['queued', 'running'].includes(t.status));
    const openCount = (book.comments || []).filter(c => c.status === 'open').length;

    ctx.content.innerHTML = `<div class="vlr-page">
      ${activeTasks.length ? `<div class="callout vlr-banner">${icon('loader-2', 'spin')}<div class="grow"><strong>${activeTasks.some(t => t.step === 'assemble') ? 'Re-assembling the book' : 'Rendering the Word file'}</strong> — ${esc(activeTasks.map(t => `${STEP_META[t.step]?.label || t.label} ${t.status === 'running' ? Math.round(t.progress || 0) + '%' : '(queued)'}`).join(' · '))}</div></div>` : ''}
      ${isFinal ? `<div class="callout success vlr-banner">${icon('badge-check')}<div class="grow"><strong>Published</strong> — finalised ${book.finalizedAt ? esc(fmtDateTime(book.finalizedAt)) : ''}${book.finalizedBy ? ` by ${esc(book.finalizedBy)}` : ''}. Comments stay open for the record; asking the editor to revise a passage reopens the draft.</div><button class="btn btn-light btn-sm" data-action="download-docx">${icon('file-type', 'icon-sm')}Word (.docx)</button></div>`
        : openCount ? `<div class="callout warning vlr-banner">${icon('message-square-warning')}<div class="grow"><strong>${openCount} open comment${openCount === 1 ? '' : 's'}</strong> — resolve them or ask the VLR Editor to revise the passages before finalising.</div><button class="btn btn-light btn-sm" data-action="cfilter" data-filter="open">Show open</button></div>` : ''}
      <div class="vlr-layout">
        ${tocHtml(book, chapters, local.tocActive || 'cover', book.comments || [])}
        <div class="vlr-book" id="vlr-book">
          ${sheetsHtml(book, project, chapters, { commentsByBlock, sel, project })}
          <div class="vlr-colophon">${icon('shield-check', 'icon-sm')}Generated by VLR Forge · every figure above traces to a source document, page and quotation · v${esc(book.version)} · assembled ${esc(fmtDateTime(book.assembledAt))}</div>
        </div>
        ${panelHtml(book, project, local)}
      </div>
    </div>`;
    ctx.footer.innerHTML = statusBarHtml(project);

    /* one-off post-render effects (scroll a comment card into view, focus the textarea) */
    if (local.scrollToCard) {
      const panel = ctx.content.querySelector('.vlr-panel'); const card = ctx.content.querySelector(`[data-comment-card="${CSS.escape(local.scrollToCard)}"]`);
      if (panel && card) panel.scrollTo({ top: Math.max(0, card.offsetTop - 70), behavior: 'smooth' });
      local.scrollToCard = null;
    }
    if (local.focusInput) {
      const el = ctx.content.querySelector(`#${CSS.escape(local.focusInput)}`);
      if (el) { el.focus(); if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') { try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* ignore */ } } }
      local.focusInput = null;
    }
    if (local.scrollToBlock) {
      const el = ctx.content.querySelector(`mark[data-comment="${CSS.escape(local.scrollToBlock.comment)}"]`) || ctx.content.querySelector(`[data-block="${CSS.escape(local.scrollToBlock.block)}"]`);
      if (el) { requestAnimationFrame(() => { scrollToEl(el, 120); el.closest('.vlr-p')?.classList.add('flash'); }); }
      local.scrollToBlock = null;
    }

    /* ---------- actions ---------- */
    const comment = (id) => (book.comments || []).find(c => c.id === id);
    const clearSel = () => { local.sel = null; local.draft = ''; };
    const doDownload = (fmt) => {
      const b = getProjectBook(project.id); if (!b) return;
      const out = bookExport(b, fmt);
      if (out.html) {
        const w = window.open('', '_blank');
        if (w) { w.document.open(); w.document.write(out.html); w.document.close(); toast.info('Printable VLR opened in a new tab', 'Use the print dialog to save it as PDF.'); }
        else { download(out.name.replace(/\.pdf$/, '.html'), out.html, 'text/html'); toast.info('Pop-up blocked', 'Saved the printable HTML instead.'); }
        return;
      }
      download(out.name, out.blob, out.mime);
      toast.success('Download started', out.name);
    };
    const submitComment = (mode) => {
      const s = local.sel; if (!s) return;
      const text = (local.draft || '').trim();
      if (mode === 'comment' && !text) { toast.warning('Write a comment first'); local.focusInput = 'vlr-cmt-text'; ctx.rerender(); return; }
      const c = addBookComment(book.id, { sectionKey: s.sectionKey, chapterId: s.chapterId || null, blockId: s.blockId, quote: s.quote, text: text || DEFAULT_REVISE_TEXT });
      clearSel();
      local.cfilter = 'all'; local.focusComment = c.id; local.scrollToCard = c.id;
      if (mode === 'revise') { reviseFromComment(book.id, c.id); toast.info('Sent to the VLR Editor', 'The passage is being revised — watch the comment for the reply.'); }
      else toast.success('Comment added', 'The passage is highlighted in the book.');
      window.getSelection()?.removeAllRanges?.();
      ctx.rerender();
    };

    const unbindClick = bindActions(ctx.content, {
      'toc': (el) => { const key = el.dataset.key; local.tocActive = key; ctx.content.querySelectorAll('.vlr-toc-item').forEach(b => b.classList.toggle('active', b.dataset.key === key)); scrollToEl(anchorEl(ctx.content, key), key === 'cover' ? 40 : 0); },
      'goto-fn': (el, ev) => { ev.preventDefault(); const n = el.dataset.fn; const note = ctx.content.querySelector(`[data-fnote="${CSS.escape(n)}"]`); if (note) { scrollToEl(note, 160); note.classList.add('flash'); setTimeout(() => note.classList.remove('flash'), 1600); } },
      'focus-comment': (el, ev) => { ev.preventDefault(); ev.stopPropagation(); const id = el.dataset.comment; const c = comment(id); if (!c) return; if ((local.cfilter || 'all') !== 'all' && local.cfilter !== c.status) local.cfilter = 'all'; local.focusComment = id; local.scrollToCard = id; clearSel(); ctx.rerender(); },
      'focus-block-comments': (el) => { const first = (commentsByBlock[el.dataset.block] || []).find(c => c.status === 'open'); if (!first) return; local.cfilter = 'all'; local.focusComment = first.id; local.scrollToCard = first.id; ctx.rerender(); },
      'goto-comment': (el) => { const c = comment(el.dataset.comment); if (!c) return; local.focusComment = c.id; local.scrollToBlock = { comment: c.id, block: c.blockId }; ctx.rerender(); },
      'cfilter': (el) => { local.cfilter = el.dataset.filter; ctx.rerender(); },
      'sel-comment': () => { if (!local.sel) return; local.sel.mode = 'comment'; local.draft = ''; local.focusInput = 'vlr-cmt-text'; ctx.rerender(); },
      'sel-revise': () => { if (!local.sel) return; local.sel.mode = 'revise'; local.draft = ''; local.focusInput = 'vlr-cmt-text'; ctx.rerender(); },
      'cancel-sel': () => { clearSel(); window.getSelection()?.removeAllRanges?.(); ctx.rerender(); },
      'add-comment': () => submitComment('comment'),
      'send-revise': () => submitComment('revise'),
      'reply': (el) => { local.replyOpen = el.dataset.comment; local.replyDraft = ''; local.focusInput = `vlr-reply-${el.dataset.comment}`; local.focusComment = el.dataset.comment; ctx.rerender(); },
      'cancel-reply': () => { local.replyOpen = null; local.replyDraft = ''; ctx.rerender(); },
      'send-reply': (el) => { const id = el.dataset.comment; const t = (local.replyDraft || '').trim(); if (!t) { toast.warning('Write a reply first'); local.focusInput = `vlr-reply-${id}`; ctx.rerender(); return; } replyBookComment(book.id, id, t); local.replyOpen = null; local.replyDraft = ''; toast.success('Reply added'); },
      'resolve': (el) => { resolveBookComment(book.id, el.dataset.comment, true); toast.success('Comment resolved'); },
      'reopen': (el) => { resolveBookComment(book.id, el.dataset.comment, false); toast.info('Comment reopened'); },
      'revise': (el) => { const c = comment(el.dataset.comment); if (!c || c.revising) return; local.focusComment = c.id; reviseFromComment(book.id, c.id); toast.info('Sent to the VLR Editor', `“${c.quote.slice(0, 60)}${c.quote.length > 60 ? '…' : ''}” is being revised.`); },
      'delete': async (el) => { const c = comment(el.dataset.comment); if (!c) return; if (await confirmDialog({ title: 'Delete comment?', msg: `Your comment on “${esc(c.quote.slice(0, 80))}${c.quote.length > 80 ? '…' : ''}” will be removed${c.replies?.length ? ` together with ${c.replies.length} repl${c.replies.length === 1 ? 'y' : 'ies'}` : ''}.`, confirmText: 'Delete', danger: true, icon: 'trash-2' })) { deleteBookComment(book.id, c.id); if (local.focusComment === c.id) local.focusComment = null; toast.success('Comment deleted'); } },
      'download-docx': () => doDownload('docx'),
    });
    const unbindInput = bindActions(ctx.content, {
      'draft': (el) => { local.draft = el.value; },
      'reply-draft': (el) => { local.replyDraft = el.value; },
    }, 'input');
    const unbindKey = bindActions(ctx.content, {
      'draft': (el, ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); submitComment(local.sel?.mode === 'revise' ? 'revise' : 'comment'); } },
      'reply-draft': (el, ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const id = el.dataset.comment; const t = (el.value || '').trim(); if (!t) return; replyBookComment(book.id, id, t); local.replyOpen = null; local.replyDraft = ''; toast.success('Reply added'); } },
    }, 'keydown');
    const unbindTop = bindActions(ctx.topbar, {
      'download-menu': (el) => openMenu(el, [
        { header: `${book.title} · v${book.version}` },
        { label: 'Word (.docx)', icon: 'file-type', sub: 'Opens in Microsoft Word / Google Docs', onClick: () => doDownload('docx') },
        { label: 'PDF (print)', icon: 'printer', sub: 'Printable layout in a new tab', onClick: () => doDownload('pdf') },
        { label: 'Markdown', icon: 'file-text', sub: 'Plain-text source with footnotes', onClick: () => doDownload('md') },
      ], { align: 'right', minWidth: '280px' }),
      'finalize': async () => {
        const b = getProjectBook(project.id); if (!b) return;
        const open = (b.comments || []).filter(c => c.status === 'open').length;
        const ok = await confirmDialog({ title: 'Finalize the VLR?', msg: `<strong>${esc(b.title)}</strong> (v${b.version}) will be published as the final Voluntary Local Review of ${esc(project.jurisdiction)}.${open ? ` <br><br><span class="warning-text">${open} comment${open === 1 ? ' is' : 's are'} still open</span> — you can finalize anyway and reopen later.` : ' All comments are resolved.'}`, confirmText: 'Finalize & publish', icon: 'badge-check' });
        if (!ok) return;
        finalizeBook(b.id);
        toast.success('Final VLR published', `${b.title} · v${b.version}`);
      },
      'reopen-book': async () => {
        const b = getProjectBook(project.id); if (!b) return;
        if (await confirmDialog({ title: 'Reopen for edits?', msg: `The published edition goes back to <strong>draft</strong>. Comments and editor revisions become possible again; finalize it once more to publish.`, confirmText: 'Reopen', icon: 'unlock' })) { reopenBook(b.id); toast.info('VLR reopened for edits'); }
      },
    });

    /* ---------- text selection → floating toolbar ---------- */
    const bookEl = ctx.content.querySelector('#vlr-book');
    const onMouseUp = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target?.closest?.('[data-vlr-keep], .menu, .modal-backdrop, .drawer, #toast-root')) return;
      setTimeout(() => {
        const s = window.getSelection();
        const text = s && !s.isCollapsed ? s.toString().replace(/\s+/g, ' ').trim() : '';
        if (text.length >= 3 && bookEl) {
          const a = blockOf(s.anchorNode), f = blockOf(s.focusNode);
          if (a && a === f && bookEl.contains(a)) {
            const r = s.getRangeAt(0).getBoundingClientRect(); const br = a.getBoundingClientRect();
            const quote = text.slice(0, 240);
            const cur = local.sel;
            local.sel = { blockId: a.dataset.block, sectionKey: a.dataset.section, chapterId: a.dataset.chapter || null, quote, mode: cur && cur.blockId === a.dataset.block && cur.mode && cur.quote === quote ? cur.mode : null,
              top: clamp(r.top - br.top - 44, -44, br.height), left: clamp(r.left - br.left + r.width / 2, 90, Math.max(90, br.width - 90)) };
            if (!local.sel.mode) local.draft = '';
            ctx.rerender();
            return;
          }
        }
        if (local.sel) {
          const keepForm = (local.sel.mode === 'comment' || local.sel.mode === 'revise') && (local.draft || '').trim();
          if (!keepForm) { clearSel(); ctx.rerender(); }
        }
      }, 0);
    };
    const onKey = (e) => { if (e.key === 'Escape' && local.sel && !document.querySelector('#modal-root .modal-backdrop')) { clearSel(); window.getSelection()?.removeAllRanges?.(); ctx.rerender(); } };
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKey);

    /* ---------- scroll spy for the TOC (DOM patch only — no re-render) ---------- */
    let ticking = false;
    const anchors = () => { const keys = new Set([...ctx.content.querySelectorAll('.vlr-toc-item')].map(b => b.dataset.key)); return [...ctx.content.querySelectorAll('[data-anchor]')].filter(el => keys.has(el.dataset.anchor)); };
    const onScroll = () => {
      if (ticking) return; ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const list = anchors(); if (!list.length) return;
        const line = TOPBAR_OFFSET + 40;
        let cur = list[0];
        for (const el of list) { if (el.getBoundingClientRect().top <= line) cur = el; else break; }
        const key = cur.dataset.anchor;
        if (key === local.tocActive) return;
        local.tocActive = key;
        ctx.content.querySelectorAll('.vlr-toc-item').forEach(b => b.classList.toggle('active', b.dataset.key === key));
        const act = ctx.content.querySelector('.vlr-toc-item.active'); const toc = ctx.content.querySelector('.vlr-toc');
        if (act && toc) { const t = act.offsetTop - toc.clientHeight / 2; if (Math.abs(toc.scrollTop - t) > 120) toc.scrollTo({ top: Math.max(0, t) }); }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    refreshIcons(ctx.content);

    return () => { unbindClick(); unbindInput(); unbindKey(); unbindTop(); document.removeEventListener('mouseup', onMouseUp); document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll); };
  },
};
