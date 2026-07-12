import { localAssetUrl } from './local_assets.js';

let spinTimer = null;
let lastLeverKey = '';
let lastMachineKey = '';
let lastPollMachineKey = '';
let fitFrame = 0;

function cssUrl(value) {
  const src = localAssetUrl(value);
  return src ? `url("${String(src).replaceAll('"', '\\"')}")` : '';
}

function setBg(id, value, size = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.backgroundImage = cssUrl(value);
  if (size) el.style.backgroundSize = size;
}

function giftBubbleText(stats) {
  if (!stats || typeof stats.remaining !== 'number') return 'Available --';
  return `Available ${stats.remaining}/${stats.quota ?? '--'}`;
}

function columnsFor(count) {
  if (count <= 1) return 1;
  if (count <= 3) return count;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  if (count <= 8) return 4;
  return 5;
}

function applyMachineLayout(machine, count) {
  const cols = columnsFor(Math.max(1, count));
  const rows = Math.max(1, Math.ceil(Math.max(1, count) / cols));
  machine.style.setProperty('--cols', String(cols));
  machine.style.setProperty('--rows', String(rows));
  machine.style.setProperty('--slot-width', `${100 / cols}%`);
  machine.style.setProperty('--slot-height', `${100 / rows}%`);
}

function clearSpin() {
  if (spinTimer) clearInterval(spinTimer);
  spinTimer = null;
}

