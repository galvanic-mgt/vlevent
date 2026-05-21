// src/stage_prizes_firebase.js — prizes data ops + draw core

import {
  getCurrentEventId,
  getPeople, setPeople,
  getPrizes, setPrizes,
  getCurrentPrizeIdRemote, setCurrentPrizeIdRemote,
} from './core_firebase.js';
import { FB } from './fb.js';

/* ----------------- helpers ----------------- */
export function prizeLeftLocal(prize) {
  const quota = Number(prize?.quota || 0);
  const taken = Array.isArray(prize?.winners) ? prize.winners.length : 0;
  return Math.max(0, quota - taken);
}

function pickUnique(arr, n) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function ensurePrizeShape(p) {
  return {
    id: p.id,
    no: p.no || '',
    name: p.name || '新獎項',
    quota: Math.max(0, Number(p.quota || 0)),
    winners: Array.isArray(p.winners) ? p.winners : [],
  };
}

function winnerKey(p){
  const name  = (p?.name  || '').trim();
  const dept  = (p?.dept  || '').trim();
  const phone = (p?.phone || '').trim();
  return phone ? `phone:${phone}` : `name:${name}||${dept}`;
}

/* ----------------- CRUD for prizes (used by CMS UI) ----------------- */

// CREATE
export async function addPrize(partial = {}) {
  const eid = getCurrentEventId();
  if (!eid) throw new Error('尚未選擇活動');

  const prizes = (await getPrizes(eid)) || [];
  const id = partial.id || ('p' + Math.random().toString(36).slice(2, 8));

  if (prizes.some(p => p?.id === id)) {
    throw new Error('獎項 ID 重複：' + id);
  }

  const prize = ensurePrizeShape({ id, ...partial });
  prizes.push(prize);
  await setPrizes(eid, prizes);
  return prize;
}

// UPDATE (by id)
export async function updatePrize(patch = {}) {
  const eid = getCurrentEventId();
  if (!eid) throw new Error('尚未選擇活動');
  if (!patch.id) throw new Error('缺少獎項 ID');

  const prizes = (await getPrizes(eid)) || [];
  const idx = prizes.findIndex(p => p?.id === patch.id);
  if (idx < 0) throw new Error('找不到獎項：' + patch.id);

  const merged = ensurePrizeShape({ ...prizes[idx], ...patch });
  prizes[idx] = merged;
  await setPrizes(eid, prizes);
  return merged;
}

// DELETE (by id)
export async function removePrize(prizeId) {
  const eid = getCurrentEventId();
  if (!eid) throw new Error('尚未選擇活動');
  if (!prizeId) throw new Error('缺少獎項 ID');

  const [prizes, curId] = await Promise.all([
    getPrizes(eid),
    getCurrentPrizeIdRemote(eid),
  ]);
  const next = (prizes || []).filter(p => p?.id !== prizeId);
  await setPrizes(eid, next);

  // if currently selected prize was deleted, clear current
  if (curId === prizeId) {
    await setCurrentPrizeIdRemote(eid, null);
  }
  return true;
}

// DELETE ALL (prizes + winners + people.prize reset)
export async function clearAllPrizes() {
  const eid = getCurrentEventId();
  if (!eid) throw new Error('尚未選擇活動');

  // clear prizes + current selection
  await setPrizes(eid, []);
  await setCurrentPrizeIdRemote(eid, null);

  // reset prize field on people so roster shows clean slate
  try {
    const people = await getPeople(eid);
    if (Array.isArray(people) && people.length) {
      const cleaned = people.map(p => p ? { ...p, prize: '' } : p);
      await setPeople(eid, cleaned);
    }
  } catch (e) {
    console.warn('[clearAllPrizes] unable to reset people prizes', e);
  }

  return true;
}

// --- SELECT / SET CURRENT PRIZE (needed by ui_cms_firebase.js) ---
export async function setCurrentPrize(prizeId) {
  const eid = getCurrentEventId();
  if (!eid) throw new Error('尚未選擇活動');

  // allow clearing selection by passing null/undefined/empty
  const pid = prizeId || null;

  // sanity: confirm the prize exists if a non-null id is provided
  if (pid) {
    const prizes = (await getPrizes(eid)) || [];
    const exists = prizes.some(p => p && p.id === pid);
    if (!exists) throw new Error(`找不到獎項：${pid}`);
  }

  await setCurrentPrizeIdRemote(eid, pid);
  return pid;
}

