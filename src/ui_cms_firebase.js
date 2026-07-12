import { listEvents, createEvent, setCurrentEventId, getCurrentEventId, getEventInfo, saveEventInfo, getFirebaseDebugUrl,
         getPeople, getPrizes, setPrizes, getCurrentPrizeIdRemote, setCurrentPrizeIdRemote,
         getQuestions, setQuestions, getAssets, setAssets, getPolls, setPoll, upsertEventMeta } from './core_firebase.js';
import { addPrize, removePrize, setCurrentPrize, handlePrizeImportCSV, clearAllPrizes, updatePrize } from './stage_prizes_firebase.js';
import { getRewardRounds, getRewardRoundState, ensureSecondPrizeRound, addRewardRound, addRewardRoundPrize, setCurrentRewardSelection, setCurrentRewardOnStage, drawRewardRoundPrize, updateRewardRound } from './reward_rounds_firebase.js';
import { handleImportCSV, exportCSV } from './roster_firebase.js?v=20260712f';
import { renderStageDraw, stopStageDraw } from './stage_draw_ui.js?v=20260711c';
import { FB } from './fb.js';
import { voteCountsFromPoll } from './polls_public_firebase.js?v=20260712f';
import { writePeopleWithVoterLookup } from './voter_lookup.js?v=20260712f';

(function(){
  const btn = document.getElementById('themeToggle');
  if (!btn) return;

  // Load saved theme
  const saved = localStorage.getItem('cms-theme') || 'dark';
  document.body.classList.toggle('theme-light', saved === 'light');
  updateButton();

  btn.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('theme-light');
    localStorage.setItem('cms-theme', isLight ? 'light' : 'dark');
    updateButton();
  });

  function updateButton(){
    const isLight = document.body.classList.contains('theme-light');
    btn.textContent = isLight ? '🌙 Dark Mode' : '☀️ Normal Mode';
  }
})();


// --- Helpers (IDs / links / QR / chips) ---
function makeId(prefix='p'){ return prefix + Math.random().toString(36).slice(2,8); }
function fileTimestamp(date = new Date()){
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

// --- Current-poll helpers (non-destructive additions) ---
function linkTo(file, eid, pid){
  const u = new URL(location.href);
  u.pathname = (u.pathname.replace(/[^/]+$/, '') || '/') + file;
  u.search = `?event=${encodeURIComponent(eid)}&poll=${encodeURIComponent(pid)}`;
  return u.href;
}

async function setCurrentPoll(eid, pid){
  // Store the current poll id under /events/{eid}/ui so public page can follow
  return window.FB?.patch?.(`/events/${eid}/ui`, { currentPollId: pid, showPollQR: true });
}

function ensureQR(link){
  const host = document.getElementById('pollQR');
  if (!host) return;
  host.innerHTML = `
    <div class="grid-2" style="gap:16px;align-items:center">
      <div id="pollQRCanvas"></div>
      <div>
        <div class="muted" style="word-break:break-all">${link}</div>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
          <button id="copyVoteLink" class="btn">複製投票連結</button>
          <a class="btn" href="${link}" target="_blank" rel="noopener">開啟投票頁</a>
        </div>
      </div>
    </div>
  `;
  if (window.QRCode && document.getElementById('pollQRCanvas')) {
    // eslint-disable-next-line no-undef
    new QRCode(document.getElementById('pollQRCanvas'), {
      text: link, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.M
    });
  }
  document.getElementById('copyVoteLink')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); alert('已複製投票連結'); } catch(e){}
  });
}

function ensureLandingQR(eid) {
  if (!eid) return;

  const link = landingPublicBoardLink(eid);

  // 1) Create the card once under #pageEvent
  let card = document.getElementById('landingQRCard');
  if (!card) {
    const page = document.getElementById('pageEvent');
    if (!page) return;

    card = document.createElement('div');
    card.id = 'landingQRCard';
    card.className = 'card';
    card.style.marginTop = '16px';
    card.innerHTML = `
      <div class="bar" style="justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
        <div>
          <strong>現場報到 / Landing Page</strong>
          <p class="muted" style="margin-top:4px;font-size:13px">
            這個連結和 QR 是給現場參加者報到用的：
            掃描後會開啟 <code>landing.html?event=…</code>，並連接到目前這個活動。
          </p>
        </div>
        <div id="landingQR" style="margin-top:8px"></div>
      </div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.12)">
        <label style="display:flex;flex-direction:column;gap:6px">
          <span>LIVE PHOTO link</span>
          <input id="landingLivePhotoLink" placeholder="https://example.com/live-photo" />
        </label>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button id="saveLandingLivePhotoLink" class="btn primary" type="button">Save LIVE PHOTO link</button>
          <span id="landingLivePhotoStatus" class="muted"></span>
        </div>
      </div>
    `;
    page.appendChild(card);
  }

  // 2) Fill QR + buttons into #landingQR
  const host = document.getElementById('landingQR');
  if (!host) return;

  host.innerHTML = `
    <div class="grid-2" style="gap:16px;align-items:center">
      <div id="landingQRCanvas"></div>
      <div>
        <div class="muted" style="word-break:break-all">${link}</div>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
          <button id="copyLandingLink" class="btn">複製 Landing 連結</button>
          <a class="btn" href="${link}" target="_blank" rel="noopener">開啟 Landing 頁</a>
        </div>
      </div>
    </div>
  `;

  // 3) Create QR code (uses qrcode.min.js already loaded in index.html)
  const canvasHost = document.getElementById('landingQRCanvas');
  if (window.QRCode && canvasHost) {
    // eslint-disable-next-line no-undef
    new QRCode(canvasHost, {
      text: link,
      width: 256,
      height: 256,
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  // 4) Copy button
  document.getElementById('copyLandingLink')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      alert('已複製 Landing 連結');
    } catch (e) {
      // ignore
    }
  });

  const saveLivePhotoBtn = document.getElementById('saveLandingLivePhotoLink');
  if (saveLivePhotoBtn && !saveLivePhotoBtn.dataset.bound) {
    saveLivePhotoBtn.dataset.bound = '1';
    saveLivePhotoBtn.addEventListener('click', async () => {
      const activeEid = getCurrentEventId();
      if (!activeEid) return;
      const input = document.getElementById('landingLivePhotoLink');
      const status = document.getElementById('landingLivePhotoStatus');
      const value = (input?.value || '').trim();
      if (status) {
        status.textContent = 'Saving...';
        status.style.color = '';
      }
      try {
        await FB.patch(`/events/${activeEid}/info`, { landingLivePhotoLink: value });
        if (status) status.textContent = value ? 'LIVE PHOTO link saved.' : 'LIVE PHOTO link cleared.';
      } catch (err) {
        if (status) {
          status.textContent = `Save failed: ${err?.message || String(err)}`;
          status.style.color = '#ff5a67';
        }
      }
    });
  }
}

function ensurePreEventApplyQR(eid) {
  if (!eid) return;

  const link = preEventApplyLink(eid);
  const adminLink = preEventAdminLink(eid);

  let card = document.getElementById('preEventApplyQRCard');
  if (!card) {
    const page = document.getElementById('pageEvent');
    if (!page) return;

    card = document.createElement('div');
    card.id = 'preEventApplyQRCard';
    card.className = 'card';
    card.style.marginTop = '16px';
    card.innerHTML = `
      <div class="bar" style="justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
        <div>
          <strong>預先登記 / Pre-event Application</strong>
          <p class="muted" style="margin-top:4px;font-size:13px">
            這個連結和 QR 是給參加者在活動前填寫申請資料用的：
            掃描後會開啟 <code>pre_event_apply.html?event=…</code>，並連接到目前這個活動。
          </p>
        </div>
        <div id="preEventApplyQR" style="margin-top:8px"></div>
      </div>
    `;
    page.appendChild(card);
  }

  const host = document.getElementById('preEventApplyQR');
  if (!host) return;

  host.innerHTML = `
    <div class="grid-2" style="gap:16px;align-items:center">
      <div id="preEventApplyQRCanvas"></div>
      <div>
        <div class="muted" style="word-break:break-all">${link}</div>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
          <button id="copyPreEventApplyLink" class="btn">複製預先登記連結</button>
          <a class="btn" href="${link}" target="_blank" rel="noopener">開啟預先登記頁</a>
        </div>
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.12)">
          <div class="muted" style="font-size:13px;margin-bottom:6px">預先登記後台 CMS 連結：</div>
          <div class="muted" style="word-break:break-all">${adminLink}</div>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
            <button id="copyPreEventAdminLink" class="btn">複製預先登記 CMS 連結</button>
            <a class="btn" href="${adminLink}" target="_blank" rel="noopener">開啟預先登記 CMS</a>
          </div>
        </div>
      </div>
    </div>
  `;

  const canvasHost = document.getElementById('preEventApplyQRCanvas');
  if (window.QRCode && canvasHost) {
    // eslint-disable-next-line no-undef
    new QRCode(canvasHost, {
      text: link,
      width: 256,
      height: 256,
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  document.getElementById('copyPreEventApplyLink')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      alert('已複製預先登記連結');
    } catch (e) {
      // ignore
    }
  });
  document.getElementById('copyPreEventAdminLink')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(adminLink);
      alert('已複製預先登記 CMS 連結');
    } catch (e) {
      // ignore
    }
  });
}

// Landing button in header: open event-specific landing
function bindLandingButton(){
  const btn = document.getElementById('btnLanding');
  if (!btn) return;
  btn.addEventListener('click', (e)=>{
    e.preventDefault();
    const eid = getCurrentEventId();
    if (!eid) { alert('請先在左側選擇一個活動'); return; }
    window.open(landingPublicBoardLink(eid), '_blank');
  });
}
function bindExternalLinks(){
  const pub = document.getElementById('btnPublicBoard');
  const tab = document.querySelector('a[href$="tablet.html"]');
  ensureVotingControlButton();
  const sync = ()=>updateExternalLinks(pub, tab);
  sync();
  window.addEventListener('popstate', sync);
}
function ensureVotingControlButton(){
  if (document.getElementById('btnVotingControl')) return;
  const bar = document.querySelector('header .bar');
  if (!bar) return;
  const btn = document.createElement('a');
  btn.id = 'btnVotingControl';
  btn.className = 'btn';
  btn.target = '_blank';
  btn.rel = 'noopener';
  btn.textContent = 'Voting Control';
  const publicBtn = document.getElementById('btnPublicBoard');
  if (publicBtn?.nextSibling) bar.insertBefore(btn, publicBtn.nextSibling);
  else bar.appendChild(btn);
}
function updateExternalLinks(pub, tab){
  const eid = getCurrentEventId();
  if (!eid) return;
  const pubEl = pub || document.getElementById('btnPublicBoard');
  const tabEl = tab || document.querySelector('a[href$="tablet.html"]');
  const voteControlEl = document.getElementById('btnVotingControl');
  const voteV2ControlEl = document.getElementById('btnVotingV2Control');
  const voteV2FromLuckyEl = document.getElementById('btnVotingV2FromLucky');
  const voteV2PublicEl = document.getElementById('btnVotingV2Public');
  const votingV2LinksEl = document.getElementById('votingV2Links');
  const luckyV2ControlEl = document.getElementById('btnLuckyV2Control');
  const luckyV2PublicEl = document.getElementById('btnLuckyV2Public');
  const luckyV2LinksEl = document.getElementById('luckyV2Links');
  if (pubEl) pubEl.href = publicBoardLink(eid);
  if (tabEl) tabEl.href = tabletLink(eid);
  if (voteControlEl) voteControlEl.href = votingControlLink(eid);
  const votingControl = votingControlLink(eid);
  const v2Control = luckyV2ControlLink(eid);
  const v2Public = luckyV2PublicLink(eid);
  if (voteV2ControlEl) voteV2ControlEl.href = votingControl;
  if (voteV2FromLuckyEl) voteV2FromLuckyEl.href = votingControl;
  if (voteV2PublicEl) voteV2PublicEl.href = v2Public;
  if (luckyV2ControlEl) luckyV2ControlEl.href = v2Control;
  if (luckyV2PublicEl) luckyV2PublicEl.href = v2Public;
  if (votingV2LinksEl) votingV2LinksEl.innerHTML = `Voting Control: <a href="${votingControl}" target="_blank" rel="noopener">${votingControl}</a><br>V2 Public: <a href="${v2Public}" target="_blank" rel="noopener">${v2Public}</a>`;
  if (luckyV2LinksEl) luckyV2LinksEl.innerHTML = `Lucky Draw Control: <a href="${v2Control}" target="_blank" rel="noopener">${v2Control}</a><br>Voting Control: <a href="${votingControl}" target="_blank" rel="noopener">${votingControl}</a><br>Public: <a href="${v2Public}" target="_blank" rel="noopener">${v2Public}</a>`;
}