function px(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function lineHeightFor(el, fontSize) {
  const value = window.getComputedStyle(el).lineHeight;
  return value === 'normal' ? fontSize * 1.08 : px(value, fontSize * 1.08);
}

function fitOneLine(el, minSize) {
  if (!el || !el.parentElement || el.clientWidth <= 0) return;
  const parentSize = px(window.getComputedStyle(el.parentElement).fontSize, 48);
  let low = minSize;
  let high = parentSize;
  let best = low;

  el.style.fontSize = `${high}px`;
  for (let i = 0; i < 8; i += 1) {
    const mid = (low + high) / 2;
    el.style.fontSize = `${mid}px`;
    const fits = el.scrollWidth <= el.clientWidth + 1;
    if (fits) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }
  el.style.fontSize = `${Math.floor(best)}px`;
}

function slotTextFits(strong, size) {
  const slot = strong.closest('.v2-slot');
  const wrap = strong.closest('.v2-name');
  if (!slot || !wrap || slot.clientWidth <= 0 || slot.clientHeight <= 0) return true;
  strong.style.fontSize = `${size}px`;
  const maxNameHeight = lineHeightFor(strong, size) * 3 + 2;
  return strong.scrollHeight <= maxNameHeight
    && wrap.scrollHeight <= slot.clientHeight - 6
    && wrap.scrollWidth <= slot.clientWidth - 6;
}

function fitWinnerNames() {
  const names = Array.from(document.querySelectorAll('#v2Machine .v2-slot .v2-name strong'));
  if (!names.length) return;
  names.forEach(el => { el.style.fontSize = ''; });
  const maxSize = Math.min(...names.map(el => px(window.getComputedStyle(el).fontSize, 72)));
  const minSize = Math.max(18, Math.min(34, maxSize * 0.46));
  let low = minSize;
  let high = maxSize;
  let best = minSize;

  for (let i = 0; i < 9; i += 1) {
    const mid = (low + high) / 2;
    const fits = names.every(el => slotTextFits(el, mid));
    if (fits) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }
  names.forEach(el => { el.style.fontSize = `${Math.floor(best)}px`; });
}

function metaLineFits(el, size) {
  const slot = el.closest('.v2-slot');
  const wrap = el.closest('.v2-name');
  if (!slot || !wrap || slot.clientWidth <= 0 || slot.clientHeight <= 0) return true;
  el.style.fontSize = `${size}px`;
  return el.scrollWidth <= el.clientWidth + 1
    && wrap.scrollHeight <= slot.clientHeight - 6
    && wrap.scrollWidth <= slot.clientWidth - 6;
}

function fitWinnerMeta() {
  const lines = Array.from(document.querySelectorAll('#v2Machine .v2-slot .v2-name span'))
    .filter(el => String(el.textContent || '').trim());
  if (!lines.length) return;
  lines.forEach(el => { el.style.fontSize = ''; });
  const maxSize = Math.min(...lines.map(el => px(window.getComputedStyle(el).fontSize, 32)));
  const minSize = Math.max(12, Math.min(22, maxSize * 0.52));
  let low = minSize;
  let high = maxSize;
  let best = minSize;

  for (let i = 0; i < 8; i += 1) {
    const mid = (low + high) / 2;
    const fits = lines.every(el => metaLineFits(el, mid));
    if (fits) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }
  lines.forEach(el => { el.style.fontSize = `${Math.floor(best)}px`; });
}

function fitStageText() {
  fitOneLine(document.getElementById('v2PrizeName'), 18);
  fitOneLine(document.getElementById('v2GiftLeft'), 12);
  fitWinnerNames();
  fitWinnerMeta();
}

function scheduleTextFit() {
  if (fitFrame) cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    fitFrame = 0;
    fitStageText();
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', scheduleTextFit);
}

function uniqueParts(parts) {
  const seen = new Set();
  return parts.map(part => String(part || '').trim()).filter(part => {
    if (!part || seen.has(part)) return false;
    seen.add(part);
    return true;
  });
}

function winnerCodeLine(winner = {}) {
  return uniqueParts([winner.code, winner.table || winner.seat]).join(' / ');
}

function makeSlot(winner, index, status, options = {}) {
  const slot = document.createElement('button');
  slot.type = 'button';
  slot.className = `v2-slot ${status === 'spinning' ? 'spinning' : ''} ${status === 'revealed' ? 'revealed' : ''} ${options.quiet ? 'quiet' : ''}`;
  slot.dataset.index = String(index);
  const name = document.createElement('div');
  name.className = 'v2-name';
  const strong = document.createElement('strong');
  strong.textContent = winner?.name || '---';
  const dept = document.createElement('span');
  dept.className = 'v2-dept';
  dept.textContent = winner?.dept || '';
  const code = document.createElement('span');
  code.className = 'v2-code';
  code.textContent = winnerCodeLine(winner);
  name.append(strong, dept, code);
  slot.append(name);
  return slot;
}

function makePollCard(item, index, revealStep, showTop, freshReveal) {
  const card = document.createElement('div');
  const revealed = index < revealStep;
  const isTop = item?.isTop && showTop && revealed;
  card.className = `v2-poll-card ${revealed ? 'revealed' : 'pending'} ${freshReveal ? 'fresh' : ''} ${isTop ? 'top' : ''}`;
  card.style.animationDelay = `${index * 120}ms`;
  card.setAttribute('aria-label', `${item?.text || `Option ${index + 1}`}${revealed ? ' revealed' : ' pending'}`);

  const photo = document.createElement('div');
  photo.className = 'v2-poll-photo';
  const photoSrc = localAssetUrl(item?.img || '');
  if (photoSrc) {
    const image = document.createElement('img');
    image.src = photoSrc;
    image.alt = `${item?.text || `Option ${index + 1}`} photo`;
    image.loading = 'eager';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      image.remove();
      photo.classList.add('is-empty');
    }, { once: true });
    photo.append(image);
  } else {
    photo.classList.add('is-empty');
  }

  const label = document.createElement('div');
  label.className = 'v2-poll-label';
  const labelText = document.createElement('span');
  labelText.textContent = item?.text || `Option ${index + 1}`;
  label.append(labelText);
  if (isTop) {
    const crown = document.createElement('span');
    crown.className = 'v2-poll-crown';
    crown.setAttribute('aria-label', 'Winner');
    crown.textContent = '\u{1F451}';
    label.append(crown);
  }

  const track = document.createElement('div');
  track.className = 'v2-poll-track';
  const fill = document.createElement('div');
  fill.className = 'v2-poll-fill';
  const width = revealed ? `${Math.max(4, Number(item?.percent || 0))}%` : '0%';
  fill.style.setProperty('--target-width', width);
  fill.style.width = freshReveal ? '0%' : width;
  track.append(fill);

  const badge = document.createElement('div');
  badge.className = 'v2-poll-badge';
  badge.textContent = '';

  card.append(badge, photo, label, track);
  return card;
}

