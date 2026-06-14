// Public-side listener for /ui/stageState plus poll QR/results overlays.
import { FB } from './fb.js';
import { renderBatchGrid as renderBatchGridCore, fireConfettiAtCards } from './stage_draw_logic.js';
import { voteCountsFromPoll } from './polls_public_firebase.js';

function getEventId() {
  const u = new URL(location.href);
  return u.searchParams.get('event') || null;
}

const eid = getEventId();
if (!eid) {
  console.error('[public_stage_state] Missing ?event= in URL');
}

let lastWinnersKey = null;
let stageInitialized = false;
let resultsState = null;
let clickBound = false;
let lastQRKey = null;

function normalizeWinners(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.values(raw);
}

function voteLink(eid, pid) {
  const u = new URL(location.href);
  u.pathname = (u.pathname.replace(/[^/]+$/, '') || '/') + 'vote.html';
  u.search = `?event=${encodeURIComponent(eid)}&poll=${encodeURIComponent(pid)}`;
  return u.href;
}

async function renderPollQRInGrid(grid, eid, ui) {
  const pid = ui?.currentPollId || null;
  const show = ui?.showPollQR === true && pid;
  if (!show || !grid) return false;

  const poll = await FB.get(`/events/${eid}/polls/${pid}`).catch(() => null);
  const title = poll?.question || poll?.q || pid;
  const link = voteLink(eid, pid);

  grid.innerHTML = `
    <div class="qr-panel">
      <div class="qr-box-inline">
        <div class="qr-title">Voting: <span>${title}</span></div>
        <div id="publicPollQRCanvas"></div>
        <div class="qr-link">${link}</div>
      </div>
    </div>
  `;
  const canvas = document.getElementById('publicPollQRCanvas');
  if (canvas) {
    canvas.innerHTML = '';
    if (window.QRCode) {
      // eslint-disable-next-line no-undef
      new QRCode(canvas, { text: link, width: 300, height: 300, correctLevel: QRCode.CorrectLevel.M });
    }
  }
  return true;
}

function bindResultsAdvance(grid) {
  if (clickBound) return;
  clickBound = true;
  grid.addEventListener('click', advanceResults);
}

function advanceResults() {
  if (!resultsState || !resultsState.items?.length) return;
  const total = resultsState.items.length;
  const step = Math.min(total, (resultsState.step || 0) + 1);
  resultsState.step = step;
  const grid = document.getElementById('stageGrid');
  if (grid) renderResultsStep(grid);
}

function orderedPollItems(poll) {
  const votes = voteCountsFromPoll(poll || {});
  const items = (poll?.options || []).map((o, index) => ({
    id: o.id,
    text: o.text || '',
    count: Number(votes[o.id] || 0),
    originalIndex: index
  }));
  if (Array.isArray(poll?.resultOrder) && poll.resultOrder.length) {
    const order = new Map(poll.resultOrder.map((id, index) => [id, index]));
    items.sort((a, b) => (order.get(a.id) ?? a.originalIndex + 10000) - (order.get(b.id) ?? b.originalIndex + 10000));
  }
  const topCount = Math.max(0, ...items.map(item => item.count));
  return items.map(item => ({ ...item, isTop: topCount > 0 && item.count === topCount }));
}

function renderResultsStep(grid) {
  if (!resultsState || !grid) return;
  const { items, step, title, max } = resultsState;
  const idx = step - 1;
  const complete = idx >= items.length - 1;

  grid.innerHTML = `
    <div class="results-chart">
      <div class="results-inner">
        <div class="results-title">Voting: ${title}</div>
        <div class="results-bars">
          ${items.map((it, i) => `
            <div class="rBar ${i <= idx ? 'is-revealed' : ''} ${it.isTop && complete ? 'is-top' : ''}">
              <div class="crown">${it.isTop && complete ? 'TOP' : ''}</div>
              <div class="rFillWrap"><div class="rFill" data-target="${Math.max(6, Math.round((it.count / max) * 100))}"></div></div>
              <div class="rLabel" data-text="${it.text}"></div>
              <div class="rCount"></div>
            </div>
          `).join('')}
        </div>
        <div class="results-status">${complete ? 'Final result' : 'Click or press Next to reveal'}</div>
      </div>
    </div>
  `;

  Array.from(grid.querySelectorAll('.rBar')).forEach((bar, i) => {
    const fill = bar.querySelector('.rFill');
    const countEl = bar.querySelector('.rCount');
    const labelEl = bar.querySelector('.rLabel');
    const crown = bar.querySelector('.crown');
    const target = Number(fill?.dataset.target || 0);
    if (i <= idx) {
      if (fill) {
        fill.style.height = '0%';
        requestAnimationFrame(() => { fill.style.height = `${target}%`; });
      }
      if (labelEl) labelEl.textContent = labelEl.dataset.text || '';
      if (countEl) countEl.textContent = `${items[i].count} votes`;
      if (crown) crown.style.opacity = items[i].isTop && complete ? 1 : 0;
    } else {
      if (fill) fill.style.height = '0%';
      if (labelEl) labelEl.textContent = '';
      if (countEl) countEl.textContent = '';
      if (crown) crown.style.opacity = 0;
    }
  });
}

