import { FB } from './fb.js?v=20260706b';
import { CONFIG } from './config.js';
import {
  getPeople,
  getPrizes,
  getCurrentPrizeIdRemote,
  getEventInfo,
  getAssets,
  setCurrentEventId
} from './core_firebase.js?v=20260708d';

export function getEventIdFromUrl() {
  const params = new URL(location.href).searchParams;
  return (params.get('event') || params.get('eid') || params.get('id') || '').trim();
}

export function initEventFromUrl() {
  const eid = getEventIdFromUrl();
  if (eid) setCurrentEventId(eid);
  return eid;
}

export function v2Root(eid) {
  return `/events/${eid}/ui/luckyV2`;
}

export function makeId(prefix = 'v2') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function participantKey(p = {}) {
  const phone = String(p.phone || '').trim();
  const code = String(p.code || p.staffId || '').trim();
  const name = String(p.name || '').trim();
  const dept = String(p.dept || p.department || '').trim();
  if (phone) return `phone:${phone}`;
  if (code) return `code:${code}`;
  return `name:${name}||${dept}`;
}

export function keyIdFromKey(key) {
  let hash = 5381;
  const text = String(key || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return `k_${(hash >>> 0).toString(36)}`;
}

function winnerKeyId(p) {
  return keyIdFromKey(participantKey(p));
}

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cleanWinner(p, sourceIndex = -1) {
  const key = participantKey(p);
  return {
    name: String(p.name || '').trim(),
    dept: String(p.dept || p.department || '').trim(),
    phone: String(p.phone || '').trim(),
    code: String(p.code || p.staffId || '').trim(),
    table: String(p.table || '').trim(),
    seat: String(p.seat || '').trim(),
    sourceIndex,
    key,
    keyId: keyIdFromKey(key),
    time: Date.now()
  };
}

function normalizeBatch(entry = {}) {
  return {
    id: entry.id || '',
    mode: entry.mode || 'main',
    roundId: entry.roundId || 'main',
    roundName: entry.roundName || '',
    prizeId: entry.prizeId || '',
    prizeName: entry.prizeName || '',
    winners: Array.isArray(entry.winners) ? entry.winners : [],
    action: entry.action || 'draw',
    undone: entry.undone === true,
    undoneAt: Number(entry.undoneAt || 0),
    supersededBy: entry.supersededBy || '',
    createdAt: Number(entry.createdAt || 0)
  };
}

function objectValues(obj) {
  return obj && typeof obj === 'object' ? Object.values(obj) : [];
}

function withFirebaseTimeout(promise, label, ms = 15000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Firebase ${label} did not respond within ${Math.round(ms / 1000)}s.`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function remoteFirebaseUrl(path) {
  const base = CONFIG.firebaseBase.replace(/\/$/, '');
  const cleanPath = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
  return `${base}${cleanPath}.json`;
}

async function putJsonDirect(path, value, ms = 7000) {
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

async function retryFirebaseStep(fn) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await wait(350 + attempt * 700);
    }
  }
  throw lastError;
}

function optionalFirebaseRead(promise, label, fallback) {
  return withFirebaseTimeout(promise, label, 12000).catch(error => {
    console.warn(`[Lucky V2] optional ${label} failed`, error);
    return fallback;
  });
}

export function roundIdFor(name) {
  const clean = String(name || 'Extra Round').trim() || 'Extra Round';
  return `round_${keyIdFromKey(clean)}`;
}

export async function loadV2Context(eid, options = {}) {
  const requirePeople = options.requirePeople === true;
  const warnings = [];
  const optionalRead = async (promise, label, fallback) => {
    try {
      return await withFirebaseTimeout(promise, label, 12000);
    } catch (error) {
      console.warn(`[Lucky V2] optional ${label} failed`, error);
      warnings.push(error?.message || String(error));
      return fallback;
    }
  };
  const [eventInfo, people, prizes, curPrizeId, v2, assets] = await Promise.all([
    optionalRead(getEventInfo(eid), `event info read /events/${eid}/meta + /events/${eid}/info`, { meta: {}, info: {} }),
    requirePeople
      ? withFirebaseTimeout(getPeople(eid), `roster read /events/${eid}/people`)
      : optionalRead(getPeople(eid), `roster read /events/${eid}/people`, []),
    withFirebaseTimeout(getPrizes(eid), `prize read /events/${eid}/prizes`),
    optionalRead(getCurrentPrizeIdRemote(eid), `current prize read /events/${eid}/currentPrizeId`, null),
    withFirebaseTimeout(FB.get(v2Root(eid)), `Lucky V2 state read ${v2Root(eid)}`),
    optionalRead(getAssets(eid), `asset read /events/${eid}/logo/banner/background/photos`, {})
  ]);
  return {
    eventInfo,
    people: Array.isArray(people) ? people : [],
    prizes: Array.isArray(prizes) ? prizes : [],
    curPrizeId,
    v2: v2 || {},
    assets: assets || {},
    warnings
  };
}

async function loadDrawContext(eid, cachedContext) {
  if (!Array.isArray(cachedContext?.people) || !Array.isArray(cachedContext?.prizes)) {
    return loadV2Context(eid, { requirePeople: true });
  }
  // Attendance may have changed in the roster or another control page.
  const [people, v2] = await Promise.all([
    withFirebaseTimeout(getPeople(eid), `roster read /events/${eid}/people`),
    withFirebaseTimeout(FB.get(v2Root(eid)), `Lucky V2 state read ${v2Root(eid)}`)
  ]);
  return { ...cachedContext, people: Array.isArray(people) ? people : [], v2: v2 || {} };
}

export function allBatches(v2 = {}) {
  const main = objectValues(v2?.main?.batches).map(normalizeBatch);
  const reward = objectValues(v2?.rewardRounds).flatMap(round =>
    objectValues(round?.batches).map(normalizeBatch)
  );
  return main.concat(reward)
    .filter(b => b.id)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function activeBatches(v2 = {}) {
  return allBatches(v2).filter(b => !b.undone && !b.supersededBy);
}

export function recentBatches(v2 = {}, limit = 8) {
  return allBatches(v2).slice(0, limit);
}

function activeWinnerCountForPrize(v2, prizeId, mode, roundId) {
  return activeBatches(v2)
    .filter(b => b.prizeId === prizeId && b.mode === mode && (mode !== 'extra' || b.roundId === roundId))
    .reduce((sum, b) => sum + (b.winners || []).length, 0);
}

export function prizeAvailability(prize = {}, v2 = {}, mode = 'main', roundId = 'main') {
  const quota = Math.max(0, Number(prize?.quota || 0));
  const productionWon = Array.isArray(prize?.winners) ? prize.winners.length : 0;
  const v2Used = activeWinnerCountForPrize(v2, prize?.id || '', mode, roundId);
  return {
    quota,
    productionWon,
    v2Used,
    used: productionWon + v2Used,
    remaining: Math.max(0, quota - productionWon - v2Used)
  };
}

function originalWinnerKeyIds(prizes) {
  const keys = new Set();
  (prizes || []).forEach(prize => {
    (prize?.winners || []).forEach(w => keys.add(winnerKeyId(w)));
  });
  return keys;
}

function indexKeys(obj) {
  return new Set(Object.entries(obj || {}).filter(([, value]) => value === true).map(([key]) => key));
}

function checkedInPool(people) {
  return (people || [])
    .map((p, index) => ({ p, index }))
    .filter(({ p }) => p && p.checkedIn);
}

function candidateNames(pool) {
  return shuffle(pool)
    .slice(0, 42)
    .map(({ p }) => ({
      name: p.name || '',
      dept: p.dept || p.department || '',
      code: p.code || p.staffId || '',
      table: p.table || '',
      seat: p.seat || ''
    }))
    .filter(p => p.name);
}

function modeLabel(mode) {
  return mode === 'extra' ? 'Extra Round' : 'Main Draw';
}

function applyIndexPatch(patch, path, winners, value) {
  winners.forEach(w => {
    if (w?.keyId) patch[`${path}/${w.keyId}`] = value;
  });
}

async function publishStage(eid, state) {
  const path = `${v2Root(eid)}/ui/stageState`;
  const nextState = {
    ...state,
    updatedAt: Date.now()
  };
  await withFirebaseTimeout(retryFirebaseStep(() => (
    putJsonDirect(path, nextState).catch(() => FB.put(path, nextState))
  )), `stage-state write ${path}`, 22000);
  return nextState;
}

export async function setReady(eid, opts = {}) {
  const ctx = opts.context || await loadV2Context(eid);
  const prize = ctx.prizes.find(p => p.id === opts.prizeId) || ctx.prizes.find(p => p.id === ctx.curPrizeId) || ctx.prizes[0] || {};
  const mode = opts.mode || 'main';
  const roundName = mode === 'extra' ? (opts.roundName || 'Extra Round') : '';
  const roundId = mode === 'extra' ? roundIdFor(roundName) : 'main';
  const giftStats = prizeAvailability(prize, ctx.v2, mode, roundId);
  const stageState = await publishStage(eid, {
    status: 'ready',
    mode,
    phase: 'ready',
    roundId,
    roundName,
    currentPrizeId: prize.id || '',
    currentPrizeName: prize.name || '',
    prizeName: prize.name || '',
    giftStats,
    modeLabel: modeLabel(mode),
    winners: [],
    candidateNames: [],
    message: 'Ready'
  });
  return { prize, stageState };
}

export async function previewSpin(eid, opts = {}) {
  const ctx = await loadDrawContext(eid, opts.context);
  const mode = opts.mode === 'extra' ? 'extra' : 'main';
  const roundName = mode === 'extra' ? (opts.roundName || 'Extra Round') : '';
  const roundId = mode === 'extra' ? roundIdFor(roundName) : 'main';
  const prize = (ctx.prizes || []).find(p => p.id === opts.prizeId)
    || (ctx.prizes || []).find(p => p.id === ctx.curPrizeId)
    || (ctx.prizes || [])[0]
    || {};
  const giftStats = prize.id ? prizeAvailability(prize, ctx.v2 || {}, mode, roundId) : null;
  const batchSize = Math.max(1, Math.min(10, Number(opts.batchSize || 1)));
  const previous = opts.previousBatchId
    ? activeBatches(ctx.v2).find(b => b.id === opts.previousBatchId)
    : null;
  if (opts.previousBatchId && !previous) throw new Error('The V2 batch is no longer active. Refresh before redrawing.');
  const left = (previous && opts.redraw === true) ? batchSize : Number(giftStats?.remaining || 0);
  if (!prize.id) throw new Error('No prize is selected.');
  if (left <= 0) throw new Error('This V2 prize quota is already full.');

  const pool = buildPool({
    people: ctx.people,
    prizes: ctx.prizes,
    v2: ctx.v2,
    mode,
    ignoreBatchId: previous?.id || '',
    excludeKeyIds: new Set((previous?.winners || []).map(winnerKeyId))
  });
  if (!pool.length) throw new Error('No eligible checked-in participants for this V2 draw.');
  const candidates = candidateNames(pool);

  const stageState = await publishStage(eid, {
    status: 'spinning',
    phase: 'preview',
    drawId: makeId('preview'),
    mode,
    modeLabel: modeLabel(mode),
    roundId,
    roundName,
    currentPrizeId: prize.id || '',
    currentPrizeName: prize.name || '',
    prizeName: prize.name || 'Drawing',
    giftStats,
    batchSize,
    winners: [],
    candidateNames: candidates,
    message: 'Drawing...'
  });
  return { stageState };
}

function buildPool({ people, prizes, v2, mode, ignoreBatchId = '', excludeKeyIds = new Set() }) {
  const originalKeys = originalWinnerKeyIds(prizes);
  const mainKeys = indexKeys(v2?.main?.winnerKeys);
  const active = activeBatches(v2);
  const extraKeys = new Set();
  active
    .filter(batch => batch.mode === 'extra' && batch.id !== ignoreBatchId)
    .forEach(batch => {
      (batch.winners || []).forEach(winner => {
        if (winner?.keyId) extraKeys.add(winner.keyId);
      });
    });

  if (ignoreBatchId) {
    const ignored = active.find(b => b.id === ignoreBatchId);
    (ignored?.winners || []).forEach(w => {
      mainKeys.delete(w.keyId);
    });
  }

  return checkedInPool(people).filter(({ p }) => {
    const kid = winnerKeyId(p);
    if (excludeKeyIds.has(kid)) return false;
    if (mode === 'main') {
      if (originalKeys.has(kid)) return false;
      if (mainKeys.has(kid)) return false;
      return true;
    }
    if (extraKeys.has(kid)) return false;
    return true;
  });
}

export async function drawV2(eid, opts = {}) {
  const mode = opts.mode === 'extra' ? 'extra' : 'main';
  const roundName = mode === 'extra' ? (opts.roundName || 'Extra Round') : '';
  const roundId = mode === 'extra' ? roundIdFor(roundName) : 'main';
  const batchSize = Math.max(1, Math.min(10, Number(opts.batchSize || 1)));
  const ctx = await loadDrawContext(eid, opts.context);
  const prize = ctx.prizes.find(p => p.id === opts.prizeId) || ctx.prizes.find(p => p.id === ctx.curPrizeId) || ctx.prizes[0];
  if (!prize) throw new Error('No prize is selected.');

  const previous = opts.previousBatchId
    ? activeBatches(ctx.v2).find(b => b.id === opts.previousBatchId)
    : null;
  if (opts.previousBatchId && !previous) throw new Error('The V2 batch is no longer active. Refresh before redrawing.');
  const previousWinners = Array.isArray(previous?.winners) ? previous.winners : [];
  const replaceIndex = Number.isInteger(opts.replaceIndex) ? opts.replaceIndex : -1;
  const isReroll = previous && replaceIndex >= 0;
  const isRedraw = previous && opts.redraw === true;
  if (isReroll && !previousWinners[replaceIndex]) throw new Error('The selected winner slot no longer exists.');
  const removedWinners = isReroll ? [previousWinners[replaceIndex]] : (isRedraw ? previousWinners : []);

  const excludeKeyIds = new Set();
  if (isReroll || isRedraw) {
    previousWinners.forEach(w => {
      excludeKeyIds.add(winnerKeyId(w));
    });
  }

  const giftStatsBefore = prizeAvailability(prize, ctx.v2, mode, roundId);
  const left = (isReroll || isRedraw) ? batchSize : giftStatsBefore.remaining;
  if (left <= 0) throw new Error('This V2 prize quota is already full.');

  const pool = buildPool({
    people: ctx.people,
    prizes: ctx.prizes,
    v2: ctx.v2,
    mode,
    ignoreBatchId: previous?.id || '',
    excludeKeyIds
  });
  if (!pool.length) throw new Error('No eligible checked-in participants for this V2 draw.');

  const want = isReroll ? 1 : Math.min(batchSize, left, pool.length);
  const picks = shuffle(pool).slice(0, want).map(({ p, index }) => cleanWinner(p, index));
  const winners = isReroll
    ? previousWinners.map((w, idx) => (idx === replaceIndex ? picks[0] : w)).filter(Boolean)
    : picks;

  const drawId = makeId(isReroll ? 'reroll' : 'draw');
  const now = Date.now();
  const entry = {
    id: drawId,
    mode,
    roundId,
    roundName,
    prizeId: prize.id || '',
    prizeName: prize.name || '',
    batchSize: winners.length,
    winners,
    action: isReroll ? 'reroll' : (isRedraw ? 'redraw' : 'draw'),
    replacesBatchId: previous?.id || '',
    replacedIndex: isReroll ? replaceIndex : null,
    replacedWinner: isReroll ? previousWinners[replaceIndex] || null : null,
    createdAt: now
  };

  if (opts.skipSpinPublish !== true && opts.instant !== true) {
    await publishStage(eid, {
      status: 'spinning',
      phase: 'spinning',
      action: entry.action,
      drawId,
      mode,
      modeLabel: modeLabel(mode),
      roundId,
      roundName,
      replacedIndex: isReroll ? replaceIndex : null,
      currentPrizeId: prize.id || '',
      currentPrizeName: prize.name || '',
      prizeName: prize.name || '',
      giftStats: giftStatsBefore,
      batchSize: winners.length,
      winners: isReroll ? previousWinners : [],
      candidateNames: candidateNames(pool),
      message: 'Drawing...'
    });
  }

  if (opts.instant !== true) {
    const targetDelay = Math.max(900, Math.min(5200, Number(opts.revealDelay || 1960)));
    const elapsed = opts.spinStartedAt ? Math.max(0, Date.now() - Number(opts.spinStartedAt)) : 0;
    const delay = Math.max(350, targetDelay - elapsed);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  const patch = {};
  const batchPath = mode === 'extra'
    ? `rewardRounds/${roundId}/batches/${drawId}`
    : `main/batches/${drawId}`;
  const keyPath = mode === 'extra'
    ? `rewardRounds/${roundId}/winnerKeys`
    : 'main/winnerKeys';
  patch[batchPath] = entry;
  if (mode === 'extra') {
    patch[`rewardRounds/${roundId}/id`] = roundId;
    patch[`rewardRounds/${roundId}/name`] = roundName || 'Extra Round';
    patch[`rewardRounds/${roundId}/allowMainRoundWinners`] = true;
    patch[`rewardRounds/${roundId}/allowDuplicateWithinRound`] = false;
  }
  if (previous?.id) {
    const previousPath = previous.mode === 'extra'
      ? `rewardRounds/${previous.roundId}/batches/${previous.id}/supersededBy`
      : `main/batches/${previous.id}/supersededBy`;
    patch[previousPath] = drawId;
    const previousKeyPath = previous.mode === 'extra'
      ? `rewardRounds/${previous.roundId}/winnerKeys`
      : 'main/winnerKeys';
    applyIndexPatch(patch, previousKeyPath, previous.winners || [], null);
  }
  applyIndexPatch(patch, keyPath, winners, true);
  patch[`auditLog/${makeId('audit')}`] = {
    action: entry.action,
    drawId,
    previousDrawId: previous?.id || '',
    prizeId: prize.id || '',
    prizeName: prize.name || '',
    mode,
    roundId,
    time: now
  };
  patch['ui/lastBatchId'] = drawId;
  // Save the replacement and attendance together so removed winners cannot
  // return to any checked-in draw pool until they are checked in again.
  const eventPatch = Object.fromEntries(Object.entries(patch).map(([path, value]) => [`ui/luckyV2/${path}`, value]));
  const removedKeys = new Set(removedWinners.map(participantKey));
  const people = ctx.people.map((person, index) => {
    if (!person || !removedKeys.has(participantKey(person))) return person;
    eventPatch[`people/${index}/checkedIn`] = false;
    return { ...person, checkedIn: false };
  });
  await withFirebaseTimeout(FB.patch(`/events/${eid}`, eventPatch), `draw result and attendance write /events/${eid}`);

  const replacedCount = previous?.id ? previousWinners.length : 0;
  const v2UsedAfter = Math.max(0, giftStatsBefore.v2Used - replacedCount + winners.length);
  const usedAfter = giftStatsBefore.productionWon + v2UsedAfter;
  const giftStatsAfter = {
    ...giftStatsBefore,
    v2Used: v2UsedAfter,
    used: usedAfter,
    remaining: Math.max(0, giftStatsBefore.quota - usedAfter)
  };

  const stageState = await publishStage(eid, {
    status: 'revealed',
    phase: 'revealed',
    instant: opts.instant === true,
    action: entry.action,
    drawId,
    mode,
    modeLabel: modeLabel(mode),
    roundId,
    roundName,
    replacedIndex: isReroll ? replaceIndex : null,
    currentPrizeId: prize.id || '',
    currentPrizeName: prize.name || '',
    prizeName: prize.name || '',
    giftStats: giftStatsAfter,
    batchSize: winners.length,
    winners,
    candidateNames: [],
    message: 'Revealed'
  });

  return { entry, left: giftStatsAfter.remaining, stageState, v2Patch: patch, people };
}

export async function undoLastV2(eid) {
  const v2 = (await FB.get(v2Root(eid)).catch(() => ({}))) || {};
  const state = v2?.ui?.stageState || {};
  const drawId = state.drawId || v2?.ui?.lastBatchId || '';
  const batch = activeBatches(v2).find(b => b.id === drawId);
  if (!batch) throw new Error('No active V2 batch to undo.');
  const patch = {};
  const batchPath = batch.mode === 'extra'
    ? `rewardRounds/${batch.roundId}/batches/${batch.id}/undone`
    : `main/batches/${batch.id}/undone`;
  const keyPath = batch.mode === 'extra'
    ? `rewardRounds/${batch.roundId}/winnerKeys`
    : 'main/winnerKeys';
  const now = Date.now();
  patch[batchPath] = true;
  patch[batchPath.replace(/\/undone$/, '/undoneAt')] = now;
  applyIndexPatch(patch, keyPath, batch.winners || [], null);
  patch[`auditLog/${makeId('audit')}`] = {
    action: 'undo',
    drawId: batch.id,
    prizeId: batch.prizeId || '',
    prizeName: batch.prizeName || '',
    mode: batch.mode || 'main',
    roundId: batch.roundId || 'main',
    time: now
  };
  patch['ui/lastBatchId'] = null;
  await withFirebaseTimeout(FB.patch(v2Root(eid), patch), `undo write ${v2Root(eid)}`);
  const stageState = await publishStage(eid, {
    status: 'ready',
    phase: 'ready',
    mode: batch.mode,
    modeLabel: modeLabel(batch.mode),
    roundId: batch.roundId,
    roundName: batch.roundName,
    currentPrizeId: batch.prizeId,
    currentPrizeName: batch.prizeName,
    prizeName: batch.prizeName,
    giftStats: null,
    winners: [],
    candidateNames: [],
    message: 'Last V2 batch undone'
  });
  return { batch, stageState, v2Patch: patch };
}

export async function clearV2Stage(eid) {
  const stageState = await publishStage(eid, {
    status: 'clear',
    phase: 'clear',
    mode: 'main',
    modeLabel: 'V2',
    winners: [],
    candidateNames: [],
    message: 'Cleared'
  });
  return { stageState };
}

export async function getV2Summary(eid) {
  const ctx = await loadV2Context(eid);
  return {
    ...ctx,
    active: activeBatches(ctx.v2),
    recent: recentBatches(ctx.v2)
  };
}

export async function loadV2Assets(eid) {
  const [eventInfo, assets] = await Promise.all([
    getEventInfo(eid).catch(() => ({ meta: {}, info: {} })),
    getAssets(eid).catch(() => ({}))
  ]);
  const title = eventInfo?.info?.title || eventInfo?.meta?.name || 'Event';
  return { title, assets };
}

export function csvForBatches(batches, auditLog = {}) {
  const undoTimes = new Map();
  objectValues(auditLog).forEach(entry => {
    if (entry?.action !== 'undo' || !entry?.drawId) return;
    const time = Number(entry.time || 0);
    if (time > Number(undoTimes.get(entry.drawId) || 0)) undoTimes.set(entry.drawId, time);
  });
  const rows = [[
    'Mode', 'Round', 'Prize', 'Name', 'Department', 'Phone', 'Code',
    'Winner Time', 'Batch ID', 'Action', 'Status', 'Undo Time'
  ]];
  (batches || []).forEach(batch => {
    const status = batch.undone ? 'Undone' : (batch.supersededBy ? 'Replaced' : 'Active');
    const undoTime = Number(batch.undoneAt || undoTimes.get(batch.id) || 0);
    (batch.winners || []).forEach(w => {
      rows.push([
        batch.mode || '',
        batch.roundName || '',
        batch.prizeName || '',
        w.name || '',
        w.dept || '',
        w.phone || '',
        w.code || '',
        w.time ? new Date(w.time).toLocaleString() : '',
        batch.id || '',
        batch.action || 'draw',
        status,
        undoTime ? new Date(undoTime).toLocaleString() : ''
      ]);
    });
  });
  return "\ufeff" + rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
}
