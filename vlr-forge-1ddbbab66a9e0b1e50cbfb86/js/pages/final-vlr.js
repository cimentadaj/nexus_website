/* Final VLR — route #/projects/:id/vlr
 * The assembled book (front matter · chapters · consolidated recommendations · provenance annex) rendered as
 * continuous paper sheets, with highlight-and-comment on any passage, a comments panel, VLR Editor revisions,
 * finalize / reopen and real DOCX / PDF / Markdown exports. All UI state lives in ctx.local (re-renders are frequent).
 */
import { esc, icon, relTime, fmtDateTime, sdgChips, SDG_TITLES, SDG_COLORS, avatarHtml, progressHtml, bindActions, toast, confirmDialog, openMenu, download, refreshIcons } from '../ui.js';
import { getProject, getProjectBook, getProjectChapters, getProjectTasks, getProjectExtractions, getExtraction, projectStats, currentUser } from '../store.js';
import { assembleFinalBook, rewriteUnit, finalizeBook, reopenBook } from '../actions.js';
import { bookOutline, bookExport } from '../export.js';
import { avatarButton, statusBarHtml, projectStepper, stepLockReason, stepLockedHtml } from '../shell.js';
import { STEP_META, PILLARS, quotePlain } from '../seed.js';
import { navigate } from '../router.js';

const PILLAR_LABEL = { indicators: 'Urban Data', documentary: 'Documentary', projects: 'Projects', stakeholders: 'Stakeholder' };
const PART_ICON = { foreword: 'quote', 'executive-summary': 'file-text', introduction: 'book-open', profile: 'map-pin', recommendations: 'list-checks', annex: 'shield-check' };
const TOPBAR_OFFSET = 62 + 18;
const PILLAR_ABBR = { indicators: 'IND', documentary: 'DOC', projects: 'PRJ', stakeholders: 'STK' };

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
  const out = pageOutline(book);
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
  const items = [];
  let cur = null;
  for (const it of pageOutline(book)) {
    if (it.kind === 'h1') { cur = { key: it.key, label: it.text, level: 0, icon: it.chapterId ? null : (PART_ICON[it.key] || 'file-text'), chapterId: it.chapterId || null, children: [] }; items.push(cur); }
    else if (it.kind === 'h2' && cur) cur.children.push({ key: it.key, label: it.text, level: 1 });
  }
  return items;
}

/* =========================================================================
 * Block renderers
 * ======================================================================= */
function pBlockHtml(it, { unit }) {
  const selected = unit && unit.type === 'block' && unit.id === it.id;
  const cls = ['vlr-p', selected ? 'is-sel' : '', it.role ? `role-${it.role}` : ''].filter(Boolean).join(' ');
  return `<div class="${cls}" data-block="${esc(it.id)}" data-section="${esc(it._section)}" ${it._chapter ? `data-chapter="${esc(it._chapter)}"` : ''}>
    <p data-action="sel-unit" data-block="${esc(it.id)}">${richHtml(it.text, [])}</p>
  </div>`;
}

