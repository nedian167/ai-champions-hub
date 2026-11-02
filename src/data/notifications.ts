import { getClient } from '@microsoft/power-apps/data';
import { dataSourcesInfo } from '../../.power/schemas/appschemas/dataSourcesInfo';
import { readNotificationSettings, type NotificationSettings } from '../lib/notifications';

const client = getClient(dataSourcesInfo);
const preferences = 'abs_notificationpreferences';

export interface NotificationPreference extends NotificationSettings {
  abs_notificationpreferenceid: string;
  abs_entraobjectid: string;
}

export interface NotificationDelivery {
  abs_notificationdeliveryid: string;
  abs_name: string;
  abs_channel: number;
  abs_state: number;
  abs_error?: string;
  createdon?: string;
  abs_senton?: string;
}

function objectIdFilter(id: string): string {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Sign in through Power Apps to manage your notifications.');
  }
  return id.toLowerCase();
}

export async function loadNotificationPreferences(objectId: string): Promise<NotificationPreference | null> {
  const result = await client.retrieveMultipleRecordsAsync<NotificationPreference>(preferences, {
    filter: `abs_entraobjectid eq '${objectIdFilter(objectId)}'`,
    top: 2,
  });
  if (!result.success || !result.data) throw new Error(result.error?.message ?? 'Could not load notification preferences.');
  if (result.data.length > 1) throw new Error('Multiple notification preferences match your identity. Ask an administrator to resolve them.');
  const record = result.data[0];
  if (!record) return null;
  return { ...record, ...readNotificationSettings(record) };
}

export async function saveNotificationPreferences(objectId: string, recordId: string | undefined, changes: NotificationSettings): Promise<NotificationPreference> {
  objectIdFilter(objectId);
  const settings = readNotificationSettings(changes);
  const result = recordId
    ? await client.updateRecordAsync<NotificationSettings, NotificationPreference>(preferences, recordId, settings)
    : await client.createRecordAsync<NotificationSettings & { abs_name: string }, NotificationPreference>(preferences, {
      abs_name: 'Notification preferences',
      ...settings,
    });
  if (!result.success) throw new Error(result.error?.message ?? 'Could not save notification preferences. Refresh before retrying.');
  const saved = await loadNotificationPreferences(objectId);
  if (!saved) throw new Error('Preferences were submitted but could not be read back. Refresh to confirm the saved values.');
  return saved;
}

export async function loadNotificationDeliveries(objectId: string): Promise<NotificationDelivery[]> {
  const result = await client.retrieveMultipleRecordsAsync<NotificationDelivery>('abs_notificationdeliveries', {
    filter: `abs_recipientobjectid eq '${objectIdFilter(objectId)}'`,
    orderBy: ['createdon desc'],
    top: 25,
    select: ['abs_notificationdeliveryid', 'abs_name', 'abs_channel', 'abs_state', 'abs_error', 'createdon', 'abs_senton'],
  });
  if (!result.success || !result.data) throw new Error(result.error?.message ?? 'Could not load your notification delivery history.');
  return result.data;
}
