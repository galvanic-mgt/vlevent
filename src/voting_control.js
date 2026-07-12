import { FB, firebaseUrl } from './fb.js?v=20260706b';
import { getPoll, setActive, voteCountsFromPoll } from './polls_public_firebase.js?v=20260712n';

const url = new URL(location.href);
const eid = url.searchParams.get('event') || '';
const $ = id => document.getElementById(id);

let polls = {};
let ui = {};
let publicScreen = {};
let selectedPid = url.searchParams.get('poll') || '';
let busy = false;
let eventName = '';

function pageUrl(file, params = {}) {
  const u = new URL(file, location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') u.searchParams.set(key, value);
  });
  return u.href;
}

function voteUrl(pid = selectedPid) {
  return pageUrl('./vote.html', { event: eid, poll: pid });
}

function v2PublicUrl() {
  return pageUrl('./lucky_v2_public.html', { event: eid });
}

function cmsUrl() {
  return pageUrl('./lucky_v2.html', { event: eid });
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

function status(text, isError = false) {
  const el = $('status');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? '#ff7b86' : '';
}

function withTimeout(promise, label, ms = 18000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not respond within ${Math.round(ms / 1000)}s. The voting control page is waiting for that Firebase/local-server step, so check that specific connection/path and try again.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function retryFirebaseStep(fn) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await wait(300 + attempt * 600);
    }
  }
  throw new Error(`${lastError?.message || 'Firebase request failed'} (3 attempts failed)`);
}

