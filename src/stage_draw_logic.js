// src/stage_draw_logic.js  — full file

// --- Firebase REST helper (you already have this) ---
import { FB } from './fb.js';

// Simple array-based reroll log (writes under /events/{eid}/rerollLog)
async function addRerollLog(eid, entry){
  // entry: {prizeId, prizeName, replaced:{name,dept}, replacement:{name,dept}}
  const path = `/events/${eid}/rerollLog`;
  const list = (await FB.get(path)) || [];
  list.push({ time: Date.now(), ...entry });
  await FB.put(path, list);
  return true;
}

async function fetchRerollLog(eid, limit=50){
  const path = `/events/${eid}/rerollLog`;
  const data = await FB.get(path);
  const list = Array.isArray(data) ? data : [];
  list.sort((a,b)=>(b.time||0)-(a.time||0));
  return list.slice(0, limit);
}

// --- Data helpers you already use ---
import {
  getCurrentEventId, getEventInfo, getPrizes, getCurrentPrizeIdRemote,
  setCurrentPrizeIdRemote, setPrizes, getPeople, setPeople
} from './core_firebase.js';

// draw core (persists winners + people)
import { drawBatch as coreDrawBatch } from './stage_prizes_firebase.js';

// --- UI state (not saved) ---
export const drawState = {
  lastBatch: [],   // winners from the last draw
  animating: false
};

function winnerKey(p){
  const name  = (p?.name  || '').trim();
  const dept  = (p?.dept  || '').trim();
  const phone = (p?.phone || '').trim();
  return phone ? `phone:${phone}` : `name:${name}||${dept}`;
}

// --- Helpers ---
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

export async function countdown321(overlayEl){
  if(!overlayEl) return;
  overlayEl.style.display = 'flex';
  overlayEl.textContent = '3'; await sleep(600);
  overlayEl.textContent = '2'; await sleep(600);
  overlayEl.textContent = '1'; await sleep(600);
  overlayEl.style.display = 'none';
}

export function fireConfettiAtCards(cards){  // cards: NodeListOf<HTMLElement>
  if(typeof confetti !== 'function') return; // only if the lib is present
  cards.forEach((card)=>{
    const r = card.getBoundingClientRect();
    const cx = r.left + r.width/2;
    const cy = r.top + r.height/2;
    confetti({
      origin: { x: cx / window.innerWidth, y: cy / window.innerHeight },
      particleCount: 80, spread: 60, startVelocity: 45, ticks: 200
    });
  });
}

export function fitSingleLine(el, { max = 120, min = 24, horizPadding = 24 } = {}) {
  if (!el || !el.parentElement) return;
  // start big
  let size = max;
  el.style.setProperty('--tmpSize', size + 'px');
  el.style.fontSize = 'var(--tmpSize)';

  // available width inside the card (minus padding)
  const card = el.closest('.winner-card');
  const avail = Math.max(0, (card.clientWidth || 0) - horizPadding * 2);

  // shrink until it fits one line
  while (size > min && el.scrollWidth > avail) {
    size -= 1;
    el.style.setProperty('--tmpSize', size + 'px');
  }
  // freeze to CSS var the rest of your CSS uses
  el.style.removeProperty('font-size'); // stop using --tmpSize directly
  if (el.classList.contains('name')) {
    card.style.setProperty('--nameSize', size + 'px');
  } else {
    card.style.setProperty('--deptSize', size + 'px');
  }
}

export function fitWinnerCardText(root, opts = {}) {
  const nameMax = typeof opts.nameMax === 'number' ? opts.nameMax : 120;
  const deptMax = typeof opts.deptMax === 'number' ? opts.deptMax : 40;
  const cards = root ? root.querySelectorAll('.winner-card') : [];
  cards.forEach(card => {
    fitSingleLine(card.querySelector('.name'), { max: nameMax, min: 28, horizPadding: 24 });
    fitSingleLine(card.querySelector('.dept'), { max: deptMax, min: 16, horizPadding: 24 });
  });
}

/* ============================================================
   Winners grid renderer — matches your wireframes exactly
   - Single winner: one big centered card
   - Many winners: responsive grid, each card has a bottom-right reroll btn
============================================================ */
export function renderBatchGrid(gridEl, batch, mode){
  if (!gridEl) return;
  gridEl.innerHTML = '';

  const count = Math.max(0, Array.isArray(batch) ? batch.length : 0);
  const capped = Math.min(10, Math.max(1, count || 1));

  // apply winners-N class for layout (1–10)
  const prev = Array.from(gridEl.classList).filter(c => /^winners-\d+$/.test(c));
  prev.forEach(c => gridEl.classList.remove(c));
  gridEl.classList.add(`winners-${capped}`);

  const single = capped === 1;
  if (single) {
    gridEl.style.gridTemplateColumns = '1fr';
    gridEl.style.placeItems = 'center';
  } else {
    gridEl.style.removeProperty('grid-template-columns');
    gridEl.style.placeItems = 'stretch';
  }

  (batch || []).forEach((w, idx) => {
    const card = document.createElement('div');
    card.className = 'winner-card';
    card.innerHTML = `
      <div class="name">${w?.name || ''}</div>
      <div class="dept">${w?.dept || ''}</div>
      ${ (mode === 'cms' || mode === 'tablet')
          ? `<button class="btn-reroll" data-idx="${idx}">Reroll btn</button>`
          : '' }
    `;
    gridEl.appendChild(card);
  });

  // Fit text to each card after render (tighter caps for CMS)
  const fitOpts = (mode === 'cms' || mode === 'tablet') ? { nameMax: 140, deptMax: 70 } : {};
  fitWinnerCardText(gridEl, fitOpts);
}

