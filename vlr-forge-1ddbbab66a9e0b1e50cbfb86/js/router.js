/* router.js — tiny hash router. Routes: '#/projects/:id' → params {id}. Query string after '?' parsed into query. */

let navCount = 0;
/** Number of in-app navigations so far (used to decide whether history.back() stays inside the app). */
export const inAppNavigations = () => navCount;

export function createRouter(routes, { onChange }) {
  const compiled = routes.map(r => {
    const keys = [];
    if (r.path === '*') return { ...r, re: /^(?!)$/, keys };
    const re = new RegExp('^' + r.path.replace(/\//g, '\\/').replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^\\/]+)'; }) + '$');
    return { ...r, re, keys };
  });

  function resolve(hash) {
    const raw = (hash || '#/').replace(/^#/, '') || '/';
    const [pathPart, queryPart] = raw.split('?');
    const path = pathPart.replace(/\/+$/, '') || '/';
    const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
    for (const r of compiled) {
      const m = path.match(r.re);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
        return { route: r, params, query, path, hash: raw };
      }
    }
    return { route: compiled.find(r => r.path === '*') || null, params: {}, query, path, hash: raw };
  }

  let current = null;
  function handle() {
    current = resolve(location.hash);
    navCount++;
    onChange(current);
  }
  window.addEventListener('hashchange', handle);
  return {
    start() { handle(); },
    current() { return current; },
    resolve,
    navigate(to, { replace = false } = {}) {
      const target = to.startsWith('#') ? to : '#' + to;
      if (replace) location.replace(target); else location.hash = target;
      if (location.hash === target && replace) handle();
    },
  };
}

export const navigate = (to, opts) => {
  const target = to.startsWith('#') ? to : '#' + to;
  if (opts?.replace) location.replace(target); else location.hash = target;
};
