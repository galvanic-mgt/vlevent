import { FB } from './fb.js';
import { getAssets } from './core_firebase.js';
import { applyBackground } from './ui_background.js';

const url = new URL(location.href);
const eid = url.searchParams.get('event');
const pidFromUrl = url.searchParams.get('poll');

const $ = s => document.querySelector(s);

function voteLink(eid, pid){
  const u = new URL(location.href);
  u.pathname = (u.pathname.replace(/[^/]+$/, '') || '/') + 'vote.html';
  u.search = `?event=${encodeURIComponent(eid)}&poll=${encodeURIComponent(pid)}`;
  return u.href;
}

function drawQR(link){
  const panel = $('#qrPanel');
  const qrEl = $('#qr');
  const textEl = $('#qrLink');
  if (!panel) return;
  qrEl.innerHTML = '';
  // eslint-disable-next-line no-undef
  new QRCode(qrEl, { text: link, width: 320, height: 320, correctLevel: QRCode.CorrectLevel.M });
  textEl.textContent = link;
}

// choose which poll to show
async function resolvePollId(eid){
  const url = new URL(location.href);
  const pidFromUrl = url.searchParams.get('poll');
  if (pidFromUrl) return pidFromUrl;
  const ui = await FB.get(`/events/${eid}/ui`);
  return ui?.currentPollId || null;
}


function renderBars(poll){
  $('#pollQ').textContent = poll.question || '投票';
  const votes = poll.votes || {};
  const opts  = poll.options || [];
  const total = Object.values(votes).reduce((a,b)=> a + Number(b || 0), 0);
  $('#total').textContent = `共 ${total} 票`;

  const bars = $('#bars'); bars.innerHTML = '';
  const max = Math.max(1, ...Object.values(votes).map(Number));

  opts.forEach(o=>{
    const count = Number(votes[o.id] || 0);
    const pct = total ? Math.round((count/total)*100) : 0;
    const row = document.createElement('div'); row.className = 'barRow';

    const thumb = document.createElement('div');
    thumb.className = 'barThumb';
    if (o.img) {
      thumb.style.backgroundImage = `url('${o.img}')`;
    } else {
      thumb.textContent = (o.text || '?').slice(0,1).toUpperCase();
    }

    const barWrap = document.createElement('div');
    barWrap.className = 'barWrap';
    const fill = document.createElement('div');
    fill.className = 'barFill';
    fill.style.width = `${Math.max(6, pct)}%`;
    fill.textContent = o.text;
    const label = document.createElement('div');
    label.className = 'barLabel';
    label.textContent = `${count} 票`;

    barWrap.appendChild(fill);
    barWrap.appendChild(label);
    row.appendChild(thumb);
    row.appendChild(barWrap);
    bars.appendChild(row);
  });
}

function playResultSound(step = 0){
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 520 + step * 40;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch (_) {}
}

async function playResultsAnimation(poll){
  const chart = document.getElementById('resultChart');
  const wrap = document.getElementById('resultArea');
  const status = document.getElementById('resultStatus');
  if (!chart || !wrap) return;

  const votes = poll.votes || {};
  const opts = (poll.options || []).map(o => ({
    id: o.id,
    text: o.text || '',
    img: o.img || '',
    count: Number(votes[o.id] || 0)
  }));

  // Reveal in fixed BU/order sequence. The CMS option order is the default BU order.
  // If a poll has resultOrder: ["optionId"], use that explicit order.
  if (Array.isArray(poll.resultOrder) && poll.resultOrder.length) {
    const order = new Map(poll.resultOrder.map((id, i) => [id, i]));
    opts.sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999));
  }

  wrap.classList.remove('hidden');
  chart.innerHTML = '';
  status.textContent = '播放結果動畫中…';

  // build bars
  opts.forEach((o, idx) => {
    const bar = document.createElement('div');
    bar.className = 'rBar';
    bar.innerHTML = `
      <div class="crown">👑</div>
      <div class="rFillWrap"><div class="rFill" data-count="${o.count}"></div></div>
      <div class="rLabel">${o.text}</div>
      <div class="rCount">0 票</div>
    `;
    chart.appendChild(bar);
  });

  // animate one by one
  const fills = Array.from(chart.querySelectorAll('.rFill'));
  for (let i = 0; i < fills.length; i++) {
    const fill = fills[i];
    const count = Number(fill.dataset.count || 0);
    const pct = opts[opts.length - 1].count ? Math.round((count / opts[opts.length - 1].count) * 100) : 0;
    const bar = fill.closest('.rBar');
    const countEl = bar?.querySelector('.rCount');
    const crown = bar?.querySelector('.crown');

    fill.style.height = '0';
    fill.getBoundingClientRect(); // force reflow
    fill.style.height = Math.max(8, pct * 2) + 'px'; // scale height
    if (countEl) countEl.textContent = `${count} 票`;
    if (i === fills.length - 1 && crown) crown.style.opacity = '1';
    playResultSound(i);

    await new Promise(r => setTimeout(r, 900));
  }

  status.textContent = '動畫完畢。再次點擊可重播。';
}

async function getCurrentPollId(){
  // Prefer explicit poll in URL, else read ui.currentPollId
  if (pidFromUrl) return pidFromUrl;
  const ui = await FB.get(`/events/${eid}/ui`);
  return ui?.currentPollId || null;
}

async function refresh(){
  if (!eid) return;
  await applyBackground(eid, { layerId: 'publicBg', dim: 0.25 });

  // read UI flags (show/hide QR, next gift etc.)
  const ui = await FB.get(`/events/${eid}/ui`) || {};
  $('#qrPanel').classList.toggle('hidden', ui.showPollQR === false);

  const pid = pidFromUrl || ui.currentPollId;
  if (!pid) return;

  const poll = await FB.get(`/events/${eid}/polls/${pid}`);
  if (!poll) return;

  // QR uses vote link for this poll
  drawQR(voteLink(eid, pid));
  renderBars(poll);

  // Results animation trigger
  const trigger = ui.pollResultsTrigger || 0;
  if (trigger && trigger !== window.__lastResultsTrigger) {
    window.__lastResultsTrigger = trigger;
    await playResultsAnimation(poll);
  }

  // footer info
  $('#footLeft').textContent = ui.showNextPrize === false ? '' : (ui.nextPrizeLabel || '');
}

(async function boot(){
  if (!eid){ return; }
  // brand + background
  try {
    const assets = await getAssets(eid);
    const logoSrc = assets.logo || '';
    const bannerSrc = assets.banner || '';
    const logoEl = $('#boardLogo');
    const bannerEl = $('#boardBanner');
    if (logoEl) {
      if (logoSrc) {
        logoEl.style.backgroundImage = `url('${logoSrc}')`;
        logoEl.textContent = '';
      } else {
        logoEl.style.backgroundImage = '';
        logoEl.textContent = 'LOGO';
      }
    }
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
    console.warn('[poll board] brand/background load failed', e);
  }
  await refresh();
})();
