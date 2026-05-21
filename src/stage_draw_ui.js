// stage_draw_ui.js (top)
import {
  getCurrentEventId, getEventInfo, getPrizes, getCurrentPrizeIdRemote, getPeople, getAssets
} from './core_firebase.js';

import {
  performDraw, rerollOne, clearScreenResults, exportCurrentWinners, drawState, undoLastDraw,
  renderBatchGrid as renderBatchGridCore,
  renderRerollLog as renderRerollLogCore,
  fitWinnerCardText,
  countdown321,
  fireConfettiAtCards
} from './stage_draw_logic.js';
import { bindStageGridDelegation } from './stage_draw_logic.js';
import { FB } from './fb.js';
import {
  getRewardRounds,
  getRewardRoundState,
  ensureSecondPrizeRound,
  addRewardRound,
  addRewardRoundPrize,
  setCurrentRewardSelection,
  drawRewardRoundPrize
} from './reward_rounds_firebase.js';

// remove: cellHTML(), renderBatchGrid(), renderRerollLog()


function el(id){ return document.getElementById(id); }

function rewardStatus(text, isError = false){
  const node = document.getElementById('stageRewardStatus');
  if (!node) return;
  node.textContent = text || '';
  node.style.color = isError ? '#ff5a67' : '';
}

function isRewardDrawMode(){
  return document.getElementById('stageDrawMode')?.value === 'reward';
}

async function renderStageRewardControls(){
  const eid = getCurrentEventId();
  const roundSelect = document.getElementById('stageRewardRoundSelect');
  const prizeSelect = document.getElementById('stageRewardPrizeSelect');
  if (!eid || !roundSelect || !prizeSelect) return;

  const [rounds, state] = await Promise.all([
    getRewardRounds(eid),
    getRewardRoundState(eid)
  ]);
  const entries = Object.entries(rounds || {}).map(([id, r]) => ({ id, ...(r || {}) }));
  const prevRound = roundSelect.value || state.currentRoundId || '';

  roundSelect.innerHTML = entries.length
    ? entries.map(r => `<option value="${r.id}">${r.name || r.id}</option>`).join('')
    : '<option value="">No extra rounds yet</option>';
  if (entries.some(r => r.id === prevRound)) roundSelect.value = prevRound;
  else if (state.currentRoundId && entries.some(r => r.id === state.currentRoundId)) roundSelect.value = state.currentRoundId;

  const selectedRound = entries.find(r => r.id === roundSelect.value);
  const prizes = Array.isArray(selectedRound?.prizes) ? selectedRound.prizes : [];
  const prevPrize = prizeSelect.value || state.currentPrizeId || '';
  prizeSelect.innerHTML = prizes.length
    ? prizes.map(p => `<option value="${p.id}">${p.no ? p.no + ' - ' : ''}${p.name || p.id}</option>`).join('')
    : '<option value="">No prizes in this round</option>';
  if (prizes.some(p => p.id === prevPrize)) prizeSelect.value = prevPrize;
  else if (state.currentPrizeId && prizes.some(p => p.id === state.currentPrizeId)) prizeSelect.value = state.currentPrizeId;

  await setCurrentRewardSelection(roundSelect.value || null, prizeSelect.value || null).catch(()=>{});
}

async function refreshRewardHUD(){
  const eid = getCurrentEventId();
  const roundId = document.getElementById('stageRewardRoundSelect')?.value || '';
  const prizeId = document.getElementById('stageRewardPrizeSelect')?.value || '';
  const prizeNameEl = document.getElementById('stagePrizeName');
  const prizeLeftEl = document.getElementById('stagePrizeLeft');
  if (!eid || !roundId || !prizeId) {
    if (prizeNameEl) prizeNameEl.textContent = '—';
    if (prizeLeftEl) prizeLeftEl.textContent = '—';
    return;
  }
  const rounds = await getRewardRounds(eid).catch(()=>({}));
  const round = rounds?.[roundId] || {};
  const prize = (round.prizes || []).find(p => p.id === prizeId);
  if (prizeNameEl) prizeNameEl.textContent = prize ? `${round.name || 'Reward'} - ${prize.name || ''}` : '—';
  if (prizeLeftEl) {
    const left = prize ? Math.max(0, Number(prize.quota || 0) - ((prize.winners || []).length)) : 0;
    prizeLeftEl.textContent = prize ? left : '—';
  }
}

