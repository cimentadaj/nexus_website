/* Settings page — profile, organization, pipeline defaults, budget, notifications, API keys, team, data & demo. */
import { esc, icon, toast, confirmDialog, promptDialog, openModal, refreshIcons, fmtCost, fmtDateTime, fmtDate, relTime, fmtBytes, avatarHtml, copyToClipboard, download, statusBadge, progressHtml, clamp, sum, bindActions } from '../ui.js';
import { getState, currentUser, totalCost, projectCost, getProjectTasks, STORAGE_KEY } from '../store.js';
import { updateProfile, saveSettings, regenerateApiKey, createApiKey, revokeApiKey, inviteMember, updateMember, removeMember, resetDemo } from '../actions.js';
import { topbarActions } from '../shell.js';
import { navigate } from '../router.js';
import { APP_VERSION, NODES, LANGS } from '../seed.js';

const TABS = [
  { key: 'profile', label: 'Profile', icon: 'user', desc: 'Your account and preferences' },
  { key: 'organization', label: 'Organization', icon: 'building-2', desc: 'Workspace, region and integrations' },
  { key: 'pipeline', label: 'Pipeline defaults', icon: 'workflow', desc: 'Parser, models and execution' },
  { key: 'budget', label: 'Budget & cost', icon: 'wallet', desc: 'Limits, alerts and spend' },
  { key: 'notifications', label: 'Notifications', icon: 'bell', desc: 'Email and in-app alerts' },
  { key: 'api', label: 'API keys', icon: 'key-round', desc: 'Programmatic access' },
  { key: 'team', label: 'Team', icon: 'users', desc: 'Members and roles' },
  { key: 'data', label: 'Data & demo', icon: 'database', desc: 'Storage, export and reset' },
];
const TAB_KEYS = TABS.map(t => t.key);
const TIMEZONES = ['Europe/Madrid', 'Europe/London', 'Europe/Berlin', 'America/Bogota', 'America/New_York', 'America/Sao_Paulo', 'Africa/Nairobi', 'Asia/Singapore', 'UTC'];
const UI_LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['pt', 'Português']];
const ROLES = ['Owner', 'Admin', 'Reviewer', 'Viewer'];
const PARSERS = ['LlamaParse v4 (premium)', 'LlamaParse v4 (fast)', 'Docling 2.x (self-hosted)', 'PyMuPDF (text only)'];
const MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash', 'claude-sonnet-4', 'gpt-4.1'];
const TRANSLATION_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'nllb-200 (self-hosted)'];
const NOTIF_META = {
  email: ['Email notifications', 'Master switch — deliver all alerts below to your work email.'],
  taskFailed: ['Task failed', 'A pipeline task fails after its final retry.'],
  runCompleted: ['Run completed', 'A full pipeline run finishes (with total cost in the summary).'],
  reviewRequested: ['Review requested', 'A reviewer is assigned to newly extracted items.'],
  weeklyDigest: ['Weekly digest', 'Monday summary of extractions, approvals and spend per project.'],
  budgetAlerts: ['Budget alerts', 'Monthly or per-project spend crosses the alert threshold.'],
};
const INTEGRATION_META = {
  llamaCloud: ['LlamaCloud', 'Parsing (LlamaParse) and direct indicator extraction', 'cloud'],
  gemini: ['Gemini (Vertex AI)', 'Extraction, analysis and translation models', 'sparkles'],
  s3: ['Object storage (S3)', 'Document pool, parsed markdown and exports', 'hard-drive'],
  obsidian: ['Obsidian vault', 'Markdown vault export with wikilinks per indicator', 'notebook'],
  slack: ['Slack', 'Run and review notifications in #vlr-forge', 'message-square'],
};

/* ---------- edit buffers (kept in ctx.local so they survive re-renders) ---------- */
function buffer(ctx, section) {
  ctx.local.forms ||= {};
  if (!ctx.local.forms[section]) ctx.local.forms[section] = JSON.parse(JSON.stringify(sourceFor(section)));
  return ctx.local.forms[section];
}
function sourceFor(section) {
  const s = getState();
  if (section === 'profile') { const u = currentUser() || {}; return { name: u.name || '', email: u.email || '', role: u.role || 'Admin', timezone: u.timezone || s.settings.org.timezone, language: u.language || 'en' }; }
  return s.settings[section] || {};
}
const isDirty = (ctx, section) => ctx.local.forms?.[section] && JSON.stringify(ctx.local.forms[section]) !== JSON.stringify(sourceFor(section));
const discard = (ctx, section) => { if (ctx.local.forms) delete ctx.local.forms[section]; };

/* ---------- small template helpers ---------- */
const field = (label, control, hint = '') => `<div class="field"><label class="label">${label}</label>${control}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
const input = (section, key, value, { type = 'text', readonly = false, placeholder = '', min, max, step } = {}) =>
  `<input class="input" id="set-${section}-${key}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${readonly ? 'readonly' : `data-action="field" data-section="${section}" data-key="${key}"`} ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} ${step != null ? `step="${step}"` : ''}>`;
