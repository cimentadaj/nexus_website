/* Document viewer — #/projects/:id/documents/:docId?page=42&hl=<extractionId> */
import { esc, icon, refreshIcons, fmtDateTime, fmtBytes, relTime, statusBadge, progressHtml, bindActions, toast, download, fileTypeIcon, copyToClipboard, clamp } from '../ui.js';
import { getDoc, getProject, getExtraction, getProjectExtractions, getProjectTasks, getProjectDocs } from '../store.js';
import { translateDocument, startParse } from '../actions.js';
import { openDocumentDrawer, openTaskDrawer } from '../modals.js';
import { avatarButton } from '../shell.js';
import { navigate } from '../router.js';
import { STEP_META, PILLARS, quoteToHtml, quotePlain } from '../seed.js';

const ZOOMS = [90, 100, 120];

/* ---------- deterministic policy prose ---------- */
function prng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0; h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
const SUBJECTS = ['The municipal council', 'The city administration', 'The Department of Urban Planning', 'The Environment and Mobility Department', 'The housing agency', 'The metropolitan transport authority', 'The public health service', 'The statistics office', 'The participatory budgeting office', 'The water utility'];
const VERBS = ['has adopted', 'reports', 'commits to', 'confirms', 'has reviewed', 'is implementing', 'has prioritised', 'has allocated resources towards', 'monitors', 'has consolidated'];
const OBJECTS = ['a phased programme of energy retrofits across the public building stock', 'the extension of high-frequency bus corridors to the outer districts', 'a set of harmonised indicators aligned with the 2030 Agenda', 'the expansion of affordable rental housing on municipally owned land', 'district-level monitoring of air quality and noise', 'the renaturalisation of the riverbanks and the creation of new green corridors', 'a citizen consultation cycle involving neighbourhood associations and youth councils', 'targeted employment schemes for residents under 25', 'a low-emission zone covering the whole municipal territory', 'the digitisation of municipal services with accessible channels'];
const TAILS = ['in line with the Voluntary Local Review framework.', 'as set out in the strategic plan for the current term.', 'with annual reporting to the plenary of the council.', 'subject to the availability of European recovery funds.', 'following the recommendations of the 2022 evaluation.', 'in cooperation with the regional government.', 'with quantitative targets revised every two years.', 'and publishes disaggregated data on the open-data portal.', 'ensuring consistency with national SDG indicators.', 'with an explicit gender and age perspective.'];
const NUM_SENT = ['Between {y1} and {y2} the indicator moved from {a}% to {b}%, a change that the technical services attribute to the measures described above.', 'The budget allocated for this line amounts to €{m} million over the {y1}–{y2} period, of which {p}% has already been executed.', 'A total of {n} interventions were completed in {y2}, covering {p}% of the districts with the highest need.', 'Survey data collected in {y2} from {n} households indicate a satisfaction rate of {b}%, up from {a}% in {y1}.'];
const HEADINGS = ['Context and baseline', 'Policy framework', 'Progress on targets', 'Data sources and methodology', 'Territorial analysis', 'Stakeholder engagement', 'Financing and resources', 'Next steps and commitments', 'Monitoring arrangements', 'Alignment with the 2030 Agenda'];

