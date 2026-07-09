import { FB } from './fb.js?v=20260706b';
import {
  initEventFromUrl,
  getV2Summary,
  setReady,
  previewSpin,
  drawV2,
  undoLastV2,
  clearV2Stage,
  csvForBatches,
  activeBatches,
  prizeAvailability,
  roundIdFor,
  v2Root
} from './lucky_v2_core.js?v=20260709a';
import { applyV2Assets, renderV2Stage } from './lucky_v2_stage.js?v=20260709a';

const eid = initEventFromUrl();
let selectedSlot = -1;
let busy = false;
let lastState = null;
let lastSummary = null;

const $ = id => document.getElementById(id);

function status(text, isError = false) {
  const el = $('v2Status');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? '#ff7b86' : '';
}

function withTimeout(promise, label, ms = 18000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not respond within ${Math.round(ms / 1000)}s. The control page is waiting for that Firebase/local-server step, so check that specific connection/path and try again.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function publicUrl() {
  if (location.protocol === 'file:') {
    const url = new URL('http://127.0.0.1:8000/lucky_v2_public.html');
    if (eid) url.searchParams.set('event', eid);
    return url.href;
  }
  const url = new URL('./lucky_v2_public.html', location.href);
  if (eid) url.searchParams.set('event', eid);
  return url.href;
}

async function showLuckyDrawScene(message = 'Lucky Draw V2 scene') {
  const path = `/events/${eid}/ui/publicScreen`;
  await withTimeout(FB.put(path, {
    mode: 'v2Draw',
    kind: 'luckyDraw',
    message,
    updatedAt: Date.now()
  }), `public-screen write ${path}`, 12000);
}

function modeOptions() {
  const mode = $('v2Mode')?.value === 'extra' ? 'extra' : 'main';
  return {
    mode,
    prizeId: $('v2Prize')?.value || '',
    batchSize: Number($('v2Batch')?.value || 1),
    roundName: mode === 'extra' ? ($('v2RoundName')?.value || 'Extra Round') : '',
    allowRepeat: $('v2AllowRepeat')?.checked === true
  };
}

function setBusy(value) {
  busy = value;
  document.querySelectorAll('.v2-btn').forEach(btn => {
    btn.disabled = value;
    btn.style.opacity = value ? '.62' : '';
  });
}

function renderPrizeOptions(summary) {
  const sel = $('v2Prize');
  if (!sel) return;
  const opts = modeOptions();
  const roundId = opts.mode === 'extra' ? roundIdFor(opts.roundName) : 'main';
  const current = sel.value || summary.curPrizeId || '';
  sel.innerHTML = '';
  (summary.prizes || []).forEach(prize => {
    const stats = prizeAvailability(prize, summary.v2, opts.mode, roundId);
    const opt = document.createElement('option');
    opt.value = prize.id || '';
    opt.textContent = `${prize.no ? prize.no + ' - ' : ''}${prize.name || prize.id || 'Prize'} - available ${stats.remaining}/${stats.quota}`;
    if (prize.id === current) opt.selected = true;
    sel.append(opt);
  });
  if (!sel.value && summary.prizes?.[0]) sel.value = summary.prizes[0].id || '';
}

function renderGiftStats(summary) {
  const host = $('v2GiftStats');
  if (!host || !summary) return;
  const opts = modeOptions();
  const roundId = opts.mode === 'extra' ? roundIdFor(opts.roundName) : 'main';
  const prize = (summary.prizes || []).find(p => p.id === opts.prizeId) || summary.prizes?.[0];
  if (!prize) {
    host.innerHTML = '<div class="muted">No prize selected.</div>';
    return;
  }
  const stats = prizeAvailability(prize, summary.v2, opts.mode, roundId);
  const cells = [
    ['Available', stats.remaining],
    ['Quota', stats.quota],
    ['Old draw used', stats.productionWon],
    ['V2 active', stats.v2Used]
  ];
  host.innerHTML = '';
  cells.forEach(([label, value]) => {
    const div = document.createElement('div');
    div.className = 'v2-gift-stat';
    div.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
    host.append(div);
  });
}

function renderHistory(summary) {
  const host = $('v2History');
  if (!host) return;
  const recent = summary.recent || [];
  if (!recent.length) {
    host.textContent = 'No V2 test draws saved yet.';
    return;
  }
  const table = document.createElement('table');
  table.className = 'v2-history';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Time</th><th>Mode</th><th>Prize</th><th>Winners</th><th>Status</th></tr>';
  const tbody = document.createElement('tbody');
  recent.forEach(batch => {
    const tr = document.createElement('tr');
    const time = batch.createdAt ? new Date(batch.createdAt).toLocaleTimeString() : '';
    const names = (batch.winners || []).map(w => w.name).filter(Boolean).join(', ');
    const state = batch.undone ? 'Undone' : (batch.supersededBy ? 'Replaced' : 'Active');
    [time, batch.mode, batch.prizeName, names, state].forEach(text => {
      const td = document.createElement('td');
      td.textContent = text || '';
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(thead, tbody);
  host.innerHTML = '';
  host.append(table);
}

async function refreshAll({ keepPrize = true } = {}) {
  if (!eid) {
    status('Missing event ID.', true);
    return;
  }
  const summary = await withTimeout(getV2Summary(eid), 'Lucky Draw V2 loading');
  const assetInfo = {
    title: summary.eventInfo?.info?.title || summary.eventInfo?.meta?.name || 'Event',
    assets: summary.assets || {}
  };
  lastSummary = summary;
  applyV2Assets(assetInfo);
  if (!keepPrize) renderPrizeOptions(summary);
  else if (!$('v2Prize')?.options?.length) renderPrizeOptions(summary);
  renderGiftStats(summary);
  renderHistory(summary);
  const state = summary.v2?.ui?.stageState || { status: 'clear', message: 'V2 control ready' };
  lastState = state;
  renderV2Stage(state);
  const warningText = Array.isArray(summary.warnings) && summary.warnings.length
    ? ` Warning: ${summary.warnings.join(' | ')}`
    : '';
  status(`Ready. Checked-in roster: ${(summary.people || []).filter(p => p?.checkedIn).length}. Active V2 batches: ${(summary.active || []).length}.${warningText}`, Boolean(warningText));
}

async function runAction(label, fn) {
  if (busy) return;
  try {
    setBusy(true);
    status(`${label}...`);
    await withTimeout(fn(), `${label} action`, 26000);
    await withTimeout(refreshAll(), `${label} refresh`, 18000);
    status(`${label} complete.`);
  } catch (error) {
    console.error(`[Lucky V2] ${label} failed`, error);
    status(`${label} failed: ${error?.message || String(error)}`, true);
  } finally {
    setBusy(false);
  }
}

function selectedBatchId() {
  return lastState?.drawId || lastSummary?.v2?.ui?.lastBatchId || '';
}

function downloadCsv() {
  const summary = lastSummary;
  if (!summary) return;
  const csv = csvForBatches(activeBatches(summary.v2));
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = `lucky_v2_${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function bindControls() {
  const link = $('v2PublicLink');
  if (link) {
    link.href = publicUrl();
    link.textContent = publicUrl();
  }
  $('v2OpenPublic')?.addEventListener('click', () => window.open(publicUrl(), '_blank'));
  $('v2CopyPublic')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(publicUrl()).catch(() => {});
    status('Public link copied.');
  });
  $('v2ShowScene')?.addEventListener('click', () => runAction('Show lucky draw scene', async () => {
    await showLuckyDrawScene();
  }));
  $('v2ShowReady')?.addEventListener('click', () => runAction('Show ready', async () => {
    await showLuckyDrawScene('Lucky Draw ready');
    await setReady(eid, { ...modeOptions(), context: lastSummary });
  }));
  $('v2Draw')?.addEventListener('click', () => runAction('Start draw', async () => {
    await previewSpin(eid, { ...modeOptions(), context: lastSummary });
    await showLuckyDrawScene('Lucky Draw drawing');
    await drawV2(eid, { ...modeOptions(), revealDelay: 2200 });
  }));
  $('v2Instant')?.addEventListener('click', () => runAction('Instant draw', async () => {
    await previewSpin(eid, { ...modeOptions(), context: lastSummary });
    await showLuckyDrawScene('Lucky Draw instant drawing');
    await drawV2(eid, { ...modeOptions(), instant: true });
  }));
  $('v2Redraw')?.addEventListener('click', () => runAction('Redraw batch', async () => {
    const id = selectedBatchId();
    if (!id) throw new Error('No revealed V2 batch to redraw.');
    await previewSpin(eid, { ...modeOptions(), context: lastSummary, previousBatchId: id, redraw: true });
    await showLuckyDrawScene('Lucky Draw redraw');
    await drawV2(eid, { ...modeOptions(), previousBatchId: id, redraw: true, revealDelay: 1300 });
  }));
  $('v2Reroll')?.addEventListener('click', () => runAction('Reroll selected', async () => {
    const id = selectedBatchId();
    if (!id) throw new Error('No revealed V2 batch to reroll.');
    if (selectedSlot < 0) throw new Error('Select a winner slot first.');
    await showLuckyDrawScene('Lucky Draw reroll');
    await drawV2(eid, { ...modeOptions(), previousBatchId: id, replaceIndex: selectedSlot, revealDelay: 1100 });
    selectedSlot = -1;
  }));
  $('v2Undo')?.addEventListener('click', () => runAction('Undo last', async () => {
    await undoLastV2(eid);
    selectedSlot = -1;
  }));
  $('v2Clear')?.addEventListener('click', () => runAction('Clear public', async () => {
    await showLuckyDrawScene('Lucky Draw cleared');
    await clearV2Stage(eid);
    selectedSlot = -1;
  }));
  $('v2Export')?.addEventListener('click', downloadCsv);

  $('v2Machine')?.addEventListener('click', event => {
    const slot = event.target.closest('.v2-slot');
    if (!slot) return;
    selectedSlot = Number(slot.dataset.index || -1);
    document.querySelectorAll('.v2-slot').forEach(el => {
      el.style.outline = '';
      el.style.outlineOffset = '';
    });
    slot.style.outline = '3px solid #20d3c2';
    slot.style.outlineOffset = '3px';
    status(`Selected slot ${selectedSlot + 1} for reroll.`);
  });

  $('v2Mode')?.addEventListener('change', () => {
    const extra = $('v2Mode')?.value === 'extra';
    if ($('v2RoundName')) $('v2RoundName').disabled = !extra;
    if ($('v2AllowRepeat')) $('v2AllowRepeat').disabled = !extra;
    if (lastSummary) {
      renderPrizeOptions(lastSummary);
      renderGiftStats(lastSummary);
    }
  });
  $('v2Prize')?.addEventListener('change', () => {
    if (lastSummary) renderGiftStats(lastSummary);
  });
  $('v2RoundName')?.addEventListener('input', () => {
    if (lastSummary) {
      renderPrizeOptions(lastSummary);
      renderGiftStats(lastSummary);
    }
  });
}

async function boot() {
  bindControls();
  if ($('v2Mode')) $('v2Mode').dispatchEvent(new Event('change'));
  try {
    await refreshAll({ keepPrize: false });
  } catch (error) {
    console.error('[Lucky V2] initial load failed', error);
    status(`Loading failed: ${error?.message || String(error)}`, true);
  }
  FB.listen?.(`${v2Root(eid)}/ui/stageState`, state => {
    lastState = state || {};
    renderV2Stage(lastState);
  }, { fallbackMs: 3000, transport: 'poll' });
}

boot();
