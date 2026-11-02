import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const bundle = await build({
  configFile: false,
  logLevel: 'silent',
  plugins: [{
    name: 'outlook-test-services',
    enforce: 'pre',
    resolveId(id) { if (id === '../data/entities') return '\0outlook-test-services'; },
    load(id) {
      if (id === '\0outlook-test-services') return 'export const OutlookSvc = { HttpRequest: (...args) => globalThis.__outlookRequest(...args) };';
    },
  }],
  build: {
    write: false,
    minify: false,
    lib: { entry: fileURLToPath(new URL('../src/lib/outlookCalendar.ts', import.meta.url)), formats: ['es'] },
  },
});
const code = (Array.isArray(bundle) ? bundle : [bundle])
  .flatMap((result) => result.output).find((output) => output.type === 'chunk').code;
assert.ok(!code.includes('powerAppsBridge'), 'Tests must never initialize the real Outlook SDK');
assert.match(code, /__outlookRequest/);
const { addToOutlookCalendar, findOutlookEvent, listOutlookCalendars, OutlookCreationUncertainError } =
  await import(`data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=outlook-test-module.mjs`).toString('base64')}`);

const hubId = 'c850babb-65cf-47e1-a17f-22995a2e82b8';
const hub = {
  abs_eventid: hubId, abs_name: 'AI champions workshop',
  crd49_eventdate: '2026-11-10T10:00:00Z',
  abs_eventend: '2026-11-10T11:15:00Z',
  crd49_description: '<img src=x onerror=alert(1)> & café',
  crd49_location: 'Workshop room',
  crd49_meetinglink: 'https://teams.microsoft.com/l/meetup-join/example',
};
const primary = {
  id: 'my/calendar+id=', name: 'Calendar', owner: { address: 'owner@example.test' },
  canEdit: true, isDefaultCalendar: true,
};
const saved = { id: 'outlook-event-id', subject: hub.abs_name, webLink: 'https://outlook.office.com/calendar/item/example' };
let requests;
let events;
let calendars;
let intercept;
let writeFailure;
let persistFailedWrite;

beforeEach(() => {
  requests = [];
  events = [];
  calendars = [primary];
  intercept = undefined;
  writeFailure = undefined;
  persistFailedWrite = false;
  globalThis.__outlookRequest = async (uri, method, body, contentType) => {
    const request = { uri, url: new URL(uri), method, body, contentType };
    requests.push(request);
    if (intercept) {
      const response = await intercept(request);
      if (response !== undefined) return response;
    }
    if (method === 'POST') {
      assert.equal(contentType, 'application/json');
      assert.doesNotThrow(() => JSON.parse(body), 'Generated binary argument must receive raw JSON, not base64');
      if (!writeFailure || persistFailedWrite) events.push(saved);
      if (writeFailure) throw writeFailure;
      return { success: true, data: saved };
    }
    if (request.url.pathname.endsWith('/events')) return { success: true, data: { value: events } };
    if (request.url.pathname.endsWith('/calendars')) return { success: true, data: { value: calendars } };
    return { success: true, data: primary };
  };
});

const posts = () => requests.filter((request) => request.method === 'POST');

test('lists only writable calendars owned by the connected mailbox, default first', async () => {
  calendars = [
    { ...primary, id: 'secondary', name: 'Personal', isDefaultCalendar: false },
    { ...primary, id: 'shared', owner: { address: 'someone@example.test' } },
    { ...primary, id: 'readonly', canEdit: false },
    primary,
  ];
  assert.deepEqual((await listOutlookCalendars()).map((calendar) => calendar.id), [primary.id, 'secondary']);
  assert.equal(posts().length, 0);
});

test('calendar enumeration follows pagination', async () => {
  intercept = ({ url }) => {
    if (!url.pathname.endsWith('/calendars')) return;
    return { success: true, data: url.searchParams.has('$skiptoken') ? { value: [primary] } :
      { value: [], '@odata.nextLink': `${url.href}&$skiptoken=second` } };
  };
  assert.equal((await listOutlookCalendars())[0].id, primary.id);
});

for (const link of [
  'https://attacker.example/v1.0/me/calendars',
  'https://graph.microsoft.com/v1.0/users/another/calendars',
  'https://graph.microsoft.com/v1.0/me/messages',
  'http://graph.microsoft.com/v1.0/me/calendars',
]) {
  test(`rejects unsafe pagination ${link}`, async () => {
    intercept = ({ url }) => url.pathname.endsWith('/calendars') ?
      { success: true, data: { value: [], '@odata.nextLink': link } } : undefined;
    await assert.rejects(listOutlookCalendars(), /pagination URL/);
    assert.ok(!requests.some((request) => request.uri === link));
  });
}

test('rejects repeated pagination without an infinite loop', async () => {
  intercept = ({ url }) => url.pathname.endsWith('/calendars') ?
    { success: true, data: { value: [], '@odata.nextLink': url.href } } : undefined;
  await assert.rejects(listOutlookCalendars(), /repeated a results page/);
});

for (const data of [null, {}, { value: null }, { value: [], '@odata.nextLink': 42 }]) {
  test(`fails closed on malformed calendar response ${JSON.stringify(data)}`, async () => {
    intercept = ({ url }) => url.pathname.endsWith('/calendars') ? { success: true, data } : undefined;
    await assert.rejects(listOutlookCalendars());
    assert.equal(posts().length, 0);
  });
}

test('missing ownership information is an explicit error', async () => {
  calendars = [{ ...primary, owner: {} }];
  await assert.rejects(listOutlookCalendars(), /calendar owner/);
});

test('no writable personal calendars is an explicit error', async () => {
  calendars = [{ ...primary, canEdit: false }];
  await assert.rejects(listOutlookCalendars(), /No writable/);
});

test('connection denial propagates without creating appointments', async () => {
  intercept = () => ({ success: false, error: { message: 'Connection consent denied' } });
  await assert.rejects(listOutlookCalendars(), /Connection consent denied/);
  assert.equal(posts().length, 0);
});

test('Graph error bodies preserve permission guidance instead of looking like empty results', async () => {
  intercept = () => ({ success: true, data: { error: { code: 'ErrorAccessDenied', message: 'Access denied by tenant policy' } } });
  await assert.rejects(listOutlookCalendars(), /Access denied by tenant policy/);
  assert.equal(posts().length, 0);
});

test('creates a personal appointment using the exact saved start/end and no invitations', async () => {
  assert.equal((await addToOutlookCalendar(hub, primary.id)).status, 'added');
  const [request] = posts();
  assert.ok(request.uri.includes(encodeURIComponent(primary.id)));
  const body = JSON.parse(request.body);
  assert.deepEqual(body.start, { dateTime: '2026-11-10T10:00:00.000', timeZone: 'UTC' });
  assert.deepEqual(body.end, { dateTime: '2026-11-10T11:15:00.000', timeZone: 'UTC' });
  assert.equal(body.body.contentType, 'text');
  assert.ok(body.body.content.includes(hub.crd49_description));
  assert.ok(body.body.content.includes(hub.crd49_meetinglink));
  for (const field of ['attendees', 'recurrence', 'isOnlineMeeting', 'onlineMeetingProvider']) assert.ok(!(field in body));
  assert.equal(body.singleValueExtendedProperties[0].value, hubId);
  assert.match(body.transactionId, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.ok(requests.every(({ url }) => url.origin === 'https://graph.microsoft.com' && url.pathname.startsWith('/v1.0/me/')));
});

test('an existing durable marker prevents another POST even after Hub dates or title change', async () => {
  events = [saved];
  const result = await addToOutlookCalendar({
    ...hub, abs_name: 'Changed', crd49_eventdate: '2027-01-15T12:00:00Z', abs_eventend: '2027-01-16T15:00:00Z',
  }, primary.id);
  assert.equal(result.status, 'already-added');
  assert.equal(posts().length, 0);
  const lookup = requests.find(({ url }) => url.pathname.endsWith('/events'));
  assert.ok(lookup.url.searchParams.get('$filter').includes(hubId));
  assert.ok(!lookup.url.search.includes('2027'));
});

test('duplicate lookup follows pagination and detects multiple existing copies', async () => {
  intercept = ({ url }) => {
    if (!url.pathname.endsWith('/events')) return;
    return { success: true, data: url.searchParams.has('$skiptoken') ? { value: [saved] } :
      { value: [saved], '@odata.nextLink': `${url.href}&$skiptoken=next` } };
  };
  await assert.rejects(addToOutlookCalendar(hub, primary.id), /Multiple Outlook copies/);
  assert.equal(posts().length, 0);
});

test('failed duplicate lookup blocks creation rather than assuming no copy exists', async () => {
  intercept = ({ url }) => url.pathname.endsWith('/events') ? { success: false, error: { message: 'Read forbidden' } } : undefined;
  await assert.rejects(addToOutlookCalendar(hub, primary.id), /Read forbidden/);
  assert.equal(posts().length, 0);
});

test('calendar ownership and editing permissions are freshly checked before writes', async () => {
  intercept = ({ url }) => url.pathname.includes('/calendars/') && !url.pathname.endsWith('/events') ?
    { success: true, data: { ...primary, owner: { address: 'another@example.test' } } } : undefined;
  await assert.rejects(addToOutlookCalendar(hub, primary.id), /owned by the connected/);
  assert.equal(posts().length, 0);
});

test('a calendar becoming read-only after selection prevents a write', async () => {
  intercept = ({ url }) => url.pathname.includes('/calendars/') && !url.pathname.endsWith('/events') ?
    { success: true, data: { ...primary, canEdit: false } } : undefined;
  await assert.rejects(addToOutlookCalendar(hub, primary.id), /writable calendar/);
  assert.equal(posts().length, 0);
});

test('concurrent repeated clicks share one in-flight operation and create only once', async () => {
  const [first, second] = await Promise.all([
    addToOutlookCalendar(hub, primary.id), addToOutlookCalendar(hub, primary.id),
  ]);
  assert.deepEqual(first, second);
  assert.equal(posts().length, 1);
});

test('a timed-out write is recovered by the marker without retrying POST', async () => {
  writeFailure = new Error('Response timed out');
  persistFailedWrite = true;
  assert.equal((await addToOutlookCalendar(hub, primary.id)).status, 'recovered');
  assert.equal(posts().length, 1);
});

test('a connector write that never settles has a bounded, explicitly unknown outcome', { timeout: 5000 }, async (context) => {
  const nativeSetTimeout = globalThis.setTimeout;
  let deadline;
  context.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 30_000) deadline = callback;
    return nativeSetTimeout(callback, delay, ...args);
  });
  let reportStarted;
  const started = new Promise((resolve) => { reportStarted = resolve; });
  intercept = ({ method }) => {
    if (method !== 'POST') return;
    reportStarted();
    return new Promise(() => {});
  };
  const operation = addToOutlookCalendar(hub, primary.id);
  const result = assert.rejects(operation, (error) =>
    error instanceof OutlookCreationUncertainError && error.message.includes('30 seconds'));
  await started;
  assert.equal(posts().length, 1);
  deadline();
  await result;
  assert.equal(posts().length, 1);
});

test('unknown write outcome is explicit and retries reuse the stable transaction ID', async () => {
  writeFailure = new Error('Network interrupted');
  await assert.rejects(addToOutlookCalendar(hub, primary.id), OutlookCreationUncertainError);
  const firstId = JSON.parse(posts()[0].body).transactionId;
  writeFailure = undefined;
  assert.equal((await addToOutlookCalendar(hub, primary.id)).status, 'added');
  assert.equal(JSON.parse(posts()[1].body).transactionId, firstId);
});

test('a failed recovery check preserves both errors and does not report success', async () => {
  writeFailure = new Error('Write timed out');
  intercept = ({ url, method }) => method === 'GET' && url.pathname.endsWith('/events') && posts().length ?
    { success: false, error: { message: 'Status unavailable' } } : undefined;
  await assert.rejects(addToOutlookCalendar(hub, primary.id), /Creation: Write timed out Status check:.*Status unavailable/);
  assert.equal(posts().length, 1);
});

test('the same Hub event uses distinct transaction IDs in distinct calendars', async () => {
  await addToOutlookCalendar(hub, primary.id);
  const firstId = JSON.parse(posts()[0].body).transactionId;
  events = [];
  intercept = ({ url }) => url.pathname === '/v1.0/me/calendars/second' ? { success: true, data: { ...primary, id: 'second' } } : undefined;
  await addToOutlookCalendar(hub, 'second');
  assert.notEqual(JSON.parse(posts()[1].body).transactionId, firstId);
});

for (const end of [undefined, null, '', 'not-a-date', '2026-11-10T10:00:00Z', '2026-11-10T09:00:00Z', '2026-11-10T12:00']) {
  test(`missing or invalid saved end ${end} cannot create an appointment`, async () => {
    await assert.rejects(addToOutlookCalendar({ ...hub, abs_eventend: end }, primary.id));
    assert.equal(requests.length, 0);
  });
}

test('copies saved multi-day and DST schedules as exact UTC instants', async () => {
  for (const [start, end] of [
    ['2026-03-08T01:30:00-05:00', '2026-03-08T03:30:00-04:00'],
    ['2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-05:00'],
    ['2026-11-10T23:30:00+03:00', '2026-11-13T04:45:00+03:00'],
  ]) {
    events = [];
    await addToOutlookCalendar({ ...hub, crd49_eventdate: start, abs_eventend: end }, primary.id);
    const body = JSON.parse(posts().at(-1).body);
    assert.equal(body.start.dateTime, new Date(start).toISOString().slice(0, -1));
    assert.equal(body.end.dateTime, new Date(end).toISOString().slice(0, -1));
  }
});

test('invalid Hub IDs and meeting links cannot reach a write', async () => {
  await assert.rejects(addToOutlookCalendar({ ...hub, abs_eventid: "id' or true" }, primary.id), /invalid ID/);
  await assert.rejects(addToOutlookCalendar({ ...hub, crd49_meetinglink: 'javascript:alert(1)' }, primary.id), /meeting link is invalid/);
  assert.equal(requests.length, 0);
});

test('unsafe Outlook item links are not rendered as success', async () => {
  events = [{ ...saved, webLink: 'javascript:alert(1)' }];
  await assert.rejects(findOutlookEvent(primary.id, hubId), /unsafe appointment link/);
});

test('malformed creation responses are treated as unknown, not as success', async () => {
  intercept = ({ method }) => method === 'POST' ? { success: true, data: {} } : undefined;
  await assert.rejects(addToOutlookCalendar(hub, primary.id), OutlookCreationUncertainError);
  assert.equal(posts().length, 1);
});
