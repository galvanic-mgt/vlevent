// src/polls_voter.js
import { getPoll, submitBoundVote } from './polls_public_firebase.js';
import { setCurrentEventId, getAssets } from './core_firebase.js';
import { applyBackground } from './ui_background.js';
import { FB } from './fb.js';

const $ = s => document.querySelector(s);
const url = new URL(location.href);
const eid = url.searchParams.get('event');
const pid = url.searchParams.get('poll');

let voterKey = '';
let selectedOption = null;
let loadedPoll = null;

if (eid) setCurrentEventId(eid);

function safeKey(value) {
  return String(value || '').trim().replace(/[.#$/\[\]]/g, '_');
}

function normalise(value) {
  return String(value || '').trim().toLowerCase();
}

function normaliseDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function setStatus(text) {
  const el = $('#status');
  if (el) el.textContent = text || '';
}

function setError(text) {
  const el = $('#err');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
}

function setVoteEnabled(enabled) {
  $('#optWrap')?.querySelectorAll('button').forEach(btn => {
    btn.disabled = !enabled;
  });
}

function isPollOpen(poll) {
  if (!poll || poll.active === false) return false;
  const showStart = poll.showStartAt || poll.openAt || '';
  if (!showStart) return true;
  const d = new Date(showStart);
  if (Number.isNaN(d.getTime())) return true;
  return Date.now() >= d.getTime();
}

async function verifyBatch(rawBatch) {
  const people = await FB.get(`/events/${eid}/people`).catch(() => []);
  const list = Array.isArray(people) ? people : [];
  const text = normalise(rawBatch);
  const digits = normaliseDigits(rawBatch);
  return list.find(p => {
    if (!p) return false;
    return (text && normalise(p.code) === text) || (digits && normaliseDigits(p.phone) === digits);
  }) || null;
}

async function hydrateBrand() {
  if (!eid) return;
  try {
    const assets = await getAssets(eid);
    const logoSrc = assets.logo || '';
    const bannerSrc = assets.banner || '';

    const logoEl = $('#voteLogo');
    if (logoEl) {
      if (logoSrc) {
        logoEl.style.backgroundImage = `url('${logoSrc}')`;
        logoEl.textContent = '';
      } else {
        logoEl.style.backgroundImage = '';
        logoEl.textContent = 'LOGO';
      }
    }

    const bannerEl = $('#voteBanner');
    if (bannerEl) {
      if (bannerSrc) {
        bannerEl.style.backgroundImage = `url('${bannerSrc}')`;
        bannerEl.textContent = '';
      } else {
        bannerEl.style.backgroundImage = '';
        bannerEl.textContent = 'Banner';
      }
    }

    await applyBackground(eid, { layerId: 'publicBg', dim: 0.25 });
  } catch (e) {
    console.warn('[vote] hydrate brand failed', e);
  }
}

function renderOptions(poll) {
  const wrap = $('#optWrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  (poll.options || []).forEach(opt => {
    const button = document.createElement('button');
    button.className = 'opt-card';
    button.disabled = true;
    const img = opt.img || '';
    const label = opt.text || '';
    const initial = (label || '?').slice(0, 1).toUpperCase();
    button.innerHTML = `
      <div class="thumb">
        ${img ? `<img src="${img}" alt="${label}">` : `<div class="thumb-placeholder">${initial}</div>`}
      </div>
      <div class="opt-body">
        <div class="opt-text">${label}</div>
        <div class="opt-meta">Select, then confirm submit</div>
      </div>
    `;
    button.addEventListener('click', () => {
      if (!voterKey) {
        setStatus('Enter your batch number first.');
        return;
      }
      selectedOption = opt;
      wrap.querySelectorAll('.opt-card').forEach(btn => btn.classList.remove('selected'));
      button.classList.add('selected');
      $('#selectedText').textContent = `Selected: ${label}`;
      $('#confirmBar').classList.remove('hidden');
      setStatus('Confirm submit when ready. Vote cannot be changed after submission.');
    });
    wrap.appendChild(button);
  });
}

function bindIdentity() {
  const form = $('#identityForm');
  if (!form || form.dataset.bound) return;
  form.dataset.bound = '1';
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const raw = $('#batchInput')?.value?.trim() || '';
    if (!raw) return;
    setError('');
    setStatus('Checking batch number...');
    try {
      const person = await verifyBatch(raw);
      if (!person) {
        voterKey = '';
        setVoteEnabled(false);
        setStatus('');
        setError('Batch number not found.');
        return;
      }
      voterKey = safeKey(person.code || raw);
      const existing = await FB.get(`/events/${eid}/polls/${pid}/voters/${voterKey}`).catch(() => null);
      if (existing) {
        setVoteEnabled(false);
        $('#done').classList.remove('hidden');
        setStatus('This batch number has already voted.');
        return;
      }
      setVoteEnabled(true);
      setStatus(`Welcome ${person.name || ''}. Select one option, then confirm submit.`);
    } catch (e) {
      console.error('[vote] identity failed', e);
      setError('Could not check this batch number. Please try again.');
    }
  });
}

function bindConfirm() {
  const btn = $('#confirmVote');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', async () => {
    if (!loadedPoll || !isPollOpen(loadedPoll)) {
      setError('Voting is not open.');
      return;
    }
    if (!voterKey || !selectedOption) {
      setStatus('Select an option first.');
      return;
    }
    if (!confirm(`Submit vote for "${selectedOption.text || ''}"? You cannot change it afterwards.`)) return;
    btn.disabled = true;
    setStatus('Submitting vote...');
    try {
      await submitBoundVote(eid, pid, voterKey, selectedOption.id);
      $('#done').classList.remove('hidden');
      $('#confirmBar').classList.add('hidden');
      setStatus('');
      setVoteEnabled(false);
      $('#identityForm')?.querySelectorAll('input,button').forEach(el => { el.disabled = true; });
    } catch (e) {
      console.error('[vote] submit failed', e);
      setError(e?.message || 'Vote could not be submitted.');
    } finally {
      btn.disabled = false;
    }
  });
}

async function main() {
  bindIdentity();
  bindConfirm();

  if (!eid || !pid) {
    setError('Missing event or poll.');
    return;
  }

  await hydrateBrand();
  const poll = await getPoll(eid, pid);
  loadedPoll = poll;
  if (!isPollOpen(poll)) {
    setError('Voting is not open yet.');
    setVoteEnabled(false);
    return;
  }

  $('#pollQ').textContent = poll.question || poll.q || 'Vote';
  renderOptions(poll);

  const batchFromUrl = url.searchParams.get('batch') || '';
  if (batchFromUrl) {
    $('#batchInput').value = batchFromUrl;
    $('#identityForm').dispatchEvent(new Event('submit', { cancelable: true }));
  } else {
    setStatus('Enter your batch number to start voting.');
  }
}

main();
