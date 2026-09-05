// Run with: node --experimental-vm-modules --test tests/lucky_v2_core.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const source = await readFile(new URL('../src/lucky_v2_core.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const person = (name, checkedIn = true) => ({ name, code: name, checkedIn });

async function harness({ mode = 'main', people = [person('A'), person('B'), person('C')] } = {}) {
  let database = { events: { test: { people: clone(people), ui: { luckyV2: {} } } } };
  const writes = [];
  const reads = [];
  const failures = { roster: false, patch: false };
  const read = path => {
    const value = path.split('/').filter(Boolean).reduce((node, key) => node?.[key], database);
    return value == null ? null : clone(value);
  };
  const assign = (root, path, value) => {
    const keys = path.split('/').filter(Boolean);
    const last = keys.pop();
    const parent = keys.reduce((node, key) => (node[key] ??= {}), root);
    if (value === null) delete parent[last];
    else parent[last] = clone(value);
  };
  const FB = {
    get: async path => {
      reads.push(path);
      if (failures.roster && path.endsWith('/people')) throw new Error('Roster unavailable');
      return read(path);
    },
    patch: async (path, patch) => {
      if (failures.patch) throw new Error('Write rejected');
      const next = clone(database);
      for (const [key, value] of Object.entries(patch)) assign(next, `${path}/${key}`, value);
      database = next;
      writes.push({ path, patch: clone(patch) });
    },
    put: async (path, value) => assign(database, path, value)
  };
  const prizes = [{ id: 'gift', name: 'Gift', quota: 10, winners: [] }];
  const sandbox = createContext({
    console, setTimeout, clearTimeout, AbortController,
    fetch: async (url, options) => {
      assert.ok(url.startsWith('https://firebase.test/events/test/'));
      assert.equal(options.method, 'PUT');
      const path = new URL(url).pathname.replace(/\.json$/, '');
      const data = JSON.parse(options.body);
      await FB.put(path, data);
      return { ok: true, json: async () => data };
    }
  });
  const core = {
    getPeople: eid => FB.get(`/events/${eid}/people`),
    getPrizes: async () => clone(prizes),
    getCurrentPrizeIdRemote: async () => 'gift',
    getEventInfo: async () => ({}),
    getAssets: async () => ({}),
    setCurrentEventId: () => {}
  };
  const module = new SourceTextModule(source, { context: sandbox });
  await module.link(specifier => {
    const exports = specifier.startsWith('./fb.js') ? { FB }
      : specifier === './config.js' ? { CONFIG: { firebaseBase: 'https://firebase.test' } }
      : core;
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context: sandbox });
  });
  await module.evaluate();
  const api = module.namespace;
  const roundId = mode === 'extra' ? api.roundIdFor('Extra Round') : 'main';
  const winners = people.slice(0, 2).map((p, sourceIndex) => ({
    ...p, sourceIndex, key: api.participantKey(p), keyId: api.keyIdFromKey(api.participantKey(p))
  }));
  const batch = { id: 'previous', mode, roundId, prizeId: 'gift', winners, createdAt: 1 };
  const batchRoot = mode === 'extra' ? `rewardRounds/${roundId}` : 'main';
  assign(database, `/events/test/ui/luckyV2/${batchRoot}`, {
    batches: { previous: batch }, winnerKeys: Object.fromEntries(winners.map(w => [w.keyId, true]))
  });
  const context = { people: clone(people), prizes, curPrizeId: 'gift', v2: read('/events/test/ui/luckyV2') };
  const options = { mode, prizeId: 'gift', context, instant: true };
  return {
    api, FB, writes, reads, failures, context, options, read,
    set: (path, value) => assign(database, `/events/test/${path}`, value),
    draw: extra => api.drawV2('test', { ...options, ...extra })
  };
}

for (const mode of ['main', 'extra']) {
  test(`${mode}: reroll checks out only the replaced person and manual check-in restores eligibility`, async () => {
    const h = await harness({ mode });
    const result = await h.draw({ previousBatchId: 'previous', replaceIndex: 0 });
    assert.deepEqual(clone(result.entry.winners.map(w => w.name)), ['C', 'B']);
    assert.deepEqual(h.read('/events/test/people').map(p => p.checkedIn), [false, true, true]);
    assert.equal(result.people[0].checkedIn, false);
    assert.equal(h.context.people[0].checkedIn, true, 'original cache stays stale to test fresh reads');
    assert.equal(h.writes.length, 1, 'result and attendance use one atomic write');
    assert.equal(h.writes[0].path, '/events/test');
    assert.equal(h.writes[0].patch['people/0/checkedIn'], false);
    assert.ok(Object.keys(h.writes[0].patch).some(path => path.includes('/batches/') && path.endsWith(result.entry.id)));
    await assert.rejects(h.draw(), /No eligible checked-in participants/);
    await h.FB.patch('/events/test/people/0', { checkedIn: true });
    const returned = await h.draw();
    assert.deepEqual(clone(returned.entry.winners.map(w => w.name)), ['A']);
  });

  test(`${mode}: batch redraw excludes and checks out all former winners`, async () => {
    const h = await harness({ mode, people: ['A', 'B', 'C', 'D'].map(name => person(name)) });
    const preview = await h.api.previewSpin('test', { ...h.options, previousBatchId: 'previous', redraw: true, batchSize: 2 });
    assert.deepEqual(clone(preview.stageState.candidateNames.map(p => p.name)).sort(), ['C', 'D']);
    assert.equal(h.read('/events/test/people/0/checkedIn'), true, 'preview does not change attendance');
    const result = await h.draw({ previousBatchId: 'previous', redraw: true, batchSize: 2, drawContext: preview.drawContext });
    assert.equal(h.reads.filter(path => path.endsWith('/people')).length, 1);
    assert.equal(h.reads.filter(path => path.endsWith('/luckyV2')).length, 1);
    assert.deepEqual(clone(result.entry.winners.map(w => w.name)).sort(), ['C', 'D']);
    assert.deepEqual(h.read('/events/test/people').map(p => p.checkedIn), [false, false, true, true]);
    await assert.rejects(h.draw(), /No eligible checked-in participants/);
  });
}

