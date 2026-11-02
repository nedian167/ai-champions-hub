export const notificationCategories = [
  { field: 'abs_requests', label: 'Requests', description: 'Replies and status changes; new requests and requester replies for reviewers.' },
  { field: 'abs_claims', label: 'Activity claims', description: 'Approval results; new claims awaiting approval for reviewers.' },
  { field: 'abs_campaigns', label: 'Campaign launches', description: 'Newly launched campaigns available to you.' },
  { field: 'abs_reminders', label: 'Daily reminders', description: 'Pending reviews after 48 hours, joined campaigns ending within 7 days, and relevant events within 24 hours.' },
] as const;

export type NotificationChannel = 0 | 1 | 2 | 3;
export type NotificationCategory = typeof notificationCategories[number]['field'];
export type NotificationSettings = Record<NotificationCategory, NotificationChannel> & { abs_paused: boolean };

export const notificationChannels: { value: NotificationChannel; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 1, label: 'Teams' },
  { value: 2, label: 'Email' },
  { value: 3, label: 'Teams and email' },
];

export const defaultNotificationSettings: NotificationSettings = {
  abs_requests: 0, abs_claims: 0, abs_campaigns: 0, abs_reminders: 0, abs_paused: false,
};

export function readNotificationSettings(record: Partial<Record<NotificationCategory | 'abs_paused', unknown>>): NotificationSettings {
  const result = { ...defaultNotificationSettings };
  for (const { field } of notificationCategories) {
    const channel = record[field];
    if (channel !== 0 && channel !== 1 && channel !== 2 && channel !== 3) {
      throw new Error(`The saved ${field.replace('abs_', '')} channel is invalid. Ask an administrator to repair your notification preferences.`);
    }
    result[field] = channel;
  }
  if (typeof record.abs_paused !== 'boolean') throw new Error('The saved notification pause setting is invalid.');
  result.abs_paused = record.abs_paused;
  return result;
}

export const deliveryStatus: Record<number, string> = {
  0: 'Queued', 1: 'Sending', 2: 'Sent', 3: 'Failed', 4: 'Unconfirmed - review needed', 5: 'Skipped',
};

export function notificationLaunch(params: Record<string, string>): { route: string | null; error: string | null } {
  const target = params.hubTarget;
  const id = params.hubId;
  if (!target && !id) return { route: null, error: null };
  if (!id || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    return { route: '/notifications', error: 'This notification link has an invalid or missing record ID.' };
  }
  const routes: Record<string, string> = {
    request: `/requests?requestId=${id.toLowerCase()}`,
    claim: `/activities?claimId=${id.toLowerCase()}`,
    campaign: `/campaigns/${id.toLowerCase()}`,
    event: `/events?eventId=${id.toLowerCase()}`,
  };
  if (!Object.hasOwn(routes, target)) return { route: '/notifications', error: 'This notification link has an unsupported destination.' };
  return { route: routes[target], error: null };
}
