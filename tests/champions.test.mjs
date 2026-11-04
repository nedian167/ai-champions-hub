import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/');
const bundle = await build({
  configFile: false,
  logLevel: 'silent',
  plugins: [{
    name: 'champion-test-boundary',
    enforce: 'pre',
    resolveId(id) {
      if (id.endsWith('champion-test-entry')) return '\0champion-test-entry';
      if (id === '@microsoft/power-apps/data') return '\0champion-test-sdk';
    },
    load(id) {
      if (id === '\0champion-test-entry') return [
        `export * from '${root}src/data/champions.ts';`,
        `export * from '${root}src/lib/championIdentity.ts';`,
      ].join('\n');
      if (id === '\0champion-test-sdk') return 'export const getClient=()=>globalThis.__championTestClient;';
    },
  }],
  build: { write: false, minify: false, lib: { entry: 'champion-test-entry', formats: ['es'] } },
});
const code = (Array.isArray(bundle) ? bundle : [bundle])
  .flatMap((result) => result.output).find((output) => output.type === 'chunk').code;
assert.ok(!code.includes('powerAppsBridge'));
let rows;
let calls;
let readFailure;
let writeFailure;
let pauseWrite;
globalThis.__championTestClient = {
  async retrieveMultipleRecordsAsync(table, options) {
    calls.push({ op: 'read', table, options });
    if (readFailure) return readFailure;
    const literal = /^\(abs_userid eq '((?:[^']|'')*)' or abs_normalizeduserid eq '((?:[^']|'')*)'\)$/.exec(options.filter);
    assert.ok(literal, 'User ID filters must use one escaped OData string literal');
    const identity = literal[1].replaceAll("''", "'").toLowerCase();
    assert.equal(literal[1], literal[2]);
    return { success: true, data: rows.filter((row) => row.abs_userid.toLowerCase() === identity || row.abs_normalizeduserid === identity).slice(0, options.top) };
  },
  async createRecordAsync(table, record) {
    calls.push({ op: 'create', table, record });
    if (pauseWrite) await pauseWrite;
    if (writeFailure) return writeFailure;
    const data = { ...record, abs_championid: 'new-id' };
    rows.push(data);
    return { success: true, data };
  },
  async updateRecordAsync(table, id, fields) {
    calls.push({ op: 'update', table, id, fields });
    if (writeFailure) return writeFailure;
    return { success: true, data: { ...rows.find((row) => row.abs_championid === id), ...fields } };
  },
};
const { ChampionsService, findChampionProfiles, normalizeChampionUserId } =
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
beforeEach(() => {
  rows = [];
  calls = [];
  readFailure = null;
  writeFailure = null;
  pauseWrite = null;
});
const profile = (overrides = {}) => ({ abs_championid: 'lisa-id', abs_userid: 'lisa.taylor@example.test', crd49_displayname: 'Lisa Taylor', ...overrides });