function blockHtml(it, data) {
  switch (it.kind) {
    case 'cover': return '';
    case 'h1': return `<h1 class="vlr-h1" data-anchor="${esc(it.key)}" data-action="unit-clear">${esc(it.text)}</h1>`;
    case 'h2': return `<h2 class="vlr-h2 vlr-h-sel ${data.unit?.type === 'sec' && data.unit.id === it.key ? 'is-sel' : ''}" data-anchor="${esc(it.key)}" data-action="sel-sec" data-sec="${esc(it.key)}">${esc(it.text)}</h2>`;
    case 'h3': return `<h3 class="vlr-h3" data-anchor="${esc(it.key)}">${esc(it.text)}</h3>`;
    case 'p': return pBlockHtml(it, data);
    case 'signature': return `<div class="vlr-sig">${esc(it.text).replace(/\n/g, '<br>')}</div>`;
    case 'box': return `<aside class="vlr-box ${it.nexus ? 'nexus' : ''}"><div class="vlr-box-title">${icon(it.nexus ? 'git-merge' : 'landmark', 'icon-sm')}${esc(it.title)}</div><ul>${(it.items || []).map(i => `<li>${esc(i.text)}${i.fn ? supHtml(i.fn) : ''}</li>`).join('')}</ul></aside>`;
    case 'figure': return `<figure class="vlr-figure"><div class="vlr-figure-ph"><div class="vlr-figure-bars">${[62, 78, 45, 90, 70, 55, 84].map((h, i) => `<span style="height:${h}%;animation-delay:${i * 60}ms"></span>`).join('')}</div><div class="vlr-figure-label">${icon('image', 'icon-sm')}Regional dashboard — figure placeholder${it.goal ? ` · SDG ${esc(it.goal)}` : ''}</div></div><figcaption>${esc(it.caption)}</figcaption></figure>`;
    case 'table': return `<figure class="vlr-table"><figcaption>${esc(it.title)}</figcaption><div class="vlr-table-wrap"><table><thead><tr>${(it.columns || []).map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${(it.rows || []).map(r => `<tr>${r.map((c, i) => `<td class="${i > 0 && /^[\d.,%\s–-]+$/.test(String(c)) ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${it.source ? `<div class="vlr-table-src">${esc(it.source)}</div>` : ''}</figure>`;
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
    const h1 = items.find(it => it.kind === 'h1');
    const chapter = h1?.chapterId ? chapters.find(c => c.id === h1.chapterId) : null;
    const runner = chapter ? `<div class="vlr-runner"><span>${esc(book.title)}</span><span>Chapter ${esc(chapter.number)} · SDG ${esc(chapter.goal)}${chapter.status === 'approved' ? ` · approved v${esc(chapter.version)}` : ''}</span></div>` : `<div class="vlr-runner"><span>${esc(book.title)}</span><span>${esc(h1?.text || '')}</span></div>`;
    return `${i ? `<div class="vlr-pagebreak"><span>${icon('scissors', 'icon-xs')}page break</span></div>` : ''}<section class="vlr-sheet" data-sheet="${i}">${runner}${items.map(it => blockHtml(it, data)).join('')}</section>`;
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
          ${(it.children || []).map(c => `<button class="vlr-toc-item lvl1 ${active === c.key ? 'active' : ''}" data-action="toc" data-key="${esc(c.key)}" data-sub="1"><span class="grow truncate">${esc(c.label)}</span></button>`).join('')}`;
      }).join('')}
    </div>
  </nav>`;
}

/* =========================================================================
 * Unit selection + editor panel — same philosophy as the chapter reviewer:
 * click a paragraph, a heading or a TOC entry, curate the urban-data context,
 * rewrite that unit from exactly the selected resources.
 * ======================================================================= */
/* Rendered scope: executive summary, introduction and the SDG chapters only —
 * cover, foreword, profile and back matter are handled outside this view. */
const KEEP_KEY = (key) => key === 'executive-summary' || key === 'introduction' || String(key).startsWith('chapter:');
function pageOutline(book) {
  const out = [];
  let keep = false;
  for (const it of bookOutline(book)) {
    if (it.kind === 'cover') { keep = false; continue; }
    if (it.kind === 'h1') keep = KEEP_KEY(it.key);
    if (it.kind === 'pagebreak') { if (out.length && out[out.length - 1].kind !== 'pagebreak') out.push(it); continue; }
    if (keep) out.push(it);
  }
  while (out.length && out[0].kind === 'pagebreak') out.shift();
  return out;
}

function bookFlatItems(book) {
  const out = [];
  let h1 = null, h2 = null, chapterId = null;
  for (const it of pageOutline(book)) {
    if (it.kind === 'h1') { h1 = it.key; h2 = null; chapterId = it.chapterId || null; continue; }
    if (it.kind === 'h2') { h2 = it.key; continue; }
    if (it.kind === 'p' && it.id) out.push({ id: it.id, secKey: h2 || h1, h1Key: h1, chapterId });
  }
  return out;
}
function bookHeadingLabel(book, key) {
  for (const it of pageOutline(book)) if ((it.kind === 'h1' || it.kind === 'h2') && it.key === key) return it.text;
  return 'section';
}
function bookUnit(book, unit) {
  if (!unit) return null;
  const items = bookFlatItems(book);
  if (unit.type === 'block') {
    const b = items.find(x => x.id === unit.id);
    return b ? { blocks: [b], label: 'the selected paragraph', short: 'Paragraph', heading: bookHeadingLabel(book, b.secKey), chapterId: b.chapterId } : null;
  }
  const list = items.filter(x => x.secKey === unit.id);
  if (!list.length) return null;
  const heading = bookHeadingLabel(book, unit.id);
  return { blocks: list, label: `the section “${heading}”`, short: 'Section', heading, chapterId: list.every(x => x.chapterId === list[0].chapterId) ? list[0].chapterId : null };
}

function editorPanelHtml(book, project, chapters, local) {
  const u = bookUnit(book, local.unit);
  if (!u) return '';
  const ctxSel = local.ctxSel || {};
  const all = getProjectExtractions(project.id).filter(e => e.status === 'approved');
  const selected = Object.keys(ctxSel).filter(k => ctxSel[k]).map(id => all.find(e => e.id === id) || getExtraction(id)).filter(Boolean);
  const targetChapter = u.chapterId ? chapters.find(c => c.id === u.chapterId) : null;
  const busy = !!targetChapter?.reviewing;
  const me = currentUser();
  const msgs = targetChapter ? (targetChapter.chat || []) : [];
  const mini = (e, on) => `<button class="ch-ctx-mini ${on ? 'on' : ''}" data-action="ctx-toggle" data-id="${esc(e.id)}"><span class="mono">${esc(e.sdg)}</span>${icon(on ? 'x' : 'plus', 'icon-xs')}</button>`;
  const miniSeries = (g, on) => `<button class="ch-ctx-mini ${on ? 'on' : ''}" data-action="ctx-toggle" data-ids="${esc(g.map(x => x.id).join(','))}"><span class="mono">${esc(g[0].sdg)}</span>${g.length > 1 ? `<span class="ch-yrs">×${g.length}</span>` : ''}${icon(on ? 'x' : 'plus', 'icon-xs')}</button>`;
  const groupInd = (list) => { const m = new Map(); for (const e of list.filter(x => x.pillar === 'indicators')) { const k = e.sdg + '|' + e.title; if (!m.has(k)) m.set(k, []); m.get(k).push(e); } return [...m.values()].map(g => [...g].sort((x, y) => (x.year || 0) - (y.year || 0))); };
  return `<aside class="ch-chat card vlr-editor" data-vlr-keep>
    <div class="card-header tinted ch-chat-head">
      <div class="card-title-caps">${icon('bot')}VLR Editor</div>
      <div class="row gap-6">
        ${busy ? `<span class="ch-live"><span class="ch-live-dot busy"></span>Rewriting</span>` : ''}
        <button class="btn-icon" data-action="unit-clear" data-tip="Close" aria-label="Close">${icon('x', 'icon-sm')}</button>
      </div>
    </div>
    <div class="ch-msgs" id="ch-msgs">
      ${msgs.length ? msgs.map(m => m.role === 'user'
        ? `<div class="ch-msg user"><div class="ch-msg-avatar">${avatarHtml({ name: m.by || me?.name || 'You' })}</div><div class="ch-msg-body"><div class="ch-msg-meta"><b>${esc(m.by || me?.name || 'You')}</b><span>${esc(relTime(m.at))}</span></div><div class="ch-msg-text">${esc(m.text)}</div></div></div>`
        : `<div class="ch-msg assistant ${m.pending ? 'pending' : ''}"><div class="ch-msg-avatar ai">${icon('bot', 'icon-sm')}</div><div class="ch-msg-body"><div class="ch-msg-meta"><b>VLR Editor</b><span>${esc(relTime(m.at))}</span></div>
            ${m.pending ? `<div class="ch-typing"><span></span><span></span><span></span><em>Rewriting…</em></div>` : `<div class="ch-msg-text">${esc(m.text)}</div>`}
          </div></div>`).join('') : ''}
    </div>
    <div class="ch-unit">
      <div class="ch-unit-head">
        <span class="ch-unit-tag">${icon('text-select', 'icon-xs')}${esc(u.short)} — ${esc(u.heading)}</span>
        <span class="grow"></span>
        <button class="btn-icon" data-action="unit-clear" data-tip="Clear selection" aria-label="Clear selection">${icon('x', 'icon-sm')}</button>
      </div>
      <div class="ch-ctx-bar"><span class="ch-unit-lbl">Context · ${selected.length} resource${selected.length === 1 ? '' : 's'}</span></div>
      ${selected.length ? `<div class="ch-ctx-cols">${PILLARS.map(p => { const list = selected.filter(e => e.pillar === p.key); return `
        <div class="ch-ctx-col col-${esc(p.key)}">
          <div class="ch-ctx-col-h"><span class="ch-pillar p-${esc(p.key)}">${PILLAR_ABBR[p.key]}</span><button class="ch-col-add ${local.resPillar === p.key ? 'on' : ''}" data-action="res-open" data-pillar="${esc(p.key)}" data-tip="Browse ${esc(p.label.toLowerCase())} resources">${icon('plus', 'icon-xs')}</button></div>
          ${p.key === 'indicators' ? groupInd(list).map(g => miniSeries(g, true)).join('') : list.map(e => mini(e, true)).join('')}
        </div>`; }).join('')}</div>` : `<div class="ch-ctx-pills"><span class="xs muted">Empty — add resources to rewrite from.</span></div>`}
      ${local.resPillar ? (() => {
        const p = PILLARS.find(x => x.key === local.resPillar);
        const pillarAll = all.filter(e => e.pillar === p.key);
        const goals = [...new Set(pillarAll.map(e => e.goal))].sort((x, y) => x - y);
        const g = local.resGoal;
        const list = pillarAll.filter(e => !g || e.goal === g);
        const entries = p.key === 'indicators' ? groupInd(list).map(gr => ({ ids: gr.map(x => x.id), sdg: gr[0].sdg, title: gr[0].title, n: gr.length })) : list.map(e => ({ ids: [e.id], sdg: e.sdg, title: e.title, n: 1 }));
        return `
      <div class="ch-brw">
        <div class="ch-brw-head"><span class="ch-pillar p-${esc(p.key)}">${PILLAR_ABBR[p.key]}</span><span class="ch-brw-title">${esc(p.label)}</span><span class="grow"></span><button class="btn-icon" data-action="res-close" data-tip="Close" aria-label="Close">${icon('x', 'icon-sm')}</button></div>
        <div class="ch-brw-body">
          <div class="ch-brw-goals">
            <button class="ch-brw-goal all ${!g ? 'on' : ''}" data-action="res-goal" data-goal="">All</button>
            ${goals.map(gl => `<button class="ch-brw-goal ${g === gl ? 'on' : ''}" style="--g:${SDG_COLORS[gl]}" data-action="res-goal" data-goal="${gl}" data-tip="SDG ${gl}: ${esc(SDG_TITLES[gl])}"><i></i>${gl}</button>`).join('')}
          </div>
          <div class="ch-brw-list">
            ${entries.length ? entries.map(en => { const on = en.ids.some(id => ctxSel[id]); return `<button class="ch-ctx-mini ch-brw-item ${on ? 'on' : ''}" data-action="ctx-toggle" ${en.ids.length > 1 ? `data-ids="${esc(en.ids.join(','))}"` : `data-id="${esc(en.ids[0])}"`}><span class="mono">${esc(en.sdg)}</span><span class="ch-res-t">${esc(en.title)}</span>${en.n > 1 ? `<span class="ch-yrs">${en.n} yrs</span>` : ''}${icon(on ? 'x' : 'plus', 'icon-xs')}</button>`; }).join('') : `<span class="xs muted">No resources in this pillar.</span>`}
          </div>
        </div>
      </div>`;
      })() : ''}
    </div>
    <div class="ch-compose-box">
      <textarea class="textarea" id="vlr-instr" rows="2" placeholder="Optional instruction — e.g. lead with the 2023 figure…" ${busy ? 'disabled' : ''}>${esc(local.instr || '')}</textarea>
      <div class="ch-compose-actions"><span class="xs muted">${busy ? 'The editor is rewriting — hang on.' : ''}</span><span class="grow"></span>
        <span ${!u.chapterId ? 'data-tip="Front matter is maintained by the VLR team — select a chapter passage"' : ''}><button class="btn btn-primary btn-sm" data-action="editor-rewrite" ${busy || !u.chapterId || !selected.length ? 'disabled' : ''}>${icon('refresh-cw', 'icon-sm')}Rewrite ${u.short === 'Section' ? 'section' : 'paragraph'}</button></span>
      </div>
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
    ctx.topbar.innerHTML = `
      <button class="btn-icon vlr-back" data-action="back" aria-label="Back">${icon('arrow-left', 'icon-lg')}</button>
      <div class="vlr-heading"><div class="topbar-title">Final VLR — ${esc(project.name)}</div></div>
      <span class="grow"></span>
      ${tabs}
      ${book ? `
        <button class="btn btn-light" data-action="download-menu">${icon('download', 'icon-sm')}Download${icon('chevron-down', 'icon-sm')}</button>
        ${isFinal ? `<button class="btn btn-light" data-action="reopen-book">${icon('unlock', 'icon-sm')}Reopen for edits</button>`
                  : `<button class="btn btn-primary" data-action="finalize">${icon('badge-check', 'icon-sm')}Approve VLR</button>`}` : ''}
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

    const activeTasks = tasks.filter(t => ['assemble', 'render'].includes(t.step) && ['queued', 'running'].includes(t.status));

    ctx.content.innerHTML = `<div class="vlr-page">
      ${activeTasks.length ? `<div class="callout vlr-banner">${icon('loader-2', 'spin')}<div class="grow"><strong>${activeTasks.some(t => t.step === 'assemble') ? 'Re-assembling the book' : 'Rendering the Word file'}</strong> — ${esc(activeTasks.map(t => `${STEP_META[t.step]?.label || t.label} ${t.status === 'running' ? Math.round(t.progress || 0) + '%' : '(queued)'}`).join(' · '))}</div></div>` : ''}
      ${isFinal ? `<div class="callout success vlr-banner">${icon('badge-check')}<div class="grow"><strong>Approved</strong> — ${book.finalizedAt ? esc(fmtDateTime(book.finalizedAt)) : ''}${book.finalizedBy ? ` by ${esc(book.finalizedBy)}` : ''}.</div><button class="btn btn-light btn-sm" data-action="download-docx">${icon('file-type', 'icon-sm')}Word (.docx)</button></div>` : ''}
      <div class="vlr-layout ${bookUnit(book, local.unit) ? 'has-editor' : ''}">
        ${tocHtml(book, chapters, local.tocActive || 'executive-summary', [])}
        <div class="vlr-book" id="vlr-book">
          ${sheetsHtml(book, project, chapters, { unit: local.unit })}
        </div>
        ${bookUnit(book, local.unit) ? editorPanelHtml(book, project, chapters, local) : ''}
      </div>
    </div>`;
    ctx.footer.innerHTML = '';

    if (local.scrollKey) {
      const el = anchorEl(ctx.content, local.scrollKey);
      if (el) requestAnimationFrame(() => scrollToEl(el, local.scrollKey === 'cover' ? 40 : 0));
      local.scrollKey = null;
    }

    /* ---------- actions ---------- */
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

    const setCtxDefault = (u) => {
      const all = getProjectExtractions(project.id).filter(e => e.status === 'approved');
      const ch = u?.chapterId ? chapters.find(c => c.id === u.chapterId) : null;
      const pool = ch ? all.filter(e => e.goal === ch.goal || (e.goals || []).includes(ch.goal)) : all;
      local.ctxSel = Object.fromEntries(pool.map(e => [e.id, true]));
    };
    const selectUnit = (unit) => {
      if (local.unit && local.unit.type === unit.type && local.unit.id === unit.id) { local.unit = null; local.ctxSel = null; local.resPillar = null; ctx.rerender(); return; }
      local.unit = unit;
      setCtxDefault(bookUnit(book, unit));
      local.resPillar = null; local.resGoal = null;
      ctx.rerender();
    };

    const unbindClick = bindActions(ctx.content, {
      'toc': (el) => {
        const key = el.dataset.key;
        local.tocActive = key;
        local.scrollKey = key;
        if (el.dataset.sub) { selectUnit({ type: 'sec', id: key }); return; }
        local.unit = null; local.ctxSel = null; local.resPillar = null;
        ctx.rerender();
      },
      'sel-unit': (el, ev) => { if (ev.target.closest('a, sup')) return; selectUnit({ type: 'block', id: el.dataset.block }); },
      'sel-sec': (el, ev) => { if (ev.target.closest('a, sup')) return; selectUnit({ type: 'sec', id: el.dataset.sec }); },
      'unit-clear': () => { local.unit = null; local.ctxSel = null; local.resPillar = null; ctx.rerender(); },
      'ctx-toggle': (el, ev) => {
        ev.stopPropagation();
        if (el.classList.contains('on') && !ev.target.closest('svg, i')) return;
        const ids = el.dataset.ids ? el.dataset.ids.split(',') : [el.dataset.id];
        const on = ids.some(id => (local.ctxSel || {})[id]);
        ids.forEach(id => { (local.ctxSel ||= {})[id] = !on; });
        ctx.rerender();
      },
      'res-open': (el, ev) => { ev.stopPropagation(); local.resPillar = local.resPillar === el.dataset.pillar ? null : el.dataset.pillar; local.resGoal = null; ctx.rerender(); },
      'res-close': () => { local.resPillar = null; local.resGoal = null; ctx.rerender(); },
      'res-goal': (el) => { const g = el.dataset.goal ? Number(el.dataset.goal) : null; local.resGoal = g && local.resGoal === g ? null : g; ctx.rerender(); },
      'editor-rewrite': () => {
        const u = bookUnit(book, local.unit);
        if (!u || !u.chapterId) return;
        const ids = Object.keys(local.ctxSel || {}).filter(k => local.ctxSel[k]);
        if (!ids.length) { toast.warning('No context selected', 'Pick at least one resource to rewrite from.'); return; }
        if (isFinal) reopenBook(book.id);
        rewriteUnit(u.chapterId, { blockIds: u.blocks.map(x => x.id), extractionIds: ids, instruction: (local.instr || '').trim(), unitLabel: u.label });
        local.instr = '';
        toast.info('Rewrite queued', `The VLR Editor is rewriting ${u.label} from ${ids.length} resource${ids.length === 1 ? '' : 's'}.`);
        ctx.rerender();
      },
      'goto-fn': (el, ev) => { ev.preventDefault(); const n = el.dataset.fn; const note = ctx.content.querySelector(`[data-fnote="${CSS.escape(n)}"]`); if (note) { scrollToEl(note, 160); note.classList.add('flash'); setTimeout(() => note.classList.remove('flash'), 1600); } },
      'download-docx': () => doDownload('docx'),
    });
    ctx.content.querySelector('#vlr-instr')?.addEventListener('input', (e) => { local.instr = e.target.value; });

    /* hovercard: full evidence preview when hovering a resource chip */
    const hideCard = () => document.getElementById('ch-hovercard')?.remove();
    const showCard = (pillEl) => {
      hideCard();
      const place = (card, r) => {
        document.body.appendChild(card);
        const w = card.offsetWidth, h = card.offsetHeight;
        let x = r.left - w - 10;
        if (x < 8) x = Math.min(window.innerWidth - w - 8, r.right + 10);
        card.style.left = `${x}px`;
        card.style.top = `${Math.max(8, Math.min(r.top + r.height / 2 - h / 2, window.innerHeight - h - 8))}px`;
      };
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
          <div class="hv-series">${items.map(e => `<div class="hv-yr"><b>${esc(e.year || '—')}</b><span class="mono">${esc(e.value)}${esc(u(e))}</span><span class="hv-yr-src">p. ${esc(e.source?.page ?? '—')}</span></div>`).join('')}</div>
          <div class="hv-src">${esc(f.source?.docName || 'Manual entry')}</div>`;
        place(card, pillEl.getBoundingClientRect());
        return;
      }
      const e = getExtraction(pillEl.dataset.id);
      if (!e) return;
      const PA = { indicators: 'Urban data · indicator', documentary: 'Documentary evidence', projects: 'Project', stakeholders: 'Stakeholder voice' };
      const fact = e.pillar === 'documentary' ? `${esc(e.categoryLabel || e.category || '')}`
        : e.pillar === 'projects' ? `${esc(e.projectStatus || '')}${e.period ? ` · ${esc(e.period)}` : ''}`
        : `${esc(e.group || '')}${e.category ? ` · ${esc(e.category)}` : ''}`;
      const card = document.createElement('div');
      card.id = 'ch-hovercard';
      card.innerHTML = `
        <div class="hv-top"><span class="ch-pillar p-${esc(e.pillar)}">${esc(PA[e.pillar] || e.pillar)}</span><span class="badge badge-sdg">SDG ${esc(e.sdg)}</span></div>
        <div class="hv-title">${esc(e.title)}</div>
        ${fact ? `<div class="hv-fact">${fact}</div>` : ''}
        ${e.summary ? `<div class="hv-sum">${esc(e.summary)}</div>` : ''}
        ${e.source?.quote ? `<div class="hv-quote">${esc(quotePlain(e.source.quote))}</div>` : ''}
        <div class="hv-src">${esc(e.source?.docName || 'Manual entry')}${e.source?.page != null ? ` · p. ${esc(e.source.page)} ¶${esc(e.source.paragraph || 1)}` : ''}</div>`;
      place(card, pillEl.getBoundingClientRect());
    };
    ctx.content.addEventListener('mouseover', (e) => { const p = e.target.closest('.ch-ctx-mini'); if (p) showCard(p); });
    ctx.content.addEventListener('mouseout', (e) => { const p = e.target.closest('.ch-ctx-mini'); if (p && !p.contains(e.relatedTarget)) hideCard(); });
    ctx.content.addEventListener('click', (e) => { if (e.target.closest('.ch-ctx-mini')) hideCard(); });

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

    return () => { unbindClick(); unbindTop(); window.removeEventListener('scroll', onScroll); document.getElementById('ch-hovercard')?.remove(); };
  },
};
