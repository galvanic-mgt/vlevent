import { CONFIG } from './config.js';

// Build correct URL even for root-level PATCH ("/")
const U = (p) => {
  const base = CONFIG.firebaseBase.replace(/\/$/, '');
  if (p === '/' || p === '' || !p) return `${base}/.json`;
  return `${base}${p}.json`;
};

const J = (x) => JSON.stringify(x);

export const FB = {
  get:   async (p) => fetch(U(p)).then(r => r.json()),
  put:   async (p, b) => fetch(U(p), { method:'PUT', body:J(b) }).then(r => r.json()),
  patch: async (p, b) => fetch(U(p), { method:'PATCH', body:J(b) }).then(r => r.json()),
  del:   async (p) => fetch(U(p), { method:'DELETE' }).then(r => r.json())
};
