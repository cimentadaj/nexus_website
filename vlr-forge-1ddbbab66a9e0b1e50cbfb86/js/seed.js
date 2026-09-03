/* seed.js — demo data, domain metadata and the generic "any city" extraction templates */
import { uid, docTypeFromName, fileExt } from './ui.js';
import { composeChapter, assembleBook as composeBook, planBook } from './composer.js';

export const APP_VERSION = 'V2.4.0';
export const NODES = ['EU-WEST-1', 'US-EAST-G01', 'EU-CENTRAL-2'];
export const LANGS = ['EN', 'ES', 'FR', 'PT', 'DE', 'CA', 'IT'];
export const DOC_TYPES = ['Documentary', 'Data Sheet', 'Policy', 'Plan', 'Minutes', 'Survey', 'Budget', 'Legacy Data'];

export const PILLARS = [
  { key: 'indicators', label: 'Indicators', icon: 'bar-chart-2', target: 12, step: 'extract_indicators', desc: 'Quantitative SDG indicator values with source quotes (Pillar A).' },
  { key: 'documentary', label: 'Documentary', icon: 'book-open', target: 6, step: 'documentary', desc: 'Challenges (C1), Commitments (C2) and Policies (C3) explicitly stated in city documents (Pillar C).' },
  { key: 'projects', label: 'Projects', icon: 'layout-grid', target: 5, step: 'projects', desc: 'City projects and initiatives linked to SDGs (Pillar B).' },
  { key: 'stakeholders', label: 'Stakeholders', icon: 'users', target: 4, step: 'stakeholders', desc: 'Community voices, priorities and recommendations from consultations (Pillar D).' },
];
export const EXPECTED_EXTRACTIONS = PILLARS.reduce((a, p) => a + p.target, 0); // 27

/** Pipeline step catalogue. cost = base + perPage * pages. durationMs is the "demo speed" duration. */
export const STEP_META = {
  parse:              { label: 'PDF Parser',                queueLabel: 'Neural Parser',       tag: 'Core-v4',   icon: 'braces',             engine: 'LlamaParse v4',          base: 0.40, perPage: 0.012, durationMs: 5200, scope: 'document' },
  translate:          { label: 'Translate',                 queueLabel: 'Translation Engine',  tag: 'Gemini',    icon: 'languages',          engine: 'Gemini 2.5 Flash',       base: 0.25, perPage: 0.006, durationMs: 4200, scope: 'document' },
  extract_indicators: { label: 'Indicator Extraction',      icon: 'bar-chart-2',        engine: 'LlamaCloud Extract',     base: 1.10, perPage: 0.02,  durationMs: 6500, scope: 'document' },
  analyse:            { label: 'Indicator Analysis',        icon: 'trending-up',        engine: 'ADK Analysis Agent',     base: 0.90, perPage: 0,     durationMs: 4800, scope: 'project' },
  documentary:        { label: 'Documentary Extraction',    icon: 'book-open',          engine: 'ADK Map-Reduce (C1–C3)', base: 2.40, perPage: 0.004, durationMs: 7200, scope: 'project' },
  projects:           { label: 'Projects Extraction',       icon: 'layout-grid',        engine: 'ADK Map-Reduce + Merge', base: 1.80, perPage: 0.004, durationMs: 6200, scope: 'project' },
  stakeholders:       { label: 'Stakeholder Extraction',    icon: 'users',              engine: 'ADK Map-Reduce + Cluster', base: 1.60, perPage: 0.004, durationMs: 5800, scope: 'project' },
  validation:         { label: 'Validation',                icon: 'shield-check',       engine: 'Pydantic Schema Gate',   base: 0.05, perPage: 0,     durationMs: 3200, scope: 'project' },
  normalization:      { label: 'Normalization',             icon: 'sliders-horizontal', engine: 'SDG-TC Rescaler',        base: 0.08, perPage: 0,     durationMs: 3000, scope: 'project' },
  xml_extraction:     { label: 'XML Extraction',            icon: 'braces',             engine: 'Legacy Schema Mapper',   base: 0.30, perPage: 0.005, durationMs: 3800, scope: 'document' },
  provenance:         { label: 'Provenance Mapping',        queueLabel: 'Provenance Mapping',  tag: 'Lineage',   icon: 'git-branch',         engine: 'Lineage Graph Builder',  base: 0.12, perPage: 0,     durationMs: 3400, scope: 'project' },
  export:             { label: 'Harmonized Excel Export',   icon: 'file-spreadsheet',   engine: 'Workbook Writer',        base: 0.02, perPage: 0,     durationMs: 2800, scope: 'project' },
  report:             { label: 'Report Generation',         icon: 'file-text',          engine: 'VLR Report Composer',    base: 0.35, perPage: 0,     durationMs: 4500, scope: 'project' },
  compose:            { label: 'Chapter Composer',          queueLabel: 'Chapter Composer',    tag: 'Gemini 2.5 Pro', icon: 'pen-line',        engine: 'Gemini 2.5 Pro · composer', base: 3.20, perPage: 0, durationMs: 7000, scope: 'chapter' },
  edit:               { label: 'Chapter Editor',            queueLabel: 'Chapter Editor',      tag: 'Consolidation', icon: 'list-checks',       engine: 'Editor agent (dedupe · numbering · cross-refs)', base: 1.40, perPage: 0, durationMs: 5000, scope: 'project' },
  assemble:           { label: 'Book Assembly',             queueLabel: 'Book Assembly',       tag: 'Front matter',  icon: 'book-open-check',   engine: 'VLR Book Assembler',     base: 0.90, perPage: 0,     durationMs: 5200, scope: 'project' },
  render:             { label: 'DOCX Rendering',            queueLabel: 'DOCX Rendering',      tag: 'Pandoc',        icon: 'file-type',         engine: 'md → docx renderer',     base: 0.05, perPage: 0,     durationMs: 3000, scope: 'project' },
};
export const STEP_ORDER = ['parse', 'translate', 'xml_extraction', 'extract_indicators', 'analyse', 'documentary', 'projects', 'stakeholders', 'validation', 'normalization', 'provenance', 'export', 'report', 'compose', 'edit', 'assemble', 'render'];

