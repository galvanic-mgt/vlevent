import { CONFIG } from './config.js';

// Build correct URL even for root-level PATCH ("/")
const normalizePath = (p) => {
  if (p === '/' || p === '' || !p) return '/';
  return String(p).startsWith('/') ? String(p) : `/${p}`;
};

const remoteUrl = (p) => {
  const base = CONFIG.firebaseBase.replace(/\/$/, '');
  const path = normalizePath(p);
  if (path === '/') return `${base}/.json`;
  return `${base}${path}.json`;
};

function useLocalFirebaseProxy() {
  return location.protocol === 'http:'
    && ['127.0.0.1', 'localhost'].includes(location.hostname)
    && location.port === '8000';
}

const proxyUrl = (p) => {
  const url = new URL('/__firebase', location.origin);
  url.searchParams.set('path', normalizePath(p));
  return url.href;
};

const proxyStreamUrl = (p) => {
  const url = new URL('/__firebase_stream', location.origin);
  url.searchParams.set('path', normalizePath(p));
  return url.href;
};

const requestUrl = (p) => useLocalFirebaseProxy() ? proxyUrl(p) : remoteUrl(p);
export const firebaseUrl = requestUrl;

const J = (x) => JSON.stringify(x);
const localChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('eva-local-firebase-ui')
  : null;
const LOCAL_STORAGE_KEY = 'eva-local-firebase-ui';

function shouldLocalEcho(path) {
  return useLocalFirebaseProxy() && normalizePath(path).includes('/ui/');
}

function relativeUpdate(watchPath, changedPath, data) {
  if (watchPath === changedPath) return { path: '/', data };
  if (watchPath !== '/' && changedPath.startsWith(`${watchPath}/`)) {
    return { path: changedPath.slice(watchPath.length), data };
  }
  if (changedPath !== '/' && watchPath.startsWith(`${changedPath}/`)) {
    let node = data;
    const parts = watchPath.slice(changedPath.length).replace(/^\//, '').split('/').filter(Boolean);
    for (const part of parts) {
      if (node && typeof node === 'object' && part in node) node = node[part];
      else return null;
    }
    return { path: '/', data: node };
  }
  return null;
}

function broadcastLocal(path, event, data) {
  if (!shouldLocalEcho(path)) return;
  const message = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    path: normalizePath(path),
    event,
    data
  };
  localChannel?.postMessage(message);
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(message));
  } catch (_) {}
}

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
  get:   async (p) => fetch(requestUrl(p)).then(r => readJson(r, p)),
  put:   async (p, b) => {
    broadcastLocal(p, 'put', b ?? null);
    return fetch(requestUrl(p), { method:'PUT', body:J(b) }).then(r => readJson(r, p));
  },
  patch: async (p, b) => fetch(requestUrl(p), { method:'PATCH', body:J(b) }).then(r => readJson(r, p)),
  del:   async (p) => {
    broadcastLocal(p, 'put', null);
    return fetch(requestUrl(p), { method:'DELETE' }).then(r => readJson(r, p));
  },
  listen: (p, onValue, options = {}) => {
    let closed = false;
    let current;
    let source = null;
    let timer = null;
    let lastKey = '';
    const watchPath = normalizePath(p);
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

    const handleLocal = (event) => {
      if (closed || !event?.data?.path) return;
      const update = relativeUpdate(watchPath, event.data.path, event.data.data);
      if (!update) return;
      current = applyStreamUpdate(current, update.path, update.data);
      emit(current, { type: event.data.event || 'local', path: update.path, local: true });
    };
    const handleStorage = (event) => {
      if (closed || event.key !== LOCAL_STORAGE_KEY || !event.newValue) return;
      try {
        handleLocal({ data: JSON.parse(event.newValue) });
      } catch (_) {}
    };
    localChannel?.addEventListener('message', handleLocal);
    window.addEventListener('storage', handleStorage);

    if (typeof EventSource === 'undefined') {
      startPolling();
      return () => {
        closed = true;
        clearInterval(timer);
        localChannel?.removeEventListener('message', handleLocal);
        window.removeEventListener('storage', handleStorage);
      };
    }

    if (options.transport === 'poll' || options.pollOnly === true) {
      startPolling();
      return () => {
        closed = true;
        clearInterval(timer);
        localChannel?.removeEventListener('message', handleLocal);
        window.removeEventListener('storage', handleStorage);
      };
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

    source = new EventSource(useLocalFirebaseProxy() ? proxyStreamUrl(p) : remoteUrl(p));
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
      localChannel?.removeEventListener('message', handleLocal);
      window.removeEventListener('storage', handleStorage);
    };
  }
};
