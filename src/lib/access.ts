/**
 * Access + linkage helpers for the campaign-centric activity model.
 *
 * Architecture rules:
 *  - Every activity is linked to one or more campaigns via the abs_campaignactivity junction.
 *  - A champion can only access (claim) an activity when they have JOINED one of its campaigns
 *    (an abs_campaignparticipation row) AND that campaign is currently live.
 *  - When a campaign is disabled (expired / not live), its activities are treated as disabled
 *    for anyone whose access depended on that campaign.
 */
import type { Abs_activityclaims, Abs_campaignactivities, Abs_campaignparticipations, Abs_campaigns } from '../data/entities';
import { isCampaignLive } from './campaignStatus';
import { ClaimStatus } from './enums';

/**
 * A champion may claim a given activity within a given campaign only once. A claim is
 * "active" (i.e. blocks re-claiming) when it is Pending or Approved. A Rejected claim does
 * NOT block, so a champion can resubmit after a rejection.
 */
export function hasActiveClaim(
  championId: string | undefined,
  activityId: string,
  campaignId: string,
  claims: Abs_activityclaims[],
): boolean {
  if (!championId) return false;
  return claims.some(
    (c) =>
      c._crd49_champion_value === championId &&
      c._crd49_activity_value === activityId &&
      c._crd49_campaign_value === campaignId &&
      (c.crd49_status === ClaimStatus.Pending || c.crd49_status === ClaimStatus.Approved),
  );
}

/** Campaign ids an activity is linked to (via the junction). */
export function campaignIdsForActivity(
  activityId: string,
  campaignActivities: Abs_campaignactivities[],
): string[] {
  return campaignActivities
    .filter((ca) => ca._crd49_activity_value === activityId)
    .map((ca) => ca._crd49_campaign_value)
    .filter((v): v is string => !!v);
}

/** Activity ids linked to a campaign (via the junction). */
export function activityIdsForCampaign(
  campaignId: string,
  campaignActivities: Abs_campaignactivities[],
): string[] {
  return campaignActivities
    .filter((ca) => ca._crd49_campaign_value === campaignId)
    .map((ca) => ca._crd49_activity_value)
    .filter((v): v is string => !!v);
}

/** Campaign ids a champion has joined (has a participation row for). */
export function joinedCampaignIds(
  championId: string | undefined,
  participations: Abs_campaignparticipations[],
): Set<string> {
  const set = new Set<string>();
  if (!championId) return set;
  for (const p of participations) {
    if (p._crd49_champion_value === championId && p._crd49_campaign_value) {
      set.add(p._crd49_campaign_value);
    }
  }
  return set;
}

export function hasJoined(
  championId: string | undefined,
  campaignId: string,
  participations: Abs_campaignparticipations[],
): boolean {
  return joinedCampaignIds(championId, participations).has(campaignId);
}

/** Is any campaign this activity is linked to currently live? */
export function isActivityActive(
  activityId: string,
  campaignActivities: Abs_campaignactivities[],
  campaignById: Map<string, Abs_campaigns>,
): boolean {
  return campaignIdsForActivity(activityId, campaignActivities)
    .some((cid) => {
      const c = campaignById.get(cid);
      return c ? isCampaignLive(c) : false;
    });
}

/**
 * Campaigns a champion can claim this activity under: campaigns that (a) the activity is
 * linked to, (b) the champion has joined, (c) are currently live, and (d) the champion does
 * not already have an active (Pending/Approved) claim for. Pass `claims` to enforce the
 * one-claim-per-activity-per-campaign rule; omit it to skip that check.
 */
export function claimableCampaignsForActivity(
  activityId: string,
  championId: string | undefined,
  campaignActivities: Abs_campaignactivities[],
  participations: Abs_campaignparticipations[],
  campaignById: Map<string, Abs_campaigns>,
  claims: Abs_activityclaims[] = [],
): Abs_campaigns[] {
  if (!championId) return [];
  const joined = joinedCampaignIds(championId, participations);
  return campaignIdsForActivity(activityId, campaignActivities)
    .filter((cid) => joined.has(cid))
    .filter((cid) => !hasActiveClaim(championId, activityId, cid, claims))
    .map((cid) => campaignById.get(cid))
    .filter((c): c is Abs_campaigns => !!c && isCampaignLive(c));
}
