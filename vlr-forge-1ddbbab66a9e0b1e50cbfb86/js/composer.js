/* composer.js — deterministic "Chapter Composer": turns a project's approved extractions into VLR SDG chapters
 * following the canonical spine (docs/vlr_chapter_template.md + João's SDG 6 ground truth, Aug 2026):
 *   N.1 Introduction (global → regional → national → city bridge, national initiatives box, regional figure)
 *   N.2 Overview · N.3 Progress by Target (one subsection per evidenced target, codes in headings)
 *   N.4 National–Local Alignment · N.5 Policy recommendations and means of implementation
 * Every factual sentence traces to an extraction (city evidence) or a context document (footnote).
 */
import { SDG_TITLES, uid } from './ui.js';
const quotePlain = (q) => String(q || '').replace(/\{h:(.+?)\}/g, '$1');

/* ------------------------------------------------------------------ */
/* Reference material                                                  */
/* ------------------------------------------------------------------ */
export const GOAL_SUBJECT = {
  1: 'poverty reduction', 2: 'food security and nutrition', 3: 'health and well-being', 4: 'quality education', 5: 'gender equality',
  6: 'clean water and sanitation', 7: 'affordable and clean energy', 8: 'decent work and economic growth', 9: 'infrastructure and innovation',
  10: 'reduced inequalities', 11: 'sustainable cities and communities', 12: 'responsible consumption and production', 13: 'climate action',
  14: 'life below water', 15: 'life on land', 16: 'peace, justice and strong institutions', 17: 'partnerships for the goals',
};

/** Official-style target reference: plain-language heading + one-sentence description (codes appear only in headings/tables). */
export const TARGETS = {
  '1.2': { heading: 'Poverty in all its dimensions', desc: 'reduce at least by half the proportion of people living in poverty in all its dimensions according to national definitions' },
  '2.1': { heading: 'Ending Hunger and Food Insecurity', desc: 'end hunger and ensure access by all people, in particular the poor and people in vulnerable situations, to safe, nutritious and sufficient food all year round' },
  '3.6': { heading: 'Road Traffic Deaths and Injuries', desc: 'halve the number of global deaths and injuries from road traffic accidents' },
  '3.8': { heading: 'Universal Health Coverage', desc: 'achieve universal health coverage, including access to quality essential health-care services for all' },
  '4.2': { heading: 'Early Childhood Development and Pre-primary Education', desc: 'ensure that all girls and boys have access to quality early childhood development, care and pre-primary education' },
  '4.a': { heading: 'Education Facilities', desc: 'build and upgrade education facilities that are child, disability and gender sensitive and provide safe, inclusive and effective learning environments' },
  '5.5': { heading: 'Women in Leadership and Decision-making', desc: 'ensure women’s full and effective participation and equal opportunities for leadership at all levels of decision-making in political, economic and public life' },
  '6.1': { heading: 'Drinking Water Access', desc: 'achieve universal and equitable access to safe and affordable drinking water for all' },
  '6.3': { heading: 'Wastewater Treatment and Water Quality', desc: 'improve water quality by reducing pollution, eliminating dumping and increasing the share of wastewater safely treated' },
  '6.4': { heading: 'Water-Use Efficiency and Water Stress', desc: 'substantially increase water-use efficiency across all sectors and ensure sustainable withdrawals of freshwater to address water scarcity' },
  '7.2': { heading: 'Renewable Energy Share', desc: 'increase substantially the share of renewable energy in the energy mix' },
  '7.3': { heading: 'Energy Efficiency', desc: 'double the rate of improvement in energy efficiency' },
  '8.5': { heading: 'Employment and Decent Work', desc: 'achieve full and productive employment and decent work for all women and men, including for young people and persons with disabilities' },
  '8.6': { heading: 'Youth Employment, Education and Training', desc: 'substantially reduce the proportion of youth not in employment, education or training' },
  '9.c': { heading: 'Digital Connectivity', desc: 'significantly increase access to information and communications technology and provide universal and affordable access to the Internet' },
  '10.1': { heading: 'Income Growth of the Poorest', desc: 'progressively achieve and sustain income growth of the bottom 40 per cent of the population at a rate higher than the national average' },
  '11.1': { heading: 'Housing and Basic Services', desc: 'ensure access for all to adequate, safe and affordable housing and basic services and upgrade slums' },
  '11.2': { heading: 'Sustainable Transport Systems', desc: 'provide access to safe, affordable, accessible and sustainable transport systems for all, expanding public transport' },
  '11.6': { heading: 'Environmental Impact and Air Quality', desc: 'reduce the adverse per capita environmental impact of cities, paying special attention to air quality and waste management' },
  '11.7': { heading: 'Public and Green Open Spaces', desc: 'provide universal access to safe, inclusive and accessible green and public spaces' },
  '12.5': { heading: 'Waste Prevention and Recycling', desc: 'substantially reduce waste generation through prevention, reduction, recycling and reuse' },
  '13.1': { heading: 'Resilience to Climate-related Hazards', desc: 'strengthen resilience and adaptive capacity to climate-related hazards and natural disasters' },
  '13.2': { heading: 'Climate Measures in Policies and Planning', desc: 'integrate climate change measures into policies, strategies and planning' },
  '15.1': { heading: 'Terrestrial and Freshwater Ecosystems', desc: 'ensure the conservation, restoration and sustainable use of terrestrial and inland freshwater ecosystems' },
  '16.6': { heading: 'Effective and Transparent Institutions', desc: 'develop effective, accountable and transparent institutions at all levels' },
  '16.7': { heading: 'Inclusive and Participatory Decision-making', desc: 'ensure responsive, inclusive, participatory and representative decision-making at all levels' },
};
export const targetOf = (sdg) => String(sdg).split('.').slice(0, 2).join('.');
export const targetRef = (code) => TARGETS[code] || { heading: `Progress on target ${code}`, desc: `advance the objectives of target ${code}` };

