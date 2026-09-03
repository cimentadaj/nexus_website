/* Document viewer — #/projects/:id/documents/:docId?page=42&hl=<extractionId> */
import { esc, icon, refreshIcons, fmtDateTime, fmtBytes, relTime, statusBadge, progressHtml, bindActions, toast, download, fileTypeIcon, copyToClipboard, clamp } from '../ui.js';
import { getDoc, getProject, getExtraction, getProjectExtractions, getProjectTasks, getProjectDocs } from '../store.js';
import { translateDocument, startParse } from '../actions.js';
import { openDocumentDrawer } from '../modals.js';
import { avatarButton } from '../shell.js';
import { navigate } from '../router.js';
import { STEP_META, PILLARS, quoteToHtml, quotePlain, parsedDocMeta } from '../seed.js';

/* Original-language sentence banks — same shapes as the English arrays, so the
 * original page mirrors the translated page sentence by sentence. */
const LANG_BANKS = {
  ES: {
    SUBJECTS: ['El pleno municipal', 'La administración municipal', 'El Área de Urbanismo', 'El Área de Medio Ambiente y Movilidad', 'La empresa municipal de vivienda', 'La autoridad metropolitana de transporte', 'El servicio de salud pública', 'La oficina de estadística', 'La oficina de presupuestos participativos', 'La empresa de aguas'],
    VERBS: ['ha aprobado', 'informa de', 'se compromete a', 'confirma', 'ha revisado', 'está ejecutando', 'ha priorizado', 'ha destinado recursos a', 'supervisa', 'ha consolidado'],
    OBJECTS: ['un programa por fases de rehabilitación energética del parque público de edificios', 'la ampliación de los corredores de autobús de alta frecuencia a los distritos exteriores', 'un conjunto de indicadores armonizados con la Agenda 2030', 'la ampliación de la vivienda asequible en alquiler sobre suelo municipal', 'el seguimiento por distritos de la calidad del aire y del ruido', 'la renaturalización de las riberas y la creación de nuevos corredores verdes', 'un ciclo de consulta ciudadana con asociaciones vecinales y consejos de juventud', 'programas de empleo dirigidos a residentes menores de 25 años', 'una zona de bajas emisiones que cubre todo el término municipal', 'la digitalización de los servicios municipales con canales accesibles'],
    TAILS: ['en línea con el marco del Informe Local Voluntario.', 'según el plan estratégico del mandato en curso.', 'con información anual al pleno del ayuntamiento.', 'condicionado a la disponibilidad de fondos europeos de recuperación.', 'siguiendo las recomendaciones de la evaluación de 2022.', 'en cooperación con el gobierno regional.', 'con metas cuantitativas revisadas cada dos años.', 'y publica datos desagregados en el portal de datos abiertos.', 'garantizando la coherencia con los indicadores ODS nacionales.', 'con una perspectiva explícita de género y edad.'],
    NUM_SENT: ['Entre {y1} y {y2} el indicador pasó del {a}% al {b}%, una variación que los servicios técnicos atribuyen a las medidas descritas.', 'El presupuesto asignado a esta línea asciende a {m} millones de euros para el periodo {y1}–{y2}, del que ya se ha ejecutado el {p}%.', 'En {y2} se completaron {n} actuaciones, que cubren el {p}% de los distritos con mayor necesidad.', 'Los datos de la encuesta de {y2}, con {n} hogares, indican una satisfacción del {b}%, frente al {a}% de {y1}.'],
    HEADINGS: ['Contexto y línea de base', 'Marco de políticas', 'Avance de las metas', 'Fuentes de datos y metodología', 'Análisis territorial', 'Participación de los agentes', 'Financiación y recursos', 'Próximos pasos y compromisos', 'Mecanismos de seguimiento', 'Alineamiento con la Agenda 2030'],
    pageWord: 'página',
  },
  FR: {
    SUBJECTS: ['Le conseil municipal', 'L’administration municipale', 'La direction de l’urbanisme', 'La direction de l’environnement et de la mobilité', 'L’office du logement', 'L’autorité métropolitaine des transports', 'Le service de santé publique', 'L’office des statistiques', 'Le bureau du budget participatif', 'La régie des eaux'],
    VERBS: ['a adopté', 'fait état de', 's’engage à', 'confirme', 'a réexaminé', 'met en œuvre', 'a priorisé', 'a affecté des ressources à', 'assure le suivi de', 'a consolidé'],
    OBJECTS: ['un programme par étapes de rénovation énergétique du parc public de bâtiments', 'l’extension des couloirs de bus à haute fréquence vers les quartiers périphériques', 'un ensemble d’indicateurs harmonisés avec l’Agenda 2030', 'le développement du logement locatif abordable sur le foncier municipal', 'le suivi par quartier de la qualité de l’air et du bruit', 'la renaturation des berges et la création de nouveaux corridors verts', 'un cycle de consultation citoyenne avec les associations de quartier et les conseils de jeunesse', 'des dispositifs d’emploi ciblant les résidents de moins de 25 ans', 'une zone à faibles émissions couvrant l’ensemble du territoire municipal', 'la numérisation des services municipaux avec des canaux accessibles'],
    TAILS: ['conformément au cadre de l’Examen Local Volontaire.', 'tel que prévu par le plan stratégique du mandat en cours.', 'avec un rapport annuel au conseil municipal.', 'sous réserve de la disponibilité des fonds européens de relance.', 'suivant les recommandations de l’évaluation de 2022.', 'en coopération avec le gouvernement régional.', 'avec des cibles quantitatives révisées tous les deux ans.', 'et publie des données désagrégées sur le portail open data.', 'en cohérence avec les indicateurs ODD nationaux.', 'avec une perspective explicite de genre et d’âge.'],
    NUM_SENT: ['Entre {y1} et {y2}, l’indicateur est passé de {a}% à {b}%, une évolution que les services techniques attribuent aux mesures décrites.', 'Le budget alloué à cette ligne s’élève à {m} millions d’euros pour la période {y1}–{y2}, dont {p}% déjà exécutés.', 'Au total, {n} interventions ont été achevées en {y2}, couvrant {p}% des quartiers les plus en difficulté.', 'L’enquête de {y2}, menée auprès de {n} ménages, indique un taux de satisfaction de {b}%, contre {a}% en {y1}.'],
    HEADINGS: ['Contexte et référence', 'Cadre d’action publique', 'Progrès vers les cibles', 'Sources de données et méthodologie', 'Analyse territoriale', 'Participation des parties prenantes', 'Financement et ressources', 'Prochaines étapes et engagements', 'Dispositifs de suivi', 'Alignement sur l’Agenda 2030'],
    pageWord: 'page',
  },
  PT: {
    SUBJECTS: ['A câmara municipal', 'A administração municipal', 'O departamento de urbanismo', 'O departamento de ambiente e mobilidade', 'A empresa municipal de habitação', 'A autoridade metropolitana de transportes', 'O serviço de saúde pública', 'O gabinete de estatística', 'O gabinete do orçamento participativo', 'A empresa das águas'],
    VERBS: ['aprovou', 'reporta', 'compromete-se a', 'confirma', 'reviu', 'está a executar', 'priorizou', 'afetou recursos a', 'monitoriza', 'consolidou'],
    OBJECTS: ['um programa faseado de reabilitação energética do parque público de edifícios', 'a extensão dos corredores de autocarro de alta frequência aos bairros periféricos', 'um conjunto de indicadores harmonizados com a Agenda 2030', 'o alargamento da habitação acessível para arrendamento em solo municipal', 'a monitorização por freguesia da qualidade do ar e do ruído', 'a renaturalização das margens e a criação de novos corredores verdes', 'um ciclo de consulta cidadã com associações de moradores e conselhos de juventude', 'programas de emprego dirigidos a residentes com menos de 25 anos', 'uma zona de baixas emissões que cobre todo o território municipal', 'a digitalização dos serviços municipais com canais acessíveis'],
    TAILS: ['em linha com o quadro do Relatório Local Voluntário.', 'conforme o plano estratégico do mandato em curso.', 'com reporte anual à assembleia municipal.', 'condicionado à disponibilidade de fundos europeus de recuperação.', 'seguindo as recomendações da avaliação de 2022.', 'em cooperação com o governo regional.', 'com metas quantitativas revistas de dois em dois anos.', 'e publica dados desagregados no portal de dados abertos.', 'garantindo coerência com os indicadores ODS nacionais.', 'com uma perspetiva explícita de género e idade.'],
    NUM_SENT: ['Entre {y1} e {y2} o indicador passou de {a}% para {b}%, variação que os serviços técnicos atribuem às medidas descritas.', 'O orçamento afetado a esta linha ascende a {m} milhões de euros no período {y1}–{y2}, dos quais {p}% já executados.', 'Em {y2} foram concluídas {n} intervenções, cobrindo {p}% das freguesias com maior necessidade.', 'Os dados do inquérito de {y2}, com {n} agregados, indicam uma satisfação de {b}%, face a {a}% em {y1}.'],
    HEADINGS: ['Contexto e linha de base', 'Quadro de políticas', 'Progresso das metas', 'Fontes de dados e metodologia', 'Análise territorial', 'Envolvimento das partes interessadas', 'Financiamento e recursos', 'Próximos passos e compromissos', 'Mecanismos de acompanhamento', 'Alinhamento com a Agenda 2030'],
    pageWord: 'página',
  },
};

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

