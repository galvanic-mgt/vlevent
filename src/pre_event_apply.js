const PRE_EVENT_CONFIG = window.PRE_EVENT_APPLY_CONFIG || {};
const FIREBASE_BASE = PRE_EVENT_CONFIG.firebaseBase || "https://eva-lucky-draw-default-rtdb.asia-southeast1.firebasedatabase.app/";

let currentEventId = "";
let currentGuest = null;
let currentGuestIndex = -1;
let currentApplication = null;

const TEXT = {
  defaultTitle: "活動前登記\nPre-event Application",
  guest: "嘉賓\nGuest",
  checkingBatch: "正在核對員工證編號...\nChecking staff ID...",
  batchNotFound: "找不到此員工證編號，請檢查後再試。\nStaff ID not found. Please check and try again.",
  loadingError: "未能載入活動資料，請稍後再試。\nCould not load this event. Please try again later.",
  lockedNotice: "報名截止日期已過，選擇已鎖定；特殊更改請由指定活動人員人工處理。\nApplication deadline has passed. Choices are locked; special changes must be handled manually by the event team.",
  editUntil: "你可於以下時間前更改選擇：\nYou may edit choices until:",
  editBeforeClose: "你可於主辦方截止報名前更改選擇。\nYou may edit choices before the organizer closes registration.",
  lockedMessage: "報名截止日期已過，選擇已鎖定。\nApplication deadline has passed. Changes are locked.",
  saving: "正在儲存...\nSaving...",
  saved: "選擇已儲存。\nChoices saved.",
  saveError: "未能儲存選擇，請再試一次。\nCould not save choices. Please try again.",
  missingEvent: "缺少活動 ID，請使用活動專屬連結。\nMissing event ID. Please use the event-specific link.",
  finalArrangement: "最終安排\nFinal arrangement",
  revealSoon: "活動前 3 至 7 日開放查詢。\nAvailable 3-7 days before the event.",
  attendance: "出席\nAttendance",
  attending: "出席\nAttending",
  notAttending: "不出席\nNot attending",
  transport: "交通方式\nTransport",
  pickupTime: "出發時間\nDeparture time",
  pickupPoint: "出發地點\nPickup point",
  returnPoint: "回程地點\nReturn point",
  returnTime: "回程時間\nReturn time",
  meal: "餐飲\nMeal",
  tableSeat: "台號 座位\nTable Seat",
  luckyDraw: "抽獎結果\nLucky draw result"
};

function $(id) {
  return document.getElementById(id);
}

function dbUrl(path) {
  const p = path.startsWith("/") ? path : "/" + path;
  return FIREBASE_BASE.replace(/\/$/, "") + p + ".json";
}

async function dbGet(path) {
  const res = await fetch(dbUrl(path));
  if (!res.ok) throw new Error("Firebase GET failed: " + res.status);
  return res.json();
}

