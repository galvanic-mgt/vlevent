import { cachePublicV2AudioFiles } from './public_v2_audio_cache.js?v=20260715a';

export const PUBLIC_V2_AUDIO_URLS = Object.freeze({
  lever: new URL('../assets/audio/machine-lever.wav?v=20260715a', import.meta.url).href,
  spin: new URL('../assets/audio/slot-spinning.mp3?v=20260715a', import.meta.url).href,
  votingThird: new URL('../assets/audio/voting-third.m4a?v=20260715a', import.meta.url).href,
  votingSecond: new URL('../assets/audio/voting-second.m4a?v=20260715a', import.meta.url).href,
  votingWinner: new URL('../assets/audio/voting-winner.m4a?v=20260715a', import.meta.url).href
});

export function votingCueForStep(itemCount, revealStep) {
  const count = Math.max(0, Number(itemCount || 0));
  const step = Math.max(0, Math.min(count, Number(revealStep || 0)));
  if (!count || !step) return '';
  const placesLeft = count - step;
  if (placesLeft >= 2) return 'votingThird';
  if (placesLeft === 1) return 'votingSecond';
  return 'votingWinner';
}

export function createPublicV2AudioStateTracker({ onDrawStart, onDrawEnd, onVoteCue } = {}) {
  let initialized = false;
  let lastDrawKey = '';
  let lastPollId = '';
  let lastPollDisplay = '';
  let lastPollStep = 0;

  return {
    sync(state = {}, { initial = false } = {}) {
      const suppressCue = initial || !initialized;
      initialized = true;
      const isPoll = state.mode === 'poll' || state.kind === 'poll';

      if (isPoll) {
        onDrawEnd?.();
        const pollId = state.pollId || '';
        const display = state.pollDisplay || 'results';
        const itemCount = Array.isArray(state.items) ? state.items.length : 0;
        const step = Math.max(0, Math.min(itemCount, Number(state.revealStep || 0)));
        const previousStep = pollId === lastPollId && lastPollDisplay === 'results'
          ? lastPollStep
          : 0;
        if (!suppressCue && display === 'results' && step > previousStep) {
          const cue = votingCueForStep(itemCount, step);
          if (cue) onVoteCue?.(cue);
        }
        lastPollId = pollId;
        lastPollDisplay = display;
        lastPollStep = display === 'results' ? step : 0;
        return;
      }

      const hasCandidates = state.status === 'spinning'
        && Array.isArray(state.candidateNames)
        && state.candidateNames.some(candidate => candidate?.name);
      const drawKey = String(state.drawId || state.updatedAt || '');
      if (hasCandidates && state.instant !== true) {
        if (!suppressCue && drawKey && drawKey !== lastDrawKey) onDrawStart?.();
        if (drawKey) lastDrawKey = drawKey;
        return;
      }
      onDrawEnd?.();
      if (drawKey && state.status === 'revealed') lastDrawKey = drawKey;
    }
  };
}

let context = null;
let prepareTask = null;
let enableTask = null;
let enabled = false;
let rawAudio = null;
let decodedAudio = null;
let spinPlayback = null;
let spinStopTimer = 0;
let votePlayback = null;

function audioContextConstructor() {
  return window.AudioContext || window.webkitAudioContext || null;
}

function audioUnlock(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('The browser blocked the sound unlock. Click Enable Sound again.')), 4000);
    })
  ]);
}

async function responseForAudio(url) {
  const cached = 'caches' in window ? await caches.match(url) : null;
  const response = cached || await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Audio request failed with HTTP ${response.status}`);
  return response;
}

async function prepareAudio() {
  if (prepareTask) return prepareTask;
  prepareTask = (async () => {
    const cacheResult = await cachePublicV2AudioFiles(Object.values(PUBLIC_V2_AUDIO_URLS));
    if (cacheResult.failed) throw new Error(`${cacheResult.failed} Public V2 audio file(s) failed to cache.`);
    const entries = await Promise.all(Object.entries(PUBLIC_V2_AUDIO_URLS).map(async ([name, url]) => {
      const response = await responseForAudio(url);
      return [name, await response.arrayBuffer()];
    }));
    rawAudio = new Map(entries);
    return cacheResult;
  })().catch(error => {
    prepareTask = null;
    throw error;
  });
  return prepareTask;
}

async function decodeAudio() {
  if (decodedAudio) return decodedAudio;
  if (!context || !rawAudio) throw new Error('Public V2 audio is not prepared.');
  const entries = await Promise.all([...rawAudio].map(async ([name, bytes]) => (
    [name, await context.decodeAudioData(bytes.slice(0))]
  )));
  decodedAudio = new Map(entries);
  return decodedAudio;
}

function stopPlayback(playback) {
  if (!playback) return;
  try {
    playback.source.stop();
  } catch (_) {
    // Already stopped.
  }
}

function playBuffer(name, { loop = false, volume = 1 } = {}) {
  const buffer = decodedAudio?.get(name);
  if (!enabled || !context || !buffer) return null;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  source.loop = loop;
  gain.gain.value = volume;
  source.connect(gain);
  gain.connect(context.destination);
  source.start(0);
  return { source, gain };
}

function stopSpin() {
  if (spinStopTimer) clearTimeout(spinStopTimer);
  spinStopTimer = 0;
  stopPlayback(spinPlayback);
  spinPlayback = null;
}

function startDrawAudio() {
  playBuffer('lever', { volume: 1 });
  stopSpin();
  spinPlayback = playBuffer('spin', { loop: true, volume: 0.72 });
  spinStopTimer = setTimeout(stopSpin, 10000);
}

function playVoteCue(name) {
  stopPlayback(votePlayback);
  votePlayback = playBuffer(name, { volume: 1 });
  if (votePlayback) {
    const current = votePlayback;
    current.source.addEventListener('ended', () => {
      if (votePlayback === current) votePlayback = null;
    }, { once: true });
  }
}

const stateTracker = createPublicV2AudioStateTracker({
  onDrawStart: startDrawAudio,
  onDrawEnd: stopSpin,
  onVoteCue: playVoteCue
});

async function enableAudio(button) {
  if (enabled) return;
  if (enableTask) return enableTask;
  enableTask = (async () => {
    const AudioContextClass = audioContextConstructor();
    if (!AudioContextClass) throw new Error('This browser does not support Web Audio.');
    button.disabled = true;
    button.textContent = 'Loading Sound...';
    context = context || new AudioContextClass();
    const resumeTask = audioUnlock(context.resume());
    await prepareAudio();
    await decodeAudio();
    await resumeTask;
    if (context.state !== 'running') await audioUnlock(context.resume());
    if (context.state !== 'running') throw new Error('The browser did not enable sound.');
    enabled = true;
    button.textContent = 'Sound Ready';
    setTimeout(() => {
      button.hidden = true;
    }, 700);
  })().catch(error => {
    button.disabled = false;
    button.textContent = 'Enable Sound';
    console.warn('Public V2 sound could not be enabled.', error);
    throw error;
  }).finally(() => {
    enableTask = null;
  });
  return enableTask;
}

export function initPublicV2Audio(button = document.getElementById('v2SoundEnable')) {
  prepareAudio().catch(error => {
    console.warn('Public V2 sound files could not be prepared.', error);
  });
  if (button) {
    button.hidden = false;
    button.addEventListener('click', () => {
      enableAudio(button).catch(() => {});
    });
  }
  return {
    syncState(state, options) {
      stateTracker.sync(state, options);
    }
  };
}
