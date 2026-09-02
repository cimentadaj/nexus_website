/* Support page — quick links, system status, ticket form, ticket threads, FAQ and contact block. */
import { esc, icon, toast, confirmDialog, relTime, fmtDateTime, fmtCost, avatarHtml, copyToClipboard, statusBadge } from '../ui.js';
import { getState, currentUser, runningTasks, queuedTasks, totalCost } from '../store.js';
import { createTicket, replyTicket, resolveTicket } from '../actions.js';
import { topbarActions } from '../shell.js';
import { navigate } from '../router.js';
import { APP_VERSION, STEP_META } from '../seed.js';

const CATEGORIES = ['Pipeline', 'Review', 'Billing', 'Access', 'Feature request', 'Other'];
const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
const PRIORITY_CLS = { Low: 'neutral', Normal: 'info', High: 'warning', Urgent: 'danger' };

const FAQ = [
  { q: 'What is a Voluntary Local Review (VLR)?', a: 'A VLR is a city- or region-level report on progress towards the UN Sustainable Development Goals, mirroring the Voluntary National Reviews presented at the UN High-Level Political Forum. VLR Forge structures a VLR around four pillars — SDG Indicators (Pillar A), City Projects (Pillar B), Documentary evidence: challenges, commitments and policies (Pillar C) and Stakeholder voices (Pillar D) — and generates a harmonized workbook plus a narrative report with full provenance.' },
  { q: 'How does provenance and traceability work?', a: 'Every document receives a code (e.g. MDC-DOC-429) when it enters the pool. The parser keeps page and paragraph anchors, and every extracted item stores the document, page, paragraph and the exact quote it was derived from, with the supporting span highlighted. The review screen shows the lineage chain (source → parsed → translated → extraction → analysis) and each step links to the task that produced it, including its cost. The Audit Log records every upload, run, review decision and export.' },
  { q: 'Which file formats are supported?', a: 'PDF, DOCX, XLSX/CSV, PPTX, Markdown and plain text are parsed with LlamaParse. Legacy XML/JSON statistical exports go through a dedicated XML extraction step. Scanned PDFs are OCR-ed by the premium parser. Individual files up to 200 MB and 600 pages are supported.' },
  { q: 'Which languages can I upload documents in?', a: 'Documents can be in any language supported by the translation model (Spanish, Catalan, Portuguese, French, German, Italian and more). Non-English documents are translated to the configured target language before extraction so that all four pillars run over a consistent pool; the original quote is kept alongside the translation for review.' },
  { q: 'Do I need to classify documents by pillar when uploading?', a: 'No. Documents are uploaded once, at project level. All four pillar extractors scan the whole document pool — an annual report can feed indicators, projects and stakeholder quotes at the same time.' },
  { q: 'How is cost calculated?', a: `Each task has a base price plus a per-page rate depending on the engine (e.g. ${esc(STEP_META.parse.label)} ${fmtCost(STEP_META.parse.base)} + ${fmtCost(STEP_META.parse.perPage)}/page; ${esc(STEP_META.extract_indicators.label)} ${fmtCost(STEP_META.extract_indicators.base)} + ${fmtCost(STEP_META.extract_indicators.perPage)}/page). Costs are shown per task, per run and aggregated per project and organization. Monthly and per-project limits are configured under Settings → Budget & cost.` },
  { q: 'LlamaCloud direct extraction vs. ADK Map-Reduce agents — which should I use?', a: 'LlamaCloud direct extraction applies a strict JSON schema to the parsed document and is cheaper and faster on long, well-structured reports. The ADK Map-Reduce agent splits the document into chunks, extracts candidates per chunk and reconciles them, which is more robust on narrative or heterogeneous documents. Pillar A can use either (toggle in Settings → Pipeline defaults); Pillars B–D always use the ADK agents.' },
  { q: 'An extraction highlights the wrong passage. How do I fix it?', a: 'Open the item in the review screen and click "Report Mis-highlight" under the quote. Describe what is wrong (optionally queue a rerun). Your note is attached to the extraction and fed back to the extraction agents as context on the next run. You can also edit the value directly and Save, or Reject & Rerun with a reason.' },
  { q: 'How do I export the results?', a: 'From the project header choose New Report: the Harmonized Excel workbook (one sheet per pillar plus Urban Data seeded from the 251-row reference table), a PDF/DOCX narrative report or a Markdown vault for Obsidian. Only approved items are included when "approved only" is selected. Every export is listed in the project History tab and in the Audit Log.' },
  { q: 'What happens when a task fails?', a: 'Transient errors are retried automatically (see Pipeline defaults → Auto-retry). After the last attempt the task is marked Failed, dependent tasks stay queued, and you receive a notification. Use Retry on the Tasks page; the retried task keeps the same provenance chain.' },
];

