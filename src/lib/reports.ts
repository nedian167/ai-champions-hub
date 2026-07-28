/**
 * Report data builders + export helpers for the admin Reports section.
 * Pure functions over the AppData collections so they can be reused/tested and
 * fed straight into the chart components and CSV export.
 */
import type {
  Abs_champions, Abs_departments, Abs_campaigns, Abs_activities, Abs_activityclaims,
  Abs_campaignparticipations, Abs_requests, Abs_events, Abs_requestcategories,
} from '../data/entities';
import {
  ChampionStatus, ClaimStatus, ActivityTypeLabel, RequestCategoryLabel, RequestStatusLabel,
  RequestStatus, EventFormat,
} from './enums';
import { computeCampaignHealth, type HealthInputs } from './campaignHealth';
import { effectiveStatusLabel, effectiveCampaignStatus, isCampaignLive } from './campaignStatus';

export interface ReportInputs {
  champions: Abs_champions[];
  departments: Abs_departments[];
  campaigns: Abs_campaigns[];
  activities: Abs_activities[];
  claims: Abs_activityclaims[];
  participations: Abs_campaignparticipations[];
  campaignActivities: HealthInputs['campaignActivities'];
  campaignDepartments: HealthInputs['campaignDepartments'];
  requests: Abs_requests[];
  requestCategories: Abs_requestcategories[];
  events: Abs_events[];
  pointsFor: (id?: string) => number;
}

const round = (n: number) => Math.round(n);
const pct = (num: number, den: number) => (den > 0 ? round((num / den) * 100) : 0);

/* ---------------- Executive summary ---------------- */
export interface ExecSummary {
  activeChampions: number;
  totalChampions: number;
  adoptionRate: number;
  totalPoints: number;
  approvedClaims: number;
  approvalRate: number;
  liveCampaigns: number;
  avgHealth: number;
  openRequests: number;
}

export function execSummary(i: ReportInputs): ExecSummary {
  const active = i.champions.filter((c) => c.crd49_status === ChampionStatus.Active);
  const approved = i.claims.filter((c) => c.crd49_status === ClaimStatus.Approved);
  const decided = i.claims.filter((c) => c.crd49_status !== ClaimStatus.Pending);
  const totalPoints = i.champions.reduce((s, c) => s + i.pointsFor(c.abs_championid), 0);
  const live = i.campaigns.filter(isCampaignLive);
  const health = live.map((c) => computeCampaignHealth(c, i).score);
  const avgHealth = health.length ? round(health.reduce((s, x) => s + x, 0) / health.length) : 0;
  const openReq = i.requests.filter((r) => r.crd49_status === RequestStatus.Open || r.crd49_status === RequestStatus.InReview);
  return {
    activeChampions: active.length,
    totalChampions: i.champions.length,
    adoptionRate: pct(active.length, i.champions.length),
    totalPoints,
    approvedClaims: approved.length,
    approvalRate: pct(approved.length, decided.length),
    liveCampaigns: live.length,
    avgHealth,
    openRequests: openReq.length,
  };
}

/* ---------------- By department ---------------- */
export interface DeptRow { department: string; champions: number; active: number; points: number; }

export function byDepartment(i: ReportInputs): DeptRow[] {
  const rows = i.departments.map((d) => {
    const champs = i.champions.filter((c) => c._crd49_department_value === d.abs_departmentid);
    return {
      department: d.abs_name ?? 'Unnamed',
      champions: champs.length,
      active: champs.filter((c) => c.crd49_status === ChampionStatus.Active).length,
      points: champs.reduce((s, c) => s + i.pointsFor(c.abs_championid), 0),
    };
  });
  const known = new Set(i.departments.map((d) => d.abs_departmentid));
  const orphan = i.champions.filter((c) => !c._crd49_department_value || !known.has(c._crd49_department_value));
  if (orphan.length) {
    rows.push({
      department: 'Unassigned',
      champions: orphan.length,
      active: orphan.filter((c) => c.crd49_status === ChampionStatus.Active).length,
      points: orphan.reduce((s, c) => s + i.pointsFor(c.abs_championid), 0),
    });
  }
  return rows.sort((a, b) => b.champions - a.champions);
}

