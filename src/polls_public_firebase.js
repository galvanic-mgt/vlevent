// src/polls_public_firebase.js
import { FB, firebaseUrl } from './fb.js?v=20260706b';
import { getCurrentEventId } from './core_firebase.js?v=20260706b';
import { CONFIG } from './config.js';
import { rebuildVoterLookup } from './voter_lookup.js?v=20260712f';

/**
 * Poll shape:
 * {
 *   id: string,
 *   q: string,
 *   options: [{ id: string, text: string }],
 *   votes: { [optionId]: number },
 *   active: boolean,
 *   createdAt: number
 * }
 */

export async function publishPoll(poll) {
  const eid = getCurrentEventId();
  if (!eid) throw new Error('No current event');
  // ensure defaults
  const normalized = {
    ...poll,
    id: poll.id,
    q: poll.q?.trim() || '',
    options: (poll.options || []).map(o => ({ id: o.id, text: o.text })),
    votes: poll.votes || {},
    active: poll.active !== false,
    createdAt: poll.createdAt || Date.now()
  };
  return await FB.put(`/events/${eid}/polls/${normalized.id}`, normalized);
}

export async function getPollsOfEvent(eid) {
  return (await FB.get(`/events/${eid}/polls`)) || {};
}

export async function getPoll(eid, pid) {
  return (await FB.get(`/events/${eid}/polls/${pid}`)) || null;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function remoteFirebaseUrl(path) {
  const base = CONFIG.firebaseBase.replace(/\/$/, '');
  const cleanPath = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
  return `${base}${cleanPath}.json`;
}

async function putJsonWithAbort(path, value, ms = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(remoteFirebaseUrl(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
      signal: controller.signal
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || (data && typeof data.error === 'string')) {
      throw new Error(data?.error || `${res.status} ${res.statusText || ''}`.trim());
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function retryActiveWrite(fn) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await wait(350 + attempt * 650);
    }
  }
  throw lastError;
}

export async function setActive(eid, pid, active = true) {
  const path = `/events/${eid}/polls/${pid}/active`;
  if (active) {
    await rebuildVoterLookup(eid);
    await ensureVoteRecordMode(eid, pid);
  }
  return await retryActiveWrite(() => putJsonWithAbort(path, !!active));
}

function voterCountsOnly(poll = {}) {
  const voterCounts = {};
  Object.values(poll.voters || {}).forEach(vote => {
    const optionId = vote?.optionId || '';
    if (!optionId) return;
    voterCounts[optionId] = Number(voterCounts[optionId] || 0) + 1;
  });
  return voterCounts;
}

export function voteCountsFromPoll(poll = {}) {
  const voterCounts = voterCountsOnly(poll);
  if (poll.voteRecordMode === 'voters-v1') {
    const counts = {};
    const optionIds = new Set([
      ...Object.keys(poll.voteBaseline || {}),
      ...Object.keys(voterCounts),
      ...(poll.options || []).map(option => option?.id).filter(Boolean)
    ]);
    optionIds.forEach(optionId => {
      counts[optionId] = Number(poll.voteBaseline?.[optionId] || 0)
        + Number(voterCounts[optionId] || 0);
    });
    return counts;
  }

  const counts = { ...(poll.votes || {}) };
  Object.entries(voterCounts).forEach(([optionId, count]) => {
    counts[optionId] = Math.max(Number(counts[optionId] || 0), Number(count || 0));
  });
  return counts;
}

async function ensureVoteRecordMode(eid, pid) {
  const poll = await getPoll(eid, pid);
  if (!poll || poll.voteRecordMode === 'voters-v1') return poll;
  const recorded = voterCountsOnly(poll);
  const baseline = {};
  const optionIds = new Set([
    ...Object.keys(poll.votes || {}),
    ...Object.keys(recorded),
    ...(poll.options || []).map(option => option?.id).filter(Boolean)
  ]);
  optionIds.forEach(optionId => {
    baseline[optionId] = Math.max(0,
      Number(poll.votes?.[optionId] || 0) - Number(recorded[optionId] || 0));
  });
  await FB.patch(`/events/${eid}/polls/${pid}`, {
    voteRecordMode: 'voters-v1',
    voteBaseline: baseline,
    voteRecordModeAt: Date.now()
  });
  return { ...poll, voteRecordMode: 'voters-v1', voteBaseline: baseline };
}

async function readJsonResponse(res, path) {
  const data = await res.json().catch(() => null);
  if (!res.ok || (data && typeof data.error === 'string')) {
    const msg = data?.error || `${res.status} ${res.statusText || ''}`.trim();
    const error = new Error(`Firebase ${path} failed: ${msg}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

async function readWithEtag(path) {
  const res = await fetchWithTimeout(firebaseUrl(path), {
    cache: 'no-store',
    headers: { 'X-Firebase-ETag': 'true' }
  });
  const data = await readJsonResponse(res, path);
  const etag = res.headers.get('ETag');
  if (!etag) throw new Error('Firebase did not return an ETag for voter claim');
  return { data, etag };
}

async function conditionalPut(path, body, etag) {
  const res = await fetchWithTimeout(firebaseUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'if-match': etag },
    body: JSON.stringify(body),
    keepalive: true
  });
  if (res.status === 412) return { claimed: false };
  await readJsonResponse(res, path);
  return { claimed: true };
}

async function fetchWithTimeout(url, options = {}, ms = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readVoteRecord(path) {
  const res = await fetchWithTimeout(firebaseUrl(path), { cache: 'no-store' });
  return await readJsonResponse(res, path);
}

function existingVoteResult(existing, optionId) {
  if (existing?.optionId === optionId) return { ...existing, existing: true };
  const error = new Error('This batch number has already voted');
  error.code = 'ALREADY_VOTED';
  throw error;
}

function retryDelay(attempt) {
  const base = Math.min(4000, 250 * (2 ** attempt));
  return base + Math.floor(Math.random() * Math.max(100, base * 0.35));
}

async function claimVoter(eid, pid, voterKey, optionId) {
  const path = `/events/${eid}/polls/${pid}/voters/${voterKey}`;
  const record = {
    optionId,
    votedAt: Date.now(),
    source: 'voters-v1'
  };

  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const { data, etag } = await readWithEtag(path);
      if (data) return existingVoteResult(data, optionId);
      const result = await conditionalPut(path, record, etag);
      if (result.claimed) return record;
    } catch (error) {
      if (error?.code === 'ALREADY_VOTED') throw error;
      if ([400, 401, 403].includes(Number(error?.status || 0))) throw error;
      lastError = error;
      const existing = await readVoteRecord(path).catch(() => null);
      if (existing) return existingVoteResult(existing, optionId);
    }
    if (attempt < 5) await wait(retryDelay(attempt));
  }

  const existing = await readVoteRecord(path).catch(() => null);
  if (existing) return existingVoteResult(existing, optionId);
  throw new Error(`Vote could not be confirmed. Please try again.${lastError?.message ? ` (${lastError.message})` : ''}`);
}

export async function submitBoundVote(eid, pid, voterKey, optionId) {
  if (!voterKey) throw new Error('Missing voter identity');
  const active = await readVoteRecord(`/events/${eid}/polls/${pid}/active`).catch(() => null);
  if (active === false) {
    const error = new Error('Voting is closed.');
    error.code = 'VOTING_CLOSED';
    throw error;
  }
  return await claimVoter(eid, pid, voterKey, optionId);
}
