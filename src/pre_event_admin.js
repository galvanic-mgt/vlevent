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
  chooseApplications: "請先選擇登記資料 CSV。\nChoose an applications CSV first.",
  couldNotLoad: "未能載入登記資料。\nCould not load applications.",
  couldNotImport: "未能匯入安排資料 CSV。\nCould not import arrangement CSV.",
  couldNotImportApplications: "未能匯入登記資料 CSV。\nCould not import applications CSV.",
  couldNotSaveSettings: "未能儲存設定。\nCould not save settings.",
  noApplications: "未載入任何登記資料。\nNo applications loaded.",
  importingApplications: (done, total) => `正在匯入登記 ${done}/${total}...\nImporting applications ${done}/${total}...`,
  applicationsImported: (created, existing, skipped) => `已新增 ${created} 份登記；保留 ${existing} 份現有登記。\n${created} applications added; ${existing} existing applications preserved.${skipped ? `\n已略過 ${skipped} 行缺少識別資料。\n${skipped} rows without usable identifiers skipped.` : ""}`,
  imported: (count, skipped = 0) => `已匯入 ${count} 行資料。\n${count} rows imported.${skipped ? `\n已略過 ${skipped} 行空白或無法配對的資料。\n${skipped} empty or unmatched rows skipped.` : ""}`
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

function csvSourceInfo(text) {
  let source = String(text || "").replace(/^\ufeff/, "");
  let delimiter = "";
  const separatorDirective = source.match(/^sep=(.)\r?\n/i);
  if (separatorDirective) {
    delimiter = separatorDirective[1];
    source = source.slice(separatorDirective[0].length);
  }

  if (!delimiter) {
    const candidates = [",", "\t", ";"];
    const counts = new Map(candidates.map(candidate => [candidate, 0]));
    let inQ = false;
    for (let i = 0; i < source.length; i += 1) {
      const c = source[i];
      const n = source[i + 1];
      if (c === '"') {
        if (inQ && n === '"') i += 1;
        else inQ = !inQ;
        continue;
      }
      if (!inQ && (c === "\r" || c === "\n")) break;
      if (!inQ && counts.has(c)) counts.set(c, counts.get(c) + 1);
    }
    delimiter = candidates.reduce((best, candidate) => (
      counts.get(candidate) > counts.get(best) ? candidate : best
    ), ",");
  }

  return { source, delimiter };
}

