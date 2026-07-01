import { CONFIG } from './config.js';

// Build correct URL even for root-level PATCH ("/")
const U = (p) => {
  const base = CONFIG.firebaseBase.replace(/\/$/, '');
  if (p === '/' || p === '' || !p) return `${base}/.json`;
  const path = String(p).startsWith('/') ? String(p) : `/${p}`;
  return `${base}${path}.json`;
};
export const firebaseUrl = U;

const J = (x) => JSON.stringify(x);
async function readJson(res, path) {
  const data = await res.json().catch(() => null);
  if (!res.ok || (data && typeof data.error === 'string')) {
    const msg = data?.error || `${res.status} ${res.statusText || ''}`.trim();
    throw new Error(`Firebase ${path} failed: ${msg}`);
  }
  return data;
}

function applyStreamUpdate(current, path, data) {
  if (path === '/' || !path) return data;
  const parts = String(path).replace(/^\//, '').split('/').filter(Boolean);
  const root = current && typeof current === 'object'
    ? (Array.isArray(current) ? current.slice() : { ...current })
    : {};
  let node = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const next = node[key];
    node[key] = next && typeof next === 'object'
      ? (Array.isArray(next) ? next.slice() : { ...next })
      : {};
    node = node[key];
  }
  const last = parts[parts.length - 1];
  if (data === null) delete node[last];
  else node[last] = data;
  return root;
}

export const FB = {
  get:   async (p) => fetch(U(p)).then(r => readJson(r, p)),
  put:   async (p, b) => fetch(U(p), { method:'PUT', body:J(b) }).then(r => readJson(r, p)),
  patch: async (p, b) => fetch(U(p), { method:'PATCH', body:J(b) }).then(r => readJson(r, p)),
  del:   async (p) => fetch(U(p), { method:'DELETE' }).then(r => readJson(r, p)),
  listen: (p, onValue, options = {}) => {
    let closed = false;
    let current;
    let source = null;
    let timer = null;
    let lastKey = '';
    const fallbackMs = Math.max(2000, Number(options.fallbackMs || 5000));

    const emit = (value, meta = {}) => {
      const key = JSON.stringify(value ?? null);
      if (key === lastKey && !options.emitDuplicates) return;
      lastKey = key;
      current = value;
      onValue?.(value, meta);
    };

    const startPolling = () => {
      if (timer) return;
      const poll = async () => {
        if (closed) return;
        try { emit(await FB.get(p), { type: 'poll' }); } catch (_) {}
      };
      poll();
      timer = setInterval(poll, fallbackMs);
    };

    if (typeof EventSource === 'undefined') {
      startPolling();
      return () => { closed = true; clearInterval(timer); };
    }

    const handle = (event) => {
      if (closed) return;
      try {
        const msg = JSON.parse(event.data || '{}');
        current = applyStreamUpdate(current, msg.path || '/', msg.data);
        emit(current, { type: event.type, path: msg.path || '/' });
      } catch (error) {
        console.warn('[Firebase listen] event parse failed', p, error);
      }
    };

    source = new EventSource(U(p));
    source.addEventListener('put', handle);
    source.addEventListener('patch', handle);
    source.onerror = () => {
      if (!closed) console.warn('[Firebase listen] stream interrupted', p);
      if (!closed && source) {
        source.close();
        source = null;
        startPolling();
      }
    };
    return () => {
      closed = true;
      if (source) source.close();
      if (timer) clearInterval(timer);
    };
  }
};