function bindStageRewardControls(){
  const mode = document.getElementById('stageDrawMode');
  const controls = document.getElementById('stageRewardControls');
  if (mode && !mode.dataset.bound) {
    mode.dataset.bound = '1';
    mode.addEventListener('change', async ()=>{
      if (controls) controls.style.display = isRewardDrawMode() ? 'inline-flex' : 'none';
      if (isRewardDrawMode()) {
        await renderStageRewardControls();
        await refreshRewardHUD();
        rewardStatus('Extra reward draw mode is active.');
      } else {
        rewardStatus('');
      }
    });
  }
  if (controls) controls.style.display = isRewardDrawMode() ? 'inline-flex' : 'none';

  const bind = (id, fn) => {
    const node = document.getElementById(id);
    if (!node || node.dataset.bound) return;
    node.dataset.bound = '1';
    node.addEventListener('click', fn);
  };

  bind('stageEnsureSecondPrize', async ()=>{
    try{
      await ensureSecondPrizeRound(getCurrentEventId());
      rewardStatus('Second Prize round is ready.');
      await renderStageRewardControls();
      await refreshRewardHUD();
    }catch(e){
      rewardStatus(e?.message || 'Could not create Second Prize.', true);
    }
  });
  bind('stageAddRewardRound', async ()=>{
    try{
      const input = document.getElementById('stageRewardRoundName');
      let name = input?.value.trim();
      if (!name) {
        const rounds = await getRewardRounds(getCurrentEventId());
        const count = Object.keys(rounds || {}).length + 1;
        name = count === 1 ? 'Second Prize' : `Reward Round ${count}`;
      }
      await addRewardRound(name);
      if (input) input.value = '';
      rewardStatus(`Reward round added: ${name}`);
      await renderStageRewardControls();
    }catch(e){
      rewardStatus(e?.message || 'Could not add reward round.', true);
    }
  });
  bind('stageAddRewardPrize', async ()=>{
    try{
      const roundId = document.getElementById('stageRewardRoundSelect')?.value || '';
      const nameEl = document.getElementById('stageRewardPrizeName');
      const noEl = document.getElementById('stageRewardPrizeNo');
      const quotaEl = document.getElementById('stageRewardPrizeQuota');
      const name = nameEl?.value.trim();
      if (!roundId) return rewardStatus('Create or select a reward round first.', true);
      if (!name) return rewardStatus('Enter a reward prize name first.', true);
      await addRewardRoundPrize(roundId, {
        name,
        no: noEl?.value.trim() || '',
        quota: Math.max(1, Number(quotaEl?.value || 1))
      });
      if (nameEl) nameEl.value = '';
      if (noEl) noEl.value = '';
      if (quotaEl) quotaEl.value = '1';
      rewardStatus(`Reward prize added: ${name}`);
      await renderStageRewardControls();
      await refreshRewardHUD();
    }catch(e){
      rewardStatus(e?.message || 'Could not add reward prize.', true);
    }
  });

  ['stageRewardRoundSelect','stageRewardPrizeSelect'].forEach(id => {
    const node = document.getElementById(id);
    if (!node || node.dataset.changeBound) return;
    node.dataset.changeBound = '1';
    node.addEventListener('change', async ()=>{
      await setCurrentRewardSelection(
        document.getElementById('stageRewardRoundSelect')?.value || null,
        document.getElementById('stageRewardPrizeSelect')?.value || null
      );
      await renderStageRewardControls();
      await refreshRewardHUD();
    });
  });
}

// Grid cell HTML for a winner
function cellHTML(w, idx, mode){
  const name = w?.name||'', dept = w?.dept||'';
  const rerollBtn = (mode==='cms' || mode==='tablet') ? `<button class="btn small reroll" data-idx="${idx}">重抽</button>` : '';
  return `
  <div class="winner-card" data-idx="${idx}">
    <div class="name">${name}</div>
    <div class="dept">${dept}</div>
    ${rerollBtn}
  </div>`;
}
function showCountdown(){
  const el = document.getElementById('stageCountdown');
  if (el) el.classList.add('is-active');
}
function hideCountdown(){
  const el = document.getElementById('stageCountdown');
  if (el) {
    el.classList.remove('is-active');
    el.style.display = '';
  }
}

