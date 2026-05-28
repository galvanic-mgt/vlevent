// src/public_stage_boot.js
import { setCurrentEventId } from './core_firebase.js';
import { FB } from './fb.js';
import { renderStageDraw } from './stage_draw_ui.js';
import { applyBackground } from './ui_background.js';

function getEventId() {
  const u = new URL(location.href);
  return u.searchParams.get('event') || null;
}

/**
 * Load logo / banner / background from RTDB and apply to the stage.
 * Uses EXACTLY the same priority as landing.js:
 *   logo   : logo
 *   banner : banner
 *   bg     : background > first photos[] > banner
 */
async function refreshAssets(eid) {
  if (!eid) return;

  const [
    logo,
    banner,
    background,
    photos,
    assetSettings
  ] = await Promise.all([
    FB.get(`/events/${eid}/logo`).catch(() => null),
    FB.get(`/events/${eid}/banner`).catch(() => null),
    FB.get(`/events/${eid}/background`).catch(() => null),
    FB.get(`/events/${eid}/photos`).catch(() => null),
    FB.get(`/events/${eid}/assetSettings`).catch(() => null)
  ]);

  const finalLogo   = logo   || '';
  const finalBanner = banner || '';

  const logoEl   = document.getElementById('stageLogo');
  const bannerEl = document.getElementById('stageBanner');
  const headerEl = logoEl?.closest('.stage-row.header') || bannerEl?.closest('.stage-row.header');
  const hideLogo = assetSettings?.hideLogoOnDraws === true;
  if (headerEl) headerEl.classList.toggle('is-logo-hidden', hideLogo);

  // LOGO box
  if (logoEl) {
    logoEl.style.display = hideLogo ? 'none' : '';
    if (hideLogo) {
      logoEl.style.backgroundImage = '';
      logoEl.textContent = '';
    } else if (finalLogo) {
      logoEl.style.backgroundImage = `url('${finalLogo}')`;
      logoEl.textContent = '';
    } else {
      logoEl.style.backgroundImage = '';
      logoEl.textContent = 'LOGO';
    }
  }

  // BANNER box
  if (bannerEl) {
    if (finalBanner) {
      bannerEl.style.backgroundImage = `url('${finalBanner}')`;
      bannerEl.textContent = '';
    } else {
      bannerEl.style.backgroundImage = '';
      bannerEl.textContent = 'Banner space';
    }
  }

  // Full-page background layer with 25% dim
  await applyBackground(eid, { layerId: 'publicBg', dim: 0.25 });
}

/**
 * Keep 現正抽獎： and 此獎尚餘： in sync on the public board
 */
async function refreshCurrentPrize(eid) {
  if (!eid) return;

  try {
    const [prizes, curId, stageState, rewardRounds] = await Promise.all([
      FB.get(`/events/${eid}/prizes`).catch(() => []),
      FB.get(`/events/${eid}/currentPrizeId`).catch(() => null),
      FB.get(`/events/${eid}/ui/stageState`).catch(() => null),
      FB.get(`/events/${eid}/ui/rewardRounds`).catch(() => ({}))
    ]);

    const nameEl  = document.getElementById('stagePrizeName');
    const leftEl  = document.getElementById('stagePrizeLeft');

    if (stageState && stageState.mode === 'clear') {
      if (nameEl) nameEl.textContent = '—';
      if (leftEl) leftEl.textContent = '—';
      return;
    }

    if (stageState && stageState.mode === 'reward') {
      const round = rewardRounds?.[stageState.currentRoundId] || {};
      const prize = (round.prizes || []).find(p => p && p.id === stageState.currentPrizeId) || null;
      if (nameEl) {
        const roundName = stageState.currentRoundName || round.name || '第二輪抽獎';
        const prizeName = stageState.currentPrizeName || prize?.name || '';
        nameEl.textContent = prizeName ? `${roundName} - ${prizeName}` : roundName;
      }
      if (leftEl) {
        if (prize) {
          const quota = Number(prize.quota || 0);
          const taken = Array.isArray(prize.winners) ? prize.winners.length : 0;
          leftEl.textContent = Math.max(0, quota - taken);
        } else {
          leftEl.textContent = '—';
        }
      }
      return;
    }

    const prize   = (prizes || []).find(p => p && p.id === curId) || null;

    if (nameEl) {
      nameEl.textContent = prize ? (prize.name || '—') : '—';
    }

    if (leftEl) {
      if (prize) {
        const quota  = Number(prize.quota || 0);
        const taken  = Array.isArray(prize.winners) ? prize.winners.length : 0;
        const left   = Math.max(0, quota - taken);
        leftEl.textContent = left;
      } else {
        leftEl.textContent = '—';
      }
    }
  } catch (e) {
    console.warn('[public_stage_boot] refreshCurrentPrize error', e);
  }
}

async function boot() {
  const eid = getEventId();
  if (!eid) {
    console.error('[public_stage_boot] Missing ?event= in URL');
    return;
  }

  // Let core_firebase + CMS side know which event this is
  setCurrentEventId(eid);

  // Render the winners grid once up-front in "public" mode
  try {
    renderStageDraw('public');
  } catch (e) {
    console.warn('[public_stage_boot] renderStageDraw public failed, retrying default', e);
    try { renderStageDraw(); } catch (e2) { console.error(e2); }
  }

  // Ensure countdown overlay starts hidden for public board
  const overlay = document.getElementById('stageCountdown');
  if (overlay) {
    overlay.classList.remove('is-active');
    overlay.style.display = 'none';
  }

  // Initial sync
  await refreshAssets(eid);
  await refreshCurrentPrize(eid);

  // Change streams keep public screens live without constant Firebase polling.
  if (FB?.listen) {
    FB.listen(`/events/${eid}/ui/stageState`, () => refreshCurrentPrize(eid), { fallbackMs: 5000 });
    FB.listen(`/events/${eid}/currentPrizeId`, () => refreshCurrentPrize(eid), { fallbackMs: 5000 });
    FB.listen(`/events/${eid}/prizes`, () => refreshCurrentPrize(eid), { fallbackMs: 5000 });
    FB.listen(`/events/${eid}/ui/rewardRounds`, () => refreshCurrentPrize(eid), { fallbackMs: 5000 });
    FB.listen(`/events/${eid}/logo`, () => refreshAssets(eid), { fallbackMs: 15000 });
    FB.listen(`/events/${eid}/banner`, () => refreshAssets(eid), { fallbackMs: 15000 });
    FB.listen(`/events/${eid}/background`, () => refreshAssets(eid), { fallbackMs: 15000 });
    FB.listen(`/events/${eid}/photos`, () => refreshAssets(eid), { fallbackMs: 15000 });
    FB.listen(`/events/${eid}/assetSettings`, () => refreshAssets(eid), { fallbackMs: 15000 });
  }

  // Allow manual/on-demand asset refresh (reduces bandwidth)
  if (typeof window !== 'undefined') {
    window.refreshPublicAssets = () => refreshAssets(eid);
  }
}

boot();