function pollPublicBoardLink(eid, pid) {
  const u = new URL(location.href);
  u.pathname = (u.pathname.replace(/[^/]+$/, '') || '/') + 'public_poll.html';
  u.search = `?event=${encodeURIComponent(eid)}&poll=${encodeURIComponent(pid)}`;
  return u.href;
}
function landingPublicBoardLink(eid) {
  const u = new URL(location.href);
  // same folder as index.html, but go to landing.html
  u.pathname = (u.pathname.replace(/[^/]+$/, '') || '/') + 'landing.html';
  u.search = `?event=${encodeURIComponent(eid)}`;
  return u.href;
}
function preEventApplyLink(eid) {
  const u = new URL(location.href);
  u.pathname = (u.pathname.replace(/[^/]+$/, '') || '/') + 'pre_event_apply.html';
  u.search = `?event=${encodeURIComponent(eid)}`;
  return u.href;
}
function preEventAdminLink(eid) {
  const u = new URL(location.href);
  u.pathname = (u.pathname.replace(/[^/]+$/, '') || '/') + 'pre_event_admin.html';
  u.search = `?event=${encodeURIComponent(eid)}`;
  return u.href;
}
function gameBoothVisitorLink(eid, boothId='') {
  const u = new URL(location.href);
  u.pathname = (u.pathname.replace(/[^/]+$/, '') || '/') + 'landing.html';
  const params = new URLSearchParams({ event: eid });
  if (boothId) params.set('booth', boothId);
  u.search = `?${params.toString()}`;
  return u.href;
}
function publicBoardLink(eid) {
  const u = new URL(location.href);
  u.pathname = (u.pathname.replace(/[^/]+$/, '') || '/') + 'public.html';
  u.search = `?event=${encodeURIComponent(eid)}`;
  return u.href;
}
function tabletLink(eid) {
  const u = new URL(location.href);
  u.pathname = (u.pathname.replace(/[^/]+$/, '') || '/') + 'tablet.html';
  u.search = `?event=${encodeURIComponent(eid)}`;
  return u.href;
}
function votingControlLink(eid) {
  const u = new URL(location.href);
  u.pathname = (u.pathname.replace(/[^/]+$/, '') || '/') + 'voting_control.html';
  u.search = `?event=${encodeURIComponent(eid)}`;
  return u.href;
}
function localServerLink(file, eid) {
  if (location.protocol === 'file:') {
    const u = new URL(`http://127.0.0.1:8000/${file}`);
    u.search = `?event=${encodeURIComponent(eid)}`;
    return u.href;
  }
  const u = new URL(location.href);
  u.pathname = (u.pathname.replace(/[^/]+$/, '') || '/') + file;
  u.search = `?event=${encodeURIComponent(eid)}`;
  return u.href;
}
function luckyV2ControlLink(eid) {
  return localServerLink('lucky_v2.html', eid);
}
function luckyV2PublicLink(eid) {
  return localServerLink('lucky_v2_public.html', eid);
}

function showPollQR(link){
  const host = document.getElementById('pollQR');
  if (!host) return;
  host.innerHTML = `
    <div class="grid-2" style="gap:16px;align-items:center">
      <div id="pollQRCanvas"></div>
      <div>
        <div class="muted" style="word-break:break-all">${link}</div>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
          <button id="copyVoteLink" class="btn">複製投票連結</button>
          <a class="btn" href="${link}" target="_blank" rel="noopener">開啟投票頁</a>
        </div>
      </div>
    </div>`;
  if (window.QRCode && document.getElementById('pollQRCanvas')) {
    // eslint-disable-next-line no-undef
    new QRCode(document.getElementById('pollQRCanvas'), {
      text: link, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.M
    });
  }
  document.getElementById('copyVoteLink')?.addEventListener('click', async ()=>{
    try { await navigator.clipboard.writeText(link); alert('已複製投票連結'); } catch(e){}
  });
}

function createChip(text){
  const span = document.createElement('span');
  span.className = 'chip';
  span.textContent = text;
  span.style.cssText = 'display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;background:rgba(255,255,255,.08)';
  const x = document.createElement('button');
  x.textContent = '×';
  x.className = 'btn';
  x.style.cssText = 'margin-left:6px;padding:0 6px;line-height:1.2';
  x.onclick = ()=> span.remove();
  span.appendChild(x);
  return span;
}

function getChipValues(){
  return Array.from(document.querySelectorAll('#optChips .chip'))
    .map(ch => ch.firstChild?.nodeValue?.trim()).filter(Boolean);
}

// ====== Roster table state (sorting, paging, caching) ======
const rosterState = {
  sortBy: 'name',
  sortDir: 'asc',   // 'asc' | 'desc'
  page: 1,
  pageSize: 50,
  cache: []         // last fetched people (unfiltered)
};

const personKey = (p)=>{
  if (!p) return '';
  const phone = (p.phone || '').trim();
  const name  = (p.name  || '').trim();
  const dept  = (p.dept  || '').trim();
  return phone ? `phone:${phone}` : `${name}||${dept}`;
};

// ====== Simple user/role manager (local storage, 2 roles, credentials, allowed events) ======
const ROLE_MASTER = 'master';
const ROLE_ROSTER = 'roster';
const ACTIVE_KEY = 'cms-active-user';
const SESSION_KEY = 'cms-session-ok';
let usersCache = [];
const DEFAULT_USER = { id:'u-master', name:'Admin', role:ROLE_MASTER, username:'administrator', password:'administrator', events:[] };
const CMS_LOGIN_DISABLED_FOR_TESTING = true;

function normalizeUser(u = {}){
  const events = Array.isArray(u.events) ? u.events : [];
  return {
    id: (u.id || '').toString(),
    name: (u.name || '').toString(),
    role: (u.role || '').toString() || ROLE_ROSTER,
    username: (u.username || '').toString(),
    password: (u.password || '').toString(),
    events: events.map(e => (e || '').toString()).filter(Boolean)
  };
}

async function loadUsersFromDB(){
  try {
    const data = await FB.get('/users') || {};
    usersCache = Object.entries(data)
      .map(([id, u])=> normalizeUser({ id, ...u }))
      .filter(u=>u && u.id);
  } catch (e) {
    usersCache = [];
  }
  const hasDefault = usersCache.some(u => u.id === DEFAULT_USER.id || u.username === DEFAULT_USER.username);
  if (!hasDefault) {
    usersCache = [...usersCache, DEFAULT_USER];
    try { await FB.put(`/users/${DEFAULT_USER.id}`, { name:DEFAULT_USER.name, role:DEFAULT_USER.role, username:DEFAULT_USER.username, password:DEFAULT_USER.password, events:DEFAULT_USER.events }); } catch(_) {}
  }
  if (!usersCache.length) {
    usersCache = [DEFAULT_USER];
  }
}
async function saveUserToDB(user){
  const clean = normalizeUser(user);
  if (!clean.id) return;
  await FB.put(`/users/${clean.id}`, {
    name: clean.name,
    role: clean.role,
    username: clean.username,
    password: clean.password,
    events: clean.events
  });
  const saved = await FB.get(`/users/${clean.id}`);
  if (!saved || saved.username !== clean.username) {
    throw new Error('Firebase 寫入後未能讀回新使用者。');
  }
  await loadUsersFromDB();
  const normalized = normalizeUser({ id: clean.id, ...saved });
  if (!usersCache.some(u => u.id === clean.id)) {
    usersCache = [...usersCache, normalized];
  }
  return normalized;
}
async function deleteUserFromDB(id){
  await FB.put(`/users/${id}`, null);
  await loadUsersFromDB();
}
function getActiveUser(){
  if (CMS_LOGIN_DISABLED_FOR_TESTING) return DEFAULT_USER;
  const id = localStorage.getItem(ACTIVE_KEY);
  const found = usersCache.find(u => u.id === id);
  return found || { id:'', name:'', role: '', events: [] };
}
function setActiveUser(id){
  const exists = usersCache.some(u => u.id === id);
  if (exists) localStorage.setItem(ACTIVE_KEY, id || '');
  else localStorage.removeItem(ACTIVE_KEY);
  applyRoleGuard();
}
function canManageAllEvents(user = getActiveUser()){
  return user?.role === ROLE_MASTER || !(user?.events || []).length;
}
function canAccessEvent(id, user = getActiveUser()){
  if (!id) return false;
  if (canManageAllEvents(user)) return true;
  return (user.events || []).includes(id);
}
function filterEventsForActiveUser(events = []){
  const user = getActiveUser();
  if (canManageAllEvents(user)) return events;
  return events.filter(ev => canAccessEvent(ev.id, user));
}
async function ensureUsersLoaded(){
  if (!usersCache.length) await loadUsersFromDB();
}
function setUserStatus(text = '', isError = false){
  const el = document.getElementById('userStatus');
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? '#ff5a67' : '';
}
function requireMasterPassword(){
  const active = getActiveUser();
  if (!active?.id) { alert('請先登入 Master 帳號'); return false; }
  if (active.role !== ROLE_MASTER) { alert('只有 Master 可以變更使用者'); return false; }
  const pwd = prompt('請輸入 Master 密碼以繼續：')?.trim();
  if (pwd !== (active.password || '')) { alert('密碼不正確'); return false; }
  return true;
}

function applyRoleGuard(){
  const user = getActiveUser();
  const role = user?.role || '';
  document.body.dataset.role = role;

  const allowAll = role === ROLE_MASTER;
  document.querySelectorAll('#cmsNav .nav-item').forEach(btn=>{
    const target = btn.dataset.target;
    if (!allowAll && target && !['pageRoster'].includes(target)) {
      btn.style.display = 'none';
    } else {
      btn.style.display = '';
    }
  });

  // Hide pages for roster-only role
  if (!allowAll) {
    document.querySelectorAll('.subpage').forEach(sec=>{
      if (!['pageRoster'].includes(sec.id)) sec.style.display = 'none';
    });
    const rosterBtn = document.querySelector('#cmsNav .nav-item[data-target="pageRoster"]');
    rosterBtn?.classList.add('active');
    show('pageRoster');
  } else {
    document.querySelectorAll('#cmsNav .nav-item').forEach(btn=> btn.style.display='');
  }
}