async function firebaseJsonWithAbort(path, options = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const method = String(options.method || 'GET').toUpperCase();
  const route = firebaseUrl(path).includes('/__firebase?') ? 'local Firebase proxy' : 'Firebase';
  try {
    const res = await fetch(firebaseUrl(path), {
      cache: 'no-store',
      ...options,
      signal: controller.signal
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || (data && typeof data.error === 'string')) {
      const detail = data?.error || `${res.status} ${res.statusText || ''}`.trim();
      throw new Error(`${route} ${method} ${path} failed: ${detail}`);
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${route} ${method} ${path} timed out after ${Math.round(ms / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function selectedPoll() {
  return selectedPid ? polls?.[selectedPid] || null : null;
}

function totalVotes(poll) {
  return Object.values(voteCountsFromPoll(poll || {})).reduce((sum, value) => sum + Number(value || 0), 0);
}

function voterCount(poll) {
  return Object.keys(poll?.voters || {}).length;
}

function orderedItems(poll) {
  const votes = voteCountsFromPoll(poll || {});
  const items = (poll?.options || []).map((option, index) => ({
    id: option.id,
    text: option.text || `Option ${index + 1}`,
    img: option.img || '',
    count: Number(votes[option.id] || 0),
    originalIndex: index
  }));
  if (Array.isArray(poll?.resultOrder) && poll.resultOrder.length) {
    const order = new Map(poll.resultOrder.map((id, index) => [id, index]));
    items.sort((a, b) => (order.get(a.id) ?? a.originalIndex + 10000) - (order.get(b.id) ?? b.originalIndex + 10000));
  }
  const max = Math.max(0, ...items.map(item => item.count));
  return items.map(item => ({
    ...item,
    percent: max ? Math.round((item.count / max) * 100) : 0,
    isTop: max > 0 && item.count === max
  }));
}

function publicResultItems(poll) {
  return orderedItems(poll)
    .slice()
    .sort((a, b) => b.count - a.count || a.originalIndex - b.originalIndex)
    .slice(0, 3)
    .sort((a, b) => a.count - b.count || a.originalIndex - b.originalIndex);
}

function buildPollScreen(poll, display, revealStep = 0, highlightTop = false) {
  const items = display === 'results' ? publicResultItems(poll) : orderedItems(poll);
  const step = Math.max(0, Math.min(items.length, Number(revealStep || 0)));
  return {
    mode: 'poll',
    kind: 'poll',
    status: display === 'qr' ? 'poll-qr' : 'poll-results',
    pollDisplay: display,
    pollId: selectedPid,
    question: poll?.question || poll?.q || 'Voting',
    prizeName: poll?.question || poll?.q || 'Voting',
    modeLabel: 'Voting',
    message: display === 'qr' ? 'Scan to vote' : (step >= items.length ? 'Final result' : 'Revealing results'),
    voteLink: voteUrl(selectedPid),
    items,
    revealStep: step,
    highlightTop,
    updatedAt: Date.now()
  };
}

async function loadAll() {
  if (!eid) {
    status('Missing event ID.', true);
    return;
  }
  const [pollMap, currentPollId, screen, eventMeta] = await withTimeout(Promise.all([
    firebaseJsonWithAbort(`/events/${eid}/polls`),
    selectedPid
      ? Promise.resolve(selectedPid)
      : firebaseJsonWithAbort(`/events/${eid}/ui/currentPollId`).catch(() => ''),
    firebaseJsonWithAbort(`/events/${eid}/ui/publicScreen`).catch(() => ({})),
    eventName
      ? Promise.resolve(null)
      : firebaseJsonWithAbort(`/events/${eid}/meta`).catch(() => ({}))
  ]), 'Voting V2 loading');
  polls = pollMap || {};
  publicScreen = screen || {};
  ui = {
    currentPollId: currentPollId || '',
    pollResultsStep: Number(publicScreen?.revealStep || 0)
  };
  if (!selectedPid || !polls[selectedPid]) {
    selectedPid = ui.currentPollId && polls[ui.currentPollId] ? ui.currentPollId : Object.keys(polls)[0] || '';
  }
  if (eventMeta?.name) eventName = eventMeta.name;
  document.title = `Voting Control${eventName ? ` - ${eventName}` : ''}`;
  render();
  status(`Ready. ${Object.keys(polls || {}).length} polls loaded.`);
}

function setBusy(value) {
  busy = value;
  document.querySelectorAll('button').forEach(btn => {
    btn.disabled = value;
    btn.style.opacity = value ? '.62' : '';
  });
}

async function run(label, fn) {
  if (busy) return;
  try {
    setBusy(true);
    status(`${label}...`);
    await withTimeout(fn(), label, 22000);
    await withTimeout(loadAll(), `${label} refresh`, 18000);
    status(`${label} complete.`);
  } catch (error) {
    console.error(`[Voting Control] ${label} failed`, error);
    status(`${label} failed: ${error?.message || String(error)}`, true);
  } finally {
    setBusy(false);
  }
}

function requirePoll() {
  const poll = selectedPoll();
  if (!eid || !selectedPid || !poll) throw new Error('Select a poll first.');
  return poll;
}

async function refreshSelectedPoll() {
  const fallback = requirePoll();
  const latest = await withTimeout(
    getPoll(eid, selectedPid),
    `latest voter records read /events/${eid}/polls/${selectedPid}`,
    18000
  );
  if (!latest) throw new Error('The selected poll could not be read from Firebase.');
  polls[selectedPid] = latest;
  return latest || fallback;
}

async function writeVotingScene(legacyPatch, publicState) {
  const path = `/events/${eid}/ui`;
  const patch = { ...legacyPatch, publicScreen: publicState };
  await withTimeout(retryFirebaseStep(() => firebaseJsonWithAbort(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  }, 5000)), `voting scene write ${path}`, 18000);
  ui = { ...ui, ...legacyPatch };
  publicScreen = publicState;
  render();
}

async function setStandby() {
  requirePoll();
  await writeVotingScene({
    currentPollId: selectedPid,
    showPollQR: false,
    pollResultsTrigger: null,
    pollResultsStep: 0
  }, { mode: 'v2Draw', updatedAt: Date.now(), message: 'Voting standby' });
}

async function showQr() {
  const poll = requirePoll();
  await writeVotingScene({
    currentPollId: selectedPid,
    showPollQR: true,
    pollResultsTrigger: null,
    pollResultsStep: 0
  }, buildPollScreen(poll, 'qr'));
}

async function openVoting() {
  const poll = requirePoll();
  await withTimeout(setActive(eid, selectedPid, true), `poll active write /events/${eid}/polls/${selectedPid}/active`, 18000);
  polls[selectedPid] = { ...poll, active: true };
  await writeVotingScene({
    currentPollId: selectedPid,
    showPollQR: true,
    pollResultsTrigger: null,
    pollResultsStep: 0
  }, buildPollScreen(poll, 'qr'));
}

async function closeVoting() {
  const poll = await refreshSelectedPoll();
  if (totalVotes(poll) === 0 && !confirm('Close voting with 0 votes?')) return;
  await withTimeout(setActive(eid, selectedPid, false), `poll active write /events/${eid}/polls/${selectedPid}/active`, 18000);
  polls[selectedPid] = { ...poll, active: false };
}

async function startResults() {
  let poll = requirePoll();
  if (poll.active !== false) {
    if (!confirm('Voting is still open. Close voting and reveal results?')) return;
    await withTimeout(setActive(eid, selectedPid, false), `poll active write /events/${eid}/polls/${selectedPid}/active`, 18000);
  }
  poll = await refreshSelectedPoll();
  const trigger = Date.now();
  await writeVotingScene({
    currentPollId: selectedPid,
    showPollQR: false,
    pollResultsTrigger: trigger,
    pollResultsStep: 0,
    pollResultsOrder: 'original'
  }, buildPollScreen(poll, 'results', 0, false));
}

async function nextResult() {
  const poll = requirePoll();
  const current = publicScreen?.mode === 'poll'
    ? Number(publicScreen.revealStep || 0)
    : Number(ui.pollResultsStep || 0);
  const count = publicResultItems(poll).length;
  const next = Math.min(count, current + 1);
  await writeVotingScene(
    { currentPollId: selectedPid, pollResultsStep: next },
    buildPollScreen(poll, 'results', next, next >= count)
  );
}

async function revealAll() {
  const poll = requirePoll();
  const count = publicResultItems(poll).length;
  await writeVotingScene(
    { currentPollId: selectedPid, showPollQR: false, pollResultsStep: count },
    buildPollScreen(poll, 'results', count, true)
  );
}

async function clearStage() {
  await writeVotingScene({
    showPollQR: false,
    pollResultsTrigger: null,
    pollResultsStep: 0
  }, { mode: 'v2Draw', updatedAt: Date.now(), message: 'Returned to V2 draw screen' });
}

function renderPollSelect() {
  const sel = $('pollSelect');
  if (!sel) return;
  sel.innerHTML = '';
  const entries = Object.entries(polls || {});
  if (!entries.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No polls';
    sel.append(opt);
    return;
  }
  entries.forEach(([pid, poll]) => {
    const opt = document.createElement('option');
    opt.value = pid;
    opt.textContent = poll?.question || poll?.q || pid;
    opt.selected = pid === selectedPid;
    sel.append(opt);
  });
}

function renderPollList() {
  const host = $('pollList');
  if (!host) return;
  host.innerHTML = '';
  Object.entries(polls || {}).forEach(([pid, poll]) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `vc-poll ${pid === selectedPid ? 'active' : ''}`;
    row.innerHTML = `
      <strong>${poll?.question || poll?.q || pid}</strong>
      <small>${(poll?.options || []).length} options | ${totalVotes(poll)} votes | ${poll?.active === false ? 'closed' : 'open'}</small>
    `;
    row.addEventListener('click', () => {
      selectedPid = pid;
      render();
    });
    host.append(row);
  });
}

function renderQr(link) {
  const host = $('qrPreview');
  if (!host) return;
  host.innerHTML = '';
  if (window.QRCode && link && selectedPid) {
    // eslint-disable-next-line no-undef
    new QRCode(host, { text: link, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
  }
}

function renderResults(poll) {
  const host = $('resultBars');
  if (!host) return;
  const items = orderedItems(poll);
  const max = Math.max(1, ...items.map(item => item.count));
  host.innerHTML = '';
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'vc-bar';
    row.innerHTML = `
      <strong>${item.text}</strong>
      <div class="vc-track"><div class="vc-fill" style="width:${Math.max(2, Math.round((item.count / max) * 100))}%"></div></div>
      <span>${item.count}</span>
    `;
    host.append(row);
  });
}

function render() {
  renderPollSelect();
  renderPollList();
  const poll = selectedPoll();
  const link = selectedPid ? voteUrl(selectedPid) : '';
  const stageMode = publicScreen?.mode === 'poll'
    ? (publicScreen.pollDisplay === 'qr' ? 'Poll QR' : 'Poll results')
    : 'V2 draw';

  $('v2PublicLink').href = v2PublicUrl();
  $('v2PublicLink').textContent = v2PublicUrl();
  $('backCms').href = cmsUrl();
  $('voteLink').href = link || '#';
  $('voteLink').textContent = link || 'No poll selected';
  $('pollTitle').textContent = poll?.question || poll?.q || 'Select a poll';
  $('pollMeta').textContent = selectedPid ? `Poll ID: ${selectedPid}` : '';
  $('stageChip').textContent = `Stage: ${stageMode}`;
  $('stageChip').className = `vc-chip ${publicScreen?.mode === 'poll' ? 'live' : ''}`;
  $('openChip').textContent = `Voting: ${poll?.active === false ? 'closed' : 'open'}`;
  $('openChip').className = `vc-chip ${poll?.active === false ? 'warn' : 'ok'}`;
  $('totalVotes').textContent = String(totalVotes(poll));
  $('totalVoters').textContent = String(voterCount(poll));
  $('revealStep').textContent = String(publicScreen?.mode === 'poll' ? Number(publicScreen.revealStep || 0) : Number(ui.pollResultsStep || 0));
  renderQr(link);
  renderResults(poll);
}

function bindControls() {
  $('backCms').href = cmsUrl();
  $('v2PublicLink').href = v2PublicUrl();
  $('v2PublicLink').textContent = v2PublicUrl();
  $('pollSelect')?.addEventListener('change', event => {
    selectedPid = event.target.value || '';
    render();
  });
  $('openPublic').href = v2PublicUrl();
  $('copyPublic')?.addEventListener('click', async () => {
    const copied = await copyText(v2PublicUrl());
    status(copied ? 'Public link copied.' : 'Copy failed. Select and copy the public link above.', !copied);
  });
  $('standbyPoll')?.addEventListener('click', () => run('Set standby', setStandby));
  $('showQr')?.addEventListener('click', () => run('Show QR', showQr));
  $('openVoting')?.addEventListener('click', () => run('Open voting', openVoting));
  $('closeVoting')?.addEventListener('click', () => run('Close voting', closeVoting));
  $('startResults')?.addEventListener('click', () => run('Reveal results', startResults));
  $('nextResult')?.addEventListener('click', () => run('Next result', nextResult));
  $('revealAll')?.addEventListener('click', () => run('Reveal all', revealAll));
  $('clearStage')?.addEventListener('click', () => run('Clear stage', clearStage));
}

async function boot() {
  bindControls();
  try {
    await loadAll();
  } catch (error) {
    console.error('[Voting Control] initial load failed', error);
    status(`Loading failed: ${error?.message || String(error)}`, true);
  }
  if (FB.listen && eid) {
    FB.listen(`/events/${eid}/polls`, next => {
      polls = next || {};
      if (!selectedPid || !polls[selectedPid]) selectedPid = Object.keys(polls)[0] || '';
      render();
    }, { fallbackMs: 4000, transport: 'poll' });
    FB.listen(`/events/${eid}/ui/publicScreen`, next => {
      publicScreen = next || {};
      render();
    }, { fallbackMs: 4000, transport: 'poll' });
  }
}

boot();