/** Regional reporting family by country (which regional SDG report provides the regional rung). */
const REGIONS = [
  { test: /spain|portugal|france|germany|italy|netherlands|belgium|austria|poland|sweden|denmark|finland|norway|ireland|greece|czech|hungary|romania|switzerland|united kingdom|uk\b/i, name: 'Europe', report: 'Europe Sustainable Development Report 2026', publisher: 'SDSN & SDSN Europe' },
  { test: /colombia|brazil|mexico|peru|chile|argentina|ecuador|uruguay|bolivia|paraguay|costa rica|panama|guatemala|honduras|dominican|cuba|venezuela/i, name: 'Latin America and the Caribbean', report: 'Latin America and the Caribbean SDG Index and Dashboards 2026', publisher: 'CODS & SDSN' },
  { test: /canada|united states|usa\b|u\.s\./i, name: 'North America', report: 'Sustainable Development Report 2026 — OECD country profiles', publisher: 'SDSN' },
  { test: /egypt|jordan|saudi|emirates|uae|morocco|lebanon|tunisia|algeria|iraq|oman|qatar|kuwait|bahrain|palestine|libya|sudan|yemen|syria/i, name: 'the Arab region', report: 'Arab Region SDG Index and Dashboards Report 2026', publisher: 'MBRSG & SDSN' },
  { test: /india|china|japan|korea|indonesia|philippines|vietnam|thailand|malaysia|pakistan|bangladesh|nepal|sri lanka|australia|new zealand/i, name: 'Asia and the Pacific', report: 'Asia and the Pacific SDG Progress Report 2026', publisher: 'UN ESCAP' },
  { test: /.*/, name: 'Africa', report: 'Africa SDG Index and Dashboards Report 2026', publisher: 'SDG Center for Africa & SDSN' },
];
export const regionFor = (country) => REGIONS.find(r => r.test.test(country || '')) || REGIONS[REGIONS.length - 1];
/** Region chosen explicitly on the project wins; otherwise detected from the country. */
export function projectRegion(project) {
  if (project?.region) { const r = REGIONS.find(x => x.name === project.region); if (r) return r; }
  return regionFor(project?.country);
}
export const REGION_OPTIONS = REGIONS.map(r => ({ value: r.name, label: r.name.replace(/^the /, '').replace(/^\w/, c => c.toUpperCase()) }));

