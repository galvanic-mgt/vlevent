const ENTRANCE_CONFIG = window.PRE_EVENT_APPLY_CONFIG || {};
const ENTRANCE_FIREBASE_BASE = ENTRANCE_CONFIG.firebaseBase || "https://eva-lucky-draw-default-rtdb.asia-southeast1.firebasedatabase.app/";

let entranceEventId = "";

function $(id) {
  return document.getElementById(id);
}

function dbUrl(path) {
  const p = path.startsWith("/") ? path : "/" + path;
  return ENTRANCE_FIREBASE_BASE.replace(/\/$/, "") + p + ".json";
}

async function dbGet(path) {
  const res = await fetch(dbUrl(path));
  if (!res.ok) throw new Error("Firebase GET failed: " + res.status);
  return res.json();
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

function setMessage(text, isError) {
  $("loginMessage").textContent = text || "";
  $("loginMessage").classList.toggle("is-error", Boolean(isError));
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
  $("eventTitle").textContent = info?.title || meta?.name || "Event Entrance";
  $("eventMeta").textContent = [info?.dateTime, info?.venue].filter(Boolean).join(" | ");
  if (logo) {
    $("eventLogo").src = logo;
    $("eventLogo").style.display = "block";
  }
  const bg = background || banner || "";
  if (bg) {
    document.body.style.backgroundImage = `linear-gradient(rgba(245,247,251,.9), rgba(245,247,251,.94)), url("${bg}")`;
    document.body.style.backgroundSize = "cover";
    document.body.style.backgroundPosition = "center";
  }
  return { meta, info };
}

async function findGuest(eid, rawBatch) {
  const people = await dbGet(`/events/${eid}/people`);
  const list = Array.isArray(people) ? people : [];
  const inputText = normalise(rawBatch);
  const inputDigits = normaliseDigits(rawBatch);
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i] || {};
    if ((inputText && normalise(p.code) === inputText) || (inputDigits && normaliseDigits(p.phone) === inputDigits)) {
      return p;
    }
  }
  return null;
}

async function loadApplication(eid, guest) {
  const key = safeKey(guest.code || guest.phone || guest.name);
  return (await dbGet(`/events/${eid}/preEventApplications/${key}`).catch(() => null)) || guest.preEvent || {};
}

function rewardsText(guest) {
  const extra = guest.rewardRounds && typeof guest.rewardRounds === "object"
    ? Object.entries(guest.rewardRounds).map(([round, prize]) => `${round}: ${prize}`).join(" | ")
    : "";
  return [guest.prize, extra].filter(Boolean).join(" | ");
}

function renderEntrance(guest, app, eventInfo, ui) {
  const final = app.finalArrangement || {};
  const currentPoll = ui?.currentPollId || "";
  const voteLink = currentPoll
    ? `vote.html?event=${encodeURIComponent(entranceEventId)}&poll=${encodeURIComponent(currentPoll)}&batch=${encodeURIComponent(guest.code || "")}`
    : "";
  const menuText = eventInfo?.menu || final.menu || app.menu || "Please refer to the event team.";
  const gameStatus = guest.gameClaimed || guest.gamePlayed ? "Recorded" : "Available";
  const giftStatus = guest.giftClaimed ? "Redeemed" : "Not redeemed";
  const rows = [
    ["Seat", [final.table || guest.table, final.seat || guest.seat].filter(Boolean).join(" / ") || "-"],
    ["Menu", menuText],
    ["Transport", [final.pickupTime || app.goTime, final.pickupLocation || app.pickupLocation, final.returnTime || app.returnTime].filter(Boolean).join(" | ") || "-"],
    ["Game area", gameStatus],
    ["Gift redemption", giftStatus],
    ["Voting", voteLink ? `<a href="${voteLink}">Open voting</a>` : "Voting not open"],
    ["Lucky draw result", rewardsText(guest) || "-"]
  ];

  $("guestName").textContent = guest.name || "Guest";
  $("guestInfo").textContent = [guest.dept, guest.code, guest.phone].filter(Boolean).join(" | ");
  $("entranceGrid").innerHTML = rows.map(([label, value]) => `<div><strong>${label}</strong>${value}</div>`).join("");
  $("loginPanel").hidden = true;
  $("entrancePanel").hidden = false;
}

async function openGuest(rawBatch) {
  setMessage("Loading guest...", false);
  const [guest, eventBundle, ui] = await Promise.all([
    findGuest(entranceEventId, rawBatch),
    loadEventHeader(entranceEventId),
    dbGet(`/events/${entranceEventId}/ui`).catch(() => ({}))
  ]);
  if (!guest) {
    setMessage("Batch number not found.", true);
    return;
  }
  const app = await loadApplication(entranceEventId, guest);
  renderEntrance(guest, app, eventBundle.info || {}, ui || {});
  setMessage("", false);
}

function bind() {
  $("loginForm").addEventListener("submit", ev => {
    ev.preventDefault();
    openGuest($("batchInput").value).catch(error => {
      console.error("[entrance] lookup failed", error);
      setMessage("Could not load entrance page.", true);
    });
  });
  $("switchButton").addEventListener("click", () => {
    $("entrancePanel").hidden = true;
    $("loginPanel").hidden = false;
    $("batchInput").value = "";
    $("batchInput").focus();
  });
}

async function boot() {
  entranceEventId = queryParam("event") || queryParam("eid") || "";
  bind();
  if (!entranceEventId) {
    setMessage("Missing event ID. Please use the event-specific link.", true);
    $("batchInput").disabled = true;
    return;
  }
  await loadEventHeader(entranceEventId).catch(error => console.warn("[entrance] header failed", error));
  const batch = queryParam("batch");
  if (batch) {
    $("batchInput").value = batch;
    await openGuest(batch).catch(error => console.warn("[entrance] auto lookup failed", error));
  }
}

document.addEventListener("DOMContentLoaded", boot);