test('identity normalization ignores capitalization and surrounding whitespace, not different users', () => {
  assert.equal(normalizeChampionUserId('  Lisa.Taylor@EXAMPLE.test \t'), 'lisa.taylor@example.test');
  assert.equal(normalizeChampionUserId(undefined), '');
  assert.notEqual(normalizeChampionUserId('another.lisa@example.test'), normalizeChampionUserId('lisa.taylor@example.test'));
});
for (const status of [839560000, 839560001, 839560002]) {
  test(`existing Lisa profile blocks duplicate creation for status ${status}`, async () => {
    rows = [profile({ crd49_status: status, statecode: 1 })];
    await assert.rejects(ChampionsService.create({ abs_userid: ' LISA.TAYLOR@example.test ', crd49_displayname: 'Lisa Taylor' }), /already exists/);
    assert.deepEqual(calls.map((call) => call.op), ['read']);
    assert.equal(rows.length, 1);
  });
}
test('fresh SDK lookup catches a profile missing from the current screen snapshot', async () => {
  rows = [profile()];
  await assert.rejects(ChampionsService.create({ abs_userid: 'lisa.taylor@example.test' }), /already exists/);
  assert.equal(calls[0].table, 'abs_champions');
  assert.ok(!calls[0].options.filter.includes('status'));
});
test('a different account with the same display name can be added with a canonical ID', async () => {
  rows = [profile()];
  const input = { abs_userid: ' ANOTHER.LISA@example.test ', crd49_displayname: 'Lisa Taylor' };
  const result = await ChampionsService.create(input);
  assert.equal(result.success, true);
  assert.equal(result.data.abs_userid, 'another.lisa@example.test');
  assert.equal(input.abs_userid, ' ANOTHER.LISA@example.test ');
});
test('editing the same Champion identity excludes the current record', async () => {
  rows = [profile()];
  await ChampionsService.update('LISA-ID', { abs_userid: ' Lisa.Taylor@example.test ', crd49_displayname: 'Lisa' });
  assert.equal(calls.at(-1).op, 'update');
  assert.equal(calls.at(-1).fields.abs_userid, 'lisa.taylor@example.test');
});
test('editing cannot take another Champion identity, even when the current row is returned first', async () => {
  rows = [profile(), profile({ abs_championid: 'duplicate-id' })];
  await assert.rejects(ChampionsService.update('lisa-id', { abs_userid: 'LISA.TAYLOR@example.test' }), /already exists/);
  assert.ok(!calls.some((call) => call.op === 'update'));
});
test('status-only updates do not need a User ID or a uniqueness lookup', async () => {
  await ChampionsService.update('lisa-id', { crd49_status: 839560002 });
  assert.deepEqual(calls.map((call) => call.op), ['update']);
});
test('lookup failure or missing data prevents writes rather than treating the profile as absent', async () => {
  for (const failure of [{ success: false, error: { message: 'Access denied' } }, { success: true }]) {
    readFailure = failure;
    await assert.rejects(ChampionsService.create({ abs_userid: 'lisa.taylor@example.test' }));
  }
  assert.ok(!calls.some((call) => call.op === 'create'));
});
test('blank identities never reach the SDK', async () => {
  await assert.rejects(ChampionsService.create({ abs_userid: ' \t ' }), /required/);
  await assert.rejects(ChampionsService.update('lisa-id', { abs_userid: '' }), /required/);
  assert.equal(calls.length, 0);
});
test('apostrophes in valid UPNs are escaped in lookups', async () => {
  rows = [profile({ abs_userid: "lisa.o'taylor@example.test" })];
  const result = await findChampionProfiles(" LISA.O'TAYLOR@example.test ");
  assert.equal(result.length, 1);
  assert.equal(calls[0].options.filter, "(abs_userid eq 'lisa.o''taylor@example.test' or abs_normalizeduserid eq 'lisa.o''taylor@example.test')");
});
test('requester lookup exposes multiple matches rather than picking a profile', async () => {
  rows = [profile(), profile({ abs_championid: 'duplicate-id' }), profile({ abs_championid: 'third-id' })];
  assert.equal((await findChampionProfiles('lisa.taylor@example.test')).length, 2);
});
test('normalized server identity catches legacy surrounding whitespace', async () => {
  rows = [profile({ abs_userid: ' Lisa.Taylor@example.test ', abs_normalizeduserid: 'lisa.taylor@example.test' })];
  await assert.rejects(ChampionsService.create({ abs_userid: 'lisa.taylor@example.test' }), /already exists/);
  assert.ok(!calls.some((call) => call.op === 'create'));
});
test('oversized identities fail before a write or an SDK lookup', async () => {
  await assert.rejects(ChampionsService.create({ abs_userid: 'x'.repeat(321) }), /320/);
  assert.equal(calls.length, 0);
});
test('overlapping normalized saves cannot issue two writes in one app instance', async () => {
  let release;
  pauseWrite = new Promise((resolve) => { release = resolve; });
  const first = ChampionsService.create({ abs_userid: 'lisa.taylor@example.test' });
  await assert.rejects(ChampionsService.create({ abs_userid: ' LISA.TAYLOR@example.test ' }), /already in progress/);
  release();
  await first;
  assert.equal(calls.filter((call) => call.op === 'create').length, 1);
});
test('failed writes remain failures and release the pending-identity guard for a retry', async () => {
  writeFailure = { success: false, error: { message: 'Server unique key conflict' } };
  assert.equal((await ChampionsService.create({ abs_userid: 'lisa.taylor@example.test' })).success, false);
  writeFailure = null;
  assert.equal((await ChampionsService.create({ abs_userid: 'lisa.taylor@example.test' })).success, true);
});
