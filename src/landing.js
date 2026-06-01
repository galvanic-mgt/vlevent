// landing.js — event landing page (check-in + event visuals)
// Standalone file: uses Firebase Realtime Database REST API directly, no imports.

// === CONFIG ===
// NOTE: this should match src/config.js.
const FIREBASE_BASE = "https://eva-lucky-draw-default-rtdb.asia-southeast1.firebasedatabase.app/";

// Helper to build URLs like `${FIREBASE_BASE}/events/e123/info.json`
function dbUrl(path) {
  const p = path.startsWith("/") ? path : "/" + path;
  return FIREBASE_BASE.replace(/\/$/, "") + p + ".json";
}

async function dbGet(path) {
  const res = await fetch(dbUrl(path));
  if (!res.ok) {
    throw new Error("Firebase GET failed: " + res.status + " " + res.statusText);
  }
  return res.json();
}

// PATCH merges with existing node
async function dbPatch(path, body) {
  const res = await fetch(dbUrl(path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) {
    throw new Error("Firebase PATCH failed: " + res.status + " " + res.statusText);
  }
  return res.json();
}

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

// Normalise: digits-only for phone; lowercased trimmed for text/code
function normaliseDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}
function normaliseText(s) {
  return String(s || "").trim().toLowerCase();
}

function hongKongDateTime(ts = Date.now()) {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(ts));
}

function applyLandingBanner(bannerEl, url) {
  if (!bannerEl || !url) return;
  bannerEl.style.backgroundImage = `url('${url}')`;
  bannerEl.style.backgroundSize = "100% auto";
  bannerEl.style.backgroundRepeat = "no-repeat";
  bannerEl.style.backgroundPosition = "top center";
  bannerEl.style.display = "block";

  const img = new Image();
  img.onload = () => {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      bannerEl.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    }
  };
  img.src = url;
}

let landingPeople = [];
let landingBooths = [];
let currentGuestIndex = -1;
let currentEventId = "";
let boothStream = null;
let boothScanTimer = null;
let boothScanCanvas = null;
const GUEST_SESSION_MS = 6 * 60 * 60 * 1000;
const boothDefaultName = (index) => `遊戲攤位 ${index} (Game Booth ${index})`;

function defaultGameBooths() {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `booth_${i + 1}`,
    name: boothDefaultName(i + 1),
    active: true
  }));
}

function normalizeGameBooths(raw) {
  const list = Array.isArray(raw) ? raw : Object.values(raw || {});
  return list
    .filter(Boolean)
    .map((booth, index) => ({
      id: String(booth.id || `booth_${index + 1}`),
      name: String(booth.name || boothDefaultName(index + 1)),
      active: booth.active !== false
    }))
    .filter((booth) => booth.active !== false);
}

function boothIdFromScan(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.searchParams.get("booth") || raw;
  } catch (_) {
    return raw;
  }
}

function boothSessionKey(eid) {
  return eid ? `landing-game-booth-visitor:${eid}` : "";
}

function saveGuestSession() {
  const key = boothSessionKey(currentEventId);
  if (!key || currentGuestIndex < 0) return;
  const guest = landingPeople[currentGuestIndex] || {};
  localStorage.setItem(key, JSON.stringify({
    index: currentGuestIndex,
    phone: guest.phone || "",
    code: guest.code || "",
    name: guest.name || "",
    table: guest.table || "",
    seat: guest.seat || "",
    expiresAt: Date.now() + GUEST_SESSION_MS
  }));
}

function restoreGuestSession(eid) {
  const key = boothSessionKey(eid);
  if (!key) return;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    if (!saved.expiresAt || Date.now() > Number(saved.expiresAt)) {
      localStorage.removeItem(key);
      return;
    }
    if (!Number.isInteger(saved.index) || !landingPeople[saved.index]) return;
    currentGuestIndex = saved.index;
    renderSeatInfo(landingPeople[saved.index] || saved);
    showGameBoothPanel();
  } catch (_) {}
}