function renderBatchGrid(gridEl, batch, mode){
  if(!gridEl) return;
  const n = Math.max(1, Math.min(10, (batch||[]).length || 0));
  gridEl.className = `winners-grid winners-${n}`;
  gridEl.innerHTML = (batch||[]).map((w,i)=>cellHTML(w,i,mode)).join('');
}
async function renderRerollLog(){
  const panel = document.getElementById('rerollLogPanel');
  if (!panel) return;
  const eid = getCurrentEventId();
  if (!eid){ panel.innerHTML = ''; return; }
  const data = await FB.get(`/events/${eid}/rerollLog`);
  const list = Array.isArray(data) ? data : [];
  list.sort((a,b)=>(b.time||0)-(a.time||0));
  let html = '<table><thead><tr><th>時間</th><th>獎項</th><th>原得主</th><th>改為</th></tr></thead><tbody>';
  for (const row of list) {
    const t = row.time ? new Date(row.time).toLocaleString() : '';
    const ori = row.replaced ? `${row.replaced.name||''}（${row.replaced.dept||''}）` : '';
    const rep = row.replacement ? `${row.replacement.name||''}（${row.replacement.dept||''}）` : '<span style="opacity:.6">—</span>';
    html += `<tr><td>${t}</td><td>${row.prizeName||row.prizeId||''}</td><td>${ori}</td><td>${rep}</td></tr>`;
  }
  html += '</tbody></table>';
  panel.innerHTML = html;
}
export async function renderStageDraw(mode){
  const eid = getCurrentEventId();
  if(!eid) return;
  bindStageRewardControls();
  if (isRewardDrawMode()) {
    await renderStageRewardControls();
  }

  const logoEl      = document.getElementById('stageLogo');
  const bannerEl    = document.getElementById('stageBanner');
  const prizeNameEl = document.getElementById('stagePrizeName');
  const prizeLeftEl = document.getElementById('stagePrizeLeft');
  const gridEl      = document.getElementById('stageGrid');
  const overlayEl   = document.getElementById('stageCountdown');
  const totalLeftEl = document.getElementById('stageTotalLeft');
  const totalWonEl  = document.getElementById('stageTotalWon');
  if (overlayEl) overlayEl.classList.remove('is-active'); // start hidden

  const refreshCurrentPrizeHUD = async ()=>{
    try{
      if (isRewardDrawMode()) {
        await refreshRewardHUD();
        return;
      }
      const [prizesLatest, curIdLatest] = await Promise.all([
        getPrizes(eid),
        getCurrentPrizeIdRemote(eid)
      ]);
      const curPrize = (prizesLatest||[]).find(p=>p && p.id===curIdLatest) || null;
      if (prizeNameEl) prizeNameEl.textContent = curPrize?.name || '—';
      if (prizeLeftEl) {
        if (curPrize) {
          const leftNow = Math.max(0, Number(curPrize.quota||0) - (Array.isArray(curPrize.winners)?curPrize.winners.length:0));
          prizeLeftEl.textContent = leftNow;
        } else {
          prizeLeftEl.textContent = '—';
        }
      }
    }catch(_){}
  };

  // CMS: live-poll stageState so CMS updates when tablet/public draw
  if (mode === 'cms') {
    if (renderStageDraw._cmsTimer) clearInterval(renderStageDraw._cmsTimer);
    const poll = async ()=>{
      try{
        const state = await FB.get(`/events/${eid}/ui/stageState`).catch(()=>null);
        if (!state || !state.winners) return;
        const winnersArray = Array.isArray(state.winners) ? state.winners : Object.values(state.winners);
        renderBatchGridCore(document.getElementById('stageGrid'), winnersArray, 'cms');
        fitWinnerCardText(document.getElementById('stageGrid'), { nameMax: 140, deptMax: 70 });
        // keep 現正抽獎 + 此獎尚餘 in sync with tablet selection
        await refreshCurrentPrizeHUD();
      }catch(e){/*ignore*/}
    };
    renderStageDraw._cmsTimer = setInterval(poll, 1200);
    // Also poll current prize HUD in case there is no stageState update
    if (renderStageDraw._cmsPrizeTimer) clearInterval(renderStageDraw._cmsPrizeTimer);
    renderStageDraw._cmsPrizeTimer = setInterval(refreshCurrentPrizeHUD, 1500);
  }


  const [info, assets, prizes, curId] = await Promise.all([
    getEventInfo(eid).then(x=>x.info||{}),
    getAssets(eid).catch(() => ({ logo: '', banner: '', hideLogoOnDraws: false })),
    getPrizes(eid),
    getCurrentPrizeIdRemote(eid)
  ]);
  const cur = (prizes||[]).find(p=>p.id===curId);
  const giftName = cur?.name || '—';
  const left = (cur && typeof cur.quota==='number' && Array.isArray(cur.winners))
    ? Math.max(0, cur.quota - cur.winners.length) : 0;

  // HUD updates — these are the elements you actually have
  if (isRewardDrawMode()) {
    await refreshRewardHUD();
  } else {
    if (prizeNameEl) prizeNameEl.textContent = giftName;
    if (prizeLeftEl) prizeLeftEl.textContent = left;
  }

  // Logo/Banner are DIVs — set background or fallback text
  if (logoEl) {
    const logoSrc = assets.logo || info.logo || '';
    const hideLogo = assets.hideLogoOnDraws === true;
    logoEl.style.display = hideLogo ? 'none' : '';
    if (!hideLogo && logoSrc) { logoEl.style.backgroundImage = `url(${logoSrc})`; logoEl.style.backgroundSize='contain'; logoEl.style.backgroundRepeat='no-repeat'; logoEl.style.backgroundPosition='center'; logoEl.textContent=''; }
  }
  if (bannerEl) {
    const bannerSrc = assets.banner || info.banner || '';
    if (bannerSrc) { bannerEl.style.backgroundImage = `url(${bannerSrc})`; bannerEl.style.backgroundSize='cover'; bannerEl.style.backgroundRepeat='no-repeat'; bannerEl.style.backgroundPosition='center'; bannerEl.textContent=''; }
  }

  // Render any last batch already in memory (shared renderer)
  renderBatchGridCore(gridEl, drawState.lastBatch, mode);
  if (mode !== 'public') {
    const fitOpts = { nameMax: 140, deptMax: 70 };
    fitWinnerCardText(gridEl, fitOpts);
  }
  // bind reroll buttons for CMS/tablet
  if (mode === 'cms' || mode === 'tablet') {
    bindStageGridDelegation(mode);
  }

  // Totals updater
  const updateTotals = async () => {
    if (isRewardDrawMode()) {
      const rounds = await getRewardRounds(eid).catch(()=>({}));
      const roundId = document.getElementById('stageRewardRoundSelect')?.value || '';
      const prizeId = document.getElementById('stageRewardPrizeSelect')?.value || '';
      const round = rounds?.[roundId] || {};
      const prize = (round.prizes || []).find(p => p.id === prizeId);
      const used = prize ? ((prize.winners || []).length) : 0;
      const leftReward = prize ? Math.max(0, Number(prize.quota || 0) - used) : 0;
      if (totalLeftEl) totalLeftEl.textContent = leftReward;
      if (totalWonEl) totalWonEl.textContent = used;
      return;
    }
    const [peopleAll, prizesLatest] = await Promise.all([
      getPeople(eid),
      getPrizes(eid)
    ]);
    const presentCount = Array.isArray(peopleAll)
      ? peopleAll.filter(p => p && p.checkedIn).length
      : 0;
    const totalWon = Array.isArray(prizesLatest)
      ? prizesLatest.reduce((acc, p) => acc + ((p?.winners || []).length), 0)
      : 0;
    const totalLeft = Math.max(0, presentCount - totalWon);
    if (totalLeftEl) totalLeftEl.textContent = totalLeft;
    if (totalWonEl)  totalWonEl.textContent  = totalWon;
  };


// Batch buttons: set .active and read it later when rolling
const drawBtnsWrap = document.getElementById('drawBtns');
if (drawBtnsWrap) {
  const btns = Array.from(drawBtnsWrap.querySelectorAll('[data-batch]'));
  const setActive = (btn) => {
    btns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  };
  // default select 1 if nothing is active yet
  if (!drawBtnsWrap.querySelector('.active') && btns[0]) setActive(btns[0]);
  btns.forEach(b => b.addEventListener('click', () => setActive(b)));
}

  // Clear / Export
  const clearBtn  = document.getElementById('btnClearScreen');
  const exportBtn = document.getElementById('btnExportWinners');
if (clearBtn) {
   clearBtn.onclick = async () => {
     hideCountdown();
     await clearScreenResults(gridEl);
   };
 }  

if (exportBtn) exportBtn.onclick = ()=> exportCurrentWinners();

  const doRewardDraw = async (skipCountdown=false)=>{
    const active = document.querySelector('#drawBtns [data-batch].active');
    const n = active ? Number(active.getAttribute('data-batch')) : 1;
    const roundId = document.getElementById('stageRewardRoundSelect')?.value || '';
    const prizeId = document.getElementById('stageRewardPrizeSelect')?.value || '';
    if (!roundId || !prizeId) {
      rewardStatus('Select an extra round and prize first.', true);
      return;
    }
    hideCountdown();
    if (!skipCountdown) {
      showCountdown();
      await countdown321(overlayEl);
    }
    const res = await drawRewardRoundPrize(n, { skipCountdown });
    drawState.lastBatch = res.batch || [];
    renderBatchGridCore(gridEl, drawState.lastBatch, mode);
    if (mode !== 'public') {
      fitWinnerCardText(gridEl, { nameMax: 140, deptMax: 70 });
    }
    const cards = gridEl?.querySelectorAll('.winner-card');
    if (cards && cards.length) fireConfettiAtCards(cards);
    hideCountdown();
    rewardStatus(`Extra round draw complete: ${(res.batch || []).map(p=>p.name).join(', ')}`);
    await renderStageRewardControls();
    await refreshRewardHUD();
    await updateTotals();
  };

  // Roll using active batch size
  const rollBtn = document.getElementById('btnRollMain');
  const rollInstantBtn = document.getElementById('btnRollInstant');
  const undoBtn = document.getElementById('btnUndoDraw');
  if (rollBtn) {
    rollBtn.onclick = async ()=>{
  if (isRewardDrawMode()) {
    await doRewardDraw(false);
    return;
  }
  const active = document.querySelector('#drawBtns [data-batch].active');
  const n = active ? Number(active.getAttribute('data-batch')) : 1;

  // >>> show overlay while drawing
  showCountdown();

    await performDraw(n, {
    overlayEl,
    gridEl,
   afterRender: batch => {
    renderBatchGridCore(gridEl, batch, mode);
    if (mode !== 'public') {
      fitWinnerCardText(gridEl, { nameMax: 140, deptMax: 70 });
    }
   }
  });


  // >>> hide overlay once results are rendered
  hideCountdown();

  // refresh HUD & reroll log after a draw
  if (prizeLeftEl) {
    const latest = (await getPrizes(eid)).find(p=>p.id===curId);
    const left2 = latest ? Math.max(0, latest.quota - (latest.winners?.length||0)) : left;
    prizeLeftEl.textContent = left2;
  }
  await updateTotals();
  await renderRerollLogCore();
};

  }

  // Instant roll (skip countdown, keep confetti)
  if (rollInstantBtn) {
    rollInstantBtn.onclick = async ()=>{
      if (isRewardDrawMode()) {
        await doRewardDraw(true);
        return;
      }
      const active = document.querySelector('#drawBtns [data-batch].active');
      const n = active ? Number(active.getAttribute('data-batch')) : 1;

      hideCountdown(); // ensure overlay stays hidden for instant draws
      await performDraw(n, {
        overlayEl,
        gridEl,
        skipCountdown: true,
        afterRender: batch => {
          renderBatchGridCore(gridEl, batch, mode);
          if (mode !== 'public') {
            fitWinnerCardText(gridEl, { nameMax: 140, deptMax: 70 });
          }
        }
      });

      // refresh HUD & reroll log after a draw
      if (prizeLeftEl) {
        const latest = (await getPrizes(eid)).find(p=>p.id===curId);
        const left2 = latest ? Math.max(0, latest.quota - (latest.winners?.length||0)) : left;
        prizeLeftEl.textContent = left2;
      }
      await updateTotals();
      await renderRerollLogCore();
    };
  }

  if (undoBtn) {
    undoBtn.onclick = async ()=>{
      const ok = confirm('確定要復原上一次抽獎結果？此動作會移除剛抽出的得獎者。');
      if (!ok) return;
      try{
        await undoLastDraw();
        // refresh HUD
        const latest = (await getPrizes(eid)).find(p=>p.id===curId);
        const left2 = latest ? Math.max(0, latest.quota - (latest.winners?.length||0)) : left;
        if (prizeLeftEl) prizeLeftEl.textContent = left2;
        await updateTotals();
        await renderRerollLogCore();
        // clear grid display
        renderBatchGridCore(gridEl, [], mode);
      }catch(err){
        alert(err?.message || '無法復原抽獎');
      }
    };
  }

  // Re-fit text on resize
  window.addEventListener('resize', () => fitWinnerCardText(gridEl, { nameMax: 90, deptMax: 32 }), { passive: true });

  // initial totals
  await updateTotals();
  // immediate HUD sync for CMS if tablet switches prize without drawing
  if (mode === 'cms') await refreshCurrentPrizeHUD();
}
