// src/polls_public_firebase.js
import { FB } from './fb.js';
import { getCurrentEventId } from './core_firebase.js';

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

/**
 * NOTE on concurrency: Realtime DB REST doesn't give a simple atomic increment in plain JSON.
 * For event-scale voting this read-modify-write is acceptable. If you expect heavy traffic,
 * switch to ServerValue.increment via PATCH:
 *   { "votes/OPTID": { ".sv": { "increment": 1 } } }
 */
export async function incrementVote(eid, pid, optionId) {
  const cur = (await FB.get(`/events/${eid}/polls/${pid}/votes/${optionId}`)) || 0;
  const next = Number(cur || 0) + 1;
  await FB.put(`/events/${eid}/polls/${pid}/votes/${optionId}`, next);
  return next;
}

export async function submitBoundVote(eid, pid, voterKey, optionId) {
  if (!voterKey) throw new Error('Missing voter identity');
  const existing = await FB.get(`/events/${eid}/polls/${pid}/voters/${voterKey}`);
  if (existing) throw new Error('This batch number has already voted');
  const next = await incrementVote(eid, pid, optionId);
  await FB.put(`/events/${eid}/polls/${pid}/voters/${voterKey}`, {
    optionId,
    votedAt: Date.now()
  });
  return next;
}
