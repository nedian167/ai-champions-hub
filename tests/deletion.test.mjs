import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const serviceNames = [
  'ActivitiesSvc', 'ActivityClaimsSvc', 'CampaignActivitiesSvc',
  'CampaignDepartmentsSvc', 'CampaignParticipationsSvc', 'EventsSvc',
];
const bundle = await build({
  configFile: false,
  logLevel: 'silent',
  plugins: [{
    name: 'deletion-test-services',
    enforce: 'pre',
    resolveId(id) { if (id === '../data/entities') return '\0deletion-test-services'; },
    load(id) {
      if (id === '\0deletion-test-services') {
        return serviceNames.map((name) =>
          `export const ${name} = new Proxy({}, { get: (_, method) => globalThis.__deletionTestServices.${name}[method] });`,
        ).join('\n');
      }
    },
  }],
  build: {
    write: false,
    minify: false,
    lib: { entry: fileURLToPath(new URL('../src/lib/deletion.ts', import.meta.url)), formats: ['es'] },
  },
});
const code = (Array.isArray(bundle) ? bundle : [bundle])
  .flatMap((result) => result.output).find((output) => output.type === 'chunk').code;
assert.ok(!code.includes('powerAppsBridge'), 'Deletion tests must not load the real Dataverse SDK');
assert.match(code, /__deletionTestServices/);
const { inspectDeletion, inspectActivityDeletion, deleteUnclaimedActivity } =
  await import(`data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=deletion-test-module.mjs`).toString('base64')}`);

const guid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const activityId = guid(1);
const campaignId = guid(10);
const activity = (id = activityId) => ({ abs_activityid: id, abs_title: `Activity ${id}`, crd49_points: 10 });
const link = (n, aid = activityId, cid = campaignId) => ({
  abs_campaignactivityid: guid(n),
  _crd49_activity_value: aid,
  _crd49_campaign_value: cid,
});
const claim = (status = 839560001, aid = activityId) => ({
  abs_activityclaimid: guid(30),
  abs_name: 'Protected claim',
  _crd49_activity_value: aid,
  _crd49_campaign_value: campaignId,
  crd49_status: status,
});
let db;
let writes;
let pageSize;
let beforeLinkDelete;
let failActivityDelete;

function readTable(table) {
  return async (options) => {
    const [field, value] = options.filter.split(' eq ');
    const rows = db[table].filter((row) => row[field] === value);
    const start = Number(options.skipToken ?? 0);
    const count = options.top ?? pageSize;
    return {
      success: true,
      data: rows.slice(start, start + count),
      skipToken: !options.top && start + count < rows.length ? String(start + count) : undefined,
    };
  };
}

beforeEach(() => {
  db = { activities: [activity()], links: [link(20)], claims: [], participants: [], departments: [], events: [] };
  writes = [];
  pageSize = 500;
  beforeLinkDelete = undefined;
  failActivityDelete = false;
  globalThis.__deletionTestServices = {
    ActivitiesSvc: {
      async get(id) {
        const data = db.activities.find((row) => row.abs_activityid === id);
        return { success: !!data, data, error: data ? undefined : new Error('Activity not found') };
      },
      async delete(id) {
        if (failActivityDelete) throw new Error('Activity delete denied');
        writes.push(['activity', id]);
        db.activities = db.activities.filter((row) => row.abs_activityid !== id);
      },
    },
    CampaignActivitiesSvc: {
      getAll: readTable('links'),
      async delete(id) {
        await beforeLinkDelete?.(id);
        writes.push(['link', id]);
        db.links = db.links.filter((row) => row.abs_campaignactivityid !== id);
      },
    },
    ActivityClaimsSvc: { getAll: readTable('claims') },
    CampaignParticipationsSvc: { getAll: readTable('participants') },
    CampaignDepartmentsSvc: { getAll: readTable('departments') },
    EventsSvc: { getAll: readTable('events') },
  };
});

test('a newly created activity can be deleted together with its automatic campaign link', async () => {
  const preview = await inspectDeletion('activity', activityId);
  assert.equal(preview.activities[0].links.length, 1);
  await deleteUnclaimedActivity(preview.activities[0]);
  assert.deepEqual(writes, [['link', guid(20)], ['activity', activityId]]);
});

test('shared activity deletion removes every campaign link, but never a campaign', async () => {
  db.links.push(link(21, activityId, guid(11)));
  await deleteUnclaimedActivity(await inspectActivityDeletion(activityId));
  assert.equal(db.links.length, 0);
  assert.deepEqual(writes.map(([table]) => table), ['link', 'link', 'activity']);
});

for (const status of [839560000, 839560001, 839560002]) {
  test(`claims with status ${status} protect both the activity and all campaign links`, async () => {
    db.claims.push(claim(status));
    const impact = await inspectActivityDeletion(activityId);
    assert.equal(impact.claims.length, 1);
    await assert.rejects(deleteUnclaimedActivity(impact), /has claims/);
    assert.deepEqual(writes, []);
    assert.equal(db.claims.length, 1);
  });
}

test('a claim arriving after the review prevents any unlinking', async () => {
  const impact = await inspectActivityDeletion(activityId);
  db.claims.push(claim());
  await assert.rejects(deleteUnclaimedActivity(impact), /has claims/);
  assert.deepEqual(writes, []);
});

test('a newly linked campaign requires another impact review', async () => {
  const impact = await inspectActivityDeletion(activityId);
  db.links.push(link(21, activityId, guid(11)));
  await assert.rejects(deleteUnclaimedActivity(impact), /links .* changed/);
  assert.deepEqual(writes, []);
});

test('changing the campaign on an existing link also requires another review', async () => {
  const impact = await inspectActivityDeletion(activityId);
  impact.links = structuredClone(impact.links);
  db.links[0]._crd49_campaign_value = guid(11);
  await assert.rejects(deleteUnclaimedActivity(impact), /links .* changed/);
  assert.deepEqual(writes, []);
});

test('a claim arriving mid-unlink stops deletion and reports partial link removal', async () => {
  db.links.push(link(21, activityId, guid(11)));
  const impact = await inspectActivityDeletion(activityId);
  beforeLinkDelete = async () => { db.claims.push(claim()); };
  await assert.rejects(deleteUnclaimedActivity(impact), /claim now exists.*1 campaign link\(s\) were already removed/);
  assert.equal(db.activities.length, 1);
  assert.equal(db.links.length, 1);
  assert.equal(db.claims.length, 1);
});

test('an unlink permission error stops the operation and reports prior progress', async () => {
  db.links.push(link(21, activityId, guid(11)));
  const impact = await inspectActivityDeletion(activityId);
  beforeLinkDelete = async (id) => { if (id === guid(21)) throw new Error('Unlink denied'); };
  await assert.rejects(deleteUnclaimedActivity(impact), /Unlink denied.*1 campaign link\(s\) were already removed/);
  assert.equal(db.activities.length, 1);
  assert.equal(db.links.length, 1);
});

test('activity delete failures report unlinking and can be retried after another review', async () => {
  const impact = await inspectActivityDeletion(activityId);
  failActivityDelete = true;
  await assert.rejects(deleteUnclaimedActivity(impact), /Activity delete denied.*1 campaign link\(s\) were already removed/);
  assert.equal(db.activities.length, 1);
  assert.equal(db.links.length, 0);
  failActivityDelete = false;
  await deleteUnclaimedActivity(await inspectActivityDeletion(activityId));
  assert.equal(db.activities.length, 0);
});

test('a link created during deletion protects the remaining activity', async () => {
  const impact = await inspectActivityDeletion(activityId);
  beforeLinkDelete = async () => { db.links.push(link(21, activityId, guid(11))); };
  await assert.rejects(deleteUnclaimedActivity(impact), /New campaign links were found/);
  assert.equal(db.activities.length, 1);
  assert.equal(db.links.length, 1);
});

test('dependency reads fail closed', async () => {
  globalThis.__deletionTestServices.ActivityClaimsSvc.getAll = async () =>
    ({ success: false, error: new Error('Claim read denied') });
  await assert.rejects(inspectActivityDeletion(activityId), /Claim read denied/);
  assert.deepEqual(writes, []);
});

test('a failed last-minute claim check cannot remove links', async () => {
  const impact = await inspectActivityDeletion(activityId);
  const read = readTable('claims');
  globalThis.__deletionTestServices.ActivityClaimsSvc.getAll = async (options) =>
    options.top ? { success: false, error: new Error('Recheck denied') } : read(options);
  await assert.rejects(deleteUnclaimedActivity(impact), /Recheck denied/);
  assert.deepEqual(writes, []);
});

test('all pages of links and claims are included, with unique activities in campaign previews', async () => {
  pageSize = 1;
  db.activities.push(activity(guid(2)));
  db.links.push(link(21), link(22, guid(2)), link(23, activityId, guid(11)));
  db.claims.push(claim(), { ...claim(839560000), abs_activityclaimid: guid(31) });
  const preview = await inspectDeletion('campaign', campaignId);
  assert.equal(preview.activities.length, 2);
  const first = preview.activities.find((item) => item.activity.abs_activityid === activityId);
  assert.equal(first.links.length, 3);
  assert.equal(first.claims.length, 2);
  assert.deepEqual(writes, []);
});

test('campaign participants, audience links, events and claims remain separate blockers', async () => {
  db.participants.push({ _crd49_campaign_value: campaignId });
  db.departments.push({ _abs_campaign_value: campaignId });
  db.events.push({ _crd49_campaign_value: campaignId });
  db.claims.push(claim());
  const preview = await inspectDeletion('campaign', campaignId);
  assert.deepEqual(preview.blockers.sort(), ['audience departments', 'claims', 'events', 'participants']);
  assert.deepEqual(writes, []);
});

test('campaigns remain blocked by linked activities until each activity is actually deleted', async () => {
  db.activities.push(activity(guid(2)));
  db.links.push(link(21, guid(2)));
  let preview = await inspectDeletion('campaign', campaignId);
  await deleteUnclaimedActivity(preview.activities[0]);
  preview = await inspectDeletion('campaign', campaignId);
  assert.equal(preview.activities.length, 1);
  await deleteUnclaimedActivity(preview.activities[0]);
  preview = await inspectDeletion('campaign', campaignId);
  assert.deepEqual(preview, { activities: [], blockers: [] });
});

test('a failed campaign blocker check cannot enable deletion', async () => {
  globalThis.__deletionTestServices.EventsSvc.getAll = async () => ({ success: false });
  await assert.rejects(inspectDeletion('campaign', campaignId), /Could not check linked events/);
});

test('invalid IDs never reach Dataverse', async () => {
  await assert.rejects(inspectActivityDeletion("bad' or true"), /Invalid record ID/);
  await assert.rejects(inspectDeletion('campaign', ''), /Invalid record ID/);
  assert.deepEqual(writes, []);
});

test('an unreadable activity cannot be deleted', async () => {
  db.activities = [];
  await assert.rejects(inspectDeletion('campaign', campaignId), /Activity not found/);
});

test('repeating paging tokens fail closed rather than silently truncating dependencies', async () => {
  globalThis.__deletionTestServices.CampaignActivitiesSvc.getAll = async () =>
    ({ success: true, data: [link(20)], skipToken: 'repeated' });
  await assert.rejects(inspectActivityDeletion(activityId), /Could not read all linked records/);
});

test('event deletion checks do not read or modify parent campaigns', async () => {
  assert.deepEqual(await inspectDeletion('event', guid(40)), { activities: [], blockers: [] });
  assert.deepEqual(writes, []);
});
