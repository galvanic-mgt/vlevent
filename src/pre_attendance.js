// Customer pre-attendance reply page. Uses Firebase Realtime Database REST API.

const PRE_ATTENDANCE_FIREBASE_BASE = "https://eva-lucky-draw-default-rtdb.asia-southeast1.firebasedatabase.app/";
const PRE_ATTENDANCE_CONFIG = window.PRE_ATTENDANCE_CONFIG || {};

function dbUrl(path) {
  const p = path.startsWith("/") ? path : "/" + path;
  return PRE_ATTENDANCE_FIREBASE_BASE.replace(/\/$/, "") + p + ".json";
}

async function dbGet(path) {
  const res = await fetch(dbUrl(path));
  if (!res.ok) throw new Error("Firebase GET failed: " + res.status);
  return res.json();
}

async function dbPost(path, body) {
  const res = await fetch(dbUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) throw new Error("Firebase POST failed: " + res.status);
  return res.json();
}

function $(id) {
  return document.getElementById(id);
}

function queryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function textValue(key, fallback) {
  const value = PRE_ATTENDANCE_CONFIG.text && PRE_ATTENDANCE_CONFIG.text[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function setText(id, key, fallback) {
  const el = $(id);
  if (el) el.textContent = textValue(key, fallback);
}

function fillSelect(id, items, placeholder) {
  const select = $(id);
  if (!select) return;
  select.innerHTML = "";

  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = placeholder || "Please select";
  select.appendChild(blank);

  (Array.isArray(items) ? items : []).forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value || item.label || "";
    option.textContent = item.label || item.value || "";
    select.appendChild(option);
  });
}

function selectedOptionLabel(selectId) {
  const select = $(selectId);
  if (!select || select.selectedIndex < 0) return "";
  return select.options[select.selectedIndex].textContent || "";
}

function selectedAttendanceOption() {
  const checked = document.querySelector('input[name="attendance"]:checked');
  const options = PRE_ATTENDANCE_CONFIG.attendanceOptions || [];
  return options.find((option) => option.value === (checked && checked.value)) || null;
}

function setTripRequired(required) {
  ["transportation", "goTime", "pickupLocation", "returnTime", "returnLocation"].forEach((id) => {
    const el = $(id);
    if (el) el.required = required;
  });
}

function updateTripVisibility() {
  const option = selectedAttendanceOption();
  const showTrip = !option || option.showTrip !== false;
  const trip = $("tripSection");
  if (trip) trip.hidden = !showTrip;
  setTripRequired(showTrip);
}

function renderAttendanceOptions() {
  const host = $("attendanceOptions");
  if (!host) return;
  host.innerHTML = "";

  const options = PRE_ATTENDANCE_CONFIG.attendanceOptions || [
    { value: "attending", label: "I will attend", showTrip: true },
    { value: "not_attending", label: "I will not attend", showTrip: false }
  ];

  options.forEach((option, index) => {
    const label = document.createElement("label");
    label.className = "pa-radio";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "attendance";
    input.value = option.value;
    input.required = true;
    input.checked = index === 0;
    input.addEventListener("change", updateTripVisibility);

    const span = document.createElement("span");
    span.textContent = option.label;

    label.append(input, span);
    host.appendChild(label);
  });

  updateTripVisibility();
}

function applyConfigText() {
  setText("pageTitle", "pageTitle", "Attendance Reply");
  setText("pageIntro", "pageIntro", "");
  setText("labelName", "nameLabel", "Full name");
  setText("labelCompany", "companyLabel", "Company / Department");
  setText("labelPhone", "phoneLabel", "Phone");
  setText("labelEmail", "emailLabel", "Email");
  setText("attendanceLegend", "attendanceLegend", "Will you attend?");
  setText("labelTransportation", "transportationLabel", "Transportation");
  setText("labelGoTime", "goTimeLabel", "Go time");
  setText("labelPickup", "pickupLabel", "Pickup location");
  setText("labelReturnTime", "returnTimeLabel", "Return time");
  setText("labelReturnLocation", "returnLocationLabel", "Return location");
  setText("labelNotes", "notesLabel", "Notes");
  setText("submitButton", "submitButton", "Submit reply");
  document.title = textValue("pageTitle", "Attendance Reply");
}

