/* modals.js — shared modals & drawers: New VLR wizard, Upload Documents, New Report, Configure Project,
 * Add manual extraction, Task detail drawer, Document details drawer, Feedback dialog. */
import { icon, esc, openModal, openDrawer, confirmDialog, toast, refreshIcons, sdgChip, SDG_TITLES, SDG_COLORS, fileTypeIcon, docTypeFromName, fileExt, fmtBytes, fmtCost, fmtDateTime, fmtDuration, fmtTime, statusBadge, progressHtml, download, relTime, dateTimeCell, sum } from './ui.js';
import { getState, getProject, getProjectDocs, getDoc, getTask, getProjectTasks, getExtraction, projectStats, getProjectExtractions } from './store.js';
import { createProject, addDocuments, startParse, generateReport, updateProject, activateProject, archiveProject, unarchiveProject, deleteProject, addManualExtraction, retryTask, cancelTask, translateDocument, deleteDocument, addComment } from './actions.js';
import { navigate } from './router.js';
import { STEP_META, LANGS, PILLARS } from './seed.js';
import { REGION_OPTIONS } from './composer.js';
import { subscribe } from './store.js';
import { reportContentFor } from './export.js';

const SAMPLE_FILES = ['Sustainability_Strategy_2030.pdf', 'Municipal_Indicators_Dashboard.xlsx', 'Citizen_Consultation_Minutes.docx', 'Climate_Action_Plan.pdf', 'Annual_Budget_Report.xlsx', 'Housing_Policy_Framework.pdf'];

const YEARS = [2022, 2023, 2024, 2025, 2026, 2027];

/* =========================================================================
 * Dropzone helper (real <input type=file>, drag & drop, sample docs)
 * ======================================================================= */
