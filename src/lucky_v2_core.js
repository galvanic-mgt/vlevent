import { FB } from './fb.js';
import {
  getPeople,
  getPrizes,
  getCurrentPrizeIdRemote,
  getEventInfo,
  getAssets,
  setCurrentEventId
} from './core_firebase.js';

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
    undone: entry.undone === true,
    supersededBy: entry.supersededBy || '',
    createdAt: Number(entry.createdAt || 0)
  };
}

function objectValues(obj) {
  return obj && typeof obj === 'object' ? Object.values(obj) : [];
}

export function roundIdFor(name) {
  const clean = String(name || 'Extra Round').trim() || 'Extra Round';
  return `round_${keyIdFromKey(clean)}`;
}

export async function loadV2Context(eid) {
  const [eventInfo, people, prizes, curPrizeId, v2, assets] = await Promise.all([
    getEventInfo(eid).catch(() => ({ meta: {}, info: {} })),
    getPeople(eid).catch(() => []),
    getPrizes(eid).catch(() => []),
    getCurrentPrizeIdRemote(eid).catch(() => null),
    FB.get(v2Root(eid)).catch(() => ({})),
    getAssets(eid).catch(() => ({}))
  ]);
  return {
    eventInfo,
    people: Array.isArray(people) ? people : [],
    prizes: Array.isArray(prizes) ? prizes : [],
    curPrizeId,
    v2: v2 || {},
    assets: assets || {}
  };
}

export function activeBatches(v2 = {}) {
  const main = objectValues(v2?.main?.batches).map(normalizeBatch);
  const reward = objectValues(v2?.rewardRounds).flatMap(round =>
    objectValues(round?.batches).map(normalizeBatch)
  );
  return main.concat(reward)
    .filter(b => b.id && !b.undone && !b.supersededBy)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function recentBatches(v2 = {}, limit = 8) {
  const main = objectValues(v2?.main?.batches).map(normalizeBatch);
  const reward = objectValues(v2?.rewardRounds).flatMap(round =>
    objectValues(round?.batches).map(normalizeBatch)
  );
  return main.concat(reward)
    .filter(b => b.id)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, limit);
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
    .map(({ p }) => ({ name: p.name || '', dept: p.dept || '' }))
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
  await FB.put(`${v2Root(eid)}/ui/stageState`, {
    ...state,
    updatedAt: Date.now()
  });
}

