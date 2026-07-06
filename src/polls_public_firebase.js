// src/polls_public_firebase.js
import { FB, firebaseUrl } from './fb.js?v=20260706b';
import { getCurrentEventId } from './core_firebase.js?v=20260706b';

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

export async function setActive(eid, pid, active = true) {
  return await FB.patch(`/events/${eid}/polls/${pid}`, { active: !!active });
}

export function voteCountsFromPoll(poll = {}) {
  const counts = { ...(poll.votes || {}) };
  const voterCounts = {};
  Object.values(poll.voters || {}).forEach(vote => {
    const optionId = vote?.optionId || '';
    if (!optionId) return;
    voterCounts[optionId] = Number(voterCounts[optionId] || 0) + 1;
  });
  Object.entries(voterCounts).forEach(([optionId, count]) => {
    counts[optionId] = Math.max(Number(counts[optionId] || 0), Number(count || 0));
  });
  return counts;
}

async function readJsonResponse(res, path) {
  const data = await res.json().catch(() => null);
  if (!res.ok || (data && typeof data.error === 'string')) {
    const msg = data?.error || `${res.status} ${res.statusText || ''}`.trim();
    throw new Error(`Firebase ${path} failed: ${msg}`);
  }
  return data;
}

async function readWithEtag(path) {
  const res = await fetch(firebaseUrl(path), { headers: { 'X-Firebase-ETag': 'true' } });
  const data = await readJsonResponse(res, path);
  const etag = res.headers.get('ETag');
  if (!etag) throw new Error('Firebase did not return an ETag for voter claim');
  return { data, etag };
}

async function conditionalPut(path, body, etag) {
  const res = await fetch(firebaseUrl(path), {
    method: 'PUT',
    headers: { 'if-match': etag },
    body: JSON.stringify(body)
  });
  if (res.status === 412) return { claimed: false };
  await readJsonResponse(res, path);
  return { claimed: true };
}

async function claimVoter(eid, pid, voterKey, optionId) {
  const path = `/events/${eid}/polls/${pid}/voters/${voterKey}`;
  const record = {
    optionId,
    votedAt: Date.now(),
    counted: false
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, etag } = await readWithEtag(path);
    if (data) throw new Error('This batch number has already voted');
    const result = await conditionalPut(path, record, etag);
    if (result.claimed) return record;
  }

  const existing = await FB.get(path).catch(() => null);
  if (existing) throw new Error('This batch number has already voted');
  throw new Error('Vote was busy. Please submit again.');
}

export async function incrementVote(eid, pid, optionId) {
  await FB.patch(`/events/${eid}/polls/${pid}`, {
    [`votes/${optionId}`]: { '.sv': { increment: 1 } }
  });
  return await FB.get(`/events/${eid}/polls/${pid}/votes/${optionId}`).catch(() => null);
}

export async function submitBoundVote(eid, pid, voterKey, optionId) {
  if (!voterKey) throw new Error('Missing voter identity');
  await claimVoter(eid, pid, voterKey, optionId);
  try {
    const next = await incrementVote(eid, pid, optionId);
    await FB.patch(`/events/${eid}/polls/${pid}/voters/${voterKey}`, { counted: true, countedAt: Date.now() }).catch(() => {});
    return next;
  } catch (error) {
    console.warn('[poll vote] count increment failed; voter record remains the source of truth', error);
    return null;
  }
}