function renderPollStage(machine, state) {
  clearSpin();
  const items = Array.isArray(state.items) ? state.items : [];
  const display = state.pollDisplay || 'results';
  const revealStep = Math.max(0, Math.min(items.length, Number(state.revealStep || 0)));
  machine.classList.add('v2-poll-machine');
  machine.classList.toggle('v2-poll-results-list', display !== 'qr');
  const pollMachineKey = JSON.stringify({
    pollId: state.pollId || '',
    display,
    revealStep,
    highlightTop: state.highlightTop === true,
    items: items.map(item => [item?.id || '', item?.text || '', item?.img || '', Number(item?.percent || 0), item?.isTop === true])
  });
  if (pollMachineKey === lastPollMachineKey) {
    scheduleTextFit();
    return;
  }
  lastPollMachineKey = pollMachineKey;
  machine.innerHTML = '';
  applyMachineLayout(machine, Math.max(1, items.length));

  if (display === 'qr') {
    machine.classList.remove('v2-poll-results-list');
    const panel = document.createElement('div');
    panel.className = 'v2-poll-qr';
    const title = document.createElement('div');
    title.className = 'v2-poll-qr-title';
    title.textContent = state.question || 'Voting';
    const qr = document.createElement('div');
    qr.className = 'v2-poll-qr-canvas';
    const link = document.createElement('div');
    link.className = 'v2-poll-qr-link';
    link.textContent = state.voteLink || '';
    panel.append(title, qr, link);
    machine.append(panel);
    if (window.QRCode && state.voteLink) {
      // eslint-disable-next-line no-undef
      new QRCode(qr, { text: state.voteLink, width: 340, height: 340, correctLevel: QRCode.CorrectLevel.M });
    }
    return;
  }

  if (!items.length) {
    machine.append(makeSlot({ name: 'Voting', dept: 'No poll selected' }, 0, 'ready'));
    return;
  }

  const showTop = revealStep >= items.length || state.highlightTop === true;
  items.forEach((item, index) => {
    const freshReveal = revealStep >= items.length ? true : index === revealStep - 1;
    machine.append(makePollCard(item, index, revealStep, showTop, freshReveal));
  });
}

export function applyV2Assets({ assets = {}, title = 'Event' } = {}) {
  const stage = document.getElementById('v2Stage');
  if (stage) stage.classList.toggle('is-brand-hidden', assets.hideBrandOnV2 === true);
  setBg('v2StageBg', assets.background || (Array.isArray(assets.photos) ? assets.photos[0] : '') || assets.banner || '', 'cover');
  setBg('v2Logo', assets.logo || '', 'contain');
  setBg('v2Banner', assets.banner || '', 'cover');
  const eventEl = document.getElementById('v2EventName');
  if (eventEl) eventEl.textContent = title || 'Event';
}

