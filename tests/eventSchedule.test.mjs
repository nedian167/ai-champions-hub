import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const originalTimeZone = process.env.TZ;
process.env.TZ = 'America/New_York';
after(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

const bundle = await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    write: false,
    minify: false,
    lib: { entry: fileURLToPath(new URL('../src/lib/eventSchedule.ts', import.meta.url)), formats: ['es'] },
  },
});
const code = (Array.isArray(bundle) ? bundle : [bundle])
  .flatMap((result) => result.output).find((output) => output.type === 'chunk').code;
assert.ok(!code.includes('powerAppsBridge'));
const { buildEventSchedule, eventScheduleForm, eventOccursOnDate, eventHasNotEnded, getEventSchedule, formatEventTime, formatEventSchedule } =
  await import(`data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=event-schedule-test-module.mjs`).toString('base64')}`);

const single = { date: '2026-11-10', startTime: '10:00', endTime: '11:15', endDate: '', multiDay: false };
const event = { crd49_eventdate: '2026-11-10T15:00:00Z', abs_eventend: '2026-11-10T16:15:00Z' };
const localDay = (year, month, day) => new Date(year, month - 1, day, 12);

test('single-day fields persist both instants using the local timezone exactly once', () => {
  assert.deepEqual(buildEventSchedule(single), { start: '2026-11-10T15:00:00.000Z', end: '2026-11-10T16:15:00.000Z' });
});

test('single-day schedules ignore a stale hidden end date from a previous multi-day selection', () => {
  assert.deepEqual(buildEventSchedule({ ...single, endDate: '2026-11-13' }), buildEventSchedule(single));
});

test('multi-day selection requires and persists a later end date', () => {
  const result = buildEventSchedule({ ...single, startTime: '23:30', endTime: '01:15', endDate: '2026-11-12', multiDay: true });
  assert.deepEqual(result, { start: '2026-11-11T04:30:00.000Z', end: '2026-11-12T06:15:00.000Z' });
});

for (const endDate of ['', '2026-11-09', '2026-11-10']) {
  test(`multi-day end date ${endDate || '(missing)'} is not silently inferred`, () => {
    assert.throws(() => buildEventSchedule({ ...single, endDate, multiDay: true }), /End date must be after Date/);
  });
}

for (const change of [
  { date: '' }, { startTime: '' }, { endTime: '' }, { startTime: '24:00' },
  { endTime: '10:00' }, { endTime: '09:59' }, { date: '2026-02-30' },
]) {
  test(`invalid or incomplete fields ${JSON.stringify(change)} cannot be saved`, () => {
    assert.throws(() => buildEventSchedule({ ...single, ...change }));
  });
}

test('an overnight time does not silently roll forward unless Multi-day is selected', () => {
  assert.throws(() => buildEventSchedule({ ...single, startTime: '23:00', endTime: '01:00' }), /select Multi-day/);
});

test('editing a single-day event reconstructs separate Date, Start time and End time', () => {
  assert.deepEqual(eventScheduleForm(event), { ...single, endDate: '2026-11-10' });
  assert.deepEqual(buildEventSchedule(eventScheduleForm(event), event), getEventSchedule(event));
});

test('editing a multi-day event restores its selector and end date', () => {
  const multi = { ...event, abs_eventend: '2026-11-12T16:15:00Z' };
  assert.deepEqual(eventScheduleForm(multi), { ...single, multiDay: true, endDate: '2026-11-12' });
  assert.deepEqual(buildEventSchedule(eventScheduleForm(multi), multi), getEventSchedule(multi));
});

test('legacy events retain their known start and do not invent an end', () => {
  const legacy = { crd49_eventdate: event.crd49_eventdate };
  assert.deepEqual(eventScheduleForm(legacy), { ...single, endTime: '', endDate: '' });
  assert.throws(() => getEventSchedule(legacy), /Ask a program manager or app admin/);
  assert.throws(() => buildEventSchedule(eventScheduleForm(legacy), legacy));
  assert.match(formatEventSchedule(legacy), /Not set/);
});

test('legacy events appear only on the known start day', () => {
  const legacy = { crd49_eventdate: event.crd49_eventdate };
  assert.equal(eventOccursOnDate(legacy, localDay(2026, 11, 9)), false);
  assert.equal(eventOccursOnDate(legacy, localDay(2026, 11, 10)), true);
  assert.equal(eventOccursOnDate(legacy, localDay(2026, 11, 11)), false);
});

test('multi-day calendar placement includes every overlapping local date across a month boundary', () => {
  const multi = { crd49_eventdate: '2026-10-30T23:00:00-04:00', abs_eventend: '2026-11-03T02:00:00-05:00' };
  assert.equal(eventOccursOnDate(multi, localDay(2026, 10, 29)), false);
  for (const [month, day] of [[10, 30], [10, 31], [11, 1], [11, 2], [11, 3]]) {
    assert.equal(eventOccursOnDate(multi, localDay(2026, month, day)), true);
  }
  assert.equal(eventOccursOnDate(multi, localDay(2026, 11, 4)), false);
});

test('an event ending exactly at midnight does not occupy the following day', () => {
  const overnight = { crd49_eventdate: '2026-11-10T20:00:00-05:00', abs_eventend: '2026-11-12T00:00:00-05:00' };
  assert.equal(eventOccursOnDate(overnight, localDay(2026, 11, 11)), true);
  assert.equal(eventOccursOnDate(overnight, localDay(2026, 11, 12)), false);
});

test('ongoing multi-day events remain upcoming until their known end, not just their start', () => {
  const multi = { ...event, abs_eventend: '2026-11-13T16:15:00Z' };
  assert.equal(eventHasNotEnded(multi, Date.parse('2026-11-12T10:00:00Z')), true);
  assert.equal(eventHasNotEnded(multi, Date.parse('2026-11-14T10:00:00Z')), false);
});

test('legacy upcoming classification uses the existing known start without a fabricated end', () => {
  assert.equal(eventHasNotEnded({ crd49_eventdate: event.crd49_eventdate }, Date.parse('2026-11-09T15:00:00Z')), true);
  assert.equal(eventHasNotEnded({ crd49_eventdate: event.crd49_eventdate }, Date.parse('2026-11-11T15:00:00Z')), false);
});

test('nonexistent spring-forward local times are rejected instead of shifted silently', () => {
  assert.throws(() => buildEventSchedule({ ...single, date: '2026-03-08', startTime: '02:30', endTime: '04:00' }), /may not exist/);
});

test('spring-forward schedules preserve actual elapsed time between selected clock times', () => {
  const result = buildEventSchedule({ ...single, date: '2026-03-08', startTime: '01:30', endTime: '03:30' });
  assert.equal(Date.parse(result.end) - Date.parse(result.start), 60 * 60_000);
});

test('unchanged ambiguous fall-back instants are preserved during edits, including hidden seconds', () => {
  const overlap = { crd49_eventdate: '2026-11-01T01:30:17-04:00', abs_eventend: '2026-11-01T01:30:29-05:00' };
  assert.deepEqual(buildEventSchedule(eventScheduleForm(overlap), overlap), getEventSchedule(overlap));
  assert.notEqual(formatEventTime(overlap.crd49_eventdate), formatEventTime(overlap.abs_eventend));
});

test('invalid saved instants or reversed endpoints cannot be copied to Outlook', () => {
  for (const item of [
    { ...event, crd49_eventdate: 'bad' },
    { ...event, abs_eventend: '2026-11-10T16:15' },
    { ...event, abs_eventend: event.crd49_eventdate },
    { ...event, abs_eventend: '2026-11-09T16:15:00Z' },
  ]) assert.throws(() => getEventSchedule(item));
});
