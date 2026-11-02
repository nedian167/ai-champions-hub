import { formatDate, toDateTimeInput } from './format';

export type EventSchedule = { crd49_eventdate: string; abs_eventend?: string | null };
export type EventScheduleForm = { date: string; startTime: string; endTime: string; endDate: string; multiDay: boolean };

function instant(value: string, label: string): number {
  const time = Date.parse(value);
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(time)) throw new Error(`The event ${label} is invalid.`);
  return time;
}

export function getEventSchedule(event: EventSchedule): { start: string; end: string } {
  const start = instant(event.crd49_eventdate, 'start date/time');
  if (!event.abs_eventend) {
    throw new Error('This event has no end date/time. Ask a program manager or app admin to edit the event and set its end time before adding it to Outlook.');
  }
  const end = instant(event.abs_eventend, 'end date/time');
  if (end <= start) throw new Error('The event end date/time must be after its start. Ask a program manager or app admin to correct the event.');
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

export function eventScheduleForm(event: EventSchedule): EventScheduleForm {
  const start = toDateTimeInput(event.crd49_eventdate);
  const end = toDateTimeInput(event.abs_eventend);
  return {
    date: start.slice(0, 10), startTime: start.slice(11), endTime: end.slice(11),
    endDate: end.slice(0, 10),
    multiDay: !!end && start.slice(0, 10) !== end.slice(0, 10),
  };
}

function localInstant(date: string, time: string, original?: string | null): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error('Date, Start time, and End time are required. Multi-day events also need an End date.');
  }
  const local = `${date}T${time}`;
  if (original && toDateTimeInput(original) === local) {
    instant(original, 'date/time');
    return new Date(original).toISOString();
  }
  const parsed = new Date(local);
  if (!Number.isFinite(parsed.getTime()) || toDateTimeInput(parsed.toISOString()) !== local) {
    throw new Error('Choose a valid local date and time. This time may not exist because the clocks change for daylight saving.');
  }
  return parsed.toISOString();
}

export function buildEventSchedule(form: EventScheduleForm, original?: EventSchedule): { start: string; end: string } {
  if (form.multiDay && (!form.endDate || form.endDate <= form.date)) {
    throw new Error('For a multi-day event, End date must be after Date. Use Single-day for events on the same date.');
  }
  const start = localInstant(form.date, form.startTime, original?.crd49_eventdate);
  const end = localInstant(form.multiDay ? form.endDate : form.date, form.endTime, original?.abs_eventend);
  if (Date.parse(end) <= Date.parse(start)) {
    throw new Error('End time must be after Start time. For an overnight event, select Multi-day and set the End date.');
  }
  return { start, end };
}

export function eventOccursOnDate(event: EventSchedule, day: Date): boolean {
  const start = Date.parse(event.crd49_eventdate);
  if (!Number.isFinite(start)) return false;
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const until = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const end = event.abs_eventend ? Date.parse(event.abs_eventend) : NaN;
  // Legacy records have only a known start; do not invent a duration for their calendar placement.
  return start < until && (Number.isFinite(end) && end > start ? end > from : start >= from);
}

export function eventHasNotEnded(event: EventSchedule, cutoff: number): boolean {
  const start = Date.parse(event.crd49_eventdate);
  const end = event.abs_eventend ? Date.parse(event.abs_eventend) : NaN;
  return Number.isFinite(start) && (Number.isFinite(end) && end > start ? end : start) >= cutoff;
}

export function formatEventTime(value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not set';
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

export function formatEventSchedule(event: EventSchedule): string {
  const form = eventScheduleForm(event);
  const dates = form.multiDay ? `${formatDate(event.crd49_eventdate)} - ${formatDate(event.abs_eventend)}` : formatDate(event.crd49_eventdate);
  return `${dates} | ${formatEventTime(event.crd49_eventdate)} - ${formatEventTime(event.abs_eventend)}`;
}