function clearGuestSession() {
  const key = boothSessionKey(currentEventId);
  if (key) localStorage.removeItem(key);
  currentGuestIndex = -1;
  stopBoothScanner();
  const panel = document.getElementById("gameBoothPanel");
  if (panel) panel.style.display = "none";
  const howToGetThere = document.getElementById("howToGetThereSection");
  if (howToGetThere) howToGetThere.style.display = "";
  renderGameBoothStatus();
  showLandingMessage("已登出測試工作階段。你可以再次按報到 (Attend)。Session signed out. You can press Attend again for testing.", false);
}

function currentGuest() {
  return currentGuestIndex >= 0 ? landingPeople[currentGuestIndex] : null;
}

function seatTextForGuest(guest) {
  if (!guest) return "";
  const table = guest.table || "";
  const seat = guest.seat || "";
  return (table || seat)
    ? [
        table ? `枱號：${table} (Table: ${table})` : "",
        seat ? `座位：${seat} (Seat: ${seat})` : ""
      ].filter(Boolean).join("  ")
    : "";
}

function renderSeatInfo(guest) {
  const seatCard = document.getElementById("seatCard");
  const seatInfoEl = document.getElementById("seatInfo");
  if (!seatCard || !seatInfoEl) return;
  const seatStr = seatTextForGuest(guest);
  if (seatStr) {
    seatInfoEl.textContent = seatStr;
    seatCard.style.display = "block";
  } else {
    seatInfoEl.textContent = "";
    seatCard.style.display = "none";
  }
}

function gameBoothCompletionMap() {
  const guest = currentGuest();
  return guest && guest.gameBooths && typeof guest.gameBooths === "object" ? guest.gameBooths : {};
}

function showLandingMessage(text, isError) {
  const msgEl = document.getElementById("checkinMsg");
  if (!msgEl) return;
  msgEl.textContent = text || "";
  msgEl.style.color = isError ? "#ff5a67" : "";
}

function showGameBoothPanel() {
  const panel = document.getElementById("gameBoothPanel");
  if (panel) panel.style.display = landingBooths.length ? "grid" : "none";
  const howToGetThere = document.getElementById("howToGetThereSection");
  if (howToGetThere) howToGetThere.style.display = "none";
  renderGameBoothStatus();
}

function renderGameBoothStatus() {
  const host = document.getElementById("boothStatusList");
  if (!host) return;
  const completed = gameBoothCompletionMap();
  host.innerHTML = "";
  landingBooths.forEach((booth) => {
    const row = document.createElement("div");
    row.className = "lp-booth-status-row";
    const name = document.createElement("span");
    name.textContent = booth.name;
    const status = document.createElement("strong");
    const participated = Boolean(completed[booth.id]);
    status.className = participated ? "lp-booth-participated" : "lp-booth-not-participated";
    status.textContent = participated ? "已參與 (Participated)" : "尚未參與 (Not participated yet)";
    row.append(name, status);
    host.appendChild(row);
  });
}

async function markGameBoothComplete(rawCode) {
  if (currentGuestIndex < 0) {
    showLandingMessage("請先按報到 (Attend)，然後再掃描遊戲攤位。Please mark yourself present before scanning game booths.", true);
    return false;
  }
  const boothId = boothIdFromScan(rawCode);
  const booth = landingBooths.find((item) => item.id === boothId);
  if (!booth) {
    showLandingMessage("此 QR Code 不是有效的遊戲攤位。This QR code is not for a valid game booth.", true);
    return false;
  }

  const timestamp = Date.now();
  const guest = landingPeople[currentGuestIndex] || {};
  const gameBooths = { ...(guest.gameBooths || {}), [booth.id]: timestamp };
  landingPeople[currentGuestIndex] = { ...guest, gameBooths };
  await Promise.all([
    dbPatch(`/events/${currentEventId}/people/${currentGuestIndex}`, { gameBooths }),
    dbPatch(`/events/${currentEventId}/gameBoothAttendance/${booth.id}`, {
      [currentGuestIndex]: {
        time: timestamp,
        name: guest.name || "",
        phone: guest.phone || "",
        code: guest.code || ""
      }
    })
  ]);
  renderGameBoothStatus();
  showLandingMessage(`${booth.name}: 已參與 (Participated)`, false);
  return true;
}

