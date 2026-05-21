import { FB } from './core_firebase.js';

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

async function loadEventAndRender(eid) {
  const db = FB.rtdb;

  const snap = await db.ref(`/events/${eid}`).once('value');
  const eventData = snap.val() || {};

  const logoEl   = document.getElementById('landingLogo');
  const bannerEl = document.getElementById('landingBanner');

  // LOGO
  if (logoEl) {
    if (eventData.logo && eventData.logo.url) {
      logoEl.style.backgroundImage = `url("${eventData.logo.url}")`;
    } else {
      logoEl.style.backgroundImage = '';
      logoEl.textContent = 'No logo';
    }
  }

  // BANNER
  if (bannerEl) {
    if (eventData.banner && eventData.banner.url) {
      bannerEl.style.backgroundImage = `url("${eventData.banner.url}")`;
    } else {
      bannerEl.style.backgroundImage = '';
      bannerEl.textContent = 'No banner';
    }
  }

  // (Optional) show event name somewhere on landing
  const titleEl = document.getElementById('landingEventTitle');
  if (titleEl && eventData.name) {
    titleEl.textContent = eventData.name;
  }
}

async function bootLanding() {
  const eid = getQueryParam('eid');

  if (!eid) {
    console.warn('No eid in URL, landing cannot bind to an event');
    return;
  }

  try {
    await loadEventAndRender(eid);
  } catch (err) {
    console.error('Error loading event for landing', err);
  }
}

window.addEventListener('DOMContentLoaded', bootLanding);