/* ---------------- Claim outcomes ---------------- */
export function claimOutcomes(i: ReportInputs) {
  return {
    approved: i.claims.filter((c) => c.crd49_status === ClaimStatus.Approved).length,
    pending: i.claims.filter((c) => c.crd49_status === ClaimStatus.Pending).length,
    rejected: i.claims.filter((c) => c.crd49_status === ClaimStatus.Rejected).length,
  };
}

/* ---------------- Completions by activity type ---------------- */
export interface TypeRow { type: string; completed: number; }

export function completionsByType(i: ReportInputs): TypeRow[] {
  const byId = new Map(i.activities.map((a) => [a.abs_activityid, a]));
  const counts = new Map<number, number>();
  for (const cl of i.claims) {
    if (cl.crd49_status !== ClaimStatus.Approved) continue;
    const act = byId.get(cl._crd49_activity_value ?? '');
    if (!act || act.crd49_activitytype == null) continue;
    counts.set(act.crd49_activitytype, (counts.get(act.crd49_activitytype) ?? 0) + 1);
  }
  return Object.entries(ActivityTypeLabel)
    .map(([val, label]) => ({ type: label, completed: counts.get(Number(val)) ?? 0 }))
    .sort((a, b) => b.completed - a.completed);
}

/* ---------------- Campaign performance ---------------- */
export interface CampaignRow {
  name: string;
  status: string;
  enrolled: number;
  activities: number;
  completed: number;
  completion: number;
  health: string;
  healthLevel: 'green' | 'amber' | 'red' | 'gray';
  score: number;
}

export function campaignPerformance(i: ReportInputs): CampaignRow[] {
  return i.campaigns
    .map((c) => {
      const h = computeCampaignHealth(c, i);
      return {
        name: c.abs_name ?? 'Unnamed',
        status: effectiveStatusLabel[effectiveCampaignStatus(c)],
        enrolled: h.enrolled,
        activities: h.activities,
        completed: h.completed,
        completion: round(h.completionRate * 100),
        health: h.label,
        healthLevel: h.level,
        score: h.score,
      };
    })
    .sort((a, b) => a.score - b.score);
}

/* ---------------- Requests ---------------- */
export function requestsByCategory(i: ReportInputs): { label: string; value: number }[] {
  const nameById = new Map(i.requestCategories.map((c) => [c.abs_requestcategoryid, c.abs_name]));
  const counts = new Map<string, number>();
  for (const r of i.requests) {
    let label: string;
    if (r._abs_category_value) {
      label = nameById.get(r._abs_category_value) ?? r.abs_categoryname ?? 'Uncategorized';
    } else {
      // Legacy rows created before categories became a lookup.
      label = RequestCategoryLabel[r.crd49_category] ?? 'Uncategorized';
    }
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  // Ensure every configured category shows (even with 0 requests).
  for (const c of i.requestCategories) if (!counts.has(c.abs_name)) counts.set(c.abs_name, 0);
  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

export function requestsByStatus(i: ReportInputs): { label: string; value: number }[] {
  return Object.entries(RequestStatusLabel)
    .map(([val, label]) => ({ label, value: i.requests.filter((r) => r.crd49_status === Number(val)).length }));
}

/* ---------------- Monthly trend (last 6 months) ---------------- */
export interface TrendPoint { label: string; joined: number; completed: number; }

export function monthlyTrend(i: ReportInputs, months = 6): TrendPoint[] {
  const now = new Date();
  const buckets: { key: string; label: string; joined: number; completed: number }[] = [];
  for (let m = months - 1; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    buckets.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleString(undefined, { month: 'short' }),
      joined: 0,
      completed: 0,
    });
  }
  const idx = new Map(buckets.map((b) => [b.key, b]));
  const keyOf = (v?: string | null) => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : `${d.getFullYear()}-${d.getMonth()}`;
  };
  for (const c of i.champions) {
    const b = idx.get(keyOf(c.crd49_joineddate ?? c.createdon) ?? '');
    if (b) b.joined++;
  }
  for (const cl of i.claims) {
    if (cl.crd49_status !== ClaimStatus.Approved) continue;
    const b = idx.get(keyOf(cl.crd49_claimeddate ?? cl.createdon) ?? '');
    if (b) b.completed++;
  }
  return buckets.map((b) => ({ label: b.label, joined: b.joined, completed: b.completed }));
}