function sentence(r, year, bank) {
  const B = bank || { SUBJECTS, VERBS, OBJECTS, TAILS, NUM_SENT };
  if (r() < 0.3) {
    const y2 = year - Math.floor(r() * 2), y1 = y2 - 2 - Math.floor(r() * 3);
    const a = (5 + r() * 60).toFixed(1), b = (5 + r() * 60).toFixed(1);
    return B.NUM_SENT[Math.floor(r() * B.NUM_SENT.length)].replace('{y1}', y1).replace('{y2}', y2).replace('{a}', a).replace('{b}', b).replace('{m}', Math.round(5 + r() * 300)).replace('{p}', Math.round(20 + r() * 75)).replace('{n}', Math.round(10 + r() * 900));
  }
  return `${B.SUBJECTS[Math.floor(r() * B.SUBJECTS.length)]} ${B.VERBS[Math.floor(r() * B.VERBS.length)]} ${B.OBJECTS[Math.floor(r() * B.OBJECTS.length)]} ${B.TAILS[Math.floor(r() * B.TAILS.length)]}`;
}
/** Deterministic page content: { heading, paragraphs: [string] } — stable for docId+page. */
function pageText(doc, page, project, bank = null) {
  const r = prng(`${doc.id}|${page}`);
  const year = project?.year || 2024;
  const section = `${1 + Math.floor((page - 1) / Math.max(1, Math.ceil(doc.pages / 8)))}.${1 + (page % 4)}`;
  const H = bank?.HEADINGS || HEADINGS;
  const heading = `${section} ${H[Math.floor(r() * H.length)]}`;
  const nPar = 3 + Math.floor(r() * 3);
  const paragraphs = [];
  for (let i = 0; i < nPar; i++) {
    const nS = 2 + Math.floor(r() * 3);
    const s = [];
    for (let k = 0; k < nS; k++) s.push(sentence(r, year, bank));
    paragraphs.push(s.join(' '));
  }
  return { heading, paragraphs };
}
function docTitle(doc) { return doc.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '); }

function markdownRendition(doc, project, exts) {
  const lines = [`# ${docTitle(doc)}`, '', `- Provenance code: ${doc.code}`, `- Language: ${doc.language} · Pages: ${doc.pages} · Size: ${fmtBytes(doc.sizeKb)}`, `- Project: ${project?.name || doc.projectId}`, `- Status: ${doc.status}${doc.parsedAt ? ` · parsed ${fmtDateTime(doc.parsedAt)}` : ''}`, `- Rendition generated by VLR Forge on ${fmtDateTime(Date.now())}`, ''];
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
      if (ctx.query.page || local.hl) local.pendingScroll = { page: local.page, hl: local.hl };
    }
    local.page = clamp(Number(local.page) || 1, 1, doc.pages);
    local.zoom = ZOOMS.includes(local.zoom) ? local.zoom : 100;
    local.jump = local.jump ?? '';
    const page = local.page;
    const hlExt = local.hl ? getExtraction(local.hl) : null;
    const bank = LANG_BANKS[doc.language];
    const canOrig = doc.language !== 'EN' && doc.translated && !!bank;
    const orig = canOrig && ctx.local.dvLang === 'orig';
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
        <div class="topbar-subtitle">${esc(doc.code)} · ${esc(doc.language)}${doc.translated && doc.language !== 'EN' ? ` → ${esc(doc.translatedTo || 'EN')}` : ''}</div>
      </div>
      <span class="grow"></span>
      ${doc.language !== 'EN' ? `<button class="btn btn-light" data-action="translate" ${canTranslate ? '' : 'disabled'} data-tip="${canTranslate ? `Translate ${esc(doc.language)} → EN (Gemini)` : translating ? 'Translation in progress' : 'Already translated to EN'}">${icon('languages', 'icon-sm')}Translate</button>` : ''}
      <button class="btn btn-light" data-action="download" data-tip="Download a Markdown rendition of the parsed text">${icon('download', 'icon-sm')}Download</button>
      <button class="btn btn-soft" data-action="details">${icon('info', 'icon-sm')}Details</button>
      ${avatarButton()}`;

    /* ----- page canvas: continuous vertical scroll, every page rendered ----- */
    const cacheKey = [doc.id, doc.status, Math.round((doc.progress || 0) / 5), orig ? 'orig' : 'en', hlExt?.id || '', exts.map(e => e.id + ':' + e.source?.page).join(','), project?.year || ''].join('|');
    if (local.cacheKey !== cacheKey) {
      const sheets = [];
      for (let p = 1; p <= doc.pages; p++) {
        const t = pageText(doc, p, project, orig ? bank : null);
        const pageExts = exts.filter(e => Number(e.source?.page) === p);
        const paras = t.paragraphs.map((par, i) => {
          const before = (i === 1 && !orig) ? pageExts.map(e => `<p class="dv-para dv-extract ${hlExt?.id === e.id ? 'dv-hl-active' : ''}" id="dv-ext-${esc(e.id)}" data-action="focus-ext" data-id="${esc(e.id)}" data-tip="Extraction SDG ${esc(e.sdg)} · ${esc(e.title)} — click to open review">${quoteToHtml(e.source.quote, esc)}<span class="dv-ext-tag">${icon('link', 'icon-xs')}SDG ${esc(e.sdg)} · ¶${Number(e.source.paragraph) || 1}</span></p>`).join('') : '';
          return `${before}<p class="dv-para">${esc(par)}</p>`;
        }).join('');
        sheets.push(`<article class="dv-sheet" id="dv-page-${p}" data-page="${p}">
            <header class="dv-sheet-head"><span>${esc(docTitle(doc))} — ${orig && bank?.pageWord ? esc(bank.pageWord) : 'page'} ${p}</span><span class="mono">${esc(doc.code)}</span></header>
            ${p === 1 && doc.status === 'uploaded' && !parsing ? `<div class="dv-notice">${icon('clock')}<div><strong>Not parsed yet.</strong> Text below is a preview rendition; run the parser to extract the real page content.</div><button class="btn btn-outline btn-sm" data-action="parse">${icon('play', 'icon-sm')}Start parse</button></div>` : ''}
            ${p === 1 && doc.status === 'uploaded' && parsing ? `<div class="dv-notice">${icon('clock')}<div class="grow"><strong>Parse queued.</strong> The parser will pick this document up shortly; text below is a preview rendition.</div></div>` : ''}
            ${p === 1 && doc.status === 'parsing' ? `<div class="dv-notice">${icon('loader-2', 'spin')}<div class="grow"><strong>Parsing in progress</strong> — ${doc.progress || 0}% ${progressHtml(doc.progress || 0, 'sky striped sm')}</div></div>` : ''}
            <h2 class="dv-heading-text">${esc(t.heading)}</h2>
            ${paras}
            <footer class="dv-sheet-foot"><span>${esc(project?.jurisdiction || project?.name || '')}</span><span>${p} / ${doc.pages}</span></footer>
          </article>`);
      }
      local.cacheKey = cacheKey; local.sheetsHtml = sheets.join('');
    }

    ctx.content.innerHTML = `
    <div class="dv-layout">
      <div class="dv-main">
        <div class="card dv-toolbar">
          <div class="row gap-6">
            <button class="btn btn-light btn-sm dv-nav" data-action="prev" data-tip="Previous page (←)">${icon('chevron-left', 'icon-sm')}</button>
            <span class="dv-pageno">Page <strong id="dv-pageno-cur">${page}</strong> / ${doc.pages}</span>
            <button class="btn btn-light btn-sm dv-nav" data-action="next" data-tip="Next page (→)">${icon('chevron-right', 'icon-sm')}</button>
          </div>
          <div class="row gap-6 dv-jump">
            <label class="xs muted" for="dv-jump">Go to</label>
            <input class="input dv-jump-input" id="dv-jump" type="number" min="1" max="${doc.pages}" placeholder="${page}" value="${esc(local.jump)}">
            <button class="btn btn-light btn-sm" data-action="jump">Go</button>
          </div>
          <span class="grow"></span>
          <div class="row gap-6">
            ${canOrig ? `<span class="dv-langswitch" role="tablist">
              <button class="dv-lang ${orig ? '' : 'on'}" data-action="dv-lang" data-lang="en" data-tip="Translated markdown (used by the pillars)">EN · translated</button>
              <button class="dv-lang ${orig ? 'on' : ''}" data-action="dv-lang" data-lang="orig" data-tip="Original document as parsed">${esc(doc.language)} · original</button>
            </span>` : ''}
            ${orig && exts.length ? `<span class="xs muted" data-tip="Extraction quotes are anchored to the translated text">${icon('highlighter', 'icon-xs')} highlights in EN view</span>` : ''}
            ${hlExt && !orig ? `<span class="badge badge-sky dv-hl-badge" data-action="focus-ext" data-id="${esc(hlExt.id)}" data-tip="Jump to highlighted evidence">${icon('highlighter', 'icon-xs')}SDG ${esc(hlExt.sdg)} · p.${Number(hlExt.source.page)}</span><button class="btn-icon" data-action="clear-hl" data-tip="Clear highlight" aria-label="Clear highlight">${icon('x', 'icon-sm')}</button>` : ''}
            <label class="xs muted" for="dv-zoom">Zoom</label>
            <select class="select select-sm" id="dv-zoom">${ZOOMS.map(z => `<option value="${z}" ${z === local.zoom ? 'selected' : ''}>${z}%</option>`).join('')}</select>
          </div>
        </div>

        <div class="dv-canvas-wrap" style="--dv-scale:${(local.zoom / 100).toFixed(2)}">
          ${local.sheetsHtml}
        </div>
      </div>

      <aside class="dv-side">
        <section class="card">
          <div class="card-header tinted"><div class="card-title-caps">${icon('sparkles', 'icon-sm')}Extractions on this document</div><span class="badge badge-neutral">${exts.length}</span></div>
          <div class="dv-ext-list">
            ${exts.length ? exts.map(e => {
              const pl = PILLARS.find(p => p.key === e.pillar);
              return `<div class="dv-ext-item  ${hlExt?.id === e.id ? 'active' : ''}" data-action="goto" data-page="${Number(e.source.page) || 1}" data-hl="${esc(e.id)}">
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
            ${doc.status === 'processed' ? (() => { const x = parsedDocMeta(doc, project); return `
            <div class="dv-meta-group">${icon('scan-text', 'icon-xs')}Extracted by the parser</div>
            <dl class="kv dv-kv dv-kv-parser">
              <dt>Document Title</dt><dd>${esc(x.title)}</dd>
              <dt>Document Type</dt><dd>${esc(x.type)}</dd>
              <dt>Type Extension</dt><dd class="mono">${esc(x.ext)}</dd>
              <dt>Year of Publication</dt><dd>${esc(x.year)}</dd>
              <dt>Issuing Body</dt><dd>${esc(x.issuing)}</dd>
            </dl>
            <div class="dv-meta-group">${icon('database', 'icon-xs')}File</div>`; })() : ''}
            <dl class="kv dv-kv">
              <dt>Provenance</dt><dd class="mono"><span>${esc(doc.code)}</span><button type="button" class="btn-icon" data-action="copy-code" data-tip="Copy code" aria-label="Copy provenance code">${icon('copy', 'icon-xs')}</button></dd>
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


        ${siblings.length > 1 ? `<section class="card">
          <div class="card-header tinted"><div class="card-title-caps">${icon('folder-open', 'icon-sm')}Other documents</div></div>
          <div class="dv-sibling-list">${siblings.filter(d => d.id !== doc.id).slice(0, 6).map(d => `<a class="dv-sibling" href="#/projects/${esc(d.projectId)}/documents/${esc(d.id)}">${fileTypeIcon(d.name)}<span class="truncate">${esc(d.name)}</span><span class="xs muted">${d.pages}p</span></a>`).join('')}</div>
        </section>` : ''}
      </aside>
    </div>`;
    ctx.footer.innerHTML = '';

    /* ----- one-shot scroll: deep links (?page / ?hl) and highlight jumps ----- */
    if (local.pendingScroll) {
      const { page: tp, hl } = local.pendingScroll; local.pendingScroll = null;
      setTimeout(() => {
        const el = (hl && ctx.content.querySelector(`#dv-ext-${CSS.escape(hl)}`)) || ctx.content.querySelector('#dv-page-' + tp);
        el?.scrollIntoView({ behavior: 'smooth', block: hl ? 'center' : 'start' });
      }, 80);
    }

    /* ----- inputs ----- */
    const jumpEl = ctx.content.querySelector('#dv-jump');
    const setPageNo = (n) => { const el = ctx.content.querySelector('#dv-pageno-cur'); if (el) el.textContent = n; };
    const goto = (p, hl) => {
      const target = clamp(Number(p) || 1, 1, doc.pages);
      local.jump = '';
      if (hl !== undefined && hl !== local.hl) { local.hl = hl; local.page = target; local.pendingScroll = { page: target, hl }; ctx.rerender(); return; }
      local.page = target; setPageNo(target);
      ctx.content.querySelector('#dv-page-' + target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    jumpEl.addEventListener('input', () => { local.jump = jumpEl.value; });
    jumpEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); handlers.jump(); } });
    ctx.content.querySelector('#dv-zoom').addEventListener('change', (ev) => { local.zoom = Number(ev.target.value); ctx.rerender(); });
    ctx.content.querySelectorAll('[data-action="dv-lang"]').forEach(b => b.addEventListener('click', () => { ctx.local.dvLang = b.dataset.lang; ctx.rerender(); }));

    const handlers = {
      prev: () => goto(local.page - 1), next: () => goto(local.page + 1),
      jump: () => {
        const v = Math.trunc(Number(jumpEl.value));
        if (!jumpEl.value.trim() || Number.isNaN(v)) { jumpEl.focus(); return; }
        const target = clamp(v, 1, doc.pages);
        if (target !== v) toast.warning('Page out of range', `This document has ${doc.pages} pages — showing page ${target}.`);
        goto(target);
      },
      goto: (el, ev) => { if (ev.target.closest('a')) return; ev.stopPropagation(); goto(el.dataset.page, el.dataset.hl); },
      'clear-hl': () => { local.hl = null; ctx.rerender(); },
      'focus-ext': (el, ev) => {
        if (ev.target.closest('a')) return;
        const e = getExtraction(el.dataset.id);
        if (!e) return;
        if (el.classList.contains('dv-hl-badge')) { goto(e.source.page, e.id); return; }
        navigate(`#/review/${e.id}`);
      },
      translate: () => { if (!canTranslate) return; translateDocument(doc.id); toast.info('Translation queued', `${doc.name} (${doc.language} → EN)`); },
      parse: () => { if (parsing) return; startParse(doc.id); toast.info('Parsing queued', doc.name); },
      download: () => { const md = markdownRendition(doc, project, exts); download(doc.name.replace(/\.[a-z0-9]+$/i, '') + '.md', md, 'text/markdown'); toast.success('Download started', `${docTitle(doc)} · Markdown rendition (${doc.pages} pages)`); },
      details: () => openDocumentDrawer(doc.id),
      'copy-code': () => { copyToClipboard(doc.code); toast.success('Copied', doc.code); },
    };
    const unbindContent = bindActions(ctx.content, handlers);
    const unbindTop = bindActions(ctx.topbar, handlers);

    const onKey = (ev) => {
      if (ev.target?.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('.modal, .modal-backdrop, .drawer, .menu')) return;
      if (ev.key === 'ArrowLeft' && local.page > 1) { ev.preventDefault(); goto(local.page - 1); }
      else if (ev.key === 'ArrowRight' && local.page < doc.pages) { ev.preventDefault(); goto(local.page + 1); }
    };
    document.addEventListener('keydown', onKey);
    // scroll spy: keep the "Page X / N" indicator in sync while scrolling (no re-render)
    let spyPending = false;
    const onScroll = () => {
      if (spyPending) return; spyPending = true;
      requestAnimationFrame(() => {
        spyPending = false;
        let cur = 1;
        for (const sh of ctx.content.querySelectorAll('.dv-sheet')) { if (sh.getBoundingClientRect().top <= 140) cur = Number(sh.dataset.page); else break; }
        if (cur !== local.page) { local.page = cur; setPageNo(cur); }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    refreshIcons(ctx.content);
    return () => { unbindContent(); unbindTop(); document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll); };
  },
};
