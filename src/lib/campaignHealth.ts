/**
 * Campaign health scoring (RAG — Red / Amber / Green).
 *
 * A campaign's health blends three signals so program managers can see, at a
 * glance, which campaigns need attention:
 *   1. Enrollment  — how many of the target audience have joined the campaign.
 *   2. Completion pace — approved activity claims vs. what we'd expect by now
 *      (given how many champions enrolled, how many activities the campaign has,
 *      and how far through its timeline it is).
 *
 * The output is a 0-100 score plus a RAG level and human-readable reasons.
 * Everything is derived at runtime (no schema/stored field), so it always
 * reflects live data.
 */
import { ChampionStatus, ClaimStatus, CampaignStatus } from './enums';
import { effectiveCampaignStatus } from './campaignStatus';
import type {
  Abs_campaigns, Abs_campaignparticipations, Abs_campaignactivities,
  Abs_activityclaims, Abs_campaigndepartments, Abs_champions,
} from '../data/entities';

export type HealthLevel = 'green' | 'amber' | 'red' | 'gray';

export interface CampaignHealth {
  level: HealthLevel;
  score: number;          // 0-100 (null-ish for gray/not-started)
  label: string;          // 'Healthy' | 'Needs attention' | 'At risk' | 'Not started'
  enrolled: number;
  target: number;
  activities: number;
  completed: number;      // approved claims attributed to this campaign
  possible: number;       // enrolled * activities
  completionRate: number; // 0-1 vs. possible
  timeProgress: number;   // 0-1 through the campaign timeline
  reasons: string[];
}

export interface HealthInputs {
  participations: Abs_campaignparticipations[];
  campaignActivities: Abs_campaignactivities[];
  claims: Abs_activityclaims[];
  campaignDepartments: Abs_campaigndepartments[];
  champions: Abs_champions[];
}

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const pct = (n: number) => Math.round(clamp(n) * 100);

export const healthLabel: Record<HealthLevel, string> = {
  green: 'Healthy',
  amber: 'Needs attention',
  red: 'At risk',
  gray: 'Not started',
};

export function healthColor(level: HealthLevel): HealthLevel {
  return level; // Pill supports green/amber/red/gray directly
}

function timeProgressOf(c: Abs_campaigns, now: number): number {
  const start = c.crd49_startdate ? new Date(c.crd49_startdate).getTime() : NaN;
  const end = c.crd49_enddate ? new Date(c.crd49_enddate).getTime() : NaN;
  if (!isNaN(start) && !isNaN(end) && end > start) return clamp((now - start) / (end - start));
  if (!isNaN(start) && now >= start) return 0.5; // started, unknown end
  return 0;
}

export function computeCampaignHealth(
  c: Abs_campaigns,
  input: HealthInputs,
  now: number = Date.now(),
): CampaignHealth {
  const id = c.abs_campaignid;
  const eff = effectiveCampaignStatus(c, now);

  const enrolled = input.participations.filter((p) => p._crd49_campaign_value === id).length;
  const activities = input.campaignActivities.filter((ca) => ca._crd49_campaign_value === id).length;
  const completed = input.claims.filter(
    (cl) => cl._crd49_campaign_value === id && cl.crd49_status === ClaimStatus.Approved,
  ).length;

  // Target audience: champions in the campaign's audience departments, or all
  // active champions when the campaign targets everyone.
  const deptIds = new Set(
    input.campaignDepartments
      .filter((cd) => cd._abs_campaign_value === id)
      .map((cd) => cd._abs_department_value)
      .filter((v): v is string => !!v),
  );
  const activeChamps = input.champions.filter((ch) => ch.crd49_status === ChampionStatus.Active);
  const target = deptIds.size
    ? activeChamps.filter((ch) => ch._crd49_department_value && deptIds.has(ch._crd49_department_value)).length
    : activeChamps.length;

  // For ended/completed campaigns the "expected" pace is 100% of the timeline.
  const ended = eff === 'expired' || eff === 'completed';
  const timeProgress = ended ? 1 : timeProgressOf(c, now);

  const possible = enrolled * activities;
  const completionRate = possible ? clamp(completed / possible) : 0;
  const enrollmentRate = target ? clamp(enrolled / target) : (enrolled > 0 ? 1 : 0);
  // Completion relative to how far we should be by now.
  const paceScore = timeProgress > 0.05
    ? clamp(completionRate / timeProgress)
    : (completionRate > 0 ? 1 : (enrolled > 0 ? 0.5 : 0));

  const score = pct(0.4 * enrollmentRate + 0.6 * paceScore);

  const reasons: string[] = [];
  reasons.push(`${enrolled}/${target || '—'} of audience enrolled (${pct(enrollmentRate)}%)`);
  if (activities === 0) reasons.push('No activities linked yet');
  else reasons.push(`${completed}/${possible} activity claims completed (${pct(completionRate)}%)`);
  reasons.push(`${pct(timeProgress)}% through timeline`);

  // Not-started campaigns are neutral (grey), not scored.
  const notStarted = c.crd49_status === CampaignStatus.Draft || timeProgress === 0;
  if (notStarted && !ended) {
    return {
      level: 'gray', score, label: 'Not started',
      enrolled, target, activities, completed, possible, completionRate, timeProgress, reasons,
    };
  }

  // A live campaign with no activities or no enrollment can never be Green.
  let level: HealthLevel;
  if (activities === 0 || enrolled === 0) level = score >= 34 ? 'amber' : 'red';
  else if (score >= 67) level = 'green';
  else if (score >= 34) level = 'amber';
  else level = 'red';

  return {
    level, score, label: healthLabel[level],
    enrolled, target, activities, completed, possible, completionRate, timeProgress, reasons,
  };
}