function dropzoneHtml(id, { sample = true } = {}) {
  return `
  <div class="dropzone" id="${id}-zone" tabindex="0" role="button">
    ${icon('upload-cloud')}
    <div><strong class="navy">Drag & drop documents here</strong> or <span class="link-text">browse files</span></div>
    <div class="xs muted mt-8">PDF, DOCX, XLSX, CSV, XML, MD · up to 250 MB per file · any language</div>
    <input type="file" id="${id}-input" multiple accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.xml,.json,.yaml,.yml,.md,.txt,.pptx" class="hidden">
  </div>
  ${sample ? `<div class="row-between"><span class="xs muted">No documents at hand?</span><button type="button" class="btn btn-light btn-sm" id="${id}-sample">${icon('sparkles')}Add sample documents</button></div>` : ''}
  <div class="file-list" id="${id}-list"></div>`;
}
function bindDropzone(el, id, files, { defaultLang = 'EN', onChange, existingNames = new Set() } = {}) {
  const zone = el.querySelector(`#${id}-zone`), input = el.querySelector(`#${id}-input`), list = el.querySelector(`#${id}-list`);
  const addFiles = (fl) => {
    for (const f of fl) {
      if (files.some(x => x.name === f.name)) continue;
      const ext = fileExt(f.name);
      const sizeKb = f.size ? Math.round(f.size / 1024) : (ext === 'pdf' ? 4200 + files.length * 810 : 320 + files.length * 90);
      const pages = ext === 'pdf' ? Math.max(6, Math.round(sizeKb / 180)) : ext === 'docx' ? Math.max(3, Math.round(sizeKb / 40)) : ['xlsx', 'csv'].includes(ext) ? Math.max(1, Math.round(sizeKb / 60)) : 12;
      files.push({ name: f.name, size: sizeKb * 1024, pages: Math.min(pages, 600), type: docTypeFromName(f.name), language: f.language || '' });
    }
    renderList();
  };
  const renderList = () => {
    list.innerHTML = files.map((f, i) => `
      <div class="file-row">
        ${fileTypeIcon(f.name)}
        <div class="grow"><div class="name">${esc(f.name)}</div><div class="meta">${fmtBytes(f.size / 1024)} · ~${f.pages} pages</div></div>
        <select class="select select-sm ${f.language ? '' : 'lang-missing'}" data-i="${i}" data-field="language" data-tip="Document language"><option value="" disabled ${f.language ? '' : 'selected'}>Lang…</option>${LANGS.map(l => `<option ${l === f.language ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button type="button" class="btn-icon danger" data-remove="${i}" aria-label="Remove">${icon('x', 'icon-sm')}</button>
      </div>`).join('');
    refreshIcons(list);
    list.querySelectorAll('select').forEach(s => s.addEventListener('change', () => { files[Number(s.dataset.i)][s.dataset.field] = s.value; if (s.dataset.field === 'language') s.classList.toggle('lang-missing', !s.value); onChange?.(); }));
    list.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => { files.splice(Number(b.dataset.remove), 1); renderList(); }));
    onChange?.();
  };
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { addFiles([...input.files]); input.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', (e) => addFiles([...(e.dataTransfer?.files || [])]));
  el.querySelector(`#${id}-sample`)?.addEventListener('click', () => {
    const taken = new Set([...existingNames, ...files.map(f => f.name)]);
    const picks = [];
    let round = 0;
    while (picks.length < 4 && round < 20) {
      for (const base of SAMPLE_FILES) {
        const name = round === 0 ? base : base.replace(/(\.[a-z]+)$/, `_v${round + 1}$1`);
        if (!taken.has(name) && picks.length < 4) { picks.push({ name, size: 0 }); taken.add(name); }
      }
      round++;
    }
    addFiles(picks);
  });
  renderList();
  return { addFiles, renderList };
}

/* =========================================================================
 * New VLR project wizard
 * ======================================================================= */
export function openNewProjectModal({ initialCity = '' } = {}) {
  const data = { name: '', city: initialCity, country: '', jurisdiction: '', year: new Date().getFullYear(), languages: ['EN'], sdgs: [], description: '', population: '', geography: '', region: '', files: [] };
  let step = 1;
  const steps = ['Project details', 'Target SDGs', 'Source documents', 'Review & launch'];
  const api = openModal({ title: 'Initialize New VLR', sub: 'Create a new data governance project for your local jurisdiction.', size: 'lg', body: '', footer: '', backdropClose: false });

  const stepperHtml = () => `<div class="stepper">${steps.map((s, i) => `<div class="step ${i + 1 === step ? 'active' : ''} ${i + 1 < step ? 'done' : ''}"><span class="step-num">${i + 1 < step ? '✓' : i + 1}</span><span>${s}</span></div>${i < steps.length - 1 ? `<div class="step-line ${i + 1 < step ? 'done' : ''}"></div>` : ''}`).join('')}</div>`;

  function render() {
    let body = stepperHtml();
    if (step === 1) body += `
      <div class="form-grid">
        <div class="field"><label class="label">City <span class="req">*</span></label><input class="input" id="np-city" placeholder="e.g. Dahab" value="${esc(data.city)}" autofocus><div class="hint">Official city or municipality name — used across the review and the final book.</div></div>
        <div class="field"><label class="label">Country <span class="req">*</span></label><input class="input" id="np-country" placeholder="e.g. Egypt" value="${esc(data.country)}"><div class="hint">Selects the national sources (Voluntary National Review) cited in the chapters.</div></div>
        <div class="field"><label class="label">Jurisdiction / reporting entity</label><input class="input" id="np-jur" placeholder="e.g. Dahab City Council" value="${esc(data.jurisdiction)}"><div class="hint">The entity that signs the review — appears on the cover and in citations.</div></div>
        <div class="field"><label class="label">Region<span class="req">*</span></label><select class="select" id="np-region"><option value="" disabled ${data.region ? '' : 'selected'}>Select region…</option>${REGION_OPTIONS.map(r => `<option value="${esc(r.value)}" ${data.region === r.value ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select><div class="hint">Regional SDG report family used for the regional context and figures in every chapter.</div></div>
        <div class="field"><label class="label">Population</label><input class="input" id="np-population" placeholder="e.g. 15,000" value="${esc(data.population)}"><div class="hint">Kept as reported locally (text is fine) — quoted in the city profile, never recalculated.</div></div>
        <div class="field"><label class="label">Reporting year</label><select class="select" id="np-year">${YEARS.map(y => `<option ${y === Number(data.year) ? 'selected' : ''}>${y}</option>`).join('')}</select><div class="hint">The VLR cycle this review covers (also the book's cover year).</div></div>
        <div class="field span-2"><label class="label">Description</label><textarea class="textarea" id="np-desc" placeholder="Anything else the writers should know — scope, partners, priorities, special context…" style="min-height:70px">${esc(data.description)}</textarea><div class="hint">Free text carried into the book's introduction; everything not covered by the fields above.</div></div>
      </div>`;
    if (step === 2) body += `
      <div class="row-between"><div><strong class="navy">Select the SDGs this review will report on</strong><div class="hint">${data.sdgs.length} of 17 selected · all four pillars will be extracted for each selected goal.</div></div><div class="row"><button type="button" class="btn btn-light btn-sm" id="np-sdg-all">Select all</button><button type="button" class="btn btn-light btn-sm" id="np-sdg-none">Clear</button></div></div>
      <div class="sdg-grid">${Object.keys(SDG_TITLES).map(n => `<button type="button" class="sdg-tile ${data.sdgs.includes(Number(n)) ? 'on' : ''}" data-sdg="${n}">${sdgChip(Number(n), { title: false })}<span class="t">${esc(SDG_TITLES[n])}</span></button>`).join('')}</div>`;
    if (step === 3) body += `
      <div><strong class="navy">Upload the city's source documents</strong><div class="hint">All documents are dropped in one pool. The pillar extractors scan every document — a single report can feed Indicators, Documentary, Projects and Stakeholders at once.</div></div>
      ${dropzoneHtml('np')}`;
    if (step === 4) {
      body += `
      <div class="summary-grid">
        <div><div class="k">Project</div><div class="v">${esc(data.name || `${data.city} ${data.year} VLR`)}</div></div>
        <div><div class="k">Jurisdiction</div><div class="v">${esc(data.jurisdiction || `${data.city} City Council`)}</div></div>
        <div><div class="k">Location</div><div class="v">${esc(data.city)}, ${esc(data.country)}</div></div>
        <div><div class="k">Reporting year</div><div class="v">${data.year}</div></div>
        <div><div class="k">Region</div><div class="v">${esc((REGION_OPTIONS.find(r => r.value === data.region) || {}).label || '—')}</div></div>
        <div><div class="k">Population</div><div class="v">${esc(data.population || '—')}</div></div>

        <div><div class="k">Processing node</div><div class="v mono">${esc(getState().settings.org.region || 'EU-WEST-1')}</div></div>
        <div class="span-2" style="grid-column:span 2"><div class="k">Target SDGs (${data.sdgs.length})</div><div class="v"><div class="sdg-chips">${data.sdgs.map(n => sdgChip(n)).join('') || '<span class="muted">None selected — you can configure them later.</span>'}</div></div></div>
        <div style="grid-column:span 2"><div class="k">Source documents (${data.files.length})</div><div class="v">${data.files.length ? data.files.map(f => `<span class="badge badge-neutral badge-mono" style="margin:2px 4px 2px 0">${esc(f.name)}</span>`).join('') : '<span class="muted">None yet — the project will be created in Provisioning state.</span>'}</div></div>
      </div>
`;
    }
    api.setBody(body);
    api.setFooter(`
      ${step > 1 ? `<button class="btn btn-light left" id="np-back">${icon('arrow-left', 'icon-sm')}Back</button>` : '<span class="left"></span>'}
      <button class="btn btn-ghost" id="np-cancel">Cancel</button>
      ${step < 4 ? `<button class="btn btn-primary" id="np-next">Continue${icon('arrow-right', 'icon-sm')}</button>` : `<button class="btn btn-primary" id="np-create">${icon('rocket', 'icon-sm')}Create project</button>`}`);
    bind();
    setTimeout(() => api.el.querySelector('[autofocus]')?.focus(), 20);
  }

  function collect() {
    const q = (id) => api.el.querySelector(id);
    if (step === 1) { data.city = q('#np-city').value.trim(); data.country = q('#np-country').value.trim(); data.jurisdiction = q('#np-jur').value.trim(); data.year = Number(q('#np-year').value); data.description = q('#np-desc').value.trim(); data.population = q('#np-population').value.trim(); data.region = q('#np-region').value; }
  }
  function validate() {
    if (step === 1) {
      let ok = true;
      for (const [id, key] of [['#np-city', 'city'], ['#np-country', 'country'], ['#np-region', 'region']]) { const el = api.el.querySelector(id); el.classList.toggle('input-invalid', !data[key]); if (!data[key]) ok = false; }
      if (!ok) toast.error('City, country and region are required');
      return ok;
    }
    if (step === 2 && !data.sdgs.length) { toast.warning('No SDGs selected', 'Select at least one goal, or continue and configure later.'); }
    if (step === 3 && data.files.some(f => !f.language)) { toast.error('Set the language of every document', 'Each uploaded file needs its language before you can continue.'); return false; }
    return true;
  }
  function bind() {
    const el = api.el;
    el.querySelector('#np-cancel').onclick = api.close;
    el.querySelector('#np-back')?.addEventListener('click', () => { collect(); step--; render(); });
    el.querySelector('#np-next')?.addEventListener('click', () => { collect(); if (!validate()) return; step++; render(); });
    el.querySelector('#np-create')?.addEventListener('click', () => {
      collect();
      const languages = [...new Set(data.files.map(f => f.language))];
      const p = createProject({ ...data, languages: languages.length ? languages : ['EN'], name: data.name || `${data.city} ${data.year} VLR`, jurisdiction: data.jurisdiction || `${data.city} City Council` });
      api.close();
      toast.success(`${p.name} created`, data.files.length ? `${data.files.length} document(s) uploaded. Run the pipeline when ready.` : 'Upload source documents to begin extraction.');
      navigate(`#/projects/${p.id}`);
    });
    if (step === 1) {
      el.querySelectorAll('.input').forEach(i => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.querySelector('#np-next').click(); } }));
    }
    if (step === 2) {
      el.querySelectorAll('[data-sdg]').forEach(b => b.addEventListener('click', () => { const n = Number(b.dataset.sdg); data.sdgs = data.sdgs.includes(n) ? data.sdgs.filter(x => x !== n) : [...data.sdgs, n].sort((a, b2) => a - b2); b.classList.toggle('on'); el.querySelector('.hint').textContent = `${data.sdgs.length} of 17 selected · all four pillars will be extracted for each selected goal.`; }));
      el.querySelector('#np-sdg-all').onclick = () => { data.sdgs = Object.keys(SDG_TITLES).map(Number); render(); };
      el.querySelector('#np-sdg-none').onclick = () => { data.sdgs = []; render(); };
    }
    if (step === 3) {
      const gate = () => { const btn = el.querySelector('#np-next'); if (!btn) return; const missing = data.files.filter(f => !f.language).length; btn.disabled = !!missing; btn.title = missing ? `Set the language for ${missing} file(s)` : ''; };
      bindDropzone(el, 'np', data.files, { onChange: gate });
      gate();
    }
  }
  render();
  return api;
}

