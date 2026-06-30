import { FB } from './fb.js';
import { getPolls, getEventInfo } from './core_firebase.js';
import { setActive, voteCountsFromPoll } from './polls_public_firebase.js';

const url = new URL(location.href);
const eid = url.searchParams.get('event') || '';
const $ = id => document.getElementById(id);

let polls = {};
let ui = {};
let publicScreen = {};
let selectedPid = url.searchParams.get('poll') || '';
let busy = false;

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
  return pageUrl('./index.html', { event: eid });
}

function status(text, isError = false) {
  const el = $('status');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? '#ff7b86' : '';
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

function buildPollScreen(poll, display, revealStep = 0, highlightTop = false) {
  const items = orderedItems(poll);
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
  const [pollMap, nextUi, screen, eventInfo] = await Promise.all([
    getPolls(eid).catch(() => ({})),
    FB.get(`/events/${eid}/ui`).catch(() => ({})),
    FB.get(`/events/${eid}/ui/publicScreen`).catch(() => ({})),
    getEventInfo(eid).catch(() => ({}))
  ]);
  polls = pollMap || {};
  ui = nextUi || {};
  publicScreen = screen || {};
  if (!selectedPid || !polls[selectedPid]) {
    selectedPid = ui.currentPollId && polls[ui.currentPollId] ? ui.currentPollId : Object.keys(polls)[0] || '';
  }
  document.title = `Voting Control${eventInfo?.meta?.name ? ` - ${eventInfo.meta.name}` : ''}`;
  render();
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
    await fn();
    await loadAll();
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

async function writeLegacyStage(patch) {
  await FB.patch(`/events/${eid}/ui`, patch);
}

async function writePublicScreen(state) {
  await FB.put(`/events/${eid}/ui/publicScreen`, state);
}

async function setStandby() {
  requirePoll();
  await writeLegacyStage({
    currentPollId: selectedPid,
    showPollQR: false,
    pollResultsTrigger: null,
    pollResultsStep: 0
  });
  await writePublicScreen({ mode: 'v2Draw', updatedAt: Date.now(), message: 'Voting standby' });
}

async function showQr() {
  const poll = requirePoll();
  await writeLegacyStage({
    currentPollId: selectedPid,
    showPollQR: true,
    pollResultsTrigger: null,
    pollResultsStep: 0
  });
  await writePublicScreen(buildPollScreen(poll, 'qr'));
}

async function openVoting() {
  const poll = requirePoll();
  await setActive(eid, selectedPid, true);
  await writeLegacyStage({
    currentPollId: selectedPid,
    showPollQR: true,
    pollResultsTrigger: null,
    pollResultsStep: 0
  });
  await writePublicScreen(buildPollScreen(poll, 'qr'));
}

async function closeVoting() {
  const poll = requirePoll();
  if (totalVotes(poll) === 0 && !confirm('Close voting with 0 votes?')) return;
  await setActive(eid, selectedPid, false);
}

async function startResults() {
  const poll = requirePoll();
  if (poll.active !== false) {
    if (!confirm('Voting is still open. Close voting and reveal results?')) return;
    await setActive(eid, selectedPid, false);
  }
  const trigger = Date.now();
  await writeLegacyStage({
    currentPollId: selectedPid,
    showPollQR: false,
    pollResultsTrigger: trigger,
    pollResultsStep: 0,
    pollResultsOrder: 'original'
  });
  await writePublicScreen(buildPollScreen(poll, 'results', 0, false));
}

async function nextResult() {
  const poll = requirePoll();
  const current = publicScreen?.mode === 'poll'
    ? Number(publicScreen.revealStep || 0)
    : Number(ui.pollResultsStep || 0);
  const next = Math.min(orderedItems(poll).length, current + 1);
  await writeLegacyStage({ currentPollId: selectedPid, pollResultsStep: next });
  await writePublicScreen(buildPollScreen(poll, 'results', next, next >= orderedItems(poll).length));
}

async function revealAll() {
  const poll = requirePoll();
  const count = orderedItems(poll).length;
  await writeLegacyStage({ currentPollId: selectedPid, showPollQR: false, pollResultsStep: count });
  await writePublicScreen(buildPollScreen(poll, 'results', count, true));
}

async function clearStage() {
  await writeLegacyStage({
    showPollQR: false,
    pollResultsTrigger: null,
    pollResultsStep: 0
  });
  await writePublicScreen({ mode: 'v2Draw', updatedAt: Date.now(), message: 'Returned to V2 draw screen' });
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
  $('pollSelect')?.addEventListener('change', event => {
    selectedPid = event.target.value || '';
    render();
  });
  $('openPublic')?.addEventListener('click', () => window.open(v2PublicUrl(), '_blank'));
  $('copyPublic')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(v2PublicUrl()).catch(() => {});
    status('Public link copied.');
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
  await loadAll();
  if (FB.listen && eid) {
    FB.listen(`/events/${eid}/polls`, next => {
      polls = next || {};
      if (!selectedPid || !polls[selectedPid]) selectedPid = Object.keys(polls)[0] || '';
      render();
    }, { fallbackMs: 4000 });
    FB.listen(`/events/${eid}/ui`, next => {
      ui = next || {};
      render();
    }, { fallbackMs: 4000 });
    FB.listen(`/events/${eid}/ui/publicScreen`, next => {
      publicScreen = next || {};
      render();
    }, { fallbackMs: 4000 });
  }
}

boot();
