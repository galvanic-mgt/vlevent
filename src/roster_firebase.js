import { getCurrentEventId, getPeople, setPeople, getEventInfo, getPrizes } from './core_firebase.js';
import { FB } from './fb.js';

export function normalizeName(s){ return (s || '').trim().replace(/\s+/g,' '); }

// very simple CSV split with quotes support for common cases
function splitCSVLine(line){
  const out = []; let cur = ''; let inQ = false;
  for(let i=0;i<line.length;i++){
    const c=line[i], n=line[i+1];
    if(c === '"' ){ if(inQ && n === '"'){ cur += '"'; i++; } else { inQ = !inQ; } continue; }
    if(c === ',' && !inQ){ out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(s=>s.trim());
}

function toBool(v){
  if (typeof v === 'boolean') return v;
  const s = String(v||'').trim().toLowerCase();
  return s === '1' || s === 'y' || s === 'yes' || s === 'true' || s === '是' || s === '到' || s === 'present';
}

function mapHeaderIndex(headers, info){
  // accepted header names for each field (supports custom labels from Event Info)
  const h = headers.map(x => x.trim().toLowerCase());

  const hp = (nameArr)=> {
    for(const name of nameArr){
      const i = h.indexOf(name.toLowerCase());
      if(i !== -1) return i;
    }
    return -1;
  };

  const labelPhone = (info?.labelPhone || 'phone').toLowerCase();
  const labelDept  = (info?.labelDept  || 'department').toLowerCase();

  return {
    code:     hp(['code','票號','代碼']),
    phone:    hp(['phone','mobile','tel','電話', labelPhone]),
    name:     hp(['name','姓名']),
    dept:     hp(['department','dept','描述','說明','部門','description', labelDept]),
    table:    hp(['table','枱','桌','桌號','枱號']),
    seat:     hp(['seat','座位','座號']),
    present:  hp(['present','checkedin','checkin','出席','到場','出席與否','到','在場'])
  };
}

export async function importCSV(text){
  const eid = getCurrentEventId();
  const info = (await getEventInfo(eid)).info || {};

  const lines = String(text).split(/\r?\n/).filter(l => l.trim().length);
  if(lines.length === 0) return [];

  const header = splitCSVLine(lines[0]);
  const idx = mapHeaderIndex(header, info);

  const people = lines.slice(1).map(line => {
    const cols = splitCSVLine(line);
    const pick = (i)=> i>=0 && i<cols.length ? cols[i] : '';
    const name = normalizeName(pick(idx.name));
    if(!name) return null; // skip empty name rows
    return {
      code:      String(pick(idx.code)   || '').trim(),
      phone:     String(pick(idx.phone)  || '').trim(),
      name,
      dept:      String(pick(idx.dept)   || '').trim(),
      table:     String(pick(idx.table)  || '').trim(),
      seat:      String(pick(idx.seat)   || '').trim(),
      checkedIn: toBool(pick(idx.present)),
      prize:     '' // will be set by lucky draw
    };
  }).filter(Boolean);

  await setPeople(eid, people);
  return people;
}

export function handleImportCSV(file, cb){
  const reader = new FileReader();
  reader.onload = async ()=>{ await importCSV(String(reader.result)); if(cb) cb(); };
  reader.readAsText(file);
}

// -------- Export --------
export async function exportCSV(){
  const eid = getCurrentEventId();
  const [info, people, prizes, rewardRounds] = await Promise.all([
    (await getEventInfo(eid)).info || {},
    getPeople(eid),
    getPrizes(eid),
    FB.get(`/events/${eid}/ui/rewardRounds`).catch(()=>({}))
  ]);

  const labelPhone = info.labelPhone || 'Phone';
  const labelDept  = info.labelDept  || 'Department';

  // build a quick map: "name||dept" -> prizeName
  const prizeMap = new Map();
  (prizes || []).forEach(p=>{
    (p.winners || []).forEach(w=>{
      const key = w?.phone ? `phone:${w.phone}` : `${w.name}||${w.dept||''}`;
      prizeMap.set(key, p.name || '');
    });
  });

  const safeRewardRounds = rewardRounds && !rewardRounds.error ? rewardRounds : {};
  const roundEntries = Object.entries(safeRewardRounds || {}).map(([id, round]) => ({
    id,
    name: (round && round.name) || id
  }));
  const roundIdsFromPeople = new Set();
  (people || []).forEach(p => {
    Object.keys(p?.rewardRounds || {}).forEach(id => roundIdsFromPeople.add(id));
  });
  roundIdsFromPeople.forEach(id => {
    if (!roundEntries.some(r => r.id === id)) roundEntries.push({ id, name: id });
  });

  const rows = [
    ['Code', labelPhone, 'Name', labelDept, 'Table', 'Seat', 'Present', 'LuckyPrize', ...roundEntries.map(r => r.name)],
    ...people.map(p=>[
      p.code || '',
      p.phone || '',
      p.name || '',
      p.dept || '',
      p.table || '',
      p.seat || '',
      p.checkedIn ? 1 : 0,
      prizeMap.get(p.phone ? `phone:${p.phone}` : `${p.name}||${p.dept||''}`) || p.prize || '',
      ...roundEntries.map(r => (p.rewardRounds && p.rewardRounds[r.id]) || '')
    ])
  ];

  const csv = rows
    .map(r => r.map(v => `"${String(v).replaceAll('"','""')}"`).join(','))
    .join('\r\n');

  return csv;
}
