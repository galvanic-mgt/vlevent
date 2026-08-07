// src/boot.js
function showErrorOverlay(title, error){
  let el = document.getElementById('js-error-overlay');
  if(!el){
    el = document.createElement('div');
    el.id = 'js-error-overlay';
    el.style.cssText = `
      position:fixed;inset:12px;z-index:99999;
      background:rgba(255, 59, 48, .1);border:1px solid rgba(255,59,48,.6);
      color:#ff3b30;padding:12px;border-radius:8px;font:12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      overflow:auto;backdrop-filter:saturate(140%) blur(2px)
    `;
    document.body.appendChild(el);
  }
  const pre = document.createElement('pre');
  pre.style.margin = '0 0 8px 0';
  pre.textContent = `[Module Error] ${title}\n${(error && (error.stack || error.message || String(error)))}`;
  el.appendChild(pre);
}

function setBootStatus(title, detail = '', failed = false){
  const el = document.getElementById('cmsBootStatus');
  if (!el) return;
  const titleEl = document.getElementById('cmsBootTitle');
  const detailEl = document.getElementById('cmsBootDetail');
  el.classList.toggle('is-failed', failed);
  if (titleEl) titleEl.textContent = title;
  if (detailEl) detailEl.textContent = detail;
}

function markBootFailed(title, error){
  document.body.classList.add('cms-auth-pending');
  setBootStatus(title, error?.message || String(error || 'Startup could not finish.'), true);
}

async function safeImport(path, label){
  try{
    const m = await import(path);
    console.info('[Loaded]', label, path);
    return m;
  }catch(err){
    console.error('[Failed]', label, path, err);
    showErrorOverlay(`${label} (${path})`, err);
    return {}; // allow app to continue
  }
}

/* ---- Global safety nets (register once) ---- */
if (!window.__GLOBAL_NETS_BOUND__) {
  window.__GLOBAL_NETS_BOUND__ = true;

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e?.reason || {};
    const msg = reason.message || String(reason);
    const stack = reason.stack || '';
    console.error('[Unhandled Rejection]', reason);
    alert(`[Module Error] unhandledrejection\n${msg}\n${stack}`);
  });

  window.addEventListener('error', (e) => {
    const msg = e?.error?.message || e.message || 'Unknown window error';
    const stack = e?.error?.stack || '';
    console.error('[Unhandled Error]', e?.error || e);
    alert(`[Unhandled Error]\n${msg}\n${stack}`);
  });
}

export async function startApp(){
  setBootStatus('Loading CMS...', 'Checking login and event data.');
  const slowTimer = setTimeout(() => {
    if (document.body.classList.contains('cms-auth-pending')) {
      setBootStatus('Still loading...', 'Checking database and saved login. If this stays here, refresh once or check the connection.');
    }
  }, 8000);
  const failTimer = setTimeout(() => {
    if (document.body.classList.contains('cms-auth-pending')) {
      setBootStatus('Loading failed', 'Startup is taking too long. Refresh once, or check the database/network connection.', true);
    }
  }, 25000);

  // 1) Admin overlay (non-critical)
  const overlay = await safeImport('./admin_overlay.js', 'admin_overlay.js');
  overlay.bindLoginOverlay?.();

  // 2) CMS core
  const cms = await safeImport('./ui_cms_firebase.js?v=20260807a', 'ui_cms_firebase.js');
  if (typeof cms.bootCMS === 'function') {
    try { await cms.bootCMS(); }
    catch (err) {
      markBootFailed('Loading failed', err);
      showErrorOverlay('bootCMS()', err);
    }
  } else {
    markBootFailed('Loading failed', 'ui_cms_firebase.js did not export bootCMS');
    showErrorOverlay('bootCMS()', 'ui_cms_firebase.js did not export bootCMS');
  }
  clearTimeout(slowTimer);
  clearTimeout(failTimer);

  // 3) Public/tablet (no-ops if elements absent)
  const surfaces = await safeImport('./surfaces_public_tablet.js', 'surfaces_public_tablet.js');
  try { surfaces.renderPublicBoard?.(); } catch(e){ showErrorOverlay('renderPublicBoard()', e); }
  try { surfaces.renderTabletView?.(); } catch(e){ showErrorOverlay('renderTabletView()', e); }

  // 4) Optional admin page LAST (avoid cycles)
  const ea = await safeImport('./events_admin.js', 'events_admin.js');
  ea.bootEventsAdmin?.();
}