async function startBoothScanner() {
  if (currentGuestIndex < 0) {
    showLandingMessage("請先按報到 (Attend)，然後再開啟相機。Please mark yourself present before opening the camera.", true);
    return;
  }
  const canUseNativeDetector = "BarcodeDetector" in window;
  const canUseJsQr = typeof window.jsQR === "function";
  if (!canUseNativeDetector && !canUseJsQr) {
    showLandingMessage("此瀏覽器不支援相機 QR 掃描，請在下方貼上 QR 連結或代碼。Camera QR scanning is not supported in this browser. Paste the QR link or code below.", true);
    return;
  }

  const video = document.getElementById("boothScannerVideo");
  if (!video) return;
  boothStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false
  });
  video.srcObject = boothStream;
  video.classList.add("is-active");
  await video.play();

  const detector = canUseNativeDetector ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
  if (!boothScanCanvas) boothScanCanvas = document.createElement("canvas");
  clearInterval(boothScanTimer);
  boothScanTimer = setInterval(async () => {
    try {
      const value = detector
        ? await scanWithBarcodeDetector(detector, video)
        : scanWithJsQr(video);
      if (!value) return;
      const marked = await markGameBoothComplete(value);
      if (marked) stopBoothScanner();
    } catch (err) {
      console.warn("Booth QR scan failed", err);
    }
  }, 700);
}

async function scanWithBarcodeDetector(detector, video) {
  const codes = await detector.detect(video);
  return codes?.[0]?.rawValue || "";
}

function scanWithJsQr(video) {
  if (!boothScanCanvas || !video.videoWidth || !video.videoHeight || typeof window.jsQR !== "function") return "";
  boothScanCanvas.width = video.videoWidth;
  boothScanCanvas.height = video.videoHeight;
  const ctx = boothScanCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "";
  ctx.drawImage(video, 0, 0, boothScanCanvas.width, boothScanCanvas.height);
  const imageData = ctx.getImageData(0, 0, boothScanCanvas.width, boothScanCanvas.height);
  const code = window.jsQR(imageData.data, imageData.width, imageData.height);
  return code?.data || "";
}

function stopBoothScanner() {
  clearInterval(boothScanTimer);
  boothScanTimer = null;
  if (boothStream) boothStream.getTracks().forEach((track) => track.stop());
  boothStream = null;
  const video = document.getElementById("boothScannerVideo");
  if (video) {
    video.pause();
    video.srcObject = null;
    video.classList.remove("is-active");
  }
}

function bindGameBoothControls() {
  document.getElementById("startBoothScanner")?.addEventListener("click", () => {
    startBoothScanner().catch((err) => {
      console.error(err);
      showLandingMessage("未能開啟相機，請允許相機權限，或在下方貼上 QR 連結或代碼。Unable to open camera. Please allow camera access or paste the QR link or code below.", true);
    });
  });
  document.getElementById("manualBoothSubmit")?.addEventListener("click", async () => {
    const input = document.getElementById("manualBoothCode");
    await markGameBoothComplete(input?.value || "");
    if (input) input.value = "";
  });
  document.getElementById("signOutBoothSession")?.addEventListener("click", clearGuestSession);
}