/* ============================================================
   Reroll log renderer (panel under canvas with id="rerollLogPanel")
============================================================ */
export async function renderRerollLog(){
  const panel = document.getElementById('rerollLogPanel');
  if(!panel) return;
  const eid = getCurrentEventId();
  if(!eid){ panel.innerHTML=''; return; }

  const list = await fetchRerollLog(eid, 50);

  let html = '<table><thead><tr><th>時間</th><th>獎項</th><th>原得主</th><th>改為</th></tr></thead><tbody>';
  for(const row of (list||[])){
    const t = row.time ? new Date(row.time).toLocaleString() : '';
    const ori = row.replaced ? `${row.replaced.name||''}（${row.replaced.dept||''}）` : '';
    const rep = row.replacement ? `${row.replacement.name||''}（${row.replacement.dept||''}）` : '<span style="opacity:.6">—</span>';
    html += `<tr><td>${t}</td><td>${row.prizeName||row.prizeId||''}</td><td>${ori}</td><td>${rep}</td></tr>`;
  }
  html += '</tbody></table>';
  panel.innerHTML = html;
}

/* ============================================================
   Grid click delegation — reroll only the clicked slot
   Call once after the CMS page mounts
============================================================ */
let _gridBoundMode = null;
export function bindStageGridDelegation(mode='cms'){
  const gridEl = document.getElementById('stageGrid');
  if (!gridEl) return;
  if (_gridBoundMode === mode) return;

  gridEl.addEventListener('click', async (ev) => {
    const b = ev.target.closest('.btn-reroll');
    if (!b) return;
    const idx = Number(b.getAttribute('data-idx'));
    try {
      const replacement = await rerollOne(idx, {
        afterRender: (list) => renderBatchGrid(gridEl, list, mode),
        overlayEl: document.getElementById('stageCountdown'),
        gridEl
      });
      await renderRerollLog();
    } catch (e) {
      console.error('[rerollOne] failed', e);
    }
  });

  _gridBoundMode = mode;
}

/* ============================================================
   Draw batch (1–10). Saves to DB via coreDrawBatch.
============================================================ */
export async function performDraw(batchSize, hooks){
  const { overlayEl, gridEl, afterRender, skipCountdown } = hooks || {};
  if(drawState.animating) return;
  drawState.animating = true;

  try{
    if (skipCountdown && typeof window !== 'undefined') {
      window.__skipCountdownFlag = true;
    }
    if (!skipCountdown) {
      await countdown321(overlayEl);
    }


    const { batch } = await coreDrawBatch(
      Math.min(10, Math.max(1, Number(batchSize)||1))
    );
    drawState.lastBatch = batch || [];

    // render grid now
    if (typeof afterRender === 'function') {
      afterRender(drawState.lastBatch);
    } else if (gridEl) {
      renderBatchGrid(gridEl, drawState.lastBatch, 'cms');
    }

    // confetti from the winners’ cards
    const cards = gridEl?.querySelectorAll('.winner-card');
    if(cards && cards.length) fireConfettiAtCards(cards);
  } finally {
    drawState.animating = false;
  }
}