function renderUsersUI(){
  const tbody = document.getElementById('userRows');
  const sel = document.getElementById('activeUser');
  if (!tbody || !sel) return;
  const users = usersCache;
  const active = getActiveUser().id;

  tbody.innerHTML = '';
  if (!users.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="muted">尚未建立使用者，請使用預設帳號登入：administrator / administrator</td>';
    tbody.appendChild(tr);
  }
  users.forEach(u=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.name || ''}<br><small>${u.username || ''}</small></td>
      <td>${u.role === ROLE_MASTER ? 'Master' : '名單管理'}</td>
      <td>${(u.events||[]).length ? u.events.join(', ') : '全部'}</td>
      <td>
        <button class="btn small" data-edit="${u.id}">編輯</button>
        <button class="btn small danger" data-del="${u.id}">刪除</button>
      </td>`;
    tr.querySelector('[data-edit]')?.addEventListener('click', async ()=>{
      if (!requireMasterPassword()) return;
      const name = prompt('名稱：', u.name || '')?.trim();
      if (!name) return;
      const username = prompt('登入帳號：', u.username || '')?.trim();
      if (!username) return;
      const password = prompt('登入密碼：', u.password || '')?.trim();
      if (!password) return;
      const role = prompt('角色（master / roster）：', u.role || ROLE_ROSTER)?.trim() || ROLE_ROSTER;
      const eventsRaw = prompt('允許的活動 ID（用逗號分隔，留空=全部）：', (u.events||[]).join(','));
      const events = eventsRaw ? eventsRaw.split(',').map(s=>s.trim()).filter(Boolean) : [];
      usersCache = usersCache.map(x => x.id === u.id ? { ...x, name, username, password, role, events } : x);
      try {
        await saveUserToDB(usersCache.find(x=>x.id===u.id));
        renderUsersUI();
        applyRoleGuard();
      } catch (err) {
        console.error('[users] edit failed', err);
        alert('無法儲存使用者，請確認權限或規則設定。');
      }
    });
    tr.querySelector('[data-del]')?.addEventListener('click', async ()=>{
      if (!requireMasterPassword()) return;
      try {
        await deleteUserFromDB(u.id);
        if (active === u.id) setActiveUser(usersCache[0]?.id || '');
        renderUsersUI();
        applyRoleGuard();
      } catch (err) {
        console.error('[users] delete failed', err);
        alert('無法刪除使用者，請確認權限或規則設定。');
      }
    });
    tbody.appendChild(tr);
  });

  sel.innerHTML = '';
  users.forEach(u=>{
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = `${u.name} (${u.role === ROLE_MASTER ? 'Master' : '名單'})`;
    if (u.id === active) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.onchange = ()=> setActiveUser(sel.value);
  if (!active && users[0]) {
    sel.value = '';
  }
}

function bindUsers(){
  const addBtn = document.getElementById('btnAddUser');
  if (!addBtn || addBtn.dataset.bound) return;
  addBtn.dataset.bound = '1';
  addBtn.addEventListener('click', async ()=>{
    await ensureUsersLoaded();
    const active = getActiveUser();
    if (active.role !== ROLE_MASTER) {
      setUserStatus('只有 Master 可以新增使用者。', true);
      return;
    }
    const name = document.getElementById('userName')?.value.trim();
    const username = document.getElementById('userLogin')?.value.trim();
    const password = document.getElementById('userPassword')?.value.trim();
    const role = document.getElementById('userRole')?.value || ROLE_ROSTER;
    const eventsRaw = document.getElementById('userEvents')?.value.trim() || '';
    if (!name || !username || !password) {
      setUserStatus('請填寫名稱、登入帳號及登入密碼。', true);
      return;
    }
    if (usersCache.some(u => u.username === username)) {
      setUserStatus('登入帳號已存在，請使用另一個帳號。', true);
      return;
    }
    const events = eventsRaw ? eventsRaw.split(',').map(s=>s.trim()).filter(Boolean) : [];
    const id = 'u-' + Math.random().toString(36).slice(2,8);
    const newUser = normalizeUser({ id, name, role, username, password, events });
    try {
      setUserStatus('正在寫入 Firebase...');
      await saveUserToDB(newUser);
    } catch (err) {
      console.error('[users] add failed', err);
      setUserStatus(`新增使用者失敗：${err?.message || String(err)}`, true);
      return;
    }
    document.getElementById('userName').value = '';
    document.getElementById('userLogin').value = '';
    document.getElementById('userPassword').value = '';
    document.getElementById('userEvents').value = '';
    setUserStatus(`已新增使用者：${name}`);
    renderUsersUI();
    applyRoleGuard();
  });
}

// Simple login using stored users (RTDB-backed)
function bindLogin(){
  const gate = document.getElementById('loginGate');
  const form = document.getElementById('loginForm');
  if (!gate || !form) return true;
  const userInput = document.getElementById('loginUser');
  const passInput = document.getElementById('loginPass');
  const errorEl = document.getElementById('loginError');
  if (CMS_LOGIN_DISABLED_FOR_TESTING) {
    document.body.classList.remove('cms-auth-pending');
    document.body.classList.remove('cms-locked');
    gate.style.display = 'none';
    if (errorEl) errorEl.textContent = '';
    return true;
  }
  const lock = (msg = '') => {
    document.body.classList.remove('cms-auth-pending');
    document.body.classList.add('cms-locked');
    gate.style.display = 'flex';
    if (errorEl) errorEl.textContent = msg;
  };
  const unlock = () => {
    document.body.classList.remove('cms-auth-pending');
    document.body.classList.remove('cms-locked');
    gate.style.display = 'none';
    if (errorEl) errorEl.textContent = '';
  };
  const doLogin = async (u, p)=>{
    await loadUsersFromDB();
    let found = usersCache.find(x => x.username === u && x.password === p);
    // fallback: if they enter the default credentials, re-seed the default account and use it
    if (!found && u === DEFAULT_USER.username && p === DEFAULT_USER.password) {
      try { await FB.put(`/users/${DEFAULT_USER.id}`, { name:DEFAULT_USER.name, role:DEFAULT_USER.role, username:DEFAULT_USER.username, password:DEFAULT_USER.password, events:DEFAULT_USER.events }); } catch(_){}
      await loadUsersFromDB();
      found = usersCache.find(x => x.username === u && x.password === p);
    }
    if (found) {
      setActiveUser(found.id);
      sessionStorage.setItem(SESSION_KEY, '1');
      unlock();
      window.location.reload();
      return true;
    }
    lock('帳號或密碼錯誤');
    if (passInput) {
      passInput.value = '';
      passInput.focus();
    }
    return false;
  };
  if (!form.dataset.bound) {
    form.dataset.bound = '1';
    form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const u = userInput?.value?.trim() || '';
    const p = passInput?.value?.trim() || '';
      if (!u || !p) {
        lock('請輸入帳號及密碼');
        return;
      }
    doLogin(u,p);
    });
  }
  // Use the persisted active user as the login record. sessionStorage can disappear
  // between tabs/reloads, but logout clears ACTIVE_KEY.
  if (getActiveUser()?.id) {
    sessionStorage.setItem(SESSION_KEY, '1');
    unlock();
    return true;
  } else {
    lock();
    return false;
  }
}

function bindLogout(){
  const btn = document.getElementById('btnLogout');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(ACTIVE_KEY);
    document.body.classList.add('cms-auth-pending');
    window.location.reload();
  });
}
// ====== Prize table state (sorting only) ======
const prizeState = {
  sortBy: 'no',
  sortDir: 'asc' // 'asc' | 'desc'
};
// ===========================================================

let bootEventsAdmin = ()=>{};
// load optional admin module without top-level await
(async ()=>{
  try {
    const mod = await import('./events_admin.js');
    bootEventsAdmin = mod.bootEventsAdmin;
  } catch(e) {
    console.warn('events_admin.js failed to load:', e);
  }
})();
const $=(s)=>document.querySelector(s);
function showFirebaseStatus(text, isError = false){
  let el = document.getElementById('firebaseStatus');
  const host = document.getElementById('eventList')?.parentElement;
  if (!el && host) {
    el = document.createElement('div');
    el.id = 'firebaseStatus';
    el.className = 'muted';
    el.style.cssText = 'font-size:12px;margin:6px 0;display:flex;align-items:center;gap:6px;word-break:break-word';
    host.insertBefore(el, document.getElementById('eventList'));
  }
  if (!el) return;
  el.innerHTML = isError
    ? `<span style="width:8px;height:8px;border-radius:999px;background:#ff5a67;display:inline-block;flex:0 0 auto"></span><span>${text || 'Database connection failed'}</span>`
    : '<span style="width:8px;height:8px;border-radius:999px;background:#4cd964;display:inline-block;flex:0 0 auto"></span><span>Database connected</span>';
  el.style.color = isError ? '#ff5a67' : '';
}
function show(targetId){
  document.querySelectorAll('.subpage').forEach(s=> s.style.display='none');
  const sec = document.getElementById(targetId);
  if (sec) sec.style.display = 'block';

  document.querySelectorAll('#cmsNav .nav-item')
    .forEach(b => b.classList.toggle('active', b.dataset.target === targetId));

  // If we just switched to the Lucky Draw tab, render it now (once per show)
  if (targetId === 'pageStageDraw') {
    renderStageDraw('cms');
  } else {
    stopStageDraw();
  }
  if (targetId === 'pageRewardRounds') {
    renderRewardRounds();
  }
}
async function renderEventList(){
  let listRaw = [];
  try {
    listRaw = await listEvents();
    showFirebaseStatus('Database connected');
  } catch (error) {
    console.error('[CMS] listEvents failed', error);
    showFirebaseStatus(`Firebase read failed: ${getFirebaseDebugUrl('/events_index')} | ${error?.message || String(error)}`, true);
    const el = $('#eventList');
    if (el) {
      el.innerHTML = `<div class="muted" style="color:#ff5a67">Firebase event list read failed: ${error?.message || String(error)}</div>`;
    }
    return;
  }
  const allListedEvents = (Array.isArray(listRaw) ? listRaw : []).filter(ev => ev.listed !== false);
  const list = filterEventsForActiveUser(allListedEvents);

  const el = $('#eventList'); if(!el) return; el.innerHTML = '';
  showFirebaseStatus('Database connected');

  list.forEach(ev=>{
    const item = document.createElement('div');
    item.className = 'event-item' + (getCurrentEventId() === ev.id ? ' active' : '');
    item.innerHTML = `<div class="event-name">${ev.name || '（未命名）'}</div><div class="event-meta">ID: ${ev.id}${ev.listed === false ? ' · unlisted' : ''}</div>`;
    item.onclick = async ()=>{
      const current = getCurrentEventId();
      if (current && current !== ev.id) {
        const ok = confirm(`即將切換到「${ev.name}」活動，確定嗎？`);
        if (!ok) return;
      }
      setCurrentEventId(ev.id);
      await renderAll();
    };
    el.appendChild(item);
  });
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.style.color = '#ffb74d';
    empty.textContent = allListedEvents.length
      ? 'No events assigned to this user.'
      : 'Firebase connected, but /events_index has 0 events.';
    el.appendChild(empty);
  } else if (!el.querySelector('.event-item')) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.style.color = '#ffb74d';
    empty.textContent = `Firebase returned ${list.length} events, but CMS could not render event cards.`;
    el.appendChild(empty);
  }

  if (!canManageAllEvents()) return;

  // Creator stays the same
  const ad = document.createElement('div'); ad.className = 'sidebar-form';
  ad.innerHTML = `
    <input id="newEventName" placeholder="新增活動名稱" />
    <input id="newClientName" placeholder="客戶名稱" />
    <button id="btnAddEvent" class="btn primary">+ 新活動</button>`;
  el.appendChild(ad);

  ad.querySelector('#btnAddEvent').onclick = async ()=>{
    const name = ad.querySelector('#newEventName').value.trim();
    const client = ad.querySelector('#newClientName').value.trim();
    const id = await createEvent(name, client);
    setCurrentEventId(id);
    await renderAll();
  };
}
async function renderEventInfo(){
  const eid=getCurrentEventId();
  if(!eid)return;const {meta,info}=await getEventInfo(eid);
  const t=(id,val)=>{const e=document.getElementById(id);if(e)e.value=val||'';};
  t('evLabelPhone', info.labelPhone);
t('evLabelDept',  info.labelDept);
t('evTitle',info.title);
t('evClient',info.client);
t('evDateTime',info.dateTime);
t('evVenue',info.venue);
t('evAddress',info.address);
t('evMapUrl',info.mapUrl);
t('evBus',info.bus);
t('evTrain',info.train);
t('evParking',info.parking);
t('evNotes',info.notes);
t('landingPageTitle',info.landingPageTitle);
t('landingCheckinTitle',info.landingCheckinTitle);
t('landingCheckinLabel',info.landingCheckinLabel);
t('landingCheckinPlaceholder',info.landingCheckinPlaceholder);
t('landingCheckinButton',info.landingCheckinButton);
t('landingSeatTitle',info.landingSeatTitle);
t('landingTipTitle',info.landingTipTitle);
t('landingTipBody',info.landingTipBody);
t('landingTransportTitle',info.landingTransportTitle);
t('landingBusTitle',info.landingBusTitle);
t('landingTrainTitle',info.landingTrainTitle);
t('landingParkingTitle',info.landingParkingTitle);
t('landingMapButton',info.landingMapButton);
t('metaName',meta.name);
t('metaClient',meta.client);
{ const el=document.getElementById('metaListed');
  if(el) el.checked = meta.listed!==false; }
    ensureLandingQR(eid);
    t('landingLivePhotoLink', info.landingLivePhotoLink);
    { const el=document.getElementById('landingLivePhotoStatus'); if(el) el.textContent = ''; }
    ensurePreEventApplyQR(eid);
}

function bindEventInfoSave(){
  document.getElementById('saveEventInfo')?.addEventListener('click', async ()=>{
    const eid=getCurrentEventId(); if(!eid) return;
    const g=id=>document.getElementById(id)?.value||'';

    await saveEventInfo(eid, {
      title:g('evTitle'),
      client:g('evClient'),
      dateTime:g('evDateTime'),
      venue:g('evVenue'),
      address:g('evAddress'),
      mapUrl:g('evMapUrl'),
      bus:g('evBus'),
      train:g('evTrain'),
      parking:g('evParking'),
      notes:g('evNotes'),

      landingPageTitle: g('landingPageTitle'),
      landingCheckinTitle: g('landingCheckinTitle'),
      landingCheckinLabel: g('landingCheckinLabel'),
      landingCheckinPlaceholder: g('landingCheckinPlaceholder'),
      landingCheckinButton: g('landingCheckinButton'),
      landingSeatTitle: g('landingSeatTitle'),
      landingTipTitle: g('landingTipTitle'),
      landingTipBody: g('landingTipBody'),
      landingTransportTitle: g('landingTransportTitle'),
      landingBusTitle: g('landingBusTitle'),
      landingTrainTitle: g('landingTrainTitle'),
      landingParkingTitle: g('landingParkingTitle'),
      landingMapButton: g('landingMapButton'),

      labelPhone: g('evLabelPhone'),
      labelDept:  g('evLabelDept')
    });

    await upsertEventMeta(eid, {
      name:g('metaName')||g('evTitle')||'新活動',
      client:g('metaClient'),
      listed:document.getElementById('metaListed').checked
    });

    await renderAll();
  });
}
function updateRosterCounters(list = []){
  const total = Array.isArray(list) ? list.length : 0;
  const checked = Array.isArray(list) ? list.filter(p => p && p.checkedIn).length : 0;
  const totalEl = document.getElementById('rosterCount');
  const chkEl   = document.getElementById('rosterChecked');
  if (totalEl) totalEl.textContent = `共 ${total} 人`;
  if (chkEl)   chkEl.textContent   = `已報到：${checked} 人`;
}
function setRosterSyncStatus(text){
  const el = document.getElementById('rosterSync');
  if (!el) return;
  el.textContent = text;
}
async function setPeopleWithSync(eid, people){
  setRosterSyncStatus('更新中…');
  try {
    await writePeopleWithVoterLookup(eid, people);
    setRosterSyncStatus('已更新');
  } catch (err) {
    console.error('[roster] sync failed', err);
    setRosterSyncStatus('更新失敗');
    throw err;
  }
}
function rosterWriteWithTimeout(promise, ms = 12000){
  let timer;
  const timeout = new Promise((_, reject)=>{
    timer = setTimeout(()=> reject(new Error('Roster attendance update timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(()=> clearTimeout(timer));
}
async function setRosterAttendanceWithSync(eid, people, person, checkedIn){
  const idx = people.indexOf(person);
  if (idx < 0) throw new Error('Roster row not found for attendance update');
  setRosterSyncStatus('更新中…');
  try {
    await rosterWriteWithTimeout(FB.patch(`/events/${eid}/people/${idx}`, { checkedIn }));
    person.checkedIn = checkedIn;
    setRosterSyncStatus('已更新');
  } catch (err) {
    console.error('[roster] attendance sync failed', err);
    setRosterSyncStatus('更新失敗');
    throw err;
  }
}
async function setRosterPageAttendanceWithSync(eid, people, rows, checkedIn){
  const patch = {};
  rows.forEach(person => {
    const idx = people.indexOf(person);
    if (idx < 0) throw new Error('Roster row not found for attendance update');
    patch[`${idx}/checkedIn`] = checkedIn;
  });
  setRosterSyncStatus('更新中…');
  try {
    await rosterWriteWithTimeout(FB.patch(`/events/${eid}/people`, patch));
    rows.forEach(person => { person.checkedIn = checkedIn; });
    setRosterSyncStatus('已更新');
  } catch (err) {
    console.error('[roster] attendance sync failed', err);
    setRosterSyncStatus('更新失敗');
    throw err;
  }
}
function makeLogKey(){
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
}
async function logAttendanceChange(eid, person, checkedIn){
  if (!eid || !person) return;
  const entry = {
    ts: Date.now(),
    action: checkedIn ? 'checkin' : 'cancel',
    name: person.name || '',
    phone: person.phone || '',
    code: person.code || '',
    dept: person.dept || '',
    table: person.table || '',
    seat: person.seat || ''
  };
  const key = makeLogKey();
  try {
    await FB.patch(`/events/${eid}/attendance_log`, { [key]: entry });
  } catch (err) {
    console.warn('[roster] attendance log failed', err);
  }
}
function queueAttendanceLog(eid, person, checkedIn){
  rosterWriteWithTimeout(logAttendanceChange(eid, person, checkedIn), 5000)
    .catch(err => console.warn('[roster] attendance log failed', err));
}
function csvEscape(val){
  const s = String(val ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}
async function exportAttendanceLog(eid){
  const raw = (await FB.get(`/events/${eid}/attendance_log`)) || {};
  const list = Array.isArray(raw) ? raw.filter(Boolean) : Object.values(raw || {});
  list.sort((a,b)=>(a?.ts||0)-(b?.ts||0));
  const header = ['timestamp','action','name','phone','code','dept','table','seat'];
  const rows = [header.join(',')];
  list.forEach(entry=>{
    const ts = entry?.ts ? new Date(entry.ts).toISOString() : '';
    const action = entry?.action === 'cancel' ? '取消' : '出席';
    rows.push([
      ts,
      action,
      entry?.name || '',
      entry?.phone || '',
      entry?.code || '',
      entry?.dept || '',
      entry?.table || '',
      entry?.seat || ''
    ].map(csvEscape).join(','));
  });
  return "\ufeff" + rows.join('\n');
}

function rosterPrizeKeys(p = {}) {
  const phone = String(p.phone || '').trim();
  const code = String(p.code || p.staffId || '').trim();
  const name = String(p.name || '').trim();
  const dept = String(p.dept || p.department || '').trim();
  const keys = [];
  if (phone) keys.push(`phone:${phone}`);
  if (code) keys.push(`code:${code}`);
  if (name || dept) keys.push(`name:${name}||${dept}`);
  return keys;
}

function v2RewardTextForPerson(p, v2PrizeMap) {
  if (!v2PrizeMap) return [];
  const found = new Set();
  rosterPrizeKeys(p).forEach(key => {
    (v2PrizeMap.get(key) || []).forEach(label => found.add(label));
  });
  return Array.from(found);
}

function addV2Reward(map, winner, label) {
  if (!winner || !label) return;
  const keys = new Set(rosterPrizeKeys(winner));
  if (winner.key) keys.add(String(winner.key));
  keys.forEach(key => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    const rewards = map.get(key);
    if (!rewards.includes(label)) rewards.push(label);
  });
}

function collectV2RosterPrizeMap(v2 = {}) {
  const map = new Map();
  const addBatch = batch => {
    if (!batch || batch.undone === true || batch.supersededBy) return;
    const prizeName = String(batch.prizeName || '').trim();
    if (!prizeName) return;
    const roundName = batch.mode === 'extra' && batch.roundName ? `${batch.roundName}: ` : '';
    const label = `V2: ${roundName}${prizeName}`;
    (Array.isArray(batch.winners) ? batch.winners : []).forEach(winner => addV2Reward(map, winner, label));
  };

  Object.values(v2?.main?.batches || {}).forEach(addBatch);
  Object.values(v2?.rewardRounds || {}).forEach(round => {
    Object.values(round?.batches || {}).forEach(addBatch);
  });
  return map;
}

function rewardText(p, v2PrizeMap){
  const main = p?.prize ? `🎁 ${p.prize}` : '';
  const extra = Object.entries(p?.rewardRounds || {})
    .map(([round, prize]) => `${round}: ${prize}`)
    .join('<br>');
  const v2 = v2RewardTextForPerson(p, v2PrizeMap).join('<br>');
  return [main, extra, v2].filter(Boolean).join('<br>');
}

function formatHongKongDateTime(value, fallbackText = ''){
  if (!value && fallbackText) return fallbackText;
  if (!value) return '';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return fallbackText || '';
  return new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

function firstLoginText(p){
  return p?.firstLoginAtHK || formatHongKongDateTime(p?.firstLoginAt);
}

function lastLoginText(p){
  return p?.lastLoginAtHK || formatHongKongDateTime(p?.lastLoginAt);
}

async function renderRoster(){
  const eid = getCurrentEventId(); if(!eid) return;

  // labels
  const { info } = await getEventInfo(eid);
  const phoneLabel = info?.labelPhone || 'Phone';
  const deptLabel  = info?.labelDept  || 'Department';
  { const el=document.getElementById('hdrPhone'); if(el) el.textContent=phoneLabel; }
  { const el=document.getElementById('hdrDept');  if(el) el.textContent=deptLabel; }
  { const el=document.getElementById('thPhone');  if(el) el.textContent=phoneLabel; }
  { const el=document.getElementById('thDept');   if(el) el.textContent=deptLabel; }

  // data
  const [people, v2] = await Promise.all([
    getPeople(eid),
    FB.get(`/events/${eid}/ui/luckyV2`).catch(() => ({}))
  ]);
  const v2PrizeMap = collectV2RosterPrizeMap(v2 || {});
  rosterState.cache = people;
  updateRosterCounters(people);

  // filter
  const q = (document.getElementById('searchGuest')?.value || '').toLowerCase();
  let list = people.filter(p=>{
    const extraRewards = Object.values(p.rewardRounds || {}).join(' ');
    const v2Rewards = v2RewardTextForPerson(p, v2PrizeMap).join(' ');
    const hay = [p.name,p.dept,p.phone,p.code,p.table,p.seat,firstLoginText(p),lastLoginText(p),p.prize,extraRewards,v2Rewards].map(x=>(x||'').toLowerCase()).join(' ');
    return hay.includes(q);
  });

  // sort
  const { sortBy, sortDir } = rosterState;
  list.sort((a,b)=>{
    const va = (a?.[sortBy] ?? '').toString().toLowerCase();
    const vb = (b?.[sortBy] ?? '').toString().toLowerCase();
    if(va < vb) return sortDir === 'asc' ? -1 : 1;
    if(va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  // paging
  const pageSizeEl = document.getElementById('pageSize');
  if(pageSizeEl){
    rosterState.pageSize = parseInt(pageSizeEl.value,10) || 50;
  }
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / rosterState.pageSize));
  rosterState.page = Math.min(Math.max(1, rosterState.page), totalPages);
  const start = (rosterState.page - 1) * rosterState.pageSize;
  const pageSlice = list.slice(start, start + rosterState.pageSize);
  const checkAll = document.getElementById('rosterCheckAll');
  if (checkAll) {
    const checkedCount = pageSlice.filter(p => p && p.checkedIn).length;
    checkAll.checked = pageSlice.length > 0 && checkedCount === pageSlice.length;
    checkAll.indeterminate = checkedCount > 0 && checkedCount < pageSlice.length;
    checkAll.onclick = e => e.stopPropagation();
    checkAll.onchange = async (e)=>{
      const next = e.target.checked;
      const changed = pageSlice.filter(p => p && p.checkedIn !== next);
      if (changed.length === 0) return;
      try {
        await setRosterPageAttendanceWithSync(eid, people, changed, next);
        updateRosterCounters(people);
        await renderRoster();
        changed.forEach(p=> queueAttendanceLog(eid, p, next));
      } catch (err) {
        await renderRoster();
      }
    };
  }

  // render table
  const tbody = document.getElementById('guestTbody');
  if (tbody) tbody.innerHTML = '';

function renderRow(tr, p, idx, mode){
  if(mode === 'edit'){
    tr.innerHTML = `
      <td style="text-align:center"><input type="checkbox" ${p.checkedIn?'checked':''}></td>
      <td><input class="in name"  value="${p.name||''}"></td>
      <td><input class="in dept"  value="${p.dept||''}"></td>
      <td><input class="in phone" value="${p.phone||''}"></td>
      <td><input class="in code"  value="${p.code||''}"></td>
      <td><input class="in table" value="${p.table||''}"></td>
      <td><input class="in seat"  value="${p.seat||''}"></td>
      <td>${firstLoginText(p)}</td>
      <td>${lastLoginText(p)}</td>
      <td>${rewardText(p, v2PrizeMap)}</td>
      <td>
        <button class="btn small save">儲存</button>
        <button class="btn small cancel">取消</button>
      </td>
    `;
    // checkbox persists immediately
    tr.querySelector('td input[type="checkbox"]').onchange = async (e)=>{
      const checkbox = e.target;
      const previous = !!p.checkedIn;
      const next = e.target.checked;
      if (previous === next) return;
      try {
        await setRosterAttendanceWithSync(eid, people, p, next);
        updateRosterCounters(people);
        queueAttendanceLog(eid, p, next);
      } catch (err) {
        checkbox.checked = previous;
      }
    };
    const doSave = async ()=>{
      const v = sel => tr.querySelector(sel)?.value?.trim() || '';
      p.name  = v('.in.name');
      p.dept  = v('.in.dept');
      p.phone = v('.in.phone');
      p.code  = v('.in.code');
      p.table = v('.in.table');
      p.seat  = v('.in.seat');
      await setPeopleWithSync(eid, people);
      renderRow(tr, p, idx, 'view');
    };
    tr.querySelector('.save').onclick = doSave;
    // Enter to save quickly while editing
    tr.querySelectorAll('input.in').forEach(inp=>{
      inp.addEventListener('keydown', e=>{
        if(e.key === 'Enter'){ e.preventDefault(); doSave(); }
      });
    });
    tr.querySelector('.cancel').onclick = ()=> renderRow(tr, p, idx, 'view');
  } else {
    tr.innerHTML = `
      <td style="text-align:center"><input type="checkbox" ${p.checkedIn?'checked':''}></td>
      <td>${p.name || ''}</td>
      <td>${p.dept || ''}</td>
      <td>${p.phone || ''}</td>
      <td>${p.code || ''}</td>
      <td>${p.table || ''}</td>
      <td>${p.seat || ''}</td>
      <td>${firstLoginText(p)}</td>
      <td>${lastLoginText(p)}</td>
      <td>${rewardText(p, v2PrizeMap)}</td>
      <td>
        <button class="btn small edit">編輯</button>
        ${p.prize ? '<button class="btn small" data-clear-win>清除得獎</button>' : ''}
        <button class="btn small danger delete">刪除</button>
      </td>
    `;
    tr.querySelector('td input[type="checkbox"]').onchange = async (e)=>{
      const checkbox = e.target;
      const previous = !!p.checkedIn;
      const next = e.target.checked;
      if (previous === next) return;
      try {
        await setRosterAttendanceWithSync(eid, people, p, next);
        updateRosterCounters(people);
        queueAttendanceLog(eid, p, next);
      } catch (err) {
        checkbox.checked = previous;
      }
    };
    tr.querySelector('.edit').onclick = ()=> renderRow(tr, p, idx, 'edit');
    // Double-click row to jump into edit mode for on-the-go changes
    tr.addEventListener('dblclick', ()=> renderRow(tr, p, idx, 'edit'));
    tr.querySelector('[data-clear-win]')?.addEventListener('click', async ()=>{
      if (!p.prize) return;
      const ok = confirm(`確定要移除「${p.name||''}」的得獎紀錄（${p.prize}）？`);
      if (!ok) return;
      const eidNow = getCurrentEventId();
      if (!eidNow) return;
      const keyPhone = (p.phone || '').trim();
      const keyND = `${(p.name||'').trim()}||${(p.dept||'').trim()}`;
      const wKey = w => w?.phone ? `phone:${(w.phone||'').trim()}` : `${(w?.name||'').trim()}||${(w?.dept||'').trim()}`;
      const prizes = await getPrizes(eidNow);
      let changed = false;
      (prizes || []).forEach(pr=>{
        const before = Array.isArray(pr.winners) ? pr.winners.length : 0;
        pr.winners = (pr.winners || []).filter(w=>{
          const phoneMatch = keyPhone && (w?.phone||'').trim() === keyPhone;
          const ndMatch    = `${(w?.name||'').trim()}||${(w?.dept||'').trim()}` === keyND;
          return !phoneMatch && !ndMatch;
        });
        if (pr.winners.length !== before) changed = true;
      });
      if (changed) await setPrizes(eidNow, prizes);
      // clear local prize flag on this person
      p.prize = '';
      await setPeopleWithSync(eidNow, people);
      await renderRoster();
    });
    tr.querySelector('.delete').onclick = async ()=>{
      const ok = confirm(`確定刪除「${p.name||''}」？`);
      if(!ok) return;
      people.splice(idx, 1);
      await setPeopleWithSync(eid, people);
      await renderRoster();
    };
  }
}

pageSlice.forEach((p, iOnPage)=>{
  const tr = document.createElement('tr');
  renderRow(tr, p, start + iOnPage, 'view');
  tbody?.appendChild(tr);
});


  // counters & paging UI
  { const el=document.getElementById('pageInfo'); if(el) el.textContent = `${rosterState.page} / ${totalPages}`; }

  // enable/disable prev/next
  const prev = document.getElementById('prevPage');
  const next = document.getElementById('nextPage');
  if(prev) prev.disabled = rosterState.page <= 1;
  if(next) next.disabled = rosterState.page >= totalPages;
}

function bindRoster(){
  // Import
  document.getElementById('btnImportCSV')?.addEventListener('click', ()=>{
    const f = document.getElementById('csvFile'); if(!f?.files?.[0]) return;
    handleImportCSV(f.files[0], async ()=>{ rosterState.page=1; await renderRoster(); });
  });

  // Export
  document.getElementById('btnExportCSV')?.addEventListener('click', async ()=>{
    const csv = await exportCSV();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8;' }));
    a.download = `roster_${fileTimestamp()}.csv`;
    a.click();
  });
  document.getElementById('btnExportAttendanceLog')?.addEventListener('click', async ()=>{
    const eid = getCurrentEventId(); if(!eid) return;
    const csv = await exportAttendanceLog(eid);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8;' }));
    a.download = 'attendance_log.csv';
    a.click();
  });

  // Delete all
  document.getElementById('btnDeleteAllRoster')?.addEventListener('click', async ()=>{
    const eid = getCurrentEventId(); if(!eid) return;
    const ok = confirm('確定要清空全部名單？此動作無法復原。');
    if(!ok) return;
    await setPeopleWithSync(eid, []);
    rosterState.page = 1;
    await renderRoster();
  });

  // Manual add
  document.getElementById('btnAddManual')?.addEventListener('click', async ()=>{
    const eid = getCurrentEventId(); if(!eid) return;
    const name = prompt('姓名：')?.trim();
    if (!name) return;
    const dept  = prompt('部門 / 描述（可留空）：')?.trim() || '';
    const phone = prompt('電話（可留空）：')?.trim() || '';
    const code  = prompt('代碼（可留空）：')?.trim() || '';
    const table = prompt('枱號（可留空）：')?.trim() || '';
    const seat  = prompt('座位（可留空）：')?.trim() || '';
    const checkedIn = confirm('是否標記為「出席」？');

    const people = await getPeople(eid);
    people.push({
      name,
      dept,
      phone,
      code,
      table,
      seat,
      checkedIn: !!checkedIn,
      prize: ''
    });
    await setPeopleWithSync(eid, people);
    rosterState.page = 1;
    await renderRoster();
  });

  // Search (reset to page 1)
  document.getElementById('searchGuest')?.addEventListener('input', ()=>{
    rosterState.page = 1; renderRoster();
  });

  // Page size
  document.getElementById('pageSize')?.addEventListener('change', ()=>{
    rosterState.page = 1; renderRoster();
  });

  // Prev/Next
  document.getElementById('prevPage')?.addEventListener('click', ()=>{
    rosterState.page = Math.max(1, rosterState.page - 1); renderRoster();
  });
  document.getElementById('nextPage')?.addEventListener('click', ()=>{
    rosterState.page = rosterState.page + 1; renderRoster();
  });

  // Sort headers
  document.querySelectorAll('#guestTable thead th[data-sortable="true"]')?.forEach(th=>{
    th.addEventListener('click', ()=>{
      const key = th.getAttribute('data-key');
      if(!key) return;
      if(rosterState.sortBy === key){
        rosterState.sortDir = rosterState.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        rosterState.sortBy = key;
        rosterState.sortDir = 'asc';
      }
      // visual indicator (▲ ▼)
      document.querySelectorAll('#guestTable thead th').forEach(x=>{
        x.dataset.sort = '';
      });
      th.dataset.sort = rosterState.sortDir;
      rosterState.page = 1;
      renderRoster();
    });
  });
}

async function renderPrizes(){
  const eid = getCurrentEventId(); if(!eid) return;
  const [prizes, curId, stageState] = await Promise.all([
    getPrizes(eid),
    getCurrentPrizeIdRemote(eid),
    FB.get(`/events/${eid}/ui/stageState`).catch(() => null)
  ]);
  const tbody = document.getElementById('prizeRows');
  if (!tbody) return;
  tbody.innerHTML = '';
  const activeMainId = stageState?.mode === 'reward' || stageState?.mode === 'clear'
    ? null
    : (stageState?.mode === 'main' ? (stageState.currentPrizeId || curId) : curId);

  const list = Array.isArray(prizes) ? prizes.slice() : [];
  const { sortBy, sortDir } = prizeState;
  const val = (p, key)=>{
    if (key === 'no') {
      const raw = (p?.no || '').toString().trim();
      const n = Number(raw);
      return isNaN(n) ? raw.toLowerCase() : n;
    }
    if (key === 'quota') return Number(p?.quota || 0);
    if (key === 'used')  return (p?.winners || []).length;
    return (p?.[key] || '').toString().toLowerCase();
  };
  list.sort((a, b)=>{
    const va = val(a, sortBy);
    const vb = val(b, sortBy);
    if (typeof va === 'number' && typeof vb === 'number') {
      return sortDir === 'asc' ? va - vb : vb - va;
    }
    // If one is number and the other is string, numbers first
    if (typeof va === 'number' && typeof vb !== 'number') return sortDir === 'asc' ? -1 : 1;
    if (typeof va !== 'number' && typeof vb === 'number') return sortDir === 'asc' ? 1 : -1;
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  // visual indicator (▲ ▼)
  document.querySelectorAll('#prizeTable thead th').forEach(th=>{
    th.dataset.sort = (th.dataset.key === sortBy) ? sortDir : '';
  });

  list.forEach(p=>{
    const used = (p.winners || []).length;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="radio" name="curpr" ${activeMainId===p.id?'checked':''}></td>
      <td>${p.no||''}</td>
      <td>${p.name||''}</td>
      <td>${p.quota||1}</td>
      <td>${used}</td>
      <td>
        <button class="btn small" data-edit="${p.id}">編輯</button>
        <button class="btn small danger" data-del="${p.id}">刪除</button>
      </td>`;
    tr.querySelector('input').onchange = async ()=>{
      await setCurrentPrize(p.id);
      await renderPrizes();
      await renderRewardRounds();
    };
    tr.querySelector('[data-del]').onclick = async ()=>{
      const go = used>0
        ? confirm(`「${p.name||'此獎項'}」已有 ${used} 位得獎者。\n確定要刪除嗎？`)
        : confirm(`刪除「${p.name||'此獎項'}」？`);
      if(!go) return;
      await removePrize(p.id);
      await renderPrizes();
    };
    tr.querySelector('[data-edit]').onclick = async ()=>{
      const newNo   = prompt('更新獎品編號：', p.no || '')?.trim() || '';
      const newName = prompt('更新獎品名稱：', p.name || '')?.trim();
      if (!newName) return;
      const newQuotaRaw = prompt('更新名額（數字）：', String(p.quota || 1))?.trim();
      if (newQuotaRaw === null) return;
      const newQuota = Math.max(0, Number(newQuotaRaw) || 0);
      const quotaChanged = newQuota !== Number(p.quota || 0);
      if (quotaChanged) {
        const ok = confirm(`名額將改為 ${newQuota}，確定要修改嗎？`);
        if (!ok) return;
      }
      await updatePrize({ id: p.id, name: newName, quota: newQuota, no: newNo });
      await renderPrizes();
    };
    tbody.appendChild(tr);
  });

  const wins = document.getElementById('winnersList');
  if (wins) {
    wins.innerHTML = '';
    (prizes||[]).forEach(
      p=>(p.winners||[]).forEach(w=>{
        const li=document.createElement('li');
        li.textContent=`${w.name}（${p.name}）`;
        wins.appendChild(li);}));
  }
}