// ---- Event info + visuals ----
async function loadEventHeader(eid) {
  // Load info (title / date-time / venue / address / transport / notes)
  const info = (await dbGet(`/events/${eid}/info`)) || {};

  const $ = (id) => document.getElementById(id);
  const pick = (val, fallback) =>
    (typeof val === "string" && val.trim() ? val.trim() : fallback);

  if ($("evTitle"))     $("evTitle").textContent    = info.title    || "活動";
  if ($("evDateTime"))  $("evDateTime").textContent = info.dateTime || "";
  if ($("evVenue"))     $("evVenue").textContent    = info.venue    || "";
  if ($("evAddress"))   $("evAddress").textContent  = info.address  || "";

  if ($("evBus"))       $("evBus").textContent      = info.bus      || "";
  if ($("evTrain"))     $("evTrain").textContent    = info.train    || "";
  if ($("evParking"))   $("evParking").textContent  = info.parking  || "";

  // Hide empty transport blocks
  const hasBus     = Boolean((info.bus || '').trim());
  const hasTrain   = Boolean((info.train || '').trim());
  const hasParking = Boolean((info.parking || '').trim());
  const busBlock     = document.getElementById('busBlock');
  const trainBlock   = document.getElementById('trainBlock');
  const parkingBlock = document.getElementById('parkingBlock');
  if (busBlock)     busBlock.style.display     = hasBus ? '' : 'none';
  if (trainBlock)   trainBlock.style.display   = hasTrain ? '' : 'none';
  if (parkingBlock) parkingBlock.style.display = hasParking ? '' : 'none';
  if ($("evNotes"))     $("evNotes").textContent    = info.notes    || "";
  // Landing copy (editable via CMS 活動資料)
  const labelPhone = info.labelPhone || "電話";
  const labelDept  = info.labelDept  || "代號";
  const titleEl = document.getElementById("checkinTitle");
  const labelEl = document.getElementById("checkinLabel");
  const inputEl = document.getElementById("codeDigits");
  const btnEl = document.getElementById("checkinButton");
  const seatTitleEl = document.getElementById("seatTitle");
  const tipTitleEl = document.getElementById("tipTitle");
  const tipBodyEl = document.getElementById("tipBody");
  const transportTitleEl = document.getElementById("transportTitle");
  const busTitleEl = document.getElementById("busTitle");
  const trainTitleEl = document.getElementById("trainTitle");
  const parkingTitleEl = document.getElementById("parkingTitle");

  const defaultCheckinTitle = `到場報到（輸入${labelPhone}或${labelDept}）`;
  const defaultCheckinLabel = "***";
  const defaultCheckinPlaceholder = "(請輸入電話 Mobile No.)";

  if (titleEl) titleEl.textContent = pick(info.landingCheckinTitle, defaultCheckinTitle);
  if (labelEl) labelEl.textContent = pick(info.landingCheckinLabel, defaultCheckinLabel);
  if (inputEl) inputEl.placeholder = pick(info.landingCheckinPlaceholder, defaultCheckinPlaceholder);
  if (btnEl) btnEl.textContent = pick(info.landingCheckinButton, "報到");
  if (seatTitleEl) seatTitleEl.textContent = pick(info.landingSeatTitle, "歡迎！你的座位安排");
  if (tipTitleEl) tipTitleEl.textContent = pick(info.landingTipTitle, "歡迎蒞臨 Welcome !");
  if (tipBodyEl) tipBodyEl.textContent = pick(
    info.landingTipBody,
    "請根據場內指示入座，如有任何問題，歡迎向現場工作人員查詢。"
  );
  if (transportTitleEl) transportTitleEl.textContent = pick(info.landingTransportTitle, "今晚設有大抽獎，祝好運!");
  if (busTitleEl) busTitleEl.textContent = pick(info.landingBusTitle, "巴士");
  if (trainTitleEl) trainTitleEl.textContent = pick(info.landingTrainTitle, "地鐵 / 火車");
  if (parkingTitleEl) parkingTitleEl.textContent = pick(info.landingParkingTitle, "泊車");

  const pageTitle = pick(info.landingPageTitle, "");
  if (pageTitle) document.title = pageTitle;

  if ($("mapBtn")) {
    $("mapBtn").textContent = pick(info.landingMapButton, "在地圖打開");
    const url = info.mapUrl || "";
    $("mapBtn").style.display = url ? "inline-flex" : "none";
    if (url) $("mapBtn").href = url;
  }

  const livePhotoButton = document.getElementById("livePhotoLinkButton");
  if (livePhotoButton) {
    const livePhotoLink = String(info.landingLivePhotoLink || "").trim();
    livePhotoButton.style.display = livePhotoLink ? "inline-flex" : "none";
    if (livePhotoLink) livePhotoButton.href = livePhotoLink;
  }
  const hasNotes = Boolean((info.notes || "").trim());
  const hasMap = Boolean((info.mapUrl || "").trim());
  const hasTransport = hasBus || hasTrain || hasParking || hasNotes || hasMap;

  // Load assets for logo / banner / background.
  const [
    logoUrl,
    bannerUrl,
    landingBannerUrl,
    backgroundUrl,
    photos,
    assetSettings
  ] = await Promise.all([
    dbGet(`/events/${eid}/logo`),
    dbGet(`/events/${eid}/banner`),
    dbGet(`/events/${eid}/landingBanner`).catch(() => ""),
    dbGet(`/events/${eid}/background`),
    dbGet(`/events/${eid}/photos`),
    dbGet(`/events/${eid}/assetSettings`).catch(() => ({}))
  ]);

  const bannerEl = document.getElementById("banner");
  const logoEl   = document.getElementById("logo");

  const finalLogo   = logoUrl   || "";
  const finalBanner = assetSettings?.landingBanner || landingBannerUrl || "";
  let   finalBg     = backgroundUrl || "";

  if (!finalBg) {
    if (Array.isArray(photos) && photos.length > 0) {
      // assume photos[] is array of URL strings
      finalBg = photos[0];
    } else {
      finalBg = finalBanner || bannerUrl || "";
    }
  }

  if (logoEl && finalLogo) {
    logoEl.src = finalLogo;
    logoEl.style.display = "block";
  }

  if (bannerEl && finalBanner) {
    applyLandingBanner(bannerEl, finalBanner);
  }

  // Page background with 25% dark overlay
  if (finalBg) {
    const dim = 0.25;
    document.body.style.backgroundImage =
      `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url('${finalBg}')`;
    document.body.style.backgroundSize = "cover";
    document.body.style.backgroundPosition = "center center";
    document.body.style.backgroundRepeat = "no-repeat";
    document.body.style.backgroundAttachment = "fixed";
  }
}

