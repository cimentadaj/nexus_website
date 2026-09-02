/* Ask — a fully open chat over the demo's live data (VLR Assist). Grounded answers with citations. */
import { esc, icon, refreshIcons, bindActions, avatarHtml, relTimeShort, toast, confirmDialog } from '../ui.js';
import { getState, currentUser } from '../store.js';
import { askQuestion, setAskScope, clearAsk } from '../actions.js';
import { suggestedQuestions } from '../ask.js';
import { topbarActions } from '../shell.js';

/** tiny renderer for the assistant's markdown-ish text: **bold**, lines, "• " bullets */
function rich(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const lines = String(text || '').split('\n');
  let out = '', list = [];
  const flush = () => { if (list.length) { out += `<ul class="ask-ul">${list.map(li => `<li>${inline(li)}</li>`).join('')}</ul>`; list = []; } };
  for (const ln of lines) {
    if (/^\s*•\s+/.test(ln)) list.push(ln.replace(/^\s*•\s+/, ''));
    else { flush(); if (ln.trim()) out += `<p>${inline(ln)}</p>`; }
  }
  flush();
  return out;
}

const tableHtml = (t) => t ? `<div class="ask-table-wrap"><table class="ask-table"><thead><tr>${t.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
const citesHtml = (cs) => cs?.length ? `<div class="ask-cites"><span class="ask-cites-label">${icon('link-2', 'icon-xs')}Sources</span>${cs.map(c => `<a class="ask-cite" href="${esc(c.href)}" ${c.sub ? `data-tip="${esc(c.sub)}"` : ''}>${icon('file-text', 'icon-xs')}<span>${esc(c.label)}</span></a>`).join('')}</div>` : '';
const followHtml = (fs) => fs?.length ? `<div class="ask-follow">${fs.map(f => `<button class="ask-chip" data-action="ask-chip" data-q="${esc(f)}">${esc(f)}</button>`).join('')}</div>` : '';

function messageHtml(m) {
  if (m.role === 'user') {
    return `<div class="ask-msg user"><div class="ask-bubble user">${rich(m.text)}</div>${avatarHtml(currentUser())}</div>`;
  }
  return `<div class="ask-msg assistant">
    <span class="ask-avatar">${icon('sparkles')}</span>
    <div class="ask-bubble assistant">
      <div class="ask-meta"><strong>VLR Assist</strong><span class="muted">· Gemini 2.5 Pro · ${m.pending ? 'reading the evidence…' : relTimeShort(m.at)}</span></div>
      ${m.pending ? `<div class="ask-typing"><span></span><span></span><span></span></div>` : `${rich(m.text)}${tableHtml(m.table)}${citesHtml(m.citations)}${followHtml(m.followUps)}`}
    </div>
  </div>`;
}

export default {
  title: () => 'Ask',
  render(ctx) {
    const s = getState();
    const ask = s.ask || { messages: [], scope: 'all' };
    const pending = ask.messages.some(m => m.pending);

    ctx.topbar.innerHTML = `
      <div><div class="topbar-title">Ask</div><div class="topbar-subtitle">VLR Assist · Grounded answers with citations</div></div>
      <div class="row gap-6" style="margin-left:18px"><span class="caps" style="letter-spacing:.06em">Scope</span>
        <select class="select select-sm" id="ask-scope">${[['all', 'All projects'], ...s.projects.map(p => [p.id, p.name])].map(([v, l]) => `<option value="${esc(v)}" ${ask.scope === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      </div>
      <span class="grow"></span>
      ${ask.messages.length ? `<button class="btn btn-ghost btn-sm" data-action="ask-clear">${icon('eraser', 'icon-sm')}Clear conversation</button>` : ''}
      ${topbarActions()}`;

    const hero = `
      <div class="ask-hero">
        <span class="ask-hero-mark">${icon('sparkles', 'icon-xl')}</span>
        <h1>Ask anything about your VLR data</h1>
        <p class="page-subtitle">Free-form questions over every project, document, evidence item, cost and chapter.<br>Every number in an answer is cited to its source document and page.</p>
        <div class="ask-suggest">${suggestedQuestions(ask.scope).map(q => `<button class="ask-card" data-action="ask-chip" data-q="${esc(q)}">${icon('message-circle-question', 'icon-sm')}<span>${esc(q)}</span></button>`).join('')}</div>
      </div>`;

    ctx.content.innerHTML = `
      <div class="ask-page">
        <div class="ask-thread" id="ask-thread">${ask.messages.length ? `<div class="ask-thread-inner">${ask.messages.map(messageHtml).join('')}</div>` : hero}</div>
        <div class="ask-composer">
          <div class="ask-composer-inner">
            <textarea class="textarea" id="ask-input" rows="1" placeholder="Ask about indicators, costs, coverage, stakeholder voices, chapters… (Enter to send)" ${pending ? 'disabled' : ''}>${esc(ctx.local.draft || '')}</textarea>
            <button class="btn btn-primary" data-action="ask-send" ${pending ? 'disabled' : ''}>${icon(pending ? 'loader-2' : 'send', pending ? 'icon-sm spin' : 'icon-sm')}Ask</button>
          </div>
          <div class="ask-hint">${icon('shield-check', 'icon-xs')}Answers are generated from the review's own evidence base — sources, pages and quotes included. Nothing leaves your workspace.</div>
        </div>
      </div>`;
    refreshIcons(ctx.content);

    const thread = ctx.content.querySelector('#ask-thread');
    const inputEl = () => ctx.content.querySelector('#ask-input');
    // keep scroll pinned to the bottom when new messages arrive (or content of the pending one resolves)
    const stamp = ask.messages.length + ':' + (pending ? 'p' : 'd');
    if (ctx.local.stamp !== stamp) { ctx.local.stamp = stamp; thread.scrollTop = thread.scrollHeight; }
    else if (ctx.local.scroll != null) thread.scrollTop = ctx.local.scroll;
    thread.addEventListener('scroll', () => { ctx.local.scroll = thread.scrollTop; });

    const send = (q) => {
      const text = String(q ?? inputEl().value).trim();
      if (!text) return;
      if (getState().ask.messages.some(m => m.pending)) return;
      ctx.local.draft = '';
      ctx.local.scroll = null;
      askQuestion(text);
    };

    const unbindTop = bindActions(ctx.topbar, { 'ask-clear': async () => { if (await confirmDialog({ title: 'Clear conversation?', msg: 'The chat history is removed from this browser only.', confirmText: 'Clear', icon: 'eraser' })) { clearAsk(); toast.info('Conversation cleared'); } } });
    const unbind = bindActions(ctx.content, {
      'ask-send': () => send(),
      'ask-chip': (el) => send(el.dataset.q),
    });
    ctx.topbar.querySelector('#ask-scope')?.addEventListener('change', (e) => { setAskScope(e.target.value); });
    const ta = inputEl();
    ta?.addEventListener('input', () => { ctx.local.draft = ta.value; ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; });
    ta?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    if (!getState().ask.messages.length) setTimeout(() => ta?.focus({ preventScroll: true }), 30);

    ctx.footer.innerHTML = '';
    return () => { unbind(); unbindTop(); };
  },
};
