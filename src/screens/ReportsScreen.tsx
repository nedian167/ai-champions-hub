import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../context/AppDataContext';
import { Card, KpiCard, EmptyState, HealthBadge } from '../components/ui';
import { BarList, ColumnChart, StackBar, ReportTable, type BarDatum } from '../components/charts';
import {
  execSummary, byDepartment, completionsByType, campaignPerformance,
  requestsByCategory, requestsByStatus, monthlyTrend, eventStats, downloadFullReport,
  type ReportInputs,
} from '../lib/reports';

export default function ReportsScreen() {
  const data = useAppData();
  const navigate = useNavigate();
  const { isAdmin } = data;

  const inputs: ReportInputs = useMemo(() => ({
    champions: data.champions,
    departments: data.departments,
    campaigns: data.campaigns,
    activities: data.activities,
    claims: data.claims,
    participations: data.participations,
    campaignActivities: data.campaignActivities,
    campaignDepartments: data.campaignDepartments,
    requests: data.requests,
    events: data.events,
    pointsFor: data.pointsFor,
  }), [data]);

  const summary = useMemo(() => execSummary(inputs), [inputs]);
  const depts = useMemo(() => byDepartment(inputs), [inputs]);
  const types = useMemo(() => completionsByType(inputs), [inputs]);
  const campaignRows = useMemo(() => campaignPerformance(inputs), [inputs]);
  const reqCat = useMemo(() => requestsByCategory(inputs), [inputs]);
  const reqStatus = useMemo(() => requestsByStatus(inputs), [inputs]);
  const trend = useMemo(() => monthlyTrend(inputs), [inputs]);
  const evStats = useMemo(() => eventStats(inputs), [inputs]);

  if (!isAdmin) {
    return (
      <EmptyState
        icon="🔒"
        title="Reports are for program admins"
        message="This section is available to Program Managers and app administrators."
        action={<button className="btn btn-primary" onClick={() => navigate('/')}>Back to Home</button>}
      />
    );
  }

  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const deptBars: BarDatum[] = depts.map((d): BarDatum => ({ label: d.department, value: d.active, color: 'blue' }));
  const deptPointBars: BarDatum[] = depts
    .filter((d) => d.points > 0)
    .map((d): BarDatum => ({ label: d.department, value: d.points, color: 'purple' }))
    .sort((a, b) => b.value - a.value);
  const typeBars: BarDatum[] = types.map((t): BarDatum => ({ label: t.type, value: t.completed, color: 'green' }));
  const reqCatBars: BarDatum[] = reqCat.map((r): BarDatum => ({ label: r.label, value: r.value, color: 'blue' }));

  return (
    <div className="reports">
      <div className="reports-head">
        <div>
          <h2 className="reports-title">📊 Program Reports</h2>
          <p className="reports-sub">Executive summary for the AI Champions program · Generated {today}</p>
        </div>
        <div className="reports-actions no-print">
          <button className="btn btn-ghost" onClick={() => window.print()} title="Print or save as PDF">🖨 Print / PDF</button>
          <button
            className="btn btn-primary"
            onClick={() => downloadFullReport(inputs)}
            title="Download the full report (all sections) as one CSV"
          >
            ⬇ Export report
          </button>
        </div>
      </div>

      {/* Executive KPI row */}
      <div className="grid grid-kpi reports-kpi">
        <KpiCard label="Active Champions" value={summary.activeChampions}
          icon="🧑‍🚀" iconColor="var(--blue)" sub={`${summary.adoptionRate}% of ${summary.totalChampions} adoption`} />
        <KpiCard label="Points Awarded" value={summary.totalPoints.toLocaleString()}
          icon="⭐" iconColor="var(--amber)" sub="across all champions" />
        <KpiCard label="Activities Completed" value={summary.approvedClaims}
          icon="✅" iconColor="var(--green)" sub={`${summary.approvalRate}% claim approval rate`} />
        <KpiCard label="Live Campaigns" value={summary.liveCampaigns}
          icon="🎯" iconColor="var(--purple)" sub={`${summary.avgHealth} avg health score`} />
        <KpiCard label="Open Requests" value={summary.openRequests}
          icon="📥" iconColor="var(--red)" sub="awaiting triage" />
      </div>

      <div className="grid-2">
        <Card title="Champions by Department">
          <BarList data={deptBars} emptyLabel="No champions yet" />
        </Card>
        <Card title="Points by Department">
          <BarList data={deptPointBars} unit="pts" emptyLabel="No points awarded yet" />
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Completions by Activity Type">
          <BarList data={typeBars} emptyLabel="No approved claims yet" />
        </Card>
        <Card title="Requests by Category">
          <BarList data={reqCatBars} emptyLabel="No requests yet" />
        </Card>
      </div>

      <Card title="Monthly Trend — Champions joined vs. Activities completed (last 6 months)">
        <ColumnChart data={trend.map((t) => ({ label: t.label, a: t.joined, b: t.completed }))}
          seriesA="Champions joined" seriesB="Activities completed" colorA="blue" colorB="green" />
      </Card>

      <Card title="Campaign Performance">
        {campaignRows.length === 0 ? (
          <EmptyState title="No campaigns yet" />
        ) : (
          <ReportTable
            columns={['Campaign', 'Status', 'Enrolled', 'Activities', 'Completion', 'Health']}
            rows={campaignRows.map((c) => [
              c.name,
              c.status,
              c.enrolled,
              c.activities,
              `${c.completion}%`,
              <HealthBadge key="h" level={c.healthLevel} label={c.health} score={c.score} showScore />,
            ])}
          />
        )}
      </Card>

      <div className="grid-2">
        <Card title="Requests by Status">
          <StackBar
            segments={[
              { label: reqStatus[0]?.label ?? 'Open', value: reqStatus[0]?.value ?? 0, color: 'blue' },
              { label: reqStatus[1]?.label ?? 'In review', value: reqStatus[1]?.value ?? 0, color: 'amber' },
              { label: reqStatus[2]?.label ?? 'Approved', value: reqStatus[2]?.value ?? 0, color: 'green' },
              { label: reqStatus[3]?.label ?? 'Rejected', value: reqStatus[3]?.value ?? 0, color: 'red' },
              { label: reqStatus[4]?.label ?? 'Fulfilled', value: reqStatus[4]?.value ?? 0, color: 'purple' },
            ]}
          />
        </Card>

        <Card title="Events Overview">
          <div className="ev-stat-row">
            <div className="ev-stat"><div className="ev-stat-num">{evStats.total}</div><div className="ev-stat-lbl">Total</div></div>
            <div className="ev-stat"><div className="ev-stat-num">{evStats.upcoming}</div><div className="ev-stat-lbl">Upcoming</div></div>
            <div className="ev-stat"><div className="ev-stat-num">{evStats.past}</div><div className="ev-stat-lbl">Past</div></div>
            <div className="ev-stat"><div className="ev-stat-num">{evStats.online}</div><div className="ev-stat-lbl">Online</div></div>
            <div className="ev-stat"><div className="ev-stat-num">{evStats.inPerson}</div><div className="ev-stat-lbl">In-person</div></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
