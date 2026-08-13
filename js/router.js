/**
 * Hash router. Hash routing keeps the app working from a file:// URL, a static
 * host, or a subdirectory with no server rewrites — all likely deployments for
 * a detachment with no IT budget.
 */

const routes = [];
let outlet = null;
let onAfterRender = null;
let current = null;

/**
 * @param {string} pattern e.g. '/instructor' or '/instructor/create/:id'
 * @param {(ctx: {params: object, query: URLSearchParams, path: string}) => any} handler
 * @param {{guard?: () => string|null, title?: string}} options
 */
export function route(pattern, handler, options = {}) {
  const names = [];
  const regex = new RegExp(`^${pattern
    .replace(/\/:([^/]+)/g, (_, name) => { names.push(name); return '/([^/]+)'; })
    .replace(/\//g, '\\/')}$`);
  routes.push({ pattern, regex, names, handler, ...options });
}

export function startRouter(outletEl, { afterRender = null } = {}) {
  outlet = outletEl;
  onAfterRender = afterRender;
  window.addEventListener('hashchange', resolve);
  resolve();
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (location.hash === target) return resolve();
  if (replace) {
    // replaceState deliberately does not fire hashchange, so resolve by hand.
    history.replaceState(null, '', target);
    return resolve();
  }
  location.hash = target; // fires hashchange, which calls resolve()
  return undefined;
}


/** Path portion of the hash, without the query string. */
export function currentPath() {
  return (location.hash.slice(1) || '/').split('?')[0];
}

/** Depth of the current guard-redirect chain, to catch a misconfigured guard. */
let redirects = 0;

async function resolve() {
  if (!outlet) return;
  if (redirects > 10) {
    redirects = 0;
    throw new Error('Too many redirects — check the route guards.');
  }
  const raw = location.hash.slice(1) || '/';
  const [path, queryString = ''] = raw.split('?');
  const query = new URLSearchParams(queryString);

  for (const entry of routes) {
    const match = path.match(entry.regex);
    if (!match) continue;

    if (entry.guard) {
      const redirect = entry.guard();
      if (redirect) {
        redirects++;
        return navigate(redirect, { replace: true });
      }
    }
    redirects = 0;

    const params = Object.fromEntries(entry.names.map((name, i) => [name, decodeURIComponent(match[i + 1])]));
    current = { ...entry, params, query, path };

    outlet.replaceChildren();
    try {
      await entry.handler({ params, query, path, outlet });
    } catch (err) {
      console.error('[router]', err);
      renderError(err);
    }
    // A fresh view should start at the top, and focus belongs on the heading.
    window.scrollTo({ top: 0 });
    const heading = outlet.querySelector('h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    onAfterRender?.(current);
    return undefined;
  }

  return navigate('/home', { replace: true });
}

function renderError(err) {
  const wrap = document.createElement('div');
  wrap.className = 'notice notice--danger';
  wrap.innerHTML = `<div><strong class="notice__title">Something went wrong</strong>${escapeHtml(err.message)}</div>`;
  outlet.replaceChildren(wrap);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
