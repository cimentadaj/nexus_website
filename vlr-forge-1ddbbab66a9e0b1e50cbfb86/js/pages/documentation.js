/* Documentation — product manual for VLR Forge. Left sticky nav (searchable), right article with Prev/Next.
 * Article content is authored HTML; any data pulled from seed/state is escaped. */
import { esc, icon, bindActions, toast, copyToClipboard, fmtCost, download } from '../ui.js';
import { getState, totalCost } from '../store.js';
import { topbarActions } from '../shell.js';
import { navigate } from '../router.js';
import { STEP_META, STEP_ORDER, PILLARS, APP_VERSION, NODES, DOC_TYPES, LANGS } from '../seed.js';

/* ---------- small html helpers ---------- */
const code = (str, lang = 'json') => `<div class="doc-code"><div class="doc-code-bar"><span>${esc(lang)}</span><button class="btn btn-ghost btn-xs" data-action="copy-code" data-tip="Copy to clipboard">${icon('copy', 'icon-xs')}Copy</button></div><pre class="console"><code>${esc(str)}</code></pre></div>`;
const note = (html, kind = '') => `<div class="callout ${kind}">${icon(kind === 'warning' ? 'alert-triangle' : kind === 'success' ? 'check-circle-2' : 'info')}<div>${html}</div></div>`;
const table = (head, rows) => `<div class="doc-table-wrap"><table class="table doc-table"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const link = (slug, label) => `<a href="#/documentation?doc=${slug}" data-action="goto" data-doc="${slug}">${label}</a>`;
const kbd = (k) => `<kbd>${esc(k)}</kbd>`;

/* ---------- articles ---------- */
const DOCS = [
  /* Getting started */
  { group: 'Getting started', slug: 'overview', title: 'Overview', body: () => {
    const s = getState();
    return `
    <p class="lead">VLR Forge turns a city's own documents into a <strong>Voluntary Local Review</strong> (VLR): a structured, evidence-backed account of progress against the UN Sustainable Development Goals. Every value in the output is traceable to a document, a page and a verbatim quote.</p>
    <h2>How it works</h2>
    <ol class="doc-steps">
      <li><strong>Create a project</strong> for a jurisdiction and reporting year and pick the SDGs in scope.</li>
      <li><strong>Upload documents</strong> once, at project level — plans, policy briefs, budgets, workshop minutes, spreadsheets, legacy XML.</li>
      <li><strong>Run the pipeline.</strong> Documents are parsed (LlamaParse), translated to English (Gemini) and then scanned by the four pillar extractors. Every extractor reads the <em>whole</em> document pool.</li>
      <li><strong>Review.</strong> Each extraction shows its AI confidence, source page and highlighted quote. Approve, edit, comment or reject &amp; rerun.</li>
      <li><strong>Export</strong> the harmonized Excel workbook, the Obsidian markdown vault or a narrative report.</li>
    </ol>
    <h2>The four pillars</h2>
    ${table(['Pillar', 'What it extracts', 'Engine', 'Target / project'], PILLARS.map(p => [`<strong>${esc(p.label)}</strong>`, esc(p.desc), esc(STEP_META[p.step].engine), `${p.target} entries`]))}
    ${note(`<strong>Documents are never classified per pillar.</strong> A workshop transcript can yield an indicator value, a policy commitment and a stakeholder quote at the same time — so all four extractors run over the full pool.`)}
    <h2>This workspace</h2>
    <p>Organisation <strong>${esc(s.settings?.org?.name || '—')}</strong> · ${s.projects.length} projects · ${s.documents.length} documents · ${s.extractions.length} extractions · pipeline spend to date <span class="mono">${fmtCost(totalCost())}</span>.</p>
    <p>Continue with ${link('creating-a-project', 'Creating a project')} or jump to the ${link('api', 'API reference')}.</p>`;
  } },
  { group: 'Getting started', slug: 'creating-a-project', title: 'Creating a project', body: () => `
    <p class="lead">A project is one VLR cycle for one jurisdiction — for example <em>Madrid 2024</em>. It owns the document pool, the pipeline runs, the extractions and the exported reports.</p>
    <h2>Steps</h2>
    <ol class="doc-steps">
      <li>Click <strong>New Project</strong> in the top bar or the dashed <strong>Initialize New VLR</strong> card on the Projects page.</li>
      <li>Enter the project name, city, country and reporting jurisdiction (e.g. <em>Madrid City Council</em>) and the reporting year.</li>
      <li>Select the SDGs in scope. Only the selected goals are loaded from the SDG wiki; targets and indicators are read from the Obsidian reference vault.</li>
      <li>Pick the source languages (${LANGS.map(l => `<span class="badge badge-lang">${l}</span>`).join(' ')}). Non-English documents are translated automatically.</li>
      <li>Optionally drop the first documents into the wizard. You can always add more later.</li>
    </ol>
    <h2>Project status</h2>
    ${table(['Status', 'Meaning'], [
      ['<span class="badge badge-warning">Provisioning</span>', 'Metadata is being ingested and the compute node assigned. Use <strong>Configure Project</strong> to complete setup.'],
      ['<span class="badge badge-success">Active</span>', 'The pipeline can run; extractions can be reviewed.'],
      ['<span class="badge badge-neutral">Archived</span>', 'Reporting complete. Read-only; the archive can be restored from the card menu.'],
    ])}
    <h2>Compute node</h2>
    <p>Each project is pinned to a data-residency node: ${NODES.map(n => `<span class="mono">${esc(n)}</span>`).join(', ')}. The node is shown in the project status bar and on every task.</p>` },
  { group: 'Getting started', slug: 'uploading-documents', title: 'Uploading documents', body: () => `
    <p class="lead">Documents are uploaded <strong>once, at project level</strong>. There is no per-pillar upload: the Indicators, Documentary, Projects and Stakeholders extractors all scan the same pool.</p>
    <h2>Supported formats</h2>
    ${table(['Format', 'Handling'], [
      ['<span class="mono">.pdf .docx .pptx</span>', 'Parsed to Markdown by LlamaParse (layout-aware, tables preserved).'],
      ['<span class="mono">.xlsx .csv</span>', 'Read as data sheets; numeric series feed Pillar A trends directly.'],
      ['<span class="mono">.xml .json .yaml</span>', 'Legacy data — mapped through the Legacy Schema Mapper (XML Extraction step).'],
      ['<span class="mono">.md .txt</span>', 'Used as-is; no parse cost.'],
    ])}
    <h2>Document types</h2>
    <p>The type is inferred from the filename and can be changed in the upload dialog or the document drawer: ${DOC_TYPES.map(t => `<span class="badge badge-neutral">${esc(t)}</span>`).join(' ')}.</p>
    <h2>Lifecycle</h2>
    ${table(['Status', 'What it means', 'Next action'], [
      ['<span class="badge badge-danger">Uploaded</span>', 'Stored, not yet parsed.', '<strong>Start parse</strong> (or run the full pipeline).'],
      ['<span class="badge badge-running badge-dot">Parsing</span>', 'LlamaParse is converting the file.', 'Wait — progress is shown inline.'],
      ['<span class="badge badge-running badge-dot">Translating</span>', 'Gemini is translating the parsed Markdown to English.', 'Wait.'],
      ['<span class="badge badge-success badge-dot">Processed</span>', 'Ready for extraction; a provenance code (e.g. <span class="mono">MDC-DOC-429</span>) is assigned.', 'Run extraction steps.'],
    ])}
    ${note('Every document receives a provenance code on upload. The code appears in the Audit Log, in the review page lineage and in the exported workbook.', 'success')}` },

  /* Pipeline */
  { group: 'Pipeline', slug: 'steps-costs', title: 'Steps & costs', body: () => `
    <p class="lead">A pipeline run is a DAG of tasks. Document-scoped steps run once per document; project-scoped steps run once per project after their inputs are ready. Cost is estimated as <span class="mono">base + per_page × pages</span> and aggregated per run and per project.</p>
    ${table(['Step', 'Engine', 'Scope', 'Base', 'Per page', 'Demo duration'], STEP_ORDER.map(k => { const m = STEP_META[k]; return [`${icon(m.icon, 'icon-sm')} <strong>${esc(m.label)}</strong>`, esc(m.engine), `<span class="badge badge-${m.scope === 'document' ? 'info' : 'navy'}">${esc(m.scope)}</span>`, `<span class="mono">${fmtCost(m.base)}</span>`, `<span class="mono">${m.perPage ? fmtCost(m.perPage) : '—'}</span>`, `<span class="mono">${(m.durationMs / 1000).toFixed(1)}s</span>`]; }))}
    <h2>Execution order</h2>
    <p>${STEP_ORDER.map(k => `<span class="doc-chip">${esc(STEP_META[k].label)}</span>`).join('<span class="doc-arrow">→</span>')}</p>
    <p>Concurrency, automatic retries and simulation speed are configured under <a href="#/settings?tab=pipeline">Settings → Pipeline</a>. Failed tasks can be retried from the Tasks page; a retry creates a new task linked to the original (<span class="mono">rerunOf</span>).</p>
    ${note('Cost figures on every task row, the task drawer, the project header and the run history are all derived from the same task ledger, so they always reconcile.')}` },
  { group: 'Pipeline', slug: 'parser', title: 'Parser', body: () => `
    <p class="lead">The <strong>PDF Parser</strong> step converts PDF, DOCX and PPTX files to structured Markdown with LlamaParse v4. Page boundaries and paragraph numbers are preserved so that every extraction can point back to <em>page 42, paragraph 3</em>.</p>
    <h2>Behaviour</h2>
    <ul>
      <li>Tables are emitted as Markdown tables; figures are captioned.</li>
      <li>Scanned PDFs are OCR'd automatically; the parser flags low-confidence pages with a <span class="badge badge-warning">WARN</span> log line.</li>
      <li>Parsed output is cached per document hash. Re-running the pipeline never re-parses an unchanged file.</li>
    </ul>
    <h2>Configuration</h2>
    ${code(`# .env
LLAMA_CLOUD_API_KEY=llx-...
VLR_FORGE_PARSER=llamaparse-v4
VLR_FORGE_PARSE_CONCURRENCY=3`, 'env')}
    <p>Data sheets (<span class="mono">.xlsx/.csv</span>) and legacy XML skip the parser and go through the <strong>XML Extraction</strong> (Legacy Schema Mapper) step instead.</p>` },
  { group: 'Pipeline', slug: 'translation', title: 'Translation', body: () => `
    <p class="lead">Extraction agents work in English. The <strong>Translate</strong> step converts parsed Markdown to English with Gemini 2.5 Flash while keeping headings, tables and page markers intact.</p>
    <ul>
      <li>Documents already in English are skipped (the translate button shows <em>Already in English</em>).</li>
      <li>Original quotes are preserved alongside the translation so that reviewers see the <strong>verbatim source text</strong> in the document viewer.</li>
      <li>For Pillar A with LlamaCloud direct extraction, the raw file is extracted in its native language and only the free-text fields (<span class="mono">fact_summary</span>, <span class="mono">exact_quote</span>, <span class="mono">reasoning</span>, <span class="mono">unit_context</span>) are translated afterwards by the <em>ExtractionTranslator</em>.</li>
    </ul>
    ${code(`{
  "step": "translate",
  "engine": "gemini-2.5-flash",
  "source_language": "ES",
  "target_language": "EN",
  "preserve": ["headings", "tables", "page_markers"]
}`)}` },
  { group: 'Pipeline', slug: 'pillar-a', title: 'Indicator extraction (Pillar A)', body: () => `
    <p class="lead">Pillar A extracts quantitative and qualitative facts mapped to specific SDG indicators (e.g. <span class="badge badge-sdg">SDG 11.1.1</span>). Each extraction carries the value, unit, year, a confidence score and the exact quote it was taken from.</p>
    <h2>Two engines</h2>
    ${table(['Engine', 'How', 'When to use'], [
      ['<strong>LlamaCloud Extract</strong> (default)', 'The raw file is uploaded with the <span class="mono">DocumentExtractionOutput</span> JSON schema; one extraction job per document. Native-language results are cached in <span class="mono">output/native_extraction/</span>.', 'Most projects — fewer LLM calls, no parse/translate cost for Pillar A.'],
      ['<strong>ADK Map-Reduce</strong>', 'One agent per (document × indicator) at temperature 0.0, then a reduce phase aggregates by SDG → Target → Indicator.', 'When the direct extractor is disabled in Settings → Pipeline, or for exotic schemas.'],
    ])}
    <h2>Output</h2>
    <p>One markdown file per (city × SDG) with a <span class="mono">🟢 FOUND</span> / <span class="mono">🔴 MISSED</span> status per indicator, plus the <em>Urban Data</em> sheet of the harmonized workbook. Every fact includes <span class="mono">source_document</span>, <span class="mono">page</span>, <span class="mono">paragraph</span> and <span class="mono">exact_quote</span>.</p>
    ${code(`{
  "indicator": "11.1.1",
  "fact_summary": "12.4% of the urban population lives in inadequate housing (2022).",
  "data_points": [{ "year": 2022, "value": 12.4, "unit": "%" }],
  "exact_quote": "…el 12,4 % de la población urbana reside en viviendas inadecuadas…",
  "source_document": "Housing_Affordability_Plan_2024.pdf",
  "page": 42,
  "paragraph": 3,
  "confidence": 0.94
}`)}
    <p>Use <strong>Force re-extract</strong> (Configure Project) to bypass the native extraction cache.</p>` },
  { group: 'Pipeline', slug: 'analysis', title: 'Quantitative analysis (A0–A4)', body: () => `
    <p class="lead">Indicators with structured data points go through the SDG Transformation Center methodology. An ADK agent per indicator calls deterministic Python tools for all the math; a YAML threshold registry supplies normalisation bounds with an LLM fallback for unknown indicators.</p>
    ${table(['Stage', 'Name', 'What happens'], [
      ['<strong>A0</strong>', 'Classification', 'Series classified as <em>A-SDG</em> (exact match), <em>A-Proxy</em> (weight 0.2) or <em>A-Context</em> (not normalised).'],
      ['<strong>A1</strong>', 'Normalization', 'Linear rescaling to 0–100 between defined lower/upper bounds; direct or reverse scaling depending on the indicator direction.'],
      ['<strong>A2</strong>', 'Trend analysis', 'Annual rate of change vs. the rate required to reach the 2030 target.'],
      ['<strong>A3</strong>', '2030 projection', 'Compound growth formula projects the latest value to 2030.'],
      ['<strong>A4</strong>', 'SDG aggregation', 'Weighted average of indicator scores → SDG-level rating band.'],
    ])}
    <h2>Rating bands</h2>
    <p><span class="badge badge-success">SDG Achievement ≥ 98</span> <span class="badge badge-info">Challenges Remain 90–97</span> <span class="badge badge-warning">Significant Challenges 80–89</span> <span class="badge badge-danger">Major Challenges &lt; 80</span></p>
    <p>The <strong>Trend comparison</strong> chart on the review page is drawn from the same series (<span class="mono">extraction.trend</span>); the direction arrow reflects A2.</p>` },
  { group: 'Pipeline', slug: 'pillar-c', title: 'Documentary (Pillar C)', body: () => `
    <p class="lead">Pillar C reads the document pool for explicitly stated <strong>Challenges (C1)</strong>, <strong>Commitments (C2)</strong> and <strong>Policies (C3)</strong>, aligned to the columns of the VLR Harmonised Spreadsheet.</p>
    <h2>Map-Reduce</h2>
    <ol class="doc-steps">
      <li><strong>Map</strong> — one <em>DocumentaryExtractionAgent</em> per (document × SDG) pair.</li>
      <li><strong>Reduce</strong> — results aggregated by SDG across all documents.</li>
      <li><strong>C5 consistency check</strong> — a <em>ConsistencyCheckAgent</em> flags substantive contradictions between documents (e.g. two different values for the same statistic). Flags appear as reviewer notes on the affected entries.</li>
    </ol>
    ${table(['Code', 'Category', 'Examples'], [
      ['<span class="badge badge-danger">C1</span>', 'Challenge', 'Barriers, obstacles, statistical disparities.'],
      ['<span class="badge badge-info">C2</span>', 'Commitment', 'Future-oriented goals, pledges, targets with a date.'],
      ['<span class="badge badge-success">C3</span>', 'Policy', 'Programmes currently executing or completed.'],
    ])}
    <p>On the review page the category is editable (C1/C2/C3) and the change is recorded with the editor's name.</p>` },
  { group: 'Pipeline', slug: 'pillar-b', title: 'Projects (Pillar B)', body: () => `
    <p class="lead">Pillar B extracts city projects and initiatives — name, status, budget, period and lead entity — and links each to one or more SDGs.</p>
    <ul>
      <li>One agent per (document × SDG) pair in the map phase.</li>
      <li>A <strong>merge agent</strong> deduplicates projects that are mentioned across several SDGs or documents (LLM-based fuzzy matching on name, lead and period).</li>
      <li>Output is organised by SDG in <span class="mono">{SDG}/Projects/</span> and feeds the <em>Projects</em> sheet of the workbook.</li>
    </ul>
    ${code(`{
  "project_name": "Madrid 360 Low-Emission Zone",
  "status": "In execution",
  "budget": "€142M",
  "period": "2021–2025",
  "lead": "Área de Medio Ambiente y Movilidad",
  "sdgs": ["11.2", "11.6", "13.2"],
  "source": { "document": "Madrid_Mobility_Plan.pdf", "page": 18 }
}`)}` },
  { group: 'Pipeline', slug: 'pillar-d', title: 'Stakeholders (Pillar D)', body: () => `
    <p class="lead">Pillar D captures community voices from workshop minutes, surveys and public consultations: priorities, challenges, recommendations and corrections, with the stakeholder group and the verbatim quote.</p>
    <ul>
      <li>Map phase per (document × SDG); reduce phase <strong>clusters</strong> similar insights thematically across documents.</li>
      <li>Each insight is categorised as <span class="badge badge-danger">Challenge</span>, <span class="badge badge-info">Priority</span>, <span class="badge badge-success">Recommendation</span> or <span class="badge badge-warning">Correction</span>.</li>
      <li>Engagement level (consulted / co-designed / informed) is recorded when stated in the source.</li>
    </ul>
    ${note('Stakeholder quotes are never paraphrased in the export — the harmonised sheet carries the original wording and its translation side by side.')}` },

  /* Review */
  { group: 'Review', slug: 'provenance', title: 'Traceability & provenance', body: () => `
    <p class="lead">Every extraction is linked to a document, a page, a paragraph and a highlighted quote. The <strong>Provenance Mapping</strong> step builds a lineage graph connecting source documents → parse → translation → extraction → analysis → export.</p>
    <h2>Provenance codes</h2>
    ${table(['Pattern', 'Refers to', 'Example'], [
      ['<span class="mono">{PRJ}-DOC-{n}</span>', 'A source document', '<span class="mono">MDC-DOC-429</span>'],
      ['<span class="mono">{PRJ}-RUN-{n}</span>', 'A pipeline run', '<span class="mono">MDC-RUN-002</span>'],
      ['<span class="mono">{PRJ}-PRJ-{n}</span>', 'A project lifecycle event', '<span class="mono">VAN-PRJ-001</span>'],
    ])}
    <h2>Where to see it</h2>
    <ul>
      <li><strong>Review page → Data Lineage &amp; Evidence:</strong> document, page/paragraph, quote with the extracted span highlighted, and the chain of tasks that produced the entry.</li>
      <li><strong>Document viewer:</strong> open with <span class="mono">?page=42&amp;hl=&lt;extractionId&gt;</span> to jump to the highlighted passage.</li>
      <li><strong>Audit Log:</strong> every event carries a provenance code; document codes open the document drawer. Export with <em>Export CSV</em>.</li>
      <li><strong>Workbook:</strong> a <em>Provenance</em> sheet lists document, page, paragraph, quote and task id per row.</li>
    </ul>
    <p>See the <a href="#/audit-log">Audit Log</a> for the live record.</p>` },
  { group: 'Review', slug: 'reviewing', title: 'Reviewing extractions', body: () => `
    <p class="lead">Open any extraction card on a project page to review it. The page shows the AI confidence, the editable fields for its pillar, the evidence and the trend.</p>
    ${table(['Action', 'Effect'], [
      ['<strong>Approve</strong>', 'Marks the entry as reviewed by you and moves to the next unreviewed entry of the same pillar.'],
      ['<strong>Save Changes</strong>', 'Commits inline edits (value, unit, name, category…). The editor is recorded.'],
      ['<strong>Reject &amp; Rerun</strong>', 'Asks for a reason, queues a targeted re-extraction on the same document and feeds the reason to the agent prompt.'],
      ['<strong>Report Mis-highlight</strong>', 'Flags a wrong quote span; the note is attached to the entry and used on rerun.'],
      ['<strong>Approve all</strong>', 'Project-level shortcut for entries you have already checked in bulk.'],
      ['<strong>+ Add entry</strong>', 'Adds a manual extraction (badge <em>Added manually</em>) when the pipeline missed something.'],
    ])}
    <h2>Confidence</h2>
    <p>Confidence is the extractor's self-reported certainty (0–100) calibrated on the validation set. Entries below 70 are sorted first in the pending list. Approved entries are excluded from rerun unless you unapprove them.</p>` },
  { group: 'Review', slug: 'feedback', title: 'Feedback & comments', body: () => `
    <p class="lead">Reviewer notes are first-class data. They are shown on the entry, exported with the workbook and <strong>fed back to the extraction agents on rerun</strong>.</p>
    ${table(['Kind', 'Created by', 'Used for'], [
      ['<span class="badge badge-neutral">Comment</span>', 'Add note on the review page', 'Context for other reviewers; exported in the notes column.'],
      ['<span class="badge badge-warning">Mis-highlight</span>', 'Report Mis-highlight', 'Tells the rerun agent which span is wrong.'],
      ['<span class="badge badge-danger">Rejection</span>', 'Reject &amp; Rerun', 'Becomes part of the rerun prompt for that document/indicator.'],
    ])}
    <p>Notes are attributed to the signed-in user and time-stamped; you can delete your own notes.</p>` },

  /* Outputs */
  { group: 'Outputs', slug: 'workbook', title: 'Harmonized workbook', body: () => `
    <p class="lead">The <strong>Harmonized Excel Export</strong> step writes the VLR Harmonised Spreadsheet used by the UN-Habitat reporting template.</p>
    ${table(['Sheet', 'Content'], [
      ['<strong>Urban Data</strong>', 'Pillar A values. Seeded from the 251 reference rows of the official template so that every indicator keeps its canonical row, code and unit even when no value was found.'],
      ['<strong>Projects</strong>', 'Pillar B projects, deduplicated, one row per project × SDG.'],
      ['<strong>Documentary</strong>', 'Pillar C entries with C1/C2/C3 category and consistency flags.'],
      ['<strong>Stakeholders</strong>', 'Pillar D insights with group, category and verbatim quote.'],
      ['<strong>Analysis</strong>', 'A0–A4 outputs: classification, normalised score, trend, 2030 projection and SDG rating.'],
      ['<strong>Provenance</strong>', 'Document, page, paragraph, quote, confidence and task id for every row.'],
    ])}
    <p>Generate it from a project (<strong>New Report → Harmonized workbook</strong>) or download an existing one from the project <em>History</em> tab. Choose <em>approved only</em> to exclude unreviewed entries.</p>` },
  { group: 'Outputs', slug: 'reports', title: 'Reports', body: () => `
    <p class="lead">Besides the workbook, VLR Forge produces an <strong>Obsidian markdown vault</strong> (one note per SDG with wiki-links to targets and indicators) and a <strong>narrative report</strong> (PDF/DOCX) composed by the VLR Report Composer.</p>
    ${table(['Format', 'Best for'], [
      ['<span class="mono">.xlsx</span>', 'Submission in the harmonised template; downstream dashboards.'],
      ['<span class="mono">.md</span> vault', 'Internal knowledge base; editing in Obsidian; git-friendly diffs between cycles.'],
      ['<span class="mono">.pdf / .docx</span>', 'The published VLR document; chapters per SDG with evidence footnotes.'],
    ])}
    <p>Report generation is a pipeline task and therefore has a cost and an audit entry like any other step. Reports are listed with size, format, creator and time on the project History tab.</p>` },

  /* VLR composition */
  { group: 'VLR composition', slug: 'chapters', title: 'Chapter composition', body: () => `
    <p class="lead">Once every extraction of a project is approved, <strong>Write VLR chapters</strong> queues one <em>Chapter Composer</em> task per reported SDG (goals with at least two accepted items) and a <em>Chapter Editor</em> that consolidates numbering and cross-references. The composer <strong>assembles and rephrases</strong> accepted evidence; it never calculates and never asserts anything new.</p>
    <h3>The chapter spine</h3>
    <p>Every chapter reproduces the same structure with verbatim-identical headings; data volume only changes which slots activate (tier <span class="mono">few</span> / <span class="mono">enough</span> / <span class="mono">lots</span>):</p>
    ${table(['Section', 'Content', 'Sources'], [
      ['N.1 Introduction', 'Why the goal was selected; global standing; regional standing; national priorities and a bridge sentence to the city. Box <em>National initiatives</em> when the national source names two or more programmes. Regional performance figure.', 'Global SDG Report 2026 · regional SDG index · Voluntary National Review'],
      ['N.2 Overview', 'What has data, which direction the trends point (improving / stable / worsening), the gaps named plainly, a roadmap sentence. No scores, no rating vocabulary.', 'Accepted evidence set'],
      ['N.3 Progress by Target', 'One subsection per target with accepted evidence — “Theme (Target n.n)”: what the target is about, the relevance cascade, the city finding copied with its numbers and hedges, the explanation from projects and documents, stakeholder voices, one interpretive close. Time series render as numbered figures.', 'Urban Data · Documentary · Projects · Stakeholder pillars'],
      ['N.4 National–Local Alignment', 'Where the country’s reporting and the chapter’s findings pull together, diverge or fill each other’s blind spots.', 'National source + the chapter itself'],
      ['N.5 Policy recommendations', 'A priority recommendation and supporting ones, each with responsible institutions, partners, implementation pathway, indicators and financing route.', 'The chapter’s own evidence'],
    ])}
    <p>Each run also emits a <strong>provenance map</strong> (every finding → extraction, document and page) and a <strong>gap report</strong> (tier decision, excluded items, skipped boxes, by-meaning assignments). Figures, boxes and footnotes run in continuous series across the whole book.</p>` },
  { group: 'VLR composition', slug: 'chapter-review', title: 'Reviewing chapters & the final VLR', body: () => `
    <p class="lead">Chapters are reviewed in the <strong>Chapters</strong> workspace with the <em>Chapter Reviewer</em>: describe what to change in plain language and the reviewer rewrites the chapter into a new version, highlighting every changed passage and logging the change in the gap report.</p>
    <h3>Feedback the reviewer understands</h3>
    ${table(['Ask', 'What happens'], [
      ['“Cite every claim”', 'Adds traceable, APA-style footnotes with page numbers; raw filenames in footnotes become full document titles.'],
      ['“Only what the sources say”', 'Removes explanations the data does not support (no guessing at <em>why</em>).'],
      ['“No rankings”', 'Removes strongest/weakest language — countries and cities are never ranked.'],
      ['“Add the global and regional layer”', 'Inserts the meta-analysis and national rungs above the city finding in each target subsection.'],
      ['“Target codes in headings”', 'Enforces the “Theme (Target n.n)” heading format (or removes codes on request).'],
      ['“Name the pillars”', 'States which evidence pillars support each finding.'],
      ['“Replace X with Y” · “Shorten the overview” · “Hedge…”', 'Targeted wording changes, trimming, or cautious language for low-confidence findings.'],
    ])}
    <p>Approve each chapter; when all are approved, <strong>Assemble final VLR</strong> produces the book: foreword, executive summary, introduction and methodology, city profile, the chapters, consolidated policy recommendations and a provenance annex. On the <strong>Final VLR</strong> page, highlight any passage to leave a comment or to ask the <em>VLR Editor</em> to revise it in place. <strong>Finalize</strong> publishes the review; <strong>Download</strong> produces Word (.docx), PDF or Markdown.</p>` },

  /* Reference */
  { group: 'Reference', slug: 'api', title: 'API', body: () => `
    <p class="lead">The FastAPI backend exposes the same operations as the dashboard. Authenticate with an API key from <a href="#/settings?tab=api">Settings → API keys</a> in the <span class="mono">Authorization: Bearer</span> header.</p>
    <h2>Start a workflow</h2>
    ${code(`POST /api/v1/workflow/start
Authorization: Bearer vlrf_live_…
Content-Type: application/json

{
  "project_id": "madrid-2024",
  "city": "Madrid",
  "sdgs": [1, 3, 4, 6, 7, 8, 11, 13],
  "steps": ["parse", "translate", "extract_indicators", "analyse",
            "documentary", "projects", "stakeholders", "export"],
  "options": {
    "use_llamacloud_extract": true,
    "force_reextract": false,
    "translation_target": "EN",
    "concurrency": 3
  }
}`, 'http')}
    ${code(`{
  "run_id": "run_madrid_3",
  "status": "queued",
  "tasks": 14,
  "estimated_cost_usd": 18.40
}`, 'response')}
    <h2>Poll status</h2>
    ${code(`GET /api/v1/workflow/run_madrid_3/status

{
  "run_id": "run_madrid_3",
  "status": "running",
  "progress": 0.42,
  "tasks": { "queued": 6, "running": 3, "success": 5, "failed": 0 },
  "cost_usd": 7.12
}`, 'http')}
    <h2>Other endpoints</h2>
    ${table(['Method', 'Path', 'Purpose'], [
      ['<span class="mono">POST</span>', '<span class="mono">/api/v1/projects/{id}/documents</span>', 'Upload one or more files (multipart). Returns provenance codes.'],
      ['<span class="mono">GET</span>', '<span class="mono">/api/v1/projects/{id}/extractions?pillar=indicators&amp;status=extracted</span>', 'List extractions with source and confidence.'],
      ['<span class="mono">POST</span>', '<span class="mono">/api/v1/extractions/{id}/approve</span>', 'Approve an entry (records the reviewer).'],
      ['<span class="mono">POST</span>', '<span class="mono">/api/v1/extractions/{id}/rerun</span>', 'Reject &amp; rerun with a <span class="mono">reason</span> body.'],
      ['<span class="mono">POST</span>', '<span class="mono">/api/v1/projects/{id}/reports</span>', 'Generate a workbook / vault / narrative report.'],
      ['<span class="mono">GET</span>', '<span class="mono">/api/v1/audit?project=madrid-2024&amp;since=2024-01-01</span>', 'Audit events, same columns as the Audit Log CSV.'],
    ])}
    ${note('Rate limit: 60 requests/minute per key. Webhooks for <span class="mono">run.finished</span> and <span class="mono">task.failed</span> can be configured under Settings → Notifications.', 'warning')}` },
  { group: 'Reference', slug: 'glossary', title: 'Glossary', body: () => table(['Term', 'Definition'], [
      ['<strong>VLR</strong>', 'Voluntary Local Review — a city or region\'s self-assessment of progress on the SDGs, modelled on national Voluntary National Reviews.'],
      ['<strong>Pillar</strong>', 'One of the four extraction tracks: A Indicators, B Projects, C Documentary, D Stakeholders.'],
      ['<strong>Harmonised Spreadsheet</strong>', 'The UN-Habitat Excel template with fixed columns for urban data, projects, documentary evidence and stakeholder input.'],
      ['<strong>Provenance code</strong>', 'Stable identifier of a document, run or project event (e.g. <span class="mono">MDC-DOC-429</span>).'],
      ['<strong>Extraction</strong>', 'One structured fact produced by a pillar agent, with source, quote and confidence.'],
      ['<strong>Map-Reduce</strong>', 'Agent pattern: many small agents (map) over document × SDG pairs, then aggregation/merge agents (reduce).'],
      ['<strong>ADK</strong>', 'Google Agent Development Kit — the framework used for extraction and analysis agents.'],
      ['<strong>LlamaParse / LlamaCloud Extract</strong>', 'LlamaIndex cloud services for document parsing and schema-driven extraction.'],
      ['<strong>SDG-TC bands</strong>', 'SDG Transformation Center rating bands: Achievement, Challenges Remain, Significant Challenges, Major Challenges.'],
      ['<strong>A-SDG / A-Proxy / A-Context</strong>', 'A0 classification of a data series: exact indicator match, proxy (weight 0.2), or context only.'],
      ['<strong>C1 / C2 / C3</strong>', 'Documentary categories: Challenge, Commitment, Policy.'],
      ['<strong>C5</strong>', 'Consistency check across documents for contradictory facts.'],
      ['<strong>Run</strong>', 'A batch of tasks started together (full pipeline, single step or rerun).'],
      ['<strong>Node</strong>', 'Compute/data-residency region a project is pinned to.'],
    ]) },
  { group: 'Reference', slug: 'shortcuts', title: 'Keyboard shortcuts', body: () => `
    <p class="lead">Shortcuts available in the dashboard.</p>
    ${table(['Keys', 'Where', 'Action'], [
      [kbd('Esc'), 'Everywhere', 'Close the open modal, drawer or menu.'],
      [kbd('Enter'), 'Prompt dialogs', 'Confirm.'],
      [kbd('Tab') + ' / ' + kbd('Shift') + '+' + kbd('Tab'), 'Everywhere', 'Move focus between controls; ' + kbd('Enter') + ' or ' + kbd('Space') + ' activates.'],
      [kbd('/'), 'Documentation', 'Focus the search box.'],
      [kbd('←') + ' / ' + kbd('→'), 'Documentation', 'Previous / next article.'],
      [kbd('Ctrl') + '+' + kbd('P'), 'Documentation', 'Print the current article.'],
    ])}
    <p>Search fields in the top bar filter live as you type; no shortcut is needed to apply them.</p>` },
  { group: 'Reference', slug: 'changelog', title: `Changelog ${APP_VERSION}`, body: () => `
    <p class="lead">Release notes for the current build (${esc(APP_VERSION)}). Earlier versions are summarised below.</p>
    <h2>${esc(APP_VERSION)} — Governance Dashboard</h2>
    <ul>
      <li><strong>Cost per step and per VLR.</strong> Every task, run, project header and orchestration panel now shows aggregated pipeline cost.</li>
      <li><strong>Project-level document pool.</strong> Uploads are no longer tied to a pillar; all four extractors scan the whole pool.</li>
      <li><strong>Audit Log → Export CSV</strong> including provenance codes and actors (requested in ticket TCK-1037).</li>
      <li><strong>LlamaCloud direct extraction</strong> for Pillar A with native-language cache and <em>force re-extract</em>.</li>
      <li><strong>Quantitative analysis A0–A4</strong> with SDG-TC rating bands and 2030 projections on the review page.</li>
      <li>Reviewer feedback (comments, mis-highlights, rejection reasons) is fed to rerun agents.</li>
      <li>Document viewer with page jump and highlighted extraction spans.</li>
      <li>Simulation speed control for demo environments.</li>
    </ul>
    <h2>V2.3.x</h2>
    <ul>
      <li>Pillar C consistency check (C5) and contradiction flags.</li>
      <li>Projects merge agent (Pillar B deduplication across SDGs).</li>
      <li>Obsidian vault writer with wiki-links to targets and indicators.</li>
    </ul>
    <h2>V2.2</h2>
    <ul>
      <li>Harmonized workbook export seeded from the 251 reference rows.</li>
      <li>Gemini translation step with page-marker preservation.</li>
    </ul>` },
];