function renderOptions() {
  fillSelect("transportation", PRE_ATTENDANCE_CONFIG.transportationOptions, "Please select transportation");
  fillSelect("goTime", PRE_ATTENDANCE_CONFIG.goTimeOptions, "Please select go time");
  fillSelect("pickupLocation", PRE_ATTENDANCE_CONFIG.pickupLocationOptions, "Please select pickup location");
  fillSelect("returnTime", PRE_ATTENDANCE_CONFIG.returnTimeOptions, "Please select return time");
  fillSelect("returnLocation", PRE_ATTENDANCE_CONFIG.returnLocationOptions, "Please select return location");
}

async function loadEvent(eid) {
  const [meta, info, logo, background, banner] = await Promise.all([
    dbGet(`/events/${eid}/meta`),
    dbGet(`/events/${eid}/info`),
    dbGet(`/events/${eid}/logo`),
    dbGet(`/events/${eid}/background`),
    dbGet(`/events/${eid}/banner`)
  ]);

  if ($("eventClient")) $("eventClient").textContent = (meta && meta.client) || (info && info.client) || "";
  if ($("eventTitle")) $("eventTitle").textContent = (info && info.title) || (meta && meta.name) || "";
  if ($("eventDateTime")) $("eventDateTime").textContent = (info && info.dateTime) || "";
  if ($("eventVenue")) $("eventVenue").textContent = (info && info.venue) || "";

  const logoEl = $("eventLogo");
  if (logoEl && logo) {
    logoEl.src = logo;
    logoEl.style.display = "block";
  }

  const bg = background || banner || "";
  if (bg) {
    document.body.style.backgroundImage =
      `linear-gradient(135deg, rgba(245,247,251,.92), rgba(245,247,251,.78)), url('${bg}')`;
    document.body.style.backgroundSize = "cover";
    document.body.style.backgroundPosition = "center";
    document.body.style.backgroundAttachment = "fixed";
  }
}

function setMessage(text, isError) {
  const el = $("formMessage");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-error", Boolean(isError));
}

function buildPayload(eid) {
  const attendance = selectedAttendanceOption();
  const attending = !attendance || attendance.showTrip !== false;

  return {
    eventId: eid,
    createdAt: new Date().toISOString(),
    source: "pre_attendance.html",
    name: $("guestName").value.trim(),
    company: $("guestCompany").value.trim(),
    phone: $("guestPhone").value.trim(),
    email: $("guestEmail").value.trim(),
    attendance: attendance ? attendance.value : "",
    attendanceLabel: attendance ? attendance.label : "",
    attending,
    transportation: attending ? $("transportation").value : "",
    transportationLabel: attending ? selectedOptionLabel("transportation") : "",
    goTime: attending ? $("goTime").value : "",
    goTimeLabel: attending ? selectedOptionLabel("goTime") : "",
    pickupLocation: attending ? $("pickupLocation").value : "",
    pickupLocationLabel: attending ? selectedOptionLabel("pickupLocation") : "",
    returnTime: attending ? $("returnTime").value : "",
    returnTimeLabel: attending ? selectedOptionLabel("returnTime") : "",
    returnLocation: attending ? $("returnLocation").value : "",
    returnLocationLabel: attending ? selectedOptionLabel("returnLocation") : "",
    notes: $("notes").value.trim()
  };
}

function bindSubmit(eid) {
  const form = $("preAttendanceForm");
  const button = $("submitButton");
  if (!form || !button) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.reportValidity()) return;

    button.disabled = true;
    setMessage(textValue("loadingMessage", "Submitting your reply..."), false);

    try {
      await dbPost(`/events/${eid}/preAttendance`, buildPayload(eid));
      form.reset();
      renderAttendanceOptions();
      setMessage(textValue("successMessage", "Thank you. Your reply has been submitted."), false);
    } catch (error) {
      console.error("Pre-attendance submit failed", error);
      setMessage(textValue("submitErrorMessage", "Sorry, the reply could not be submitted. Please try again."), true);
    } finally {
      button.disabled = false;
    }
  });
}

async function boot() {
  applyConfigText();
  renderAttendanceOptions();
  renderOptions();

  const eid = queryParam("event") || queryParam("eid");
  if (!eid) {
    setMessage(textValue("missingEventMessage", "This link is missing an event ID."), true);
    const button = $("submitButton");
    if (button) button.disabled = true;
    return;
  }

  try {
    await loadEvent(eid);
  } catch (error) {
    console.warn("Could not load event details", error);
  }

  bindSubmit(eid);
}

document.addEventListener("DOMContentLoaded", boot);