const select = (section, key, value, options) =>
  `<select class="select" id="set-${section}-${key}" data-action="field" data-section="${section}" data-key="${key}">${options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
const switchRow = (section, key, on, title, desc, ic) => `
  <div class="switch-row" data-action="toggle" data-section="${section}" data-key="${key}" role="switch" aria-checked="${on ? 'true' : 'false'}" tabindex="0">
    ${ic ? `<span class="switch-ic">${icon(ic)}</span>` : ''}
    <div class="grow"><div class="switch-title">${esc(title)}</div>${desc ? `<div class="switch-desc">${esc(desc)}</div>` : ''}</div>
    <span class="switch ${on ? 'on' : ''}"></span>
  </div>`;
const sectionCard = ({ title, sub, icon: ic, body, footer = '', tone = '' }) => `
  <section class="card settings-card ${tone}">
    <div class="card-header tinted"><div><div class="card-title-caps">${icon(ic)}${esc(title)}</div>${sub ? `<div class="card-sub">${esc(sub)}</div>` : ''}</div></div>
    <div class="card-body">${body}</div>
    ${footer ? `<div class="card-footer">${footer}</div>` : ''}
  </section>`;
const saveFooter = (ctx, section, { label = 'Save changes' } = {}) => {
  const dirty = isDirty(ctx, section);
  return `<div class="row gap-12"><span class="save-state ${dirty ? 'dirty' : ''}">${dirty ? `${icon('circle-dot', 'icon-xs')}Unsaved changes` : `${icon('check', 'icon-xs')}All changes saved`}</span></div>
    <div class="row gap-12">${dirty ? `<button class="btn btn-light" data-action="discard" data-section="${section}">Discard</button>` : ''}<button class="btn btn-primary" data-action="save" data-section="${section}">${icon('save', 'icon-sm')}${label}</button></div>`;
};

/* ---------- tabs ---------- */
function profileTab(ctx) {
  const f = buffer(ctx, 'profile');
  const u = currentUser() || {};
  const s = getState();
  const me = s.settings.team.find(m => m.email === u.email);
  const body = `
    <div class="profile-head">
      ${avatarHtml({ name: f.name || u.name }, 'avatar-lg')}
      <div class="grow"><div class="profile-name">${esc(f.name || u.name || '')}</div><div class="muted">${esc(u.email || '')} · ${esc(f.role)} · ${esc(s.settings.org.name)}</div></div>
      <button class="btn btn-light btn-sm" data-action="change-avatar">${icon('image', 'icon-sm')}Change avatar</button>
    </div>
    <div class="form-grid mt-24">
      ${field('Full name', input('profile', 'name', f.name, { placeholder: 'Your name' }))}
      ${field('Work email', input('profile', 'email', f.email, { readonly: true }), 'Managed by your identity provider (SSO). Contact an owner to change it.')}
      ${field('Role', select('profile', 'role', f.role, ROLES), me?.role && me.role !== f.role ? 'Team directory lists you as ' + esc(me.role) + '.' : 'Determines which review and pipeline actions you can perform.')}
      ${field('Timezone', select('profile', 'timezone', f.timezone, TIMEZONES), 'Timestamps across the dashboard are shown in this zone.')}
      ${field('Interface language', select('profile', 'language', f.language, UI_LANGS))}
      ${field('Signed in since', `<div class="input readonly-val">${esc(u.loggedInAt ? fmtDateTime(u.loggedInAt) : '—')}</div>`)}
    </div>`;
  return sectionCard({ title: 'Profile', sub: 'Your account details and personal preferences', icon: 'user', body, footer: saveFooter(ctx, 'profile') })
    + sectionCard({ title: 'Security', icon: 'shield-check', body: `
      <div class="kv-list">
        <div class="kv-row"><div><div class="switch-title">Password</div><div class="switch-desc">Last changed 42 days ago</div></div><button class="btn btn-light btn-sm" data-action="change-password">Change password</button></div>
        <div class="kv-row"><div><div class="switch-title">Two-factor authentication</div><div class="switch-desc">Enforced by ${esc(s.settings.org.name)} policy for all Admin and Owner roles</div></div><span class="badge badge-success">${icon('check', 'icon-xs')}Enabled</span></div>
        <div class="kv-row"><div><div class="switch-title">Active sessions</div><div class="switch-desc">This browser · ${esc(s.meta?.ip || '192.168.1.104')} · node ${esc(s.meta?.node || 'EU-WEST-1')}</div></div><button class="btn btn-light btn-sm" data-action="revoke-sessions">Sign out other sessions</button></div>
      </div>` });
}

function organizationTab(ctx) {
  const f = buffer(ctx, 'org');
  const integ = buffer(ctx, 'integrations');
  const s = getState();
  const projects = s.projects.length, members = s.settings.team.length;
  const body = `
    <div class="form-grid">
      ${field('Organization name', input('org', 'name', f.name))}
      ${field('Plan', `<div class="plan-box"><span class="badge badge-navy badge-lg">${esc(f.plan || 'Enterprise')}</span><span class="muted">Unlimited projects · SSO · 2h support SLA · EU data residency</span><button class="btn btn-light btn-sm" data-action="contact-sales">Contact sales</button></div>`)}
      ${field('Data region', select('org', 'region', f.region, NODES), 'New projects are provisioned on this node. Existing projects keep their region.')}
      ${field('Organization timezone', select('org', 'timezone', f.timezone, TIMEZONES))}
    </div>
    <div class="org-stats mt-24">
      <div class="org-stat"><div class="stat-label">Projects</div><div class="org-stat-val">${projects}</div></div>
      <div class="org-stat"><div class="stat-label">Members</div><div class="org-stat-val">${members}</div></div>
      <div class="org-stat"><div class="stat-label">Documents</div><div class="org-stat-val">${s.documents.length}</div></div>
      <div class="org-stat"><div class="stat-label">Spend to date</div><div class="org-stat-val mono">${fmtCost(totalCost())}</div></div>
    </div>`;
  const integrations = `<div class="switch-list">${Object.entries(INTEGRATION_META).map(([k, [t, d, ic]]) => switchRow('integrations', k, !!integ[k], t, d, ic)).join('')}</div>`;
  const dirty = isDirty(ctx, 'org') || isDirty(ctx, 'integrations');
  const footer = `<div class="row gap-12"><span class="save-state ${dirty ? 'dirty' : ''}">${dirty ? `${icon('circle-dot', 'icon-xs')}Unsaved changes` : `${icon('check', 'icon-xs')}All changes saved`}</span></div>
    <div class="row gap-12">${dirty ? `<button class="btn btn-light" data-action="discard" data-section="org,integrations">Discard</button>` : ''}<button class="btn btn-primary" data-action="save" data-section="org,integrations">${icon('save', 'icon-sm')}Save changes</button></div>`;
  return sectionCard({ title: 'Organization', sub: 'Workspace identity, plan and data residency', icon: 'building-2', body })
    + sectionCard({ title: 'Integrations', sub: 'Connected services used by the pipeline', icon: 'plug', body: integrations, footer });
}

function pipelineTab(ctx) {
  const f = buffer(ctx, 'pipeline');
  const body = `
    <div class="form-grid">
      ${field('Parser', select('pipeline', 'parser', f.parser, PARSERS), 'Converts PDF / DOCX / XLSX into page-anchored markdown with provenance codes.')}
      ${field('Extraction model', select('pipeline', 'model', f.model, MODELS), 'Used by the four pillar agents (Indicators, Documentary, Projects, Stakeholders).')}
      ${field('Translation model', select('pipeline', 'translationModel', f.translationModel, TRANSLATION_MODELS))}
      ${field('Translation target', select('pipeline', 'translationTarget', f.translationTarget, LANGS), 'Documents in other languages are translated before extraction.')}
      ${field(`Temperature <span class="mono label-val">${Number(f.temperature).toFixed(2)}</span>`, `<input type="range" class="range" id="set-pipeline-temperature" min="0" max="1" step="0.05" value="${esc(f.temperature)}" data-action="field" data-section="pipeline" data-key="temperature">`, '0 = deterministic extraction (recommended for auditable outputs).')}
      ${field(`Concurrency <span class="mono label-val">${esc(f.concurrency)}</span>`, `<input type="range" class="range" id="set-pipeline-concurrency" min="1" max="5" step="1" value="${esc(f.concurrency)}" data-action="field" data-section="pipeline" data-key="concurrency">`, 'Maximum number of tasks running in parallel per node.')}
    </div>
    <div class="switch-list mt-24">
      ${switchRow('pipeline', 'useLlamaCloudExtract', !!f.useLlamaCloudExtract, 'Use LlamaCloud direct extraction for Pillar A', 'Schema-driven indicator extraction straight from the parsed document instead of the Map-Reduce ADK agent. Cheaper on long documents; falls back to ADK when the schema is not satisfied.', 'cloud')}
      ${switchRow('pipeline', 'autoRetry', !!f.autoRetry, 'Auto-retry failed tasks', 'Transient failures (503, rate limits) are retried with exponential back-off before being marked as failed.', 'rotate-ccw')}
    </div>
    <div class="form-grid mt-24">
      ${field('Retries', input('pipeline', 'retries', f.retries, { type: 'number', min: 0, max: 10 }), f.autoRetry ? 'Attempts before a task is marked as failed.' : 'Auto-retry is disabled — this value is ignored.')}
      ${field('Simulation speed', select('pipeline', 'simSpeed', f.simSpeed, [['fast', 'Fast'], ['demo', 'Demo'], ['realistic', 'Realistic']]), 'Controls how fast simulated tasks progress in this demo.')}
    </div>`;
  return sectionCard({ title: 'Pipeline defaults', sub: 'Applied to every new run unless overridden in Configure project', icon: 'workflow', body, footer: saveFooter(ctx, 'pipeline') });
}

function budgetTab(ctx) {
  const f = buffer(ctx, 'budget');
  const s = getState();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const spendMonth = sum(s.tasks.filter(t => (t.finishedAt || t.startedAt || t.createdAt) >= monthStart), t => t.cost);
  const forecast = dayOfMonth ? spendMonth / dayOfMonth * daysInMonth : 0;
  const total = totalCost();
  const limit = Number(f.monthlyLimit) || 0;
  const pct = limit ? clamp(100 * spendMonth / limit, 0, 100) : 0;
  const alertPct = Number(f.alertPct) || 0;
  const over = limit && spendMonth >= limit * alertPct / 100;
  const perProject = s.projects.map(p => ({ p, cost: projectCost(p.id), tasks: getProjectTasks(p.id).length })).sort((a, b) => b.cost - a.cost);
  const maxCost = Math.max(1, ...perProject.map(x => x.cost));
  const perLimit = Number(f.perProjectLimit) || 0;
  const body = `
    <div class="form-grid">
      ${field('Monthly limit (USD)', input('budget', 'monthlyLimit', f.monthlyLimit, { type: 'number', min: 0, step: 50 }), 'Runs are paused when the organization reaches this amount in a calendar month.')}
      ${field('Per-project limit (USD)', input('budget', 'perProjectLimit', f.perProjectLimit, { type: 'number', min: 0, step: 50 }), 'Applies per VLR cycle. Set 0 to disable.')}
      ${field(`Alert threshold <span class="mono label-val">${esc(alertPct)}%</span>`, `<input type="range" class="range" id="set-budget-alertPct" min="10" max="100" step="5" value="${esc(alertPct)}" data-action="field" data-section="budget" data-key="alertPct">`, 'Budget alerts fire when spend crosses this share of a limit.')}
    </div>`;
  const summary = `
    <div class="budget-grid">
      <div class="stat-box"><div class="stat-label">Spend to date</div><div class="stat-value mono">${fmtCost(total)}</div><div class="hint">${s.tasks.length} tasks · all projects</div></div>
      <div class="stat-box"><div class="stat-label">This month</div><div class="stat-value mono ${over ? 'danger-text' : ''}">${fmtCost(spendMonth)}</div><div class="hint">${limit ? `${pct.toFixed(0)}% of ${fmtCost(limit)} limit` : 'No monthly limit set'}</div></div>
      <div class="stat-box"><div class="stat-label">Forecast (month end)</div><div class="stat-value mono">${fmtCost(forecast)}</div><div class="hint">Linear projection · day ${dayOfMonth} of ${daysInMonth}</div></div>
    </div>
    <div class="budget-bar mt-16">
      <div class="row-between small"><span class="muted">Monthly budget usage</span><span class="mono">${fmtCost(spendMonth)} / ${fmtCost(limit)}</span></div>
      <div class="budget-track"><span class="budget-fill ${over ? 'danger' : ''}" style="width:${pct}%"></span><span class="budget-mark" style="left:${clamp(alertPct, 0, 100)}%" data-tip="Alert threshold ${esc(alertPct)}%"></span></div>
    </div>
    ${over ? `<div class="callout warning mt-16">${icon('alert-triangle')}<div><strong>Alert threshold reached.</strong> Monthly spend is at ${pct.toFixed(0)}% of the limit. Budget alerts ${s.settings.notifications.budgetAlerts ? 'have been sent' : 'are disabled in Notifications'}.</div></div>` : ''}
    <table class="table mt-24 budget-table">
      <thead><tr><th>Project</th><th>Tasks</th><th style="width:38%">Spend</th><th class="th-right">Cost</th><th class="th-right">Of project limit</th></tr></thead>
      <tbody>${perProject.map(({ p, cost, tasks }) => {
        const share = perLimit ? clamp(100 * cost / perLimit, 0, 100) : 0;
        return `<tr class="clickable" data-action="open-project" data-id="${esc(p.id)}">
          <td><div class="cell-title">${esc(p.name)}</div><div class="cell-sub">${esc(p.city)}, ${esc(p.country)} · ${esc(p.status)}</div></td>
          <td class="mono">${tasks}</td>
          <td>${progressHtml(100 * cost / maxCost, 'sky')}</td>
          <td class="td-right"><span class="cost">${fmtCost(cost)}</span></td>
          <td class="td-right mono ${share >= alertPct && perLimit ? 'danger-text' : 'muted'}">${perLimit ? share.toFixed(0) + '%' : '—'}</td></tr>`;
      }).join('') || `<tr><td colspan="5" class="muted text-center">No projects yet</td></tr>`}</tbody>
    </table>`;
  return sectionCard({ title: 'Budget & cost', sub: 'Spending limits for pipeline runs', icon: 'wallet', body, footer: saveFooter(ctx, 'budget') })
    + sectionCard({ title: 'Spend summary', sub: 'Aggregated from task costs across every step', icon: 'bar-chart-3', body: summary, footer: `<span class="muted small">Costs are computed per task from the engine base price plus a per-page rate.</span><a class="btn btn-light btn-sm" href="#/tasks">${icon('clipboard-list', 'icon-sm')}Open Workflow Orchestration</a>` });
}

function notificationsTab(ctx) {
  const f = buffer(ctx, 'notifications');
  const keys = Object.keys({ ...NOTIF_META, ...f });
  const body = `
    <div class="switch-list">${keys.map(k => { const [t, d] = NOTIF_META[k] || [k, '']; return switchRow('notifications', k, !!f[k], t, d, k === 'email' ? 'mail' : k === 'taskFailed' ? 'alert-circle' : k === 'runCompleted' ? 'check-circle-2' : k === 'reviewRequested' ? 'message-square' : k === 'weeklyDigest' ? 'calendar' : 'wallet'); }).join('')}</div>
    <div class="callout mt-24">${icon('info')}<div>Slack delivery mirrors these switches when the Slack integration is connected under <a href="#/settings?tab=organization" data-action="goto-tab" data-tab="organization">Organization → Integrations</a>.</div></div>`;
  return sectionCard({ title: 'Notifications', sub: 'Choose which events reach you', icon: 'bell', body, footer: saveFooter(ctx, 'notifications') });
}

const maskKey = (k) => `${k.slice(0, 14)}…${k.slice(-2)}`;
function apiTab(ctx) {
  const keys = getState().settings.apiKeys;
  ctx.local.revealed ||= {};
  const rows = keys.map(k => {
    const shown = !!ctx.local.revealed[k.id];
    return `<tr>
      <td><div class="cell-title">${esc(k.label)}</div><div class="cell-sub mono">${esc(k.id)}</div></td>
      <td><div class="row gap-6"><code class="api-key">${esc(shown ? k.key : maskKey(k.key))}</code>
        <button class="btn-icon" data-action="reveal-key" data-id="${esc(k.id)}" data-tip="${shown ? 'Hide' : 'Reveal'}">${icon(shown ? 'eye-off' : 'eye')}</button>
        <button class="btn-icon" data-action="copy-key" data-id="${esc(k.id)}" data-tip="Copy key">${icon('copy')}</button></div></td>
      <td class="mono">${fmtDate(k.createdAt)}</td>
      <td class="muted">${k.lastUsedAt ? relTime(k.lastUsedAt) : 'Never'}</td>
      <td class="td-right"><div class="table-actions">
        <button class="btn btn-light btn-sm" data-action="regen-key" data-id="${esc(k.id)}">${icon('refresh-cw', 'icon-sm')}Regenerate</button>
        <button class="btn btn-danger-outline btn-sm" data-action="revoke-key" data-id="${esc(k.id)}">${icon('trash-2', 'icon-sm')}Revoke</button></div></td>
    </tr>`;
  }).join('');
  const body = `
    <table class="table api-table">
      <thead><tr><th>Label</th><th>Key</th><th>Created</th><th>Last used</th><th class="th-right">Actions</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5"><div class="empty">${icon('key-round')}<div class="empty-title">No API keys</div><div class="empty-sub">Create a key to start workflows from your own systems.</div></div></td></tr>`}</tbody>
    </table>
    <div class="callout mt-16">${icon('terminal')}<div>Start a run programmatically: <code>POST /api/v1/workflow/start</code> with header <code>Authorization: Bearer &lt;key&gt;</code>. See <a href="#/documentation?doc=api">API reference</a>.</div></div>`;
  return `<section class="card settings-card"><div class="card-header tinted"><div><div class="card-title-caps">${icon('key-round')}API keys</div><div class="card-sub">Keys grant full access on behalf of your organization — store them in a secret manager</div></div><button class="btn btn-primary btn-sm" data-action="create-key">${icon('plus', 'icon-sm')}Create key</button></div><div class="card-body card-body-flush">${body}</div></section>`;
}

function teamTab(ctx) {
  const team = getState().settings.team;
  const me = currentUser();
  const rows = team.map(m => `<tr>
      <td><div class="row gap-12">${avatarHtml(m)}<div><div class="cell-title">${esc(m.name)}${me?.email === m.email ? ' <span class="badge badge-sky" style="margin-left:6px">You</span>' : ''}</div><div class="cell-sub">${esc(m.email)}</div></div></div></td>
      <td><select class="select select-sm" id="member-role-${esc(m.id)}" data-action="member-role" data-id="${esc(m.id)}" ${m.role === 'Owner' && me?.email !== m.email ? 'disabled' : ''}>${ROLES.map(r => `<option ${r === m.role ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
      <td>${statusBadge(m.status === 'active' ? 'active' : 'pending', { label: m.status === 'active' ? 'Active' : 'Invited' })}</td>
      <td class="muted">${m.lastActive ? relTime(m.lastActive) : 'Never'}</td>
      <td class="td-right"><div class="table-actions">
        ${m.status !== 'active' ? `<button class="btn btn-light btn-sm" data-action="resend-invite" data-id="${esc(m.id)}">${icon('send', 'icon-sm')}Resend</button>` : ''}
        <button class="btn-icon danger" data-action="remove-member" data-id="${esc(m.id)}" data-tip="Remove member" ${m.role === 'Owner' ? 'disabled' : ''}>${icon('trash-2')}</button></div></td>
    </tr>`).join('');
  const body = `<table class="table team-table"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Last active</th><th class="th-right">Actions</th></tr></thead><tbody>${rows}</tbody></table>`;
  const counts = { active: team.filter(m => m.status === 'active').length, invited: team.filter(m => m.status !== 'active').length };
  return `<section class="card settings-card"><div class="card-header tinted"><div><div class="card-title-caps">${icon('users')}Team</div><div class="card-sub">${counts.active} active · ${counts.invited} invited · roles control review and pipeline permissions</div></div><button class="btn btn-primary btn-sm" data-action="invite-member">${icon('user-plus', 'icon-sm')}Invite member</button></div><div class="card-body card-body-flush">${body}</div>
    <div class="card-footer"><div class="role-legend"><span><strong>Owner</strong> billing & members</span><span><strong>Admin</strong> projects & pipeline</span><span><strong>Reviewer</strong> approve extractions</span><span><strong>Viewer</strong> read-only</span></div></div></section>`;
}

