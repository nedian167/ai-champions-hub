import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { buildFlows } from '../deploy/notifications/flows.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/');
const bundle = await build({
  configFile: false,
  logLevel: 'silent',
  plugins: [{
    name: 'notification-test-boundaries',
    enforce: 'pre',
    resolveId(id) {
      if (id.endsWith('notification-entry')) return '\0notification-entry';
      if (id === '@microsoft/power-apps/data') return '\0notification-client';
    },
    load(id) {
      if (id === '\0notification-entry') return [
        `export * from '${root}src/lib/notifications.ts';`,
        `export * from '${root}src/data/notifications.ts';`,
        `export * from '${root}src/lib/requestThread.ts';`,
      ].join('\n');
      if (id === '\0notification-client') return 'export const getClient = () => globalThis.__notificationClientTest;';
    },
  }],
  build: { write: false, minify: false, lib: { entry: 'notification-entry', formats: ['es'] } },
});
const code = (Array.isArray(bundle) ? bundle : [bundle])
  .flatMap((result) => result.output).find((output) => output.type === 'chunk').code;
assert.ok(!code.includes('powerAppsBridge'));

const userId = '11111111-1111-1111-1111-111111111111';
const preferenceId = '22222222-2222-2222-2222-222222222222';
let stored;
let calls;
let failure;
globalThis.__notificationClientTest = {
  async retrieveMultipleRecordsAsync(table, options) {
    calls.push({ operation: 'read', table, options });
    if (failure) return failure;
    return { success: true, data: table === 'abs_notificationpreferences' ? stored : [] };
  },
  async createRecordAsync(table, record) {
    calls.push({ operation: 'create', table, record });
    if (failure) return failure;
    stored = [{ ...record, abs_notificationpreferenceid: preferenceId, abs_entraobjectid: userId }];
    return { success: true };
  },
  async updateRecordAsync(table, id, record) {
    calls.push({ operation: 'update', table, id, record });
    if (failure) return failure;
    stored = [{ ...stored[0], ...record }];
    return { success: true };
  },
};
const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
beforeEach(() => { stored = []; calls = []; failure = null; });

test('all categories start off without opting users in', () => {
  assert.deepEqual(api.defaultNotificationSettings, {
    abs_requests: 0, abs_claims: 0, abs_campaigns: 0, abs_reminders: 0, abs_paused: false,
  });
  assert.equal(api.notificationCategories.length, 4);
});

for (const channel of [0, 1, 2, 3]) {
  test(`channel ${channel} round-trips without changing other categories`, () => {
    const settings = { ...api.defaultNotificationSettings, abs_requests: channel };
    assert.deepEqual(api.readNotificationSettings(settings), settings);
  });
}
for (const channel of [-1, 4, '1', null, undefined, NaN]) {
  test(`invalid saved channel ${String(channel)} is surfaced, not silently defaulted`, () => {
    assert.throws(() => api.readNotificationSettings({ ...api.defaultNotificationSettings, abs_requests: channel }), /invalid/);
  });
}
test('invalid saved pause setting is surfaced', () => {
  assert.throws(() => api.readNotificationSettings({ ...api.defaultNotificationSettings, abs_paused: null }), /invalid/);
});

for (const [target, route] of [
  ['request', `/requests?requestId=${userId}`],
  ['claim', `/activities?claimId=${userId}`],
  ['campaign', `/campaigns/${userId}`],
  ['event', `/events?eventId=${userId}`],
]) {
  test(`${target} notification uses a durable record route`, () => {
    assert.deepEqual(api.notificationLaunch({ hubTarget: target, hubId: userId.toUpperCase() }), { route, error: null });
  });
}
test('ordinary launches do not redirect', () => {
  assert.deepEqual(api.notificationLaunch({}), { route: null, error: null });
});
for (const params of [
  { hubTarget: 'request' },
  { hubTarget: 'request', hubId: "' or true" },
  { hubTarget: 'https://evil.invalid', hubId: userId },
  { hubTarget: '__proto__', hubId: userId },
  { hubId: userId },
]) {
  test(`bad notification link ${JSON.stringify(params)} shows an explicit error`, () => {
    const result = api.notificationLaunch(params);
    assert.equal(result.route, '/notifications');
    assert.ok(result.error);
  });
}

