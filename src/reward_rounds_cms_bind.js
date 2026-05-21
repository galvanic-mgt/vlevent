import { getCurrentEventId } from './core_firebase.js';
import {
  getRewardRounds,
  getRewardRoundState,
  ensureSecondPrizeRound,
  addRewardRound,
  addRewardRoundPrize,
  setCurrentRewardSelection,
  drawRewardRoundPrize,
  updateRewardRound
} from './reward_rounds_firebase.js';

function $(id) {
  return document.getElementById(id);
}

function status(text, isError = false) {
  const el = $('rewardRoundStatus');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? '#ff5a67' : '';
}

async function render() {
  const eid = getCurrentEventId();
  if (!eid || !$('rewardRoundPanel')) return;

  const [rounds, state] = await Promise.all([
    getRewardRounds(eid),
    getRewardRoundState(eid)
  ]);
  const entries = Object.entries(rounds || {}).map(([id, r]) => ({ id, ...(r || {}) }));
  const roundSelect = $('rewardRoundSelect');
  const prizeSelect = $('rewardPrizeSelect');
  const rows = $('rewardRoundRows');
  if (!roundSelect || !prizeSelect || !rows) return;

  const previousRound = roundSelect.value || state.currentRoundId || '';
  roundSelect.innerHTML = entries.length
    ? entries.map(round => `<option value="${round.id}">${round.name || round.id}</option>`).join('')
    : '<option value="">No extra rounds yet</option>';
  if (entries.some(round => round.id === previousRound)) {
    roundSelect.value = previousRound;
  } else if (state.currentRoundId && entries.some(round => round.id === state.currentRoundId)) {
    roundSelect.value = state.currentRoundId;
  }

  const selectedRound = entries.find(round => round.id === roundSelect.value);
  if ($('rewardAllowMainWinners')) $('rewardAllowMainWinners').checked = selectedRound?.allowMainRoundWinners !== false;
  if ($('rewardAllowDuplicateWithinRound')) $('rewardAllowDuplicateWithinRound').checked = selectedRound?.allowDuplicateWithinRound === true;

  const prizes = Array.isArray(selectedRound?.prizes) ? selectedRound.prizes : [];
  const previousPrize = prizeSelect.value || state.currentPrizeId || '';
  prizeSelect.innerHTML = prizes.length
    ? prizes.map(prize => `<option value="${prize.id}">${prize.no ? prize.no + ' - ' : ''}${prize.name || prize.id}</option>`).join('')
    : '<option value="">No prizes in this round</option>';
  if (prizes.some(prize => prize.id === previousPrize)) {
    prizeSelect.value = previousPrize;
  } else if (state.currentPrizeId && prizes.some(prize => prize.id === state.currentPrizeId)) {
    prizeSelect.value = state.currentPrizeId;
  }

  rows.innerHTML = entries.length ? entries.flatMap(round => {
    const roundPrizes = Array.isArray(round.prizes) ? round.prizes : [];
    if (!roundPrizes.length) return [`<tr><td>${round.name || round.id}</td><td colspan="5" class="muted">No prizes yet</td></tr>`];
    return roundPrizes.map(prize => {
      const winners = Array.isArray(prize.winners) ? prize.winners : [];
      return `<tr>
        <td>${round.name || round.id}</td>
        <td>${prize.no || ''}</td>
        <td>${prize.name || ''}</td>
        <td>${prize.quota || 0}</td>
        <td>${winners.length}</td>
        <td>${winners.map(w => w.name || '').filter(Boolean).join(', ')}</td>
      </tr>`;
    });
  }).join('') : '<tr><td colspan="6" class="muted">No extra reward rounds yet.</td></tr>';
}

function bindOnce(id, event, fn) {
  const el = $(id);
  if (!el || el.dataset.rewardBound === '1') return;
  el.dataset.rewardBound = '1';
  el.addEventListener(event, fn);
}

