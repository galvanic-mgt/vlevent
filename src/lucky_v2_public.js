import { FB } from './fb.js?v=20260706b';
import { initEventFromUrl, loadV2Assets, v2Root } from './lucky_v2_core.js?v=20260710c';
import { applyV2Assets, renderV2Stage } from './lucky_v2_stage.js?v=20260714a';
import { initPublicV2Audio } from './public_v2_audio.js?v=20260715c';

const eid = initEventFromUrl();
const publicV2Audio = initPublicV2Audio();
let lastV2State = null;
let lastPublicScreen = null;

function publicScreenRoot(eid) {
  return `/events/${eid}/ui/publicScreen`;
}

function pickStageState() {
  if (lastPublicScreen && (lastPublicScreen.mode === 'poll' || lastPublicScreen.kind === 'poll')) {
    return lastPublicScreen;
  }
  return lastV2State || { status: 'clear', message: 'Waiting for V2 control' };
}

function rerender(options) {
  const state = pickStageState();
  renderV2Stage(state);
  publicV2Audio.syncState(state, options);
}

async function refreshAssets() {
  const assetInfo = await loadV2Assets(eid);
  applyV2Assets(assetInfo);
}

async function boot() {
  if (!eid) {
    renderV2Stage({ status: 'clear', message: 'Missing event ID' });
    return;
  }
  await refreshAssets();
  const [state, publicScreen] = await Promise.all([
    FB.get(`${v2Root(eid)}/ui/stageState`).catch(() => null),
    FB.get(publicScreenRoot(eid)).catch(() => null)
  ]);
  lastV2State = state || { status: 'clear', message: 'Waiting for V2 control' };
  lastPublicScreen = publicScreen || null;
  rerender({ initial: true });
  FB.listen?.(`${v2Root(eid)}/ui/stageState`, next => {
    lastV2State = next || { status: 'clear', message: 'Waiting for V2 control' };
    rerender();
  }, { fallbackMs: 3000 });
  FB.listen?.(publicScreenRoot(eid), next => {
    lastPublicScreen = next || null;
    rerender();
  }, { fallbackMs: 3000 });
  FB.listen?.(`/events/${eid}/assetSettings`, () => {
    refreshAssets().then(rerender).catch(() => {});
  }, { fallbackMs: 15000 });
}

boot();