/* ----------------- CSV import ----------------- */

function detectDelimiter(text) {
  const firstLine = String(text).split(/\r?\n/).find(l => l.trim()) || '';
  const candidates = [',', '\t', ';'];
  let best = ',';
  let bestCount = -1;
  for (const delimiter of candidates) {
    const count = splitCSVLine(firstLine, delimiter).length;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

// CSV split with quote support. Kept local so prize import works without extra deps.
function splitCSVLine(line, delimiter = ',') {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const n = line[i + 1];
    if (c === '"') {
      if (inQ && n === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (c === delimiter && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map(s => s.replace(/^\ufeff/, '').trim());
}

function parseCSVRows(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let cur = '';
  let row = [];
  let inQ = false;
  const src = String(text || '').replace(/^\ufeff/, '');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '"') {
      if (inQ && n === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (c === delimiter && !inQ) {
      row.push(cur.trim());
      cur = '';
      continue;
    }
    if ((c === '\n' || c === '\r') && !inQ) {
      if (c === '\r' && n === '\n') i++;
      row.push(cur.trim());
      if (row.some(v => String(v).trim())) rows.push(row);
      row = [];
      cur = '';
      continue;
    }
    cur += c;
  }

  row.push(cur.trim());
  if (row.some(v => String(v).trim())) rows.push(row);
  return rows;
}

function normalizePrizeHeader(value) {
  return String(value || '')
    .replace(/^\ufeff/, '')
    .trim()
    .toLowerCase()
    .replace(/[.\-_/()（）[\]{}:：#＃\s]+/g, '');
}

const TRADITIONAL_PRIZE_HEADERS = [
  '編號', '序號', '號碼', '獎品編號', '禮品編號', '贈品編號',
  '名稱', '獎品', '獎品名稱', '禮品', '禮品名稱', '贈品', '贈品名稱',
  '名額', '數量', '份數', '得獎名額', '中獎名額', '獎品數量', '禮品數量', '贈品數量'
];

function normalizePrizeHeaderSafe(value) {
  return String(value || '')
    .replace(/^\ufeff/, '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s.\-_/()[\]{}:：，,]+/g, '');
}

function hasPrizeHeader(headers) {
  const h = headers.map(normalizePrizeHeaderSafe);
  return h.some(x => [
    'no', 'number', 'id',
    'name', 'prize', 'prizename', 'gift', 'giftname',
    'quota', 'qty', 'quantity', 'count', 'amount',
    '獎品', '獎品名稱', '禮品', '禮品名稱', '禮物', '獎項', '數量', '名額', '份數'
  ].includes(x) || TRADITIONAL_PRIZE_HEADERS.includes(x));
}

function scoreCSVText(text) {
  const replacementChars = (String(text).match(/\ufffd/g) || []).length;
  const rows = parseCSVRows(text);
  const headerScore = rows[0] && hasPrizeHeader(rows[0]) ? 25 : 0;
  const widthScore = rows.filter(r => r.length >= 2).length * 3;
  const rowScore = Math.min(rows.length, 20);
  return headerScore + widthScore + rowScore - (replacementChars * 50);
}

function decodeWithEncoding(bytes, encoding) {
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch (error) {
    return '';
  }
}

function decodePrizeCSVBuffer(buffer) {
  const bytes = new Uint8Array(buffer || []);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return decodeWithEncoding(bytes, 'utf-8');
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeWithEncoding(bytes, 'utf-16le');
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeWithEncoding(bytes, 'utf-16be');
  }

  const candidates = ['utf-8', 'big5', 'utf-16le']
    .map(encoding => ({ encoding, text: decodeWithEncoding(bytes, encoding) }))
    .filter(candidate => candidate.text);

  candidates.sort((a, b) => scoreCSVText(b.text) - scoreCSVText(a.text));
  return candidates[0]?.text || '';
}

function mapPrizeHeaderRobust(headers, rows = []) {
  const h = headers.map(normalizePrizeHeaderSafe);
  const find = (names) => {
    const wanted = names.map(normalizePrizeHeaderSafe);
    for (const name of wanted) {
      const exact = h.indexOf(name);
      if (exact !== -1) return exact;
    }
    for (let i = 0; i < h.length; i++) {
      if (wanted.some(name => name && h[i].includes(name))) return i;
    }
    return -1;
  };

  const idx = {
    no: find([
      'no', 'number', 'item no', 'prize no', 'gift no',
      '編號', '序號', '號碼', '獎品編號', '禮品編號', '贈品編號',
      '序號', '編號', '獎品編號', '禮品編號', '禮物編號'
    ]),
    id: find(['id', 'prize id', 'gift id']),
    name: find([
      'name', 'prize', 'prize name', 'gift', 'gift name', 'item', 'item name',
      '名稱', '獎品', '獎品名稱', '禮品', '禮品名稱', '贈品', '贈品名稱',
      '獎品', '獎品名稱', '禮品', '禮品名稱', '禮物', '禮物名稱', '獎項', '獎項名稱'
    ]),
    quota: find([
      'quota', 'qty', 'quantity', 'count', 'amount', 'winner count', 'winners',
      '名額', '數量', '份數', '得獎名額', '中獎名額', '獎品數量', '禮品數量', '贈品數量',
      '數量', '名額', '份數', '獎品數量', '禮品數量', '中獎名額'
    ])
  };

  if (idx.name === -1) {
    idx.name = h.findIndex((_, i) => ![idx.no, idx.id, idx.quota].includes(i));
  }

  if (idx.quota === -1 && rows.length) {
    const firstDataRow = rows.find(r => r.some(v => String(v).trim())) || [];
    idx.quota = firstDataRow.findIndex((v, i) => i !== idx.name && i !== idx.no && i !== idx.id && Number.isFinite(Number(String(v).normalize('NFKC').replace(/,/g, ''))));
  }

  return idx;
}

function parsePrizeQuota(value) {
  const normal = String(value ?? '')
    .normalize('NFKC')
    .replace(/,/g, '')
    .trim();
  const match = normal.match(/\d+/);
  return Math.max(0, Number(match ? match[0] : normal || 1)) || 1;
}

export async function importPrizesCSV(text) {
  const eid = getCurrentEventId();
  if (!eid) throw new Error('尚未選擇活動');

  let rows = parseCSVRows(text);
  if (!rows.length) return [];

  const hasHeader = hasPrizeHeader(rows[0]);
  const noHeaderLooksLikeNoNameQuota = !hasHeader
    && rows[0].length >= 3
    && !Number.isFinite(Number(rows[0][1]))
    && Number.isFinite(Number(rows[0][2]));
  const header = hasHeader
    ? rows[0]
    : rows[0].map((_, i) => (
      noHeaderLooksLikeNoNameQuota
        ? (i === 0 ? 'no' : i === 1 ? 'name' : i === 2 ? 'quota' : `col${i + 1}`)
        : (i === 0 ? 'name' : i === 1 ? 'quota' : `col${i + 1}`)
    ));
  rows = hasHeader ? rows.slice(1) : rows;

  const idx = mapPrizeHeaderRobust(header, rows);

  const list = rows.map(cols => {
    const pick = (i) => (i >= 0 && i < cols.length) ? cols[i] : '';
    const name = String(pick(idx.name) || '').trim();
    if (!name) return null;
    const no    = String(pick(idx.no) || '').trim();
    const quotaRaw = pick(idx.quota);
    const quota = parsePrizeQuota(quotaRaw);
    const id = String(pick(idx.id) || '').trim() || ('p' + Math.random().toString(36).slice(2, 8));
    return ensurePrizeShape({ id, no, name, quota, winners: [] });
  }).filter(Boolean);

  if (!list.length) {
    throw new Error('No gifts found in CSV. Use columns such as Gift/Gift Name/Prize Name and Quantity/Qty, or rows like "Gift Name,Quantity".');
  }

  await setPrizes(eid, list);

  // reset prize labels on people since winners were wiped
  try {
    const people = await getPeople(eid);
    if (Array.isArray(people) && people.length) {
      const cleaned = people.map(p => p ? { ...p, prize: '' } : p);
      await setPeople(eid, cleaned);
    }
  } catch (e) {
    console.warn('[importPrizesCSV] unable to reset people prizes', e);
  }

  const cur = list[0]?.id || null;
  await setCurrentPrizeIdRemote(eid, cur);
  return list;
}

export function handlePrizeImportCSV(file, cb) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const text = decodePrizeCSVBuffer(reader.result);
      await importPrizesCSV(text);
      if (cb) cb();
    } catch (error) {
      console.error('[handlePrizeImportCSV] import failed', error);
      alert(`[Gift CSV Import Error]\n${error?.message || String(error)}`);
    }
  };
  reader.onerror = () => {
    alert('[Gift CSV Import Error]\nCould not read the selected CSV file.');
  };
  reader.readAsArrayBuffer(file);
}

/* ----------------- draw core ----------------- */
export async function drawBatch(n = 1, opts = {}) {
  try {
    const skipCountdownFlag = typeof window !== 'undefined' && window.__skipCountdownFlag === true;
    if (typeof window !== 'undefined') window.__skipCountdownFlag = false;

    const eid = getCurrentEventId?.();
    if (!eid) throw new Error('尚未選擇活動');

    const [people, prizes, curId] = await Promise.all([
      getPeople(eid),
      getPrizes(eid),
      getCurrentPrizeIdRemote(eid),
    ]);

    if (!Array.isArray(people)) throw new Error('人員名單讀取失敗');
    if (!Array.isArray(prizes)) throw new Error('獎項資料讀取失敗');

    const cur = prizes.find(p => p && p.id === curId);
    if (!cur) throw new Error('尚未選擇抽獎項目');

    const need = prizeLeftLocal(cur);
    if (need <= 0) throw new Error('此獎項名額已滿');

    // no-repeat across ALL prizes (match by phone when available)
    const winnersSet = new Set(
      prizes.flatMap(p => (p?.winners || []).map(w => winnerKey(w)))
    );

    const excludeKeys = new Set((opts.excludeKeys || []).filter(Boolean));
    const pool = people.filter(p => {
      if (!p || !p.checkedIn) return false;
      const key = winnerKey(p);
      if (winnersSet.has(key)) return false;
      if (excludeKeys.has(key)) return false;
      return true;
    });
    if (pool.length === 0) throw new Error('沒有可抽名單（請檢查出席狀態或已有得獎紀錄）');

    const want = Math.max(1, Math.min(Number(n) || 1, 10, need, pool.length));
    const picks = pickUnique(pool, want);

    cur.winners = Array.isArray(cur.winners) ? cur.winners : [];
    const prizeName = cur.name || '';
    const now = Date.now();

    const winnerKeys = new Set();
    picks.forEach(w => {
      cur.winners.push({ name: w.name, dept: w.dept || '', phone: w.phone || '', time: now });
      winnerKeys.add(winnerKey(w));
    });

    const peopleUpdated = people.map(p =>
      winnerKeys.has(winnerKey(p)) ? { ...p, prize: prizeName } : p
    );

    // 1) Save winners & people like before
    await setPrizes(eid, prizes);
    await setPeople(eid, peopleUpdated);

    // 2) Single, clean sync to RTDB for public board
    try {
      await FB.patch(`/events/${eid}/ui`, {
        skipCountdown: skipCountdownFlag || undefined,
        stageState: {
          currentPrizeId: curId,
          currentBatch: Number(n) || 1,
          skipCountdown: skipCountdownFlag || undefined,
          winners: picks.map(w => ({
            name: w.name,
            dept: w.dept || '',
            time: now
          }))
        }
      });
    } catch (e) {
      console.warn('[Draw Sync] Unable to write ui.stageState', e);
    }

    return { ok: true, batch: picks, prizes };
  } catch (err) {
    alert(`[Draw Error] drawBatch failed\n${err?.message || String(err)}`);
    throw err;
  }
}
