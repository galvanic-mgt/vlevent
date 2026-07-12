import { FB } from './fb.js?v=20260706b';

export const VOTER_LOOKUP_VERSION = 1;

const normalizeText = value => String(value || '').trim().toLowerCase();
const normalizeDigits = value => String(value || '').replace(/\D+/g, '');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function tokenKey(token) {
  const bytes = new TextEncoder().encode(token);
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return hex ? `v_${hex}` : '';
}

function lookupTokens(value) {
  const tokens = [normalizeText(value), normalizeDigits(value)].filter(Boolean);
  return [...new Set(tokens)];
}

function lookupMeta(people, lookup) {
  return {
    version: VOTER_LOOKUP_VERSION,
    rosterSize: people.length,
    aliasCount: Object.keys(lookup).length,
    updatedAt: Date.now()
  };
}

export function buildVoterLookup(people = []) {
  const list = Array.isArray(people) ? people : [];
  const lookup = {};

  list.forEach((person, index) => {
    if (!person) return;
    const record = {
      index,
      name: String(person.name || ''),
      code: String(person.code || ''),
      phone: String(person.phone || '')
    };
    const aliases = [normalizeText(person.code), normalizeDigits(person.phone)].filter(Boolean);
    [...new Set(aliases)].forEach(alias => {
      const key = tokenKey(alias);
      if (key && !Object.prototype.hasOwnProperty.call(lookup, key)) lookup[key] = record;
    });
  });

  return lookup;
}

export async function writePeopleWithVoterLookup(eid, people = []) {
  if (!eid) throw new Error('Missing event ID');
  const list = Array.isArray(people) ? people : [];
  const lookup = buildVoterLookup(list);
  return await FB.patch(`/events/${eid}`, {
    people: list,
    voterLookup: Object.keys(lookup).length ? lookup : null,
    voterLookupMeta: lookupMeta(list, lookup)
  });
}

export async function rebuildVoterLookup(eid) {
  if (!eid) throw new Error('Missing event ID');
  const people = (await FB.get(`/events/${eid}/people`)) || [];
  const list = Array.isArray(people) ? people : [];
  const lookup = buildVoterLookup(list);
  await FB.patch(`/events/${eid}`, {
    voterLookup: Object.keys(lookup).length ? lookup : null,
    voterLookupMeta: lookupMeta(list, lookup)
  });
  return { rosterSize: list.length, aliasCount: Object.keys(lookup).length };
}

async function readLookupValue(path) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await FB.get(path);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(150 * (2 ** attempt) + Math.floor(Math.random() * 120));
    }
  }
  throw lastError;
}

export async function findVoterInLookup(eid, rawValue) {
  if (!eid) throw new Error('Missing event ID');
  const keys = lookupTokens(rawValue).map(tokenKey).filter(Boolean);
  if (!keys.length) return null;

  const matches = (await Promise.all(
    keys.map(key => readLookupValue(`/events/${eid}/voterLookup/${key}`))
  )).filter(Boolean);

  if (matches.length) {
    return matches.sort((a, b) => Number(a.index || 0) - Number(b.index || 0))[0];
  }

  const meta = await readLookupValue(`/events/${eid}/voterLookupMeta`);
  if (Number(meta?.version || 0) !== VOTER_LOOKUP_VERSION) {
    const error = new Error('The voter list is still being prepared. Please try again shortly.');
    error.code = 'VOTER_LOOKUP_NOT_READY';
    throw error;
  }
  return null;
}