test('preferences are scoped by Entra identity, not a Champion profile', async () => {
  assert.equal(await api.loadNotificationPreferences(userId), null);
  assert.equal(calls[0].options.filter, `abs_entraobjectid eq '${userId}'`);
  assert.equal(calls[0].options.top, 2);
});
test('preference save does not let the browser supply owner or another user identity', async () => {
  const saved = await api.saveNotificationPreferences(userId, undefined, { ...api.defaultNotificationSettings, abs_requests: 3 });
  const create = calls.find((call) => call.operation === 'create');
  assert.equal(create.record.abs_requests, 3);
  assert.ok(!Object.hasOwn(create.record, 'ownerid'));
  assert.ok(!Object.hasOwn(create.record, 'abs_entraobjectid'));
  assert.equal(saved.abs_notificationpreferenceid, preferenceId);
});
test('existing preference update uses its actual Dataverse record ID', async () => {
  stored = [{ ...api.defaultNotificationSettings, abs_notificationpreferenceid: preferenceId, abs_entraobjectid: userId }];
  await api.saveNotificationPreferences(userId, preferenceId, { ...api.defaultNotificationSettings, abs_paused: true });
  assert.equal(calls[0].id, preferenceId);
  assert.equal(calls[0].record.abs_paused, true);
  assert.ok(!Object.hasOwn(calls[0].record, 'abs_name'));
});
test('duplicate preference rows are an error rather than an arbitrary selection', async () => {
  stored = [api.defaultNotificationSettings, api.defaultNotificationSettings];
  await assert.rejects(api.loadNotificationPreferences(userId), /Multiple/);
});
test('unreadable preferences never appear as an empty successful result', async () => {
  failure = { success: false, error: { message: 'Access denied' } };
  await assert.rejects(api.loadNotificationPreferences(userId), /Access denied/);
});
test('failed save does not report success or automatically retry', async () => {
  failure = { success: false, error: { message: 'Write denied' } };
  await assert.rejects(api.saveNotificationPreferences(userId, undefined, api.defaultNotificationSettings), /Write denied/);
  assert.equal(calls.length, 1);
});
test('delivery history is scoped, ordered, and bounded', async () => {
  assert.deepEqual(await api.loadNotificationDeliveries(userId), []);
  assert.equal(calls[0].options.filter, `abs_recipientobjectid eq '${userId}'`);
  assert.equal(calls[0].options.top, 25);
  assert.deepEqual(calls[0].options.orderBy, ['createdon desc']);
});
test('invalid identity cannot become an OData filter', async () => {
  await assert.rejects(api.loadNotificationPreferences("x' or true"), /Sign in/);
  assert.equal(calls.length, 0);
});
test('new thread metadata survives app parsing and serialization', () => {
  const message = { id: userId, actor: preferenceId, by: 'admin', name: 'Manager', text: 'Reply', at: '2026-11-02T10:00:00Z' };
  assert.deepEqual(api.parseThread(api.serializeThread([message])), [message]);
  assert.equal(api.parseThread('Legacy reply')[0].text, 'Legacy reply');
});

const config = { dataverseConnection: 'shared-cds-test', teamsConnection: 'shared-teams-test', outlookConnection: 'shared-outlook-test' };
const flows = buildFlows(config).map((flow) => ({ ...flow, parsed: JSON.parse(flow.clientdata) }));
const dispatch = flows[0].parsed.properties.definition;
const reminders = flows[1].parsed.properties.definition;

test('both flows are native solution-aware modern flows and start as drafts', () => {
  assert.equal(flows.length, 2);
  for (const flow of flows) {
    assert.equal(flow.category, 5);
    assert.equal(flow.type, 1);
    assert.equal(flow.primaryentity, 'none');
    assert.ok(!Object.hasOwn(flow, 'statecode'));
    for (const reference of Object.values(flow.parsed.properties.connectionReferences)) {
      assert.ok(reference.connection.connectionReferenceLogicalName.startsWith('abs_Notification'));
      assert.equal(reference.runtimeSource, 'embedded');
    }
  }
});
test('dispatch and foreach are serialized and send actions never automatically retry', () => {
  assert.equal(dispatch.triggers.Recurrence.runtimeConfiguration.concurrency.runs, 1);
  assert.equal(dispatch.actions.Deliveries.runtimeConfiguration.concurrency.repetitions, 1);
  const delivery = dispatch.actions.Deliveries.actions;
  assert.equal(delivery.Begin.inputs.retryPolicy.type, 'none');
  const send = delivery.Opted_in.actions.Send.actions.Channel;
  assert.equal(send.actions.Teams.inputs.retryPolicy.type, 'none');
  assert.equal(send.else.actions.Email.inputs.retryPolicy.type, 'none');
  assert.deepEqual(delivery.Opted_in.actions.Mark_uncertain.runAfter.Send, ['Failed', 'TimedOut']);
  assert.equal(delivery.Opted_in.actions.Mark_uncertain.inputs.parameters['item/Outcome'], 'uncertain');
});
test('recipient and content come from the server preference check, not an exposed webhook', () => {
  const send = dispatch.actions.Deliveries.actions.Opted_in.actions.Send.actions.Channel;
  assert.equal(send.actions.Teams.inputs.host.operationId, 'PostCardToConversation');
  assert.equal(send.actions.Teams.inputs.parameters.location, 'Chat with Flow bot');
  assert.equal(send.actions.Teams.inputs.parameters['body/recipient'], "@outputs('Payload')?['recipient']");
  assert.equal(send.actions.Teams.inputs.parameters['body/messageBody'], "@outputs('Payload')?['card']");
  assert.equal(send.else.actions.Email.inputs.host.operationId, 'SendEmailV2');
  assert.ok(!JSON.stringify(flows).includes('logic.azure.com'));
});
test('daily reminders use UTC, cover all four sources, and request paging', () => {
  assert.deepEqual(reminders.triggers.Recurrence.recurrence, {
    frequency: 'Day', interval: 1, timeZone: 'UTC', schedule: { hours: [7], minutes: [0] },
  });
  for (const source of ['Requests', 'Claims', 'Campaigns', 'Events']) {
    assert.equal(reminders.actions[source].runtimeConfiguration.paginationPolicy.minimumItemCount, 100000);
    assert.equal(reminders.actions[`Remind_${source}`].actions[`Capture_${source}`].inputs.host.operationId, 'PerformUnboundAction');
  }
});
test('missing connection identities fail generation rather than creating an unbound success', () => {
  assert.throws(() => buildFlows({ ...config, teamsConnection: '' }), /Configure teamsConnection/);
});
test('all nested action names are globally unique within each flow', () => {
  for (const flow of [dispatch, reminders]) {
    const names = new Set();
    function visit(actions) {
      for (const [name, action] of Object.entries(actions ?? {})) {
        assert.ok(!names.has(name), `Duplicate flow action: ${name}`);
        names.add(name);
        visit(action.actions);
        visit(action.else?.actions);
      }
    }
    visit(flow.actions);
  }
});