export function renderV2Stage(state = {}) {
  const stage = document.getElementById('v2Stage');
  const machine = document.getElementById('v2Machine');
  const prizeEl = document.getElementById('v2PrizeName');
  const statusEl = document.getElementById('v2StageStatus');
  const modeEl = document.getElementById('v2ModeLabel');
  const giftLeftEl = document.getElementById('v2GiftLeft');
  const hasSpinCandidates = state.status === 'spinning'
    && Array.isArray(state.candidateNames)
    && state.candidateNames.some(p => p?.name);
  const isInstant = state.instant === true;
  if (prizeEl) prizeEl.textContent = state.prizeName || state.currentPrizeName || 'Ready';
  if (statusEl) statusEl.textContent = state.message || state.status || 'Waiting';
  if (modeEl) modeEl.textContent = state.modeLabel || (state.mode === 'extra' ? 'Extra Round' : 'Main Draw');
  if (giftLeftEl) giftLeftEl.textContent = giftBubbleText(state.giftStats);
  if (stage) {
    const isPoll = state.mode === 'poll' || state.kind === 'poll';
    stage.classList.toggle('is-spinning', hasSpinCandidates);
    stage.classList.toggle('is-clear', state.status === 'clear');
    stage.classList.toggle('is-poll', isPoll);
    if (state.status === 'clear') stage.classList.remove('is-lever-pull');
    const leverKey = `${state.drawId || state.updatedAt || ''}:${state.status || ''}`;
    if (isInstant) {
      lastLeverKey = leverKey;
      stage.classList.remove('is-lever-pull');
    } else if ((hasSpinCandidates || state.status === 'revealed') && leverKey !== lastLeverKey) {
      lastLeverKey = leverKey;
      stage.classList.remove('is-lever-pull');
      void stage.offsetWidth;
      stage.classList.add('is-lever-pull');
      setTimeout(() => stage.classList.remove('is-lever-pull'), 3100);
    }
  }
  if (!machine) return;
  machine.classList.remove('v2-poll-machine', 'v2-poll-results-list');

  if (state.mode === 'poll' || state.kind === 'poll') {
    renderPollStage(machine, state);
    scheduleTextFit();
    return;
  }

  lastPollMachineKey = '';
  clearSpin();
  const winners = Array.isArray(state.winners) ? state.winners : [];
  const realCandidates = Array.isArray(state.candidateNames) ? state.candidateNames.filter(p => p?.name) : [];
  const candidates = realCandidates.length
    ? realCandidates
    : [{ name: 'READY', dept: '' }, { name: 'LUCKY', dept: '' }, { name: 'DRAW', dept: '' }];
  const count = Math.max(1, Number(state.batchSize || winners.length || 1));
  const replacedIndex = Number.isInteger(state.replacedIndex) ? state.replacedIndex : -1;
  const isReroll = state.action === 'reroll' && replacedIndex >= 0;
  applyMachineLayout(machine, count);

  const machineKey = JSON.stringify({
    status: state.status || '',
    phase: state.phase || '',
    action: state.action || '',
    replacedIndex,
    drawId: state.drawId || '',
    batchSize: count,
    winners: winners.map(w => [w?.keyId || '', w?.name || '', w?.code || '', w?.table || '', w?.seat || ''])
  });
  if (machineKey === lastMachineKey && state.status !== 'spinning') {
    scheduleTextFit();
    return;
  }
  lastMachineKey = machineKey;
  machine.innerHTML = '';

  if (state.status === 'clear') {
    lastMachineKey = '';
    scheduleTextFit();
    return;
  }

  if (state.status === 'spinning' && !realCandidates.length) {
    lastMachineKey = '';
    const fallback = winners.length ? winners : [{ name: 'No eligible participants', dept: '' }];
    fallback.forEach((winner, index) => {
      machine.append(makeSlot(winner, index, winners.length ? 'revealed' : 'ready'));
    });
    scheduleTextFit();
    return;
  }

  if (state.status === 'spinning') {
    lastMachineKey = '';
    for (let i = 0; i < count; i += 1) {
      const shouldSpin = !isReroll || i === replacedIndex;
      const displayWinner = shouldSpin
        ? candidates[(i * 3) % candidates.length]
        : winners[i] || { name: '---', dept: '' };
      machine.append(makeSlot(displayWinner, i, shouldSpin ? 'spinning' : 'revealed', { quiet: !shouldSpin }));
    }
    spinTimer = setInterval(() => {
      const slots = Array.from(machine.querySelectorAll('.v2-slot.spinning'));
      slots.forEach((slot, i) => {
        const pick = candidates[Math.floor(Math.random() * candidates.length)] || {};
        const strong = slot.querySelector('strong');
        const dept = slot.querySelector('span');
        if (strong) strong.textContent = pick.name || '---';
        if (dept) dept.textContent = pick.dept || '';
        const code = slot.querySelector('.v2-code');
        if (code) code.textContent = winnerCodeLine(pick);
        slot.style.animationDelay = `${i * 70}ms`;
      });
      scheduleTextFit();
    }, 90);
    scheduleTextFit();
    return;
  }

  const list = winners.length ? winners : [{ name: 'Ready', dept: '' }];
  list.forEach((winner, index) => {
    const quiet = isInstant || (winners.length && isReroll && index !== replacedIndex);
    const slot = makeSlot(winner, index, winners.length ? 'revealed' : 'ready', { quiet });
    slot.style.animationDelay = `${index * 130}ms`;
    machine.append(slot);
  });
  scheduleTextFit();
}