/* ------------------------------------------------------------------ */
/* Generic extraction templates. `{city}` and `{year}` are substituted.  */
/* Sources are assigned round-robin over the project's documents.        */
/* ------------------------------------------------------------------ */
export const INDICATOR_TEMPLATES = [
  { sdg: '11.1.1', goal: 11, title: 'Urban Informal Housing %', indicator: 'Proportion of urban population living in slums, informal settlements or inadequate housing.', value: '12.4', unit: 'Percentage (%)', year: 2022, confidence: 94, page: 42, paragraph: 3, topic: 'HOUSING ACCESSIBILITY',
    quote: 'Analysis of the 2022 municipal housing survey indicates that approximately {h:12.4%} of residents in the outer metropolitan zones are currently categorized as residing in {h:informal or sub-standard housing units}, a marginal decrease from the 13.1% reported in the previous biennial review cycle.',
    trend: [{ year: 2018, value: 14.8 }, { year: 2020, value: 13.1 }, { year: 2022, value: 12.4 }], direction: 'lower-better' },
  { sdg: '11.2.1', goal: 11, title: 'Public Transport Accessibility', indicator: 'Proportion of population that has convenient access to public transport, by sex, age and persons with disabilities.', value: '84.2', unit: 'Percentage (%)', year: 2023, confidence: 91, page: 37, paragraph: 2, topic: 'SUSTAINABLE TRANSPORT',
    quote: 'Following the extension of the high-frequency bus corridors, {h:84.2%} of the population of {city} now lives {h:within 500 metres of a public transport stop} served at least every 20 minutes during peak hours, up from 79.6% in the previous plan period.',
    trend: [{ year: 2019, value: 76.1 }, { year: 2021, value: 79.6 }, { year: 2023, value: 84.2 }], direction: 'higher-better' },
  { sdg: '7.2.1', goal: 7, title: 'Renewable Energy Share', indicator: 'Renewable energy share in the total final energy consumption.', value: '18.5', unit: 'Percentage (%)', year: 2023, confidence: 89, page: 14, paragraph: 1, topic: 'CLEAN ENERGY',
    quote: 'Renewable sources accounted for {h:18.5%} of final energy consumption across the municipal territory in 2023, driven primarily by {h:rooftop photovoltaic installations} on public buildings and the district heating conversion programme.',
    trend: [{ year: 2019, value: 11.2 }, { year: 2021, value: 14.9 }, { year: 2023, value: 18.5 }], direction: 'higher-better' },
  { sdg: '6.1.1', goal: 6, title: 'Safely Managed Drinking Water', indicator: 'Proportion of population using safely managed drinking water services.', value: '99.1', unit: 'Percentage (%)', year: 2023, confidence: 97, page: 8, paragraph: 4, topic: 'WATER SERVICES',
    quote: 'The municipal water utility reports that {h:99.1%} of households are connected to {h:safely managed, continuously monitored drinking water services}, with the residual 0.9% concentrated in peri-urban settlements scheduled for network extension in {year}.',
    trend: [{ year: 2019, value: 98.2 }, { year: 2021, value: 98.7 }, { year: 2023, value: 99.1 }], direction: 'higher-better' },
  { sdg: '11.6.2', goal: 11, title: 'PM2.5 Annual Mean', indicator: 'Annual mean levels of fine particulate matter (PM2.5) in cities (population weighted).', value: '9.8', unit: 'µg/m³', year: 2023, confidence: 92, page: 21, paragraph: 2, topic: 'AIR QUALITY',
    quote: 'Population-weighted annual mean PM2.5 concentration fell to {h:9.8 µg/m³} in 2023, the {h:lowest value on record} for {city}, although still above the WHO 2021 guideline value of 5 µg/m³.',
    trend: [{ year: 2019, value: 12.6 }, { year: 2021, value: 11.1 }, { year: 2023, value: 9.8 }], direction: 'lower-better' },
  { sdg: '3.6.1', goal: 3, title: 'Road Traffic Deaths', indicator: 'Death rate due to road traffic injuries.', value: '2.1', unit: 'per 100,000 inhabitants', year: 2023, confidence: 88, page: 66, paragraph: 1, topic: 'ROAD SAFETY',
    quote: 'Road traffic fatalities reached {h:2.1 deaths per 100,000 inhabitants} in 2023, a 30% reduction relative to the 2019 baseline, attributable to the {h:city-wide 30 km/h speed limit} and protected cycling infrastructure.',
    trend: [{ year: 2019, value: 3.0 }, { year: 2021, value: 2.6 }, { year: 2023, value: 2.1 }], direction: 'lower-better' },
  { sdg: '8.5.2', goal: 8, title: 'Unemployment Rate', indicator: 'Unemployment rate, by sex, age and persons with disabilities.', value: '9.3', unit: 'Percentage (%)', year: 2023, confidence: 95, page: 52, paragraph: 3, topic: 'DECENT WORK',
    quote: 'The registered unemployment rate in {city} stood at {h:9.3%} at year-end 2023, with {h:youth unemployment (16–24) at 21.7%}, remaining the most significant labour-market challenge identified by the municipal employment agency.',
    trend: [{ year: 2019, value: 11.8 }, { year: 2021, value: 12.4 }, { year: 2023, value: 9.3 }], direction: 'lower-better' },
  { sdg: '1.2.1', goal: 1, title: 'Population Below Poverty Line', indicator: 'Proportion of population living below the national poverty line, by sex and age.', value: '17.8', unit: 'Percentage (%)', year: 2022, confidence: 86, page: 11, paragraph: 2, topic: 'POVERTY REDUCTION',
    quote: 'According to the household survey, {h:17.8%} of residents live below the national relative poverty threshold, with rates {h:exceeding 25% in three southern districts}, compared with a city-wide figure of 19.4% in 2020.',
    trend: [{ year: 2018, value: 20.1 }, { year: 2020, value: 19.4 }, { year: 2022, value: 17.8 }], direction: 'lower-better' },
  { sdg: '4.2.2', goal: 4, title: 'Early Learning Participation', indicator: 'Participation rate in organized learning (one year before the official primary entry age).', value: '96.4', unit: 'Percentage (%)', year: 2023, confidence: 93, page: 29, paragraph: 1, topic: 'QUALITY EDUCATION',
    quote: '{h:96.4%} of children aged five were enrolled in {h:organised pre-primary education} during the 2022/23 school year, following the opening of 14 new municipal early-childhood centres.',
    trend: [{ year: 2019, value: 93.0 }, { year: 2021, value: 94.8 }, { year: 2023, value: 96.4 }], direction: 'higher-better' },
  { sdg: '13.2.2', goal: 13, title: 'GHG Emissions per Capita', indicator: 'Total greenhouse gas emissions per year (per capita).', value: '3.9', unit: 'tCO₂e per capita', year: 2022, confidence: 90, page: 5, paragraph: 2, topic: 'CLIMATE ACTION',
    quote: 'Territorial greenhouse gas emissions in {city} were estimated at {h:3.9 tCO₂e per capita} in 2022, a {h:22% reduction from the 2015 baseline}, keeping the city on track for its 2030 interim target of −50%.',
    trend: [{ year: 2018, value: 4.8 }, { year: 2020, value: 4.2 }, { year: 2022, value: 3.9 }], direction: 'lower-better' },
  { sdg: '5.5.1', goal: 5, title: 'Women in Local Government', indicator: 'Proportion of seats held by women in local governments.', value: '48.1', unit: 'Percentage (%)', year: 2023, confidence: 98, page: 3, paragraph: 4, topic: 'GENDER EQUALITY',
    quote: 'Women hold {h:48.1%} of seats in the {city} municipal council following the most recent local elections, up from 44.4% in the previous term and {h:above the national average of 43%}.',
    trend: [{ year: 2015, value: 40.7 }, { year: 2019, value: 44.4 }, { year: 2023, value: 48.1 }], direction: 'higher-better' },
  { sdg: '16.6.2', goal: 16, title: 'Satisfaction with Public Services', indicator: 'Proportion of population satisfied with their last experience of public services.', value: '63.0', unit: 'Percentage (%)', year: 2023, confidence: 84, page: 74, paragraph: 3, topic: 'PUBLIC SERVICES',
    quote: 'The {year} citizen satisfaction barometer shows that {h:63%} of respondents rated their last interaction with municipal services as good or very good, with {h:digital service channels scoring highest} (71%) and in-person offices lowest (54%).',
    trend: [{ year: 2019, value: 58.0 }, { year: 2021, value: 60.5 }, { year: 2023, value: 63.0 }], direction: 'higher-better' },
  { sdg: '6.3.1', goal: 6, title: 'Wastewater Safely Treated', indicator: 'Proportion of domestic and industrial wastewater flows safely treated.', value: '98.6', unit: 'Percentage (%)', year: 2023, confidence: 95, page: 19, paragraph: 2, topic: 'WATER SERVICES',
    quote: 'The municipal treatment plants processed {h:98.6%} of collected wastewater to secondary or tertiary standard in 2023, following the {h:commissioning of the southern treatment line} in {city}.',
    trend: [{ year: 2019, value: 96.1 }, { year: 2021, value: 97.4 }, { year: 2023, value: 98.6 }], direction: 'higher-better' },
  { sdg: '2.1.2', goal: 2, title: 'Moderate or Severe Food Insecurity', indicator: 'Prevalence of moderate or severe food insecurity in the population.', value: '7.9', unit: 'Percentage (%)', year: 2023, confidence: 87, page: 33, paragraph: 1, topic: 'FOOD SECURITY',
    quote: 'The {year} social services barometer estimates that {h:7.9%} of households in {city} experienced moderate or severe food insecurity, down from 9.6% two years earlier thanks to the {h:expanded school meal programme}.',
    trend: [{ year: 2019, value: 10.8 }, { year: 2021, value: 9.6 }, { year: 2023, value: 7.9 }], direction: 'lower-better' },
  { sdg: '9.c.1', goal: 9, title: 'Broadband Coverage', indicator: 'Proportion of population covered by a mobile network, by technology.', value: '96.3', unit: 'Percentage (%)', year: 2023, confidence: 96, page: 71, paragraph: 2, topic: 'DIGITAL INFRASTRUCTURE',
    quote: 'Fibre or 5G coverage reached {h:96.3%} of households in {city} by the end of 2023, with the remaining gap concentrated in {h:three peripheral rural districts} included in the 2025 roll-out plan.',
    trend: [{ year: 2019, value: 81.4 }, { year: 2021, value: 90.2 }, { year: 2023, value: 96.3 }], direction: 'higher-better' },
  { sdg: '12.5.1', goal: 12, title: 'Municipal Recycling Rate', indicator: 'National recycling rate, tons of material recycled.', value: '41.2', unit: 'Percentage (%)', year: 2023, confidence: 90, page: 27, paragraph: 3, topic: 'WASTE MANAGEMENT',
    quote: 'Separate collection and recycling accounted for {h:41.2%} of municipal solid waste in 2023, an increase of six points since the {h:door-to-door organic collection} was extended to the whole of {city}.',
    trend: [{ year: 2019, value: 31.5 }, { year: 2021, value: 35.0 }, { year: 2023, value: 41.2 }], direction: 'higher-better' },
  { sdg: '15.1.2', goal: 15, title: 'Protected Green Area Share', indicator: 'Proportion of important sites for terrestrial biodiversity covered by protected areas.', value: '18.9', unit: 'Percentage (%)', year: 2023, confidence: 88, page: 12, paragraph: 4, topic: 'BIODIVERSITY',
    quote: 'Protected natural and green areas now cover {h:18.9%} of the municipal territory of {city}, after the {h:designation of the riverbank corridor} as a protected landscape in {year}.',
    trend: [{ year: 2019, value: 15.2 }, { year: 2021, value: 16.8 }, { year: 2023, value: 18.9 }], direction: 'higher-better' },
  { sdg: '10.1.1', goal: 10, title: 'Income Growth of Bottom 40%', indicator: 'Growth rates of household income per capita among the bottom 40 per cent of the population.', value: '2.4', unit: '% per year', year: 2023, confidence: 83, page: 48, paragraph: 2, topic: 'INEQUALITY',
    quote: 'Household income among the bottom 40% of earners in {city} grew by {h:2.4% per year} in real terms between 2020 and 2023, {h:slightly above the city-wide average of 2.1%}, narrowing the income gap for the first time in a decade.',
    trend: [{ year: 2019, value: 1.1 }, { year: 2021, value: 1.7 }, { year: 2023, value: 2.4 }], direction: 'higher-better' },
];