function ensureRewardRoundPanel(){
  if (document.getElementById('rewardRoundPanel')) return;
  const page = document.getElementById('pageRewardRounds');
  if (!page) return;
  const panel = document.createElement('div');
  panel.id = 'rewardRoundPanel';
  panel.className = 'card';
  panel.style.marginTop = '16px';
  panel.innerHTML = `
    <h3>第二輪抽獎</h3>
    <p class="muted" style="font-size:13px;margin-top:0">
      管理第二輪或額外抽獎；第一輪主抽獎不會受影響，結果會寫入每位參加者的第二輪紀錄。
    </p>
    <div class="bar" style="gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button id="btnEnsureSecondPrize" class="btn primary" type="button">建立 / 載入第二輪</button>
      <input id="newRewardRoundName" placeholder="新輪次名稱" style="min-width:180px">
      <button id="btnAddRewardRound" class="btn" type="button">+ 新增輪次</button>
    </div>
    <div class="bar" style="gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <label>輪次 <select id="rewardRoundSelect"></select></label>
      <label>獎品 <select id="rewardPrizeSelect"></select></label>
      <button id="btnSetCurrentRewardPrize" class="btn primary" type="button">設為目前抽獎</button>
      <label><input id="rewardAllowMainWinners" type="checkbox" checked> 包括第一輪得獎者</label>
      <label><input id="rewardAllowDuplicateWithinRound" type="checkbox"> 允許本輪重複得獎</label>
    </div>
    <div class="bar" style="gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <input id="newRewardPrizeName" placeholder="第二輪獎品名稱" style="min-width:180px">
      <input id="newRewardPrizeNo" placeholder="編號" style="width:90px">
      <label>名額 <input id="newRewardPrizeQuota" type="number" min="1" value="1" style="width:90px"></label>
      <button id="btnAddRewardPrize" class="btn" type="button">+ 新增本輪獎品</button>
      <label>抽出 <input id="rewardBatchSize" type="number" min="1" max="10" value="1" style="width:70px"></label>
      <button id="btnDrawRewardRound" class="btn primary" type="button">抽第二輪</button>
    </div>
    <div id="rewardRoundStatus" class="muted" style="min-height:20px"></div>
    <div style="overflow:auto;margin-top:10px">
      <table class="fullwidth">
        <thead><tr><th>使用中</th><th>輪次</th><th>編號</th><th>獎品</th><th>名額</th><th>已抽出</th><th>得獎者</th></tr></thead>
        <tbody id="rewardRoundRows"></tbody>
      </table>
    </div>
  `;
  page.appendChild(panel);
}