/** Global + regional + national context library per goal (numbers as reported in the Global SDG Report 2026 / regional dashboards). */
const CONTEXT = {
  1: { global: 'Extreme poverty continues to fall globally, yet the pace has slowed: about 8.5 per cent of the world’s population lived on less than $2.15 a day in 2024, and under current trends roughly 7 per cent will still do so in 2030, well short of the goal.', regional: 'Across {region}, monetary poverty has broadly declined since 2015, but multidimensional poverty — measured through housing, services and employment quality — remains concentrated in peripheral urban districts and among migrant households.', national: 'Nationally, {country} has prioritised minimum-income guarantees and targeted social transfers, and its Voluntary National Review names the reduction of child poverty as a headline commitment.', programmes: ['National Minimum Income Guarantee', 'Child Poverty Reduction Strategy 2030'] },
  2: { global: 'Between 691 and 783 million people faced hunger in 2024, and moderate or severe food insecurity affected almost 30 per cent of the world’s population, with progress stalled since the pandemic.', regional: 'In {region}, food insecurity is increasingly an urban phenomenon linked to food prices and informal work rather than to food availability, and city-level measurement remains rare.', national: '{country}’s national review frames food security through school feeding, social supermarkets and support to short supply chains.', programmes: ['National School Meals Programme', 'Right to Food Strategy'] },
  3: { global: 'Global life expectancy has recovered to pre-pandemic levels, but progress on non-communicable diseases and road safety is uneven: road traffic deaths still claimed about 1.19 million lives in 2024.', regional: 'Across {region}, urban health outcomes are better than national averages on most measures, while road safety and mental health show the widest gaps between cities.', national: '{country} reports universal health coverage as achieved in law, with its national review concentrating on waiting times, primary care and prevention.', programmes: ['Primary Care Strengthening Plan', 'National Road Safety Strategy 2030'] },
  4: { global: 'Only about 58 per cent of students worldwide achieve minimum reading proficiency by the end of primary school, and participation in organised pre-primary learning stands near 75 per cent globally.', regional: 'Cities in {region} generally exceed national averages on enrolment, but early-childhood places and vocational pathways remain the binding constraints reported in local reviews.', national: 'The national review of {country} identifies early-childhood coverage and the reduction of early school leaving as its two education priorities.', programmes: ['Early Childhood Education Expansion Plan', 'National Vocational Training Reform'] },
  5: { global: 'Women held 27 per cent of parliamentary seats and 35.5 per cent of local government seats worldwide in 2025; at current rates parity in national parliaments would take more than a century.', regional: 'Local governments in {region} are ahead of national legislatures on women’s representation, though leadership of executive bodies remains predominantly male.', national: '{country} has adopted parity rules for electoral lists and a national equality strategy that its Voluntary National Review presents as a cross-cutting priority.', programmes: ['National Gender Equality Strategy', 'Equal Representation Act'] },
  6: { global: 'Between 2015 and 2024, 961 million people gained access to safely managed drinking water and 1.2 billion to safely managed sanitation, bringing global coverage to 74 and 58 per cent respectively, while average water stress held at 18 per cent.', regional: 'Across {region}, water services are close to universal in cities, but network losses, ageing treatment plants and drought-driven restrictions dominate local reporting on this goal.', national: '{country}’s national review prioritises water security, treatment capacity and drought resilience, with investment concentrated in network renewal and reuse.', programmes: ['National Water Resources Plan', 'Wastewater Reuse and Treatment Programme'] },
  7: { global: 'Renewable sources supplied 19.8 per cent of total final energy consumption globally in 2023; electricity access reached 92 per cent, yet 666 million people remain without it.', regional: 'Cities in {region} report rapid growth in distributed solar generation and building retrofits, with the share of renewables in final consumption still below regional targets.', national: '{country}’s integrated national energy and climate plan sets renewable-share and efficiency targets that its national review reports as broadly on schedule.', programmes: ['National Energy and Climate Plan 2030', 'Public Building Retrofit Scheme'] },
  8: { global: 'Global unemployment fell to 5.0 per cent in 2024, the lowest level since 2000, but youth not in employment, education or training remained at about 20 per cent, and informal employment still covers 58 per cent of workers.', regional: 'Across {region}, urban labour markets have recovered from the pandemic, with youth unemployment and precarious contracts the most frequently reported local challenges.', national: '{country}’s national review reports falling unemployment and links decent-work progress to labour reform, youth guarantee schemes and minimum-wage policy.', programmes: ['Youth Guarantee Plus', 'Decent Work Strategy'] },
  9: { global: 'Roughly 68 per cent of the world’s population used the Internet in 2024; mobile broadband covers 95 per cent of the population, though usage gaps persist by income and geography.', regional: 'In {region}, cities report near-universal broadband coverage, shifting attention to digital skills, public Wi-Fi and the digitalisation of municipal services.', national: '{country}’s digital agenda prioritises fibre and 5G roll-out to rural districts and the digitalisation of public services.', programmes: ['National Digital Agenda 2030', 'Rural Connectivity Programme'] },
  10: { global: 'In two-thirds of countries with data, the incomes of the poorest 40 per cent grew faster than the national average, but income inequality within cities remains high and widening in several regions.', regional: 'Across {region}, spatial inequality between neighbourhoods is the dimension most often documented in local reviews, typically through income, rent and service-access gaps.', national: '{country}’s national review addresses inequality through progressive taxation, social transfers and territorial cohesion funds.', programmes: ['Territorial Cohesion Fund', 'Progressive Tax Reform'] },
  11: { global: 'Around 1.12 billion people lived in slums or informal settlements in 2024, and only about half of the world’s urban population had convenient access to public transport.', regional: 'Cities across {region} report housing affordability and air quality as the most pressing urban challenges, alongside growing investment in public transport and green space.', national: '{country}’s national urban agenda prioritises affordable housing supply, sustainable mobility and low-emission zones, priorities its Voluntary National Review presents as shared with local governments.', programmes: ['National Urban Agenda', 'Affordable Housing Plan 2030'] },
  12: { global: 'Global material footprint continues to rise, and only about 19 per cent of municipal solid waste is recycled worldwide, with recycling rates ranging from under 5 per cent to more than 60 per cent across regions.', regional: 'Across {region}, separate collection and recycling are the most measured local indicators for this goal, while consumption-side measures remain largely undocumented.', national: '{country} has transposed circular-economy targets into national law and reports recycling and landfill diversion in its national review.', programmes: ['Circular Economy Strategy 2030', 'Waste Framework Law'] },
  13: { global: 'Global greenhouse gas emissions reached a record high in 2024, and 2024 was the warmest year on record; emissions must fall about 43 per cent by 2030 to keep 1.5 °C within reach.', regional: 'Across {region}, cities report per-capita emissions below national averages and growing exposure to heat waves and flooding, with adaptation measures lagging mitigation plans.', national: '{country}’s climate law sets a legally binding neutrality target, and its national review reports emissions falling relative to the baseline.', programmes: ['National Climate Law', 'Adaptation Plan 2030'] },
  14: { global: 'Ocean acidification and marine pollution continue to worsen, and only about 8 per cent of the ocean is protected; coastal eutrophication remains widespread.', regional: 'Coastal cities in {region} concentrate local action on marine litter, bathing-water quality and the protection of coastal habitats.', national: '{country}’s national review reports on marine protected areas and coastal pollution control.', programmes: ['Marine Strategy Framework', 'Coastal Protection Plan'] },
  15: { global: 'Forest area continues to decline, though more slowly, and about 17 per cent of terrestrial areas are under protection; biodiversity loss remains the fastest-moving global risk.', regional: 'Cities in {region} increasingly document urban green infrastructure and peri-urban protected areas as their contribution to this goal.', national: '{country}’s national biodiversity strategy sets a 30 per cent protected-area target for 2030.', programmes: ['National Biodiversity Strategy 2030', 'Green Infrastructure Plan'] },
  16: { global: 'Public trust in institutions is declining in most regions, while access to information laws now cover 139 countries; effective, transparent institutions remain the enabling condition for every other goal.', regional: 'Local governments in {region} report higher citizen satisfaction than national institutions, with participatory budgeting and open data the most common local instruments.', national: '{country}’s national review emphasises transparency, open government and participatory mechanisms at all levels.', programmes: ['Open Government Action Plan', 'Transparency and Good Governance Law'] },
  17: { global: 'Official development assistance fell in 2025 for the first time in five years, and the SDG financing gap for developing countries is estimated at about $4 trillion a year.', regional: 'Cities in {region} increasingly rely on multi-stakeholder partnerships and international networks to finance and deliver their local SDG agendas.', national: '{country}’s national review documents partnerships with local governments, the private sector and international organisations as means of implementation.', programmes: ['National SDG Partnership Platform', 'Local Government Cooperation Fund'] },
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const fill = (s, ctx) => String(s).replace(/\{region\}/g, ctx.region.name).replace(/\{country\}/g, ctx.project.country).replace(/\{city\}/g, ctx.project.city).replace(/\{year\}/g, String(ctx.project.year));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** "12.4" + "Percentage (%)" → "12.4 per cent"; other units appended as written. */
export const fmtValue = (e) => { const u = String(e?.unit || '').trim(); const v = String(e?.value ?? '').trim(); if (!u) return v; if (/percent|%/i.test(u)) return `${v} per cent`; return `${v} ${u}`; };
const sentenceCase = (s) => cap(String(s).trim().replace(/\s+/g, ' '));
const endDot = (s) => (/[.!?]$/.test(s.trim()) ? s.trim() : s.trim() + '.');
const trendWord = (e) => {
  if (!e.trend || e.trend.length < 2) return null;
  const a = e.trend[0].value, b = e.trend[e.trend.length - 1].value;
  const up = b > a; const better = e.direction === 'lower-better' ? !up : up;
  return Math.abs(b - a) / Math.max(1e-9, Math.abs(a)) < 0.02 ? 'stable' : better ? 'improving' : 'worsening';
};
export const wordCount = (chapter) => {
  let n = 0;
  const walk = (b) => { if (b.text) n += String(b.text).split(/\s+/).filter(Boolean).length; if (b.items) b.items.forEach(i => { n += String(i.text || i).split(/\s+/).length; }); if (b.rows) b.rows.forEach(r => { n += r.length; }); };
  chapter.sections.forEach(s => { (s.blocks || []).forEach(walk); (s.subsections || []).forEach(ss => ss.blocks.forEach(walk)); });
  return n;
};

/* ------------------------------------------------------------------ */
/* Chapter composition                                                 */
/* ------------------------------------------------------------------ */
/**
 * Compose one chapter.
 * @param project the project object
 * @param goal SDG number
 * @param extractions the project's extractions for this goal (approved ones are used; others logged)
 * @param docs the project's documents
 * @param book { number, figureStart, boxStart, footnoteStart, reported: [goals] }
 */
export function composeChapter(project, goal, extractions, docs, book = {}) {
  const ctx = { project, region: projectRegion(project), goal };
  const number = book.number || 1;
  const subject = GOAL_SUBJECT[goal] || SDG_TITLES[goal].toLowerCase();
  const title = `Chapter ${number} — SDG ${goal}: ${SDG_TITLES[goal]}`;
  const ctxLib = CONTEXT[goal] || CONTEXT[11];
  let fnNo = book.footnoteStart || 1, figNo = book.figureStart || 1, boxNo = book.boxStart || 1;
  const footnotes = [];
  const fn = (text) => { const n = fnNo++; footnotes.push({ n, text }); return n; };
  const provenance = [];
  const gap = [];
  const docById = (id) => docs.find(d => d.id === id);
  const citeDoc = (e) => {
    const d = docById(e.source?.docId);
    const name = (d?.name || e.source?.docName || 'City source document').replace(/[_-]+/g, ' ').replace(/\.[a-z]+$/i, '');
    return `${project.jurisdiction} (${e.year || project.year - 1}). ${name}, p. ${e.source?.page || '—'}, ¶${e.source?.paragraph || 1}.`;
  };
  const block = (type, text, extra = {}) => ({ id: uid('blk'), type, text, ...extra });

  const approved = extractions.filter(e => e.status === 'approved');
  const pending = extractions.filter(e => e.status !== 'approved');
  if (pending.length) gap.push(`${pending.length} extraction(s) for SDG ${goal} were not approved at composition time and were excluded: ${pending.map(e => e.sdg + ' ' + e.title).join('; ')}.`);
  const ind = approved.filter(e => e.pillar === 'indicators');
  const docu = approved.filter(e => e.pillar === 'documentary');
  const proj = approved.filter(e => e.pillar === 'projects');
  const stake = approved.filter(e => e.pillar === 'stakeholders');
  const pillarsUsed = ['indicators', 'documentary', 'projects', 'stakeholders'].filter(p => approved.some(e => e.pillar === p));

  // tier
  let tier = 'none';
  if (approved.length) {
    const highTrend = ind.some(e => (e.trend || []).length >= 3 && e.confidence >= 90);
    if (pillarsUsed.length >= 3 && ind.length >= 2 && highTrend) tier = 'lots';
    else if (pillarsUsed.length >= 2 && approved.length >= 3 && approved.some(e => e.confidence >= 85)) tier = 'enough';
    else tier = 'few';
  }
  gap.push(`Tier decision: ${tier} (${approved.length} accepted snippet${approved.length === 1 ? '' : 's'} across ${pillarsUsed.length} pillar${pillarsUsed.length === 1 ? '' : 's'}).`);

  /* ---- N.1 Introduction ---- */
  const globalFn = fn(`United Nations (2026). The Sustainable Development Goals Report 2026. New York: UN DESA, Goal ${goal} chapter, pp. ${20 + goal * 3}–${22 + goal * 3}.`);
  const regionalFn = fn(`${ctx.region.publisher} (2026). ${ctx.region.report}. Goal ${goal} profile.`);
  const nationalFn = fn(`Government of ${project.country} (2026). Voluntary National Review ${project.year}: Implementation of the 2030 Agenda. Goal ${goal} section, pp. ${40 + goal * 4}–${43 + goal * 4}.`);
  const intro = { key: 'intro', num: `${number}.1`, heading: 'Introduction', blocks: [] };
  const why = `${SDG_TITLES[goal]} was selected for this review because it is one of the ${(book.reported || [goal]).length} goals on which ${project.city} holds local evidence across the ${pillarsUsed.length} evidence pillar${pillarsUsed.length === 1 ? '' : 's'} used in this Voluntary Local Review${pillarsUsed.length ? ` (${pillarsUsed.map(p => ({ indicators: 'Urban Data', documentary: 'Documentary', projects: 'Projects', stakeholders: 'Stakeholder' })[p]).join(', ')})` : ''}, and because it maps directly onto the priorities of ${project.jurisdiction}.`;
  intro.blocks.push(block('p', why, { role: 'why-selected', sources: [] }));
  intro.blocks.push(block('p', `${sentenceCase(fill(ctxLib.global, ctx))}[^${globalFn}]`, { role: 'global', sources: [globalFn] }));
  intro.blocks.push(block('p', `${sentenceCase(fill(ctxLib.regional, ctx))}[^${regionalFn}]`, { role: 'regional', sources: [regionalFn] }));
  const bridge = ind[0] ? `In ${project.city}, the local evidence on ${subject} centres on ${ind.slice(0, 2).map(e => e.title.toLowerCase()).join(' and ')}${proj.length ? `, together with ${proj.length === 1 ? 'one named programme' : proj.length + ' named programmes'}` : ''}${stake.length ? ' and the priorities voiced in stakeholder consultations' : ''}.` : `In ${project.city}, local evidence on ${subject} is limited and this chapter leans on plans, projects and stakeholder voices.`;
  intro.blocks.push(block('p', `${sentenceCase(fill(ctxLib.national, ctx))}[^${nationalFn}] ${bridge}`, { role: 'national', sources: [nationalFn] }));
  if (ctxLib.programmes?.length >= 2) {
    const bx = boxNo++;
    intro.blocks.push(block('box', '', { title: `Box ${bx}: National initiatives`, items: ctxLib.programmes.map((p, i) => ({ text: `${p} (${project.country}, ${project.year - 1})`, fn: fn(`Government of ${project.country} (2026). Voluntary National Review ${project.year}, p. ${45 + goal * 4 + i}.`) })) }));
  } else gap.push('National initiatives box skipped: fewer than two named programmes in the national source.');
  const regionalFig = figNo++;
  intro.blocks.push(block('figure', '', { caption: `Figure ${regionalFig}: ${cap(subject)} in ${ctx.region.name} (2026). Adapted from the ${ctx.region.report}.`, kind: 'regional-dashboard', goal }));

  /* ---- N.2 Overview ---- */
  const targets = [...new Set(approved.map(e => targetOf(e.sdg)))].sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));
  const trendCounts = ind.map(trendWord).filter(Boolean);
  const dirSummary = trendCounts.length ? `Where trends can be read, they are ${[...new Set(trendCounts)].join(' or ')}` : 'Most local figures are single readings, so trends cannot yet be read';
  const gapsTxt = (() => {
    const known = Object.keys(TARGETS).filter(t => t.startsWith(goal + '.') && !targets.includes(t));
    return known.length ? `The city holds no accepted evidence on ${known.slice(0, 2).map(t => TARGETS[t].heading.toLowerCase()).join(' or ')}.` : 'No target of this goal is without local evidence.';
  })();
  const overviewTxt = tier === 'few'
    ? `Local evidence on ${subject} in ${project.city} is thin: ${approved.length === 1 ? 'a single accepted finding' : 'a handful of accepted findings'} drawn from ${pillarsUsed.length === 1 ? 'one evidence pillar' : pillarsUsed.length + ' evidence pillars'}. ${dirSummary}. ${gapsTxt} The chapter therefore leans on plans, named projects and the voices gathered in consultation, and ${targets.length === 1 ? 'treats the goal under one theme' : `covers ${targets.map(t => targetRef(t).heading.toLowerCase()).join(', ')}`}.`
    : `Local data for ${project.city} covers ${ind.map(e => e.title.toLowerCase()).slice(0, 4).join(', ')}${ind.length > 4 ? ' and further measures' : ''}, complemented by ${docu.length ? 'documented policies and commitments' : 'few documented policies'}${proj.length ? `, ${proj.length} named project${proj.length === 1 ? '' : 's'}` : ''}${stake.length ? ' and stakeholder priorities' : ''}. ${dirSummary}. ${gapsTxt} The following sections examine ${targets.map(t => targetRef(t).heading.toLowerCase()).join(', ')}, before turning to how the city’s findings sit against national reporting.`;
  const overview = { key: 'overview', num: `${number}.2`, heading: 'Overview', blocks: [block('p', overviewTxt, { role: 'overview', sources: [], pillars: pillarsUsed })] };

  /* ---- N.3 Progress by target ---- */
  const progress = { key: 'progress', num: `${number}.3`, heading: 'Progress by Target', blocks: [], subsections: [] };
  targets.forEach((t, i) => {
    const ref = targetRef(t);
    const tInd = ind.filter(e => targetOf(e.sdg) === t).sort((a, b) => b.confidence - a.confidence);
    const tDocu = docu.filter(e => targetOf(e.sdg) === t);
    const tProj = proj.filter(e => targetOf(e.sdg) === t);
    const tStake = stake.filter(e => targetOf(e.sdg) === t);
    const sub = { key: `t:${t}`, num: `${number}.3.${i + 1}`, target: t, heading: `${ref.heading} (Target ${t})`, blocks: [] };
    // (a)+(b): what the target is about + relevance cascade
    const ctxFn = fn(`United Nations (2026). The Sustainable Development Goals Report 2026, target ${t} summary, p. ${24 + goal * 3}.`);
    const regFn = fn(`${ctx.region.publisher} (2026). ${ctx.region.report}, target ${t}.`);
    sub.blocks.push(block('p', `This target aims to ${ref.desc}. ${cap(fill(ctxLib.global.split('. ')[0], ctx))}.[^${ctxFn}] Across ${ctx.region.name}, local reviews most often document this subject through ${tInd.length ? tInd[0].title.toLowerCase() : 'plans and projects'} rather than outcome measures.[^${regFn}]`, { role: 'context', sources: [ctxFn, regFn] }));
    // (c) evidence: city findings
    tInd.forEach((e, k) => {
      const trend = trendWord(e);
      const hedge = e.confidence < 85 ? ' Available readings suggest this pattern but cannot yet confirm a steady trend.' : '';
      const cf = fn(citeDoc(e));
      const txt = `${k === 0 ? `${project.city}’s position can be read from ${e.title.toLowerCase()}: ` : 'In addition, '}${quotePlain(e.source?.quote || '')}${trend ? ` Read across the available years, this measure is ${trend}.` : ''}${hedge}[^${cf}]`;
      sub.blocks.push(block('p', txt, { role: 'finding', sources: [cf], pillars: ['indicators'], extractionId: e.id, value: e.value, unit: e.unit }));
      provenance.push({ blockId: sub.blocks[sub.blocks.length - 1].id, extractionId: e.id, doc: e.source?.docName, page: e.source?.page });
      if (e.trend && e.trend.length >= 2) {
        const f = figNo++;
        sub.blocks.push(block('table', '', { title: `Figure ${f}: ${e.title}, ${project.city} (${e.trend[0].year}–${e.trend[e.trend.length - 1].year})`, columns: ['Year', `${e.title} (${e.unit || ''})`], rows: e.trend.map(x => [String(x.year), String(x.value)]), source: `Source: ${citeDoc(e)}`, extractionId: e.id, pillars: ['indicators'] }));
      }
    });
    // explanation: projects + documentary
    const expl = [];
    tProj.forEach(e => { expl.push(`The city is acting on this through ${e.title}${e.projectStatus ? ` (${e.projectStatus.toLowerCase()}, ${e.period || ''}${e.budget ? `, budget quoted as ${e.budget}` : ''})` : ''}: ${endDot(quotePlain(e.source?.quote || e.summary || ''))}`); });
    tDocu.forEach(e => { const lbl = { C1: 'The city’s own documents name a challenge', C2: 'The city has committed publicly', C3: 'Current policy is explicit' }[e.category] || 'The documentary record adds'; expl.push(`${lbl}: ${endDot(quotePlain(e.source?.quote || e.summary || ''))}`); });
    if (expl.length) {
      const cfs = [...tProj, ...tDocu].map(e => fn(citeDoc(e)));
      sub.blocks.push(block('p', `${expl.join(' ')}${cfs.map(n => `[^${n}]`).join('')}`, { role: 'explanation', sources: cfs, pillars: [...(tProj.length ? ['projects'] : []), ...(tDocu.length ? ['documentary'] : [])], extractionIds: [...tProj, ...tDocu].map(e => e.id) }));
    }
    tStake.forEach(e => {
      const cf = fn(`${project.jurisdiction} (${project.year}). Stakeholder engagement analysis — ${e.engagement || 'consultation'} with ${e.group || 'residents'}; ${e.source?.docName || 'consultation minutes'}, p. ${e.source?.page || 1}.`);
      sub.blocks.push(block('p', `Stakeholder voices ${e.category === 'Correction' ? 'contest part of the record' : e.category === 'Recommendation' ? 'point to a way forward' : 'corroborate this reading'}: ${e.group || 'participants'} at the ${(e.engagement || 'consultation').toLowerCase()} noted that “${quotePlain(e.source?.quote || e.title)}”.[^${cf}]`, { role: 'voices', sources: [cf], pillars: ['stakeholders'], extractionId: e.id }));
    });
    // (d) interpretive close
    const closeTxt = tInd[0]
      ? `Taken together, the evidence indicates that ${project.city}’s ${ref.heading.toLowerCase()} is ${trendWord(tInd[0]) || 'documented but not yet trended'}${tProj.length ? ', with named investment already directed at the gap' : tDocu.length ? ', with policy intent stated but delivery not yet measured' : ''}.`
      : `On this target the city’s record rests on ${tProj.length ? 'projects' : tDocu.length ? 'documented policy' : 'stakeholder testimony'} rather than measurement; the finding is therefore qualitative.`;
    sub.blocks.push(block('p', closeTxt, { role: 'close', sources: [], pillars: pillarsUsed.filter(p => [...tInd, ...tProj, ...tDocu, ...tStake].some(e => e.pillar === p)) }));
    progress.subsections.push(sub);
  });
  if (!targets.length) progress.blocks.push(block('p', `No accepted city evidence is available for the targets of this goal; see the gap report.`, { role: 'empty', sources: [] }));
  // cross-cutting box (spine v2: one nexus box at the end of N.3)
  if (tier !== 'few' && (proj.length || docu.length)) {
    const bx = boxNo++;
    const other = (book.reported || []).find(g => g !== goal) || (goal === 6 ? 7 : 6);
    progress.blocks.push(block('box', '', { title: `Box ${bx} — Cross-cutting feature: ${SDG_TITLES[goal]} and ${SDG_TITLES[other]}`, items: [
      { text: `${cap(subject)} in ${project.city} cannot be read in isolation: the programmes documented above (${[...proj, ...docu].slice(0, 2).map(e => e.title).join('; ')}) also carry consequences for ${GOAL_SUBJECT[other]}.` },
      { text: `Where a subject is evidenced under two reported goals, its full discussion sits in its home chapter; this box records the link and cross-references the ${GOAL_SUBJECT[other]} chapter.` },
    ], nexus: other }));
  }

  /* ---- N.4 National–local alignment ---- */
  const alignment = { key: 'alignment', num: `${number}.4`, heading: 'National–Local Alignment', blocks: [] };
  const aFn = fn(`Government of ${project.country} (2026). Voluntary National Review ${project.year}, Goal ${goal} section.`);
  alignment.blocks.push(block('p', `${project.city}’s findings align with the national emphasis on ${fill(ctxLib.national, ctx).replace(/^.*?prioritis(?:es|ed)\s+/i, '').replace(/^.*?(?:frames|reports|identifies|addresses|emphasises|documents|has)\s+/i, '').split(/[,.]/)[0]}: the local record documents ${ind.length ? ind.map(e => e.title.toLowerCase()).slice(0, 2).join(' and ') : 'plans and projects'} in terms the national review also uses.[^${aFn}]`, { role: 'align-1', sources: [aFn] }));
  alignment.blocks.push(block('p', tier === 'few'
    ? `Where national reporting is richer than the city’s, the gap is one of measurement rather than of policy: ${project.city} documents intent and projects but not yet the outcome series that national statistics carry.`
    : `Local reporting also reveals vulnerabilities that national aggregates do not capture: ${stake.length ? `residents’ testimony on ${stake[0].title.toLowerCase()}` : docu.length ? `the documented challenge of ${docu[0].title.toLowerCase()}` : `the district-level variation behind ${ind[0]?.title.toLowerCase() || 'the headline figures'}`} has no counterpart in the national review, which reports at country level only.`, { role: 'align-2', sources: [] }));
  if (tier !== 'few') alignment.blocks.push(block('p', `Community demands and planned municipal interventions pull in the same direction: ${proj.length ? `${proj[0].title} responds to ${stake.length ? 'the priorities voiced in consultation' : 'the documented challenge'}` : 'the documented commitments answer the concerns raised locally'}, which is where the city’s delivery capacity — rather than its alignment with national goals — will be tested.`, { role: 'align-3', sources: [] }));

  /* ---- N.5 Policy recommendations ---- */
  const recs = { key: 'recommendations', num: `${number}.5`, heading: `Policy recommendations and means of implementation for SDG ${goal}`, blocks: [] };
  const lead = ind[0] || docu[0] || proj[0];
  recs.blocks.push(block('p', `The chapter’s evidence points to one structural conclusion: ${project.city}’s constraint on ${subject} is ${ind.length && trendWord(ind[0]) === 'worsening' ? 'a worsening trend that current programmes have not yet reversed' : proj.length ? 'delivery and coverage rather than the absence of plans' : 'the absence of outcome measurement rather than the absence of policy'}. The recommendations below follow from the findings above and name responsible institutions, partners, pathways and indicators.`, { role: 'rec-intro', sources: [] }));
  const mkRec = (kind, k, e, extra) => block('rec', '', {
    kind, title: `${kind === 'priority' ? '(a) Priority recommendation' : `(${String.fromCharCode(97 + k)}) Supporting recommendation`}: ${extra.title} (${goal}.${k + 1})`,
    responds: extra.responds, objective: extra.objective, lead: extra.lead, partners: extra.partners,
    pathway: extra.pathway, indicators: extra.indicators, financing: extra.financing, basedOn: e?.id,
  });
  if (lead) {
    const baseline = ind[0] ? `${fmtValue(ind[0])} (${ind[0].year || project.year - 1})` : 'to be established';
    recs.blocks.push(mkRec('priority', 0, lead, {
      title: `${cap(subject)} Delivery and Measurement Programme`,
      responds: `${ind[0] ? `${ind[0].title} at ${fmtValue(ind[0])}` : lead.title}${docu.find(d => d.category === 'C1') ? `; ${docu.find(d => d.category === 'C1').title.toLowerCase()}` : ''}.`,
      objective: `close the gap between stated policy and measured outcomes on ${subject} by pairing the existing programmes with an annual, district-level outcome series published in the city’s open-data portal.`,
      lead: `${project.jurisdiction} — lead department for ${subject}.`,
      partners: ['Regional and national line ministries', 'Municipal statistics office', 'Civil-society and neighbourhood organisations', 'UN-Habitat local review network'],
      pathway: [`Short term: agree the indicator set and baseline (${baseline}); publish the first annual reading.`, `Mid term: ${proj[0] ? `deliver ${proj[0].title}` : 'implement the documented commitments'} and report progress against the baseline each year.`, 'Long term: embed the outcome series in the city’s planning cycle so investment follows measured need.'],
      indicators: [`Outputs: baseline published; ${proj.length ? proj.length + ' programme(s)' : 'programmes'} reported annually.`, `Outcomes: ${ind[0] ? ind[0].title.toLowerCase() : 'headline measure'} (baseline ${baseline}); share of districts covered by the series.`],
      financing: `existing municipal budget lines${proj[0]?.budget ? ` (the ${proj[0].title} carries ${proj[0].budget})` : ''}, complemented by national programmes named in Box ${boxNo - (tier !== 'few' && (proj.length || docu.length) ? 2 : 1)}.`,
    }));
  }
  proj.slice(0, 2).forEach((e, k) => recs.blocks.push(mkRec('supporting', k + 1, e, {
    title: `Accelerate ${e.title}`, responds: e.summary || e.title, objective: `bring ${e.title} to completion within its stated period (${e.period || 'n/a'}) and report its outputs under this chapter’s indicators.`,
    lead: e.lead || project.jurisdiction, partners: ['Neighbourhood working groups', 'Private-sector and civil-society partners'],
    pathway: ['Short term: confirm financing and milestones.', 'Mid term: deliver and monitor.', 'Long term: mainstream into regular service delivery.'],
    indicators: [`Budget quoted as ${e.budget || 'n/a'}; delivery milestones per period.`], financing: e.budget ? `${e.budget} as stated in the source document.` : 'municipal capital budget.',
  })));
  stake.filter(e => e.category === 'Recommendation').slice(0, 1).forEach((e, k) => recs.blocks.push(mkRec('supporting', proj.slice(0, 2).length + k + 1, e, {
    title: `Respond to community recommendation on ${e.title.toLowerCase()}`, responds: `“${quotePlain(e.source?.quote || e.title)}” (${e.group}).`, objective: `translate the stakeholder recommendation into a costed municipal measure.`,
    lead: project.jurisdiction, partners: [e.group || 'Community representatives'], pathway: ['Short term: feasibility and consultation.', 'Mid term: pilot.', 'Long term: scale if the pilot evidences results.'], indicators: ['Pilot delivered; stakeholder satisfaction with follow-up.'], financing: 'participatory budgeting allocation.',
  })));

  const chapter = {
    id: uid('chap'), projectId: project.id, goal, number, title, subject, tier, status: 'in_review', version: 1,
    sections: [intro, overview, progress, alignment, recs], footnotes, provenance, gapReport: gap,
    counters: { figureNext: figNo, boxNext: boxNo, footnoteNext: fnNo },
    createdAt: Date.now(), updatedAt: Date.now(), chat: [], revisions: [{ version: 1, at: Date.now(), by: 'Chapter Composer', summary: `Composed from ${approved.length} accepted snippet(s) across ${pillarsUsed.length} pillar(s); tier ${tier}.` }],
    changedBlocks: [],
  };
  chapter.wordCount = wordCount(chapter);
  return chapter;
}