/* =========================================================================
 * Upload documents
 * ======================================================================= */
export function openUploadModal({ projectId = null, onDone } = {}) {
  const s = getState();
  const candidates = s.projects.filter(p => p.status !== 'archived');
  if (!candidates.length) { toast.warning('No active projects', 'Create a project first.'); return openNewProjectModal(); }
  if (projectId && getProject(projectId)?.status === 'archived') { toast.warning('Project is archived', 'Restore the project before uploading documents.'); return null; }
  let pid = projectId && getProject(projectId) ? projectId : candidates[0].id;
  const files = [];
  const api = openModal({
    title: 'Upload Documents', sub: 'Add source documents to a project. Every pillar extractor scans the full document pool.', size: 'lg', backdropClose: false,
    body: `
      <div class="field"><label class="label">Project</label><select class="select" id="up-project">${candidates.map(p => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)} — ${esc(p.jurisdiction)}</option>`).join('')}</select></div>
      ${dropzoneHtml('up')}
      <label class="checkbox"><input type="checkbox" id="up-parse" checked> Start parsing immediately after upload (LlamaParse)</label>`,
    footer: `<span class="left xs muted" id="up-summary">No files selected</span><button class="btn btn-ghost" id="up-cancel">Cancel</button><button class="btn btn-primary" id="up-go" disabled>${icon('upload', 'icon-sm')}Upload</button>`,
    onMount(el, api) {
      const update = () => {
        const missing = files.filter(f => !f.language).length;
        el.querySelector('#up-summary').textContent = files.length ? `${files.length} file(s) · ${fmtBytes(sum(files, f => f.size) / 1024)}${missing ? ` · set language for ${missing}` : ''}` : 'No files selected';
        const go = el.querySelector('#up-go'); go.disabled = !files.length || !!missing; go.title = missing ? `Set the language for ${missing} file(s)` : '';
      };
      const project = getProject(pid);
      bindDropzone(el, 'up', files, { onChange: update, existingNames: new Set(getProjectDocs(pid).map(d => d.name)) });
      el.querySelector('#up-project').addEventListener('change', (e) => { pid = e.target.value; });
      el.querySelector('#up-cancel').onclick = api.close;
      el.querySelector('#up-go').onclick = () => {
        const btn = el.querySelector('#up-go'); if (btn.disabled || btn.classList.contains('loading')) return; btn.disabled = true; btn.classList.add('loading'); btn.innerHTML = `${icon('loader-2', 'spin')}Uploading…`; refreshIcons(btn);
        setTimeout(() => {
          const docs = addDocuments(pid, files);
          const parseNow = el.querySelector('#up-parse').checked;
          if (parseNow) docs.forEach(d => startParse(d.id));
          api.close();
          toast.success(`${docs.length} document(s) uploaded`, parseNow ? 'Parsing tasks have been queued.' : `Added to ${getProject(pid)?.name}.`);
          onDone?.(docs);
          if (!location.hash.startsWith(`#/projects/${pid}`)) navigate(`#/projects/${pid}`);
        }, 700);
      };
    },
  });
  return api;
}

