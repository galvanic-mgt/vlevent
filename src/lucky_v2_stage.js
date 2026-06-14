let spinTimer = null;
let lastLeverKey = '';

function cssUrl(value) {
  return value ? `url("${String(value).replaceAll('"', '\\"')}")` : '';
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
  if (count <= 5) return count;
  if (count === 6) return 3;
  if (count <= 8) return 4;
  return 5;
}

function clearSpin() {
  if (spinTimer) clearInterval(spinTimer);
  spinTimer = null;
}

function makeSlot(winner, index, status) {
  const slot = document.createElement('button');
  slot.type = 'button';
  slot.className = `v2-slot ${status === 'spinning' ? 'spinning' : ''} ${status === 'revealed' ? 'revealed' : ''}`;
  slot.dataset.index = String(index);
  const name = document.createElement('div');
  name.className = 'v2-name';
  const strong = document.createElement('strong');
  strong.textContent = winner?.name || '---';
  const dept = document.createElement('span');
  dept.textContent = winner?.dept || '';
  name.append(strong, dept);
  slot.append(name);
  return slot;
}

function makePollCard(item, index, revealStep, showTop) {
  const card = document.createElement('div');
  const revealed = index < revealStep;
  const isTop = item?.isTop && showTop && revealed;
  card.className = `v2-poll-card ${revealed ? 'revealed' : 'pending'} ${isTop ? 'top' : ''}`;
  card.style.animationDelay = `${index * 120}ms`;

  const label = document.createElement('div');
  label.className = 'v2-poll-label';
  label.textContent = item?.text || `Option ${index + 1}`;

  const track = document.createElement('div');
  track.className = 'v2-poll-track';
  const fill = document.createElement('div');
  fill.className = 'v2-poll-fill';
  fill.style.width = revealed ? `${Math.max(4, Number(item?.percent || 0))}%` : '0%';
  track.append(fill);

  const count = document.createElement('div');
  count.className = 'v2-poll-count';
  count.textContent = revealed ? `${Number(item?.count || 0)} votes` : 'Ready';

  const badge = document.createElement('div');
  badge.className = 'v2-poll-badge';
  badge.textContent = isTop ? 'TOP VOTE' : '';

  card.append(badge, label, track, count);
  return card;
}

function renderPollStage(machine, state) {
  clearSpin();
  const items = Array.isArray(state.items) ? state.items : [];
  const display = state.pollDisplay || 'results';
  const revealStep = Math.max(0, Math.min(items.length, Number(state.revealStep || 0)));
  machine.innerHTML = '';
  machine.classList.add('v2-poll-machine');
  machine.style.setProperty('--cols', String(columnsFor(Math.max(1, items.length))));

  if (display === 'qr') {
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
    machine.append(makePollCard(item, index, revealStep, showTop));
  });
}

export function applyV2Assets({ assets = {}, title = 'Event' } = {}) {
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
  if (prizeEl) prizeEl.textContent = state.prizeName || state.currentPrizeName || 'Ready';
  if (statusEl) statusEl.textContent = state.message || state.status || 'Waiting';
  if (modeEl) modeEl.textContent = state.modeLabel || (state.mode === 'extra' ? 'Extra Round' : 'Main Draw');
  if (giftLeftEl) giftLeftEl.textContent = giftBubbleText(state.giftStats);
  if (stage) {
    stage.classList.toggle('is-spinning', state.status === 'spinning');
    const leverKey = `${state.drawId || state.updatedAt || ''}:${state.status || ''}`;
    if ((state.status === 'spinning' || state.status === 'revealed') && leverKey !== lastLeverKey) {
      lastLeverKey = leverKey;
      stage.classList.remove('is-lever-pull');
      void stage.offsetWidth;
      stage.classList.add('is-lever-pull');
      setTimeout(() => stage.classList.remove('is-lever-pull'), 1800);
    }
  }
  if (!machine) return;
  machine.classList.remove('v2-poll-machine');

  if (state.mode === 'poll' || state.kind === 'poll') {
    renderPollStage(machine, state);
    return;
  }

  clearSpin();
  const winners = Array.isArray(state.winners) ? state.winners : [];
  const candidates = Array.isArray(state.candidateNames) && state.candidateNames.length
    ? state.candidateNames
    : [{ name: 'READY', dept: '' }, { name: 'LUCKY', dept: '' }, { name: 'DRAW', dept: '' }];
  const count = Math.max(1, Number(state.batchSize || winners.length || 1));
  machine.style.setProperty('--cols', String(columnsFor(count)));
  machine.innerHTML = '';

  if (state.status === 'clear') {
    machine.append(makeSlot({ name: 'READY', dept: '' }, 0, 'ready'));
    return;
  }

  if (state.status === 'spinning') {
    for (let i = 0; i < count; i += 1) {
      machine.append(makeSlot(candidates[(i * 3) % candidates.length], i, 'spinning'));
    }
    spinTimer = setInterval(() => {
      const slots = Array.from(machine.querySelectorAll('.v2-slot'));
      slots.forEach((slot, i) => {
        const pick = candidates[Math.floor(Math.random() * candidates.length)] || {};
        const strong = slot.querySelector('strong');
        const dept = slot.querySelector('span');
        if (strong) strong.textContent = pick.name || '---';
        if (dept) dept.textContent = pick.dept || '';
        slot.style.animationDelay = `${i * 70}ms`;
      });
    }, 90);
    return;
  }

  const list = winners.length ? winners : [{ name: 'Ready', dept: '' }];
  list.forEach((winner, index) => {
    const slot = makeSlot(winner, index, winners.length ? 'revealed' : 'ready');
    slot.style.animationDelay = `${index * 130}ms`;
    machine.append(slot);
  });
}