// ---- Guest check-in (phone OR code) ----
function attachCheckin(eid) {
  const form       = document.getElementById("checkinForm");
  const input      = document.getElementById("codeDigits");
  const msgEl      = document.getElementById("checkinMsg");
  const seatCard   = document.getElementById("seatCard");
  const seatInfoEl = document.getElementById("seatInfo");

  if (!form || !input) return;

  function showMessage(text, isError) {
    if (!msgEl) return;
    msgEl.textContent = text || "";
    msgEl.style.color = isError ? "#ff5a67" : "";
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();

    const raw = input.value.trim();
    if (!raw) {
      showMessage("請輸入電話或代碼。", true);
      return;
    }

    showMessage("查詢中…", false);
    if (seatCard) seatCard.style.display = "none";
    if (seatInfoEl) seatInfoEl.textContent = "";

    try {
      landingPeople = (await dbGet(`/events/${eid}/people`)) || [];
      if (!Array.isArray(landingPeople) || landingPeople.length === 0) {
        showMessage("找不到名單，請向職員查詢。", true);
        return;
      }

      const digits = normaliseDigits(raw);
      const text   = normaliseText(raw);

      let foundIndex = -1;
      let found      = null;

      for (let i = 0; i < landingPeople.length; i++) {
        const p = landingPeople[i];
        if (!p) continue;

        const pPhoneDigits = normaliseDigits(p.phone);
        const pCodeText    = normaliseText(p.code);

        const matchPhone = digits && pPhoneDigits && pPhoneDigits === digits;
        const matchCode  = text && pCodeText && pCodeText === text;

        if (matchPhone || matchCode) {
          foundIndex = i;
          found = p;
          break;
        }
      }

      if (foundIndex === -1 || !found) {
        showMessage("找不到相符的記錄，請檢查輸入或向職員查詢。", true);
        return;
      }

      // Mark as present and record landing-page login times in Hong Kong time.
      const now = Date.now();
      const firstLoginAt = found.firstLoginAt || now;
      const firstLoginAtHK = found.firstLoginAtHK || hongKongDateTime(firstLoginAt);
      const loginPatch = {
        checkedIn: true,
        firstLoginAt,
        firstLoginAtHK,
        lastLoginAt: now,
        lastLoginAtHK: hongKongDateTime(now)
      };
      await dbPatch(`/events/${eid}/people/${foundIndex}`, loginPatch);
      currentGuestIndex = foundIndex;
      landingPeople[foundIndex] = { ...found, ...loginPatch };
      saveGuestSession();

      const name    = found.name || "";
      const table   = found.table || "";
      const seat    = found.seat || "";
      const seatStr = (table || seat)
        ? [table ? `枱：${table}` : "", seat ? `座位：${seat}` : ""]
            .filter(Boolean)
            .join(" · ")
        : "";

      const successMsg = `✅ 已為 ${name || "來賓"} 登記出席，歡迎！`;
      const sessionSeatStr = seatTextForGuest(found);
      showMessage(successMsg, false);

      if (seatCard && seatInfoEl) {
        if (seatStr) {
          seatInfoEl.textContent = seatStr;
          seatCard.style.display = "block";
        } else {
          seatCard.style.display = "none";
        }
      }
      renderSeatInfo(found);
      showGameBoothPanel();
      const boothFromUrl = getQueryParam("booth");
      if (boothFromUrl) await markGameBoothComplete(boothFromUrl);
      const popupMsg = sessionSeatStr ? `${successMsg}\n${sessionSeatStr}` : successMsg;
      alert(popupMsg);

      // Optional: clear input after success
      input.value = "";

    } catch (err) {
      console.error("Check-in failed", err);
      showMessage("系統錯誤，請稍後再試或向職員查詢。", true);
    }
  });
}

