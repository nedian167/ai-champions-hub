import { OutlookSvc, type Abs_events } from '../data/entities';
import { getEventSchedule } from './eventSchedule';

type HubEvent = Pick<Abs_events, 'abs_eventid' | 'abs_name' | 'crd49_eventdate' | 'abs_eventend' | 'crd49_description' | 'crd49_location' | 'crd49_meetinglink'>;
export type OutlookCalendar = { id: string; name: string; ownerAddress: string; isDefault: boolean };
export type OutlookEvent = { id: string; subject: string; webLink?: string };
export type CalendarAddResult = { event: OutlookEvent; status: 'added' | 'already-added' | 'recovered' };

const graphRoot = 'https://graph.microsoft.com/v1.0/me';
const calendarFields = 'id,name,owner,canEdit,isDefaultCalendar';
const sourceProperty = 'String {f34d6d4f-dfb8-49ef-85f4-4d60a077b0b7} Name AIChampionsHubEventId';
const pendingAdds = new Map<string, Promise<CalendarAddResult>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function outlookErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return 'The Outlook connector returned an unexpected error. Check your connection and permissions.';
}

function sourceId(id: string): string {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('This Hub event has an invalid ID. Reload Events before trying again.');
  }
  return id.toLowerCase();
}

function calendarPath(id: string): string {
  if (!id.trim()) throw new Error('Select an Outlook calendar.');
  return `${graphRoot}/calendars/${encodeURIComponent(id)}`;
}

async function graphRequest(uri: string, method: 'GET' | 'POST' = 'GET', body?: object): Promise<unknown> {
  // The generated binary-string argument is raw UTF-8 JSON, not base64.
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const request = OutlookSvc.HttpRequest(uri, method, body ? JSON.stringify(body) : undefined, 'application/json');
  const result = await Promise.race([
    request,
    new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(new Error('Outlook did not respond within 30 seconds. Check your connection and permissions.')), 30_000);
    }),
  ]).finally(() => clearTimeout(deadline));
  if (!result.success) throw new Error(`Outlook request failed: ${outlookErrorMessage(result.error)}`);
  const data: unknown = result.data;
  if (isRecord(data) && 'error' in data) throw new Error(`Outlook request failed: ${outlookErrorMessage(data.error)}`);
  if (!isRecord(data)) {
    throw new Error('Outlook returned an invalid response. Check your Outlook connection and try again.');
  }
  return data;
}

async function collection(uri: string): Promise<unknown[]> {
  const original = new URL(uri);
  const visited = new Set<string>();
  const rows: unknown[] = [];
  let next: string | undefined = uri;
  while (next) {
    const url = new URL(next);
    if (url.origin !== original.origin || url.pathname !== original.pathname || url.username || url.password || url.hash) {
      throw new Error('Outlook returned an unexpected pagination URL. Cannot safely complete the calendar check.');
    }
    if (visited.has(url.href)) throw new Error('Outlook repeated a results page. Cannot safely complete the calendar check.');
    visited.add(url.href);
    const data = await graphRequest(url.href);
    if (!isRecord(data) || !Array.isArray(data.value)) throw new Error('Outlook returned an invalid results page.');
    rows.push(...data.value);
    const link: unknown = data['@odata.nextLink'];
    if (link !== undefined && (typeof link !== 'string' || !link)) throw new Error('Outlook returned invalid pagination information.');
    next = link;
  }
  return rows;
}

function calendar(value: unknown): OutlookCalendar & { canEdit: boolean } {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !value.name ||
      typeof value.canEdit !== 'boolean' || typeof value.isDefaultCalendar !== 'boolean' ||
      !isRecord(value.owner) || typeof value.owner.address !== 'string' || !value.owner.address.trim()) {
    throw new Error('Outlook did not identify the calendar owner or editing permissions. Reconnect Outlook before continuing.');
  }
  return {
    id: value.id, name: value.name, ownerAddress: value.owner.address.trim(),
    canEdit: value.canEdit, isDefault: value.isDefaultCalendar,
  };
}

