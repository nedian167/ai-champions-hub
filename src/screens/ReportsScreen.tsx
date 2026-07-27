import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../context/AppDataContext';
import { Card, KpiCard, EmptyState, HealthBadge } from '../components/ui';
import { BarList, ColumnChart, StackBar, ReportTable, type BarDatum } from '../components/charts';
import {
  execSummary, byDepartment, claimOutcomes, completionsByType, campaignPerformance,
  requestsByCategory, requestsByStatus, monthlyTrend, eventStats, downloadCsv,
  type ReportInputs,
} from '../lib/reports';

function CsvButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn btn-ghost btn-sm no-print" onClick={onClick} title="Download this report as CSV">
      ⬇ CSV
    </button>
  );
}

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
  const outcomes = useMemo(() => claimOutcomes(inputs), [inputs]);
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
            onClick={() => {
              downloadCsv(
                'ai-champions-program-summary.csv',
                ['Metric', 'Value'],
                [
                  ['Active champions', summary.activeChampions],
                  ['Total champions', summary.totalChampions],
                  ['Adoption rate %', summary.adoptionRate],
                  ['Total points awarded', summary.totalPoints],
                  ['Approved claims', summary.approvedClaims],
                  ['Approval rate %', summary.approvalRate],
                  ['Live campaigns', summary.liveCampaigns],
                  ['Avg campaign health', summary.avgHealth],
                  ['Open requests', summary.openRequests],
                ],
              );
            }}
          >
            ⬇ Export summary
          </button>
        </div>
      </div>

      {/* Executive KPI row */}
      <div className="grid-kpi reports-kpi">
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
        <Card
          title="Champions by Department"
          action={<CsvButton onClick={() => downloadCsv('champions-by-department.csv',
            ['Department', 'Champions', 'Active', 'Points'],
            depts.map((d) => [d.department, d.champions, d.active, d.points]))} />}
        >
          <BarList data={deptBars} emptyLabel="No champions yet" />
        </Card>

        <Card
          title="Points by Department"
          action={<CsvButton onClick={() => downloadCsv('points-by-department.csv',
            ['Department', 'Points'], deptPointBars.map((d) => [d.label, d.value]))} />}
        >
          <BarList data={deptPointBars} unit="pts" emptyLabel="No points awarded yet" />
        </Card>
      </div>

      <div className="grid-2">
        <Card
          title="Claim Outcomes"
          action={<CsvButton onClick={() => downloadCsv('claim-outcomes.csv',
            ['Status', 'Count'],
            [['Approved', outcomes.approved], ['Pending', outcomes.pending], ['Rejected', outcomes.rejected]])} />}
        >
          <StackBar
            segments={[
              { label: 'Approved', value: outcomes.approved, color: 'green' },
              { label: 'Pending', value: outcomes.pending, color: 'amber' },
              { label: 'Rejected', value: outcomes.rejected, color: 'red' },
            ]}
          />
        </Card>

        <Card
          title="Completions by Activity Type"
          action={<CsvButton onClick={() => downloadCsv('completions-by-type.csv',
            ['Activity type', 'Completed'], types.map((t) => [t.type, t.completed]))} />}
        >
          <BarList data={typeBars} emptyLabel="No approved claims yet" />
        </Card>
      </div>

      <Card
        title="Monthly Trend — Champions joined vs. Activities completed (last 6 months)"
        action={<CsvButton onClick={() => downloadCsv('monthly-trend.csv',
          ['Month', 'Champions joined', 'Activities completed'],
          trend.map((t) => [t.label, t.joined, t.completed]))} />}
      >
        <ColumnChart data={trend.map((t) => ({ label: t.label, a: t.joined, b: t.completed }))}
          seriesA="Champions joined" seriesB="Activities completed" colorA="blue" colorB="green" />
      </Card>

      <Card
        title="Campaign Performance"
        action={<CsvButton onClick={() => downloadCsv('campaign-performance.csv',
          ['Campaign', 'Status', 'Enrolled', 'Activities', 'Completed', 'Completion %', 'Health', 'Score'],
          campaignRows.map((c) => [c.name, c.status, c.enrolled, c.activities, c.completed, c.completion, c.health, c.score]))} />}
      >
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
        <Card
          title="Requests by Category"
          action={<CsvButton onClick={() => downloadCsv('requests-by-category.csv',
            ['Category', 'Count'], reqCat.map((r) => [r.label, r.value]))} />}
        >
          <BarList data={reqCatBars} emptyLabel="No requests yet" />
        </Card>

        <Card
          title="Requests by Status"
          action={<CsvButton onClick={() => downloadCsv('requests-by-status.csv',
            ['Status', 'Count'], reqStatus.map((r) => [r.label, r.value]))} />}
        >
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
      </div>

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
  );
}
