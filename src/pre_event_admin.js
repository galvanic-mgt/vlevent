const PRE_EVENT_ADMIN_CONFIG = window.PRE_EVENT_APPLY_CONFIG || {};
const ADMIN_FIREBASE_BASE = PRE_EVENT_ADMIN_CONFIG.firebaseBase || "https://eva-lucky-draw-default-rtdb.asia-southeast1.firebasedatabase.app/";

let currentRows = [];
let currentPeople = [];

const TEXT = {
  enterEventId: "請先輸入活動 ID。\nEnter an event ID first.",
  loading: "正在載入...\nLoading...",
  loaded: count => `已載入 ${count} 份登記。\n${count} applications loaded.`,
  settingsSaved: "設定已儲存。\nSettings saved.",
  loadBeforeExport: "請先載入登記資料再匯出。\nLoad applications before exporting.",
  csvExported: "CSV 已匯出。\nCSV exported.",
  chooseBackfill: "請先選擇安排資料 CSV。\nChoose an arrangement CSV first.",
  couldNotLoad: "未能載入登記資料。\nCould not load applications.",
  couldNotImport: "未能匯入安排資料 CSV。\nCould not import arrangement CSV.",
  couldNotSaveSettings: "未能儲存設定。\nCould not save settings.",
  noApplications: "未載入任何登記資料。\nNo applications loaded.",
  imported: count => `已匯入 ${count} 行資料。\n${count} rows imported.`
};

function $(id) {
  return document.getElementById(id);
}

function dbUrl(path) {
  const p = path.startsWith("/") ? path : "/" + path;
  return ADMIN_FIREBASE_BASE.replace(/\/$/, "") + p + ".json";
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
  return res.json();
}

function queryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function safeKey(value) {
  return String(value || "").trim().replace(/[.#$/\[\]]/g, "_");
}

function setStatus(text, isError) {
  const el = $("statusMessage");
  el.textContent = text || "";
  el.style.whiteSpace = "pre-line";
  el.classList.toggle("is-error", Boolean(isError));
}

function removeRevealDaysControl() {
  $("revealDaysBeforeEvent")?.closest(".pe-field")?.remove();
}

function toLocalDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    const n = line[i + 1];
    if (c === '"') {
      if (inQ && n === '"') {
        cur += '"';
        i += 1;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map(v => v.trim());
}

function normaliseRows(apps) {
  return Object.entries(apps || {}).map(([id, app]) => ({ id, ...(app || {}) }))
    .sort((a, b) => String(a.code || a.name || "").localeCompare(String(b.code || b.name || "")));
}

function normaliseFallbackApplications(raw) {
  const latest = new Map();
  Object.entries(raw || {}).forEach(([id, row]) => {
    if (!row || row.source !== "pre_event_apply.html") return;
    const key = row.applicationKey || row.code || row.phone || id;
    const existing = latest.get(key);
    const rowTime = String(row.updatedAt || row.createdAt || "");
    const existingTime = String(existing?.updatedAt || existing?.createdAt || "");
    if (!existing || rowTime >= existingTime) {
      latest.set(key, { id, ...(row || {}) });
    }
  });
  return Array.from(latest.values());
}

function columns() {
  return [
    ["正片號\nBatch number", "code"],
    ["姓名\nName", "name"],
    ["部門\nDepartment", "dept"],
    ["電話\nPhone", "phone"],
    ["出席\nAttending", "attending"],
    ["交通方式\nTransport", "transportLabel"],
    ["去程時間\nGo time", "goTimeLabel"],
    ["上車地點\nPickup location", "pickupLocationLabel"],
    ["回程時間\nReturn time", "returnTimeLabel"],
    ["回程地點\nReturn location", "returnLocationLabel"],
    ["住宿\nAccommodation", "accommodationLabel"],
    ["餐飲\nMeal", "mealLabel"],
    ["備註\nRemarks", "remarks"],
    ["台號\nTable", "finalArrangement.table"],
    ["座位\nSeat", "finalArrangement.seat"],
    ["最終上車時間\nPickup time", "finalArrangement.pickupTime"],
    ["最終上車地點\nFinal pickup location", "finalArrangement.pickupLocation"],
    ["最終回程時間\nFinal return time", "finalArrangement.returnTime"],
    ["最終餐飲\nFinal meal", "finalArrangement.mealLabel"],
    ["最終備註\nFinal remarks", "finalArrangement.remarks"],
    ["更新時間\nUpdated at", "updatedAt"]
  ];
}

function getPathValue(row, path) {
  return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : ""), row);
}

function displayValue(row, key) {
  if (key === "attending") {
    return row.attending === false || row.attending === "no"
      ? "不出席 Not attending"
      : row.attending === true || row.attending === "yes"
        ? "出席 Attend"
        : "";
  }
  if (key === "pickupLocationLabel") {
    return row.pickupLocationLabel || row.pickupLocation || "";
  }
  if (key === "returnLocationLabel") {
    return row.returnLocationLabel || row.returnLocation || "";
  }
  if (key === "updatedAt") {
    const value = getPathValue(row, key);
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-HK", {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(date);
  }
  const value = getPathValue(row, key);
  if (value === false) return "No";
  if (value === true) return "Yes";
  return value ?? "";
}

function renderRows(rows) {
  const table = $("applicationTable");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  const cols = columns();
  thead.innerHTML = `<tr>${cols.map(([label]) => `<th style="text-align:left;border-bottom:1px solid #ddd;padding:8px;white-space:pre-line">${label}</th>`).join("")}</tr>`;
  tbody.innerHTML = rows.length
    ? rows.map(row => `<tr>${cols.map(([, key]) => `<td style="border-bottom:1px solid #eee;padding:8px">${displayValue(row, key)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${cols.length}" style="padding:12px;white-space:pre-line">${TEXT.noApplications}</td></tr>`;
}

async function loadApplications() {
  const eventId = $("eventIdInput").value.trim();
  if (!eventId) {
    setStatus(TEXT.enterEventId, true);
    return;
  }
  setStatus(TEXT.loading, false);
  const [apps, fallbackApps, people, settings] = await Promise.all([
    dbGet(`/events/${eventId}/preEventApplications`).catch(() => ({})),
    dbGet(`/events/${eventId}/preAttendance`).catch(() => ({})),
    dbGet(`/events/${eventId}/people`).catch(() => []),
    dbGet(`/events/${eventId}/preEventSettings`).catch(() => ({}))
  ]);
  const primaryRows = normaliseRows(apps);
  const fallbackRows = normaliseFallbackApplications(fallbackApps);
  const merged = new Map();
  fallbackRows.forEach(row => merged.set(row.applicationKey || row.code || row.phone || row.id, row));
  primaryRows.forEach(row => merged.set(row.applicationKey || row.code || row.phone || row.id, row));
  currentRows = Array.from(merged.values())
    .sort((a, b) => String(a.code || a.name || "").localeCompare(String(b.code || b.name || "")));
  currentPeople = Array.isArray(people) ? people : [];
  $("registrationDeadline").value = toLocalDateInput(settings?.registrationDeadline);
  $("revealFrom").value = toLocalDateInput(settings?.revealFrom);
  renderRows(currentRows);
  setStatus(TEXT.loaded(currentRows.length), false);
}

async function saveSettings() {
  const eventId = $("eventIdInput").value.trim();
  if (!eventId) {
    setStatus(TEXT.enterEventId, true);
    return;
  }
  await dbPatch(`/events/${eventId}/preEventSettings`, {
    registrationDeadline: fromLocalDateInput($("registrationDeadline").value),
    revealFrom: fromLocalDateInput($("revealFrom").value)
  });
  setStatus(TEXT.settingsSaved, false);
}

function exportCsv() {
  if (!currentRows.length) {
    setStatus(TEXT.loadBeforeExport, true);
    return;
  }
  const cols = columns();
  const csv = "\ufeff" + [
    cols.map(([label]) => csvEscape(label)).join(","),
    ...currentRows.map(row => cols.map(([, key]) => csvEscape(displayValue(row, key))).join(","))
  ].join("\r\n");
  const eventId = $("eventIdInput").value.trim() || "event";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  a.download = `pre_event_applications_${eventId}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(TEXT.csvExported, false);
}

function headerMap(headers) {
  const lower = headers.map(h => h.trim().toLowerCase());
  const find = names => {
    for (const name of names) {
      const idx = lower.indexOf(name.toLowerCase());
      if (idx !== -1) return idx;
    }
    return -1;
  };
  return {
    code: find(["BatchNumber", "Code", "Batch", "正片號"]),
    table: find(["Table", "TableNo", "台號"]),
    seat: find(["Seat", "SeatNo", "座位"]),
    pickupTime: find(["PickupTime", "GoTime", "上車時間"]),
    pickupLocation: find(["FinalPickupLocation", "PickupLocation", "上車地點"]),
    returnTime: find(["FinalReturnTime", "ReturnTime", "回程時間"]),
    mealLabel: find(["FinalMeal", "Meal", "餐飲"]),
    remarks: find(["FinalRemarks", "Remarks", "備註"])
  };
}

async function importBackfillText(text) {
  const eventId = $("eventIdInput").value.trim();
  if (!eventId) throw new Error("缺少活動 ID。 Missing event ID.");
  const lines = String(text).split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error("CSV 沒有資料。 CSV is empty.");

  if (!currentPeople.length) {
    currentPeople = await dbGet(`/events/${eventId}/people`).catch(() => []);
    if (!Array.isArray(currentPeople)) currentPeople = [];
  }

  const headers = splitCSVLine(lines[0]);
  const idx = headerMap(headers);
  if (idx.code < 0) throw new Error("安排資料 CSV 需要正片號或 Code 欄位。 Arrangement CSV needs a BatchNumber or Code column.");

  const patch = {};
  let count = 0;
  for (const line of lines.slice(1)) {
    const cols = splitCSVLine(line);
    const pick = i => (i >= 0 && i < cols.length ? cols[i] : "");
    const code = pick(idx.code);
    if (!code) continue;
    const finalArrangement = {
      table: pick(idx.table),
      seat: pick(idx.seat),
      pickupTime: pick(idx.pickupTime),
      pickupLocation: pick(idx.pickupLocation),
      returnTime: pick(idx.returnTime),
      mealLabel: pick(idx.mealLabel),
      remarks: pick(idx.remarks),
      importedAt: new Date().toISOString()
    };
    const appKey = safeKey(code);
    patch[`/events/${eventId}/preEventApplications/${appKey}/finalArrangement`] = finalArrangement;

    const personIndex = currentPeople.findIndex(p => String(p?.code || "").trim().toLowerCase() === String(code).trim().toLowerCase());
    if (personIndex >= 0) {
      if (finalArrangement.table) patch[`/events/${eventId}/people/${personIndex}/table`] = finalArrangement.table;
      if (finalArrangement.seat) patch[`/events/${eventId}/people/${personIndex}/seat`] = finalArrangement.seat;
      patch[`/events/${eventId}/people/${personIndex}/preEvent/finalArrangement`] = finalArrangement;
    }
    count += 1;
  }

  await dbPatch("/", patch);
  setStatus(TEXT.imported(count), false);
  await loadApplications();
}

function bind() {
  $("loadButton").addEventListener("click", () => loadApplications().catch(error => {
    console.error(error);
    setStatus(TEXT.couldNotLoad, true);
  }));
  $("exportButton").addEventListener("click", exportCsv);
  $("importButton").addEventListener("click", () => {
    const file = $("backfillFile").files?.[0];
    if (!file) {
      setStatus(TEXT.chooseBackfill, true);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => importBackfillText(String(reader.result)).catch(error => {
      console.error(error);
      setStatus(error.message || TEXT.couldNotImport, true);
    });
    reader.readAsText(file);
  });
  $("saveSettingsButton").addEventListener("click", () => saveSettings().catch(error => {
    console.error(error);
    setStatus(TEXT.couldNotSaveSettings, true);
  }));
}

function boot() {
  $("eventIdInput").value = queryParam("event") || queryParam("eid") || "";
  removeRevealDaysControl();
  bind();
  renderRows([]);
  if ($("eventIdInput").value) {
    loadApplications().catch(error => {
      console.error(error);
      setStatus(TEXT.couldNotLoad, true);
    });
  }
}

document.addEventListener("DOMContentLoaded", boot);
