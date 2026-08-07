import { FB } from './fb.js?v=20260706b';
import { CONFIG } from './config.js';
import {
  initEventFromUrl,
  getV2Summary,
  loadV2Assets,
  setReady,
  previewSpin,
  drawV2,
  undoLastV2,
  clearV2Stage,
  csvForBatches,
  allBatches,
  activeBatches,
  recentBatches,
  prizeAvailability,
  roundIdFor,
  v2Root
} from './lucky_v2_core.js?v=20260731a';
import { applyV2Assets, renderV2Stage } from './lucky_v2_stage.js?v=20260714a';

const eid = initEventFromUrl();
let selectedSlot = -1;
let busy = false;
let lastState = null;
let lastSummary = null;
let quietRefreshTimer = null;
let actionRevision = 0;

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

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    // Fall through to the legacy copy path for restricted browser contexts.
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;left:-9999px;opacity:0;pointer-events:none';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (_) {
    copied = false;
  }
  area.remove();
  return copied;
}

async function showLuckyDrawScene(message = 'Lucky Draw V2 scene') {
  const path = `/events/${eid}/ui/publicScreen`;
  const state = {
    mode: 'v2Draw',
    kind: 'luckyDraw',
    message,
    updatedAt: Date.now()
  };
  await withTimeout(retryFirebaseStep(() => (
    putJsonDirect(path, state).catch(() => FB.put(path, state))
  )), `public-screen write ${path}`, 22000);
  return state;
}