function storageBytes() { try { return (localStorage.getItem(STORAGE_KEY) || '').length * 2; } catch { return 0; } }
function dataTab(ctx) {
  const s = getState();
  const bytes = storageBytes();
  const quota = 5 * 1024 * 1024;
  const counts = [['Projects', s.projects.length], ['Documents', s.documents.length], ['Tasks', s.tasks.length], ['Runs', s.runs.length], ['Extractions', s.extractions.length], ['Comments', s.comments.length], ['Activity entries', s.activity.length], ['Log lines', s.logs.length], ['Reports', s.reports.length], ['Tickets', s.tickets.length]];
  const body = `
    <div class="data-grid">
      <div>
        <div class="row-between small"><span class="muted">Local storage usage</span><span class="mono">${fmtBytes(bytes / 1024)} of ${fmtBytes(quota / 1024)}</span></div>
        <div class="mt-8">${progressHtml(100 * bytes / quota, 'sky')}</div>
        <div class="hint mt-8">State key <code>${esc(STORAGE_KEY)}</code> · persisted on every change · survives reloads.</div>
        <dl class="kv mt-16">${counts.map(([k, v]) => `<dt>${k}</dt><dd class="mono">${v}</dd>`).join('')}</dl>
      </div>
      <div>
        <dl class="kv">
          <dt>Application</dt><dd>VLR Forge <strong>${esc(APP_VERSION)}</strong></dd>
          <dt>Build</dt><dd class="mono">2026.08.28-demo</dd>
          <dt>Node</dt><dd class="mono">${esc(s.meta?.node || 'EU-WEST-1')}</dd>
          <dt>Environment</dt><dd><span class="badge badge-warning">Demo · zero backend</span></dd>
          <dt>Engine</dt><dd>Simulated pipeline (${esc(s.settings.pipeline.simSpeed)} speed)</dd>
          <dt>Last change</dt><dd class="mono">${fmtDateTime(Math.max(0, ...s.activity.map(a => a.ts)) || Date.now())}</dd>
        </dl>
        <div class="row gap-12 mt-16 wrap">
          <button class="btn btn-light" data-action="export-state">${icon('download', 'icon-sm')}Export state (JSON)</button>
          <button class="btn btn-light" data-action="copy-state">${icon('copy', 'icon-sm')}Copy state</button>
          <a class="btn btn-light" href="#/audit-log">${icon('scroll-text', 'icon-sm')}Audit log</a>
        </div>
      </div>
    </div>`;
  const danger = `
    <div class="kv-row"><div><div class="switch-title">Reset demo data</div><div class="switch-desc">Restores the seed dataset (projects, documents, tasks, extractions, tickets). Your session is kept. Cannot be undone.</div></div><button class="btn btn-danger" data-action="reset-demo">${icon('rotate-ccw', 'icon-sm')}Reset demo data</button></div>`;
  return sectionCard({ title: 'Data & demo', sub: 'Everything in this demo lives in your browser', icon: 'database', body })
    + sectionCard({ title: 'Danger zone', icon: 'alert-triangle', body: `<div class="kv-list">${danger}</div>`, tone: 'danger-card' });
}