function statusRows() {
  const t = Math.floor(Date.now() / 10000);
  const running = runningTasks('all').length, queued = queuedTasks('all').length;
  const jitter = (n) => 18 + ((t * n) % 11);
  return [
    { name: 'API', ok: true, meta: `${jitter(3)} ms` },
    { name: 'Parser pool', ok: true, meta: `${jitter(5) + 40} ms · ${running ? `${running} running` : 'idle'}` },
    { name: 'Translation pool', ok: true, meta: `${jitter(7) + 62} ms` },
    { name: 'Storage', ok: true, meta: `${jitter(2)} ms · ${queued ? `${queued} queued` : 'no backlog'}` },
  ];
}

function ticketCard(t, ctx) {
  const open = ctx.local.openTicket === t.id;
  const me = currentUser();
  const reply = ctx.local.replies?.[t.id] || '';
  const thread = t.messages.map(m => {
    const mine = m.author !== 'VLR Forge Support';
    return `<div class="msg ${mine ? 'mine' : 'support'}">${avatarHtml({ name: m.author })}<div class="msg-body"><div class="msg-head"><strong>${esc(m.author)}</strong>${mine ? '' : '<span class="badge badge-navy">Support</span>'}<span class="muted xs">${esc(fmtDateTime(m.ts))}</span></div><div class="msg-text">${esc(m.text)}</div></div></div>`;
  }).join('');
  return `
    <div class="ticket ${open ? 'open' : ''} status-${esc(t.status)}">
      <button class="ticket-head" data-action="toggle-ticket" data-id="${esc(t.id)}" aria-expanded="${open}">
        <span class="ticket-id mono">${esc(t.id)}</span>
        <span class="grow ticket-subject">${esc(t.subject)}<span class="ticket-sub">${esc(t.category)} · ${t.messages.length} message${t.messages.length === 1 ? '' : 's'} · opened by ${esc(t.author)}</span></span>
        ${statusBadge(t.status)}
        <span class="badge badge-${PRIORITY_CLS[t.priority] || 'neutral'}">${esc(t.priority)}</span>
        <span class="muted small ticket-updated">${esc(relTime(t.updatedAt))}</span>
        ${icon('chevron-down', 'icon-sm chev')}
      </button>
      ${open ? `<div class="ticket-body">
        <div class="thread">${thread}</div>
        <div class="reply-box">
          ${avatarHtml(me)}
          <div class="grow"><textarea class="textarea" id="reply-${esc(t.id)}" rows="2" placeholder="${t.status === 'resolved' ? 'Replying will reopen this ticket…' : 'Write a reply…'}" data-action="reply-input" data-id="${esc(t.id)}">${esc(reply)}</textarea>
            <div class="row-between mt-8"><span class="hint">${t.status === 'resolved' ? `Resolved ${esc(relTime(t.updatedAt))}` : 'Enterprise SLA: first response under 2 business hours'}</span>
              <div class="row gap-6">${t.status !== 'resolved' ? `<button class="btn btn-light btn-sm" data-action="resolve-ticket" data-id="${esc(t.id)}">${icon('check-circle-2', 'icon-sm')}Mark resolved</button>` : ''}<button class="btn btn-primary btn-sm" data-action="send-reply" data-id="${esc(t.id)}">${icon('send', 'icon-sm')}Reply</button></div></div>
          </div>
        </div>
      </div>` : ''}
    </div>`;
}