export const DOCUMENTARY_TEMPLATES = [
  { sdg: '11.1', goal: 11, category: 'C1', categoryLabel: 'Challenge', title: 'Housing affordability pressure in central districts', confidence: 91, page: 18, paragraph: 2,
    summary: 'Rental prices in central districts have risen 34% since 2018, outpacing household income growth and pushing lower-income residents to the periphery.',
    quote: 'Average rents in the central districts of {city} have increased by {h:34% since 2018}, while median household income grew by only 9% over the same period, {h:displacing lower-income families} towards peripheral neighbourhoods.' },
  { sdg: '13.2', goal: 13, category: 'C2', categoryLabel: 'Commitment', title: 'Climate neutrality by 2050 with 2030 interim target', confidence: 96, page: 4, paragraph: 1,
    summary: 'The city commits to reaching climate neutrality by 2050 and a 50% reduction in GHG emissions by 2030 relative to 2015.',
    quote: 'The City Council of {city} hereby commits to achieving {h:climate neutrality by 2050}, with an intermediate target of a {h:50% reduction in greenhouse gas emissions by 2030} against the 2015 baseline.' },
  { sdg: '11.6', goal: 11, category: 'C3', categoryLabel: 'Policy', title: 'Low Emission Zone covering the entire municipality', confidence: 93, page: 12, paragraph: 3,
    summary: 'A phased Low Emission Zone restricts the most polluting vehicles city-wide, with full enforcement from January 2025.',
    quote: 'The {h:Low Emission Zone} entered into force across the whole municipal territory in {year}, restricting access for vehicles without an environmental label, with {h:full enforcement scheduled for January 2025}.' },
  { sdg: '6.4', goal: 6, category: 'C1', categoryLabel: 'Challenge', title: 'Water stress during prolonged drought periods', confidence: 87, page: 31, paragraph: 4,
    summary: 'Reservoir levels dropped below 40% capacity during the 2022 drought, triggering stage-2 water-use restrictions.',
    quote: 'During the summer of 2022, reservoir capacity fell to {h:38%}, obliging the utility to activate {h:stage-2 consumption restrictions} for the first time since 2008.' },
  { sdg: '7.2', goal: 7, category: 'C2', categoryLabel: 'Commitment', title: '100% renewable electricity in municipal buildings by 2027', confidence: 90, page: 9, paragraph: 2,
    summary: 'All municipal facilities will be supplied with certified renewable electricity by 2027, with 60 MW of rooftop solar installed.',
    quote: 'By 2027 all municipal facilities in {city} will be supplied exclusively with {h:certified renewable electricity}, supported by the installation of {h:60 MW of rooftop photovoltaic capacity} on public buildings.' },
  { sdg: '4.a', goal: 4, category: 'C3', categoryLabel: 'Policy', title: 'Municipal early-childhood education expansion programme', confidence: 88, page: 27, paragraph: 1,
    summary: 'Fourteen new public early-childhood centres opened between 2021 and 2023, adding 1,900 places.',
    quote: 'Under the {h:Early Childhood Expansion Programme}, fourteen new municipal centres were opened between 2021 and 2023, {h:adding 1,900 publicly funded places} in the districts with the highest waiting lists.' },
  { sdg: '16.6', goal: 16, category: 'C3', categoryLabel: 'Policy', title: 'Open-data transparency portal with mandatory publication', confidence: 92, page: 6, paragraph: 2,
    summary: 'All municipal contracts above €15,000, council minutes and budget execution are published on the open-data portal within 30 days.',
    quote: 'Since {year} the {h:Transparency Ordinance} obliges {city} to publish every contract above €15,000, all council minutes and quarterly budget execution on the open-data portal {h:within 30 days}.' },
  { sdg: '12.5', goal: 12, category: 'C2', categoryLabel: 'Commitment', title: 'Zero-waste target: 65% recycling by 2030', confidence: 89, page: 24, paragraph: 1,
    summary: 'The city commits to recycle 65% of municipal waste by 2030 and to halve landfill disposal.',
    quote: '{city} commits to reaching a {h:65% recycling rate by 2030} and to {h:halving the volume of waste sent to landfill} against the 2020 baseline.' },
  { sdg: '2.1', goal: 2, category: 'C1', categoryLabel: 'Challenge', title: 'Food insecurity concentrated in single-parent households', confidence: 85, page: 34, paragraph: 3,
    summary: 'Single-parent households show food-insecurity rates twice the city average despite the school meal programme.',
    quote: 'Food insecurity remains {h:twice as prevalent among single-parent households} (15.8%) as in the general population of {city}, a gap the school meal programme has {h:only partially closed}.' },
];

export const PROJECT_TEMPLATES = [
  { sdg: '11.2', goal: 11, title: '{city} Bus Rapid Transit Corridor Network', status: 'In execution', budget: '€142M', period: '2022–2026', lead: 'Municipal Transport Authority', confidence: 92, page: 44, paragraph: 1,
    summary: 'Five high-frequency bus corridors with dedicated lanes connecting peripheral districts to the city centre.',
    quote: 'The {h:Bus Rapid Transit Corridor Network} comprises five dedicated-lane corridors totalling 68 km, with a budget of {h:€142 million} for the 2022–2026 period.' },
  { sdg: '15.1', goal: 15, title: 'Metropolitan Forest Green Belt', status: 'In execution', budget: '€75M', period: '2021–2030', lead: 'Environment & Mobility Department', confidence: 89, page: 58, paragraph: 2,
    summary: 'A 75 km green belt of native forest around the city, planting 450,000 trees to mitigate the urban heat island.',
    quote: 'The {h:Metropolitan Forest} project will create a 75 km green ring around {city}, planting {h:450,000 native trees} by 2030 and reducing local temperatures by up to 2 °C.' },
  { sdg: '11.1', goal: 11, title: 'Affordable Rental Housing Programme', status: 'Planned', budget: '€310M', period: '2024–2028', lead: 'Municipal Housing Company', confidence: 85, page: 23, paragraph: 3,
    summary: '4,200 new affordable rental units on municipal land, prioritising households below 60% of median income.',
    quote: 'The programme will deliver {h:4,200 affordable rental homes} on municipally owned land between 2024 and 2028, {h:prioritising households below 60% of median income}.' },
  { sdg: '7.3', goal: 7, title: 'Public Building Energy Retrofit Plan', status: 'In execution', budget: '€58M', period: '2023–2027', lead: 'Works & Equipment Department', confidence: 90, page: 16, paragraph: 2,
    summary: 'Deep energy retrofit of 120 schools and civic centres, targeting a 45% reduction in energy consumption.',
    quote: '{h:120 schools and civic centres} will undergo deep energy retrofits under the plan, targeting a {h:45% reduction in energy consumption} across the municipal building stock.' },
  { sdg: '9.c', goal: 9, title: 'Digital Inclusion & Municipal Fibre Network', status: 'Completed', budget: '€21M', period: '2020–2023', lead: 'Digital Office', confidence: 94, page: 70, paragraph: 1,
    summary: 'Free public Wi-Fi in 340 municipal facilities and fibre connectivity for every public school.',
    quote: 'Completed in 2023, the initiative delivered {h:free public Wi-Fi in 340 municipal facilities} and {h:fibre connectivity to every public school} in {city}.' },
  { sdg: '3.8', goal: 3, title: 'Neighbourhood Primary Care Centres Programme', status: 'In execution', budget: '€64M', period: '2023–2027', lead: 'Health & Social Services Department', confidence: 91, page: 39, paragraph: 2,
    summary: 'Six new primary-care centres so that every resident of {city} lives within 15 minutes of a health centre.',
    quote: 'The programme finances {h:six new primary-care centres} with a budget of {h:€64 million}, ensuring that every resident of {city} lives within a 15-minute walk of a health centre by 2027.' },
  { sdg: '12.5', goal: 12, title: 'Circular Economy Hub & Repair Network', status: 'In execution', budget: '€9M', period: '2024–2026', lead: 'Environment & Mobility Department', confidence: 87, page: 29, paragraph: 1,
    summary: 'A circular-economy hub and 12 neighbourhood repair cafés to cut residual waste.',
    quote: 'A {h:circular-economy hub} and a network of {h:12 neighbourhood repair points} will divert an estimated 4,000 tonnes of goods per year from the residual waste stream in {city}.' },
  { sdg: '13.1', goal: 13, title: 'Urban Flood Resilience Plan', status: 'Planned', budget: '€48M', period: '2025–2029', lead: 'Water Utility & Civil Protection', confidence: 86, page: 51, paragraph: 3,
    summary: 'Sustainable drainage systems and retention parks in the districts most exposed to flash flooding.',
    quote: 'The plan allocates {h:€48 million} to sustainable drainage systems and {h:four retention parks} in the districts of {city} most exposed to flash flooding.' },
];