const TAB_RENDER = { profile: profileTab, organization: organizationTab, pipeline: pipelineTab, budget: budgetTab, notifications: notificationsTab, api: apiTab, team: teamTab, data: dataTab };

/* ---------- invite modal ---------- */
function openInviteModal() {
  openModal({
    title: 'Invite team member', sub: 'They will receive an email with a link to join your workspace', size: 'sm',
    body: `<div class="col gap-16">
      <div class="field"><label class="label">Full name</label><input class="input" id="inv-name" placeholder="e.g. Lucía Fernández" autofocus></div>
      <div class="field"><label class="label">Work email <span class="req">*</span></label><input class="input" id="inv-email" type="email" placeholder="name@organisation.org"></div>
      <div class="field"><label class="label">Role</label><select class="select" id="inv-role">${ROLES.filter(r => r !== 'Owner').map(r => `<option ${r === 'Reviewer' ? 'selected' : ''}>${r}</option>`).join('')}</select><div class="hint">Reviewers can approve and reject extractions; Admins can also run pipelines.</div></div>
    </div>`,
    footer: `<button class="btn btn-light" id="inv-cancel">Cancel</button><button class="btn btn-primary" id="inv-send">${icon('send', 'icon-sm')}Send invitation</button>`,
    onMount(el, api) {
      el.querySelector('#inv-cancel').onclick = api.close;
      const submit = () => {
        const email = el.querySelector('#inv-email').value.trim();
        const name = el.querySelector('#inv-name').value.trim();
        const role = el.querySelector('#inv-role').value;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { el.querySelector('#inv-email').classList.add('input-invalid'); el.querySelector('#inv-email').focus(); toast.error('Enter a valid work email'); return; }
        el.querySelector('#inv-email').classList.remove('input-invalid');
        if (getState().settings.team.some(m => m.email.toLowerCase() === email.toLowerCase())) { toast.warning('Already a member', `${email} is already in the team.`); return; }
        const m = inviteMember({ name, email, role });
        api.close();
        toast.success('Invitation sent', `${m.name} invited as ${role}.`);
      };
      el.querySelector('#inv-send').onclick = submit;
      el.querySelectorAll('input').forEach(i => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
    },
  });
}

/* ---------- page ---------- */
export default {
  title: () => 'Settings',
  render(ctx) {
    const qTab = TAB_KEYS.includes(ctx.query?.tab) ? ctx.query.tab : null;
    if (!ctx.local.tab || (qTab && qTab !== ctx.local.queryTab)) ctx.local.tab = qTab || ctx.local.tab || 'profile';
    ctx.local.queryTab = qTab;
    const tab = ctx.local.tab;
    const dirtySections = TAB_KEYS.filter(k => ({ profile: ['profile'], organization: ['org', 'integrations'], pipeline: ['pipeline'], budget: ['budget'], notifications: ['notifications'] }[k] || []).some(sec => isDirty(ctx, sec)));

    ctx.topbar.innerHTML = `<span class="topbar-title">Settings</span><span class="topbar-subtitle" style="margin-left:4px">${esc(getState().settings.org.name)} · ${esc(getState().settings.org.plan)}</span><span class="grow"></span>${topbarActions()}`;
    ctx.content.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">Settings</h1><p class="page-subtitle">Configure your workspace, pipeline defaults, spending limits and team access.</p></div>
        <div class="settings-meta"><span class="muted small">Signed in as</span><strong>${esc(currentUser()?.name || '')}</strong><span class="badge badge-neutral">${esc(currentUser()?.role || '')}</span></div>
      </div>
      <div class="settings-layout">
        <nav class="settings-nav card" aria-label="Settings sections">
          ${TABS.map(t => `<button class="settings-nav-item ${t.key === tab ? 'active' : ''}" data-action="goto-tab" data-tab="${t.key}">${icon(t.icon)}<span class="grow"><span class="settings-nav-label">${esc(t.label)}</span><span class="settings-nav-desc">${esc(t.desc)}</span></span>${dirtySections.includes(t.key) ? '<span class="dirty-dot" data-tip="Unsaved changes"></span>' : icon('chevron-right', 'icon-sm chev')}</button>`).join('')}
        </nav>
        <div class="settings-panel">${TAB_RENDER[tab](ctx)}</div>
      </div>`;
    ctx.footer.innerHTML = '';

    /* --- typed / changed fields --- */
    const onField = (el, ev) => {
      const sec = el.dataset.section, key = el.dataset.key;
      const f = buffer(ctx, sec);
      let v = el.value;
      if (el.type === 'range') v = Number(v);
      else if (el.type === 'number') v = v === '' ? '' : Number(v); // keep the field empty while typing; coerced on save
      f[key] = v;
      if (el.type === 'range' && ev.type === 'input') {
        // live label while dragging; the full re-render happens on 'change' so the thumb is not replaced mid-drag
        const lv = el.closest('.field')?.querySelector('.label-val');
        if (lv) lv.textContent = key === 'temperature' ? v.toFixed(2) : key === 'alertPct' ? `${v}%` : String(v);
      } else if (el.type === 'range' || el.tagName === 'SELECT') ctx.rerender();
      else {
        // keep footer/nav dirty indicators live without a full re-render on every keystroke
        ctx.content.querySelectorAll('.save-state').forEach(s => { s.classList.add('dirty'); s.innerHTML = `${icon('circle-dot', 'icon-xs')}Unsaved changes`; refreshIcons(s); });
        if (sec === 'profile') { const n = ctx.content.querySelector('.profile-name'); if (n && key === 'name') n.textContent = v; }
      }
    };
    const unbindInput = bindActions(ctx.content, { field: onField }, 'input');
    const unbindChange = bindActions(ctx.content, {
      field: onField,
      'member-role': (el) => { updateMember(el.dataset.id, { role: el.value }); const m = getState().settings.team.find(x => x.id === el.dataset.id); toast.success('Role updated', `${m?.name} is now ${el.value}.`); },
    }, 'change');

    const doSave = (sections) => {
      if (!sections.some(sec => isDirty(ctx, sec))) { toast.info('Nothing to save', 'All changes are already saved.'); return; }
      for (const sec of sections) {
        const f = { ...buffer(ctx, sec) };
        Object.keys(f).forEach(k => {
          if (f[k] === '') f[k] = sec === 'profile' ? f[k] : 0;
          // numeric fields: clamp to the input's min/max (e.g. retries 0–10, limits ≥ 0)
          const inp = ctx.content.querySelector(`#set-${sec}-${k}`);
          if (inp && (inp.type === 'number' || inp.type === 'range') && typeof f[k] === 'number') {
            if (inp.min !== '') f[k] = Math.max(Number(inp.min), f[k]);
            if (inp.max !== '') f[k] = Math.min(Number(inp.max), f[k]);
          }
        });
        if (sec === 'profile') { const { email, ...patch } = f; if (!String(patch.name || '').trim()) { toast.error('Name is required'); return; } updateProfile(patch); }
        else saveSettings(sec, f);
        discard(ctx, sec);
      }
      const label = TABS.find(t => t.key === tab)?.label || 'Settings';
      toast.success(`${label} saved`, sections.includes('pipeline') ? `Simulation speed: ${getState().settings.pipeline.simSpeed}. New runs use these defaults.` : 'Changes are applied immediately.');
      ctx.rerender();
    };

    const unbindClick = bindActions(ctx.content, {
      'goto-tab': (el, ev) => { ev.preventDefault(); ctx.local.tab = el.dataset.tab; navigate(`#/settings?tab=${el.dataset.tab}`); ctx.rerender(); },
      toggle: (el) => { const f = buffer(ctx, el.dataset.section); f[el.dataset.key] = !f[el.dataset.key]; ctx.rerender(); },
      save: (el) => doSave(el.dataset.section.split(',')),
      discard: (el) => { el.dataset.section.split(',').forEach(s => discard(ctx, s)); toast.info('Changes discarded'); ctx.rerender(); },
      'change-avatar': () => toast.info('Avatar upload', 'Avatars are synced from your identity provider in this demo.'),
      'change-password': () => toast.info('Password managed by SSO', 'Reset your password from your identity provider (Google Workspace / Entra ID).'),
      'revoke-sessions': async () => { if (await confirmDialog({ title: 'Sign out other sessions?', msg: 'All other browsers and devices will be signed out immediately. This session stays active.', confirmText: 'Sign out others', icon: 'log-out' })) toast.success('Other sessions signed out', '1 session revoked.'); },
      'contact-sales': () => { navigate('#/support'); toast.info('Enterprise plan', 'Reach us at sales@vlrforge.io or open a Billing ticket.'); },
      'open-project': (el) => navigate(`#/projects/${el.dataset.id}`),
      'reveal-key': (el) => { ctx.local.revealed[el.dataset.id] = !ctx.local.revealed[el.dataset.id]; ctx.rerender(); },
      'copy-key': (el) => { const k = getState().settings.apiKeys.find(x => x.id === el.dataset.id); if (k) { copyToClipboard(k.key); toast.success('Key copied to clipboard', k.label); } },
      'regen-key': async (el) => {
        const k = getState().settings.apiKeys.find(x => x.id === el.dataset.id);
        if (!k) return;
        if (await confirmDialog({ title: `Regenerate "${esc(k.label)}"?`, msg: 'The current key stops working immediately. Update every system that uses it.', confirmText: 'Regenerate', danger: true, icon: 'refresh-cw' })) {
          const key = regenerateApiKey(k.id); ctx.local.revealed[k.id] = true; copyToClipboard(key);
          toast.success('API key regenerated', 'New key revealed and copied to clipboard.');
        }
      },
      'revoke-key': async (el) => {
        const k = getState().settings.apiKeys.find(x => x.id === el.dataset.id);
        if (!k) return;
        if (await confirmDialog({ title: `Revoke "${esc(k.label)}"?`, msg: 'Requests using this key will be rejected with 401. This cannot be undone.', confirmText: 'Revoke key', danger: true, icon: 'trash-2' })) { revokeApiKey(k.id); toast.success('API key revoked', k.label); }
      },
      'create-key': async () => {
        const label = await promptDialog({ title: 'Create API key', label: 'Key label', placeholder: 'e.g. Data warehouse sync', confirmText: 'Create key' });
        if (label == null) return;
        if (!label.trim()) { toast.error('Label required'); return; }
        const k = createApiKey(label.trim()); ctx.local.revealed ||= {}; ctx.local.revealed[k.id] = true; copyToClipboard(k.key);
        toast.success('API key created', 'Copied to clipboard — it is shown in full only while revealed.');
      },
      'invite-member': () => openInviteModal(),
      'resend-invite': (el) => { const m = getState().settings.team.find(x => x.id === el.dataset.id); updateMember(el.dataset.id, { invitedAt: Date.now() }); toast.success('Invitation resent', m?.email); },
      'remove-member': async (el) => {
        const m = getState().settings.team.find(x => x.id === el.dataset.id);
        if (!m) return;
        if (await confirmDialog({ title: `Remove ${esc(m.name)}?`, msg: 'They lose access to every project immediately. Their past reviews and comments are kept for audit purposes.', confirmText: 'Remove member', danger: true, icon: 'user-minus' })) { removeMember(m.id); toast.success('Member removed', m.email); }
      },
      'export-state': () => { const s = getState(); download(`vlr-forge-state-${fmtDate(Date.now())}.json`, JSON.stringify(s, null, 2), 'application/json'); toast.success('State exported', `${fmtBytes(storageBytes() / 1024)} JSON downloaded.`); },
      'copy-state': () => { copyToClipboard(JSON.stringify(getState())); toast.success('State copied to clipboard'); },
      'reset-demo': async () => {
        if (await confirmDialog({ title: 'Reset demo data?', msg: 'All projects, documents, tasks, extractions, comments, tickets and settings return to the seed dataset. Your session is kept.', confirmText: 'Reset everything', danger: true, icon: 'rotate-ccw' })) {
          resetDemo(); ctx.local.forms = {}; ctx.local.revealed = {};
          toast.success('Demo data reset', 'Seed dataset restored.');
        }
      },
    });
    const onKey = (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.switch-row')) { e.preventDefault(); e.target.click(); }
      else if (e.key === 'Enter' && e.target.matches?.('input[data-action="field"]')) { e.preventDefault(); const sec = e.target.dataset.section; doSave(sec === 'org' || sec === 'integrations' ? ['org', 'integrations'] : [sec]); }
    };
    ctx.content.addEventListener('keydown', onKey);
    return () => { unbindInput(); unbindChange(); unbindClick(); ctx.content.removeEventListener('keydown', onKey); };
  },
};