function bind() {
  bindOnce('btnEnsureSecondPrize', 'click', async () => {
    try {
      await ensureSecondPrizeRound(getCurrentEventId());
      status('Second Prize round is ready.');
      await render();
    } catch (e) {
      console.error('[reward round binder] second prize failed', e);
      status(e?.message || 'Could not create Second Prize round.', true);
    }
  });

  bindOnce('btnAddRewardRound', 'click', async () => {
    const nameEl = $('newRewardRoundName');
    let name = nameEl?.value.trim();
    try {
      if (!name) {
        const rounds = await getRewardRounds(getCurrentEventId());
        const count = Object.keys(rounds || {}).length + 1;
        name = count === 1 ? 'Second Prize' : `Reward Round ${count}`;
      }
      await addRewardRound(name);
      if (nameEl) nameEl.value = '';
      status(`Reward round added: ${name}`);
      await render();
    } catch (e) {
      console.error('[reward round binder] add round failed', e);
      status(e?.message || 'Could not add reward round.', true);
    }
  });

  bindOnce('rewardRoundSelect', 'change', async (ev) => {
    await setCurrentRewardSelection(ev.target.value, null);
    await render();
  });

  bindOnce('rewardPrizeSelect', 'change', async (ev) => {
    await setCurrentRewardSelection($('rewardRoundSelect')?.value || '', ev.target.value);
    await render();
  });

  bindOnce('rewardAllowMainWinners', 'change', async (ev) => {
    const roundId = $('rewardRoundSelect')?.value || '';
    if (!roundId) return;
    await updateRewardRound(roundId, { allowMainRoundWinners: ev.target.checked });
    await render();
  });

  bindOnce('rewardAllowDuplicateWithinRound', 'change', async (ev) => {
    const roundId = $('rewardRoundSelect')?.value || '';
    if (!roundId) return;
    await updateRewardRound(roundId, { allowDuplicateWithinRound: ev.target.checked });
    await render();
  });

  bindOnce('btnAddRewardPrize', 'click', async () => {
    let roundId = $('rewardRoundSelect')?.value || '';
    const name = $('newRewardPrizeName')?.value.trim();
    const no = $('newRewardPrizeNo')?.value.trim();
    const quota = Math.max(1, Number($('newRewardPrizeQuota')?.value || 1));
    if (!name) return status('Enter a reward prize name first.', true);
    try {
      if (!roundId) {
        const round = await ensureSecondPrizeRound(getCurrentEventId());
        roundId = round.id;
        await render();
        if ($('rewardRoundSelect')) $('rewardRoundSelect').value = roundId;
        status('Second Prize round created. Adding prize...');
      }
      await addRewardRoundPrize(roundId, { name, no, quota });
      $('newRewardPrizeName').value = '';
      $('newRewardPrizeNo').value = '';
      $('newRewardPrizeQuota').value = '1';
      status(`Reward prize added: ${name}`);
      await render();
    } catch (e) {
      console.error('[reward round binder] add prize failed', e);
      status(e?.message || 'Could not add reward prize.', true);
    }
  });

  bindOnce('btnDrawRewardRound', 'click', async () => {
    const roundId = $('rewardRoundSelect')?.value || '';
    const prizeId = $('rewardPrizeSelect')?.value || '';
    const batchSize = Number($('rewardBatchSize')?.value || 1);
    if (!roundId || !prizeId) return status('Select a round and prize first.', true);
    try {
      await setCurrentRewardSelection(roundId, prizeId);
      const res = await drawRewardRoundPrize(batchSize);
      status(`Draw complete: ${(res.batch || []).map(p => p.name).join(', ')}`);
      await render();
    } catch (e) {
      console.error('[reward round binder] draw failed', e);
      status(e?.message || 'Could not draw reward round.', true);
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  bind();
  await render().catch(e => console.warn('[reward round binder] initial render failed', e));
  setTimeout(() => render().catch(() => {}), 800);
  setTimeout(() => render().catch(() => {}), 1800);
});

window.addEventListener('focus', () => {
  render().catch(() => {});
});
