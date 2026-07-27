/**
 * Campaign lifecycle helpers.
 *
 * The Dataverse `crd49_status` choice only has Draft / Active / Completed — the
 * schema is fixed and we cannot add an "Expired" option. So expiry is *derived*
 * from the end date rather than stored: an Active campaign whose end date has
 * passed is treated as auto-deactivated ("Expired") everywhere in the UI.
 *
 * Because this is computed (not persisted), reactivation is automatic — an admin
 * simply extends `crd49_enddate` into the future and the campaign becomes Active
 * again, with no separate status write and no risk of stale data.
 */
import { CampaignStatus } from './enums';
import type { PillColor } from '../components/ui';

export type EffectiveCampaignStatus = 'draft' | 'active' | 'expired' | 'completed';

type CampaignLike = { crd49_status: number; crd49_enddate?: string | null };

/** Timestamp for the very end of the end-date's calendar day (local time). */
function endOfDayMs(iso: string): number {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return Number.POSITIVE_INFINITY;
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * True when an Active campaign's end date has passed — it is auto-deactivated.
 * Draft and Completed campaigns are never "expired" (their end date is moot).
 */
export function isCampaignExpired(c: CampaignLike, now: number = Date.now()): boolean {
  return (
    c.crd49_status === CampaignStatus.Active &&
    !!c.crd49_enddate &&
    endOfDayMs(c.crd49_enddate) < now
  );
}

/** The status to display, folding auto-expiry into the stored choice. */
export function effectiveCampaignStatus(c: CampaignLike, now: number = Date.now()): EffectiveCampaignStatus {
  if (isCampaignExpired(c, now)) return 'expired';
  switch (c.crd49_status) {
    case CampaignStatus.Draft:
      return 'draft';
    case CampaignStatus.Completed:
      return 'completed';
    case CampaignStatus.Active:
    default:
      return 'active';
  }
}

/** True when the campaign is live and interactive (Active and not expired). */
export function isCampaignLive(c: CampaignLike, now: number = Date.now()): boolean {
  return effectiveCampaignStatus(c, now) === 'active';
}

export const effectiveStatusLabel: Record<EffectiveCampaignStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  expired: 'Expired',
  completed: 'Completed',
};

export function effectiveStatusColor(s: EffectiveCampaignStatus): PillColor {
  switch (s) {
    case 'active':
      return 'green';
    case 'completed':
      return 'blue';
    case 'expired':
      return 'amber';
    case 'draft':
    default:
      return 'gray';
  }
}