function setRewardStatus(text, isError){
  const el = document.getElementById('rewardRoundStatus');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? '#ff5a67' : '';
}

async function renderRewardRounds(){
  ensureRewardRoundPanel();
  const eid = getCurrentEventId(); if(!eid) return;
  const [rounds, state, stageState] = await Promise.all([
    getRewardRounds(eid),
    getRewardRoundState(eid),
    FB.get(`/events/${eid}/ui/stageState`).catch(() => null)
  ]);
  const entries = Object.entries(rounds || {}).map(([id, r]) => ({ id, ...(r || {}) }));
  const roundSelect = document.getElementById('rewardRoundSelect');
  const prizeSelect = document.getElementById('rewardPrizeSelect');
  const rows = document.getElementById('rewardRoundRows');
  if (!roundSelect || !prizeSelect || !rows) return;

  roundSelect.innerHTML = '';
  if (!entries.length) {
    roundSelect.innerHTML = '<option value="">尚未建立第二輪</option>';
  } else {
    entries.forEach(round => {
      const opt = document.createElement('option');
      opt.value = round.id;
      opt.textContent = round.name || round.id;
      if (round.id === state.currentRoundId) opt.selected = true;
      roundSelect.appendChild(opt);
    });
    if (!roundSelect.value) roundSelect.value = entries[0].id;
  }

  const selectedRound = entries.find(r => r.id === roundSelect.value);
  if (document.getElementById('rewardAllowMainWinners')) {
    document.getElementById('rewardAllowMainWinners').checked = selectedRound?.allowMainRoundWinners !== false;
  }
  if (document.getElementById('rewardAllowDuplicateWithinRound')) {
    document.getElementById('rewardAllowDuplicateWithinRound').checked = selectedRound?.allowDuplicateWithinRound === true;
  }

  prizeSelect.innerHTML = '';
  const prizes = Array.isArray(selectedRound?.prizes) ? selectedRound.prizes : [];
  if (!prizes.length) {
    prizeSelect.innerHTML = '<option value="">本輪尚未有獎品</option>';
  } else {
    prizes.forEach(prize => {
      const opt = document.createElement('option');
      opt.value = prize.id;
      opt.textContent = prize.no ? `${prize.no} - ${prize.name}` : prize.name;
      if (prize.id === state.currentPrizeId) opt.selected = true;
      prizeSelect.appendChild(opt);
    });
    if (!prizeSelect.value) prizeSelect.value = prizes[0].id;
  }

  rows.innerHTML = entries.length ? entries.flatMap(round => {
    const roundPrizes = Array.isArray(round.prizes) ? round.prizes : [];
    if (!roundPrizes.length) {
      return [`<tr><td></td><td>${round.name || round.id}</td><td colspan="5" class="muted">尚未有獎品</td></tr>`];
    }
    return roundPrizes.map(prize => {
      const winners = Array.isArray(prize.winners) ? prize.winners : [];
      const checked = stageState?.mode === 'reward'
        && stageState.currentRoundId === round.id
        && stageState.currentPrizeId === prize.id;
      return `<tr>
        <td><input type="radio" name="curRewardPrize" data-round="${round.id}" data-prize="${prize.id}" ${checked ? 'checked' : ''}></td>
        <td>${round.name || round.id}</td>
        <td>${prize.no || ''}</td>
        <td>${prize.name || ''}</td>
        <td>${prize.quota || 0}</td>
        <td>${winners.length}</td>
        <td>${winners.map(w => w.name || '').filter(Boolean).join(', ')}</td>
      </tr>`;
    });
  }).join('') : '<tr><td colspan="7" class="muted">尚未建立第二輪抽獎。</td></tr>';

  rows.querySelectorAll('input[name="curRewardPrize"]').forEach(input => {
    input.addEventListener('change', async () => {
      const roundId = input.dataset.round || '';
      const prizeId = input.dataset.prize || '';
      if (!roundId || !prizeId) return;
      try {
        const res = await setCurrentRewardOnStage(roundId, prizeId);
        setRewardStatus(`目前第二輪抽獎：${res.round.name} - ${res.prize.name}`);
        await renderRewardRounds();
        await renderPrizes();
      } catch (e) {
        console.error('[reward rounds] set current from table failed', e);
        setRewardStatus(e?.message || '未能設定目前抽獎。', true);
      }
    });
  });
}

document.getElementById('addPrize')?.addEventListener('click', async ()=>{
    const name = document.getElementById('newPrizeName')?.value.trim();
    const no   = document.getElementById('newPrizeNo')?.value.trim();
    const q    = Math.max(0, Number(document.getElementById('newPrizeQuota')?.value || 1));
    if (!name) return;
    await addPrize({ name, quota: q, no });
    document.getElementById('newPrizeName').value = '';
    const noEl=document.getElementById('newPrizeNo'); if(noEl) noEl.value='';
    document.getElementById('newPrizeQuota').value = '1';
    await renderPrizes();
  });