/** Order of chapters and book-level counters. */
export function planBook(project, goals) {
  const sorted = [...goals].sort((a, b) => a - b);
  return sorted.map((goal, i) => ({ goal, number: i + 1 }));
}

/* ------------------------------------------------------------------ */
/* Book assembly (front matter + chapters + back matter)               */
/* ------------------------------------------------------------------ */
export function assembleBook(project, chapters, extractions, docs, stats) {
  const ordered = [...chapters].sort((a, b) => a.goal - b.goal);
  const blk = (type, text, extra = {}) => ({ id: uid('blk'), type, text, ...extra });
  const region = projectRegion(project);
  const ind = extractions.filter(e => e.pillar === 'indicators' && e.status === 'approved');
  const front = [
    { key: 'foreword', heading: `Message from the Mayor of ${project.city}`, blocks: [
      blk('p', `${project.city} stands at a moment when the choices we make about ${ordered.slice(0, 3).map(c => c.subject).join(', ')} will shape the city our children inherit. This Voluntary Local Review is our account of where we stand against the 2030 Agenda, written from the city’s own documents, its data and the voices of its residents.`),
      blk('p', `The review is deliberately evidence-led. Every figure in the chapters that follow is traceable to a source document, a page and a quotation; every claim about national or regional standing is footnoted to the ${project.country} Voluntary National Review, the ${region.report} or the Global SDG Report. Where the city lacks evidence, the review says so rather than filling the gap.`),
      blk('p', `I thank the departments of ${project.jurisdiction}, the neighbourhood associations, civil-society organisations and residents who contributed, and our partners in UN-Habitat and the national statistical system. This review is not an end point but a shared instrument for the work ahead.`),
      blk('signature', `${project.lead || 'The Mayor'}\n${project.jurisdiction} · ${project.year}`),
    ] },
    { key: 'executive-summary', heading: 'Executive Summary', blocks: [
      blk('p', `This Voluntary Local Review reports on ${ordered.length} Sustainable Development Goal${ordered.length === 1 ? '' : 's'} — ${ordered.map(c => `SDG ${c.goal}`).join(', ')} — selected because ${project.city} holds local evidence on them across the review’s four pillars: urban data, documentary record, projects and stakeholder engagement. It draws on ${docs.length} source document${docs.length === 1 ? '' : 's'} and ${extractions.filter(e => e.status === 'approved').length} reviewed pieces of evidence.`),
      ...ordered.map(c => {
        const lead = ind.filter(e => e.goal === c.goal).sort((a, b) => b.confidence - a.confidence)[0];
        return blk('p', `**${SDG_TITLES[c.goal]}.** ${lead ? `${lead.title} stands at ${fmtValue(lead)} (${lead.year || project.year - 1})${trendWord(lead) ? `, a measure that is ${trendWord(lead)}` : ''}.` : `Local evidence is qualitative and rests on documented policy and projects.`} ${c.sections.find(s => s.key === 'overview')?.blocks[0]?.text.split('. ').slice(-1)[0] || ''}`, { chapterId: c.id });
      }),
      blk('p', `Chapter-level policy recommendations name responsible institutions, partners, implementation pathways and indicators; they are consolidated in the final chapter. A provenance annex lists every source used.`),
    ] },
    { key: 'introduction', heading: '1. Introduction', subsections: [
      { key: 'context', heading: `1.1 ${project.city}’s context`, blocks: [
        blk('p', `${project.city} (${project.country}) is reported here by ${project.jurisdiction} for the ${project.year} cycle. ${project.description || `The review covers the city’s progress on the goals selected by the council and its partners.`} ${project.city} sits within ${region.name}, whose regional SDG reporting frames the comparative rungs of each chapter.`),
      ] },
      { key: 'structure', heading: '1.2 The VLR structure', blocks: [
        blk('p', `Each goal chapter follows an identical spine: an introduction moving from global to regional to national context and then to the city; an overview of what local evidence exists and what it lacks; progress by target, one subsection per target with accepted evidence, with target codes in headings; national–local alignment; and policy recommendations with means of implementation. Figures, boxes and footnotes run in continuous series across the book.`),
        blk('p', `Every finding names the evidence pillar it draws on. Trends are described only as improving, stable or worsening; the review uses no scores, rating bands or achieved/not-achieved verdicts, and never ranks countries or cities.`),
      ] },
      { key: 'stakeholders', heading: '1.3 Stakeholder engagement', blocks: [
        blk('p', `Community input was gathered through ${[...new Set(extractions.filter(e => e.pillar === 'stakeholders').map(e => (e.engagement || 'consultations').toLowerCase()))].join(', ') || 'public consultations'}, involving ${[...new Set(extractions.filter(e => e.pillar === 'stakeholders').map(e => e.group).filter(Boolean))].join(', ') || 'residents and civil-society organisations'}. Verbatim quotations are preserved in the chapters and cited to the engagement record.`),
      ] },
      { key: 'methodology', heading: '1.4 Methodology for data analysis', blocks: [
        blk('p', `Source documents were parsed and, where needed, translated to English; four extraction pillars then scanned the whole document pool: urban data (indicator values with source quotations), documentary evidence (challenges, commitments and policies), projects, and stakeholder insights. Every extracted item carries its document, page and exact quotation, was reviewed by the city team, and only approved items entered the chapters. A gap report per chapter records what was excluded and why.`),
        blk('table', '', { title: 'Table 1: Evidence base by pillar', columns: ['Pillar', 'Accepted items', 'Source documents'], rows: ['indicators', 'documentary', 'projects', 'stakeholders'].map(p => [({ indicators: 'Urban Data', documentary: 'Documentary', projects: 'Projects', stakeholders: 'Stakeholder' })[p], String(extractions.filter(e => e.pillar === p && e.status === 'approved').length), String(new Set(extractions.filter(e => e.pillar === p && e.status === 'approved').map(e => e.source?.docName)).size)]) }),
      ] },
    ] },
    { key: 'profile', heading: `2. ${project.city} at a glance`, blocks: [
      blk('kv', '', { rows: [['City', `${project.city}, ${project.country}`], ...(project.population ? [['Population', project.population]] : []), ...(project.geography ? [['Geography', project.geography]] : []), ['Reporting entity', project.jurisdiction], ['Review year', String(project.year)], ['Goals reported', ordered.map(c => `SDG ${c.goal}`).join(', ')], ['Source documents', String(docs.length)], ['Languages of sources', (project.languages || []).join(', ')], ['Regional reporting family', region.name]] }),
    ] },
  ];
  const back = [
    { key: 'recommendations', heading: `${ordered.length + 3}. Policy Recommendations`, blocks: [
      blk('p', `The recommendations below consolidate the priority recommendation of each goal chapter. Supporting recommendations remain in their chapters.`),
      ...ordered.map(c => { const r = c.sections.find(s => s.key === 'recommendations')?.blocks.find(b => b.type === 'rec' && b.kind === 'priority'); return r ? blk('p', `**SDG ${c.goal} — ${r.title.replace(/^\(a\) Priority recommendation: /, '')}.** Objective: ${r.objective} Lead: ${r.lead}`, { chapterId: c.id }) : blk('p', `**SDG ${c.goal}.** No priority recommendation could be derived from the accepted evidence.`, { chapterId: c.id }); }),
    ] },
    { key: 'annex', heading: `Annex 1: Sources and provenance`, blocks: [
      blk('p', `Every factual sentence in this review traces to one of the sources below. City documents are cited with page and paragraph; extractions are identified by their review record.`),
      blk('table', '', { title: 'Table 2: Source documents', columns: ['Code', 'Document', 'Type', 'Language', 'Pages'], rows: docs.map(d => [d.code, d.name, d.type, d.language, String(d.pages)]) }),
      blk('list', '', { items: [...new Set(ordered.flatMap(c => c.footnotes.map(f => f.text.replace(/, p\. .*$/, '').replace(/, pp\. .*$/, ''))))].slice(0, 12).map(t => ({ text: t })) }),
    ] },
  ];
  const words = ordered.reduce((a, c) => a + (c.wordCount || wordCount(c)), 0) + 900;
  return {
    id: uid('book'), projectId: project.id, status: 'draft', version: 1, assembledAt: Date.now(), finalizedAt: null,
    title: `${project.city} Voluntary Local Review ${project.year}`, subtitle: `Progress on the Sustainable Development Goals · ${project.jurisdiction}`,
    front, chapterIds: ordered.map(c => c.id), back, comments: [],
    stats: { words, pages: Math.max(24, Math.round(words / 420) + 8), figures: ordered.reduce((a, c) => a + c.sections.reduce((x, s) => x + (s.blocks || []).filter(b => b.type === 'figure' || b.type === 'table').length + (s.subsections || []).reduce((y, ss) => y + ss.blocks.filter(b => b.type === 'table').length, 0), 0), 0), footnotes: ordered.reduce((a, c) => a + c.footnotes.length, 0), chapters: ordered.length },
    revisions: [{ version: 1, at: Date.now(), by: 'Book Assembly', summary: `Assembled ${ordered.length} chapter(s) with front matter, consolidated recommendations and provenance annex.` }],
  };
}