/* =========================================================================
 * New report
 * ======================================================================= */
export function openNewReportModal({ projectId = null } = {}) {
  const s = getState();
  if (!s.projects.length) { toast.warning('No projects yet'); return openNewProjectModal(); }
  let pid = projectId && getProject(projectId) ? projectId : (s.projects.find(p => p.status === 'active') || s.projects[0]).id;
  let format = 'xlsx';
  const formats = [
    { key: 'xlsx', icon: 'file-spreadsheet', label: 'Harmonized Excel Workbook', desc: 'Urban Data, Projects, Documentary, Stakeholders tabs (VLR harmonised template).' },
    { key: 'pdf', icon: 'file-text', label: 'VLR Report (PDF)', desc: 'Narrative report with provenance annex, ready for print.' },
    { key: 'md', icon: 'book-open', label: 'Obsidian Markdown Vault', desc: 'One note per SDG with wiki-links to source documents.' },
    { key: 'docx', icon: 'file-type', label: 'Word Draft (DOCX)', desc: 'Editable chapter drafts following the VLR chapter template.' },
  ];
  const sections = ['indicators', 'documentary', 'projects', 'stakeholders', 'provenance'];
  let unsubReport = () => {};
  const api = openModal({
    title: 'New Report', sub: 'Generate a deliverable from the reviewed extractions of a project.', onClose: () => unsubReport(),
    body: `
      <div class="field"><label class="label">Project</label><select class="select" id="rp-project">${s.projects.map(p => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)} (${projectStats(p).extractions} extractions)</option>`).join('')}</select></div>
      <div class="field"><label class="label">Format</label><div class="format-options">${formats.map(f => `<button type="button" class="format-option ${f.key === format ? 'on' : ''}" data-format="${f.key}">${icon(f.icon)}<div><strong>${f.label}</strong><span>${f.desc}</span></div></button>`).join('')}</div></div>
      <div class="field"><label class="label">Sections</label><div class="checks">${sections.map(k => `<label class="checkbox"><input type="checkbox" data-section="${k}" checked> ${k === 'provenance' ? 'Provenance annex (sources, pages, quotes)' : PILLARS.find(p => p.key === k).label}</label>`).join('')}</div></div>
      <label class="checkbox"><input type="checkbox" id="rp-approved"> Include only approved extractions</label>`,
    footer: `<span class="left xs muted">Estimated cost: <span class="cost" id="rp-cost">${fmtCost(STEP_META.export.base)}</span></span><button class="btn btn-ghost" id="rp-cancel">Cancel</button><button class="btn btn-primary" id="rp-go">${icon('file-output', 'icon-sm')}Generate report</button>`,
    onMount(el, api) {
      el.querySelector('#rp-project').addEventListener('change', (e) => { pid = e.target.value; });
      el.querySelectorAll('[data-format]').forEach(b => b.addEventListener('click', () => { format = b.dataset.format; el.querySelectorAll('[data-format]').forEach(x => x.classList.toggle('on', x.dataset.format === format)); el.querySelector('#rp-cost').textContent = fmtCost(format === 'xlsx' ? STEP_META.export.base : STEP_META.report.base); }));
      el.querySelector('#rp-cancel').onclick = api.close;
      el.querySelector('#rp-go').onclick = () => {
        const secs = [...el.querySelectorAll('[data-section]:checked')].map(c => c.dataset.section);
        const approvedOnly = el.querySelector('#rp-approved').checked;
        const task = generateReport(pid, { format, sections: secs, approvedOnly });
        const project = getProject(pid);
        // progress view
        api.setTitle('Generating report', esc(project.name));
        const renderProgress = () => {
          const t = getTask(task.id);
          const done = t?.status === 'success';
          api.setBody(`<div class="report-progress">${icon(done ? 'check-circle-2' : 'loader-2', `big-icon ${done ? 'done' : 'spin'}`)}<div class="card-title">${done ? 'Report ready' : 'Composing ' + esc(t?.inputDoc || '')}</div><div class="muted mt-8">${done ? `${esc(t.inputDoc)} · cost ${fmtCost(t.cost)}` : (t?.logs?.slice(-1)[0]?.msg || 'Queued…')}</div><div class="mt-16">${progressHtml(t?.progress || 0, done ? 'success' : 'sky striped')}</div></div>`);
          api.setFooter(done
            ? `<button class="btn btn-ghost" id="rp-close">Close</button><button class="btn btn-outline" id="rp-history">${icon('history', 'icon-sm')}Open project history</button><button class="btn btn-primary" id="rp-download">${icon('download', 'icon-sm')}Download</button>`
            : `<span class="left xs muted">Running on ${esc(t?.node || '')} · you can close this window, the report will appear in the project History.</span><button class="btn btn-ghost" id="rp-close">Close</button>`);
          api.el.querySelector('#rp-close').onclick = () => { unsub(); api.close(); };
          api.el.querySelector('#rp-history')?.addEventListener('click', () => { unsub(); api.close(); navigate(`#/projects/${pid}/history`); });
          api.el.querySelector('#rp-download')?.addEventListener('click', () => { const rep = getState().reports.find(r => r.taskId === task.id) || getState().reports.find(r => r.projectId === pid); downloadReport(rep); });
          if (done) unsub();
        };
        const unsub = subscribe(renderProgress);
        unsubReport = unsub;
        renderProgress();
      };
    },
  });
  return api;
}

export function downloadReport(report) {
  if (!report) { toast.error('Report not found'); return; }
  const c = reportContentFor(report);
  if (c.html) {
    const w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(c.html); w.document.close(); toast.info('Report opened in a new tab', report.format === 'docx' ? 'Save the draft from the print dialog, or copy it into Word to continue editing.' : 'Use the print dialog to save it as PDF.'); }
    else { download(report.name.replace(/\.(pdf|docx)$/, '.html'), c.html, 'text/html'); }
    return;
  }
  download(c.name, c.blob, c.mime);
  toast.success('Download started', report.name);
}