/* ============================================================
   Reroll a single slot (only that person):
   - remove winner at slotIndex from prize.winners
   - clear that person’s people[].prize if it matched
   - draw exactly ONE replacement (coreDrawBatch(1))
   - log to /rerollLog
   - replace ONLY that card in the grid/UI
============================================================ */
export async function rerollOne(slotIndex, hooks){
  const eid = getCurrentEventId();
  if (!eid) throw new Error('尚未選擇活動');

  const prizes = await getPrizes(eid);
  const curId = await getCurrentPrizeIdRemote(eid);
  const cur = (prizes || []).find(p => p && p.id === curId);
  if (!cur || !Array.isArray(cur.winners) || !cur.winners[slotIndex]) return;

  // Try to map the clicked slot to the actual winners array using lastBatch
  let targetIdx = -1;
  const target = Array.isArray(drawState.lastBatch) ? drawState.lastBatch[slotIndex] : null;
  if (target) {
    // prefer the last occurrence (most recent) to avoid touching older duplicates
    for (let i = cur.winners.length - 1; i >= 0; i--) {
      const w = cur.winners[i];
      if (winnerKey(w) === winnerKey(target)) {
        targetIdx = i;
        break;
      }
    }
  }
  if (targetIdx < 0) {
    // fallback to the slot index if mapping failed
    targetIdx = slotIndex;
  }
  if (!cur.winners[targetIdx]) return;

  // Remove that exact winner and persist
  const removed = cur.winners.splice(targetIdx, 1)[0];
  await setPrizes(eid, prizes);

  // Clear their people[].prize if it matched current prize
  const people = await getPeople(eid);
  let changed = false;
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    if (
      p &&
      p.name === removed.name &&
      (p.dept || '') === (removed.dept || '') &&
      (p.prize || '') === (cur.name || '')
    ) {
      people[i] = { ...p, prize: '' };
      changed = true;
    }
  }
  if (changed) await setPeople(eid, people);

  // Draw exactly ONE replacement and persist via core
  const excludeKey = winnerKey(removed);
  const res = await coreDrawBatch(1, { excludeKeys: [excludeKey] });   // avoid picking the same person
  const replacement = (res && res.batch && res.batch[0]) ? res.batch[0] : null;

  // Log reroll (best-effort)
  try {
    await addRerollLog(eid, {
      prizeId: cur.id,
      prizeName: cur.name || '',
      replaced:   { name: removed.name, dept: removed.dept || '', phone: removed.phone || '' },
      replacement: replacement ? { name: replacement.name, dept: replacement.dept || '', phone: replacement.phone || '' } : null
    });
  } catch (e) {
    console.warn('[reroll] log failed', e);
  }

  // Update only this slot in the UI state and re-render
  drawState.lastBatch = Array.isArray(drawState.lastBatch) ? drawState.lastBatch : [];
  drawState.lastBatch[slotIndex] = replacement;

  const { afterRender, gridEl } = hooks || {};
  if (typeof afterRender === 'function') {
    afterRender(drawState.lastBatch);
  } else if (gridEl) {
    renderBatchGrid(gridEl, drawState.lastBatch, 'cms');
  }

  return replacement;
}

// --- Clear only the screen batch (keep DB winners) ---
export async function clearScreenResults(gridEl){
  drawState.lastBatch = [];
  if(gridEl) gridEl.innerHTML = '';
  try {
    const eid = getCurrentEventId();
    if (eid && FB?.patch) {
      await FB.patch(`/events/${eid}/ui/stageState`, null);
      await FB.patch(`/events/${eid}/ui`, { skipCountdown: false });
    }
  } catch (e) {
    console.warn('[clearScreenResults] failed to clear public state', e);
  }
}

// --- Undo the most recent draw batch (remove winners + clear their prize) ---
export async function undoLastDraw(){
  const batch = Array.isArray(drawState.lastBatch) ? drawState.lastBatch : [];
  if (!batch.length) throw new Error('目前沒有可以復原的抽獎');

  const eid = getCurrentEventId();
  if (!eid) throw new Error('尚未選擇活動');

  const [people, prizes, curId] = await Promise.all([
    getPeople(eid),
    getPrizes(eid),
    getCurrentPrizeIdRemote(eid)
  ]);
  const cur = (prizes || []).find(p => p && p.id === curId);
  if (!cur) throw new Error('尚未選擇抽獎項目');

  const keys = new Set(batch.map(w => winnerKey(w)));

  // Remove those winners from current prize
  const before = Array.isArray(cur.winners) ? cur.winners.length : 0;
  cur.winners = (cur.winners || []).filter(w => !keys.has(winnerKey(w)));
  const removed = before - cur.winners.length;
  await setPrizes(eid, prizes);

  // Clear prize on people for those winners (only if it matches this prize)
  const prizeName = cur.name || '';
  const peopleUpdated = (people || []).map(p => {
    if (!p) return p;
    const k = winnerKey(p);
    if (keys.has(k) && (p.prize || '') === prizeName) {
      return { ...p, prize: '' };
    }
    return p;
  });
  await setPeople(eid, peopleUpdated);

  drawState.lastBatch = [];
  return { removed };
}

// --- Export current prize winners as CSV ---
export async function exportCurrentWinners(){
  const eid = getCurrentEventId();
  const [info, prizes, curId] = await Promise.all([
    getEventInfo(eid).then(x=>x.info||{}),
    getPrizes(eid),
    getCurrentPrizeIdRemote(eid)
  ]);
  const cur = (prizes||[]).find(p=>p.id===curId);
  const rows = [['Name','Department','Prize','Time']];
  (cur?.winners||[]).forEach(w=>{
    rows.push([w.name||'', w.dept||'', cur?.name||'', w.time? new Date(w.time).toLocaleString() : '']);
  });
  const csv = rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8;'}));
  a.download = `winners_${cur?.id||'current'}.csv`;
  a.click();
}

/* Optional: auto-bind grid delegation once if the element already exists.
   If you prefer explicit control, call bindStageGridDelegation('cms') from your CMS boot. */
if (document.getElementById('stageGrid')) {
  bindStageGridDelegation('cms');
}