async function renderQuestions(){const list=await getQuestions(getCurrentEventId());const ul=document.getElementById('questionList');ul.innerHTML='';list.forEach(q=>{const li=document.createElement('li');li.textContent=q;ul.appendChild(li);});}
function bindQuestions(){document.getElementById('btnAddQuestion')?.addEventListener('click',async()=>{const eid=getCurrentEventId();const val=document.getElementById('newQuestion')?.value.trim();if(!val)return;const list=await getQuestions(eid);list.push(val);await setQuestions(eid,list);document.getElementById('newQuestion').value='';await renderQuestions();});}
async function renderAssets(){
  const eid = getCurrentEventId();
  if (!eid) return;

  const assets = await getAssets(eid).catch(() => ({
    banner: '',
    landingBanner: '',
    logo: '',
    background: '',
    photos: []
  }));
  const assetSettings = await FB.get(`/events/${eid}/assetSettings`).catch(() => ({}));

  const $ = (id) => document.getElementById(id);
  const str = (v) => (typeof v === 'string' ? v : '');
  const setV2BrandToggle = (hidden) => {
    const btn = $('assetV2BrandToggle');
    if (!btn) return;
    btn.dataset.enabled = hidden ? 'true' : 'false';
    btn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    btn.textContent = hidden ? 'Public V2 logo: Off' : 'Public V2 logo: On';
    btn.classList.toggle('primary', hidden);
  };

  // Fill URL inputs
  if ($('assetLogoUrl'))        $('assetLogoUrl').value        = str(assets.logo);
  if ($('assetBannerUrl'))      $('assetBannerUrl').value      = str(assets.banner);
  if ($('assetLandingBannerUrl')) $('assetLandingBannerUrl').value = str(assets.landingBanner);
  if ($('assetBackgroundUrl'))  $('assetBackgroundUrl').value  = str(assets.background);
  if ($('assetHideLogoOnDraws')) $('assetHideLogoOnDraws').checked = assets.hideLogoOnDraws === true;
  setV2BrandToggle(assetSettings?.hideBrandOnV2 === true || assets.hideBrandOnV2 === true);

  // Previews: prefer Data URL, fallback to URL
  const logoSrc       = str(assets.logo);
  const bannerSrc     = str(assets.banner);
  const landingBannerSrc = str(assets.landingBanner);
  const backgroundSrc = str(assets.background);

  if ($('assetLogoPreview')) {
    if (logoSrc) {
      $('assetLogoPreview').src = logoSrc;
      $('assetLogoPreview').style.display = 'inline-block';
    } else {
      $('assetLogoPreview').style.display = 'none';
    }
  }

  if ($('assetBannerPreview')) {
    if (bannerSrc) {
      $('assetBannerPreview').src = bannerSrc;
      $('assetBannerPreview').style.display = 'inline-block';
    } else {
      $('assetBannerPreview').style.display = 'none';
    }
  }

  if ($('assetLandingBannerPreview')) {
    if (landingBannerSrc) {
      $('assetLandingBannerPreview').src = landingBannerSrc;
      $('assetLandingBannerPreview').style.display = 'inline-block';
    } else {
      $('assetLandingBannerPreview').style.display = 'none';
    }
  }

  if ($('assetBackgroundPreview')) {
    if (backgroundSrc) {
      $('assetBackgroundPreview').src = backgroundSrc;
      $('assetBackgroundPreview').style.display = 'inline-block';
    } else {
      $('assetBackgroundPreview').style.display = 'none';
    }
  }

  // Photos grid
  const grid = $('photosGrid');
  if (!grid) return;

  grid.innerHTML = '';

  const photos = Array.isArray(assets.photos) ? assets.photos : [];
  if (!photos.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = '尚未加入任何相片 URL。';
    grid.appendChild(p);
    return;
  }

  photos.forEach((url, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'photo';
    wrap.style.display = 'inline-block';
    wrap.style.margin = '4px';
    wrap.innerHTML = `
      <div>
        <img src="${url}" style="max-width:160px;max-height:120px;display:block;margin-bottom:4px" alt="photo ${i+1}">
      </div>
      <div style="font-size:11px;word-break:break-all;margin-bottom:4px">${url}</div>
      <button class="btn small" type="button" data-delete-photo="${i}">刪除</button>
    `;
    grid.appendChild(wrap);
  });

  // Delete handlers
  grid.querySelectorAll('[data-delete-photo]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.getAttribute('data-delete-photo'));
      const eidNow = getCurrentEventId();
      if (!eidNow) return;
      const current = await getAssets(eidNow);
      const list = Array.isArray(current.photos) ? current.photos.slice() : [];
      if (idx >= 0 && idx < list.length) {
        list.splice(idx, 1);
        await setAssets(eidNow, { photos: list });
        await renderAssets();
      }
    });
  });
}
function bindAssets(){
  const $ = (id) => document.getElementById(id);

  $('assetV2BrandToggle')?.addEventListener('click', async () => {
    const btn = $('assetV2BrandToggle');
    if (!btn) return;
    const previousHidden = btn.dataset.enabled === 'true';
    const nextHidden = btn.dataset.enabled !== 'true';
    btn.dataset.enabled = nextHidden ? 'true' : 'false';
    btn.setAttribute('aria-pressed', nextHidden ? 'true' : 'false');
    btn.textContent = nextHidden ? 'Public V2 logo: Off' : 'Public V2 logo: On';
    btn.classList.toggle('primary', nextHidden);
    const eid = getCurrentEventId();
    if (!eid) return;
    btn.disabled = true;
    try {
      await FB.patch(`/events/${eid}/assetSettings`, { hideBrandOnV2: nextHidden });
    } catch (error) {
      btn.dataset.enabled = previousHidden ? 'true' : 'false';
      btn.setAttribute('aria-pressed', previousHidden ? 'true' : 'false');
      btn.textContent = previousHidden ? 'Public V2 logo: Off' : 'Public V2 logo: On';
      btn.classList.toggle('primary', previousHidden);
      alert(`Public V2 logo toggle failed: ${error?.message || String(error)}`);
    } finally {
      btn.disabled = false;
    }
  });

  // Save button: URL-only image links
  $('saveAssets')?.addEventListener('click', async () => {
    const eid = getCurrentEventId();
    if (!eid) {
      alert('請先在左側選擇一個活動（Event）。');
      return;
    }

    const logoUrl       = ($('assetLogoUrl')?.value || '').trim();
    const bannerUrl     = ($('assetBannerUrl')?.value || '').trim();
    const landingBannerUrl = ($('assetLandingBannerUrl')?.value || '').trim();
    const backgroundUrl = ($('assetBackgroundUrl')?.value || '').trim();
    const hideLogoOnDraws = $('assetHideLogoOnDraws')?.checked === true;
    const hideBrandOnV2 = $('assetV2BrandToggle')?.dataset.enabled === 'true';

    // Keep existing photos; we only change photos through add/delete controls
    const current = await getAssets(eid);
    const photos  = Array.isArray(current.photos) ? current.photos.slice() : [];

    await setAssets(eid, {
      logo: logoUrl || '',
      banner: bannerUrl || '',
      landingBanner: landingBannerUrl || '',
      background: backgroundUrl || '',
      photos,
      hideLogoOnDraws,
      hideBrandOnV2
    });
    await FB.patch(`/events/${eid}/assetSettings`, { hideBrandOnV2 });
    alert('已儲存素材設定');
    await renderAssets();
  });

  // Add photo URL
  $('addPhoto')?.addEventListener('click', async () => {
    const eid = getCurrentEventId();
    if (!eid) {
      alert('請先在左側選擇一個活動（Event）。');
      return;
    }

    const input = $('assetPhotoUrl');
    const url = (input?.value || '').trim();
    if (!url) return;

    const current = await getAssets(eid);
    const photos = Array.isArray(current.photos) ? current.photos.slice() : [];
    photos.push(url);

    await setAssets(eid, { photos });
    input.value = '';
    await renderAssets();
  });
}

function defaultGameBooths(){
  return Array.from({ length: 5 }, (_, i) => ({
    id: `booth_${i + 1}`,
    name: `遊戲攤位 ${i + 1} (Game Booth ${i + 1})`,
    active: true
  }));
}

function normalizeGameBooths(raw){
  const list = Array.isArray(raw) ? raw : Object.values(raw || {});
  return list
    .filter(Boolean)
    .map((booth, i) => ({
      id: String(booth.id || `booth_${i + 1}`),
      name: String(booth.name || `遊戲攤位 ${i + 1} (Game Booth ${i + 1})`),
      active: booth.active !== false
    }));
}

async function getGameBooths(eid){
  const raw = await FB.get(`/events/${eid}/gameBooths`).catch(() => null);
  return normalizeGameBooths(raw);
}

async function setGameBooths(eid, booths){
  await FB.put(`/events/${eid}/gameBooths`, normalizeGameBooths(booths));
}

