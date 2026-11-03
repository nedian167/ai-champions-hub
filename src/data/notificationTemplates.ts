import { getClient } from '@microsoft/power-apps/data';
import { dataSourcesInfo } from '../../.power/schemas/appschemas/dataSourcesInfo';
import { readTemplateConfiguration, type TemplateConfiguration } from '../lib/notificationTemplates';

const client = getClient(dataSourcesInfo);
const table = 'abs_programsettingses';
interface TemplateSettingsRecord { abs_programsettingsid: string; abs_notificationtemplates?: string | null }
export interface SavedTemplates { id: string; configuration: TemplateConfiguration; raw: string | null }

export async function loadNotificationTemplates(): Promise<SavedTemplates> {
  const response = await client.retrieveMultipleRecordsAsync<TemplateSettingsRecord>(table, {
    select: ['abs_programsettingsid', 'abs_notificationtemplates'], top: 2,
  });
  if (!response.success || !response.data) throw new Error(response.error?.message ?? 'Could not read notification templates. Confirm the template schema is deployed.');
  if (response.data.length !== 1) throw new Error('Exactly one Program Settings record is required to configure notification templates.');
  const record = response.data[0];
  const raw = record.abs_notificationtemplates ?? null;
  return { id: record.abs_programsettingsid, raw, configuration: readTemplateConfiguration(raw) };
}
export async function saveNotificationTemplates(saved: SavedTemplates, configuration: TemplateConfiguration): Promise<SavedTemplates> {
  const raw = JSON.stringify(readTemplateConfiguration(JSON.stringify(configuration)));
  const current = await loadNotificationTemplates();
  if (current.id !== saved.id || current.raw !== saved.raw) {
    throw new Error('Templates changed since you opened the editor. Refresh before saving; your changes were not submitted.');
  }
  const response = await client.updateRecordAsync<{ abs_notificationtemplatecommand: string }, TemplateSettingsRecord>(
    table, saved.id, { abs_notificationtemplatecommand: JSON.stringify({ expected: saved.raw, configuration: raw }) },
  );
  if (!response.success) throw new Error(response.error?.message ?? 'Could not save notification templates.');
  const result = await loadNotificationTemplates();
  if (result.raw !== raw) throw new Error('Template changes were submitted but could not be confirmed. Refresh before retrying.');
  return result;
}
