function useLocalAssetProxy() {
  return location.protocol === 'http:'
    && ['127.0.0.1', 'localhost'].includes(location.hostname)
    && location.port === '8000';
}

export function localAssetUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || !useLocalAssetProxy() || !/^https?:\/\//i.test(raw)) return raw;
  const url = new URL('/__asset', location.origin);
  url.searchParams.set('url', raw);
  return url.href;
}
