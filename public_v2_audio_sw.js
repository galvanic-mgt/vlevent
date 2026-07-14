const AUDIO_CACHE_PREFIX = 'public-v2-audio-';
const AUDIO_CACHE_NAME = `${AUDIO_CACHE_PREFIX}v2`;
const AUDIO_PATH = /\.(?:m4a|mp3|wav)$/i;

function isPublicV2AudioUrl(value) {
  const url = new URL(value, self.location.origin);
  return url.origin === self.location.origin && AUDIO_PATH.test(url.pathname);
}

async function cacheFirstAudio(request) {
  const cache = await caches.open(AUDIO_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.status === 200) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function precacheAudio(urls) {
  const cache = await caches.open(AUDIO_CACHE_NAME);
  const uniqueUrls = [...new Set(urls)].filter(isPublicV2AudioUrl);
  const results = await Promise.allSettled(uniqueUrls.map(async value => {
    const request = new Request(new URL(value, self.location.origin).href, {
      credentials: 'same-origin'
    });
    if (await cache.match(request)) return;
    const response = await fetch(request);
    if (!response.ok || response.status !== 200) {
      throw new Error(`Audio request failed with HTTP ${response.status}`);
    }
    await cache.put(request, response.clone());
  }));
  return {
    requested: uniqueUrls.length,
    cached: results.filter(result => result.status === 'fulfilled').length,
    failed: results.filter(result => result.status === 'rejected').length
  };
}

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(name => (
      name.startsWith(AUDIO_CACHE_PREFIX) && name !== AUDIO_CACHE_NAME
        ? caches.delete(name)
        : Promise.resolve(false)
    )));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || !isPublicV2AudioUrl(request.url)) return;
  event.respondWith(cacheFirstAudio(request));
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'PUBLIC_V2_PRECACHE_AUDIO') return;
  const urls = Array.isArray(event.data.urls) ? event.data.urls : [];
  event.waitUntil(precacheAudio(urls).then(result => {
    event.ports[0]?.postMessage({ ok: result.failed === 0, ...result });
  }));
});