export default {
  title: () => 'Support',
  render(ctx) {
    const s = getState();
    const me = currentUser();
    ctx.local.form ||= { subject: '', category: 'Pipeline', priority: 'Normal', message: '' };
    ctx.local.replies ||= {};
    ctx.local.faqOpen ||= {};
    ctx.local.faqQ ||= '';
    ctx.local.ticketFilter ||= 'all';
    ctx.local.invalid ||= {};
    const f = ctx.local.form;
    const inv = ctx.local.invalid;
    const tickets = s.tickets.filter(t => ctx.local.ticketFilter === 'all' || t.status === ctx.local.ticketFilter);
    const openCount = s.tickets.filter(t => t.status === 'open').length;
    const status = statusRows();
    const allOk = status.every(r => r.ok);
    const faqQ = ctx.local.faqQ.trim().toLowerCase();
    const faqs = FAQ.map((x, i) => ({ ...x, i })).filter(x => !faqQ || x.q.toLowerCase().includes(faqQ) || x.a.toLowerCase().includes(faqQ));

    ctx.topbar.innerHTML = `<span class="topbar-title">Support</span><span class="topbar-subtitle" style="margin-left:4px">Enterprise plan · 2h SLA</span><span class="grow"></span>${topbarActions()}`;
    ctx.content.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">How can we help?</h1><p class="page-subtitle">Documentation, live system status and a direct line to the VLR Forge engineering team.</p></div>
        <div class="support-sla">${icon('badge-check')}<div><strong>Enterprise SLA</strong><div class="muted small">First response &lt; 2 business hours · 24/7 for Urgent</div></div></div>
      </div>

      <div class="quick-grid">
        <a class="card quick-card" href="#/documentation">
          <span class="quick-ic">${icon('book-open')}</span>
          <div class="grow"><div class="quick-title">Documentation</div><div class="quick-desc">Pipeline steps &amp; costs, the four pillars, review workflow, API reference and changelog ${esc(APP_VERSION)}.</div></div>
          <span class="quick-link">Open docs ${icon('arrow-right', 'icon-sm')}</span>
        </a>
        <button class="card quick-card" data-action="scroll-form">
          <span class="quick-ic">${icon('life-buoy')}</span>
          <div class="grow"><div class="quick-title">Contact support</div><div class="quick-desc">Open a ticket for pipeline issues, review questions, billing or access. ${openCount ? `<strong>${openCount} open ticket${openCount === 1 ? '' : 's'}</strong>.` : 'No open tickets.'}</div></div>
          <span class="quick-link">Submit a ticket ${icon('arrow-right', 'icon-sm')}</span>
        </button>
        <div class="card quick-card status-card">
          <div class="row-between"><div class="quick-title row gap-6"><span class="status-dot ${allOk ? 'ok' : 'warn'}"></span>System status</div><span class="badge badge-success">${allOk ? 'All systems operational' : 'Degraded'}</span></div>
          <ul class="status-list">${status.map(r => `<li><span class="status-dot ${r.ok ? 'ok' : 'warn'}"></span><span class="grow">${esc(r.name)}</span><span class="mono muted">${esc(r.meta)}</span></li>`).join('')}</ul>
          <div class="row-between"><span class="hint">Node ${esc(s.meta?.node || 'EU-WEST-1')} · ${esc(APP_VERSION)}</span><button class="link-text small" data-action="status-page">Status history</button></div>
        </div>
      </div>

      <div class="support-layout mt-24">
        <div class="support-main">
          <section class="card" id="ticket-form">
            <div class="card-header tinted"><div class="card-title-caps">${icon('ticket')}Submit a ticket</div><span class="muted small">Replies go to ${esc(me?.email || 'your email')}</span></div>
            <div class="card-body">
              <div class="form-grid">
                <div class="field span-2"><label class="label">Subject <span class="req">*</span></label><input class="input ${inv.subject ? 'input-invalid' : ''}" id="tk-subject" placeholder="e.g. Provenance mapping stuck at 80% for Madrid 2024" value="${esc(f.subject)}" data-action="form-field" data-key="subject"></div>
                <div class="field"><label class="label">Category</label><select class="select" id="tk-category" data-action="form-field" data-key="category">${CATEGORIES.map(c => `<option ${c === f.category ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
                <div class="field"><label class="label">Priority</label><select class="select" id="tk-priority" data-action="form-field" data-key="priority">${PRIORITIES.map(p => `<option ${p === f.priority ? 'selected' : ''}>${p}</option>`).join('')}</select><div class="hint">${f.priority === 'Urgent' ? 'Urgent: production blocked — pages on-call engineer.' : f.priority === 'High' ? 'High: a project deadline is at risk.' : 'Normal and Low are handled in order within the SLA.'}</div></div>
                <div class="field span-2"><label class="label">Message <span class="req">*</span></label><textarea class="textarea ${inv.message ? 'input-invalid' : ''}" id="tk-message" rows="5" placeholder="Describe what happened, which project and document, and what you expected. Task ids and provenance codes (e.g. MDC-DOC-429) help us reproduce quickly." data-action="form-field" data-key="message">${esc(f.message)}</textarea></div>
              </div>
            </div>
            <div class="card-footer"><span class="hint">Diagnostics attached automatically: app ${esc(APP_VERSION)}, node ${esc(s.meta?.node || 'EU-WEST-1')}, ${s.tasks.filter(t => t.status === 'failed').length} failed task(s), spend ${fmtCost(totalCost())}.</span><div class="row gap-12"><button class="btn btn-light" data-action="clear-form">Clear</button><button class="btn btn-primary" data-action="submit-ticket">${icon('send', 'icon-sm')}Submit ticket</button></div></div>
          </section>

          <section class="card mt-24">
            <div class="card-header tinted"><div class="card-title-caps">${icon('messages-square')}Your tickets <span class="badge badge-pill badge-neutral">${s.tickets.length}</span></div>
              <div class="tabs-mini">${[['all', 'All'], ['open', 'Open'], ['resolved', 'Resolved']].map(([k, l]) => `<button class="tab-mini ${ctx.local.ticketFilter === k ? 'active' : ''}" data-action="ticket-filter" data-filter="${k}">${l}</button>`).join('')}</div></div>
            <div class="ticket-list">${tickets.map(t => ticketCard(t, ctx)).join('') || `<div class="empty">${icon('inbox')}<div class="empty-title">No ${ctx.local.ticketFilter === 'all' ? '' : ctx.local.ticketFilter + ' '}tickets</div><div class="empty-sub">Tickets you submit appear here with the full conversation.</div></div>`}</div>
          </section>

          <section class="card mt-24" id="faq">
            <div class="card-header tinted"><div class="card-title-caps">${icon('help-circle')}Frequently asked questions</div><div class="search"><i data-lucide="search" class="icon"></i><input class="input" id="faq-search" type="search" placeholder="Search FAQ…" value="${esc(ctx.local.faqQ)}" data-action="faq-search" autocomplete="off"></div></div>
            <div class="faq-list">${faqs.map(x => `
              <div class="faq ${ctx.local.faqOpen[x.i] ? 'open' : ''}">
                <button class="faq-q" data-action="toggle-faq" data-i="${x.i}" aria-expanded="${!!ctx.local.faqOpen[x.i]}">${icon(ctx.local.faqOpen[x.i] ? 'minus' : 'plus', 'icon-sm')}<span>${esc(x.q)}</span></button>
                ${ctx.local.faqOpen[x.i] ? `<div class="faq-a">${x.a}</div>` : ''}
              </div>`).join('') || `<div class="empty">${icon('search-x')}<div class="empty-title">No matching questions</div><div class="empty-sub">Try another term or submit a ticket above.</div></div>`}</div>
            <div class="card-footer centered"><span class="hint">Still stuck? <a href="#/documentation">Browse the documentation</a> or <button class="link-text" data-action="scroll-form">submit a ticket</button>.</span></div>
          </section>
        </div>

        <aside class="support-side">
          <section class="card">
            <div class="card-header tinted"><div class="card-title-caps">${icon('mail')}Contact</div></div>
            <div class="card-body contact-body">
              <div class="contact-row"><span class="quick-ic sm">${icon('mail')}</span><div class="grow"><div class="strong">support@vlrforge.io</div><div class="hint">Ticketed email · replies threaded here</div></div><button class="btn-icon" data-action="copy-email" data-tip="Copy address">${icon('copy')}</button></div>
              <div class="contact-row"><span class="quick-ic sm">${icon('slack')}</span><div class="grow"><div class="strong">Slack Connect</div><div class="hint">#vlrforge-${esc((s.settings.org.name || 'org').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))} · shared channel with our engineers</div></div><button class="btn btn-light btn-sm" data-action="slack-connect">${s.settings.integrations.slack ? 'Open' : 'Connect'}</button></div>
              <div class="contact-row"><span class="quick-ic sm">${icon('phone')}</span><div class="grow"><div class="strong">+34 910 000 424</div><div class="hint">Urgent incidents only · 24/7 on-call</div></div><button class="btn-icon" data-action="copy-phone" data-tip="Copy number">${icon('copy')}</button></div>
              <div class="divider"></div>
              <div class="sla-box">
                <div class="label">Service level agreement</div>
                <ul class="sla-list">
                  <li><span>Urgent</span><span class="mono">30 min · 24/7</span></li>
                  <li><span>High</span><span class="mono">2 h · business hours</span></li>
                  <li><span>Normal</span><span class="mono">1 business day</span></li>
                  <li><span>Low / feature request</span><span class="mono">3 business days</span></li>
                </ul>
                <div class="hint">Business hours: Mon–Fri 08:00–19:00 CET. Uptime commitment 99.9% for API, parser and translation pools.</div>
              </div>
            </div>
          </section>
          <section class="card mt-24">
            <div class="card-header tinted"><div class="card-title-caps">${icon('activity')}Your workspace</div></div>
            <div class="card-body">
              <dl class="kv">
                <dt>Organization</dt><dd>${esc(s.settings.org.name)}</dd>
                <dt>Plan</dt><dd><span class="badge badge-navy">${esc(s.settings.org.plan)}</span></dd>
                <dt>Account</dt><dd>${esc(me?.name || '')} · ${esc(me?.role || '')}</dd>
                <dt>Projects</dt><dd class="mono">${s.projects.length}</dd>
                <dt>Running tasks</dt><dd class="mono">${runningTasks('all').length}</dd>
                <dt>Failed tasks</dt><dd class="mono ${s.tasks.some(t => t.status === 'failed') ? 'danger-text' : ''}">${s.tasks.filter(t => t.status === 'failed').length}</dd>
                <dt>Spend to date</dt><dd class="mono">${fmtCost(totalCost())}</dd>
              </dl>
              <div class="row gap-6 mt-16 wrap"><a class="btn btn-light btn-sm" href="#/tasks">${icon('clipboard-list', 'icon-sm')}Tasks</a><a class="btn btn-light btn-sm" href="#/audit-log">${icon('scroll-text', 'icon-sm')}Audit log</a><a class="btn btn-light btn-sm" href="#/settings?tab=budget">${icon('wallet', 'icon-sm')}Budget</a></div>
            </div>
          </section>
        </aside>
      </div>`;
    ctx.footer.innerHTML = '';

    const scrollToForm = () => { ctx.content.querySelector('#ticket-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => ctx.content.querySelector('#tk-subject')?.focus({ preventScroll: true }), 350); };

    const unbindInput = bindInputs(ctx);
    const unbindClick = bindClicks(ctx, scrollToForm);
    if (ctx.local.pendingScroll) { ctx.local.pendingScroll = false; setTimeout(scrollToForm, 50); }
    return () => { unbindInput(); unbindClick(); };
  },
};

function bindInputs(ctx) {
  const handler = (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'form-field') {
      ctx.local.form[el.dataset.key] = el.value;
      // clear the validation flag as soon as the user fixes the field (survives the ~350 ms pipeline re-renders)
      if (ctx.local.invalid[el.dataset.key] && el.value.trim()) { ctx.local.invalid[el.dataset.key] = false; el.classList.remove('input-invalid'); }
      if (el.tagName === 'SELECT' && el.dataset.key === 'priority') ctx.rerender();
    }
    else if (el.dataset.action === 'reply-input') ctx.local.replies[el.dataset.id] = el.value;
    else if (el.dataset.action === 'faq-search') { ctx.local.faqQ = el.value; ctx.rerender(); }
  };
  ctx.content.addEventListener('input', handler);
  ctx.content.addEventListener('change', handler);
  return () => { ctx.content.removeEventListener('input', handler); ctx.content.removeEventListener('change', handler); };
}

function bindClicks(ctx, scrollToForm) {
  const handlers = {
    'scroll-form': () => scrollToForm(),
    'status-page': () => toast.info('Status history', 'Last 90 days: 99.98% uptime · 1 incident (translation pool capacity, resolved).'),
    'clear-form': () => { ctx.local.form = { subject: '', category: 'Pipeline', priority: 'Normal', message: '' }; ctx.local.invalid = {}; ctx.rerender(); },
    'submit-ticket': () => {
      if (ctx.local.justSubmitted && Date.now() - ctx.local.justSubmitted < 800) return; // ignore double clicks
      const f = ctx.local.form;
      ctx.local.invalid = { subject: !f.subject.trim(), message: !f.message.trim() };
      if (ctx.local.invalid.subject || ctx.local.invalid.message) {
        toast.error('Subject and message are required');
        ctx.rerender();
        ctx.content.querySelector(ctx.local.invalid.subject ? '#tk-subject' : '#tk-message')?.focus();
        return;
      }
      ctx.local.justSubmitted = Date.now();
      const t = createTicket({ subject: f.subject.trim(), category: f.category, priority: f.priority, message: f.message.trim() });
      ctx.local.form = { subject: '', category: 'Pipeline', priority: 'Normal', message: '' };
      ctx.local.invalid = {};
      ctx.local.ticketFilter = 'all';
      ctx.local.openTicket = t.id;
      toast.success(`Ticket ${t.id} submitted`, `${t.priority} priority · ${t.category}. An engineer will reply shortly.`);
      ctx.rerender();
    },
    'ticket-filter': (el) => { ctx.local.ticketFilter = el.dataset.filter; ctx.rerender(); },
    'toggle-ticket': (el) => { ctx.local.openTicket = ctx.local.openTicket === el.dataset.id ? null : el.dataset.id; ctx.rerender(); },
    'send-reply': (el) => {
      const id = el.dataset.id;
      const text = (ctx.local.replies[id] || '').trim();
      if (!text) { ctx.content.querySelector(`#reply-${CSS.escape(id)}`)?.classList.add('input-invalid'); toast.error('Write a reply first'); return; }
      const wasResolved = getState().tickets.find(t => t.id === id)?.status === 'resolved';
      replyTicket(id, text);
      ctx.local.replies[id] = '';
      toast.success('Reply sent', wasResolved ? `${id} reopened.` : `Added to ${id}.`);
    },
    'resolve-ticket': async (el) => {
      const id = el.dataset.id;
      if (await confirmDialog({ title: `Mark ${id} as resolved?`, msg: 'You can reopen it at any time by replying to the thread.', confirmText: 'Mark resolved', icon: 'check-circle-2' })) { resolveTicket(id); toast.success(`${id} resolved`, 'Thanks for confirming.'); }
    },
    'toggle-faq': (el) => { const i = el.dataset.i; ctx.local.faqOpen[i] = !ctx.local.faqOpen[i]; ctx.rerender(); },
    'copy-email': () => { copyToClipboard('support@vlrforge.io'); toast.success('Copied', 'support@vlrforge.io'); },
    'copy-phone': () => { copyToClipboard('+34910000424'); toast.success('Copied', '+34 910 000 424'); },
    'slack-connect': () => {
      const on = getState().settings.integrations.slack;
      if (on) toast.info('Opening Slack Connect', 'Shared channel opens in Slack.');
      else { navigate('#/settings?tab=organization'); toast.info('Enable the Slack integration', 'Turn on Slack under Organization → Integrations, then come back to open the shared channel.'); }
    },
  };
  const listener = (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || !ctx.content.contains(el)) return;
    const fn = handlers[el.dataset.action];
    if (fn) fn(el, ev);
  };
  ctx.content.addEventListener('click', listener);
  return () => ctx.content.removeEventListener('click', listener);
}
