import { FB } from './fb.js';
import { getCurrentEventId, getPeople, setPeople } from './core_firebase.js';

function makeId(prefix = 'r') {
  return prefix + Math.random().toString(36).slice(2, 8);
}

function winnerKey(p) {
  const phone = (p?.phone || '').trim();
  const name = (p?.name || '').trim();
  const dept = (p?.dept || '').trim();
  return phone ? `phone:${phone}` : `name:${name}||${dept}`;
}

function pickUnique(arr, n) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = (Math.random() * (i + 1)) | 0;
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function normalizePrize(prize = {}) {
  return {
    id: prize.id || makeId('rp'),
    no: prize.no || '',
    name: prize.name || 'Prize',
    quota: Math.max(0, Number(prize.quota || 1)) || 1,
    winners: Array.isArray(prize.winners) ? prize.winners : []
  };
}

function normalizeRound(round = {}) {
  const id = round.id || makeId('round');
  return {
    id,
    name: round.name || 'Reward Round',
    allowMainRoundWinners: round.allowMainRoundWinners !== false,
    allowDuplicateWithinRound: round.allowDuplicateWithinRound === true,
    prizes: Array.isArray(round.prizes) ? round.prizes.map(normalizePrize) : [],
    createdAt: round.createdAt || Date.now()
  };
}

export async function getRewardRounds(eid = getCurrentEventId()) {
  if (!eid) return {};
  const data = (await FB.get(`/events/${eid}/ui/rewardRounds`)) || {};
  if (data && data.error) throw new Error(data.error);
  return data || {};
}

export async function getRewardRoundState(eid = getCurrentEventId()) {
  if (!eid) return {};
  const data = (await FB.get(`/events/${eid}/ui/rewardRoundState`)) || {};
  if (data && data.error) throw new Error(data.error);
  return data || {};
}

function assertFirebaseOk(result) {
  if (result && result.error) throw new Error(result.error);
  return result;
}

export async function ensureSecondPrizeRound(eid = getCurrentEventId()) {
  if (!eid) throw new Error('Missing event');
  const rounds = await getRewardRounds(eid);
  if (rounds.secondPrize) return normalizeRound(rounds.secondPrize);
  const round = normalizeRound({
    id: 'secondPrize',
    name: 'Second Prize',
    allowMainRoundWinners: true,
    allowDuplicateWithinRound: false
  });
  assertFirebaseOk(await FB.put(`/events/${eid}/ui/rewardRounds/${round.id}`, round));
  assertFirebaseOk(await FB.patch(`/events/${eid}/ui/rewardRoundState`, { currentRoundId: round.id }));
  return round;
}

export async function addRewardRound(name) {
  const eid = getCurrentEventId();
  if (!eid) throw new Error('Missing event');
  const id = makeId('round');
  const round = normalizeRound({
    id,
    name: name || 'Reward Round',
    allowMainRoundWinners: true,
    allowDuplicateWithinRound: false
  });
  assertFirebaseOk(await FB.put(`/events/${eid}/ui/rewardRounds/${id}`, round));
  assertFirebaseOk(await FB.patch(`/events/${eid}/ui/rewardRoundState`, { currentRoundId: id, currentPrizeId: null }));
  return round;
}

export async function updateRewardRound(roundId, patch = {}) {
  const eid = getCurrentEventId();
  if (!eid || !roundId) throw new Error('Missing round');
  assertFirebaseOk(await FB.patch(`/events/${eid}/ui/rewardRounds/${roundId}`, patch));
}

export async function addRewardRoundPrize(roundId, partial = {}) {
  const eid = getCurrentEventId();
  if (!eid || !roundId) throw new Error('Missing round');
  const rawRound = await FB.get(`/events/${eid}/ui/rewardRounds/${roundId}`);
  if (rawRound && rawRound.error) throw new Error(rawRound.error);
  const round = normalizeRound(rawRound);
  const prize = normalizePrize(partial);
  round.prizes.push(prize);
  assertFirebaseOk(await FB.put(`/events/${eid}/ui/rewardRounds/${roundId}`, round));
  assertFirebaseOk(await FB.patch(`/events/${eid}/ui/rewardRoundState`, { currentRoundId: roundId, currentPrizeId: prize.id }));
  return prize;
}

export async function setCurrentRewardSelection(roundId, prizeId) {
  const eid = getCurrentEventId();
  if (!eid) throw new Error('Missing event');
  assertFirebaseOk(await FB.patch(`/events/${eid}/ui/rewardRoundState`, {
    currentRoundId: roundId || null,
    currentPrizeId: prizeId || null
  }));
}

export async function drawRewardRoundPrize(batchSize = 1, opts = {}) {
  const eid = getCurrentEventId();
  if (!eid) throw new Error('Missing event');

  const [rounds, state, people] = await Promise.all([
    getRewardRounds(eid),
    getRewardRoundState(eid),
    getPeople(eid)
  ]);

  const roundId = state.currentRoundId;
  const prizeId = state.currentPrizeId;
  if (!roundId || !rounds[roundId]) throw new Error('Select a reward round first');
  const round = normalizeRound(rounds[roundId]);
  const prize = round.prizes.find(p => p.id === prizeId);
  if (!prize) throw new Error('Select a reward prize first');

  const left = Math.max(0, Number(prize.quota || 0) - (prize.winners || []).length);
  if (left <= 0) throw new Error('This reward prize has no quota left');

  const winnersInRound = new Set(
    round.prizes.flatMap(p => (p.winners || []).map(winnerKey))
  );
  const pool = (Array.isArray(people) ? people : []).filter(p => {
    if (!p || !p.checkedIn) return false;
    if (!round.allowMainRoundWinners && p.prize) return false;
    if (!round.allowDuplicateWithinRound && winnersInRound.has(winnerKey(p))) return false;
    return true;
  });
  if (!pool.length) throw new Error('No eligible people remain for this reward round');

  const want = Math.max(1, Math.min(Number(batchSize) || 1, 10, left, pool.length));
  const picks = pickUnique(pool, want);
  const now = Date.now();

  prize.winners = Array.isArray(prize.winners) ? prize.winners : [];
  picks.forEach(w => {
    prize.winners.push({
      name: w.name || '',
      dept: w.dept || '',
      phone: w.phone || '',
      code: w.code || '',
      time: now
    });
  });

  const pickKeys = new Set(picks.map(winnerKey));
  const peopleUpdated = people.map(p => {
    if (!pickKeys.has(winnerKey(p))) return p;
    return {
      ...p,
      rewardRounds: {
        ...(p.rewardRounds || {}),
        [round.id]: prize.name || ''
      }
    };
  });

  assertFirebaseOk(await FB.put(`/events/${eid}/ui/rewardRounds/${round.id}`, round));
  await setPeople(eid, peopleUpdated);
  assertFirebaseOk(await FB.patch(`/events/${eid}/ui`, {
    stageState: {
      mode: 'reward',
      currentRoundId: round.id,
      currentRoundName: round.name,
      currentPrizeId: prize.id,
      currentPrizeName: prize.name,
      currentBatch: Number(batchSize) || 1,
      skipCountdown: opts.skipCountdown === true || undefined,
      winners: picks.map(w => ({
        name: w.name,
        dept: w.dept || '',
        time: now
      }))
    },
    skipCountdown: opts.skipCountdown === true || undefined,
    rewardRoundState: {
      roundId: round.id,
      roundName: round.name,
      prizeId: prize.id,
      prizeName: prize.name,
      winners: picks.map(w => ({ name: w.name || '', dept: w.dept || '', time: now })),
      updatedAt: now
    }
  }));

  return { round, prize, batch: picks };
}
