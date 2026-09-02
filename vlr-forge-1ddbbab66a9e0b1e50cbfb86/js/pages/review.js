/* Extraction Review page — #/review/:id (mock-up 03). Works for all four pillars. */
import { esc, icon, refreshIcons, fmtDateTime, relTime, initials, SDG_TITLES, statusBadge, bindActions, toast, promptDialog, confirmDialog, fileTypeIcon, capitalize } from '../ui.js';
import { getExtraction, getProject, getDoc, getComments, getProjectExtractions, getProjectTasks, currentUser } from '../store.js';
import { updateExtraction, approveExtraction, unapproveExtraction, rejectAndRerun, addComment, deleteComment } from '../actions.js';
import { openFeedbackModal, openTaskDrawer } from '../modals.js';
import { avatarButton } from '../shell.js';
import { navigate } from '../router.js';
import { STEP_META, PILLARS, quoteToHtml } from '../seed.js';

/* ---------- pillar metadata ---------- */
const PILLAR_TITLE = { indicators: 'Indicator', documentary: 'Documentary', projects: 'Projects', stakeholders: 'Stakeholder' };
const PILLAR_SINGULAR = { indicators: 'Indicator', documentary: 'Documentary', projects: 'Project', stakeholders: 'Stakeholder' };
const DOC_CATS = [['C1', 'Challenge'], ['C2', 'Commitment'], ['C3', 'Policy']];
const STK_CATS = ['Challenge', 'Priority', 'Recommendation', 'Correction'];
const PRJ_STATUS = ['Planned', 'In execution', 'Completed'];

function fieldsFor(e) {
  switch (e.pillar) {
    case 'documentary': return [
      { key: 'category', label: 'Category', options: DOC_CATS.map(([v, l]) => ({ value: v, label: `${v} — ${l}` })) },
      { key: 'title', label: 'Title', wide: true },
      { key: 'summary', label: 'Summary', wide: true, multiline: true },
    ];
    case 'projects': return [
      { key: 'title', label: 'Project name', wide: true },
      { key: 'projectStatus', label: 'Status', options: PRJ_STATUS.map(v => ({ value: v, label: v })) },
      { key: 'budget', label: 'Budget' },
      { key: 'period', label: 'Period' },
      { key: 'lead', label: 'Lead' },
    ];
    case 'stakeholders': return [
      { key: 'title', label: 'Insight', wide: true },
      { key: 'category', label: 'Category', options: STK_CATS.map(v => ({ value: v, label: v })) },
      { key: 'group', label: 'Stakeholder group' },
      { key: 'engagement', label: 'Engagement' },
    ];
    default: return [
      { key: 'title', label: 'Extraction name' },
      { key: 'value', label: 'Value' },
      { key: 'unit', label: 'Unit' },
    ];
  }
}

function displayValue(e, f, v) {
  if (v == null || v === '') return '—';
  if (e.pillar === 'documentary' && f.key === 'category') { const c = DOC_CATS.find(x => x[0] === v); return c ? `${c[0]} · ${c[1]}` : v; }
  return v;
}

function dirtyPatch(e, edits) {
  const patch = {};
  for (const [k, v] of Object.entries(edits || {})) { if (String(v ?? '') !== String(e[k] ?? '')) patch[k] = v; }
  if (patch.category && e.pillar === 'documentary') patch.categoryLabel = (DOC_CATS.find(x => x[0] === patch.category) || [])[1] || e.categoryLabel;
  return patch;
}

/* ---------- deterministic pseudo-random (seeded by project id) ---------- */
function prng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0; h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