/* ---------------- Events ---------------- */
export function eventStats(i: ReportInputs) {
  const cutoff = Date.now() - 864e5;
  const up = (e: Abs_events) => new Date(e.crd49_eventdate).getTime() >= cutoff;
  return {
    total: i.events.length,
    upcoming: i.events.filter(up).length,
    past: i.events.filter((e) => !up(e)).length,
    online: i.events.filter((e) => e.crd49_format === EventFormat.Online).length,
    inPerson: i.events.filter((e) => e.crd49_format === EventFormat.InPerson).length,
  };
}

/* ---------------- CSV + export helpers ---------------- */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}

function triggerDownload(filename: string, csv: string): void {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  triggerDownload(filename, toCsv(headers, rows));
}

/**
 * Consolidated export — every report section in a single CSV file, each block
 * prefixed with its section title and separated by a blank line (opens cleanly
 * in Excel / Google Sheets).
 */
export function downloadFullReport(i: ReportInputs, filename = 'ai-champions-program-report.csv'): void {
  const s = execSummary(i);
  const blocks: string[] = [];
  const section = (title: string, headers: string[], rows: (string | number)[][]) => {
    blocks.push(title, toCsv(headers, rows), '');
  };

  blocks.push(toCsv(['AI Champions Program Report', `Generated ${new Date().toLocaleString()}`], []), '');

  section('Executive Summary', ['Metric', 'Value'], [
    ['Active champions', s.activeChampions],
    ['Total champions', s.totalChampions],
    ['Adoption rate %', s.adoptionRate],
    ['Total points awarded', s.totalPoints],
    ['Approved claims', s.approvedClaims],
    ['Approval rate %', s.approvalRate],
    ['Live campaigns', s.liveCampaigns],
    ['Avg campaign health', s.avgHealth],
    ['Open requests', s.openRequests],
  ]);

  section('Champions by Department', ['Department', 'Champions', 'Active', 'Points'],
    byDepartment(i).map((d) => [d.department, d.champions, d.active, d.points]));

  section('Completions by Activity Type', ['Activity type', 'Completed'],
    completionsByType(i).map((t) => [t.type, t.completed]));

  section('Monthly Trend (last 6 months)', ['Month', 'Champions joined', 'Activities completed'],
    monthlyTrend(i).map((t) => [t.label, t.joined, t.completed]));

  section('Campaign Performance',
    ['Campaign', 'Status', 'Enrolled', 'Activities', 'Completed', 'Completion %', 'Health', 'Score'],
    campaignPerformance(i).map((c) => [c.name, c.status, c.enrolled, c.activities, c.completed, c.completion, c.health, c.score]));

  section('Requests by Category', ['Category', 'Count'],
    requestsByCategory(i).map((r) => [r.label, r.value]));

  section('Requests by Status', ['Status', 'Count'],
    requestsByStatus(i).map((r) => [r.label, r.value]));

  const ev = eventStats(i);
  section('Events Overview', ['Metric', 'Value'], [
    ['Total', ev.total], ['Upcoming', ev.upcoming], ['Past', ev.past],
    ['Online', ev.online], ['In-person', ev.inPerson],
  ]);

  triggerDownload(filename, blocks.join('\r\n'));
}
