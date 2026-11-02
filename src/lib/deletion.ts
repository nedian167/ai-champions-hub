import type { IOperationResult } from '@microsoft/power-apps/data';
import type { IGetAllOptions } from '../generated/models/CommonModels';
import {
  ActivitiesSvc, ActivityClaimsSvc, CampaignActivitiesSvc, CampaignDepartmentsSvc,
  CampaignParticipationsSvc, EventsSvc,
  type Abs_activities, type Abs_activityclaims, type Abs_campaignactivities,
} from '../data/entities';

export type RecordKind = 'campaign' | 'activity' | 'event';

export interface ActivityDeletionImpact {
  activity: Abs_activities;
  links: Abs_campaignactivities[];
  claims: Abs_activityclaims[];
}

export interface DeletionPreview {
  activities: ActivityDeletionImpact[];
  blockers: string[];
}

function validateId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Invalid record ID.');
  }
}

async function linkedRecords<T>(
  read: (options: IGetAllOptions) => Promise<IOperationResult<T[]>>,
  filter: string,
): Promise<T[]> {
  const rows: T[] = [];
  const seenTokens = new Set<string>();
  let skipToken: string | undefined;
  do {
    const result = await read({ filter, maxPageSize: 500, skipToken });
    if (!result.success || !result.data) {
      throw new Error(result.error?.message ?? 'Could not check linked records. Deletion is blocked.');
    }
    rows.push(...result.data);
    skipToken = result.skipToken;
    if (skipToken && seenTokens.has(skipToken)) {
      throw new Error('Could not read all linked records. Deletion is blocked.');
    }
    if (skipToken) seenTokens.add(skipToken);
  } while (skipToken);
  return rows;
}

export async function inspectActivityDeletion(id: string): Promise<ActivityDeletionImpact> {
  validateId(id);
  const filter = `_crd49_activity_value eq ${id}`;
  const [record, links, claims] = await Promise.all([
    ActivitiesSvc.get(id),
    linkedRecords(CampaignActivitiesSvc.getAll, filter),
    linkedRecords(ActivityClaimsSvc.getAll, filter),
  ]);
  if (!record.success || !record.data) {
    throw new Error(record.error?.message ?? 'Could not read the activity. Deletion is blocked.');
  }
  return { activity: record.data, links, claims };
}

export async function inspectDeletion(kind: RecordKind, id: string): Promise<DeletionPreview> {
  validateId(id);
  if (kind === 'event') return { activities: [], blockers: [] };
  if (kind === 'activity') {
    return { activities: [await inspectActivityDeletion(id)], blockers: [] };
  }
  const filter = `_crd49_campaign_value eq ${id}`;
  const checks = [
    { label: 'participants', result: CampaignParticipationsSvc.getAll({ filter, top: 1 }) },
    { label: 'claims', result: ActivityClaimsSvc.getAll({ filter, top: 1 }) },
    { label: 'events', result: EventsSvc.getAll({ filter, top: 1 }) },
    { label: 'audience departments', result: CampaignDepartmentsSvc.getAll({ filter: `_abs_campaign_value eq ${id}`, top: 1 }) },
  ];
  const [links, blockers] = await Promise.all([
    linkedRecords(CampaignActivitiesSvc.getAll, filter),
    Promise.all(checks.map(async ({ label, result }) => {
      const response = await result;
      if (!response.success || !response.data) {
        throw new Error(response.error?.message ?? `Could not check linked ${label}. Deletion is blocked.`);
      }
      return response.data.length ? label : null;
    })),
  ]);
  const activityIds = new Set<string>();
  for (const link of links) {
    if (!link._crd49_activity_value) {
      throw new Error('A campaign link has no readable activity. Ask a Dataverse administrator to repair it.');
    }
    activityIds.add(link._crd49_activity_value);
  }
  const activities: ActivityDeletionImpact[] = [];
  for (const activityId of activityIds) {
    activities.push(await inspectActivityDeletion(activityId));
  }
  return { activities, blockers: blockers.filter((label): label is string => label !== null) };
}

function linkSignature(impact: ActivityDeletionImpact) {
  return impact.links.map((link) => `${link.abs_campaignactivityid}:${link._crd49_campaign_value}`).sort().join('|');
}

export function assertActivityDeletionUnchanged(
  reviewed: ActivityDeletionImpact,
  current: ActivityDeletionImpact,
) {
  if (current.claims.length) {
    throw new Error(`"${current.activity.abs_title}" has claims and cannot be deleted. Its history and earned points are protected.`);
  }
  if (linkSignature(reviewed) !== linkSignature(current)) {
    throw new Error(`Campaign links for "${current.activity.abs_title}" changed. Review the updated impact before trying again.`);
  }
}

async function assertNoClaims(id: string) {
  const response = await ActivityClaimsSvc.getAll({ filter: `_crd49_activity_value eq ${id}`, top: 1 });
  if (!response.success || !response.data) {
    throw new Error(response.error?.message ?? 'Could not recheck claims. Deletion is blocked.');
  }
  if (response.data.length) {
    throw new Error('A claim now exists. The activity must be kept to protect history and earned points.');
  }
}

export async function deleteUnclaimedActivity(reviewed: ActivityDeletionImpact): Promise<void> {
  const id = reviewed.activity.abs_activityid;
  let removedLinks = 0;
  try {
    const current = await inspectActivityDeletion(id);
    assertActivityDeletionUnchanged(reviewed, current);
    for (const link of current.links) {
      await assertNoClaims(id);
      await CampaignActivitiesSvc.delete(link.abs_campaignactivityid);
      removedLinks++;
    }
    await assertNoClaims(id);
    const remaining = await linkedRecords(CampaignActivitiesSvc.getAll, `_crd49_activity_value eq ${id}`);
    if (remaining.length) {
      throw new Error('New campaign links were found. Review the updated impact before trying again.');
    }
    await ActivitiesSvc.delete(id);
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'Activity deletion failed.';
    const message = `Deletion of "${reviewed.activity.abs_title}" did not complete: ${reason}`;
    throw new Error(removedLinks
      ? `${message} ${removedLinks} campaign link(s) were already removed. Deletion is not transactional. If the activity remains, review it in Activities before retrying; it may no longer be linked to this campaign.`
      : message);
  }
}