function sentence(r, year) {
  if (r() < 0.3) {
    const y2 = year - Math.floor(r() * 2), y1 = y2 - 2 - Math.floor(r() * 3);
    const a = (5 + r() * 60).toFixed(1), b = (5 + r() * 60).toFixed(1);
    return NUM_SENT[Math.floor(r() * NUM_SENT.length)].replace('{y1}', y1).replace('{y2}', y2).replace('{a}', a).replace('{b}', b).replace('{m}', Math.round(5 + r() * 300)).replace('{p}', Math.round(20 + r() * 75)).replace('{n}', Math.round(10 + r() * 900));
  }
  return `${SUBJECTS[Math.floor(r() * SUBJECTS.length)]} ${VERBS[Math.floor(r() * VERBS.length)]} ${OBJECTS[Math.floor(r() * OBJECTS.length)]} ${TAILS[Math.floor(r() * TAILS.length)]}`;
}
/** Deterministic page content: { heading, paragraphs: [string] } — stable for docId+page. */
function pageText(doc, page, project) {
  const r = prng(`${doc.id}|${page}`);
  const year = project?.year || 2024;
  const section = `${1 + Math.floor((page - 1) / Math.max(1, Math.ceil(doc.pages / 8)))}.${1 + (page % 4)}`;
  const heading = `${section} ${HEADINGS[Math.floor(r() * HEADINGS.length)]}`;
  const nPar = 3 + Math.floor(r() * 3);
  const paragraphs = [];
  for (let i = 0; i < nPar; i++) {
    const nS = 2 + Math.floor(r() * 3);
    const s = [];
    for (let k = 0; k < nS; k++) s.push(sentence(r, year));
    paragraphs.push(s.join(' '));
  }
  return { heading, paragraphs };
}
function docTitle(doc) { return doc.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '); }

function markdownRendition(doc, project, exts) {
  const lines = [`# ${docTitle(doc)}`, '', `- Provenance code: ${doc.code}`, `- Type: ${doc.type} · Language: ${doc.language} · Pages: ${doc.pages} · Size: ${fmtBytes(doc.sizeKb)}`, `- Project: ${project?.name || doc.projectId}`, `- Status: ${doc.status}${doc.parsedAt ? ` · parsed ${fmtDateTime(doc.parsedAt)}` : ''}`, `- Rendition generated by VLR Forge on ${fmtDateTime(Date.now())}`, ''];
  for (let p = 1; p <= doc.pages; p++) {
    const t = pageText(doc, p, project);
    lines.push(`\n---\n\n## Page ${p} — ${t.heading}\n`);
    const onPage = exts.filter(e => Number(e.source?.page) === p);
    t.paragraphs.forEach((par, i) => { lines.push(par, ''); if (i === 1) onPage.forEach(e => lines.push(`> ${quotePlain(e.source.quote)}`, `> — extraction SDG ${e.sdg} · ${e.title} (paragraph ${e.source.paragraph})`, '')); });
  }
  return lines.join('\n');
}

export default {
  title: (ctx) => getDoc(ctx.params.docId)?.name || 'Document',

  render(ctx) {
    const doc = getDoc(ctx.params.docId);
    const local = ctx.local;

    if (!doc) {
      ctx.topbar.innerHTML = `<button class="btn-icon" data-action="back" aria-label="Back">${icon('arrow-left', 'icon-lg')}</button><div class="topbar-title">Document</div><span class="grow"></span>${avatarButton()}`;
      ctx.content.innerHTML = `<div class="card"><div class="empty">${icon('file-x')}<div class="empty-title">Document not found</div><div class="empty-sub">It may have been deleted from the project.</div><a class="btn btn-primary mt-16" href="#/projects/${esc(ctx.params.id)}">Back to project</a></div></div>`;
      ctx.footer.innerHTML = '';
      return;
    }

    const project = getProject(doc.projectId);
    const exts = getProjectExtractions(doc.projectId).filter(e => e.source?.docId === doc.id).sort((a, b) => (a.source.page - b.source.page) || (a.source.paragraph - b.source.paragraph));
    // tasks that touched this document: direct (parse/translate/…) plus project-wide steps that scan the whole document pool
    const tasks = getProjectTasks(doc.projectId).filter(t => t.inputDocId === doc.id || (!t.inputDocId && STEP_META[t.step]?.scope === 'project' && !['export', 'report'].includes(t.step) && t.createdAt >= (doc.uploadedAt || 0))).sort((a, b) => b.createdAt - a.createdAt);
    const siblings = getProjectDocs(doc.projectId);

    /* ----- apply query → local (once per distinct query) ----- */
    const qKey = `${ctx.query.page || ''}|${ctx.query.hl || ''}`;
    if (local.appliedQuery !== qKey) {
      local.appliedQuery = qKey;
      const hlExt = ctx.query.hl ? getExtraction(ctx.query.hl) : null;
      local.hl = hlExt && hlExt.source?.docId === doc.id ? hlExt.id : null;
      local.page = clamp(Number(ctx.query.page) || (hlExt?.source?.page) || 1, 1, doc.pages);
      local.scrolledTo = null;
    }
    local.page = clamp(Number(local.page) || 1, 1, doc.pages);
    local.zoom = ZOOMS.includes(local.zoom) ? local.zoom : 100;
    local.jump = local.jump ?? '';
    const page = local.page;
    const hlExt = local.hl ? getExtraction(local.hl) : null;
    const onPage = exts.filter(e => Number(e.source?.page) === page);
    const text = pageText(doc, page, project);
    // a task can be queued/running before the document status flips — treat that as "in progress" so buttons can't double-queue
    const pending = (steps) => tasks.some(t => t.inputDocId === doc.id && steps.includes(t.step) && (t.status === 'queued' || t.status === 'running'));
    const translating = doc.status === 'translating' || pending(['translate']);
    const parsing = doc.status === 'parsing' || pending(['parse', 'xml_extraction']);
    const canTranslate = doc.language !== 'EN' && !doc.translated && !translating;

    /* ----- top bar ----- */
    ctx.topbar.innerHTML = `
      <button class="btn-icon dv-back" data-action="back" aria-label="Back">${icon('arrow-left', 'icon-lg')}</button>
      <div class="dv-heading">
        <div class="row gap-6">${fileTypeIcon(doc.name)}<span class="topbar-title dv-title" title="${esc(doc.name)}">${esc(doc.name)}</span></div>
        <div class="topbar-subtitle">${esc(doc.code)} · ${esc(doc.type)} · ${esc(doc.language)}${doc.translated && doc.language !== 'EN' ? ` → ${esc(doc.translatedTo || 'EN')}` : ''}</div>
      </div>
      <span class="grow"></span>
      ${doc.language !== 'EN' ? `<button class="btn btn-light" data-action="translate" ${canTranslate ? '' : 'disabled'} data-tip="${canTranslate ? `Translate ${esc(doc.language)} → EN (Gemini)` : translating ? 'Translation in progress' : 'Already translated to EN'}">${icon('languages', 'icon-sm')}Translate</button>` : ''}
      <button class="btn btn-light" data-action="download" data-tip="Download a Markdown rendition of the parsed text">${icon('download', 'icon-sm')}Download</button>
      <button class="btn btn-soft" data-action="details">${icon('info', 'icon-sm')}Details</button>
      ${avatarButton()}`;

    /* ----- page canvas ----- */
    const hlPara = hlExt && Number(hlExt.source.page) === page ? hlExt : null;
    const paragraphs = text.paragraphs.map((p, i) => {
      const before = i === 1 ? onPage.map(e => `<p class="dv-para dv-extract ${hlPara && e.id === hlPara.id ? 'dv-hl-active' : ''}" id="dv-ext-${esc(e.id)}" data-action="focus-ext" data-id="${esc(e.id)}" data-tip="Extraction SDG ${esc(e.sdg)} · ${esc(e.title)} — click to open review">${quoteToHtml(e.source.quote, esc)}<span class="dv-ext-tag">${icon('link', 'icon-xs')}SDG ${esc(e.sdg)} · ¶${Number(e.source.paragraph) || 1}</span></p>`).join('') : '';
      return `${before}<p class="dv-para">${esc(p)}</p>`;
    }).join('');

    ctx.content.innerHTML = `
    <div class="dv-layout">
      <div class="dv-main">
        <div class="card dv-toolbar">
          <div class="row gap-6">
            <button class="btn btn-light btn-sm dv-nav" data-action="first" ${page <= 1 ? 'disabled' : ''} data-tip="First page">${icon('chevrons-left', 'icon-sm')}</button>
            <button class="btn btn-light btn-sm dv-nav" data-action="prev" ${page <= 1 ? 'disabled' : ''} data-tip="Previous page (←)">${icon('chevron-left', 'icon-sm')}</button>
            <span class="dv-pageno">Page <strong>${page}</strong> / ${doc.pages}</span>
            <button class="btn btn-light btn-sm dv-nav" data-action="next" ${page >= doc.pages ? 'disabled' : ''} data-tip="Next page (→)">${icon('chevron-right', 'icon-sm')}</button>
            <button class="btn btn-light btn-sm dv-nav" data-action="last" ${page >= doc.pages ? 'disabled' : ''} data-tip="Last page">${icon('chevrons-right', 'icon-sm')}</button>
          </div>
          <div class="row gap-6 dv-jump">
            <label class="xs muted" for="dv-jump">Go to</label>
            <input class="input dv-jump-input" id="dv-jump" type="number" min="1" max="${doc.pages}" placeholder="${page}" value="${esc(local.jump)}">
            <button class="btn btn-light btn-sm" data-action="jump">Go</button>
          </div>
          <span class="grow"></span>
          <div class="row gap-6">
            ${hlExt ? `<span class="badge badge-sky dv-hl-badge" data-action="focus-ext" data-id="${esc(hlExt.id)}" data-tip="Jump to highlighted evidence">${icon('highlighter', 'icon-xs')}SDG ${esc(hlExt.sdg)} · p.${Number(hlExt.source.page)}</span><button class="btn-icon" data-action="clear-hl" data-tip="Clear highlight" aria-label="Clear highlight">${icon('x', 'icon-sm')}</button>` : ''}
            <label class="xs muted" for="dv-zoom">Zoom</label>
            <select class="select select-sm" id="dv-zoom">${ZOOMS.map(z => `<option value="${z}" ${z === local.zoom ? 'selected' : ''}>${z}%</option>`).join('')}</select>
          </div>
        </div>

        <div class="dv-canvas-wrap">
          <article class="dv-sheet" style="--dv-scale:${(local.zoom / 100).toFixed(2)}" id="dv-sheet">
            <header class="dv-sheet-head"><span>${esc(docTitle(doc))} — page ${page}</span><span class="mono">${esc(doc.code)}</span></header>
            ${doc.status === 'uploaded' && !parsing ? `<div class="dv-notice">${icon('clock')}<div><strong>Not parsed yet.</strong> Text below is a preview rendition; run the parser to extract the real page content.</div><button class="btn btn-outline btn-sm" data-action="parse">${icon('play', 'icon-sm')}Start parse</button></div>` : ''}
            ${doc.status === 'uploaded' && parsing ? `<div class="dv-notice">${icon('clock')}<div class="grow"><strong>Parse queued.</strong> The parser will pick this document up shortly; text below is a preview rendition.</div></div>` : ''}
            ${doc.status === 'parsing' ? `<div class="dv-notice">${icon('loader-2', 'spin')}<div class="grow"><strong>Parsing in progress</strong> — ${doc.progress || 0}% ${progressHtml(doc.progress || 0, 'sky striped sm')}</div></div>` : ''}
            <h2 class="dv-heading-text">${esc(text.heading)}</h2>
            ${paragraphs}
            <footer class="dv-sheet-foot"><span>${esc(project?.jurisdiction || project?.name || '')}</span><span>${page} / ${doc.pages}</span></footer>
          </article>
        </div>
      </div>

      <aside class="dv-side">
        <section class="card">
          <div class="card-header tinted"><div class="card-title-caps">${icon('sparkles', 'icon-sm')}Extractions on this document</div><span class="badge badge-neutral">${exts.length}</span></div>
          <div class="dv-ext-list">
            ${exts.length ? exts.map(e => {
              const pl = PILLARS.find(p => p.key === e.pillar);
              return `<div class="dv-ext-item ${Number(e.source.page) === page ? 'on-page' : ''} ${hlExt?.id === e.id ? 'active' : ''}" data-action="goto" data-page="${Number(e.source.page) || 1}" data-hl="${esc(e.id)}">
                <div class="row gap-6"><span class="badge badge-sdg">SDG ${esc(e.sdg)}</span>${icon(pl?.icon || 'bar-chart-2', 'icon-xs')}<span class="grow"></span>${e.status === 'approved' ? icon('check-circle-2', 'icon-xs success-text') : e.status === 'rerun_queued' ? icon('rotate-ccw', 'icon-xs warning-text') : ''}</div>
                <div class="dv-ext-title">${esc(e.title)}</div>
                <div class="row-between"><span class="xs muted">${e.value != null && e.value !== '' ? `Val: ${esc(e.value)}${/%/.test(e.unit || '') ? '%' : ''}` : esc(e.categoryLabel || e.category || e.projectStatus || e.group || '')}</span><button type="button" class="dv-page-link" data-action="goto" data-page="${Number(e.source.page) || 1}" data-hl="${esc(e.id)}">p.${Number(e.source.page) || 1}</button></div>
                <a class="dv-ext-review" href="#/review/${esc(e.id)}" data-tip="Open review">${icon('arrow-up-right', 'icon-xs')}Review</a>
              </div>`; }).join('') : `<div class="empty" style="padding:22px"><div class="empty-title">No extractions yet</div><div class="empty-sub">Run the pipeline to extract evidence from this document.</div></div>`}
          </div>
        </section>

        <section class="card">
          <div class="card-header tinted"><div class="card-title-caps">${icon('file-text', 'icon-sm')}Metadata</div>${statusBadge(doc.status)}</div>
          <div class="card-body">
            <dl class="kv dv-kv">
              <dt>Provenance</dt><dd class="mono"><span>${esc(doc.code)}</span><button type="button" class="btn-icon" data-action="copy-code" data-tip="Copy code" aria-label="Copy provenance code">${icon('copy', 'icon-xs')}</button></dd>
              <dt>Type</dt><dd>${esc(doc.type)}</dd>
              <dt>Language</dt><dd><span class="badge badge-lang">${esc(doc.language)}</span>${doc.language !== 'EN' ? `<span class="xs muted">${doc.translated ? '· translated to EN' : translating ? '· translating to EN…' : '· translation pending'}</span>` : ''}</dd>
              <dt>Pages</dt><dd class="mono">${doc.pages}</dd>
              <dt>Size</dt><dd class="mono">${esc(fmtBytes(doc.sizeKb))}</dd>
              <dt>Uploaded</dt><dd class="mono">${esc(fmtDateTime(doc.uploadedAt))}</dd>
              <dt>Uploaded by</dt><dd>${esc(doc.uploadedBy || 'Pipeline import')}</dd>
              <dt>Parsed</dt><dd class="mono">${doc.parsedAt ? esc(fmtDateTime(doc.parsedAt)) : '<span class="muted">—</span>'}</dd>
              <dt>Project</dt><dd><a href="#/projects/${esc(doc.projectId)}">${esc(project?.name || doc.projectId)}</a></dd>
            </dl>
          </div>
        </section>

        <section class="card">
          <div class="card-header tinted"><div class="card-title-caps">${icon('history', 'icon-sm')}Processing history</div><span class="badge badge-neutral">${tasks.length}</span></div>
          <div class="dv-task-list">
            ${tasks.length ? tasks.slice(0, 8).map(t => `<button type="button" class="dv-task" data-action="open-task" data-task="${esc(t.id)}">
                <span class="row gap-6">${icon(STEP_META[t.step]?.icon || 'cpu', 'icon-sm')}<span><span class="dv-task-label">${esc(t.label)}</span><span class="xs muted">${esc(relTime(t.createdAt))}${t.status === 'running' ? ` · ${t.progress}%` : ''}${t.inputDocId ? '' : ' · whole document pool'}</span></span></span>
                ${statusBadge(t.status)}
              </button>`).join('') : `<div class="xs muted" style="padding:14px 20px">No tasks have processed this document yet.</div>`}
            ${tasks.length > 8 ? `<div class="xs muted" style="padding:8px 20px">+${tasks.length - 8} older tasks in the project History.</div>` : ''}
          </div>
        </section>

        ${siblings.length > 1 ? `<section class="card">
          <div class="card-header tinted"><div class="card-title-caps">${icon('folder-open', 'icon-sm')}Other documents</div></div>
          <div class="dv-sibling-list">${siblings.filter(d => d.id !== doc.id).slice(0, 6).map(d => `<a class="dv-sibling" href="#/projects/${esc(d.projectId)}/documents/${esc(d.id)}">${fileTypeIcon(d.name)}<span class="truncate">${esc(d.name)}</span><span class="xs muted">${d.pages}p</span></a>`).join('')}</div>
        </section>` : ''}
      </aside>
    </div>`;
    ctx.footer.innerHTML = '';

    /* ----- scroll to highlight once per (page, hl) ----- */
    if (hlPara) {
      const key = `${page}|${hlPara.id}`;
      if (local.scrolledTo !== key) {
        local.scrolledTo = key;
        setTimeout(() => ctx.content.querySelector(`#dv-ext-${CSS.escape(hlPara.id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
      }
    }

    /* ----- inputs ----- */
    const jumpEl = ctx.content.querySelector('#dv-jump');
    const goto = (p, hl) => { local.page = clamp(Number(p) || 1, 1, doc.pages); if (hl !== undefined) local.hl = hl; local.jump = ''; ctx.rerender(); };
    jumpEl.addEventListener('input', () => { local.jump = jumpEl.value; });
    jumpEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); handlers.jump(); } });
    ctx.content.querySelector('#dv-zoom').addEventListener('change', (ev) => { local.zoom = Number(ev.target.value); ctx.rerender(); });

    const handlers = {
      first: () => goto(1), prev: () => goto(page - 1), next: () => goto(page + 1), last: () => goto(doc.pages),
      jump: () => {
        const v = Math.trunc(Number(jumpEl.value));
        if (!jumpEl.value.trim() || Number.isNaN(v)) { jumpEl.focus(); return; }
        const target = clamp(v, 1, doc.pages);
        if (target !== v) toast.warning('Page out of range', `This document has ${doc.pages} pages — showing page ${target}.`);
        goto(target);
      },
      goto: (el, ev) => { if (ev.target.closest('a')) return; ev.stopPropagation(); local.scrolledTo = null; goto(el.dataset.page, el.dataset.hl); },
      'clear-hl': () => { local.hl = null; ctx.rerender(); },
      'focus-ext': (el, ev) => {
        if (ev.target.closest('a')) return;
        const e = getExtraction(el.dataset.id);
        if (!e) return;
        if (el.classList.contains('dv-hl-badge')) { local.scrolledTo = null; goto(e.source.page, e.id); return; }
        navigate(`#/review/${e.id}`);
      },
      translate: () => { if (!canTranslate) return; translateDocument(doc.id); toast.info('Translation queued', `${doc.name} (${doc.language} → EN)`); },
      parse: () => { if (parsing) return; startParse(doc.id); toast.info('Parsing queued', doc.name); },
      download: () => { const md = markdownRendition(doc, project, exts); download(doc.name.replace(/\.[a-z0-9]+$/i, '') + '.md', md, 'text/markdown'); toast.success('Download started', `${docTitle(doc)} · Markdown rendition (${doc.pages} pages)`); },
      details: () => openDocumentDrawer(doc.id),
      'open-task': (el) => openTaskDrawer(el.dataset.task),
      'copy-code': () => { copyToClipboard(doc.code); toast.success('Copied', doc.code); },
    };
    const unbindContent = bindActions(ctx.content, handlers);
    const unbindTop = bindActions(ctx.topbar, handlers);

    const onKey = (ev) => {
      if (ev.target?.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('.modal, .modal-backdrop, .drawer, .menu')) return;
      if (ev.key === 'ArrowLeft' && page > 1) { ev.preventDefault(); goto(page - 1); }
      else if (ev.key === 'ArrowRight' && page < doc.pages) { ev.preventDefault(); goto(page + 1); }
    };
    document.addEventListener('keydown', onKey);
    refreshIcons(ctx.content);
    return () => { unbindContent(); unbindTop(); document.removeEventListener('keydown', onKey); };
  },
};
