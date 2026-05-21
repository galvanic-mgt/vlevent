// Standalone pre-attendance export tool. It does not depend on the CMS.

const EXPORT_FIREBASE_BASE = "https://eva-lucky-draw-default-rtdb.asia-southeast1.firebasedatabase.app/";

let currentReplies = [];

function $(id) {
  return document.getElementById(id);
}

function dbUrl(path) {
  const p = path.startsWith("/") ? path : "/" + path;
  return EXPORT_FIREBASE_BASE.replace(/\/$/, "") + p + ".json";
}

async function dbGet(path) {
  const res = await fetch(dbUrl(path));
  if (!res.ok) throw new Error("Firebase GET failed: " + res.status);
  return res.json();
}

function queryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function columns() {
  return [
    ["Submitted", "createdAt"],
    ["Name", "name"],
    ["Company / Dept", "company"],
    ["Phone", "phone"],
    ["Email", "email"],
    ["Attend", "attendanceLabel"],
    ["Transportation", "transportationLabel"],
    ["Go time", "goTimeLabel"],
    ["Pickup", "pickupLocationLabel"],
    ["Return time", "returnTimeLabel"],
    ["Return location", "returnLocationLabel"],
    ["Notes", "notes"]
  ];
}

function normaliseReplies(raw) {
  return Object.entries(raw || {})
    .map(([id, row]) => ({ id, ...(row || {}) }))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function escHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

function setStatus(text, isError) {
  const el = $("statusMessage");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-error", Boolean(isError));
}

function updateCustomerLink(eventId) {
  const link = $("customerPageLink");
  if (!link) return;
  const url = new URL("./pre_attendance.html", window.location.href);
  if (eventId) url.searchParams.set("event", eventId);
  link.href = url.toString();
}

function renderReplies(replies) {
  const rows = $("replyRows");
  const count = $("replyCount");
  if (count) count.textContent = `${replies.length} replies`;
  if (!rows) return;

  if (!replies.length) {
    rows.innerHTML = '<tr><td colspan="12">No replies found for this event.</td></tr>';
    return;
  }

  const keys = columns().map(([, key]) => key);
  rows.innerHTML = replies.map((reply) => `
    <tr>
      ${keys.map((key) => `<td>${escHtml(reply[key])}</td>`).join("")}
    </tr>
  `).join("");
}

async function loadReplies() {
  const eventId = $("eventIdInput").value.trim();
  updateCustomerLink(eventId);

  if (!eventId) {
    setStatus("Enter an event ID first.", true);
    return;
  }

  setStatus("Loading replies...", false);

  try {
    const raw = await dbGet(`/events/${eventId}/preAttendance`);
    currentReplies = normaliseReplies(raw);
    renderReplies(currentReplies);
    setStatus(currentReplies.length ? "Replies loaded." : "No replies yet.", false);
  } catch (error) {
    console.error("Could not load pre-attendance replies", error);
    currentReplies = [];
    renderReplies(currentReplies);
    setStatus("Could not load replies. Check the event ID and connection.", true);
  }
}

function buildCsv(replies) {
  const cols = columns();
  const rows = [
    cols.map(([label]) => label),
    ...replies.map((reply) => cols.map(([, key]) => reply[key] || ""))
  ];

  return "\ufeff" + rows
    .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\r\n");
}

function exportReplies() {
  const eventId = $("eventIdInput").value.trim() || "event";

  if (!currentReplies.length) {
    setStatus("There are no loaded replies to export.", true);
    return;
  }

  const csv = buildCsv(currentReplies);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  a.download = `pre_attendance_${eventId}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus("Export downloaded.", false);
}

function boot() {
  const eventId = queryParam("event") || queryParam("eid") || "";
  $("eventIdInput").value = eventId;
  updateCustomerLink(eventId);

  $("loadReplies").addEventListener("click", loadReplies);
  $("exportReplies").addEventListener("click", exportReplies);
  $("eventIdInput").addEventListener("input", () => updateCustomerLink($("eventIdInput").value.trim()));

  if (eventId) loadReplies();
}

document.addEventListener("DOMContentLoaded", boot);
