/* Login page — any credentials are accepted (demo environment). */
import { icon, esc, toast, refreshIcons } from '../ui.js';
import { login } from '../actions.js';
import { navigate } from '../router.js';
import { getState } from '../store.js';
import { APP_VERSION } from '../seed.js';

export default {
  title: () => 'Sign in',
  render({ root, query }) {
    const s = getState();
    root.innerHTML = `
    <div class="auth-shell">
      <section class="auth-hero">
        <div class="brand"><span class="brand-mark">VF</span><span><div class="brand-name">VLR Forge</div><div class="brand-sub">Governance Dashboard</div></span></div>
        <div class="auth-hero-body">
          <h1>Voluntary Local Reviews, generated with full provenance.</h1>
          <p>Upload your city's documents, run the extraction pipeline across the four VLR pillars, and review every indicator against the exact page and quote it came from.</p>
          <div class="auth-pillars">
            <div class="auth-pillar">${icon('bar-chart-2')}<strong>Indicators</strong><span>SDG indicator values with trends and 2030 projections</span></div>
            <div class="auth-pillar">${icon('book-open')}<strong>Documentary</strong><span>Challenges, commitments and policies (C1–C3)</span></div>
            <div class="auth-pillar">${icon('layout-grid')}<strong>Projects</strong><span>City initiatives deduplicated across SDGs</span></div>
            <div class="auth-pillar">${icon('users')}<strong>Stakeholders</strong><span>Community voices with verbatim quotes</span></div>
          </div>
        </div>
        <div class="auth-hero-foot"><span><span class="dot"></span>SYSTEM: OPERATIONAL</span><span>NODE: ${esc(s.meta?.node || 'EU-WEST-1')}</span><span>VLR FORGE ${APP_VERSION}</span></div>
      </section>
      <section class="auth-panel">
        <div class="auth-card">
          <h2>Sign in</h2>
          <div class="sub">Use your organisation account to access the governance dashboard.</div>
          <form class="auth-form" id="login-form" novalidate>
            <div class="field"><label class="label" for="login-email">Work email</label><input class="input" id="login-email" type="email" placeholder="name@organisation.org" value="jorge@nexuslab.io" autocomplete="username"></div>
            <div class="field"><label class="label" for="login-password">Password</label>
              <div class="pw-wrap"><input class="input" id="login-password" type="password" placeholder="••••••••" value="demo-password" autocomplete="current-password"><button type="button" class="btn-icon" id="toggle-pw" aria-label="Show password">${icon('eye')}</button></div>
            </div>
            <div class="row-between"><label class="checkbox"><input type="checkbox" id="login-remember" checked> Keep me signed in</label><a href="#" id="forgot-link">Forgot password?</a></div>
            <button class="btn btn-primary btn-lg btn-block" type="submit" id="login-submit">${icon('log-in')}Sign in</button>
            <div class="auth-or">or continue with</div>
            <div class="auth-sso">
              <button type="button" class="btn btn-light btn-block" data-sso="Google Workspace">${icon('globe')}Google</button>
              <button type="button" class="btn btn-light btn-block" data-sso="Microsoft Entra ID">${icon('building-2')}Microsoft</button>
              <button type="button" class="btn btn-light btn-block" data-sso="SAML SSO">${icon('key-round')}SAML</button>
            </div>
          </form>
          <div class="callout auth-demo">${icon('info')}<div><strong>Demo environment.</strong> Any email and password are accepted. Your name is derived from the email address.</div></div>
          <div class="auth-foot">© ${new Date().getFullYear()} VLR Forge · Enterprise plan · Data residency: EU</div>
        </div>
      </section>
    </div>`;
    refreshIcons(root);

    const rawNext = query?.next ? (query.next.startsWith('#') ? query.next : '#' + query.next) : '';
    const next = rawNext.startsWith('#/') && !rawNext.startsWith('#/login') ? rawNext : '#/projects';
    let busy = false;
    const doLogin = (email, sso) => {
      if (busy) return; // ignore double clicks / double submits while the fake auth round-trip runs
      busy = true;
      const btn = root.querySelector('#login-submit');
      root.querySelectorAll('[data-sso]').forEach(b => { b.disabled = true; });
      btn.disabled = true;
      btn.classList.add('loading'); btn.innerHTML = `${icon('loader-2', 'spin')}Signing in…`; refreshIcons(btn);
      setTimeout(() => {
        const user = login({ email, password: root.querySelector('#login-password').value, remember: root.querySelector('#login-remember').checked });
        toast.success(`Welcome back, ${user.name.split(' ')[0]}`, sso ? `Signed in via ${sso}` : `Signed in as ${user.email}`);
        navigate(next, { replace: true });
      }, 650);
    };
    root.querySelector('#login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const email = root.querySelector('#login-email').value.trim();
      const emailEl = root.querySelector('#login-email');
      if (!email || !email.includes('@')) { emailEl.classList.add('input-invalid'); emailEl.focus(); toast.error('Enter a valid email address'); return; }
      emailEl.classList.remove('input-invalid');
      doLogin(email, null);
    });
    root.querySelectorAll('[data-sso]').forEach(b => b.addEventListener('click', () => doLogin(root.querySelector('#login-email').value.trim() || 'jorge@nexuslab.io', b.dataset.sso)));
    root.querySelector('#toggle-pw').addEventListener('click', () => {
      const pw = root.querySelector('#login-password');
      pw.type = pw.type === 'password' ? 'text' : 'password';
      const tg = root.querySelector('#toggle-pw');
      tg.innerHTML = icon(pw.type === 'password' ? 'eye' : 'eye-off');
      tg.setAttribute('aria-label', pw.type === 'password' ? 'Show password' : 'Hide password');
      refreshIcons(root);
    });
    root.querySelector('#forgot-link').addEventListener('click', (e) => {
      e.preventDefault();
      const emailEl = root.querySelector('#login-email');
      const email = emailEl.value.trim();
      if (!email || !email.includes('@')) { emailEl.classList.add('input-invalid'); emailEl.focus(); toast.error('Enter your work email first', 'We need a valid address to send the reset link.'); return; }
      emailEl.classList.remove('input-invalid');
      toast.info('Password reset link sent', `Check ${email} for instructions.`);
    });
  },
};