export async function listOutlookCalendars(): Promise<OutlookCalendar[]> {
  const primary = calendar(await graphRequest(`${graphRoot}/calendar?$select=${calendarFields}`));
  const rows = await collection(`${graphRoot}/calendars?$select=${calendarFields}`);
  const own = rows.map(calendar).filter((item) =>
    item.canEdit && item.ownerAddress.toLowerCase() === primary.ownerAddress.toLowerCase());
  if (!own.length) throw new Error('No writable personal calendars were found in the connected Outlook mailbox.');
  return own.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

async function verifyOwnCalendar(id: string): Promise<void> {
  const primary = calendar(await graphRequest(`${graphRoot}/calendar?$select=${calendarFields}`));
  const selected = calendar(await graphRequest(`${calendarPath(id)}?$select=${calendarFields}`));
  if (selected.id !== id || !selected.canEdit || selected.ownerAddress.toLowerCase() !== primary.ownerAddress.toLowerCase()) {
    throw new Error('Choose a writable calendar owned by the connected Outlook account. Shared and delegated calendars are not supported.');
  }
}

function outlookEvent(value: unknown): OutlookEvent {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.subject !== 'string') {
    throw new Error('Outlook did not return a valid appointment. Check Outlook before trying again.');
  }
  let webLink: string | undefined;
  if (value.webLink !== undefined) {
    if (typeof value.webLink !== 'string' || !URL.canParse(value.webLink)) throw new Error('Outlook returned an invalid appointment link.');
    const url = new URL(value.webLink);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Outlook returned an unsafe appointment link.');
    webLink = url.href;
  }
  return { id: value.id, subject: value.subject, webLink };
}

export async function findOutlookEvent(calendarId: string, hubEventId: string): Promise<OutlookEvent | null> {
  const query = new URLSearchParams({
    '$filter': `singleValueExtendedProperties/Any(ep: ep/id eq '${sourceProperty}' and ep/value eq '${sourceId(hubEventId)}')`,
    '$select': 'id,subject,webLink',
  });
  const rows = await collection(`${calendarPath(calendarId)}/events?${query}`);
  if (rows.length > 1) throw new Error('Multiple Outlook copies of this Hub event exist. Review them in Outlook before continuing.');
  return rows.length ? outlookEvent(rows[0]) : null;
}

async function transactionId(eventId: string, calendarId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${sourceProperty}|${eventId}|${calendarId}`));
  const hex = Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class OutlookCreationUncertainError extends Error {
  constructor(detail: string) {
    super(`Outlook could not confirm whether the appointment was created. It may already exist. Check its status or review Outlook before retrying. ${detail}`);
    this.name = 'OutlookCreationUncertainError';
  }
}

async function performAdd(event: HubEvent, calendarId: string): Promise<CalendarAddResult> {
  const id = sourceId(event.abs_eventid);
  const { start, end } = getEventSchedule(event);
  if (!event.abs_name.trim()) throw new Error('The Hub event needs a title before it can be added to Outlook.');
  const meetingLink = event.crd49_meetinglink?.trim();
  if (meetingLink) {
    if (!URL.canParse(meetingLink) || !['https:', 'http:'].includes(new URL(meetingLink).protocol) ||
        new URL(meetingLink).username || new URL(meetingLink).password) {
      throw new Error('The Hub meeting link is invalid. Ask a program admin to correct it before adding this event.');
    }
  }
  await verifyOwnCalendar(calendarId);
  const existing = await findOutlookEvent(calendarId, id);
  if (existing) return { event: existing, status: 'already-added' };
  const item = {
    subject: event.abs_name.trim(),
    start: { dateTime: start.slice(0, -1), timeZone: 'UTC' },
    end: { dateTime: end.slice(0, -1), timeZone: 'UTC' },
    body: {
      contentType: 'text',
      content: [
        event.crd49_description?.trim(), meetingLink ? `Meeting link: ${meetingLink}` : '',
        'Personal copy from AI Champions Hub. Changes and cancellations are not synchronized.',
      ].filter(Boolean).join('\n\n'),
    },
    location: { displayName: event.crd49_location?.trim() || (meetingLink ? 'Online' : '') },
    singleValueExtendedProperties: [{ id: sourceProperty, value: id }],
    transactionId: await transactionId(id, calendarId),
  };
  try {
    const created = outlookEvent(await graphRequest(`${calendarPath(calendarId)}/events`, 'POST', item));
    return { event: created, status: 'added' };
  } catch (writeError) {
    // A timed-out POST may have succeeded. Recover by the durable Outlook marker; never blindly repeat a write.
    let recovered: OutlookEvent | null;
    try {
      recovered = await findOutlookEvent(calendarId, id);
    } catch (checkError) {
      throw new OutlookCreationUncertainError(`Creation: ${outlookErrorMessage(writeError)} Status check: ${outlookErrorMessage(checkError)}`);
    }
    if (recovered) return { event: recovered, status: 'recovered' };
    throw new OutlookCreationUncertainError(outlookErrorMessage(writeError));
  }
}

export function addToOutlookCalendar(event: HubEvent, calendarId: string): Promise<CalendarAddResult> {
  const key = JSON.stringify([event.abs_eventid.toLowerCase(), calendarId]);
  const pending = pendingAdds.get(key);
  if (pending) return pending;
  const operation = performAdd(event, calendarId).finally(() => pendingAdds.delete(key));
  pendingAdds.set(key, operation);
  return operation;
}