/* ---------- procedurally generated greyscale city map ---------- */
function cityMapSvg(project, topic) {
  const W = 460, H = 170;
  const r = prng(project?.id || 'city');
  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#e6e8ec"/>`);
  // districts (irregular light polygons)
  for (let i = 0; i < 9; i++) {
    const cx = r() * W, cy = r() * H, pts = [];
    const n = 5 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; const rad = 28 + r() * 55; pts.push(`${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad * 0.7).toFixed(1)}`); }
    const shade = ['#dfe2e7', '#d6dae0', '#e9ebef', '#cfd4db'][Math.floor(r() * 4)];
    parts.push(`<polygon points="${pts.join(' ')}" fill="${shade}" stroke="#c4c9d1" stroke-width=".8"/>`);
  }
  // parks
  for (let i = 0; i < 5; i++) {
    const cx = r() * W, cy = r() * H, rx = 10 + r() * 22, ry = 8 + r() * 14;
    parts.push(`<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="#d3d8d2" stroke="#b9c0b8" stroke-width=".6"/>`);
  }
  // river
  const y0 = 30 + r() * 100;
  const river = `M-10,${y0.toFixed(1)} C${(W * 0.25).toFixed(1)},${(y0 - 50 + r() * 100).toFixed(1)} ${(W * 0.6).toFixed(1)},${(y0 + 60 - r() * 120).toFixed(1)} ${W + 10},${(30 + r() * 110).toFixed(1)}`;
  parts.push(`<path d="${river}" fill="none" stroke="#c5cbd4" stroke-width="9" stroke-linecap="round"/>`);
  parts.push(`<path d="${river}" fill="none" stroke="#d9dee5" stroke-width="5" stroke-linecap="round"/>`);
  // street grid (slightly rotated)
  const ang = (r() * 20 - 10) * Math.PI / 180;
  const lines = [];
  for (let x = -H; x < W + H; x += 18 + Math.floor(r() * 10)) lines.push(`M${x},-40 L${x + H * 1.6},${H + 40}`);
  for (let y = -60; y < H + 60; y += 16 + Math.floor(r() * 10)) lines.push(`M-40,${y} L${W + 40},${y}`);
  parts.push(`<g transform="rotate(${(ang * 180 / Math.PI).toFixed(2)} ${W / 2} ${H / 2})" stroke="#f4f5f7" stroke-width="1.2" fill="none"><path d="${lines.join(' ')}"/></g>`);
  // main arterials
  for (let i = 0; i < 4; i++) {
    const x1 = r() * W, y1 = r() * H, x2 = r() * W, y2 = r() * H;
    parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#fbfbfc" stroke-width="3"/>`);
  }
  // density blobs (dark grey "data")
  for (let i = 0; i < 4; i++) {
    const cx = 60 + r() * (W - 120), cy = 30 + r() * (H - 60);
    parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(10 + r() * 16).toFixed(1)}" fill="#7b8592" opacity=".32"/>`);
    parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(4 + r() * 6).toFixed(1)}" fill="#4b5563" opacity=".55"/>`);
  }
  // city label
  parts.push(`<g font-family="Inter, sans-serif" font-size="7" fill="#6b7280"><circle cx="12" cy="12" r="2" fill="#4b5563"/><text x="17" y="14.5">${esc(project?.city || 'City')}</text></g>`);
  // legend
  parts.push(`<g transform="translate(8 ${H - 44})" font-family="Inter, sans-serif">
    <rect width="132" height="38" rx="2" fill="#f7f8fa" stroke="#c4c9d1" stroke-width=".6" opacity=".95"/>
    <text x="6" y="10" font-size="5.5" font-weight="700" fill="#6b7280" letter-spacing=".6">DATA LEGEND:</text>
    <text x="6" y="18" font-size="6" font-weight="700" fill="#374151">${esc(String(topic || 'DATA DENSITY').toUpperCase())}</text>
    <circle cx="9" cy="26" r="2.4" fill="#7b8592" opacity=".5"/><text x="14" y="28" font-size="5.5" fill="#4b5563">Reported zones</text>
    <circle cx="9" cy="33" r="2.4" fill="#4b5563"/><text x="14" y="35" font-size="5.5" fill="#4b5563">High density (&gt;500/km²)</text>
  </g>`);
  return `<svg class="rv-map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Source context map">${parts.join('')}</svg>`;
}