const GROUPS = [...new Set(DOCS.map(d => d.group))];

/* Convert an article's HTML into readable Markdown (headings, lists, tables, fenced code). */
function htmlToMarkdown(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  const text = (n) => n.textContent.replace(/\s+/g, ' ').trim();
  const walk = (node) => {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out += n.textContent.replace(/\s+/g, ' '); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === 'button' || n.classList.contains('icon') || n.hasAttribute('data-lucide')) continue;
      if (tag === 'h2') out += `\n## ${text(n)}\n\n`;
      else if (tag === 'p') out += `${walk(n).trim()}\n\n`;
      else if (tag === 'ul' || tag === 'ol') { [...n.children].forEach((li, i) => { out += `${tag === 'ol' ? `${i + 1}.` : '-'} ${walk(li).trim()}\n`; }); out += '\n'; }
      else if (tag === 'table') {
        const rows = [...n.querySelectorAll('tr')].map(tr => [...tr.children].map(c => walk(c).trim().replace(/\|/g, '\\|')));
        if (rows.length) { out += `| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |\n`; rows.slice(1).forEach(r => { out += `| ${r.join(' | ')} |\n`; }); out += '\n'; }
      }
      else if (n.classList.contains('doc-code')) { const lang = text(n.querySelector('.doc-code-bar span')); out += `\`\`\`${lang}\n${n.querySelector('code')?.textContent || ''}\n\`\`\`\n\n`; }
      else if (n.classList.contains('callout')) out += `> ${walk(n).trim()}\n\n`;
      else if (tag === 'strong' || tag === 'b') out += `**${walk(n).trim()}**`;
      else if (tag === 'em' || tag === 'i') out += `_${walk(n).trim()}_`;
      else if (tag === 'kbd' || n.classList.contains('mono')) out += `\`${text(n)}\``;
      else if (tag === 'a') out += `[${walk(n).trim()}](${n.getAttribute('href') || ''})`;
      else if (n.classList.contains('doc-arrow')) out += ' → ';
      else out += walk(n);
    }
    return out;
  };
  return walk(root).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const findDoc = (slug) => DOCS.find(d => d.slug === slug);