/* =========================================================================
 * Configure project
 * ======================================================================= */
export function openConfigureProjectModal(projectId) {
  const p = getProject(projectId);
  if (!p) return;
  const data = { name: p.name, jurisdiction: p.jurisdiction, city: p.city, country: p.country, year: p.year, sdgs: [...p.sdgs], languages: [...p.languages], description: p.description || '', node: p.node, lead: p.lead || '' };
  const api = openModal({
    title: 'Configure Project', sub: esc(p.name), size: 'lg', backdropClose: false,
    body: `
      <div class="form-grid">
        <div class="field span-2"><label class="label">Project name</label><input class="input" id="cp-name" value="${esc(data.name)}"></div>
        <div class="field"><label class="label">City</label><input class="input" id="cp-city" value="${esc(data.city)}"></div>
        <div class="field"><label class="label">Country</label><input class="input" id="cp-country" value="${esc(data.country)}"></div>
        <div class="field"><label class="label">Jurisdiction</label><input class="input" id="cp-jur" value="${esc(data.jurisdiction)}"></div>
        <div class="field"><label class="label">Reporting year</label><select class="select" id="cp-year">${YEARS.map(y => `<option ${y === Number(data.year) ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
        <div class="field"><label class="label">Project lead</label><input class="input" id="cp-lead" value="${esc(data.lead)}"></div>
        <div class="field"><label class="label">Processing node</label><select class="select" id="cp-node">${['EU-WEST-1', 'US-EAST-G01', 'EU-CENTRAL-2'].map(n => `<option ${n === data.node ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field span-2"><label class="label">Document languages</label><div class="lang-chips">${LANGS.map(l => `<button type="button" class="lang-chip ${data.languages.includes(l) ? 'on' : ''}" data-lang="${l}">${l}</button>`).join('')}</div></div>
        <div class="field span-2"><label class="label">Target SDGs (<span id="cp-count">${data.sdgs.length}</span>)</label><div class="sdg-grid">${Object.keys(SDG_TITLES).map(n => `<button type="button" class="sdg-tile ${data.sdgs.includes(Number(n)) ? 'on' : ''}" data-sdg="${n}">${sdgChip(Number(n), { title: false })}<span class="t">${esc(SDG_TITLES[n])}</span></button>`).join('')}</div></div>
        <div class="field span-2"><label class="label">Description</label><textarea class="textarea" id="cp-desc" style="min-height:70px">${esc(data.description)}</textarea></div>
      </div>
      <div class="callout ${p.status === 'archived' ? '' : 'danger'}">${icon(p.status === 'archived' ? 'archive-restore' : 'alert-triangle')}<div class="grow"><strong>${p.status === 'archived' ? 'Archived project' : 'Danger zone'}</strong><div class="xs">${p.status === 'archived' ? 'Restore to resume extraction and review.' : 'Archiving freezes the project; deleting removes all documents, tasks and extractions.'}</div></div>
        ${p.status === 'archived' ? `<button class="btn btn-outline btn-sm" id="cp-restore">Restore</button>` : `<button class="btn btn-light btn-sm" id="cp-archive">${icon('archive')}Archive</button><button class="btn btn-danger-outline btn-sm" id="cp-delete">${icon('trash-2')}Delete</button>`}</div>`,
    footer: `${p.status === 'provisioning' ? `<button class="btn btn-outline left" id="cp-activate">${icon('play', 'icon-sm')}Activate project</button>` : '<span class="left"></span>'}<button class="btn btn-ghost" id="cp-cancel">Cancel</button><button class="btn btn-primary" id="cp-save">Save changes</button>`,
    onMount(el, api) {
      el.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => { const l = b.dataset.lang; data.languages = data.languages.includes(l) ? data.languages.filter(x => x !== l) : [...data.languages, l]; if (!data.languages.length) data.languages = ['EN']; b.classList.toggle('on', data.languages.includes(l)); }));
      el.querySelectorAll('[data-sdg]').forEach(b => b.addEventListener('click', () => { const n = Number(b.dataset.sdg); data.sdgs = data.sdgs.includes(n) ? data.sdgs.filter(x => x !== n) : [...data.sdgs, n].sort((a, c) => a - c); b.classList.toggle('on'); el.querySelector('#cp-count').textContent = data.sdgs.length; }));
      const collect = () => ({ name: el.querySelector('#cp-name').value.trim() || p.name, city: el.querySelector('#cp-city').value.trim() || p.city, country: el.querySelector('#cp-country').value.trim() || p.country, jurisdiction: el.querySelector('#cp-jur').value.trim(), year: Number(el.querySelector('#cp-year').value), lead: el.querySelector('#cp-lead').value.trim(), node: el.querySelector('#cp-node').value, languages: data.languages, sdgs: data.sdgs, description: el.querySelector('#cp-desc').value.trim() });
      el.querySelector('#cp-cancel').onclick = api.close;
      el.querySelector('#cp-save').onclick = () => { updateProject(projectId, collect()); api.close(); toast.success('Project updated', getProject(projectId).name); };
      el.querySelector('#cp-activate')?.addEventListener('click', () => { updateProject(projectId, collect()); activateProject(projectId); api.close(); toast.success('Project activated', 'Status changed from Provisioning to Active.'); });
      el.querySelector('#cp-archive')?.addEventListener('click', async () => { if (await confirmDialog({ title: 'Archive project?', msg: `${esc(p.name)} will be frozen. Extractions remain readable and reports can still be downloaded.`, confirmText: 'Archive', icon: 'archive' })) { archiveProject(projectId); api.close(); toast.success('Project archived'); } });
      el.querySelector('#cp-restore')?.addEventListener('click', () => { unarchiveProject(projectId); api.close(); toast.success('Project restored', 'Status changed to Active.'); });
      el.querySelector('#cp-delete')?.addEventListener('click', async () => { if (await confirmDialog({ title: 'Delete project?', msg: `This permanently removes <strong>${esc(p.name)}</strong> with ${getProjectDocs(projectId).length} documents and ${getProjectExtractions(projectId).length} extractions.`, confirmText: 'Delete permanently', danger: true, icon: 'trash-2' })) { deleteProject(projectId); api.close(); toast.success('Project deleted'); navigate('#/projects'); } });
    },
  });
  return api;
}

/* =========================================================================
 * Add manual extraction
 * ======================================================================= */
export function openAddExtractionModal(projectId, pillar = 'indicators') {
  const p = getProject(projectId);
  const docs = getProjectDocs(projectId);
  const pl = PILLARS.find(x => x.key === pillar);
  const docSel = `<div class="field"><label class="label">Source document</label><select class="select" id="ax-doc"><option value="">— Manual entry (no document) —</option>${docs.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>`;
  const common = `<div class="field"><label class="label">Page</label><input class="input" id="ax-page" type="number" min="1" value="1"></div><div class="field"><label class="label">Paragraph</label><input class="input" id="ax-para" type="number" min="1" value="1"></div><div class="field span-2"><label class="label">Exact quote</label><textarea class="textarea" id="ax-quote" placeholder="Paste the verbatim sentence supporting this entry" style="min-height:70px"></textarea></div>`;
  const forms = {
    indicators: `<div class="field"><label class="label">SDG indicator <span class="req">*</span></label><input class="input" id="ax-sdg" placeholder="e.g. 11.3.1"></div><div class="field"><label class="label">Extraction name <span class="req">*</span></label><input class="input" id="ax-title" placeholder="e.g. Land consumption rate"></div><div class="field"><label class="label">Value <span class="req">*</span></label><input class="input" id="ax-value" placeholder="e.g. 1.24"></div><div class="field"><label class="label">Unit</label><input class="input" id="ax-unit" placeholder="e.g. Ratio"></div><div class="field"><label class="label">Year</label><input class="input" id="ax-year" type="number" value="${p.year - 1}"></div>${docSel}${common}`,
    documentary: `<div class="field"><label class="label">SDG target <span class="req">*</span></label><input class="input" id="ax-sdg" placeholder="e.g. 11.3"></div><div class="field"><label class="label">Category</label><select class="select" id="ax-cat"><option value="C1">C1 — Challenge</option><option value="C2">C2 — Commitment</option><option value="C3">C3 — Policy</option></select></div><div class="field span-2"><label class="label">Title <span class="req">*</span></label><input class="input" id="ax-title"></div><div class="field span-2"><label class="label">Summary</label><textarea class="textarea" id="ax-summary" style="min-height:60px"></textarea></div>${docSel}${common}`,
    projects: `<div class="field"><label class="label">SDG target <span class="req">*</span></label><input class="input" id="ax-sdg" placeholder="e.g. 9.1"></div><div class="field"><label class="label">Status</label><select class="select" id="ax-pstatus"><option>Planned</option><option>In execution</option><option>Completed</option></select></div><div class="field span-2"><label class="label">Project name <span class="req">*</span></label><input class="input" id="ax-title"></div><div class="field"><label class="label">Budget</label><input class="input" id="ax-budget" placeholder="€12M"></div><div class="field"><label class="label">Period</label><input class="input" id="ax-period" placeholder="2024–2026"></div><div class="field span-2"><label class="label">Lead entity</label><input class="input" id="ax-lead"></div><div class="field span-2"><label class="label">Summary</label><textarea class="textarea" id="ax-summary" style="min-height:60px"></textarea></div>${docSel}${common}`,
    stakeholders: `<div class="field"><label class="label">SDG target <span class="req">*</span></label><input class="input" id="ax-sdg" placeholder="e.g. 11.7"></div><div class="field"><label class="label">Category</label><select class="select" id="ax-cat"><option>Challenge</option><option>Priority</option><option>Recommendation</option><option>Correction</option></select></div><div class="field span-2"><label class="label">Insight <span class="req">*</span></label><input class="input" id="ax-title"></div><div class="field"><label class="label">Stakeholder group</label><input class="input" id="ax-group" placeholder="e.g. Neighbourhood associations"></div><div class="field"><label class="label">Engagement type</label><input class="input" id="ax-eng" placeholder="e.g. Public consultation"></div>${docSel}${common}`,
  };
  const api = openModal({
    title: `Add ${pl.label} entry`, sub: 'Manually add information the extractors may have missed. Manual entries are flagged and fully traceable.', size: 'lg', backdropClose: false,
    body: `<div class="pillar-form-grid">${forms[pillar]}</div>`,
    footer: `<button class="btn btn-ghost" id="ax-cancel">Cancel</button><button class="btn btn-primary" id="ax-save">${icon('plus', 'icon-sm')}Add entry</button>`,
    onMount(el, api) {
      const v = (id) => el.querySelector(id)?.value?.trim();
      el.querySelector('#ax-cancel').onclick = api.close;
      el.querySelector('#ax-save').onclick = () => {
        const sdg = v('#ax-sdg'), title = v('#ax-title');
        let ok = true;
        [['#ax-sdg', sdg], ['#ax-title', title], ...(pillar === 'indicators' ? [['#ax-value', v('#ax-value')]] : [])].forEach(([id, val]) => { el.querySelector(id).classList.toggle('input-invalid', !val); if (!val) ok = false; });
        if (!ok) { toast.error('Please fill the required fields'); return; }
        const cat = v('#ax-cat');
        const e = addManualExtraction(projectId, pillar, { sdg, title, value: v('#ax-value'), unit: v('#ax-unit'), year: v('#ax-year'), category: cat, categoryLabel: pillar === 'documentary' ? { C1: 'Challenge', C2: 'Commitment', C3: 'Policy' }[cat] : undefined, summary: v('#ax-summary'), projectStatus: v('#ax-pstatus'), budget: v('#ax-budget'), period: v('#ax-period'), lead: v('#ax-lead'), group: v('#ax-group'), engagement: v('#ax-eng'), docId: v('#ax-doc') || null, page: v('#ax-page'), paragraph: v('#ax-para'), quote: v('#ax-quote') });
        api.close(); toast.success('Entry added', `SDG ${e.sdg} · ${e.title}`);
      };
    },
  });
  return api;
}

/* =========================================================================
 * Task detail drawer (live)
 * ======================================================================= */
export function openTaskDrawer(taskId) {
  const t0 = getTask(taskId);
  if (!t0) return;
  let unsub = () => {};
  const api = openDrawer({ title: esc(t0.label), sub: `Task ${esc(t0.id)} · ${esc(getProject(t0.projectId)?.name || '')}`, body: '', footer: '', width: '560px', onClose: () => unsub() });
  const render = () => {
    const t = getTask(taskId);
    if (!t) { api.close(); return; }
    const meta = STEP_META[t.step];
    const doc = t.inputDocId ? getDoc(t.inputDocId) : null;
    const deps = (t.dependsOn || []).map(getTask).filter(Boolean);
    api.setBody(`
      <div class="row-between"><div class="row">${icon(meta.icon, 'navy')}<strong>${esc(meta.label)}</strong><span class="xs muted">· ${esc(meta.engine)}</span></div>${statusBadge(t.status)}</div>
      ${t.status === 'running' ? `<div>${progressHtml(t.progress, 'sky striped')}<div class="xs muted mt-8">${t.progress}% · running on ${esc(t.node)}</div></div>` : ''}
      ${t.error ? `<div class="callout danger">${icon('alert-circle')}<div><strong>Error</strong><div class="xs">${esc(t.error)}</div></div></div>` : ''}
      <div class="task-meta-grid">
        <div><div class="k">Input</div><div class="v mono">${esc(t.inputDoc)}</div></div>
        <div><div class="k">Project</div><div class="v">${esc(getProject(t.projectId)?.name || '—')}</div></div>
        <div><div class="k">Created</div><div class="v mono">${fmtDateTime(t.createdAt)}</div></div>
        <div><div class="k">Duration</div><div class="v mono">${t.status === 'running' ? fmtDuration(Date.now() - (t.startedAt || Date.now())) + ' (elapsed)' : fmtDuration(t.durationMs)}</div></div>
        <div><div class="k">Node</div><div class="v mono">${esc(t.node)}</div></div>
        <div><div class="k">Cost</div><div class="v cost">${t.status === 'success' || t.status === 'failed' || t.status === 'cancelled' ? fmtCost(t.cost) : `est. ${fmtCost(meta.base + meta.perPage * (t.pages || 0))}`}</div></div>
        ${t.retries ? `<div><div class="k">Retries</div><div class="v">${t.retries}</div></div>` : ''}
        ${t.runId ? `<div><div class="k">Run</div><div class="v">${esc(getState().runs.find(r => r.id === t.runId)?.label || t.runId)}</div></div>` : ''}
      </div>
      ${deps.length ? `<div><div class="label mb-8">Depends on</div><div class="dep-list">${deps.map(d => `<div class="dep-item"><span class="row">${icon(STEP_META[d.step].icon, 'icon-sm')}${esc(d.label)} <span class="mono muted">${esc(d.inputDoc)}</span></span>${statusBadge(d.status)}</div>`).join('')}</div></div>` : ''}
      ${t.output ? `<div><div class="label mb-8">Output</div><pre class="console" style="padding:12px 14px;margin:0">${esc(JSON.stringify(t.output, null, 2))}</pre></div>` : ''}
      <div><div class="label mb-8">Task log</div><div class="console task-log">${t.logs.length ? t.logs.map(l => `<div class="log-line ${l.level.toLowerCase()}"><span class="ts">[${fmtTime(l.ts)}]</span> <span class="lvl">${l.level}:</span> ${esc(l.msg)}</div>`).join('') : '<div class="log-line debug">No log entries yet — task is queued.</div>'}</div></div>`);
    api.setFooter(`
      ${doc ? `<button class="btn btn-light left" id="td-doc">${icon('file-text', 'icon-sm')}Open document</button>` : '<span class="left"></span>'}
      ${t.status === 'failed' || t.status === 'cancelled' ? `<button class="btn btn-outline" id="td-retry">${icon('rotate-ccw', 'icon-sm')}Retry</button>` : ''}
      ${t.status === 'running' || t.status === 'queued' ? `<button class="btn btn-danger-outline" id="td-cancel">${icon('x-circle', 'icon-sm')}Cancel task</button>` : ''}
      <button class="btn btn-primary" id="td-close">Close</button>`);
    api.el.querySelector('#td-close').onclick = () => { unsub(); api.close(); };
    api.el.querySelector('#td-doc')?.addEventListener('click', () => { unsub(); api.close(); navigate(`#/projects/${t.projectId}/documents/${doc.id}`); });
    api.el.querySelector('#td-retry')?.addEventListener('click', () => { retryTask(taskId); toast.info('Task re-queued', t.label); });
    api.el.querySelector('#td-cancel')?.addEventListener('click', () => { cancelTask(taskId); toast.warning('Task cancelled', t.label); });
  };
  unsub = subscribe(render);
  render();
  return api;
}

/* =========================================================================
 * Document details drawer
 * ======================================================================= */
export function openDocumentDrawer(docId) {
  const d0 = getDoc(docId);
  if (!d0) return;
  let unsub = () => {};
  const api = openDrawer({ title: esc(d0.name), sub: `${esc(d0.code)} · ${esc(getProject(d0.projectId)?.name || '')}`, body: '', footer: '', onClose: () => unsub() });
  const render = () => {
    const d = getDoc(docId);
    if (!d) { api.close(); return; }
    const tasks = getProjectTasks(d.projectId).filter(t => t.inputDocId === d.id).sort((a, b) => b.createdAt - a.createdAt);
    const exts = getProjectExtractions(d.projectId).filter(e => e.source?.docId === d.id);
    api.setBody(`
      <div class="row-between"><div class="row">${fileTypeIcon(d.name)}<span class="badge badge-lang">${esc(d.language)}</span></div>${statusBadge(d.status)}</div>
      ${d.status === 'parsing' ? `<div>${progressHtml(d.progress || 0, 'sky striped')}<div class="xs muted mt-8">Parsing… ${d.progress || 0}%</div></div>` : ''}
      <div class="task-meta-grid">
        <div><div class="k">Pages</div><div class="v">${d.pages}</div></div>
        <div><div class="k">Size</div><div class="v">${fmtBytes(d.sizeKb)}</div></div>
        <div><div class="k">Uploaded</div><div class="v mono">${fmtDateTime(d.uploadedAt)}</div></div>
        <div><div class="k">Parsed</div><div class="v mono">${d.parsedAt ? fmtDateTime(d.parsedAt) : '—'}</div></div>
        <div><div class="k">Translation</div><div class="v">${d.language === 'EN' ? 'Not required (EN)' : d.translated ? `${d.language} → EN ✓` : 'Pending'}</div></div>
        <div><div class="k">Uploaded by</div><div class="v">${esc(d.uploadedBy || 'Pipeline import')}</div></div>
      </div>
      <div><div class="label mb-8">Extractions sourced from this document (${exts.length})</div>${exts.length ? `<div class="dep-list">${exts.slice(0, 8).map(e => `<a class="dep-item" href="#/review/${e.id}"><span><span class="badge badge-sdg">SDG ${esc(e.sdg)}</span> ${esc(e.title)}</span><span class="xs muted">p.${e.source.page}</span></a>`).join('')}${exts.length > 8 ? `<div class="xs muted">+${exts.length - 8} more</div>` : ''}</div>` : '<div class="xs muted">None yet — run the pipeline to extract.</div>'}</div>
      <div><div class="label mb-8">Processing history (${tasks.length})</div>${tasks.length ? `<div class="dep-list">${tasks.map(t => `<button class="dep-item" data-task="${t.id}"><span class="row">${icon(STEP_META[t.step].icon, 'icon-sm')}${esc(t.label)} <span class="xs muted">${relTime(t.createdAt)}</span></span>${statusBadge(t.status)}</button>`).join('')}</div>` : '<div class="xs muted">No tasks yet.</div>'}</div>`);
    api.setFooter(`
      <button class="btn btn-danger-outline left" id="dd-delete">${icon('trash-2', 'icon-sm')}Delete</button>
      ${d.status === 'uploaded' ? `<button class="btn btn-outline" id="dd-parse">${icon('play', 'icon-sm')}Start parse</button>` : ''}
      ${d.language !== 'EN' && !d.translated && d.status === 'processed' ? `<button class="btn btn-outline" id="dd-translate">${icon('languages', 'icon-sm')}Translate to EN</button>` : ''}
      <button class="btn btn-primary" id="dd-open">${icon('eye', 'icon-sm')}Open viewer</button>`);
    api.el.querySelectorAll('[data-task]').forEach(b => b.addEventListener('click', () => { unsub(); api.close(); openTaskDrawer(b.dataset.task); }));
    api.el.querySelector('#dd-open').onclick = () => { unsub(); api.close(); navigate(`#/projects/${d.projectId}/documents/${d.id}`); };
    api.el.querySelector('#dd-parse')?.addEventListener('click', () => { startParse(d.id); toast.info('Parsing queued', d.name); });
    api.el.querySelector('#dd-translate')?.addEventListener('click', () => { translateDocument(d.id); toast.info('Translation queued', `${d.name} (${d.language} → EN)`); });
    api.el.querySelector('#dd-delete').onclick = async () => { if (await confirmDialog({ title: 'Delete document?', msg: `<strong>${esc(d.name)}</strong> will be removed from the project. Extractions already produced remain, but lose their live link to the source.`, confirmText: 'Delete', danger: true, icon: 'trash-2' })) { unsub(); api.close(); deleteDocument(d.id); toast.success('Document deleted', d.name); } };
  };
  unsub = subscribe(render);
  render();
  return api;
}

/* =========================================================================
 * Feedback / comment dialog
 * ======================================================================= */
export function openFeedbackModal(extractionId, { kind = 'comment', title, placeholder } = {}) {
  const e = getExtraction(extractionId);
  const titles = { comment: 'Add reviewer note', 'mis-highlight': 'Report mis-highlight', rejection: 'Reject & rerun' };
  const api = openModal({
    title: title || titles[kind] || 'Feedback', sub: e ? `SDG ${esc(e.sdg)} · ${esc(e.title)}` : '', size: 'sm',
    body: `<div class="field"><label class="label">${kind === 'mis-highlight' ? 'What is wrong with the highlighted evidence?' : 'Note'}</label><textarea class="textarea" id="fb-text" placeholder="${esc(placeholder || (kind === 'mis-highlight' ? 'e.g. The 12.4% refers to the outer districts only, not the whole city.' : 'Feedback is stored with the extraction and fed back to the extraction agents on rerun.'))}"></textarea></div>${kind === 'mis-highlight' ? `<label class="checkbox"><input type="checkbox" id="fb-rerun"> Also queue a rerun of this extraction</label>` : ''}`,
    footer: `<button class="btn btn-ghost" id="fb-cancel">Cancel</button><button class="btn btn-primary" id="fb-save">${icon('send', 'icon-sm')}Submit</button>`,
    onMount(el, api) {
      el.querySelector('#fb-cancel').onclick = api.close;
      el.querySelector('#fb-save').onclick = () => {
        const text = el.querySelector('#fb-text').value.trim();
        if (!text) { el.querySelector('#fb-text').classList.add('input-invalid'); return; }
        addComment(extractionId, text, kind);
        api.close();
        toast.success(kind === 'mis-highlight' ? 'Mis-highlight reported' : 'Note added', 'Attached to the extraction and visible to the pipeline.');
        api._result = { text, rerun: el.querySelector('#fb-rerun')?.checked };
        api.onSubmit?.(api._result);
      };
    },
  });
  return api;
}