// ---- Boot ----
async function bootLanding() {
  // event ID comes from ?event=xxx (same as Public Board)
  const eid = getQueryParam("event") || getQueryParam("eid");
  currentEventId = eid || "";

  if (!eid) {
    console.warn("No event ID in URL (?event=...) – landing page cannot bind to an event.");
    const msgEl = document.getElementById("checkinMsg");
    if (msgEl) {
      msgEl.textContent = "（缺少活動編號，請從正確 QR Code 開啟此頁。）";
    }
    return;
  }

  try {
    await loadEventHeader(eid);
    const [peopleRaw, boothsRaw] = await Promise.all([
      dbGet(`/events/${eid}/people`).catch(() => []),
      dbGet(`/events/${eid}/gameBooths`).catch(() => [])
    ]);
    landingPeople = Array.isArray(peopleRaw) ? peopleRaw : [];
    landingBooths = normalizeGameBooths(boothsRaw);
    restoreGuestSession(eid);
    renderGameBoothStatus();
  } catch (err) {
    console.error("Failed to load event info", err);
    const msgEl = document.getElementById("checkinMsg");
    if (msgEl) {
      msgEl.textContent = "載入活動資料時出錯，請稍後再試。";
    }
  }

  attachCheckin(eid);
  bindGameBoothControls();
}

window.addEventListener("beforeunload", stopBoothScanner);
document.addEventListener("DOMContentLoaded", bootLanding);