export default {
  title: (ctx) => `${findDoc(ctx.local.doc || ctx.query.doc)?.title || 'Documentation'} · Docs`,
  render(ctx) {
    const L = ctx.local;
    if (L.init !== true) { L.init = true; L.q = ''; L.doc = findDoc(ctx.query.doc) ? ctx.query.doc : 'overview'; }
    if (ctx.query.doc && ctx.query.doc !== L.lastQueryDoc && findDoc(ctx.query.doc)) { L.doc = ctx.query.doc; }
    L.lastQueryDoc = ctx.query.doc;
    const doc = findDoc(L.doc) || DOCS[0];
    const idx = DOCS.indexOf(doc);
    const prev = DOCS[idx - 1], next = DOCS[idx + 1];
    const q = (L.q || '').trim().toLowerCase();
    const matches = (d) => !q || d.title.toLowerCase().includes(q) || d.group.toLowerCase().includes(q) || d.slug.includes(q);
    const visible = DOCS.filter(matches);

    ctx.topbar.innerHTML = `
      <div><div class="topbar-title">Documentation</div><div class="topbar-subtitle">VLR Forge ${esc(APP_VERSION)} · Product manual</div></div>
      <span class="grow"></span>
      <a class="btn btn-light" href="#/support">${icon('life-buoy', 'icon-sm')}Support</a>
      ${topbarActions()}`;

    ctx.content.innerHTML = `
    <div class="docs-page">
      <aside class="docs-nav">
        <div class="search docs-search">${icon('search')}<input class="input" id="docs-search" type="search" placeholder="Search docs..." value="${esc(L.q || '')}" autocomplete="off"></div>
        ${GROUPS.map(g => {
          const items = visible.filter(d => d.group === g);
          if (!items.length) return '';
          return `<div class="docs-group"><div class="docs-group-title">${esc(g)}</div>
            ${items.map(d => `<a class="docs-link ${d.slug === doc.slug ? 'active' : ''}" href="#/documentation?doc=${d.slug}" data-action="goto" data-doc="${d.slug}">${esc(d.title)}</a>`).join('')}
          </div>`;
        }).join('')}
        ${visible.length ? '' : `<div class="empty" style="padding:24px 8px">${icon('search-x')}<div class="empty-sub">No articles match “${esc(L.q)}”</div><button class="btn btn-ghost btn-sm" data-action="clear-search">Clear search</button></div>`}
        <div class="docs-nav-foot">
          <button class="btn btn-light btn-sm btn-block" data-action="download-md">${icon('download', 'icon-sm')}Download as Markdown</button>
        </div>
      </aside>
      <article class="docs-article card">
        <div class="docs-article-head">
          <div>
            <div class="docs-crumb">${esc(doc.group)} <span class="sep">/</span> ${esc(doc.title)}</div>
            <h1>${esc(doc.title)}</h1>
          </div>
          <div class="row" style="gap:6px">
            <button class="btn-icon" data-action="copy-link" data-tip="Copy link to this article">${icon('link')}</button>
            <button class="btn-icon" data-action="print" data-tip="Print article">${icon('printer')}</button>
          </div>
        </div>
        <div class="docs-body">${doc.body(ctx)}</div>
        <div class="docs-helpful">
          <span>Was this article helpful?</span>
          <button class="btn btn-light btn-sm" data-action="helpful" data-v="yes">${icon('thumbs-up', 'icon-sm')}Yes</button>
          <button class="btn btn-light btn-sm" data-action="helpful" data-v="no">${icon('thumbs-down', 'icon-sm')}No</button>
          ${L.helpful?.[doc.slug] ? `<span class="muted xs">Thanks — recorded “${esc(L.helpful[doc.slug])}”.</span>` : ''}
        </div>
        <div class="docs-pager">
          ${prev ? `<a class="docs-pager-link prev" href="#/documentation?doc=${prev.slug}" data-action="goto" data-doc="${prev.slug}">${icon('arrow-left', 'icon-sm')}<span><small>Prev</small>${esc(prev.title)}</span></a>` : '<span></span>'}
          ${next ? `<a class="docs-pager-link next" href="#/documentation?doc=${next.slug}" data-action="goto" data-doc="${next.slug}"><span><small>Next</small>${esc(next.title)}</span>${icon('arrow-right', 'icon-sm')}</a>` : '<span></span>'}
        </div>
      </article>
    </div>`;

    const go = (slug) => { if (!findDoc(slug)) return; L.doc = slug; L.lastQueryDoc = slug; navigate(`#/documentation?doc=${slug}`); ctx.rerender(); ctx.content.scrollTop = 0; window.scrollTo(0, 0); };

    const search = ctx.content.querySelector('#docs-search');
    const onInput = () => { L.q = search.value; ctx.rerender(); };
    search.addEventListener('input', onInput);

    const unbind = bindActions(ctx.content, {
      goto: (el, ev) => { ev.preventDefault(); go(el.dataset.doc); },
      'clear-search': () => { L.q = ''; ctx.rerender(); },
      'copy-link': () => { const url = `${location.origin}${location.pathname}#/documentation?doc=${doc.slug}`; copyToClipboard(url); toast.success('Link copied', url); },
      'copy-code': (el) => { const pre = el.closest('.doc-code')?.querySelector('code'); copyToClipboard(pre?.textContent || ''); toast.success('Copied to clipboard'); },
      print: () => window.print(),
      helpful: (el) => { L.helpful = L.helpful || {}; L.helpful[doc.slug] = el.dataset.v; ctx.rerender(); toast.success('Thanks for the feedback', el.dataset.v === 'yes' ? 'Glad it helped.' : 'We will review this article.'); },
      'download-md': () => {
        const md = DOCS.map(d => `# ${d.title}\n\n_${d.group}_\n\n${htmlToMarkdown(d.body(ctx))}\n`).join('\n---\n\n');
        download(`vlr-forge-docs-${APP_VERSION.toLowerCase()}.md`, `# VLR Forge ${APP_VERSION} — Documentation\n\n${md}`, 'text/markdown');
        toast.success('Documentation downloaded', `${DOCS.length} articles as Markdown`);
      },
    });

    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      const typing = ['input', 'textarea', 'select'].includes(tag) || e.target?.isContentEditable || document.querySelector('.modal-backdrop, .drawer, .menu');
      if (e.key === '/' && !typing) { e.preventDefault(); ctx.content.querySelector('#docs-search')?.focus(); }
      else if (e.key === 'ArrowLeft' && !typing && prev) go(prev.slug);
      else if (e.key === 'ArrowRight' && !typing && next) go(next.slug);
    };
    document.addEventListener('keydown', onKey);

    return () => { unbind(); search.removeEventListener('input', onInput); document.removeEventListener('keydown', onKey); };
  },
};