function modeOptions() {
  const mode = $('v2Mode')?.value === 'extra' ? 'extra' : 'main';
  return {
    mode,
    prizeId: $('v2Prize')?.value || '',
    batchSize: Number($('v2Batch')?.value || 1),
    roundName: mode === 'extra' ? ($('v2RoundName')?.value || 'Extra Round') : ''
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

function cloneJson(value, fallback = {}) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function applyRelativePatch(root, patch = {}) {
  const next = cloneJson(root || {}, {});
  Object.entries(patch).forEach(([path, value]) => {
    const parts = String(path || '').split('/').filter(Boolean);
    if (!parts.length) return;
    let node = next;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const key = parts[i];
      if (!node[key] || typeof node[key] !== 'object') node[key] = {};
      node = node[key];
    }
    const key = parts[parts.length - 1];
    if (value === null) delete node[key];
    else node[key] = cloneJson(value, value);
  });
  return next;
}

function applyActionResult(result) {
  if (!lastSummary || (!result?.stageState && !result?.v2Patch)) return;
  let nextV2 = result.v2Patch
    ? applyRelativePatch(lastSummary.v2, result.v2Patch)
    : lastSummary.v2 || {};
  if (result.stageState) {
    nextV2 = applyRelativePatch(nextV2, { 'ui/stageState': result.stageState });
    lastState = result.stageState;
  }
  lastSummary = {
    ...lastSummary,
    v2: nextV2,
    curPrizeId: result.stageState?.currentPrizeId || lastSummary.curPrizeId,
    active: activeBatches(nextV2),
    recent: recentBatches(nextV2)
  };
  renderGiftStats(lastSummary);
  renderHistory(lastSummary);
  if (lastState) renderV2Stage(lastState);
}

async function refreshRuntimeState({ silent = false, expectedRevision = null } = {}) {
  if (!eid || !lastSummary) return;
  const [v2, curPrizeId] = await Promise.all([
    withTimeout(FB.get(v2Root(eid)), `Lucky V2 state refresh ${v2Root(eid)}`, 12000),
    withTimeout(FB.get(`/events/${eid}/currentPrizeId`).catch(() => lastSummary.curPrizeId), `current prize refresh /events/${eid}/currentPrizeId`, 8000)
  ]);
  if (expectedRevision !== null && expectedRevision !== actionRevision) return false;
  lastSummary = {
    ...lastSummary,
    v2: v2 || {},
    curPrizeId: curPrizeId || lastSummary.curPrizeId,
    active: activeBatches(v2 || {}),
    recent: recentBatches(v2 || {})
  };
  const state = lastSummary.v2?.ui?.stageState || lastState || { status: 'clear', message: 'V2 control ready' };
  lastState = state;
  renderGiftStats(lastSummary);
  renderHistory(lastSummary);
  renderV2Stage(state);
  if (!silent) {
    status(`Ready. Cached checked-in roster: ${(lastSummary.people || []).filter(p => p?.checkedIn).length}. Active V2 batches: ${(lastSummary.active || []).length}.`);
  }
  return true;
}

async function refreshRosterPrizeCacheQuiet() {
  if (!eid || busy) return;
  const revision = actionRevision;
  try {
    const summary = await withTimeout(getV2Summary(eid), 'Quiet roster/prize cache refresh', 18000);
    if (busy || revision !== actionRevision) return;
    lastSummary = summary;
    if (!$('v2Prize')?.matches(':focus')) renderPrizeOptions(summary);
    renderGiftStats(summary);
    renderHistory(summary);
    if (lastState) renderV2Stage(lastState);
    status(`Ready. Cache quietly refreshed. Checked-in roster: ${(summary.people || []).filter(p => p?.checkedIn).length}. Active V2 batches: ${(summary.active || []).length}.`);
  } catch (error) {
    console.warn('[Lucky V2] quiet cache refresh failed', error);
  }
}

async function refreshV2Assets() {
  if (!eid) return;
  const assetInfo = await withTimeout(loadV2Assets(eid), 'Lucky Draw V2 asset refresh', 12000);
  applyV2Assets(assetInfo);
  if (lastState) renderV2Stage(lastState);
}

async function runAction(label, fn) {
  if (busy) return;
  const revision = ++actionRevision;
  try {
    setBusy(true);
    status(`${label}...`);
    const result = await withTimeout(fn(), `${label} action`, 26000);
    applyActionResult(result);
    status(`${label} complete.`);
    refreshRuntimeState({ silent: true, expectedRevision: revision }).catch(error => {
      if (revision === actionRevision) {
        console.warn(`[Lucky V2] ${label} background verification failed`, error);
      }
    });
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
  const batches = allBatches(summary.v2);
  const csv = csvForBatches(batches, summary.v2?.auditLog);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const objectUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `lucky_v2_${stamp}.csv`;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  status(`CSV export started. ${batches.length} batches included, including undone and replaced records.`);
}

function bindControls() {
  const link = $('v2PublicLink');
  if (link) {
    link.href = publicUrl();
    link.textContent = publicUrl();
  }
  $('v2OpenPublic')?.addEventListener('click', () => window.open(publicUrl(), '_blank'));
  $('v2CopyPublic')?.addEventListener('click', async () => {
    const copied = await copyText(publicUrl());
    status(copied ? 'Public link copied.' : 'Copy failed. Select and copy the public link above.', !copied);
  });
  $('v2ShowScene')?.addEventListener('click', () => runAction('Show lucky draw scene', async () => {
    return showLuckyDrawScene();
  }));
  $('v2ShowReady')?.addEventListener('click', () => runAction('Show ready', async () => {
    await showLuckyDrawScene('Lucky Draw ready');
    return setReady(eid, { ...modeOptions(), context: lastSummary });
  }));
  $('v2Draw')?.addEventListener('click', () => runAction('Start draw', async () => {
    const spinStartedAt = Date.now();
    await Promise.all([
      previewSpin(eid, { ...modeOptions(), context: lastSummary }),
      showLuckyDrawScene('Lucky Draw drawing')
    ]);
    return drawV2(eid, { ...modeOptions(), context: lastSummary, revealDelay: 1540, skipSpinPublish: true, spinStartedAt });
  }));
  $('v2Instant')?.addEventListener('click', () => runAction('Instant draw', async () => {
    const result = await drawV2(eid, { ...modeOptions(), context: lastSummary, instant: true, skipSpinPublish: true });
    await showLuckyDrawScene('Lucky Draw instant result');
    return result;
  }));
  $('v2Redraw')?.addEventListener('click', () => runAction('Redraw batch', async () => {
    const id = selectedBatchId();
    if (!id) throw new Error('No revealed V2 batch to redraw.');
    const spinStartedAt = Date.now();
    await Promise.all([
      previewSpin(eid, { ...modeOptions(), context: lastSummary, previousBatchId: id, redraw: true }),
      showLuckyDrawScene('Lucky Draw redraw')
    ]);
    return drawV2(eid, { ...modeOptions(), context: lastSummary, previousBatchId: id, redraw: true, revealDelay: 1200, skipSpinPublish: true, spinStartedAt });
  }));
  $('v2Reroll')?.addEventListener('click', () => runAction('Reroll selected', async () => {
    const id = selectedBatchId();
    if (!id) throw new Error('No revealed V2 batch to reroll.');
    if (selectedSlot < 0) throw new Error('Select a winner slot first.');
    await showLuckyDrawScene('Lucky Draw reroll');
    const result = await drawV2(eid, { ...modeOptions(), context: lastSummary, previousBatchId: id, replaceIndex: selectedSlot, revealDelay: 1100 });
    selectedSlot = -1;
    return result;
  }));
  $('v2Undo')?.addEventListener('click', () => runAction('Undo last', async () => {
    const result = await undoLastV2(eid);
    selectedSlot = -1;
    return result;
  }));
  $('v2Clear')?.addEventListener('click', () => runAction('Clear public', async () => {
    await showLuckyDrawScene('Lucky Draw cleared');
    const result = await clearV2Stage(eid);
    selectedSlot = -1;
    return result;
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
    if (Number(state?.updatedAt || 0) < Number(lastState?.updatedAt || 0)) return;
    lastState = state || {};
    renderV2Stage(lastState);
  }, { fallbackMs: 3000, transport: 'poll' });
  FB.listen?.(`/events/${eid}/assetSettings`, () => {
    refreshV2Assets().catch(error => console.warn('[Lucky V2] asset refresh failed', error));
  }, { fallbackMs: 15000 });
  if (!quietRefreshTimer) {
    quietRefreshTimer = setInterval(refreshRosterPrizeCacheQuiet, 60000);
  }
}

boot();