async function dbPatch(path, body) {
  const res = await fetch(dbUrl(path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) throw new Error("Firebase PATCH failed: " + res.status);
  const data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}

async function dbPut(path, body) {
  const res = await fetch(dbUrl(path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) throw new Error("Firebase PUT failed: " + res.status);
  const data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}

async function dbPost(path, body) {
  const res = await fetch(dbUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) throw new Error("Firebase POST failed: " + res.status);
  const data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}

function queryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function safeKey(value) {
  return String(value || "").trim().replace(/[.#$/\[\]]/g, "_");
}

function normalise(value) {
  return String(value || "").trim().toLowerCase();
}

function normaliseDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function optionLabel(list, value) {
  const found = (Array.isArray(list) ? list : []).find(item => item.value === value);
  return found ? found.label : value || "";
}

function optionItem(list, value) {
  return (Array.isArray(list) ? list : []).find(item => item.value === value) || null;
}

function normaliseTransportValue(value) {
  const aliases = {
    coach: "shuttle_bus",
    bus: "shuttle_bus",
    flight: "airport_express",
    mtr: "self_arrangement"
  };
  return aliases[value] || value || "self_arrangement";
}

function fillSelect(id, items) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = "";
  (Array.isArray(items) ? items : []).forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.value || item.label || "";
    opt.textContent = item.label || item.value || "";
    el.appendChild(opt);
  });
}

function setCollapsed(el, collapsed) {
  if (!el) return;
  el.classList.toggle("is-collapsed", Boolean(collapsed));
  el.setAttribute("aria-hidden", collapsed ? "true" : "false");
}

function syncShuttleTimes() {
  const pickup = optionItem(PRE_EVENT_CONFIG.pickupLocationOptions, $("pickupLocation")?.value);
  const returnPoint = optionItem(PRE_EVENT_CONFIG.returnLocationOptions, $("returnLocation")?.value);
  const returnTime = returnPoint?.time || PRE_EVENT_CONFIG.fixedReturnTime || $("returnTime")?.value || "23:00";
  if ($("goTime")) $("goTime").value = pickup?.time || "";
  if ($("returnTime")) $("returnTime").value = returnTime;
}

function setMessage(id, text, isError) {
  const el = $(id);
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-error", Boolean(isError));
}

function setMultilineText(el, text) {
  if (!el) return;
  el.textContent = text || "";
  el.style.whiteSpace = "pre-line";
}

async function loadEventHeader(eid) {
  const [meta, info, logo, background, banner] = await Promise.all([
    dbGet(`/events/${eid}/meta`).catch(() => ({})),
    dbGet(`/events/${eid}/info`).catch(() => ({})),
    dbGet(`/events/${eid}/logo`).catch(() => ""),
    dbGet(`/events/${eid}/background`).catch(() => ""),
    dbGet(`/events/${eid}/banner`).catch(() => "")
  ]);

  $("eventClient").textContent = meta?.client || info?.client || "";
  setMultilineText($("eventTitle"), info?.title || meta?.name || TEXT.defaultTitle);
  $("eventMeta").textContent = [info?.dateTime, info?.venue].filter(Boolean).join(" | ");

  if (logo) {
    $("eventLogo").src = logo;
    $("eventLogo").style.display = "block";
  }

  const bg = background || banner || "";
  if (bg) {
    document.body.style.backgroundImage = `linear-gradient(rgba(245,247,251,.88), rgba(245,247,251,.92)), url("${bg}")`;
    document.body.style.backgroundSize = "cover";
    document.body.style.backgroundPosition = "center";
    document.body.style.backgroundAttachment = "fixed";
  }

  const eventDate = parseDate(info?.dateTime || meta?.dateTime);
  return { meta, info, eventDate };
}

function getDeadline(eventSettings) {
  return parseDate(eventSettings?.registrationDeadline || PRE_EVENT_CONFIG.registrationDeadline);
}

function detailsRevealOpen(eventSettings, eventDate) {
  const explicit = parseDate(eventSettings?.revealFrom || PRE_EVENT_CONFIG.revealFrom);
  if (explicit) return Date.now() >= explicit.getTime();
  if (!eventDate) return false;
  const days = Number(eventSettings?.revealDaysBeforeEvent || PRE_EVENT_CONFIG.revealDaysBeforeEvent || 7);
  const revealAt = eventDate.getTime() - days * 24 * 60 * 60 * 1000;
  return Date.now() >= revealAt;
}

async function loadEventSettings(eid) {
  return (await dbGet(`/events/${eid}/preEventSettings`).catch(() => ({}))) || {};
}

async function findGuest(eid, rawBatch) {
  const people = await dbGet(`/events/${eid}/people`);
  const list = Array.isArray(people) ? people : [];
  const inputText = normalise(rawBatch);
  const inputDigits = normaliseDigits(rawBatch);

  for (let i = 0; i < list.length; i += 1) {
    const p = list[i] || {};
    const codeMatch = inputText && normalise(p.code) === inputText;
    const phoneMatch = inputDigits && normaliseDigits(p.phone) === inputDigits;
    if (codeMatch || phoneMatch) return { guest: p, index: i };
  }
  return { guest: null, index: -1 };
}

async function loadApplication(eid, guest) {
  const key = safeKey(guest.code || guest.phone || guest.name);
  const app = await dbGet(`/events/${eid}/preEventApplications/${key}`).catch(() => null);
  if (app) return app;

  const rawFallback = await dbGet(`/events/${eid}/preAttendance`).catch(() => null);
  const fallbackRows = Object.entries(rawFallback || {})
    .map(([id, row]) => ({ id, ...(row || {}) }))
    .filter(row => row.source === "pre_event_apply.html")
    .filter(row => {
      const codeMatch = row.code && guest.code && normalise(row.code) === normalise(guest.code);
      const phoneMatch = row.phone && guest.phone && normaliseDigits(row.phone) === normaliseDigits(guest.phone);
      return codeMatch || phoneMatch;
    })
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));

  return fallbackRows[0] || guest.preEvent || {};
}

function setFormDisabled(disabled) {
  document.querySelectorAll("#applicationForm input, #applicationForm select, #applicationForm textarea, #submitButton")
    .forEach(el => { el.disabled = disabled; });
}

function applyApplicationToForm(app) {
  const attending = app.attending === false || app.attending === "no" ? "no" : "yes";
  const radio = document.querySelector(`input[name="attending"][value="${attending}"]`);
  if (radio) radio.checked = true;
  $("transport").value = normaliseTransportValue(app.transport);
  $("goTime").value = app.goTime || "";
  $("pickupLocation").value = app.pickupLocation || "";
  $("returnTime").value = app.returnTime || "";
  $("returnLocation").value = app.returnLocation || "";
  $("meal").value = app.meal || "non_vegetarian";
  $("remarks").value = app.remarks || "";
  syncShuttleTimes();
  updateChoiceVisibility();
}