function parseCSVRows(text) {
  const { source, delimiter } = csvSourceInfo(text);
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;

  const pushRow = () => {
    row.push(cur);
    const cleaned = row.map(value => value.trim());
    if (cleaned.some(value => value !== "")) rows.push(cleaned);
    row = [];
    cur = "";
  };

  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const n = source[i + 1];
    if (c === '"') {
      if (inQ && n === '"') {
        cur += '"';
        i += 1;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (c === delimiter && !inQ) {
      row.push(cur);
      cur = "";
      continue;
    }
    if ((c === "\r" || c === "\n") && !inQ) {
      pushRow();
      if (c === "\r" && n === "\n") i += 1;
      continue;
    }
    cur += c;
  }
  if (cur || row.length) pushRow();
  return rows;
}

function decodeCsvBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    throw new Error("這是 Excel 活頁簿，不是 CSV。請另存為 CSV UTF-8 後再匯入。 This is an Excel workbook, not a CSV file. Save it as CSV UTF-8 first.");
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    try {
      return new TextDecoder("big5", { fatal: true }).decode(bytes);
    } catch (_) {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

async function readCsvFile(file) {
  return decodeCsvBuffer(await file.arrayBuffer());
}

function normaliseRows(apps) {
  return Object.entries(apps || {})
    .map(([id, app]) => ({ id, ...(app || {}), __source: "primary" }))
    .filter(row => row.code || row.name || row.phone || row.applicationKey)
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
      latest.set(key, { id, ...(row || {}), __source: "fallback" });
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
  const normal = value => String(value || "")
    .replace(/^\ufeff/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  const parts = headers.map(header => String(header || "")
    .split(/\r?\n/)
    .map(normal)
    .filter(Boolean));
  const find = names => {
    for (const name of names) {
      const target = normal(name);
      const idx = parts.findIndex(values => values.includes(target));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  return {
    code: find(["BatchNumber", "Code", "Batch", "正片號", "正片號碼", "批次號", "批次編號"]),
    phone: find(["MobilePhone", "PhoneNumber", "Phone", "電話號碼", "電話"]),
    table: find(["Table", "TableNo", "台號"]),
    seat: find(["Seat", "SeatNo", "座位"]),
    pickupTime: find(["PickupTime", "GoTime", "上車時間"]),
    pickupLocation: find(["FinalPickupLocation", "PickupLocation", "上車地點"]),
    returnTime: find(["FinalReturnTime", "ReturnTime", "回程時間"]),
    mealLabel: find(["FinalMeal", "Meal", "餐飲"]),
    remarks: find(["FinalRemarks", "Remarks", "備註"])
  };
}

function applicationHeaderMap(headers) {
  const normal = value => String(value || "")
    .replace(/^\ufeff/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  const parts = headers.map(header => String(header || "")
    .split(/\r?\n/)
    .map(normal)
    .filter(Boolean));
  const find = names => {
    for (const name of names) {
      const target = normal(name);
      const idx = parts.findIndex(values => values.includes(target));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  return {
    code: find(["BatchNumber", "Code", "Batch", "正片號", "正片號碼", "批次號", "批次編號"]),
    name: find(["Name", "姓名"]),
    dept: find(["Department", "Dept", "部門"]),
    phone: find(["MobilePhone", "PhoneNumber", "Phone", "電話號碼", "電話"]),
    attending: find(["Attending", "Attendance", "出席"]),
    transportLabel: find(["Transport", "交通方式"]),
    goTimeLabel: find(["GoTime", "DepartureTime", "去程時間"]),
    pickupLocationLabel: find(["PickupLocation", "PickupPoint", "上車地點"]),
    returnTimeLabel: find(["ReturnTime", "OutboundDepartureTime", "回程時間", "回程開車時間"]),
    returnLocationLabel: find(["ReturnLocation", "ReturnPoint", "回程地點"]),
    accommodationLabel: find(["Accommodation", "住宿"]),
    mealLabel: find(["Meal", "餐飲"]),
    remarks: find(["Remarks", "備註"]),
    updatedAt: find(["UpdatedAt", "更新時間"])
  };
}

function parseAttending(value) {
  const normal = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!normal) return true;
  if (normal.includes("不出席") || normal.includes("notattending") || ["no", "false", "0"].includes(normal)) return false;
  return true;
}

function optionValue(options, label) {
  const raw = String(label || "").trim();
  if (!raw) return "";
  const normal = value => String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  const target = normal(raw);
  const match = (options || []).find(option => normal(option?.value) === target || normal(option?.label) === target);
  return match?.value || raw;
}

function identityTokens(row = {}) {
  const tokens = [];
  const key = safeKey(row.applicationKey || "").toLowerCase();
  const code = String(row.code || "").trim().toLowerCase();
  const phone = String(row.phone || "").replace(/\D+/g, "");
  if (key) tokens.push(`key:${key}`);
  if (code) tokens.push(`code:${code}`);
  if (phone) tokens.push(`phone:${phone}`);
  return tokens;
}

function findPersonIndex(code, phone) {
  const normalCode = String(code || "").trim().toLowerCase();
  const phoneDigits = String(phone || "").replace(/\D+/g, "");
  return currentPeople.findIndex(person => (
    (normalCode && String(person?.code || "").trim().toLowerCase() === normalCode)
    || (phoneDigits && String(person?.phone || "").replace(/\D+/g, "") === phoneDigits)
  ));
}

async function importApplicationsText(text) {
  const eventId = $("eventIdInput").value.trim();
  if (!eventId) throw new Error("缺少活動 ID。 Missing event ID.");
  const rows = parseCSVRows(text);
  if (rows.length < 2) throw new Error("CSV 沒有資料。 CSV is empty.");

  const headers = rows[0];
  const idx = applicationHeaderMap(headers);
  if (idx.code < 0 && idx.phone < 0) {
    throw new Error("登記資料 CSV 需要正片號／Code 或電話號碼欄位。 Applications CSV needs a Batch Number/Code or Mobile Phone column.");
  }

  await loadApplications();
  const existingTokens = new Set(currentRows.flatMap(identityTokens));
  const seenKeys = new Set();
  const pending = [];
  let existing = 0;
  let skipped = 0;
  const importedAt = new Date().toISOString();
  const arrangementIdx = headerMap(headers);

  for (const cols of rows.slice(1)) {
    const pick = index => (index >= 0 && index < cols.length ? String(cols[index] || "").trim() : "");
    const code = pick(idx.code);
    const phone = pick(idx.phone);
    const name = pick(idx.name);
    const applicationKey = safeKey(code || phone || name);
    if (!applicationKey || (!code && !phone)) {
      skipped += 1;
      continue;
    }

    const rowTokens = identityTokens({ applicationKey, code, phone });
    if (seenKeys.has(applicationKey.toLowerCase()) || rowTokens.some(token => existingTokens.has(token))) {
      existing += 1;
      continue;
    }

    const attending = parseAttending(pick(idx.attending));
    const transportLabel = pick(idx.transportLabel);
    const goTimeLabel = pick(idx.goTimeLabel);
    const pickupLocationLabel = pick(idx.pickupLocationLabel);
    const returnTimeLabel = pick(idx.returnTimeLabel);
    const returnLocationLabel = pick(idx.returnLocationLabel);
    const accommodationLabel = pick(idx.accommodationLabel);
    const mealLabel = pick(idx.mealLabel);
    const personIndex = findPersonIndex(code, phone);
    const finalArrangement = {
      table: pick(arrangementIdx.table),
      seat: pick(arrangementIdx.seat),
      pickupTime: pick(arrangementIdx.pickupTime),
      pickupLocation: pick(arrangementIdx.pickupLocation),
      returnTime: pick(arrangementIdx.returnTime),
      mealLabel: pick(arrangementIdx.mealLabel),
      remarks: pick(arrangementIdx.remarks)
    };
    const hasFinalArrangement = Object.values(finalArrangement).some(value => value);
    if (hasFinalArrangement) finalArrangement.importedAt = importedAt;

    const payload = {
      eventId,
      personIndex,
      code,
      phone,
      name,
      dept: pick(idx.dept),
      attending,
      attendanceLabel: attending ? "出席 Attending" : "不出席 Not attending",
      transport: optionValue(PRE_EVENT_ADMIN_CONFIG.transportOptions, transportLabel),
      transportLabel,
      goTime: optionValue(PRE_EVENT_ADMIN_CONFIG.goTimeOptions, goTimeLabel),
      goTimeLabel,
      pickupLocation: optionValue(PRE_EVENT_ADMIN_CONFIG.pickupLocationOptions, pickupLocationLabel),
      pickupLocationLabel,
      returnTime: optionValue(PRE_EVENT_ADMIN_CONFIG.returnTimeOptions, returnTimeLabel),
      returnTimeLabel,
      returnLocation: optionValue(PRE_EVENT_ADMIN_CONFIG.returnLocationOptions, returnLocationLabel),
      returnLocationLabel,
      accommodation: optionValue(PRE_EVENT_ADMIN_CONFIG.accommodationOptions, accommodationLabel),
      accommodationLabel,
      meal: optionValue(PRE_EVENT_ADMIN_CONFIG.mealOptions, mealLabel),
      mealLabel,
      remarks: pick(idx.remarks),
      source: "pre_event_admin_csv",
      applicationKey,
      submittedAt: importedAt,
      updatedAt: importedAt,
      csvUpdatedAt: pick(idx.updatedAt),
      importedAt
    };
    if (hasFinalArrangement) payload.finalArrangement = finalArrangement;

    pending.push([`/events/${eventId}/preEventApplications/${applicationKey}`, payload]);
    seenKeys.add(applicationKey.toLowerCase());
    rowTokens.forEach(token => existingTokens.add(token));
  }

  if (!pending.length) {
    await loadApplications();
    setStatus(TEXT.applicationsImported(0, existing, skipped), false);
    return { created: 0, existing, skipped };
  }

  const confirmed = confirm(`新增 ${pending.length} 份登記到活動 ${eventId}？現有登記不會被覆蓋。\nImport ${pending.length} applications into ${eventId}? Existing applications will not be overwritten.`);
  if (!confirmed) return { created: 0, existing, skipped, cancelled: true };

  const chunkSize = 150;
  for (let start = 0; start < pending.length; start += chunkSize) {
    const chunk = pending.slice(start, start + chunkSize);
    await dbPatch("/", Object.fromEntries(chunk));
    setStatus(TEXT.importingApplications(Math.min(start + chunk.length, pending.length), pending.length), false);
  }

  await loadApplications();
  setStatus(TEXT.applicationsImported(pending.length, existing, skipped), false);
  return { created: pending.length, existing, skipped };
}

async function importBackfillText(text) {
  const eventId = $("eventIdInput").value.trim();
  if (!eventId) throw new Error("缺少活動 ID。 Missing event ID.");
  const rows = parseCSVRows(text);
  if (rows.length < 2) throw new Error("CSV 沒有資料。 CSV is empty.");

  if (!currentPeople.length) {
    currentPeople = await dbGet(`/events/${eventId}/people`).catch(() => []);
    if (!Array.isArray(currentPeople)) currentPeople = [];
  }

  const headers = rows[0];
  const idx = headerMap(headers);
  if (idx.code < 0 && idx.phone < 0) {
    throw new Error("安排資料 CSV 需要正片號／Code 或電話號碼欄位。 Arrangement CSV needs a BatchNumber/Code or Mobile Phone column.");
  }

  // Always match against the event currently shown in the input. This avoids
  // applying row indexes retained from a previously loaded event.
  await loadApplications();

  const patch = {};
  let count = 0;
  let skipped = 0;
  for (const cols of rows.slice(1)) {
    const pick = i => (i >= 0 && i < cols.length ? cols[i] : "");
    const code = pick(idx.code);
    const phone = pick(idx.phone);
    if (!code && !phone) {
      skipped += 1;
      continue;
    }
    const finalArrangement = {
      table: pick(idx.table),
      seat: pick(idx.seat),
      pickupTime: pick(idx.pickupTime),
      pickupLocation: pick(idx.pickupLocation),
      returnTime: pick(idx.returnTime),
      mealLabel: pick(idx.mealLabel),
      remarks: pick(idx.remarks)
    };
    if (!Object.values(finalArrangement).some(value => String(value || "").trim())) {
      skipped += 1;
      continue;
    }
    finalArrangement.importedAt = new Date().toISOString();

    const normalCode = String(code).trim().toLowerCase();
    const safeCode = safeKey(code).toLowerCase();
    const phoneDigits = String(phone || "").replace(/\D+/g, "");
    const application = currentRows.find(row => (
      (normalCode && String(row?.code || "").trim().toLowerCase() === normalCode)
      || (safeCode && String(row?.applicationKey || "").trim().toLowerCase() === safeCode)
      || (phoneDigits && String(row?.phone || "").replace(/\D+/g, "") === phoneDigits)
    ));

    const personIndex = currentPeople.findIndex(p => (
      (normalCode && String(p?.code || "").trim().toLowerCase() === normalCode)
      || (phoneDigits && String(p?.phone || "").replace(/\D+/g, "") === phoneDigits)
    ));
    if (!application && personIndex < 0) {
      skipped += 1;
      continue;
    }
    if (application?.__source === "fallback") {
      patch[`/events/${eventId}/preAttendance/${application.id}/finalArrangement`] = finalArrangement;
    } else if (application?.id) {
      patch[`/events/${eventId}/preEventApplications/${application.id}/finalArrangement`] = finalArrangement;
    }
    if (personIndex >= 0) {
      if (finalArrangement.table) patch[`/events/${eventId}/people/${personIndex}/table`] = finalArrangement.table;
      if (finalArrangement.seat) patch[`/events/${eventId}/people/${personIndex}/seat`] = finalArrangement.seat;
      patch[`/events/${eventId}/people/${personIndex}/preEvent/finalArrangement`] = finalArrangement;
    }
    count += 1;
  }

  if (!Object.keys(patch).length) {
    throw new Error(`沒有可匯入或可配對的資料（已略過 ${skipped} 行）。請檢查活動 ID、正片號／Code 或電話號碼。 No importable rows matched (${skipped} skipped). Check the event ID and participant identifiers.`);
  }
  await dbPatch("/", patch);
  await loadApplications();
  setStatus(TEXT.imported(count, skipped), false);
}

function bind() {
  $("loadButton").addEventListener("click", () => loadApplications().catch(error => {
    console.error(error);
    setStatus(TEXT.couldNotLoad, true);
  }));
  $("exportButton").addEventListener("click", exportCsv);
  $("importApplicationsButton").addEventListener("click", async () => {
    const file = $("backfillFile").files?.[0];
    if (!file) {
      setStatus(TEXT.chooseApplications, true);
      return;
    }
    try {
      setStatus(TEXT.loading, false);
      const text = await readCsvFile(file);
      await importApplicationsText(text);
    } catch (error) {
      console.error(error);
      setStatus(error.message || TEXT.couldNotImportApplications, true);
    }
  });
  $("importButton").addEventListener("click", async () => {
    const file = $("backfillFile").files?.[0];
    if (!file) {
      setStatus(TEXT.chooseBackfill, true);
      return;
    }
    try {
      setStatus(TEXT.loading, false);
      const text = await readCsvFile(file);
      await importBackfillText(text);
    } catch (error) {
      console.error(error);
      setStatus(error.message || TEXT.couldNotImport, true);
    }
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
