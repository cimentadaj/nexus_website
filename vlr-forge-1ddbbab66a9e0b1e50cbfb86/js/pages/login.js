/* Login page — any credentials are accepted (demo environment). */
import { icon, toast, refreshIcons } from '../ui.js';
import { login } from '../actions.js';
import { navigate } from '../router.js';

export default {
  title: () => 'Sign in',
  render({ root, query }) {
    root.innerHTML = `
    <div class="auth-shell auth-simple">
      <header class="topbar"><a class="topbar-brand" href="#/login"><span class="brand-mark">VF</span><span class="topbar-brand-name">VLR Forge</span></a></header>
      <div class="auth-center">
        <div class="auth-card">
          <h2>Sign in</h2>
          <form class="auth-form" id="login-form" novalidate>
            <div class="field"><label class="label" for="login-email">Username</label><input class="input" id="login-email" type="text" placeholder="username" value="jorge" autocomplete="username"></div>
            <div class="field"><label class="label" for="login-password">Password</label><input class="input" id="login-password" type="password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" value="demo-password" autocomplete="current-password"></div>
            <button class="btn btn-primary btn-lg btn-block" type="submit" id="login-submit">${icon('log-in')}Sign in</button>
          </form>
        </div>
      </div>
    </div>`;
    refreshIcons(root);

    const rawNext = query?.next ? (query.next.startsWith('#') ? query.next : '#' + query.next) : '';
    const next = rawNext.startsWith('#/') && !rawNext.startsWith('#/login') ? rawNext : '#/projects';
    let busy = false;
    root.querySelector('#login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy) return;
      const raw = root.querySelector('#login-email').value.trim();
      if (!raw) { root.querySelector('#login-email').focus(); toast.error('Enter a username'); return; }
      busy = true;
      const btn = root.querySelector('#login-submit');
      btn.disabled = true; btn.classList.add('loading'); btn.innerHTML = `${icon('loader-2', 'spin')}Signing in\u2026`; refreshIcons(btn);
      const email = raw.includes('@') ? raw : `${raw}@nexuslab.io`;
      setTimeout(() => {
        const user = login({ email, password: root.querySelector('#login-password').value, remember: true });
        toast.success(`Welcome back, ${user.name.split(' ')[0]}`, `Signed in as ${user.email}`);
        navigate(next, { replace: true });
      }, 500);
    });
  },
};
