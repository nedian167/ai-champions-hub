export const templateKinds = [
  ['request.created', 'New request'], ['request.reply.admin', 'Reply to your request'],
  ['request.reply.user', 'Requester reply'], ['request.status', 'Request status changed'],
  ['claim.created', 'New activity claim'], ['claim.approved', 'Claim approved'],
  ['claim.rejected', 'Claim rejected'], ['campaign.launched', 'Campaign launched'],
  ['remind-request', 'Request reminder'], ['remind-claim', 'Claim reminder'],
  ['remind-campaign', 'Campaign reminder'], ['remind-event', 'Upcoming event'],
] as const;
export type TemplateKind = typeof templateKinds[number][0];
export interface NotificationTemplate {
  kind: TemplateKind;
  heading: string;
  subject: string;
  message: string;
  actionLabel: string;
  fields: string[];
  includeMeetingLink: boolean;
}
export interface TemplateConfiguration { version: 1; templates: NotificationTemplate[] }
export const fieldLabels: Record<string, string> = {
  Requester: 'Requester', Category: 'Category', Status: 'Status', Description: 'Description excerpt',
  Reply: 'Reply excerpt', Activity: 'Activity', Claimant: 'Claimant', Points: 'Activity points',
  Campaign: 'Campaign', CampaignStart: 'Campaign start (UTC)', CampaignEnd: 'Campaign end (UTC)',
  EventStart: 'Start (UTC)', EventEnd: 'End (UTC)', Location: 'Location', Format: 'Format',
};
export function fieldsFor(kind: TemplateKind): string[] {
  if (kind.startsWith('request.') || kind === 'remind-request') {
    return ['Requester', 'Category', 'Status', 'Description', ...(kind.startsWith('request.reply.') ? ['Reply'] : [])];
  }
  if (kind.startsWith('claim.') || kind === 'remind-claim') return ['Activity', 'Claimant', 'Campaign', 'Points', 'Status'];
  if (kind === 'remind-event') return ['EventStart', 'EventEnd', 'Location', 'Format', 'Campaign', 'Description'];
  return ['CampaignStart', 'CampaignEnd', 'Description'];
}
export function defaultTemplate(kind: TemplateKind): NotificationTemplate {
  return {
    kind, heading: templateKinds.find(([key]) => key === kind)![1], subject: 'AI Champions Hub: {Title}',
    message: '{Summary}', actionLabel: kind === 'remind-event' ? 'View event'
      : kind.startsWith('request.') || kind === 'remind-request' ? 'View request'
      : kind.startsWith('claim.') || kind === 'remind-claim' ? 'View claim' : 'View campaign',
    fields: fieldsFor(kind).filter((field) => field !== 'Description' && field !== 'Reply'),
    includeMeetingLink: false,
  };
}
export function validateTemplate(value: unknown): NotificationTemplate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid notification template.');
  const data = value as Record<string, unknown>;
  const kind = templateKinds.find(([key]) => key === data.kind)?.[0];
  if (!kind) throw new Error('Unknown notification type.');
  const allowedKeys = ['kind', 'heading', 'subject', 'message', 'actionLabel', 'fields', 'includeMeetingLink'];
  if (Object.keys(data).some((key) => !allowedKeys.includes(key))) throw new Error('Unsupported template property.');
  const fields = data.fields;
  if (!Array.isArray(fields) || fields.some((field) => typeof field !== 'string' || !fieldsFor(kind).includes(field))
      || new Set(fields).size !== fields.length) throw new Error('Invalid or duplicate template detail fields.');
  if (typeof data.includeMeetingLink !== 'boolean' || (data.includeMeetingLink && kind !== 'remind-event')) {
    throw new Error('Join meeting is supported only for event reminders.');
  }
  const allowedTokens = ['Title', 'Summary', ...fieldsFor(kind)];
  const text: Record<string, string> = {};
  for (const [key, max] of [['heading', 120], ['subject', 200], ['message', 1200], ['actionLabel', 40]] as const) {
    const input = data[key];
    if (typeof input !== 'string' || !input.trim() || input.length > max || Array.from(input).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    })
        || (key !== 'message' && /[\r\n]/.test(input))) throw new Error(`${key} must contain 1-${max} characters${key !== 'message' ? ' on one line' : ''}.`);
    const remainder = input.replace(/\{([A-Za-z]+)\}/g, (_, token: string) => {
      if (!allowedTokens.includes(token)) throw new Error(`Unsupported placeholder {${token}} for this notification.`);
      if ((token === 'Description' || token === 'Reply') && !fields.includes(token)) {
        throw new Error(`Select ${fieldLabels[token]} before using {${token}}.`);
      }
      return '';
    });
    if (/[{}]/.test(remainder)) throw new Error('Malformed placeholder. Use a supported {FieldName}.');
    text[key] = input;
  }
  return { kind, heading: text.heading, subject: text.subject, message: text.message,
    actionLabel: text.actionLabel, fields: [...fields], includeMeetingLink: data.includeMeetingLink };
}
export function readTemplateConfiguration(raw: string | null | undefined): TemplateConfiguration {
  if (raw === null || raw === undefined || raw === '') return { version: 1, templates: [] };
  if (typeof raw !== 'string' || raw.length > 50000) throw new Error('Invalid template configuration size.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Notification templates contain invalid JSON. Ask an administrator to repair them.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid template configuration.');
  const config = value as Record<string, unknown>;
  if (config.version !== 1 || !Array.isArray(config.templates) || config.templates.length > templateKinds.length
      || Object.keys(config).some((key) => !['version', 'templates'].includes(key))) throw new Error('Unsupported template configuration.');
  const templates = config.templates.map(validateTemplate);
  if (new Set(templates.map((item) => item.kind)).size !== templates.length) throw new Error('Duplicate notification templates.');
  return { version: 1, templates };
}
export function expandTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{([A-Za-z]+)\}/g, (_, key: string) => values[key] ?? '');
}
export const previewValues: Record<string, string> = {
  Title: 'Copilot enablement workshop', Summary: 'An update is available. Open the Hub for details.',
  Requester: 'Demo requester', Category: 'License request', Status: 'In review',
  Description: 'Illustrative description excerpt. No tenant data is loaded in this preview.',
  Reply: 'Illustrative reply excerpt.', Activity: 'Complete the Copilot workshop', Claimant: 'Demo champion',
  Points: '50', Campaign: 'AI adoption campaign', CampaignStart: '2026-11-01 09:00 UTC',
  CampaignEnd: '2026-11-30 17:00 UTC', EventStart: '2026-11-10 09:00 UTC',
  EventEnd: '2026-11-10 10:30 UTC', Location: 'Online', Format: 'Virtual',
};