/* ---------- trend bar chart ---------- */
function trendSvg(e) {
  const W = 460, H = 170, base = 148, top = 42;
  let trend = Array.isArray(e.trend) && e.trend.length ? e.trend.map(d => ({ ...d })) : null;
  // The latest bar is the reviewed value: keep it in sync with edits to VALUE (the seed trend ends at the extraction's year).
  if (trend && Number.isFinite(Number(e.value)) && String(e.value).trim() !== '' && (!e.year || String(trend[trend.length - 1].year) === String(e.year))) trend[trend.length - 1].value = Number(e.value);
  const data = trend || [{ year: '', value: 0.58 }, { year: '', value: 0.92 }, { year: '', value: 0.45 }];
  const max = Math.max(...data.map(d => Number(d.value) || 0)) || 1;
  const n = data.length, slot = W / n, bw = Math.min(34, slot * 0.32);
  const unitSuffix = /%/.test(e.unit || '') ? '%' : '';
  const bars = data.map((d, i) => {
    const h = Math.max(4, ((Number(d.value) || 0) / max) * (base - top));
    const x = slot * i + slot / 2 - bw / 2, y = base - h;
    const last = i === n - 1;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" fill="${trend ? (last ? '#1d5f9e' : '#c5c8ce') : '#d9dce2'}"/>
      ${trend && last ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 10).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#1d5f9e" font-family="Inter, sans-serif">${esc(String(d.value))}${unitSuffix}</text>` : ''}
      ${trend && d.year ? `<text x="${(x + bw / 2).toFixed(1)}" y="${base + 14}" text-anchor="middle" font-size="9.5" fill="#64748b" font-family="Inter, sans-serif">${esc(String(d.year))}</text>` : ''}`;
  }).join('');
  return `<svg class="rv-trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Trend comparison">
    <rect width="${W}" height="${H}" fill="#dfe8f7"/>
    <line x1="14" y1="${base}" x2="${W - 14}" y2="${base}" stroke="#b9c9dd" stroke-width="1"/>
    ${bars}
    ${trend ? '' : `<text x="${W / 2}" y="24" text-anchor="middle" font-size="11" fill="#64748b" font-family="Inter, sans-serif">No time series available</text>`}
  </svg>`;
}

/* ---------- lineage chain ---------- */
function lineageChips(e) {
  const doc = e.source?.docId ? getDoc(e.source.docId) : null;
  const reviewChip = { label: 'Review', sub: e.status === 'approved' ? `Approved by ${e.reviewedBy || '—'}` : e.status === 'rerun_queued' ? 'Rerun queued' : 'Pending review', icon: 'user-check', action: 'lineage-review', status: e.status === 'approved' ? 'success' : e.status === 'rerun_queued' ? 'queued' : 'running' };
  const chipHtml = (chips) => `<div class="rv-lineage">${chips.map((c, i) => `
    ${i ? `<span class="rv-lineage-arrow">${icon('chevron-right', 'icon-sm')}</span>` : ''}
    <button type="button" class="rv-chip status-${esc(c.status)}" data-action="${c.action || (c.task ? 'open-task' : 'lineage-none')}" ${c.task ? `data-task="${esc(c.task.id)}"` : ''} data-label="${esc(c.label)}" data-tip="${esc(c.task ? `Task ${c.task.id} · ${c.task.status}` : c.sub)}">
      ${icon(c.icon, 'icon-sm')}<span><span class="rv-chip-label">${esc(c.label)}</span><span class="rv-chip-sub mono">${esc(c.sub)}</span></span>
    </button>`).join('')}</div>`;
  // Manual entries never went through the pipeline: no parse/extract tasks belong to them.
  if (e.status === 'manual' || (e.addedBy && !doc)) {
    return chipHtml([
      { label: 'Manual entry', sub: e.addedBy ? `Added by ${e.addedBy}` : (doc?.code || 'No pipeline task'), icon: 'pencil', action: doc ? 'open-doc' : 'lineage-none', status: 'manual' },
      reviewChip,
    ]);
  }
  const tasks = getProjectTasks(e.projectId);
  const latest = (pred) => tasks.filter(pred).sort((a, b) => b.createdAt - a.createdAt)[0];
  const pillar = PILLARS.find(p => p.key === e.pillar);
  const step = pillar?.step || 'extract_indicators';
  const parse = doc ? latest(t => t.inputDocId === doc.id && (t.step === 'parse' || t.step === 'xml_extraction')) : null;
  const translate = doc && doc.language !== 'EN' ? latest(t => t.inputDocId === doc.id && t.step === 'translate') : null;
  const extract = latest(t => t.step === step && (!doc || t.inputDocId === doc.id || STEP_META[step].scope === 'project')) || latest(t => t.step === step);
  const analyse = e.pillar === 'indicators' ? latest(t => t.step === 'analyse') : null;
  const chips = [
    { label: 'Source document', sub: doc?.code || e.source?.docName || 'Manual entry', icon: 'file-text', action: doc ? 'open-doc' : 'lineage-none', task: null, status: doc ? doc.status : 'manual' },
    { label: `Parsed (${STEP_META[parse?.step || 'parse'].engine.split(' ')[0]})`, sub: parse ? parse.id : 'no task record', icon: 'braces', task: parse, status: parse?.status || (doc?.status === 'processed' ? 'success' : 'queued') },
    ...(doc && doc.language !== 'EN' ? [{ label: `Translated ${doc.language}→EN`, sub: translate ? translate.id : (doc.translated ? 'completed' : 'pending'), icon: 'languages', task: translate, status: translate?.status || (doc.translated ? 'success' : 'queued') }] : []),
    { label: `Extraction (${STEP_META[step].engine})`, sub: extract ? extract.id : 'no task record', icon: STEP_META[step].icon, task: extract, status: extract?.status || 'success' },
    ...(e.pillar === 'indicators' && (e.analysed || e.trend || analyse) ? [{ label: 'Analysis', sub: analyse ? analyse.id : STEP_META.analyse.engine, icon: 'trending-up', task: analyse, status: analyse?.status || 'success' }] : []),
    reviewChip,
  ];
  return chipHtml(chips);
}

/* ---------- comments ---------- */
const KIND_BADGE = { comment: ['neutral', 'Note'], 'mis-highlight': ['warning', 'Mis-highlight'], rejection: ['danger', 'Rejection'] };
function commentHtml(c, me) {
  const [cls, label] = KIND_BADGE[c.kind] || ['neutral', capitalize(c.kind)];
  return `<div class="rv-comment">
    <span class="avatar rv-comment-avatar">${esc(initials(c.author))}</span>
    <div class="grow">
      <div class="row wrap gap-6"><strong>${esc(c.author)}</strong><span class="badge badge-${cls}">${esc(label)}</span><span class="xs muted">${esc(relTime(c.createdAt))}</span>
        ${c.author === me ? `<button type="button" class="btn-icon danger rv-comment-del" data-action="delete-comment" data-id="${esc(c.id)}" data-tip="Delete note" aria-label="Delete note">${icon('trash-2', 'icon-sm')}</button>` : ''}</div>
      <div class="rv-comment-text">${esc(c.text)}</div>
    </div></div>`;
}

/* ---------- next unreviewed ---------- */
function nextUnreviewed(e) {
  const list = getProjectExtractions(e.projectId, e.pillar).filter(x => x.id !== e.id && ['extracted', 'manual'].includes(x.status));
  if (!list.length) return null;
  const all = getProjectExtractions(e.projectId, e.pillar);
  const idx = all.findIndex(x => x.id === e.id);
  return list.find(x => all.indexOf(x) > idx) || list[0];
}

export default {
  title: (ctx) => { const e = getExtraction(ctx.params.id); return e ? `${PILLAR_TITLE[e.pillar] || 'Extraction'} Extraction Review · SDG ${e.sdg}` : 'Extraction Review'; },

  render(ctx) {
    const e = getExtraction(ctx.params.id);
    const local = ctx.local;
    local.edits = local.edits || {};
    local.note = local.note ?? '';

    if (!e) {
      ctx.topbar.innerHTML = `<button class="btn-icon" data-action="back" aria-label="Back">${icon('arrow-left', 'icon-lg')}</button><div><div class="topbar-title">Extraction Review</div></div><span class="grow"></span>${avatarButton()}`;
      ctx.content.innerHTML = `<div class="card"><div class="empty">${icon('file-question')}<div class="empty-title">Extraction not found</div><div class="empty-sub">It may have been removed or replaced by a rerun.</div><a class="btn btn-primary mt-16" href="#/projects">Back to Projects</a></div></div>`;
      ctx.footer.innerHTML = '';
      return;
    }

    const project = getProject(e.projectId);
    const doc = e.source?.docId ? getDoc(e.source.docId) : null;
    const me = currentUser()?.name;
    const fields = fieldsFor(e);
    const patch = dirtyPatch(e, local.edits);
    const dirty = Object.keys(patch).length > 0;
    const pillar = PILLARS.find(p => p.key === e.pillar);
    const engine = STEP_META[pillar?.step || 'extract_indicators'].engine;
    const topic = e.topic || (e.categoryLabel ? e.categoryLabel : e.category) || SDG_TITLES[e.goal] || '';
    const subtitle = `SDG ${e.sdg}: ${topic || SDG_TITLES[e.goal] || ''}`;
    const comments = getComments(e.id);
    const conf = Math.max(0, Math.min(100, Number(e.confidence) || 0));
    const isApproved = e.status === 'approved';
    const isRerunQueued = e.status === 'rerun_queued';
    const pillLabel = e.status === 'extracted' ? `${PILLAR_SINGULAR[e.pillar] || 'Indicator'} Extracted` : undefined;
    const viewerHref = doc ? `#/projects/${esc(e.projectId)}/documents/${esc(doc.id)}?page=${Number(e.source.page) || 1}&hl=${esc(e.id)}` : null;

    /* ----- top bar ----- */
    ctx.topbar.innerHTML = `
      <button class="btn-icon rv-back" data-action="back" aria-label="Back">${icon('arrow-left', 'icon-lg')}</button>
      <div class="rv-heading">
        <div class="topbar-title">${esc(PILLAR_TITLE[e.pillar] || 'Indicator')} Extraction Review</div>
        <div class="topbar-subtitle">${esc(subtitle)}</div>
      </div>
      <span class="grow"></span>
      <button class="btn btn-secondary" id="rv-save" data-action="save" ${dirty ? '' : 'disabled'} data-tip="${dirty ? `Save ${Object.keys(patch).length} change(s)` : 'Edit a field to enable'}">Save Changes</button>
      <button class="btn btn-danger" data-action="reject" ${isRerunQueued ? 'disabled data-tip="A rerun is already queued for this extraction"' : ''}>${icon('rotate-ccw', 'icon-sm')}Reject &amp; Rerun</button>
      ${isApproved
        ? `<span class="badge badge-success badge-lg rv-approved-badge">${icon('check', 'icon-xs')}Approved ✓</span><button class="btn btn-light" data-action="unapprove">Unapprove</button>`
        : `<button class="btn btn-primary" data-action="approve" ${isRerunQueued ? 'disabled data-tip="Wait for the queued rerun to finish before approving"' : ''}>${icon('check-circle', 'icon-sm')}Approve</button>`}
      ${avatarButton()}`;

    /* ----- value boxes ----- */
    const boxes = fields.map(f => {
      const cur = local.edits[f.key] !== undefined ? local.edits[f.key] : (e[f.key] ?? '');
      const editing = local.editing === f.key;
      const changed = patch[f.key] !== undefined;
      const inputId = `rv-edit-${f.key}`;
      let inner;
      if (editing) {
        if (f.options) inner = `<select class="select rv-edit-select" id="${inputId}" data-field="${f.key}">${f.options.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(cur) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
        else if (f.multiline) inner = `<textarea class="rv-edit-area" id="${inputId}" data-field="${f.key}" rows="3">${esc(cur)}</textarea>`;
        else inner = `<input id="${inputId}" data-field="${f.key}" value="${esc(cur)}" autocomplete="off">`;
      } else {
        inner = `<div class="value">${esc(displayValue(e, f, cur))}</div>`;
      }
      return `<div class="value-box rv-box ${editing ? 'editing' : ''} ${changed ? 'changed' : ''} ${f.wide ? 'wide' : ''}" data-action="edit" data-field="${f.key}" data-tip="${editing ? '' : 'Click to edit'}">
        <div class="label">${esc(f.label)}${changed ? ' <span class="rv-changed-dot" title="Unsaved change"></span>' : ''}</div>${inner}
      </div>`;
    }).join('');

    const description = e.pillar === 'indicators' ? (e.indicator || `${e.status === 'manual' ? 'Manually recorded indicator' : 'Indicator'} for SDG target ${e.sdg}${SDG_TITLES[e.goal] ? ` (${SDG_TITLES[e.goal]})` : ''}.`) : e.pillar === 'documentary' ? `${e.categoryLabel || ''} stated in the city's documents · SDG target ${e.sdg} (${SDG_TITLES[e.goal] || ''})` : e.pillar === 'projects' ? (e.summary || `City initiative linked to SDG target ${e.sdg}.`) : `${e.category || 'Insight'} raised by ${e.group || 'stakeholders'} during ${e.engagement || 'engagement'} · SDG ${e.sdg}`;

    /* ----- content ----- */
    ctx.content.innerHTML = `
    <div class="rv-page">
      <section class="card rv-main">
        <div class="row-between rv-main-top">
          ${statusBadge(e.status, { label: pillLabel, cls: 'rv-pill' })}
          <div class="rv-conf">
            <div class="rv-conf-label">${icon(e.status === 'manual' ? 'pencil-line' : 'badge-check', 'icon-sm')}${e.status === 'manual' ? 'Manual entry · reviewer-provided' : `AI Confidence: ${conf}%`}</div>
            <div class="progress sm success rv-conf-bar"><span style="width:${conf}%"></span></div>
          </div>
        </div>
        <h2 class="rv-sdg">SDG ${esc(e.sdg)}</h2>
        <p class="rv-desc">${esc(description)}</p>
        <div class="rv-boxes rv-boxes-${fields.length}">${boxes}</div>
        ${dirty ? `<div class="rv-dirty-hint">${icon('pencil', 'icon-xs')}${Object.keys(patch).length} unsaved change(s) — press <strong>Save Changes</strong> to commit, <kbd>Esc</kbd> while editing to discard a field.</div>` : ''}
      </section>

      <h3 class="rv-section-title">${icon('workflow', 'icon-lg')}Data Lineage &amp; Evidence</h3>
      <section class="card rv-evidence">
        <div class="rv-doc-row">
          ${doc ? fileTypeIcon(doc.name) : e.source?.docId || (e.source?.docName && e.source.docName !== 'Manual entry') ? fileTypeIcon(e.source.docName) : icon('pencil', 'icon-sm')}
          ${doc ? `<a class="rv-doc-name" href="${viewerHref}">${esc(doc.name)}</a>` : `<span class="rv-doc-name">${esc(e.source?.docName || 'Manual entry')}</span>`}
          <span class="grow"></span>
          <span class="rv-doc-loc">Page ${Number(e.source?.page) || 1}, Paragraph ${Number(e.source?.paragraph) || 1}</span>
        </div>
        <div class="rv-quote-wrap">
          <div class="rv-quote-block">
          <blockquote class="rv-quote">${e.source?.quote ? `"${quoteToHtml(e.source.quote, esc)}"` : '<span class="muted">No verbatim quote recorded for this entry.</span>'}</blockquote>
          <div class="rv-quote-links">
            ${doc ? `<a class="rv-link" href="${viewerHref}">${icon('external-link', 'icon-sm')}View in Document Viewer</a>` : `<button type="button" class="rv-link" data-action="no-doc">${icon('external-link', 'icon-sm')}View in Document Viewer</button>`}
            <button type="button" class="rv-link muted-link" data-action="mis-highlight">${icon('flag', 'icon-sm')}Report Mis-highlight</button>
          </div>
          </div>
        </div>
        <div class="rv-lineage-wrap">
          <div class="caps rv-lineage-title">Traceability chain</div>
          ${lineageChips(e)}
        </div>
      </section>

      <div class="rv-grid-2">
        <section class="card rv-panel">
          <div class="rv-panel-head"><span>Source Context (Map)</span>${icon('map-pin', 'icon-sm')}</div>
          <div class="rv-panel-body">${cityMapSvg(project, topic)}</div>
        </section>
        <section class="card rv-panel">
          <div class="rv-panel-head"><span>Trend Comparison</span>${icon('trending-up', 'icon-sm')}</div>
          <div class="rv-panel-body trend">${trendSvg(e)}</div>
        </section>
      </div>

      <div class="rv-grid-notes">
        <section class="card rv-notes">
          <div class="card-header tinted"><div class="card-title-caps">${icon('message-square', 'icon-sm')}Reviewer notes &amp; feedback</div><span class="badge badge-neutral">${comments.length} ${comments.length === 1 ? 'entry' : 'entries'}</span></div>
          <div class="card-body">
            ${comments.length ? `<div class="rv-comments">${comments.map(c => commentHtml(c, me)).join('')}</div>` : `<div class="rv-comments-empty">${icon('message-square-dashed')}No notes yet. Feedback left here is fed back to the extraction agents on rerun.</div>`}
            <div class="rv-note-form">
              <textarea class="textarea" id="rv-note" placeholder="Add a reviewer note — e.g. value should be read from table 4, not the narrative.">${esc(local.note)}</textarea>
              <div class="row-between">
                <span class="xs muted">${icon('info', 'icon-xs')} Notes are stored with the extraction and fed back to the extraction agents on rerun.</span>
                <div class="row"><button type="button" class="btn btn-light btn-sm" data-action="mis-highlight">${icon('flag', 'icon-sm')}Report mis-highlight</button><button type="button" class="btn btn-primary btn-sm" data-action="add-note">${icon('send', 'icon-sm')}Add note</button></div>
              </div>
            </div>
          </div>
        </section>
        <section class="card rv-meta">
          <div class="card-header tinted"><div class="card-title-caps">${icon('info', 'icon-sm')}Extraction metadata</div></div>
          <div class="card-body">
            <dl class="kv rv-kv">
              <dt>Status</dt><dd>${statusBadge(e.status, { label: pillLabel })}</dd>
              <dt>Extracted</dt><dd class="mono">${esc(fmtDateTime(e.createdAt))}</dd>
              <dt>Engine</dt><dd>${esc(engine)}</dd>
              <dt>Confidence</dt><dd class="mono">${conf}%</dd>
              <dt>Reviewed by</dt><dd>${e.reviewedBy ? `${esc(e.reviewedBy)} <span class="xs muted">· ${esc(relTime(e.reviewedAt || e.updatedAt))}</span>` : '<span class="muted">Not yet reviewed</span>'}</dd>
              <dt>Edited by</dt><dd>${e.editedBy ? `${esc(e.editedBy)} <span class="xs muted">· ${esc(relTime(e.updatedAt))}</span>` : e.addedBy ? `${esc(e.addedBy)} <span class="xs muted">(manual entry)</span>` : '<span class="muted">Unedited</span>'}</dd>
              ${e.rejectedReason ? `<dt>Last rejection</dt><dd>${esc(e.rejectedReason)}</dd>` : ''}
              ${e.year ? `<dt>Reference year</dt><dd class="mono">${esc(String(e.year))}</dd>` : ''}
              <dt>Pillar</dt><dd>${icon(pillar?.icon || 'bar-chart-2', 'icon-xs')} ${esc(pillar?.label || e.pillar)}</dd>
              <dt>Project</dt><dd><a href="#/projects/${esc(e.projectId)}?tab=${esc(e.pillar)}">${esc(project?.name || e.projectId)}</a></dd>
              <dt>Source</dt><dd>${doc ? `<a href="${viewerHref}" class="mono">${esc(doc.code)}</a>` : '<span class="muted">—</span>'}</dd>
            </dl>
            <div class="rv-meta-actions">
              <a class="btn btn-light btn-sm btn-block" href="#/projects/${esc(e.projectId)}?tab=${esc(e.pillar)}">${icon('arrow-left', 'icon-sm')}Back to ${esc(pillar?.label || 'project')}</a>
              ${(() => { const n = nextUnreviewed(e); return n ? `<a class="btn btn-outline btn-sm btn-block" href="#/review/${esc(n.id)}" data-tip="SDG ${esc(n.sdg)} · ${esc(n.title)}">Next pending review${icon('arrow-right', 'icon-sm')}</a>` : ''; })()}
            </div>
          </div>
        </section>
      </div>
    </div>`;
    ctx.footer.innerHTML = '';

    /* ----- wire the active editor ----- */
    const editEl = local.editing ? ctx.content.querySelector(`#rv-edit-${local.editing}`) : null;
    if (editEl) {
      if (!local.focusedEditor || local.focusedEditor !== local.editing) { local.focusedEditor = local.editing; setTimeout(() => { editEl.focus(); if (editEl.select) editEl.select(); }, 0); }
      const commit = () => {
        local.edits[editEl.dataset.field] = editEl.value;
        // cheap live patch so "Save Changes" is clickable before the next full render
        const saveBtn = ctx.topbar.querySelector('#rv-save');
        if (saveBtn) saveBtn.disabled = !Object.keys(dirtyPatch(getExtraction(e.id) || e, local.edits)).length;
      };
      editEl.addEventListener('input', commit);
      editEl.addEventListener('change', () => { commit(); if (editEl.tagName === 'SELECT') { local.editing = null; local.focusedEditor = null; editEl.blur(); ctx.rerender(); } });
      editEl.addEventListener('blur', () => { commit(); if (editEl.isConnected && local.editing === editEl.dataset.field) { local.editing = null; local.focusedEditor = null; ctx.rerender(); } });
      editEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && editEl.tagName !== 'TEXTAREA') { ev.preventDefault(); commit(); local.editing = null; local.focusedEditor = null; ctx.rerender(); }
        if (ev.key === 'Escape') { ev.preventDefault(); delete local.edits[editEl.dataset.field]; local.editing = null; local.focusedEditor = null; ctx.rerender(); toast.info('Edit discarded'); }
      });
    } else { local.focusedEditor = null; }
    const noteEl = ctx.content.querySelector('#rv-note');
    noteEl?.addEventListener('input', () => { local.note = noteEl.value; });

    /* ----- actions ----- */
    const doSave = () => {
      const open = local.editing ? ctx.content.querySelector(`#rv-edit-${local.editing}`) : null;
      if (open) local.edits[open.dataset.field] = open.value;
      const p = dirtyPatch(getExtraction(e.id), local.edits);
      if (!Object.keys(p).length) { toast.info('Nothing to save'); return; }
      updateExtraction(e.id, p);
      local.edits = {}; local.editing = null;
      toast.success('Changes saved', `${Object.keys(p).filter(k => k !== 'categoryLabel').length} field(s) updated · SDG ${e.sdg}`);
    };
    const doApprove = () => {
      const cur = getExtraction(e.id);
      if (!cur || cur.status === 'rerun_queued' || local.approving) return; // guard: rerun in flight / double click
      local.approving = true;
      const p = dirtyPatch(cur, local.edits);
      if (Object.keys(p).length) { updateExtraction(e.id, p); local.edits = {}; }
      approveExtraction(e.id);
      const next = nextUnreviewed(e);
      toast.success('Approved', `SDG ${e.sdg} · ${e.title}${next ? ' — opening next pending review' : ''}`);
      navigate(next ? `#/review/${next.id}` : `#/projects/${e.projectId}?tab=${e.pillar}`);
      local.approving = false;
    };
    const doReject = async () => {
      if (local.rejecting || document.querySelector('.modal-backdrop')) return; // double-click guard: one dialog at a time
      if ((getExtraction(e.id) || e).status === 'rerun_queued') { toast.info('Rerun already queued', 'Wait for the extraction task to finish.'); return; }
      local.rejecting = true;
      let reason = null;
      try { reason = await promptDialog({ title: 'Reject & rerun', msg: `The extraction <strong>SDG ${esc(e.sdg)} · ${esc(e.title)}</strong> will be marked for rerun and a new <em>${esc(STEP_META[pillar?.step || 'extract_indicators'].label)}</em> task will be queued. Your reason is passed to the extraction agents.`, label: 'Reason for rejection', placeholder: 'e.g. Value refers to the metropolitan area, not the municipality.', confirmText: 'Reject & queue rerun', multiline: true }); }
      finally { local.rejecting = false; }
      if (reason === null) return;
      const task = rejectAndRerun(e.id, reason.trim());
      toast.warning('Rerun queued', `${task ? task.label : 'Extraction'} re-queued for ${doc?.name || 'all documents'}.`);
      navigate(`#/projects/${e.projectId}?tab=${e.pillar}`);
    };
    const handlers = {
      save: doSave,
      approve: doApprove,
      reject: doReject,
      unapprove: () => { unapproveExtraction(e.id); toast.info('Approval removed', `SDG ${e.sdg} is back in review.`); },
      edit: (el, ev) => {
        if (ev.target.closest('input, select, textarea')) return;
        const f = el.dataset.field;
        if (local.editing === f) return;
        local.editing = f; local.focusedEditor = null;
        ctx.rerender();
      },
      'mis-highlight': () => {
        const api = openFeedbackModal(e.id, { kind: 'mis-highlight' });
        if (api) api.onSubmit = (r) => { if (r?.rerun) { rejectAndRerun(e.id, r.text, { comment: false }); toast.warning('Rerun queued', 'The extraction will be recomputed with your feedback.'); } };
      },
      'add-note': () => {
        const text = (ctx.content.querySelector('#rv-note')?.value || '').trim();
        if (!text) { toast.error('Write a note first'); ctx.content.querySelector('#rv-note')?.focus(); return; }
        addComment(e.id, text, 'comment');
        local.note = '';
        toast.success('Note added', 'Visible to the pipeline on the next rerun.');
      },
      'delete-comment': async (el, ev) => {
        ev.stopPropagation();
        if (document.querySelector('.modal-backdrop')) return;
        if (await confirmDialog({ title: 'Delete note?', msg: 'This reviewer note will be removed permanently.', confirmText: 'Delete', danger: true, icon: 'trash-2' })) { deleteComment(el.dataset.id); toast.success('Note deleted'); }
      },
      'open-task': (el) => openTaskDrawer(el.dataset.task),
      'open-doc': () => { if (viewerHref) navigate(viewerHref); },
      'lineage-none': (el) => toast.info(el.dataset.label || 'Lineage stage', 'No task record is attached to this stage in the demo dataset.'),
      'lineage-review': () => { ctx.content.querySelector('#rv-note')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); ctx.content.querySelector('#rv-note')?.focus(); },
      'no-doc': () => toast.info('Manual entry', 'This entry has no linked source document.'),
    };
    const unbindContent = bindActions(ctx.content, handlers);
    const unbindTop = bindActions(ctx.topbar, handlers);

    const onKey = (ev) => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.key.toLowerCase() !== 's') return;
      if (document.querySelector('.modal, .drawer')) return;
      ev.preventDefault();
      const active = local.editing ? ctx.content.querySelector(`#rv-edit-${local.editing}`) : null;
      if (active) { local.edits[active.dataset.field] = active.value; local.editing = null; local.focusedEditor = null; }
      doSave();
    };
    document.addEventListener('keydown', onKey);
    refreshIcons(ctx.content);
    return () => { unbindContent(); unbindTop(); document.removeEventListener('keydown', onKey); };
  },
};