async function renderGameBooths(){
  const eid = getCurrentEventId();
  const host = document.getElementById('gameBoothList');
  if (!eid || !host) return;

  const booths = await getGameBooths(eid);
  const visitorLink = gameBoothVisitorLink(eid);
  const linkHost = document.getElementById('gameBoothVisitorLink');
  if (linkHost) {
    linkHost.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <strong>訪客頁面 (Visitor page):</strong>
        <a href="${visitorLink}" target="_blank" rel="noopener">${visitorLink}</a>
        <span id="gameBoothVisitorQR"></span>
      </div>
    `;
    const qrHost = document.getElementById('gameBoothVisitorQR');
    if (window.QRCode && qrHost) {
      qrHost.innerHTML = '';
      // eslint-disable-next-line no-undef
      new QRCode(qrHost, { text: visitorLink, width: 96, height: 96, correctLevel: QRCode.CorrectLevel.M });
    }
  }

  host.innerHTML = '';
  booths.forEach((booth, index) => {
    const link = gameBoothVisitorLink(eid, booth.id);
    const card = document.createElement('div');
    card.className = 'game-booth-card';
    card.dataset.boothId = booth.id;
    card.innerHTML = `
      <div class="game-booth-head">
        <label>
          <span>攤位名稱 (Booth name)</span>
          <input data-game-booth-name value="">
        </label>
        <button class="btn small danger" type="button" data-game-booth-delete>刪除 (Delete)</button>
      </div>
      <div class="game-booth-qr" id="gameBoothQR_${index}"></div>
      <a href="${link}" target="_blank" rel="noopener">${link}</a>
    `;
    const input = card.querySelector('[data-game-booth-name]');
    if (input) input.value = booth.name;
    host.appendChild(card);
    const qr = document.getElementById(`gameBoothQR_${index}`);
    if (window.QRCode && qr) {
      qr.innerHTML = '';
      // eslint-disable-next-line no-undef
      new QRCode(qr, { text: link, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
    }
  });
}

function collectGameBoothCards(){
  return Array.from(document.querySelectorAll('#gameBoothList .game-booth-card')).map((card, index) => ({
    id: card.dataset.boothId || `booth_${index + 1}`,
    name: card.querySelector('[data-game-booth-name]')?.value.trim() || `遊戲攤位 ${index + 1} (Game Booth ${index + 1})`,
    active: true
  }));
}

function bindGameBooths(){
  document.getElementById('btnAddGameBooth')?.addEventListener('click', async () => {
    const eid = getCurrentEventId();
    if (!eid) return;
    const booths = collectGameBoothCards();
    const stamp = Date.now().toString(36);
    booths.push({ id: `booth_${stamp}`, name: `遊戲攤位 ${booths.length + 1} (Game Booth ${booths.length + 1})`, active: true });
    await setGameBooths(eid, booths);
    await renderGameBooths();
  });

  document.getElementById('btnResetGameBooths')?.addEventListener('click', async () => {
    const eid = getCurrentEventId();
    if (!eid) return;
    await setGameBooths(eid, defaultGameBooths());
    await renderGameBooths();
  });

  document.getElementById('btnSaveGameBooths')?.addEventListener('click', async () => {
    const eid = getCurrentEventId();
    if (!eid) return;
    await setGameBooths(eid, collectGameBoothCards());
    await renderGameBooths();
  });

  document.getElementById('gameBoothList')?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-game-booth-delete]');
    if (!btn) return;
    const eid = getCurrentEventId();
    if (!eid) return;
    const card = btn.closest('.game-booth-card');
    const id = card?.dataset.boothId;
    const booths = collectGameBoothCards().filter(booth => booth.id !== id);
    await setGameBooths(eid, booths);
    await renderGameBooths();
  });
}

async function renderPolls(){
  const eid = getCurrentEventId();
  const polls = await getPolls(eid);
  const list = document.getElementById('pollList');
  list.innerHTML = '';

  if (!polls || !Object.keys(polls).length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = '尚未建立投票';
    list.appendChild(li);
    return;
  }

  const baseUrl = new URL(location.href);
  const makeLink = (file, pid) => {
    const u = new URL(baseUrl);
    u.pathname = (u.pathname.replace(/[^/]+$/, '') || '/') + file;
    u.search = `?event=${encodeURIComponent(eid)}&poll=${encodeURIComponent(pid)}`;
    return u.href;
  };

  // IMPORTANT: iterate entries so we get the RTDB key
  for (const [pid, p] of Object.entries(polls)) {
    if (!p) continue;
    const pollId = p.id || pid; // prefer embedded id, else key

    const li = document.createElement('li');
    const total = Object.values(voteCountsFromPoll(p)).reduce((a,b)=> a + Number(b || 0), 0);
    const optionsText = (p.options || []).map(o => o.text).join(' / ') || '—';

    const voteUrl   = makeLink('vote.html',        pollId);
    const publicUrl = makeLink('public_poll.html', pollId);

    li.innerHTML = `
      <strong>${p.question || p.q || '(未命名)'}</strong>
      <small>(共 ${total} 票)</small>
      <div class="muted">${optionsText}</div>
      <div class="bar" style="gap:6px;margin-top:6px;flex-wrap:wrap">
        <button class="btn" data-act="qr">QR</button>
        <a class="btn" data-act="public" href="${publicUrl}" target="_blank" rel="noopener">公眾畫面</a>
        <button class="btn" data-act="use">使用此問題</button>
      </div>
    `;

    // QR preview
    li.querySelector('[data-act="qr"]').onclick = () => {
      const host = document.getElementById('pollQR');
      if (!host) return;
      host.innerHTML = `
        <div class="grid-2" style="gap:16px;align-items:center">
          <div id="pollQRCanvas"></div>
          <div>
            <div class="muted" style="word-break:break-all">${voteUrl}</div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
              <button id="copyVoteLink" class="btn">複製投票連結</button>
              <a class="btn" href="${voteUrl}" target="_blank" rel="noopener">開啟投票頁</a>
            </div>
          </div>
        </div>
      `;
      if (window.QRCode && document.getElementById('pollQRCanvas')) {
        // eslint-disable-next-line no-undef
        new QRCode(document.getElementById('pollQRCanvas'), {
          text: voteUrl, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.M
        });
      }
      const copyBtn = document.getElementById('copyVoteLink');
      if (copyBtn) copyBtn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(voteUrl); alert('已複製投票連結'); } catch(e) {}
      });
    };

    // Public page click: hint UI state (safe if FB.patch exists)
    const pubBtn = li.querySelector('[data-act="public"]');
    if (pubBtn) pubBtn.addEventListener('click', async () => {
      try { if (window.FB && window.FB.patch) await window.FB.patch(`/events/${eid}/ui`, { currentPollId: pollId, showPollQR: true }); } catch(_){}
    });

    // One-click use-this-poll
    const useBtn = li.querySelector('[data-act="use"]');
    if (useBtn) useBtn.addEventListener('click', async () => {
      try {
        if (window.FB && window.FB.patch) await window.FB.patch(`/events/${eid}/ui`, { currentPollId: pollId, showPollQR: true });
        alert('已設為目前問題');
        bindPollPicker(); // refresh dropdown to reflect selection
      } catch(_){}
    });

    list.appendChild(li);
  }
}


function bindPolls(){
  const btn = document.getElementById('btnAddPoll');
  if (!btn) return;

  btn.addEventListener('click', async ()=>{
    const eid = getCurrentEventId();
    if (!eid) return;

    // Prefer current chip-based inputs; fallback to legacy ids if present
    const qInput   = document.getElementById('pollQInput') || document.getElementById('newPollQ');
    const optsText = document.getElementById('newPollOpts');

    const question = qInput?.value?.trim() || '';

    // Collect options: first try chips, else fallback to textarea/newline/comma input
    let opts = getChipValues();
    if (!opts.length && optsText) {
      opts = (optsText.value || '')
        .split(/\n|,/)
        .map(s => s.trim())
        .filter(Boolean);
    }

    if (!question || !opts.length) {
      alert('請輸入問題與至少一個選項');
      return;
    }

    const options = opts.map((t, i) => ({ id: 'o' + (i + 1), text: t, img: '' }));
    const poll = { id: 'poll' + Date.now().toString(36), question, options, votes: {} };
    await setPoll(eid, poll);

    if (qInput) qInput.value = '';
    if (optsText) optsText.value = '';
    document.getElementById('optChips')?.replaceChildren(); // clear chips if used

    await renderPolls();
    await renderPollManager(); // keep 投票管理 list in sync
    await bindPollPicker(); // refresh picker for new poll
  });
}

function buildVotingV2PublicScreen(eid, pid, poll, revealStep = 0, highlightTop = false) {
  const votes = voteCountsFromPoll(poll || {});
  const allItems = (poll?.options || []).map((option, originalIndex) => ({
    id: option.id,
    text: option.text || `Option ${originalIndex + 1}`,
    img: option.img || '',
    count: Number(votes[option.id] || 0),
    originalIndex
  }));
  const max = Math.max(0, ...allItems.map(item => item.count));
  const items = allItems
    .map(item => ({
      ...item,
      percent: max ? Math.round((item.count / max) * 100) : 0,
      isTop: max > 0 && item.count === max
    }))
    .sort((a, b) => b.count - a.count || a.originalIndex - b.originalIndex)
    .slice(0, 3)
    .sort((a, b) => a.count - b.count || a.originalIndex - b.originalIndex);
  const step = Math.max(0, Math.min(items.length, Number(revealStep || 0)));
  const votePage = new URL('./vote.html', location.href);
  votePage.search = `?event=${encodeURIComponent(eid)}&poll=${encodeURIComponent(pid)}`;
  const question = poll?.question || poll?.q || 'Voting';
  return {
    mode: 'poll',
    kind: 'poll',
    status: 'poll-results',
    pollDisplay: 'results',
    pollId: pid,
    question,
    prizeName: question,
    modeLabel: 'Voting',
    message: step >= items.length ? 'Final result' : 'Revealing results',
    voteLink: votePage.href,
    items,
    revealStep: step,
    highlightTop,
    updatedAt: Date.now()
  };
}

async function bindPollPicker(){
  const eid   = getCurrentEventId();
  const sel   = document.getElementById('pollPicker');
  const btnSet = document.getElementById('btnSetCurrent');
  const btnQR  = document.getElementById('btnShowPickerQR');
  const btnShowPublic = document.getElementById('btnShowQRPublic');
  const btnHidePublic = document.getElementById('btnHideQRPublic');
  const btnPlayResults = document.getElementById('btnPlayPollResults');
  const btnNextResults = document.getElementById('btnNextPollResult');
  const btnClearResults = document.getElementById('btnClearPollResult');
  if (!sel) return;

  // Load polls + UI state (defensive, no optional chaining)
  let polls = {};
  let ui    = {};
  try { polls = await getPolls(eid) || {}; } catch (e) { polls = {}; }
  try { 
    if (window.FB && window.FB.get) {
      ui = await window.FB.get(`/events/${eid}/ui`) || {};
    }
  } catch (e) { ui = {}; }

  const currentId = ui && ui.currentPollId ? ui.currentPollId : null;

  // Build dropdown from entries so we have the poll key as id
  sel.innerHTML = '';
  const entries = Object.entries(polls); // [[pid, poll], ...]
  if (entries.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '（尚未建立投票）';
    sel.appendChild(opt);
  } else {
    for (const [pid, p] of entries) {
      const opt = document.createElement('option');
      opt.value = pid; // use RTDB key as id
      const title = (p && (p.question || p.q)) ? (p.question || p.q) : '(未命名)';
      opt.textContent = title;
      if (pid === currentId) opt.selected = true;
      sel.appendChild(opt);
    }
    // Ensure something is selected
    if (!sel.value && entries[0]) sel.value = entries[0][0];
  }

  // "Set current" button
  if (btnSet) {
    btnSet.onclick = async function(){
      const pid = sel.value;
      if (!pid) return;
      try {
        if (window.FB && window.FB.patch) {
          await window.FB.patch(`/events/${eid}/ui`, { currentPollId: pid, showPollQR: true });
        }
        alert('已設為目前問題');
      } catch (e) { /* ignore */ }
    };
  }

  // "Show QR" button
  if (btnQR) {
    btnQR.onclick = function(){
      const pid = sel.value;
      if (!pid) return;

      const u = new URL(location.href);
      u.pathname = (u.pathname.replace(/[^/]+$/, '') || '/') + 'vote.html';
      u.search = `?event=${encodeURIComponent(eid)}&poll=${encodeURIComponent(pid)}`;
      const link = u.href;

      const host = document.getElementById('pollQR');
      if (!host) return;
      host.innerHTML = (
        '<div class="grid-2" style="gap:16px;align-items:center">' +
          '<div id="pollQRCanvas"></div>' +
          '<div>' +
            '<div class="muted" style="word-break:break-all">' + link + '</div>' +
            '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' +
              '<button id="copyVoteLink" class="btn">複製投票連結</button>' +
              '<a class="btn" href="' + link + '" target="_blank" rel="noopener">開啟投票頁</a>' +
            '</div>' +
          '</div>' +
        '</div>'
      );

      if (window.QRCode && document.getElementById('pollQRCanvas')) {
        // eslint-disable-next-line no-undef
        new QRCode(document.getElementById('pollQRCanvas'), {
          text: link, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.M
        });
      }
      const copyBtn = document.getElementById('copyVoteLink');
      if (copyBtn) {
        copyBtn.addEventListener('click', async function(){
          try { await navigator.clipboard.writeText(link); alert('已複製投票連結'); } catch (e) {}
        });
      }
    };
  }

  if (btnHidePublic) {
    btnHidePublic.onclick = async function(){
      try {
        if (window.FB && window.FB.patch) {
          await window.FB.patch(`/events/${eid}/ui`, {
            showPollQR: false
          });
        }
        alert('已切換回抽獎畫面');
      } catch (e) {
        console.warn('[poll] hide QR public failed', e);
      }
    };
  }

  // "Show QR on public board" button
  if (btnShowPublic) {
    btnShowPublic.onclick = async function(){
      const pid = sel.value;
      if (!pid) return;
      try {
        if (window.FB && window.FB.patch) {
          await window.FB.patch(`/events/${eid}/ui`, {
            currentPollId: pid,
            showPollQR: true
          });
        }
        alert('已在公眾畫面顯示此 QR');
      } catch (e) {
        console.warn('[poll] show QR public failed', e);
      }
    };
  }

  // "Play results animation" button (public poll board)
  if (btnPlayResults) {
    btnPlayResults.onclick = async function(){
      const pid = sel.value;
      if (!pid) return;
      const fallbackPoll = polls[pid];
      if (!fallbackPoll) return;
      try {
        if (window.FB && window.FB.patch) {
          const poll = await window.FB.get(`/events/${eid}/polls/${pid}`).catch(() => fallbackPoll) || fallbackPoll;
          const trigger = Date.now();
          await window.FB.patch(`/events/${eid}/ui`, {
            currentPollId: pid,
            showPollQR: false,
            pollResultsTrigger: trigger,
            pollResultsStep: 0,
            publicScreen: buildVotingV2PublicScreen(eid, pid, poll, 0, false)
          });
        }
        alert('已觸發公眾結果動畫');
      } catch (e) {
        console.warn('[poll] play results failed', e);
      }
    };
  }

  // Advance results animation step
  if (btnNextResults) {
    btnNextResults.onclick = async function(){
      const pid = sel.value;
      if (!pid) return;
      const poll = polls[pid];
      if (!poll) return;
      try {
        const ui = await window.FB.get(`/events/${eid}/ui`).catch(()=>({}));
        const fallbackScreen = buildVotingV2PublicScreen(eid, pid, poll, 0, false);
        const currentScreen = ui?.publicScreen?.mode === 'poll'
          && ui.publicScreen.pollDisplay === 'results'
          && ui.publicScreen.pollId === pid
          ? ui.publicScreen
          : fallbackScreen;
        const total = Array.isArray(currentScreen.items) ? currentScreen.items.length : 0;
        const step = Math.min(total, Number(currentScreen.revealStep || ui?.pollResultsStep || 0) + 1);
        await window.FB.patch(`/events/${eid}/ui`, {
          currentPollId: pid,
          pollResultsStep: step,
          publicScreen: {
            ...currentScreen,
            revealStep: step,
            highlightTop: step >= total,
            message: step >= total ? 'Final result' : 'Revealing results',
            updatedAt: Date.now()
          }
        });
      } catch (e) {
        console.warn('[poll] next results failed', e);
      }
    };
  }

  // Clear results animation
  if (btnClearResults) {
    btnClearResults.onclick = async function(){
      try {
        await window.FB.patch(`/events/${eid}/ui`, {
          pollResultsTrigger: null,
          pollResultsStep: 0,
          showPollQR: false,
          publicScreen: { mode: 'v2Draw', updatedAt: Date.now(), message: 'Returned to V2 draw screen' }
        });
        alert('已清除結果模式，恢復抽獎畫面');
      } catch (e) {
        console.warn('[poll] clear results failed', e);
      }
    };
  }
}


function bindPollComposer(){
  const inputQ = document.getElementById('pollQInput');
  const inOpt = document.getElementById('optInput');
  const wrap = document.getElementById('optChips');
  const btnCreate = document.getElementById('btnCreatePoll');
  const btnClearStage = document.getElementById('btnClearStage');

  // Enter to add chip
  inOpt?.addEventListener('keydown', e=>{
    if (e.key === 'Enter' && inOpt.value.trim()){
      e.preventDefault();
      wrap.appendChild(createChip(inOpt.value.trim()));
      inOpt.value = '';
    }
  });

  // Create poll
  btnCreate?.addEventListener('click', async ()=>{
    const eid = getCurrentEventId();
    const q = inputQ.value.trim();
    const opts = getChipValues();
    if (!eid || !q || !opts.length) { alert('請輸入問題與至少一個選項'); return; }
    const poll = {
      id: makeId('p'),
      question: q,
      options: opts.map(t => ({ id: makeId('o'), text: t, img: '' })),
      votes: {}, active: true, createdAt: Date.now()
    };
    await setPoll(eid, poll);
    // show QR of this new poll
    showPollQR(linkTo('vote.html', eid, poll.id));
    // reset UI
    inputQ.value = ''; wrap.innerHTML = '';
    await renderPolls();
    await renderPollManager(); // keep 投票管理 list in sync
    await bindPollPicker(); // refresh picker with new poll
  });

  // Clear Stage (hide QR & "next gift" on public screens)
  btnClearStage?.addEventListener('click', async ()=>{
    const eid = getCurrentEventId();
    if (!eid) return;
    // Write simple UI flags the public pages can watch
    await FB.patch(`/events/${eid}/ui`, {
      showPollQR: false,
      showNextPrize: false,
      currentPollId: null
    });
    // also clear local QR panel
    document.getElementById('pollQR').innerHTML = '';
  });
}


function bindPrizeActions(){
  ensureRewardRoundPanel();

  document.getElementById('btnEnsureSecondPrize')?.addEventListener('click', async ()=>{
    const eid = getCurrentEventId(); if(!eid) return;
    try {
      await ensureSecondPrizeRound(eid);
      setRewardStatus('第二輪已準備好。');
      await renderRewardRounds();
    } catch (e) {
      console.error('[reward rounds] ensure second prize failed', e);
      setRewardStatus(e?.message || '未能建立第二輪。', true);
    }
  });

  document.getElementById('btnAddRewardRound')?.addEventListener('click', async ()=>{
    const nameEl = document.getElementById('newRewardRoundName');
    let name = nameEl?.value.trim();
    try {
      if (!name) {
        const eid = getCurrentEventId();
        const rounds = await getRewardRounds(eid);
        const count = Object.keys(rounds || {}).length + 1;
        name = count === 1 ? '第二輪抽獎' : `第二輪抽獎 ${count}`;
      }
      await addRewardRound(name);
      if (nameEl) nameEl.value = '';
      setRewardStatus(`已新增輪次：${name}`);
      await renderRewardRounds();
    } catch (e) {
      console.error('[reward rounds] add round failed', e);
      setRewardStatus(e?.message || '未能新增輪次。', true);
    }
  });

  document.getElementById('rewardRoundSelect')?.addEventListener('change', async (ev)=>{
    const roundId = ev.target.value;
    await setCurrentRewardSelection(roundId, null);
    await renderRewardRounds();
  });

  document.getElementById('rewardPrizeSelect')?.addEventListener('change', async (ev)=>{
    const roundId = document.getElementById('rewardRoundSelect')?.value || '';
    await setCurrentRewardSelection(roundId, ev.target.value);
    await renderRewardRounds();
  });

  document.getElementById('btnSetCurrentRewardPrize')?.addEventListener('click', async ()=>{
    const roundId = document.getElementById('rewardRoundSelect')?.value || '';
    const prizeId = document.getElementById('rewardPrizeSelect')?.value || '';
    if (!roundId || !prizeId) {
      setRewardStatus('請先選擇輪次及獎品。', true);
      return;
    }
    try {
      const res = await setCurrentRewardOnStage(roundId, prizeId);
      setRewardStatus(`目前第二輪抽獎：${res.round.name} - ${res.prize.name}`);
      await renderRewardRounds();
      await renderPrizes();
    } catch (e) {
      console.error('[reward rounds] set current failed', e);
      setRewardStatus(e?.message || '未能設定目前抽獎。', true);
    }
  });

  document.getElementById('rewardAllowMainWinners')?.addEventListener('change', async (ev)=>{
    const roundId = document.getElementById('rewardRoundSelect')?.value || '';
    if (!roundId) return;
    await updateRewardRound(roundId, { allowMainRoundWinners: ev.target.checked });
    await renderRewardRounds();
  });

  document.getElementById('rewardAllowDuplicateWithinRound')?.addEventListener('change', async (ev)=>{
    const roundId = document.getElementById('rewardRoundSelect')?.value || '';
    if (!roundId) return;
    await updateRewardRound(roundId, { allowDuplicateWithinRound: ev.target.checked });
    await renderRewardRounds();
  });

  document.getElementById('btnAddRewardPrize')?.addEventListener('click', async ()=>{
    let roundId = document.getElementById('rewardRoundSelect')?.value || '';
    const name = document.getElementById('newRewardPrizeName')?.value.trim();
    const no = document.getElementById('newRewardPrizeNo')?.value.trim();
    const quota = Math.max(1, Number(document.getElementById('newRewardPrizeQuota')?.value || 1));
    if (!name) {
      setRewardStatus('請先輸入獎品名稱。', true);
      return;
    }
    try {
      if (!roundId) {
        const round = await ensureSecondPrizeRound(getCurrentEventId());
        roundId = round.id;
        await renderRewardRounds();
        const select = document.getElementById('rewardRoundSelect');
        if (select) select.value = roundId;
      }
      await addRewardRoundPrize(roundId, { name, no, quota });
      document.getElementById('newRewardPrizeName').value = '';
      document.getElementById('newRewardPrizeNo').value = '';
      document.getElementById('newRewardPrizeQuota').value = '1';
      setRewardStatus('已新增第二輪獎品。');
      await renderRewardRounds();
    } catch (e) {
      console.error('[reward rounds] add prize failed', e);
      setRewardStatus(e?.message || '未能新增第二輪獎品。', true);
    }
  });

  document.getElementById('btnDrawRewardRound')?.addEventListener('click', async ()=>{
    const roundId = document.getElementById('rewardRoundSelect')?.value || '';
    const prizeId = document.getElementById('rewardPrizeSelect')?.value || '';
    const batchSize = Number(document.getElementById('rewardBatchSize')?.value || 1);
    if (!roundId || !prizeId) return;
    try {
      await setCurrentRewardSelection(roundId, prizeId);
      const res = await drawRewardRoundPrize(batchSize);
      const names = (res.batch || []).map(p => p.name).filter(Boolean).join(', ');
      setRewardStatus(`抽獎完成：${names || '未有得獎者'}`);
      await renderRewardRounds();
      await renderRoster();
    } catch (e) {
      console.error('[reward rounds] draw failed', e);
      alert(`[第二輪抽獎錯誤]\n${e?.message || String(e)}`);
      setRewardStatus(e?.message || '未能完成第二輪抽獎。', true);
    }
  });

  // 新增獎品
  document.getElementById('addPrize')?.addEventListener('click', async ()=>{
    const nameEl = document.getElementById('newPrizeName');
    const quotaEl = document.getElementById('newPrizeQuota');
    const name = nameEl?.value.trim();
    const q    = Math.max(0, Number(quotaEl?.value || 1));
    if (!name) return;
    await addPrize({ name, quota: q });
    if (nameEl)  nameEl.value = '';
    if (quotaEl) quotaEl.value = '1';
    await renderPrizes();
  });

  // 匯入獎品
  document.getElementById('btnImportPrizeCSV')?.addEventListener('click', ()=>{
    const f = document.getElementById('prizeCsvFile');
    if(!f?.files?.[0]){ alert('請先選擇 CSV 檔案'); return; }
    handlePrizeImportCSV(f.files[0], async ()=>{
      prizeState.sortBy = 'name';
      prizeState.sortDir = 'asc';
      await renderPrizes();
    });
  });

  // 清空獎品
  document.getElementById('btnDeleteAllPrizes')?.addEventListener('click', async ()=>{
    const ok = confirm('確定要刪除所有獎品與得獎紀錄？此動作無法復原。');
    if(!ok) return;
    await clearAllPrizes();
    prizeState.sortBy = 'name';
    prizeState.sortDir = 'asc';
    await renderPrizes();
  });

  // 排序
  document.querySelectorAll('#prizeTable thead th[data-sortable="true"]')?.forEach(th=>{
    th.addEventListener('click', ()=>{
      const key = th.dataset.key;
      if(!key) return;
      if(prizeState.sortBy === key){
        prizeState.sortDir = prizeState.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        prizeState.sortBy = key;
        prizeState.sortDir = 'asc';
      }
      document.querySelectorAll('#prizeTable thead th').forEach(x=> x.dataset.sort = '');
      th.dataset.sort = prizeState.sortDir;
      renderPrizes();
    });
  });
  renderRewardRounds();
}

export async function renderPollManager() {
  const eid = getCurrentEventId();
  const list = document.getElementById('pollManagerList');
  if (!eid || !list) return;

  // Fetch polls from RTDB
  let polls = await getPolls(eid).catch(() => ({}));
  list.innerHTML = '';

  const entries = Object.entries(polls || {});
  if (!entries.length) {
    list.innerHTML = '<li class="muted">尚未建立任何投票問題</li>';
    return;
  }

  for (const [pid, p] of entries) {
    const poll = { id: pid, ...p };
    const li = document.createElement('li');
    li.className = 'poll-item';
    li.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px">
        <input class="poll-question" value="${poll.question || ''}" placeholder="輸入問題..." />
        <div class="poll-options"></div>
        <div class="bar" style="gap:6px;margin-top:4px;flex-wrap:wrap">
          <button class="btn" data-act="save">💾 儲存</button>
          <button class="btn" data-act="delete" style="background:#b71c1c;color:white">刪除</button>
        </div>
      </div>
    `;

    // render options (text + image URL)
    const optWrap = li.querySelector('.poll-options');
    const options = poll.options || [];
    optWrap.innerHTML = options
      .map((o, i) => {
        const optId = o.id || `o${i}`;
        const text = o.text || o;
        const img = o.img || '';
        const isLast = i === options.length - 1;
        return `
        <div class="bar poll-opt-row" style="gap:4px;align-items:center" data-id="${optId}">
          <input class="poll-opt" data-field="text" value="${text}" placeholder="選項 ${i + 1}" />
          <input class="poll-opt-img" data-field="img" value="${img}" placeholder="圖片 URL（可選）" style="flex:1; min-width:160px" />
          ${img ? `<img src="${img}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,.12)" alt="">` : ''}
          ${isLast ? '<button class="btn btn-small" data-act="addopt">＋</button>' : ''}
        </div>`;
      })
      .join('') || `
        <div class="bar poll-opt-row" style="gap:4px;align-items:center" data-id="o0">
          <input class="poll-opt" data-field="text" value="" placeholder="選項 1" />
          <input class="poll-opt-img" data-field="img" value="" placeholder="圖片 URL（可選）" style="flex:1; min-width:160px" />
          <button class="btn btn-small" data-act="addopt">＋</button>
        </div>`;

    // Bind actions
    li.addEventListener('click', async (e) => {
      const act = e.target.dataset.act;
      if (!act) return;

      if (act === 'save') {
        const question = li.querySelector('.poll-question').value.trim();
        const optRows = [...li.querySelectorAll('.poll-opt-row')];
        const opts = optRows
          .map((row, idx) => {
            const text = row.querySelector('[data-field="text"]')?.value.trim() || '';
            const img = row.querySelector('[data-field="img"]')?.value.trim() || '';
            if (!text) return null;
            const id = row.dataset.id || `o${idx}`;
            return { id, text, img };
          })
          .filter(Boolean);

        if (!question || !opts.length) return alert('請輸入問題與至少一個選項');

        const newPoll = { ...poll, id: pid, question, options: opts, votes: poll.votes || {} };
        await FB.put(`/events/${eid}/polls/${pid}`, newPoll);
        alert('已儲存');
        renderPollManager();
      }

      if (act === 'delete') {
        if (!confirm('確定刪除此問題？')) return;
        await FB.put(`/events/${eid}/polls/${pid}`, null);
        renderPollManager();
      }

      if (act === 'addopt') {
        const bar = e.target.closest('.poll-options');
        const n = bar.querySelectorAll('.poll-opt').length + 1;
        const div = document.createElement('div');
        div.className = 'bar';
        div.classList.add('poll-opt-row');
        div.style.gap = '4px';
        div.style.alignItems = 'center';
        div.dataset.id = `o${Date.now().toString(36)}`;
        div.innerHTML = `
          <input class="poll-opt" data-field="text" value="" placeholder="選項 ${n}" />
          <input class="poll-opt-img" data-field="img" value="" placeholder="圖片 URL（可選）" style="flex:1; min-width:160px" />
          <button class="btn btn-small" data-act="addopt">＋</button>
        `;
        bar.appendChild(div);
        // ensure only the last row keeps the add button
        const addBtns = bar.querySelectorAll('[data-act="addopt"]');
        addBtns.forEach((btn, idx) => {
          if (idx < addBtns.length - 1) btn.remove();
        });
      }
    });

    list.appendChild(li);
  }
}