export const STAKEHOLDER_TEMPLATES = [
  { sdg: '11.1', goal: 11, category: 'Challenge', title: 'Rising rents forcing young families out of central neighbourhoods', group: 'Neighbourhood associations', engagement: 'Citizen assembly', confidence: 88, page: 6, paragraph: 3,
    quote: 'Our children cannot afford to live in the neighbourhood where they grew up. {h:Rents have doubled in ten years} and the council has to act now.' },
  { sdg: '11.7', goal: 11, category: 'Priority', title: 'More shaded green space in dense southern districts', group: 'Youth council', engagement: 'Participatory workshop', confidence: 84, page: 9, paragraph: 1,
    quote: 'In summer the squares are unusable. We need {h:trees and shade, not more concrete} — green space should be a priority in the southern districts.' },
  { sdg: '11.2', goal: 11, category: 'Recommendation', title: 'Extend night bus services to peripheral districts', group: 'Shift workers collective', engagement: 'Public consultation', confidence: 86, page: 14, paragraph: 2,
    quote: 'Many of us finish work after midnight. {h:Extending the night bus network} to the outer districts would make a real difference to our safety and our wallets.' },
  { sdg: '16.7', goal: 16, category: 'Correction', title: 'Participation figures for the 2023 budget process overstated', group: 'Civic transparency observatory', engagement: 'Written submission', confidence: 79, page: 2, paragraph: 4,
    quote: 'The draft report cites 42,000 participants in the participatory budget; the official platform records {h:31,600 verified participants}. We request the figure be corrected.' },
  { sdg: '13.1', goal: 13, category: 'Priority', title: 'Flood protection for low-lying neighbourhoods', group: 'Riverside residents platform', engagement: 'Citizen assembly', confidence: 85, page: 11, paragraph: 2,
    quote: 'Every autumn we watch the water rise. {h:Flood protection is not a climate slogan for us — it is our homes.} The plan must start with the riverside streets.' },
  { sdg: '8.6', goal: 8, category: 'Recommendation', title: 'Paid apprenticeships linked to municipal contracts', group: 'Youth employment forum', engagement: 'Participatory workshop', confidence: 82, page: 17, paragraph: 1,
    quote: 'If the city spends millions on contracts, {h:every contract should carry paid apprenticeships} for young people from the neighbourhood.' },
];

export const TEMPLATES = { indicators: INDICATOR_TEMPLATES, documentary: DOCUMENTARY_TEMPLATES, projects: PROJECT_TEMPLATES, stakeholders: STAKEHOLDER_TEMPLATES };

/** Templates applicable to a project: those matching its target SDGs first; topped up to a small minimum so every pillar has content. */
const MIN_PER_PILLAR = { indicators: 6, documentary: 3, projects: 3, stakeholders: 2 };
export function templatePlan(project, pillar) {
  const tpl = TEMPLATES[pillar];
  const goals = new Set((project?.sdgs || []).map(Number));
  if (!goals.size) return tpl;
  const matching = tpl.filter(t => goals.has(t.goal));
  const min = MIN_PER_PILLAR[pillar] || 2;
  if (matching.length >= min) return matching;
  return [...matching, ...tpl.filter(t => !goals.has(t.goal)).slice(0, min - matching.length)];
}
export const expectedExtractions = (project) => PILLARS.reduce((a, p) => a + templatePlan(project, p.key).length, 0);

/** Prefer document types that plausibly contain a pillar's evidence (minutes/surveys for stakeholders, data sheets for indicators…). */
const PILLAR_DOC_PREFS = { indicators: ['Data Sheet', 'Documentary', 'Plan', 'Budget', 'Legacy Data'], documentary: ['Policy', 'Plan', 'Documentary'], projects: ['Plan', 'Budget', 'Documentary', 'Policy'], stakeholders: ['Minutes', 'Survey'] };
export function pickSourceDoc(pillar, docs, i = 0) {
  const prefs = PILLAR_DOC_PREFS[pillar] || [];
  const pref = docs.filter(d => prefs.includes(d.type));
  const pool = pref.length ? pref : docs;
  return pool[i % pool.length];
}

/** Substitute {city}/{year}; keep {h:...} highlight markers (rendered by the review page). */
export function fillTemplate(str, project) {
  return String(str).replace(/\{city\}/g, project.city).replace(/\{year\}/g, String(project.year));
}
/** Render a quote with {h:...} highlight markers to HTML (escaped). */
export function quoteToHtml(quote, esc) {
  return esc(quote).replace(/\{h:(.+?)\}/g, '<mark class="hl">$1</mark>');
}
export const quotePlain = (quote) => String(quote).replace(/\{h:(.+?)\}/g, '$1');

/**
 * Build extraction objects for a project from the templates.
 * @param project project object
 * @param docs the project's documents (sources are distributed across them)
 * @param opts { pillar, limit, status, docId (force a single source doc) }
 */
