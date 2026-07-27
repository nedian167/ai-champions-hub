import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../context/AppDataContext';
import { Card, Donut, KpiCard, Pill, Rank, EmptyState, Avatar } from '../components/ui';
import { ChampionStatus, CampaignStatus, ClaimStatus, RequestStatus, CampaignStatusLabel } from '../lib/enums';
import { formatDate, firstName } from '../lib/format';
import type { PillColor } from '../components/ui';

function inMonth(iso: string | undefined, offset: number): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return d.getFullYear() === target.getFullYear() && d.getMonth() === target.getMonth();
}

function monthDelta(items: { createdon?: string }[]): number {
  const cur = items.filter((i) => inMonth(i.createdon, 0)).length;
  const prev = items.filter((i) => inMonth(i.createdon, -1)).length;
  return cur - prev;
}

export function campaignStatusColor(s?: number): PillColor {
  return s === CampaignStatus.Active ? 'green' : s === CampaignStatus.Completed ? 'blue' : 'gray';
}

export default function HomeScreen() {
  const nav = useNavigate();
  const {
    champions, campaigns, claims, requests, currentUser, currentChampion,
    championById, departmentById, activityById, pointsFor,
  } = useAppData();

  const activeChampions = champions.filter((c) => c.crd49_status === ChampionStatus.Active);
  const activeCampaigns = campaigns.filter((c) => c.crd49_status === CampaignStatus.Active);
  const approvedClaims = claims.filter((c) => c.crd49_status === ClaimStatus.Approved);
  const pendingClaims = claims.filter((c) => c.crd49_status === ClaimStatus.Pending);
  const openRequests = requests.filter(
    (r) => r.crd49_status === RequestStatus.Open || r.crd49_status === RequestStatus.InReview,
  );

  const totalPoints = useMemo(
    () => approvedClaims.reduce((sum, c) => sum + (activityById.get(c._crd49_activity_value ?? '')?.crd49_points ?? 0), 0),
    [approvedClaims, activityById],
  );

  const topChampions = useMemo(
    () =>
      [...champions]
        .map((c) => ({ champ: c, pts: pointsFor(c.abs_championid) }))
        .sort((a, b) => b.pts - a.pts)
        .slice(0, 5),
    [champions, pointsFor],
  );

  const recent = useMemo(
    () => [...claims].sort((a, b) => (b.crd49_claimeddate ?? '').localeCompare(a.crd49_claimeddate ?? '')).slice(0, 6),
    [claims],
  );

  const approvalPct = claims.length ? (approvedClaims.length / claims.length) * 100 : 0;
  const greetName = firstName(currentChampion?.crd49_displayname || currentUser?.fullName);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Welcome back, {greetName} 👋</h1>
          <div className="page-subtitle">Here's what's happening across your AI champion program.</div>
        </div>
      </div>

      <div className="grid grid-kpi">
        <KpiCard
          label="Active Champions"
          value={activeChampions.length}
          sub={`of ${champions.length} total`}
          icon="🧑‍🚀"
          iconBg="var(--purple-soft)"
          iconColor="var(--purple)"
          delta={monthDelta(champions)}
        />
        <KpiCard
          label="Active Campaigns"
          value={activeCampaigns.length}
          sub={`${campaigns.length} total`}
          icon="📣"
          iconBg="var(--blue-soft)"
          iconColor="var(--blue)"
          delta={monthDelta(campaigns)}
        />
        <KpiCard
          label="Activities Completed"
          value={approvedClaims.length}
          sub={`${claims.length} claims`}
          icon="🎯"
          iconBg="var(--green-soft)"
          iconColor="var(--green)"
          delta={monthDelta(approvedClaims)}
        />
        <KpiCard
          label="Total Points Earned"
          value={totalPoints.toLocaleString()}
          sub="across all champions"
          icon="⭐"
          iconBg="var(--amber-soft)"
          iconColor="var(--amber)"
        />
      </div>

      <div className="grid grid-2 mt-24">
        <Card title="⏳ Pending Claims" action={<span className="section-link link" onClick={() => nav('/activities')}>View all</span>}>
          {pendingClaims.length === 0 ? (
            <EmptyState icon="✅" title="No pending claims" message="All caught up!" />
          ) : (
            <div className="list">
              {pendingClaims.slice(0, 5).map((cl) => {
                const champ = championById.get(cl._crd49_champion_value ?? '');
                const act = activityById.get(cl._crd49_activity_value ?? '');
                return (
                  <div className="list-item" key={cl.abs_activityclaimid}>
                    <Avatar name={champ?.crd49_displayname ?? '?'} size={34} />
                    <div className="center-col spacer">
                      <span className="item-title">{act?.abs_title ?? 'Activity'}</span>
                      <span className="item-sub">{champ?.crd49_displayname ?? 'Unknown'} · {formatDate(cl.crd49_claimeddate)}</span>
                    </div>
                    <Pill color="amber">Pending</Pill>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="📨 Open Requests" action={<span className="section-link link" onClick={() => nav('/requests')}>View all requests</span>}>
          {openRequests.length === 0 ? (
            <EmptyState icon="📭" title="No open requests" message="Nothing needs triage." />
          ) : (
            <div className="list">
              {openRequests.slice(0, 5).map((r) => {
                const champ = championById.get(r._crd49_champion_value ?? '');
                return (
                  <div className="list-item" key={r.abs_requestid}>
                    <div className="center-col spacer">
                      <span className="item-title">{r.abs_title}</span>
                      <span className="item-sub">{champ?.crd49_displayname ?? 'Unknown'}</span>
                    </div>
                    <Pill color={r.crd49_status === RequestStatus.InReview ? 'blue' : 'amber'}>
                      {r.crd49_status === RequestStatus.InReview ? 'In Review' : 'Open'}
                    </Pill>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-2 mt-24">
        <Card title="📊 Activity Completion">
          <div className="donut-wrap">
            <Donut percent={approvalPct} />
            <div>
              <div className="strong">{approvedClaims.length} of {claims.length} claims approved</div>
              <div className="legend mt-16">
                <span><span className="legend-dot" style={{ background: 'var(--green)' }} /> Approved · {approvedClaims.length}</span>
                <span><span className="legend-dot" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-strong)' }} /> Pending · {pendingClaims.length}</span>
              </div>
            </div>
          </div>
        </Card>

        <Card title="🏆 Top Champions" action={<span className="section-link link" onClick={() => nav('/leaderboard')}>View all</span>}>
          {topChampions.length === 0 ? (
            <EmptyState icon="🏆" title="No champions yet" />
          ) : (
            <div className="list">
              {topChampions.map((t, i) => (
                <div className="list-item" key={t.champ.abs_championid}>
                  <Rank n={i + 1} />
                  <Avatar name={t.champ.crd49_displayname ?? '?'} size={34} />
                  <div className="center-col spacer">
                    <span className="item-title">{t.champ.crd49_displayname}</span>
                    <span className="item-sub">{departmentById.get(t.champ._crd49_department_value ?? '')?.abs_name ?? '—'}</span>
                  </div>
                  <span className="points-badge">{t.pts} pts</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-2 mt-24">
        <Card title="🕑 Recent Activity" action={<span className="section-link link" onClick={() => nav('/activities')}>View all</span>}>
          {recent.length === 0 ? (
            <EmptyState icon="🕑" title="No recent activity" />
          ) : (
            <div className="list">
              {recent.map((cl) => {
                const champ = championById.get(cl._crd49_champion_value ?? '');
                const act = activityById.get(cl._crd49_activity_value ?? '');
                return (
                  <div className="list-item" key={cl.abs_activityclaimid}>
                    <Avatar name={champ?.crd49_displayname ?? '?'} size={30} />
                    <div className="center-col spacer">
                      <span className="item-title">{champ?.crd49_displayname ?? 'Someone'}</span>
                      <span className="item-sub">claimed {act?.abs_title ?? 'an activity'}</span>
                    </div>
                    <span className="item-sub">{formatDate(cl.crd49_claimeddate)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="📣 Active Campaigns" action={<span className="section-link link" onClick={() => nav('/campaigns')}>View all</span>}>
          {activeCampaigns.length === 0 ? (
            <EmptyState icon="📣" title="No active campaigns" />
          ) : (
            <div className="list">
              {activeCampaigns.slice(0, 4).map((c) => (
                <div className="list-item" key={c.abs_campaignid} style={{ cursor: 'pointer' }} onClick={() => nav(`/campaigns/${c.abs_campaignid}`)}>
                  <div className="center-col spacer">
                    <span className="item-title">{c.abs_name}</span>
                    <span className="item-sub">{c.crd49_theme || '—'} · Ends {formatDate(c.crd49_enddate)}</span>
                  </div>
                  <Pill color={campaignStatusColor(c.crd49_status)}>{CampaignStatusLabel[c.crd49_status]}</Pill>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
