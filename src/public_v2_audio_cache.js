const PUBLIC_ROOT = new URL('../', import.meta.url);
const WORKER_URL = new URL('public_v2_audio_sw.js?v=20260715a', PUBLIC_ROOT);
let registrationTask = null;

function canUseAudioCache() {
  return 'serviceWorker' in navigator
    && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
}

export function registerPublicV2AudioCache() {
  if (!canUseAudioCache()) return Promise.resolve(null);
  if (!registrationTask) {
    registrationTask = navigator.serviceWorker.register(WORKER_URL.href, {
      scope: PUBLIC_ROOT.pathname,
      updateViaCache: 'none'
    });
  }
  return registrationTask;
}

function waitForActivation(worker) {
  if (!worker || worker.state === 'activated') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Public V2 audio cache activation timed out.')), 15000);
    worker.addEventListener('statechange', () => {
      if (worker.state !== 'activated') return;
      clearTimeout(timeout);
      resolve();
    });
  });
}

export async function cachePublicV2AudioFiles(urls = []) {
  const registration = await registerPublicV2AudioCache();
  if (!registration || !Array.isArray(urls) || !urls.length) {
    return { ok: true, requested: 0, cached: 0, failed: 0 };
  }

  const replacement = registration.installing || registration.waiting;
  if (replacement) await waitForActivation(replacement);
  const readyRegistration = await navigator.serviceWorker.ready;
  const worker = registration.active || readyRegistration.active;
  if (!worker) throw new Error('Public V2 audio cache worker is not active.');

  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => reject(new Error('Public V2 audio pre-cache timed out.')), 15000);
    channel.port1.onmessage = event => {
      clearTimeout(timeout);
      resolve(event.data);
    };
    worker.postMessage({ type: 'PUBLIC_V2_PRECACHE_AUDIO', urls }, [channel.port2]);
  });
}
