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

// very simple CSV split with quotes support
function splitCSVLine(line) {
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
    if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function mapPrizeHeader(headers) {
  const h = headers.map(x => x.trim().toLowerCase());
  const find = (names) => {
    for (const n of names) {
      const idx = h.indexOf(n.toLowerCase());
      if (idx !== -1) return idx;
    }
    return -1;
  };
  return {
    no:    find(['no','序號','號碼','編號','number']),
    id:    find(['id', '編號']),
    name:  find(['name', '獎品', '獎項', '名稱', 'prize']),
    quota: find(['quota', '名額', '數量'])
  };
}

export async function importPrizesCSV(text) {
  const eid = getCurrentEventId();
  if (!eid) throw new Error('尚未選擇活動');

  const lines = String(text).split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return [];

  const header = splitCSVLine(lines[0]);
  const idx = mapPrizeHeader(header);

  const list = lines.slice(1).map(line => {
    const cols = splitCSVLine(line);
    const pick = (i) => (i >= 0 && i < cols.length) ? cols[i] : '';
    const name = String(pick(idx.name) || '').trim();
    if (!name) return null;
    const no    = String(pick(idx.no) || '').trim();
    const quotaRaw = pick(idx.quota);
    const quota = Math.max(0, Number(quotaRaw || 1)) || 1;
    const id = String(pick(idx.id) || '').trim() || ('p' + Math.random().toString(36).slice(2, 8));
    return ensurePrizeShape({ id, no, name, quota, winners: [] });
  }).filter(Boolean);

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
    await importPrizesCSV(String(reader.result));
    if (cb) cb();
  };
  reader.readAsText(file);
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