test('replacement follows participant identity after roster order changes', async () => {
  const h = await harness();
  h.set('people', [person('C'), person('B'), person('A')]);
  await h.draw({ previousBatchId: 'previous', replaceIndex: 0 });
  assert.deepEqual(h.read('/events/test/people').map(p => [p.name, p.checkedIn]), [['C', true], ['B', true], ['A', false]]);
});

test('a checkout blocks other draw modes, and undo does not restore attendance', async () => {
  const h = await harness({ mode: 'extra' });
  await h.draw({ previousBatchId: 'previous', replaceIndex: 0 });
  h.set('people/1/checkedIn', false);
  h.set('people/2/checkedIn', false);
  await assert.rejects(h.draw({ mode: 'main' }), /No eligible checked-in participants/);
  await h.api.undoLastV2('test');
  assert.equal(h.read('/events/test/people/0/checkedIn'), false);
  await assert.rejects(h.draw(), /No eligible checked-in participants/);
});

test('no replacement candidate leaves the original batch and attendance unchanged', async () => {
  const h = await harness({ people: [person('A'), person('B')] });
  const before = h.read('/events/test');
  await assert.rejects(h.draw({ previousBatchId: 'previous', replaceIndex: 0 }), /No eligible checked-in participants/);
  await assert.rejects(h.draw({ previousBatchId: 'previous', redraw: true }), /No eligible checked-in participants/);
  assert.deepEqual(h.read('/events/test'), before);
  assert.equal(h.writes.length, 0);
});

test('failed replacement write preserves attendance and results', async () => {
  const h = await harness();
  const before = h.read('/events/test');
  h.failures.patch = true;
  await assert.rejects(h.draw({ previousBatchId: 'previous', replaceIndex: 0 }), /Write rejected/);
  assert.deepEqual(h.read('/events/test'), before);
  assert.equal(h.context.people[0].checkedIn, true);
});

test('roster read failure cannot fall back to stale checked-in participants', async () => {
  const h = await harness();
  h.failures.roster = true;
  await assert.rejects(h.draw({ previousBatchId: 'previous', replaceIndex: 0 }), /Roster unavailable/);
  await assert.rejects(h.api.previewSpin('test', h.options), /Roster unavailable/);
  assert.equal(h.writes.length, 0);
});

test('stale batches and invalid winner slots cannot trigger replacement', async () => {
  const h = await harness();
  await assert.rejects(h.draw({ previousBatchId: 'missing', replaceIndex: 0 }), /no longer active/);
  await assert.rejects(h.draw({ previousBatchId: 'previous', replaceIndex: 9 }), /slot no longer exists/);
  assert.equal(h.writes.length, 0);
});

test('normal preview and draw share one fresh read, then the next action refreshes again', async () => {
  const h = await harness({ people: [person('A'), person('B'), person('C'), person('D', false)] });
  h.set('people/2/checkedIn', false);
  h.set('people/3/checkedIn', true);
  const preview = await h.api.previewSpin('test', h.options);
  const result = await h.draw({ drawContext: preview.drawContext });
  assert.deepEqual(clone(result.entry.winners.map(w => w.name)), ['D']);
  assert.equal(h.reads.filter(path => path.endsWith('/people')).length, 1);
  assert.equal(h.reads.filter(path => path.endsWith('/luckyV2')).length, 1);

  h.set('people/2/checkedIn', true);
  const nextPreview = await h.api.previewSpin('test', h.options);
  const nextResult = await h.draw({ drawContext: nextPreview.drawContext });
  assert.deepEqual(clone(nextResult.entry.winners.map(w => w.name)), ['C']);
  assert.equal(h.reads.filter(path => path.endsWith('/people')).length, 2);
  assert.equal(h.reads.filter(path => path.endsWith('/luckyV2')).length, 2);
});

test('draws without a preview still refresh attendance once', async () => {
  const h = await harness();
  await h.draw({ previousBatchId: 'previous', replaceIndex: 0 });
  assert.equal(h.reads.filter(path => path.endsWith('/people')).length, 1);
  assert.equal(h.reads.filter(path => path.endsWith('/luckyV2')).length, 1);
});