export async function setReady(eid, opts = {}) {
  const ctx = await loadV2Context(eid);
  const prize = ctx.prizes.find(p => p.id === opts.prizeId) || ctx.prizes.find(p => p.id === ctx.curPrizeId) || ctx.prizes[0] || {};
  const mode = opts.mode || 'main';
  const roundName = mode === 'extra' ? (opts.roundName || 'Extra Round') : '';
  const roundId = mode === 'extra' ? roundIdFor(roundName) : 'main';
  const giftStats = prizeAvailability(prize, ctx.v2, mode, roundId);
  await publishStage(eid, {
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
  return { prize };
}

function buildPool({ people, prizes, v2, mode, roundId, allowRepeat, ignoreBatchId = '', excludeKeyIds = new Set() }) {
  const originalKeys = originalWinnerKeyIds(prizes);
  const mainKeys = indexKeys(v2?.main?.winnerKeys);
  const roundKeys = indexKeys(v2?.rewardRounds?.[roundId]?.winnerKeys);

  if (ignoreBatchId) {
    const ignored = activeBatches(v2).find(b => b.id === ignoreBatchId);
    (ignored?.winners || []).forEach(w => {
      mainKeys.delete(w.keyId);
      roundKeys.delete(w.keyId);
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
    if (!allowRepeat && roundKeys.has(kid)) return false;
    return true;
  });
}

export async function drawV2(eid, opts = {}) {
  const mode = opts.mode === 'extra' ? 'extra' : 'main';
  const roundName = mode === 'extra' ? (opts.roundName || 'Extra Round') : '';
  const roundId = mode === 'extra' ? roundIdFor(roundName) : 'main';
  const batchSize = Math.max(1, Math.min(10, Number(opts.batchSize || 1)));
  const ctx = await loadV2Context(eid);
  const prize = ctx.prizes.find(p => p.id === opts.prizeId) || ctx.prizes.find(p => p.id === ctx.curPrizeId) || ctx.prizes[0];
  if (!prize) throw new Error('No prize is selected.');

  const previous = opts.previousBatchId
    ? activeBatches(ctx.v2).find(b => b.id === opts.previousBatchId)
    : null;
  const previousWinners = Array.isArray(previous?.winners) ? previous.winners : [];
  const replaceIndex = Number.isInteger(opts.replaceIndex) ? opts.replaceIndex : -1;
  const isReroll = previous && replaceIndex >= 0;
  const isRedraw = previous && opts.redraw === true;

  const excludeKeyIds = new Set();
  if (isReroll) {
    previousWinners.forEach((w, idx) => {
      if (idx !== replaceIndex && w?.keyId) excludeKeyIds.add(w.keyId);
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
    roundId,
    allowRepeat: opts.allowRepeat === true,
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

  await publishStage(eid, {
    status: 'spinning',
    phase: 'spinning',
    drawId,
    mode,
    modeLabel: modeLabel(mode),
    roundId,
    roundName,
    currentPrizeId: prize.id || '',
    currentPrizeName: prize.name || '',
    prizeName: prize.name || '',
    giftStats: giftStatsBefore,
    batchSize: winners.length,
    winners: [],
    candidateNames: candidateNames(pool),
    message: 'Drawing...'
  });

  const delay = opts.instant ? 450 : Math.max(1200, Math.min(5200, Number(opts.revealDelay || 2800)));
  await new Promise(resolve => setTimeout(resolve, delay));

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
    patch[`rewardRounds/${roundId}/allowDuplicateWithinRound`] = opts.allowRepeat === true;
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
  await FB.patch(v2Root(eid), patch);

  const replacedCount = previous?.id ? previousWinners.length : 0;
  const v2UsedAfter = Math.max(0, giftStatsBefore.v2Used - replacedCount + winners.length);
  const usedAfter = giftStatsBefore.productionWon + v2UsedAfter;
  const giftStatsAfter = {
    ...giftStatsBefore,
    v2Used: v2UsedAfter,
    used: usedAfter,
    remaining: Math.max(0, giftStatsBefore.quota - usedAfter)
  };

  await publishStage(eid, {
    status: 'revealed',
    phase: 'revealed',
    drawId,
    mode,
    modeLabel: modeLabel(mode),
    roundId,
    roundName,
    currentPrizeId: prize.id || '',
    currentPrizeName: prize.name || '',
    prizeName: prize.name || '',
    giftStats: giftStatsAfter,
    batchSize: winners.length,
    winners,
    candidateNames: [],
    message: 'Revealed'
  });

  return { entry, left: giftStatsAfter.remaining };
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
  patch[batchPath] = true;
  applyIndexPatch(patch, keyPath, batch.winners || [], null);
  patch[`auditLog/${makeId('audit')}`] = { action: 'undo', drawId: batch.id, time: Date.now() };
  patch['ui/lastBatchId'] = null;
  await FB.patch(v2Root(eid), patch);
  await publishStage(eid, {
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
  return batch;
}

export async function clearV2Stage(eid) {
  await publishStage(eid, {
    status: 'clear',
    phase: 'clear',
    mode: 'main',
    modeLabel: 'V2',
    winners: [],
    candidateNames: [],
    message: 'Cleared'
  });
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
  const [{ eventInfo, assets }] = await Promise.all([loadV2Context(eid)]);
  const title = eventInfo?.info?.title || eventInfo?.meta?.name || 'Event';
  return { title, assets };
}

export function csvForBatches(batches) {
  const rows = [['Mode', 'Round', 'Prize', 'Name', 'Department', 'Phone', 'Code', 'Time', 'Batch ID']];
  (batches || []).forEach(batch => {
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
        batch.id || ''
      ]);
    });
  });
  return rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
}