function updateChoiceVisibility() {
  const attending = document.querySelector('input[name="attending"]:checked')?.value !== "no";
  const shuttleSelected = $("transport")?.value === "shuttle_bus";
  syncShuttleTimes();
  setCollapsed($("choiceFields"), !attending);
  setCollapsed($("shuttleFields"), !attending || !shuttleSelected);
  ["transport", "meal"].forEach(id => {
    const el = $(id);
    if (el) el.required = attending;
  });
  ["pickupLocation", "returnLocation"].forEach(id => {
    const el = $(id);
    if (el) el.required = attending && shuttleSelected;
  });
  ["goTime", "returnTime"].forEach(id => {
    const el = $(id);
    if (el) el.required = false;
  });
  if (!attending) {
    $("submitButton")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function buildApplicationPayload() {
  const attending = document.querySelector('input[name="attending"]:checked')?.value !== "no";
  const transport = attending ? $("transport").value : "";
  const shuttleSelected = transport === "shuttle_bus";
  syncShuttleTimes();
  const pickup = optionItem(PRE_EVENT_CONFIG.pickupLocationOptions, $("pickupLocation")?.value);
  const returnTime = PRE_EVENT_CONFIG.fixedReturnTime || $("returnTime")?.value || "";
  return {
    eventId: currentEventId,
    personIndex: currentGuestIndex,
    code: currentGuest?.code || "",
    phone: currentGuest?.phone || "",
    name: currentGuest?.name || "",
    dept: currentGuest?.dept || "",
    attending,
    attendanceLabel: attending ? TEXT.attending.replace("\n", " ") : TEXT.notAttending.replace("\n", " "),
    transport,
    transportLabel: attending ? optionLabel(PRE_EVENT_CONFIG.transportOptions, transport) : "",
    goTime: shuttleSelected ? pickup?.time || $("goTime").value : "",
    pickupLocation: shuttleSelected ? $("pickupLocation").value : "",
    pickupLocationLabel: shuttleSelected ? optionLabel(PRE_EVENT_CONFIG.pickupLocationOptions, $("pickupLocation").value) : "",
    returnTime: shuttleSelected ? returnTime : "",
    returnLocation: shuttleSelected ? $("returnLocation").value : "",
    returnLocationLabel: shuttleSelected ? optionLabel(PRE_EVENT_CONFIG.returnLocationOptions, $("returnLocation").value) : "",
    meal: attending ? $("meal").value : "",
    mealLabel: attending ? optionLabel(PRE_EVENT_CONFIG.mealOptions, $("meal").value) : "",
    remarks: $("remarks").value.trim(),
    source: "pre_event_apply.html",
    applicationKey: safeKey(currentGuest?.code || currentGuest?.phone || currentGuest?.name),
    submittedAt: currentApplication?.submittedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function renderDetails(app, guest, canReveal) {
  const panel = $("detailPanel");
  const grid = $("detailGrid");
  if (!panel || !grid) return;

  if (!canReveal) {
    panel.hidden = false;
    grid.innerHTML = `<div>${TEXT.revealSoon.replace("\n", "<br>")}</div>`;
    return;
  }

  const final = app.finalArrangement || {};
  const rewardRounds = guest.rewardRounds || {};
  const roundText = Object.entries(rewardRounds).map(([round, prize]) => `${round}: ${prize}`).join(", ");
  const rows = [
    [TEXT.attendance, app.attending === false ? TEXT.notAttending : TEXT.attending],
    [TEXT.transport, final.transportLabel || app.transportLabel || app.transport || ""],
    [TEXT.pickupTime, final.pickupTime || final.goTime || app.goTime || ""],
    [TEXT.pickupPoint, final.pickupLocation || app.pickupLocationLabel || app.pickupLocation || ""],
    [TEXT.returnPoint, final.returnLocation || app.returnLocationLabel || app.returnLocation || ""],
    [TEXT.returnTime, final.returnTime || app.returnTime || ""],
    [TEXT.meal, final.mealLabel || app.mealLabel || app.meal || ""],
    [TEXT.tableSeat, [final.table || guest.table, final.seat || guest.seat].filter(Boolean).join("  ")],
    [TEXT.luckyDraw, [guest.prize, roundText].filter(Boolean).join(" | ")]
  ];

  panel.hidden = false;
  grid.innerHTML = rows.map(([label, value]) => `<div><strong>${label.replace("\n", "<br>")}</strong>${String(value || "-").replace("\n", "<br>")}</div>`).join("");
}

async function showGuest(rawBatch) {
  setMessage("loginMessage", TEXT.checkingBatch, false);
  const { guest, index } = await findGuest(currentEventId, rawBatch);
  if (!guest) {
    setMessage("loginMessage", TEXT.batchNotFound, true);
    return;
  }

  currentGuest = guest;
  currentGuestIndex = index;
  currentApplication = await loadApplication(currentEventId, guest);

  const settings = await loadEventSettings(currentEventId);
  const { info, meta } = await loadEventHeader(currentEventId);
  const deadline = getDeadline(settings);
  const locked = deadline && Date.now() > deadline.getTime();
  const canReveal = detailsRevealOpen(settings, parseDate(info?.dateTime || meta?.dateTime));

  setMultilineText($("guestName"), guest.name || TEXT.guest);
  $("guestInfo").textContent = [guest.dept, guest.code, guest.phone].filter(Boolean).join(" | ");
  $("loginPanel").hidden = true;
  $("applicationPanel").hidden = false;
  $("lockNotice").textContent = locked
    ? TEXT.lockedNotice
    : deadline
      ? `${TEXT.editUntil} ${deadline.toLocaleString()}.`
      : TEXT.editBeforeClose;
  $("lockNotice").classList.toggle("is-error", Boolean(locked));

  applyApplicationToForm(currentApplication);
  setFormDisabled(Boolean(locked));
  renderDetails(currentApplication, guest, canReveal);
  setMessage("loginMessage", "", false);
}

async function saveApplication() {
  if (!currentGuest) return;
  const settings = await loadEventSettings(currentEventId);
  const deadline = getDeadline(settings);
  if (deadline && Date.now() > deadline.getTime()) {
    setMessage("formMessage", TEXT.lockedMessage, true);
    setFormDisabled(true);
    return;
  }

  const payload = buildApplicationPayload();
  const key = safeKey(currentGuest.code || currentGuest.phone || currentGuest.name);
  try {
    await dbPut(`/events/${currentEventId}/preEventApplications/${key}`, payload);
  } catch (primaryError) {
    console.warn("[pre-event] primary application save failed, trying fallback", primaryError);
    await dbPost(`/events/${currentEventId}/preAttendance`, {
      ...payload,
      primarySaveError: primaryError?.message || String(primaryError)
    });
  }
  try {
    await dbPatch(`/events/${currentEventId}/people/${currentGuestIndex}`, { preEvent: payload });
  } catch (error) {
    console.warn("[pre-event] application saved, roster mirror skipped", error);
  }
  currentApplication = payload;
  setMessage("formMessage", TEXT.saved, false);
}

function bind() {
  $("loginForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    try {
      await showGuest($("batchInput").value);
    } catch (error) {
      console.error("[pre-event] login failed", error);
      setMessage("loginMessage", TEXT.loadingError, true);
    }
  });

  $("applicationForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    if (!$("applicationForm").reportValidity()) return;
    $("submitButton").disabled = true;
    setMessage("formMessage", TEXT.saving, false);
    try {
      await saveApplication();
    } catch (error) {
      console.error("[pre-event] save failed", error);
      setMessage("formMessage", TEXT.saveError, true);
    } finally {
      $("submitButton").disabled = false;
    }
  });

  document.querySelectorAll('input[name="attending"]').forEach(input => {
    input.addEventListener("change", updateChoiceVisibility);
  });
  $("transport").addEventListener("change", updateChoiceVisibility);
  $("pickupLocation").addEventListener("change", syncShuttleTimes);
  $("returnLocation").addEventListener("change", syncShuttleTimes);

  const logoutButton = $("logoutButton");
  if (logoutButton) {
    logoutButton.addEventListener("click", () => {});
  }
}

async function boot() {
  currentEventId = queryParam("event") || queryParam("eid") || "";
  fillSelect("transport", PRE_EVENT_CONFIG.transportOptions);
  fillSelect("goTime", PRE_EVENT_CONFIG.goTimeOptions);
  fillSelect("pickupLocation", PRE_EVENT_CONFIG.pickupLocationOptions);
  fillSelect("returnTime", PRE_EVENT_CONFIG.returnTimeOptions);
  fillSelect("returnLocation", PRE_EVENT_CONFIG.returnLocationOptions);
  fillSelect("meal", PRE_EVENT_CONFIG.mealOptions);
  syncShuttleTimes();
  bind();

  if (!currentEventId) {
    setMessage("loginMessage", TEXT.missingEvent, true);
    $("batchInput").disabled = true;
    return;
  }

  await loadEventHeader(currentEventId).catch(error => {
    console.warn("[pre-event] header failed", error);
  });
}

document.addEventListener("DOMContentLoaded", boot);