async function refreshStage(uiOverride) {
  if (!FB?.get || !eid) return;

  try {
    const ui = uiOverride !== undefined
      ? uiOverride
      : await FB.get(`/events/${eid}/ui`).catch(() => null);
    const state = ui?.stageState || null;
    const grid = document.getElementById('stageGrid');
    if (!grid) return;

    const resTrigger = ui?.pollResultsTrigger || null;
    const resStep = Number(ui?.pollResultsStep || 0);
    if (resTrigger && resultsState?.trigger !== resTrigger) {
      const pid = ui?.currentPollId || null;
      if (pid) {
        const poll = await FB.get(`/events/${eid}/polls/${pid}`).catch(() => null);
        const items = orderedPollItems(poll);
        const max = Math.max(1, ...items.map(item => item.count));
        resultsState = { trigger: resTrigger, items, title: poll?.question || poll?.q || pid, max, step: resStep };
        lastWinnersKey = null;
      }
    } else if (resTrigger && resultsState) {
      resultsState.step = resStep;
    } else if (!resTrigger) {
      resultsState = null;
    }

    if (resultsState) {
      document.body.classList.add('results-mode');
      document.body.classList.remove('qr-mode');
      renderResultsStep(grid);
      bindResultsAdvance(grid);
      return;
    }
    document.body.classList.remove('results-mode');

    const qrKey = ui?.showPollQR && ui?.currentPollId ? `${ui.currentPollId}` : null;
    if (qrKey && qrKey === lastQRKey) {
      document.body.classList.add('qr-mode');
      return;
    }
    if (qrKey) {
      grid.innerHTML = '';
      document.body.classList.add('qr-mode');
      const shown = await renderPollQRInGrid(grid, eid, ui || {});
      if (shown) {
        lastQRKey = qrKey;
        lastWinnersKey = null;
        return;
      }
    } else {
      document.body.classList.remove('qr-mode');
      lastQRKey = null;
    }

    if (!state || !state.winners) {
      grid.innerHTML = '';
      lastWinnersKey = null;
      stageInitialized = true;
      return;
    }

    const winnersArray = normalizeWinners(state.winners);
    const key = JSON.stringify(winnersArray.map(w => [w.name, w.dept, w.time]));

    if (!stageInitialized) {
      renderBatchGridCore(grid, winnersArray, 'public');
      lastWinnersKey = key;
      stageInitialized = true;
      return;
    }

    if (key === lastWinnersKey) {
      renderBatchGridCore(grid, winnersArray, 'public');
      return;
    }

    const skip = state?.skipCountdown === true || ui?.skipCountdown === true;
    lastWinnersKey = key;

    const overlay = document.getElementById('stageCountdown');
    if (overlay && !skip) {
      overlay.style.display = 'flex';
      overlay.textContent = '3';
      await new Promise(r => setTimeout(r, 600));
      overlay.textContent = '2';
      await new Promise(r => setTimeout(r, 600));
      overlay.textContent = '1';
      await new Promise(r => setTimeout(r, 600));
      overlay.style.display = 'none';
    }

    renderBatchGridCore(grid, winnersArray, 'public');
    fireConfettiAtCards(grid.querySelectorAll('.winner-card'));
    document.body.classList.remove('qr-mode');
    if (!resultsState) document.body.classList.remove('results-mode');
  } catch (e) {
    console.warn('[public_stage_state] refresh error', e);
  }
}

(async () => {
  await refreshStage();
  if (FB?.listen && eid) {
    FB.listen(`/events/${eid}/ui`, ui => refreshStage(ui), { fallbackMs: 5000 });
  }
})();