// Add button to create a new poll
document.getElementById('btnAddPoll')?.addEventListener('click', async () => {
  const eid = getCurrentEventId();
  const newId = 'p' + Math.random().toString(36).slice(2, 8);
  const blank = { question: '', options: [{ text: '' }], votes: {} };
  await FB.put(`/events/${eid}/polls/${newId}`, blank);
  await renderPollManager();
  await bindPollPicker(); // refresh picker for new poll
});


export async function renderAll(){
  const renderStep = async (name, fn) => {
    try { await fn(); }
    catch (error) { console.error(`[CMS] ${name} failed`, error); }
  };
  await renderStep('renderEventList', renderEventList);
  await renderStep('renderEventInfo', renderEventInfo);
  await renderStep('renderRoster', renderRoster);
  await renderStep('renderPrizes', renderPrizes);
  await renderStep('renderRewardRounds', renderRewardRounds);
  await renderStep('renderQuestions', renderQuestions);
  await renderStep('renderAssets', renderAssets);
  await renderStep('renderGameBooths', renderGameBooths);
  await renderStep('renderPolls', renderPolls);
  await renderStep('renderPollManager', renderPollManager);   // keep poll manager in sync when switching events
  await renderStep('bindPollPicker', bindPollPicker);      // refresh poll picker options for current event
  updateExternalLinks();
}
export async function bootCMS(){
  document.body.classList.add('cms-auth-pending');

  // Authenticate before loading or revealing the CMS.
  await loadUsersFromDB();
  if (!bindLogin()) return;
  bindLogout();

  // pick event
  const u = new URL(location.href);
  const eid = u.searchParams.get('event');
  let list = [];
  try {
    list = await listEvents();
    showFirebaseStatus('Database connected');
  } catch (error) {
    console.error('[CMS] initial Firebase event read failed', error);
    showFirebaseStatus(`Firebase read failed: ${getFirebaseDebugUrl('/events_index')} | ${error?.message || String(error)}`, true);
    const el = document.getElementById('eventList');
    if (el) {
      el.innerHTML = `<div class="muted" style="color:#ff5a67">Firebase event list read failed: ${error?.message || String(error)}</div>`;
    }
  }
  const allowedList = filterEventsForActiveUser(Array.isArray(list) ? list : []);
  if (eid && allowedList.some(e => e.id === eid)) setCurrentEventId(eid);
  else if (!canAccessEvent(getCurrentEventId())) setCurrentEventId(allowedList[0]?.id || null);

  // small helper: call a binder if it exists; await if it returns a promise
  const maybe = async (fn) => {
    try {
      if (typeof fn === 'function') {
        const r = fn();
        if (r && typeof r.then === 'function') await r;
      }
    } catch (err) {
      console.error('[CMS] binder failed:', fn && fn.name, err);
    }
  };
  
  // nav
  const navBtns = document.querySelectorAll('#cmsNav .nav-item');
  navBtns.forEach(b => b.addEventListener('click', () => show(b.dataset.target)));

  // core binders (don’t crash if any is undefined)
  await maybe(bindEventInfoSave);
  await maybe(bindRoster);
  await maybe(bindPrizeActions);
  await maybe(bindQuestions);
  await maybe(bindAssets);
  await maybe(bindGameBooths);
  await maybe(bindPolls);
  await maybe(bindLandingButton);
  await maybe(bindExternalLinks);
  await maybe(bindUsers);
  renderUsersUI();
  applyRoleGuard();
  try { await renderPollManager(); } catch (e) { console.error(e); }


  // new helpers you recently added — guard them too
  await maybe(bindPollComposer);   // ok if not present
  await maybe(bootEventsAdmin);    // ok if not present
  await maybe(bindPollPicker);     // ok if not present

  // final render
  if (typeof renderAll === 'function') {
    await renderAll();
  } else {
    // legacy compatibility: render per-tab if needed (won’t throw)
    await maybe(renderEventInfo);
    await maybe(renderRoster);
    await maybe(renderPrizes);
    await maybe(renderQuestions);
    await maybe(renderAssets);
  }
  // DEV ONLY: expose helpers to the console safely
  if (typeof window !== 'undefined') {
    try {
      window.FB = FB;
      window.getCurrentEventId = getCurrentEventId;
    } catch (_) {}
  }
}

// Let other modules (like events_admin) trigger a full UI refresh
window.refreshCMS = renderAll;