export function buildTemplateExtractions(project, docs, { pillar, limit, status = 'extracted', docId, existing = [] } = {}) {
  const pillars = pillar ? [pillar] : PILLARS.map(p => p.key);
  const out = [];
  const sources = docs.length ? docs : [{ id: null, name: `${project.city}_VLR_Source_Pack.pdf`, pages: 120 }];
  let counter = 0;
  for (const pk of pillars) {
    const tpl = templatePlan(project, pk);
    const have = new Set(existing.filter(e => e.pillar === pk).map(e => e.sdg + '|' + e.title));
    const items = limit ? tpl.slice(0, limit) : tpl;
    for (const t of items) {
      const title = fillTemplate(t.title, project);
      if (have.has(t.sdg + '|' + title)) continue;
      const src = docId ? sources.find(d => d.id === docId) || sources[0] : pickSourceDoc(pk, sources, counter);
      counter++;
      out.push({
        id: uid('ext'), projectId: project.id, pillar: pk, sdg: t.sdg, goal: t.goal, title,
        indicator: t.indicator ? fillTemplate(t.indicator, project) : undefined,
        value: t.value, unit: t.unit, year: t.year, topic: t.topic,
        category: t.category, categoryLabel: t.categoryLabel, summary: t.summary ? fillTemplate(t.summary, project) : undefined,
        projectStatus: t.status, budget: t.budget, period: t.period, lead: t.lead,
        group: t.group, engagement: t.engagement,
        confidence: t.confidence, status,
        source: { docId: src.id, docName: src.name, page: Math.min(t.page, src.pages || t.page), paragraph: t.paragraph, quote: fillTemplate(t.quote, project) },
        trend: t.trend ? t.trend.map(x => ({ ...x })) : undefined, direction: t.direction,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Seed state                                                          */
/* ------------------------------------------------------------------ */
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

function mkDoc(projectId, name, { type, language = 'EN', status = 'processed', pages, sizeKb, uploadedAt, translated, code, progress } = {}, i = 0) {
  const ext = fileExt(name);
  const pg = pages ?? ({ pdf: 96, docx: 24, xlsx: 12, csv: 4, xml: 30, json: 8, md: 18 }[ext] || 20);
  return {
    id: uid('doc'), projectId, name, ext, type: type || docTypeFromName(name), language, status,
    pages: pg, sizeKb: sizeKb ?? Math.round(pg * ({ pdf: 210, docx: 48, xlsx: 36, csv: 9, xml: 22 }[ext] || 40)),
    uploadedAt: uploadedAt ?? Date.now() - (30 - i) * DAY,
    translated: translated ?? language === 'EN', translatedTo: 'EN',
    code: code || `${projectId.slice(0, 3).toUpperCase()}-DOC-${String(401 + i).padStart(3, '0')}`,
    progress: progress ?? (status === 'processed' ? 100 : status === 'parsing' ? 42 : 0),
    parsedAt: status === 'processed' ? (uploadedAt ?? Date.now() - (30 - i) * DAY) + 2 * HOUR : null,
  };
}

function mkTask(projectId, step, { inputDoc, inputDocId, status = 'success', createdAt, durationMs, cost, progress, node = 'EU-WEST-1', error, runId, output } = {}) {
  const meta = STEP_META[step];
  const created = createdAt ?? Date.now() - 2 * HOUR;
  const dur = durationMs ?? Math.round(meta.durationMs * 30);
  return {
    id: uid('task'), projectId, runId: runId ?? null, step, label: meta.label, inputDoc, inputDocId: inputDocId ?? null,
    status, createdAt: created, startedAt: status === 'queued' ? null : created + 3_000,
    finishedAt: status === 'success' || status === 'failed' || status === 'cancelled' ? created + 3_000 + dur : null,
    durationMs: status === 'running' ? null : dur,
    progress: progress ?? (status === 'success' ? 100 : status === 'running' ? 35 : 0),
    estimatedMs: status === 'running' ? 75_000 + Math.round(Math.random() * 40_000) : undefined,
    _progressBase: status === 'running' ? (progress ?? 35) : undefined,
    cost: cost ?? (status === 'success' ? Number((meta.base + meta.perPage * 60).toFixed(2)) : status === 'failed' ? Number((meta.base * 0.4).toFixed(2)) : 0),
    node, error: error ?? null, logs: [], output: output ?? null, dependsOn: [],
  };
}

export function buildSeed() {
  const now = Date.now();
  const projects = [
    { id: 'madrid-2024', name: 'Madrid 2024 VLR', city: 'Madrid', country: 'Spain', jurisdiction: 'Madrid City Council', year: 2024, status: 'active',
      sdgs: [1, 3, 4, 5, 6, 7, 8, 11, 13, 16], languages: ['ES', 'EN'], region: 'Europe', createdAt: now - 62 * DAY, node: 'EU-WEST-1',
      description: 'Voluntary Local Review of the City of Madrid for the 2024 reporting cycle, covering the 2030 Agenda localisation strategy.', lastSyncedAt: now - 14 * MIN, lead: 'Jorge Cimentada' },
    { id: 'bogota-2023', name: 'Bogotá 2023 VLR', city: 'Bogotá', country: 'Colombia', jurisdiction: 'Alcaldía de Bogotá', year: 2023, status: 'archived',
      sdgs: [2, 11, 14, 1, 3, 4, 5, 6, 8, 10, 13, 16], languages: ['ES'], region: 'Latin America and the Caribbean', createdAt: now - 400 * DAY, node: 'US-EAST-G01', archivedAt: now - 120 * DAY,
      description: 'Second Voluntary Local Review of Bogotá D.C. Finalised and submitted to the UN DESA VLR repository.', lastSyncedAt: now - 120 * DAY, lead: 'Alex Santana' },
    { id: 'vancouver-2024', name: 'Vancouver 2024 VLR', city: 'Vancouver', country: 'Canada', jurisdiction: 'Metro Vancouver', year: 2024, status: 'provisioning',
      sdgs: [13, 15], languages: ['EN', 'FR'], region: 'North America', createdAt: now - 3 * DAY, node: 'US-EAST-G01',
      description: 'First VLR of the Metro Vancouver regional district, focused on climate action and biodiversity.', lastSyncedAt: now - 2 * HOUR, lead: 'Jorge Cimentada' },
  ];

  /* ---- documents ---- */
  const madridDocs = [
    ['Sustainability_Report_2023.pdf', { type: 'Documentary', language: 'ES', status: 'processed', pages: 148, code: 'MDC-DOC-401' }],
    ['Mobility_Indicators_Q3.xlsx', { type: 'Data Sheet', language: 'EN', status: 'parsing', pages: 14, code: 'MDC-DOC-402', progress: 42 }],
    ['Climate_Policy_Brief.docx', { type: 'Policy', language: 'ES', status: 'uploaded', pages: 22, code: 'MDC-DOC-403', translated: false }],
    ['Madrid_Mobility_Plan.pdf', { type: 'Plan', language: 'ES', status: 'processed', pages: 212, code: 'MDC-DOC-404', translated: true }],
    ['Annual_Energy_Report.xlsx', { type: 'Data Sheet', language: 'EN', status: 'processed', pages: 18, code: 'MDC-DOC-405' }],
    ['Housing_Affordability_Plan_2024.pdf', { type: 'Policy', language: 'ES', status: 'processed', pages: 96, code: 'MDC-DOC-429', translated: true, uploadedAt: now - 2 * DAY - 10 * MIN }],
    ['Citizen_Assembly_Minutes_Mar2024.docx', { type: 'Minutes', language: 'ES', status: 'processed', pages: 31, code: 'MDC-DOC-430', translated: true }],
    ['Madrid_360_Air_Quality_Strategy.pdf', { type: 'Policy', language: 'ES', status: 'processed', pages: 124, code: 'MDC-DOC-431', translated: true }],
    ['Municipal_Budget_2024.xlsx', { type: 'Budget', language: 'ES', status: 'processed', pages: 42, code: 'MDC-DOC-432', translated: true }],
    ['Barrios_Survey_Results_2023.csv', { type: 'Survey', language: 'ES', status: 'processed', pages: 6, code: 'MDC-DOC-433', translated: true }],
    ['Water_Services_Annual_Report.pdf', { type: 'Documentary', language: 'ES', status: 'processed', pages: 88, code: 'MDC-DOC-434', translated: true }],
    ['legacy_indicators_export.xml', { type: 'Legacy Data', language: 'EN', status: 'processed', pages: 30, code: 'MDC-DOC-435' }],
  ].map(([n, o], i) => mkDoc('madrid-2024', n, { uploadedAt: now - (40 - i * 2) * DAY, ...o }, i));

  const bogotaNames = [
    'Plan_de_Desarrollo_Distrital_2020-2024.pdf', 'Informe_Calidad_de_Vida_2022.pdf', 'Encuesta_Multiproposito_2021.csv', 'Politica_Publica_Habitat_2023.pdf',
    'Plan_Maestro_Movilidad.pdf', 'Presupuesto_Distrital_2023.xlsx', 'Actas_Cabildos_Ciudadanos_2023.docx', 'Estrategia_Accion_Climatica_2050.pdf',
    'Informe_Acueducto_2022.pdf', 'Plan_Ordenamiento_Territorial.pdf', 'Indicadores_ODS_Bogota_2022.xlsx', 'Informe_Seguridad_Alimentaria.pdf',
  ];
  const bogotaDocs = [];
  for (let i = 0; i < 45; i++) {
    const base = bogotaNames[i % bogotaNames.length];
    const name = i < bogotaNames.length ? base : base.replace(/(\.[a-z]+)$/, `_Anexo_${Math.floor(i / bogotaNames.length)}$1`);
    bogotaDocs.push(mkDoc('bogota-2023', name, { language: 'ES', status: 'processed', translated: true, uploadedAt: now - (380 - i * 3) * DAY, code: `BOG-DOC-${String(101 + i).padStart(3, '0')}` }, i));
  }
  const vancouverDocs = [
    ['Climate_Emergency_Action_Plan.pdf', { type: 'Plan', language: 'EN', status: 'processed', pages: 132 }],
    ['Metro_2050_Regional_Growth_Strategy.pdf', { type: 'Plan', language: 'EN', status: 'uploaded', pages: 210 }],
    ['Biodiversity_Strategy_2023.pdf', { type: 'Policy', language: 'EN', status: 'uploaded', pages: 64 }],
    ['Regional_Indicators_Dashboard.xlsx', { type: 'Data Sheet', language: 'EN', status: 'uploaded', pages: 22 }],
    ['Plan_action_climatique_FR.pdf', { type: 'Plan', language: 'FR', status: 'uploaded', pages: 132, translated: false }],
    ['Public_Engagement_Summary_2023.docx', { type: 'Minutes', language: 'EN', status: 'uploaded', pages: 40 }],
    ['Housing_Needs_Report.pdf', { type: 'Documentary', language: 'EN', status: 'uploaded', pages: 78 }],
    ['Transit_Ridership_2023.csv', { type: 'Data Sheet', language: 'EN', status: 'uploaded', pages: 3 }],
  ].map(([n, o], i) => mkDoc('vancouver-2024', n, { ...o, uploadedAt: now - (3 * DAY) + i * HOUR, code: `VAN-DOC-${String(101 + i).padStart(3, '0')}` }, i));

  const documents = [...madridDocs, ...bogotaDocs, ...vancouverDocs];
  const byName = (pid, n) => documents.find(d => d.projectId === pid && d.name === n);

  /* ---- extractions ---- */
  const madrid = projects[0];
  const madridSources = {
    '11.1.1': 'Housing_Affordability_Plan_2024.pdf', '11.2.1': 'Madrid_Mobility_Plan.pdf', '7.2.1': 'Annual_Energy_Report.xlsx', '6.1.1': 'Water_Services_Annual_Report.pdf',
    '11.6.2': 'Madrid_360_Air_Quality_Strategy.pdf', '3.6.1': 'Sustainability_Report_2023.pdf', '8.5.2': 'Sustainability_Report_2023.pdf', '1.2.1': 'Barrios_Survey_Results_2023.csv', '6.3.1': 'Water_Services_Annual_Report.pdf',
    '4.2.2': 'Sustainability_Report_2023.pdf', '13.2.2': 'Madrid_360_Air_Quality_Strategy.pdf', '5.5.1': 'Sustainability_Report_2023.pdf',
    '11.1': 'Housing_Affordability_Plan_2024.pdf', '13.2': 'Madrid_360_Air_Quality_Strategy.pdf', '11.6': 'Madrid_360_Air_Quality_Strategy.pdf', '6.4': 'Water_Services_Annual_Report.pdf', '7.2': 'Annual_Energy_Report.xlsx',
    '11.2': 'Madrid_Mobility_Plan.pdf', '15.1': 'Sustainability_Report_2023.pdf', '7.3': 'Municipal_Budget_2024.xlsx', '9.c': 'Sustainability_Report_2023.pdf',
    '11.7': 'Citizen_Assembly_Minutes_Mar2024.docx', '16.7': 'Citizen_Assembly_Minutes_Mar2024.docx',
  };
  const madridExt = [];
  const pushTpl = (pillar, list, status = 'extracted') => {
    for (const t of list) {
      const srcName = pillar === 'stakeholders' ? 'Citizen_Assembly_Minutes_Mar2024.docx' : (madridSources[t.sdg] || 'Sustainability_Report_2023.pdf');
      const doc = byName('madrid-2024', srcName) || madridDocs[0];
      const built = buildTemplateExtractions({ ...madrid, sdgs: [] }, [doc], { pillar, status, existing: [] }).find(x => x.sdg === t.sdg && x.title === fillTemplate(t.title, madrid));
      if (!built) continue;
      built.createdAt = now - (9 * DAY) + madridExt.length * 3 * HOUR; built.updatedAt = built.createdAt;
      madridExt.push(built);
    }
  };
  const madridGoals = new Set(madrid.sdgs);
  pushTpl('indicators', INDICATOR_TEMPLATES.filter(t => madridGoals.has(t.goal) && t.sdg !== '16.6.2'));
  pushTpl('documentary', DOCUMENTARY_TEMPLATES.slice(0, 5));
  pushTpl('projects', PROJECT_TEMPLATES.slice(0, 4));
  pushTpl('stakeholders', STAKEHOLDER_TEMPLATES.slice(0, 4));
  // a couple already approved
  madridExt.filter(e => ['6.1.1', '5.5.1'].includes(e.sdg)).forEach(e => { e.status = 'approved'; e.reviewedBy = 'Jorge Cimentada'; e.reviewedAt = now - 2 * DAY; });
  // Move the mock-up's featured indicators to the front of the list (11.2.1 and 7.2.1)
  const featured = ['11.2.1', '7.2.1'];
  const rank = (e) => { const i = featured.indexOf(e.sdg); return e.pillar === 'indicators' && i >= 0 ? i : 99; };
  madridExt.sort((a, b) => rank(a) - rank(b));

  const bogota = projects[1];
  const bogotaExt = buildTemplateExtractions(bogota, bogotaDocs.slice(0, 12), { status: 'approved' }).map((e, i) => ({ ...e, reviewedBy: 'Alex Santana', reviewedAt: now - (150 + i) * DAY, createdAt: now - (200 + i) * DAY, updatedAt: now - (150 + i) * DAY }));
  const vancouver = projects[2];
  const vancouverExt = buildTemplateExtractions(vancouver, [vancouverDocs[0]], { pillar: 'indicators', limit: 2 }).map((e, i) => ({ ...e, createdAt: now - 2 * HOUR + i * 5 * MIN, updatedAt: now - 2 * HOUR + i * 5 * MIN }));
  // Vancouver's featured SDGs are 13 & 15 → tweak one indicator to SDG 13
  const extractions = [...madridExt, ...bogotaExt, ...vancouverExt];

  /* ---- tasks (mirror of the Workflow Orchestration mock-up + history) ---- */
  const tasks = [];
  const mDoc = (n) => byName('madrid-2024', n);
  const d0 = new Date(); d0.setHours(14, 20, 12, 0);
  const T = (h, m, s) => { const d = new Date(); d.setHours(h, m, s, 0); return d.getTime(); };
  tasks.push(mkTask('madrid-2024', 'parse', { inputDoc: 'annex_ii_sdg_17.pdf', status: 'running', createdAt: now - 3 * MIN, progress: 62, node: 'US-EAST-G01' }));
  tasks.push(mkTask('madrid-2024', 'translate', { inputDoc: 'local_govt_report_es.json', status: 'failed', createdAt: now - 28 * MIN, durationMs: 12_000, error: 'Upstream translation service returned HTTP 503 (Service Unavailable) after 3 retries.', node: 'US-EAST-G01' }));
  tasks.push(mkTask('madrid-2024', 'validation', { inputDoc: 'master_indicators_v2.csv', status: 'success', createdAt: now - 73 * MIN, durationMs: 322_000, node: 'US-EAST-G01' }));
  tasks.push(mkTask('madrid-2024', 'normalization', { inputDoc: 'un_sdg_schema_map.yaml', status: 'success', createdAt: now - 98 * MIN, durationMs: 68_000, node: 'US-EAST-G01' }));
  tasks.push(mkTask('madrid-2024', 'xml_extraction', { inputDoc: 'legacy_data_source_3.xml', inputDocId: null, status: 'running', createdAt: now - 4 * MIN, progress: 18, node: 'US-EAST-G01' }));
  tasks.push(mkTask('madrid-2024', 'parse', { inputDoc: 'Mobility_Indicators_Q3.xlsx', inputDocId: mDoc('Mobility_Indicators_Q3.xlsx')?.id, status: 'running', createdAt: now - 6 * MIN, progress: 42 }));
  // queued work behind the running parsers (mock-up: Translation Engine "Pending...", Provenance Mapping "Queued")
  const qTranslate = mkTask('madrid-2024', 'translate', { inputDoc: 'Climate_Policy_Brief.docx', inputDocId: mDoc('Climate_Policy_Brief.docx')?.id, status: 'queued', createdAt: now - 5 * MIN });
  qTranslate.dependsOn = [tasks[tasks.length - 1].id];
  const qProv = mkTask('madrid-2024', 'provenance', { inputDoc: 'All documents (12)', status: 'queued', createdAt: now - 4 * MIN });
  qProv.dependsOn = [qTranslate.id];
  tasks.push(qTranslate, qProv);
  // historical successful tasks across projects (to reach ~42)
  const histSteps = ['parse', 'translate', 'extract_indicators', 'documentary', 'projects', 'stakeholders', 'analyse', 'provenance', 'export', 'validation'];
  const histDocs = { 'madrid-2024': madridDocs, 'bogota-2023': bogotaDocs.slice(0, 12), 'vancouver-2024': vancouverDocs };
  let k = 0;
  for (const pid of ['madrid-2024', 'madrid-2024', 'bogota-2023', 'vancouver-2024']) {
    for (let i = 0; i < 9; i++, k++) {
      const step = histSteps[(i + k) % histSteps.length];
      const meta = STEP_META[step];
      const doc = meta.scope === 'document' ? histDocs[pid][(i * 3 + k) % histDocs[pid].length] : null;
      const status = k === 7 ? 'failed' : 'success';
      tasks.push(mkTask(pid, step, {
        inputDoc: doc ? doc.name : `All documents (${histDocs[pid].length})`, inputDocId: doc?.id ?? null, status,
        createdAt: now - (1 + k) * 5 * HOUR - i * 17 * MIN, durationMs: Math.round(meta.durationMs * (8 + (k % 5) * 6)),
        node: pid === 'madrid-2024' ? 'EU-WEST-1' : 'US-EAST-G01', error: status === 'failed' ? 'LlamaParse job timed out after 900s (document exceeds 250 pages).' : null,
      }));
    }
  }
  // Pipeline run record for the historical Madrid run
  const runs = [
    { id: 'run_madrid_1', projectId: 'madrid-2024', label: 'Full pipeline run #1', startedAt: now - 9 * DAY, finishedAt: now - 9 * DAY + 41 * MIN, status: 'success', taskIds: [], triggeredBy: 'Jorge Cimentada', note: 'Initial extraction over 9 source documents.' },
    { id: 'run_madrid_2', projectId: 'madrid-2024', label: 'Incremental run #2', startedAt: now - 2 * DAY, finishedAt: now - 2 * DAY + 18 * MIN, status: 'success', taskIds: [], triggeredBy: 'Jorge Cimentada', note: 'Re-extraction after uploading Housing_Affordability_Plan_2024.pdf.' },
    { id: 'run_bogota_1', projectId: 'bogota-2023', label: 'Full pipeline run #1', startedAt: now - 200 * DAY, finishedAt: now - 200 * DAY + 2 * HOUR, status: 'success', taskIds: [], triggeredBy: 'Alex Santana', note: 'Complete extraction over 45 documents.' },
    { id: 'run_bogota_2', projectId: 'bogota-2023', label: 'Final export', startedAt: now - 121 * DAY, finishedAt: now - 121 * DAY + 12 * MIN, status: 'success', taskIds: [], triggeredBy: 'Alex Santana', note: 'Harmonized workbook + final report generated.' },
    { id: 'run_van_1', projectId: 'vancouver-2024', label: 'Metadata ingestion', startedAt: now - 2 * HOUR, finishedAt: now - 2 * HOUR + 9 * MIN, status: 'success', taskIds: [], triggeredBy: 'Jorge Cimentada', note: 'Parsed Climate_Emergency_Action_Plan.pdf and extracted first indicators.' },
  ];
  // attach historical tasks to runs
  tasks.filter(t => t.projectId === 'madrid-2024' && t.status === 'success' && t.createdAt < now - DAY).forEach((t, i) => { t.runId = i % 2 ? 'run_madrid_2' : 'run_madrid_1'; });
  tasks.filter(t => t.projectId === 'bogota-2023').forEach((t, i) => { t.runId = i % 3 === 2 ? 'run_bogota_2' : 'run_bogota_1'; t.createdAt = (i % 3 === 2 ? runs[3].startedAt : runs[2].startedAt) + i * 4 * MIN; t.startedAt = t.createdAt + 2000; t.finishedAt = t.startedAt + t.durationMs; });
  tasks.filter(t => t.projectId === 'vancouver-2024').forEach((t, i) => { t.runId = 'run_van_1'; t.createdAt = runs[4].startedAt + i * MIN; t.startedAt = t.createdAt + 2000; t.finishedAt = t.startedAt + t.durationMs; });
  runs.forEach(r => { r.taskIds = tasks.filter(t => t.runId === r.id).map(t => t.id); });

  /* ---- activity / audit log ---- */
  const activity = [
    { projectId: 'madrid-2024', title: 'Policy Extraction: Housing Affordability Plan', provenance: 'MDC-DOC-429', ts: now - 2 * MIN, status: 'success', actor: 'Pipeline', type: 'extraction' },
    { projectId: 'madrid-2024', title: 'PDF Parser started: annex_ii_sdg_17.pdf', provenance: 'MDC-DOC-436', ts: now - 4 * MIN, status: 'running', actor: 'Pipeline', type: 'task' },
    { projectId: 'madrid-2024', title: 'Translate failed: local_govt_report_es.json', provenance: 'MDC-DOC-437', ts: now - 27 * MIN, status: 'failed', actor: 'Pipeline', type: 'task' },
    { projectId: 'madrid-2024', title: 'Indicator approved: SDG 6.1.1 Safely Managed Drinking Water', provenance: 'MDC-DOC-434', ts: now - 2 * DAY, status: 'success', actor: 'Jorge Cimentada', type: 'review' },
    { projectId: 'madrid-2024', title: 'Validation: master_indicators_v2.csv', provenance: 'MDC-DOC-438', ts: now - 72 * MIN, status: 'success', actor: 'Pipeline', type: 'task' },
    { projectId: 'vancouver-2024', title: 'Document uploaded: Transit_Ridership_2023.csv', provenance: 'VAN-DOC-108', ts: now - 2 * HOUR, status: 'success', actor: 'Jorge Cimentada', type: 'upload' },
    { projectId: 'vancouver-2024', title: 'Project initialised: Vancouver 2024 VLR', provenance: 'VAN-PRJ-001', ts: now - 3 * DAY, status: 'success', actor: 'Jorge Cimentada', type: 'project' },
    { projectId: 'madrid-2024', title: 'Incremental pipeline run #2 completed', provenance: 'MDC-RUN-002', ts: now - 2 * DAY + 18 * MIN, status: 'success', actor: 'Pipeline', type: 'run' },
    { projectId: 'madrid-2024', title: 'Document uploaded: Housing_Affordability_Plan_2024.pdf', provenance: 'MDC-DOC-429', ts: now - 2 * DAY - 10 * MIN, status: 'success', actor: 'Jorge Cimentada', type: 'upload' },
    { projectId: 'bogota-2023', title: 'Project archived: Bogotá 2023 VLR', provenance: 'BOG-PRJ-001', ts: now - 120 * DAY, status: 'success', actor: 'Alex Santana', type: 'project' },
    { projectId: 'bogota-2023', title: 'Harmonized workbook exported (Final)', provenance: 'BOG-RUN-002', ts: now - 121 * DAY + 12 * MIN, status: 'success', actor: 'Pipeline', type: 'export' },
  ].map((a, i) => ({ id: uid('act'), projectName: projects.find(p => p.id === a.projectId)?.name, ...a }));
  // Historical trail derived from the seeded tasks, uploads and approvals so the audit log has depth out of the box
  const pName = (pid) => projects.find(p => p.id === pid)?.name;
  const taskDoc = (t) => documents.find(d => d.id === t.inputDocId);
  tasks.filter(t => ['success', 'failed'].includes(t.status) && t.finishedAt && t.finishedAt < now - 90 * MIN).forEach((t) => {
    activity.push({ id: uid('act'), projectId: t.projectId, projectName: pName(t.projectId), title: `${t.label}: ${t.inputDoc}`, provenance: taskDoc(t)?.code || `${t.projectId.slice(0, 3).toUpperCase()}-TSK-${String(tasks.indexOf(t) + 1).padStart(3, '0')}`, ts: t.finishedAt, status: t.status, actor: 'Pipeline', type: 'task' });
  });
  bogotaDocs.slice(0, 10).forEach(d => activity.push({ id: uid('act'), projectId: 'bogota-2023', projectName: pName('bogota-2023'), title: `Document uploaded: ${d.name}`, provenance: d.code, ts: d.uploadedAt, status: 'success', actor: 'Alex Santana', type: 'upload' }));
  bogotaExt.slice(0, 12).forEach(e => activity.push({ id: uid('act'), projectId: 'bogota-2023', projectName: pName('bogota-2023'), title: `Approved: SDG ${e.sdg} ${e.title}`, provenance: bogotaDocs.find(d => d.id === e.source.docId)?.code, ts: e.reviewedAt, status: 'success', actor: 'Alex Santana', type: 'review' }));
  madridDocs.slice(3).forEach(d => activity.push({ id: uid('act'), projectId: 'madrid-2024', projectName: pName('madrid-2024'), title: `Document uploaded: ${d.name}`, provenance: d.code, ts: d.uploadedAt, status: 'success', actor: 'Jorge Cimentada', type: 'upload' }));
  runs.forEach((r, i) => activity.push({ id: uid('act'), projectId: r.projectId, projectName: pName(r.projectId), title: `${r.label} completed`, provenance: `${r.projectId.slice(0, 3).toUpperCase()}-RUN-${String(i + 1).padStart(3, '0')}`, ts: r.finishedAt, status: 'success', actor: 'Pipeline', type: 'run' }));
  activity.push({ id: uid('act'), projectId: 'bogota-2023', projectName: pName('bogota-2023'), title: 'Final report generated: Bogota_2023_VLR_Final_Report.pdf', provenance: 'BOG-RUN-002', ts: now - 120 * DAY, status: 'success', actor: 'Alex Santana', type: 'export' });
  activity.sort((a, b) => b.ts - a.ts);

  /* ---- orchestrator logs ---- */
  const anchor = 14 * 3600 + 21 * 60 + 5; // mock-up clock anchor (14:21:05) mapped to "2 minutes ago"
  const L = (h, m, s, level, msg, projectId = 'madrid-2024') => ({ ts: now - 2 * MIN - (anchor - (h * 3600 + m * 60 + s)) * 1000, level, msg, projectId });
  const logs = [
    L(14, 21, 5, 'INFO', 'Node US-EAST scaling up...'),
    L(14, 20, 58, 'INFO', 'Task ID #9921 triggered.'),
    L(14, 20, 42, 'WARN', "Latency detected on S3 bucket 'reports'."),
    L(14, 20, 12, 'INFO', "Starting 'PDF Parser' on annex_ii_sdg_17.pdf"),
    L(14, 18, 55, 'INFO', "Starting 'XML Extraction' on legacy_data_source_3.xml"),
    L(14, 15, 3, 'INFO', 'Provenance graph updated: 14 indicators linked to 6 sources.'),
    L(13, 55, 12, 'ERROR', "Task 'Translate' failed for local_govt_report_es.json: HTTP 503 after 3 retries."),
    L(13, 55, 0, 'INFO', "Starting 'Translate' on local_govt_report_es.json (ES → EN)"),
    L(13, 16, 7, 'INFO', "'Validation' completed: 251/251 schema rows valid (05m 22s)."),
    L(13, 10, 45, 'INFO', "Starting 'Validation' on master_indicators_v2.csv"),
    L(12, 46, 18, 'INFO', "'Normalization' completed: 38 indicators rescaled to 0–100."),
    L(12, 45, 10, 'INFO', "Starting 'Normalization' on un_sdg_schema_map.yaml"),
  ].sort((a, b) => a.ts - b.ts);

  /* ---- settings ---- */
  const settings = {
    org: { name: 'Nexus Governance Lab', plan: 'Enterprise', region: 'EU-WEST-1', timezone: 'Europe/Madrid' },
    pipeline: { parser: 'LlamaParse v4 (premium)', model: 'gemini-2.5-pro', translationModel: 'gemini-2.5-flash', translationTarget: 'EN', temperature: 0.0, useLlamaCloudExtract: true, concurrency: 3, autoRetry: true, retries: 3, simSpeed: 'demo' },
    budget: { monthlyLimit: 1500, alertPct: 80, perProjectLimit: 500 },
    notifications: { email: true, taskFailed: true, runCompleted: true, reviewRequested: true, weeklyDigest: false, budgetAlerts: true },
    apiKeys: [
      { id: uid('key'), label: 'Production backend', key: 'vlrf_live_9f3a7c2e8b1d4a6f0c5e2b9a7d3f1e8c', createdAt: now - 90 * DAY, lastUsedAt: now - 30 * MIN },
      { id: uid('key'), label: 'CI / evaluation harness', key: 'vlrf_test_4b8e1d7a2c9f3e6b0a5d8c1f7e2b9a4d', createdAt: now - 30 * DAY, lastUsedAt: now - 3 * DAY },
    ],
    team: [
      { id: uid('mem'), name: 'Jorge Cimentada', email: 'jorge@nexuslab.io', role: 'Owner', status: 'active', lastActive: now - 5 * MIN },
      { id: uid('mem'), name: 'Alex Santana', email: 'alex@nexuslab.io', role: 'Admin', status: 'active', lastActive: now - 3 * HOUR },
      { id: uid('mem'), name: 'María López', email: 'maria.lopez@madrid.es', role: 'Reviewer', status: 'active', lastActive: now - DAY },
      { id: uid('mem'), name: 'Daniel Reyes', email: 'd.reyes@bogota.gov.co', role: 'Viewer', status: 'invited', lastActive: null },
    ],
    integrations: { llamaCloud: true, gemini: true, s3: true, obsidian: true, slack: false },
  };

  const tickets = [
    { id: 'TCK-1042', subject: 'Translation step fails intermittently for JSON inputs', category: 'Pipeline', status: 'open', priority: 'High', createdAt: now - 26 * MIN, updatedAt: now - 10 * MIN, author: 'Jorge Cimentada', messages: [{ author: 'Jorge Cimentada', ts: now - 26 * MIN, text: 'Translate keeps returning 503 for local_govt_report_es.json. Retry works sometimes.' }, { author: 'VLR Forge Support', ts: now - 10 * MIN, text: 'Thanks — we have identified a capacity issue on the EU translation pool and are scaling it. Retries should succeed within the hour.' }] },
    { id: 'TCK-1037', subject: 'Request: export provenance graph as CSV', category: 'Feature request', status: 'resolved', priority: 'Normal', createdAt: now - 6 * DAY, updatedAt: now - DAY, author: 'Alex Santana', messages: [{ author: 'Alex Santana', ts: now - 6 * DAY, text: 'It would be useful to export the lineage graph for auditors.' }, { author: 'VLR Forge Support', ts: now - DAY, text: 'Shipped in V2.4.0 — see Audit Log → Export CSV.' }] },
  ];

  const reports = [
    { id: uid('rep'), projectId: 'bogota-2023', name: 'Bogota_2023_VLR_Harmonized_Workbook.xlsx', format: 'xlsx', kind: 'Harmonized Excel Workbook', createdAt: now - 121 * DAY + 12 * MIN, sizeKb: 1840, status: 'ready', generatedBy: 'Pipeline' },
    { id: uid('rep'), projectId: 'bogota-2023', name: 'Bogota_2023_VLR_Final_Report.pdf', format: 'pdf', kind: 'VLR Report (PDF)', createdAt: now - 120 * DAY, sizeKb: 6210, status: 'ready', generatedBy: 'Alex Santana' },
    { id: uid('rep'), projectId: 'madrid-2024', name: 'Madrid_2024_VLR_Harmonized_Workbook_draft.xlsx', format: 'xlsx', kind: 'Harmonized Excel Workbook', createdAt: now - 2 * DAY + 18 * MIN, sizeKb: 1210, status: 'ready', generatedBy: 'Pipeline' },
  ];

  /* ---- Bogotá: composed chapters and a finalised VLR (the archived project shows the end of the workflow) ---- */
  const bogotaCounts = bogotaExt.reduce((a, e) => { a[e.goal] = (a[e.goal] || 0) + 1; return a; }, {});
  const bogotaGoals = Object.keys(bogotaCounts).filter(g => bogotaCounts[g] >= 2).map(Number).sort((a, b) => a - b);
  const bogotaChapters = [];
  let counters = { figureStart: 1, boxStart: 1, footnoteStart: 1 };
  planBook(bogota, bogotaGoals).forEach(({ goal, number }) => {
    const ch = composeChapter(bogota, goal, bogotaExt.filter(e => e.goal === goal), bogotaDocs, { number, reported: bogotaGoals, ...counters });
    counters = { figureStart: ch.counters.figureNext, boxStart: ch.counters.boxNext, footnoteStart: ch.counters.footnoteNext };
    ch.status = 'approved'; ch.version = 2; ch.approvedBy = 'Alex Santana'; ch.approvedAt = now - 118 * DAY; ch.createdAt = now - 125 * DAY; ch.updatedAt = now - 118 * DAY;
    ch.revisions.push({ version: 2, at: now - 119 * DAY, by: 'Chapter Reviewer', feedback: 'Cite every claim and put target codes in the headings.', summary: 'added traceable citations; target codes in headings confirmed' });
    ch.chat.push({ id: uid('msg'), role: 'user', at: now - 119 * DAY, text: 'Cite every claim and put target codes in the headings.' }, { id: uid('msg'), role: 'assistant', at: now - 119 * DAY + 60_000, text: 'Done — every context claim now carries an APA-style footnote with page number, and each subsection heading reads “Theme (Target n.n)”. Version 2 is ready.', changes: [] });
    ch.chat[0].at = ch.createdAt; ch.revisions[0].at = ch.createdAt;
    bogotaChapters.push(ch);
  });
  // historical composition tasks for Bogotá (so the Tasks page / History show the writing phase)
  bogotaGoals.forEach((g, i) => { const t = mkTask('bogota-2023', 'compose', { inputDoc: `SDG ${g} — ${['', 'No Poverty', 'Zero Hunger', 'Good Health and Well-being', 'Quality Education', 'Gender Equality', 'Clean Water and Sanitation', 'Affordable and Clean Energy', 'Decent Work and Economic Growth', 'Industry, Innovation and Infrastructure', 'Reduced Inequalities', 'Sustainable Cities and Communities', 'Responsible Consumption and Production', 'Climate Action', 'Life Below Water', 'Life on Land', 'Peace, Justice and Strong Institutions', 'Partnerships for the Goals'][g]}`, status: 'success', createdAt: now - 125 * DAY + i * 9 * MIN, durationMs: 380_000 + i * 20_000, node: 'US-EAST-G01', runId: 'run_bogota_3' }); t.goal = g; tasks.push(t); });
  tasks.push(mkTask('bogota-2023', 'edit', { inputDoc: `All chapters (${bogotaGoals.length})`, status: 'success', createdAt: now - 125 * DAY + bogotaGoals.length * 9 * MIN, durationMs: 240_000, node: 'US-EAST-G01', runId: 'run_bogota_3' }));
  tasks.push(mkTask('bogota-2023', 'assemble', { inputDoc: `${bogotaGoals.length} approved chapter(s)`, status: 'success', createdAt: now - 117 * DAY, durationMs: 310_000, node: 'US-EAST-G01', runId: 'run_bogota_4' }));
  tasks.push(mkTask('bogota-2023', 'render', { inputDoc: 'Bogotá_2023_VLR_v3.docx', status: 'success', createdAt: now - 115 * DAY, durationMs: 140_000, node: 'US-EAST-G01', runId: 'run_bogota_4' }));
  runs.push({ id: 'run_bogota_3', projectId: 'bogota-2023', label: 'Chapter composition', startedAt: now - 125 * DAY, finishedAt: now - 125 * DAY + (bogotaGoals.length + 1) * 9 * MIN, status: 'success', taskIds: tasks.filter(t => t.runId === 'run_bogota_3').map(t => t.id), triggeredBy: 'Alex Santana', note: `${bogotaGoals.length} chapters composed and consolidated.` },
            { id: 'run_bogota_4', projectId: 'bogota-2023', label: 'Final VLR assembly', startedAt: now - 117 * DAY, finishedAt: now - 115 * DAY + 3 * MIN, status: 'success', taskIds: tasks.filter(t => t.runId === 'run_bogota_4').map(t => t.id), triggeredBy: 'Alex Santana', note: 'Book assembled, reader comments resolved, DOCX rendered.' });
  runs.slice(-2).forEach(r => r.totalCost = Number(r.taskIds.map(id => tasks.find(t => t.id === id)).reduce((a, t) => a + (t?.cost || 0), 0).toFixed(2)));
  activity.push({ id: uid('act'), projectId: 'bogota-2023', projectName: 'Bogotá 2023 VLR', title: `VLR composition completed: ${bogotaGoals.length} chapters`, provenance: 'BOG-CH-000', ts: now - 125 * DAY + (bogotaGoals.length + 1) * 9 * MIN, status: 'success', actor: 'Chapter Composer', type: 'chapter' },
                { id: uid('act'), projectId: 'bogota-2023', projectName: 'Bogotá 2023 VLR', title: 'Final VLR published: Bogotá Voluntary Local Review 2023 (v3)', provenance: 'BOG-VLR-003', ts: now - 115 * DAY, status: 'success', actor: 'Alex Santana', type: 'book' });
  activity.sort((a, b) => b.ts - a.ts);
  const bogotaBook = composeBook(bogota, bogotaChapters, bogotaExt, bogotaDocs);
  bogotaBook.revisions[0].at = now - 117 * DAY;
  bogotaBook.status = 'final'; bogotaBook.version = 3; bogotaBook.assembledAt = now - 117 * DAY; bogotaBook.finalizedAt = now - 115 * DAY; bogotaBook.finalizedBy = 'Alex Santana';
  bogotaBook.revisions.push({ version: 2, at: now - 116 * DAY, by: 'VLR Editor', summary: 'Two reader comments resolved (executive summary wording; methodology paragraph shortened).' }, { version: 3, at: now - 115 * DAY, by: 'Alex Santana', summary: 'Finalised and exported to DOCX/PDF.' });
  const execBlock = bogotaBook.front.find(f => f.key === 'executive-summary').blocks[1];
  const methBlock = bogotaBook.front.find(f => f.key === 'introduction').subsections.find(s => s.key === 'methodology').blocks[0];
  const firstFinding = bogotaChapters[0].sections.find(s => s.key === 'progress').subsections[0]?.blocks.find(b => b.role === 'finding');
  if (execBlock) execBlock.revised = true; if (methBlock) methBlock.revised = true;
  bogotaBook.comments = [
    { id: uid('cmt'), sectionKey: 'executive-summary', blockId: execBlock?.id, quote: (execBlock?.text || '').replace(/^\*\*[^*]+\*\*\s*/, '').split(/(?<=[a-z\)])\.\s/)[0].slice(0, 80), text: 'Lead with the trend word before the number — readers scan for direction first.', author: 'María López', at: now - 116 * DAY - 3 * HOUR, status: 'resolved', replies: [{ author: 'VLR Editor', at: now - 116 * DAY - 2 * HOUR, text: 'Revised: the sentence now opens with the direction of the measure and keeps the value and year unchanged.' }] },
    { id: uid('cmt'), sectionKey: 'methodology', blockId: methBlock?.id, quote: 'Source documents were parsed and, where needed, translated to English', text: 'Too long for a methodology paragraph — keep the four pillars and the review gate, drop the rest.', author: 'Alex Santana', at: now - 116 * DAY - HOUR, status: 'resolved', replies: [{ author: 'VLR Editor', at: now - 116 * DAY, text: 'Shortened the paragraph; the pillar list and the approval gate are retained.' }] },
    { id: uid('cmt'), chapterId: bogotaChapters[0].id, sectionKey: 'progress', blockId: firstFinding?.id, quote: (firstFinding ? firstFinding.text.replace(/\[\^\d+\]/g, '') : '').split(': ').slice(1).join(': ').slice(0, 90), text: 'Ministry reviewer asks whether this baseline year matches the national series — please confirm before publication.', author: 'Daniel Reyes', at: now - 30 * DAY, status: 'open', replies: [] },
  ];

  return {
    version: 1,
    auth: { user: null, remember: true },
    settings, projects, documents, extractions, tasks, runs, comments: [
      { id: uid('cmt'), extractionId: madridExt.find(e => e.sdg === '11.1.1')?.id, author: 'María López', kind: 'comment', text: 'Please double-check the denominator — the survey covers outer districts only.', createdAt: now - 3 * DAY },
    ], activity, logs, tickets, reports,
    chapters: bogotaChapters, books: [bogotaBook],
    ask: { messages: [], scope: 'all' },
    ui: { tasksProjectFilter: 'all', autoRefresh: true },
    meta: { seededAt: now, node: 'EU-WEST-1', ip: '192.168.1.104' },
  };
}
