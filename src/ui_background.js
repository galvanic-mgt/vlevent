// Shared helper to apply a full-page background layer (dimmed) from assets.
import { getAssets } from './core_firebase.js';

/**
 * Ensures there is a fixed, bottom-most background layer and sets its image.
 * Returns the URL that was applied (or '' if none).
 */
export async function applyBackground(eid, {
  layerId = 'publicBg',
  dim = 0.25    // 25% multiply-style darkening
} = {}) {
  if (!eid) return '';

  // Lazy-create the layer
  let layer = document.getElementById(layerId);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = layerId;
    layer.style.position = 'fixed';
    layer.style.inset = '0';
    layer.style.zIndex = '0';
    layer.style.backgroundSize = 'cover';
    layer.style.backgroundPosition = 'center center';
    layer.style.backgroundRepeat = 'no-repeat';
    layer.style.opacity = '0';
    layer.style.transition = 'opacity 200ms ease';
    layer.style.pointerEvents = 'none';
    document.body.prepend(layer);
  }

  // Prefer explicit background, else fall back to photos/banners
  const assets = await getAssets(eid).catch(() => ({}));
  const { background, photos, banner } = assets || {};

  let src = background || '';
  if (!src && Array.isArray(photos) && photos.length) src = photos[0];
  if (!src) src = banner || '';

  if (src) {
    const gradient = dim > 0 ? `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), ` : '';
    layer.style.backgroundImage = `${gradient}url('${src}')`;
    layer.style.opacity = '1';
  } else {
    layer.style.backgroundImage = '';
    layer.style.opacity = '0';
  }

  return src || '';
}
