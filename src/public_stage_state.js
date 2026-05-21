// Simple public-side listener for /ui/stageState
import { FB } from './fb.js';
import { renderBatchGrid as renderBatchGridCore, fireConfettiAtCards } from './stage_draw_logic.js';

function getEventId() {
  const u = new URL(location.href);
  return u.searchParams.get('event') || null;
}

const eid = getEventId();
if (!eid) {
  console.error('[public_stage_state] Missing ?event= in URL');
}

// track last batch so we can animate only on changes
let lastWinnersKey = null;
let resultsState = null; // {trigger, items, idx, title, max, step}
let clickBound = false;
let lastQRKey = null;

function normalizeWinners(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.values(raw);
}

async function renderPollQRInGrid(grid, eid, ui){
  const pid = ui && ui.currentPollId ? ui.currentPollId : null;
  const show = ui && ui.showPollQR === true && pid;
  if (!show || !grid) return false;

  const poll = await FB.get(`/events/${eid}/polls/${pid}`).catch(()=>null);
  const title = (poll && (poll.question || poll.q)) ? (poll.question || poll.q) : pid;

  const u = new URL(location.href);
  u.pathname = (u.pathname.replace(/[^/]+$/, '') || '/') + 'vote.html';
  u.search = `?event=${encodeURIComponent(eid)}&poll=${encodeURIComponent(pid)}`;
  const link = u.href;

  grid.innerHTML = `
    <div class="qr-panel">
      <div class="qr-box-inline">
        <div class="qr-title">現正投票：<span>${title}</span></div>
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

function bindResultsAdvance(grid){
  if (clickBound) return;
  clickBound = true;
  grid.addEventListener('click', advanceResults);
}

function advanceResults(){
  if (!resultsState || !resultsState.items?.length) return;
  const total = resultsState.items.length;
  const step = Math.min(total, (resultsState.step || 0) + 1);
  resultsState.step = step;
  resultsState.idx = step - 1;
  const grid = document.getElementById('stageGrid');
  if (grid) renderResultsStep(grid);
}

function renderResultsStep(grid){
  if (!resultsState || !grid) return;
  const { items, step, title, max } = resultsState;
  const idx = step - 1;
  grid.innerHTML = `
    <div class="results-chart">
      <div class="results-inner">
        <div class="results-title">現正投票：${title}</div>
        <div class="results-bars">
          ${items.map((it, i) => `
            <div class="rBar">
              <div class="crown">${i === items.length - 1 ? '👑' : ''}</div>
              <div class="rFillWrap"><div class="rFill" data-count="${it.count}" data-target="${Math.max(6, Math.round((it.count / max) * 100))}"></div></div>
              <div class="rLabel" data-text="${it.text}"></div>
              <div class="rCount"></div>
            </div>
          `).join('')}
        </div>
        <div class="results-status">點擊畫面播放下一個${idx >= items.length ? ' — 動畫完畢' : ''}</div>
      </div>
    </div>
  `;

  // animate revealed bars
  const bars = Array.from(grid.querySelectorAll('.rBar'));
  bars.forEach((bar, i) => {
    const fill = bar.querySelector('.rFill');
    const countEl = bar.querySelector('.rCount');
    const labelEl = bar.querySelector('.rLabel');
    const crown = bar.querySelector('.crown');
    const target = Number(fill?.dataset.target || 0);
    if (i <= idx) {
      if (fill) {
        fill.style.height = '0%';
        requestAnimationFrame(() => { fill.style.height = target + '%'; });
      }
      if (labelEl) labelEl.textContent = labelEl.dataset.text || '';
      if (countEl) countEl.textContent = `${items[i].count} 票`;
      if (crown) crown.style.opacity = i === items.length - 1 ? 1 : 0;
    } else {
      if (fill) fill.style.height = '0%';
      if (labelEl) labelEl.textContent = '';
      if (countEl) countEl.textContent = '';
      if (crown) crown.style.opacity = 0;
    }
  });
}

async function refreshStage() {
  if (!FB?.get || !eid) return;

  try {
    const ui = await FB.get(`/events/${eid}/ui`).catch(() => null);
    const state = ui && ui.stageState ? ui.stageState : null;

    const grid = document.getElementById('stageGrid');
    if (!grid) return;

    // Poll results mode (highest priority)
    const resTrigger = ui?.pollResultsTrigger || null;
    const resStep = Number(ui?.pollResultsStep || 0);
    if (resTrigger && resultsState?.trigger !== resTrigger) {
      const pid = ui?.currentPollId || null;
      if (pid) {
        const poll = await FB.get(`/events/${eid}/polls/${pid}`).catch(()=>null);
        const votes = poll?.votes || {};
        const items = (poll?.options || []).map(o => ({
          text: o.text || '',
          count: Number(votes[o.id] || 0)
        }));
        items.sort((a,b)=>a.count - b.count);
        const max = Math.max(1, ...items.map(i=>i.count));
        resultsState = { trigger: resTrigger, items, idx: -1, title: poll?.question || poll?.q || pid, max, step: resStep };
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
    } else {
      document.body.classList.remove('results-mode');
    }

    // Poll QR mode: render QR in grid and skip draw rendering
    const qrKey = (ui && ui.showPollQR && ui.currentPollId) ? `${ui.currentPollId}` : null;
    if (qrKey && qrKey === lastQRKey) {
      // already showing same QR; ensure mode class is set
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

    grid.innerHTML = '';

    if (!state || !state.winners) {
      // nothing drawn yet — keep grid empty
      grid.innerHTML = '';
      lastWinnersKey = null;
      return;
    }

    const winnersArray = normalizeWinners(state.winners);
    const key = JSON.stringify(winnersArray.map(w => [w.name, w.dept, w.time]));

    // first load: just render, no countdown
    if (lastWinnersKey === null) {
      renderBatchGridCore(grid, winnersArray, 'public');
      lastWinnersKey = key;
      return;
    }

    // no change: keep grid in sync but no animation
    if (key === lastWinnersKey) {
      renderBatchGridCore(grid, winnersArray, 'public');
      return;
    }

    const skip = (state && state.skipCountdown === true) || ui.skipCountdown === true;

    // new winners: animate (or skip) then render + confetti
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
    const cards = grid.querySelectorAll('.winner-card');
    fireConfettiAtCards(cards);

    // clear skip flag so subsequent draws animate unless requested again
    if (skip) {
      try { await FB.patch(`/events/${eid}/ui/stageState`, { skipCountdown: false }); } catch(_){}
      try { await FB.patch(`/events/${eid}/ui`, { skipCountdown: false }); } catch(_){}
    }

    // leaving draw mode, ensure mode classes are removed if not active
    document.body.classList.remove('qr-mode');
    if (!resultsState) document.body.classList.remove('results-mode');

  } catch (e) {
    console.warn('[public_stage_state] refresh error', e);
  }
}

// Initial + polling (simple & reliable)
refreshStage();
setInterval(refreshStage, 2000);
