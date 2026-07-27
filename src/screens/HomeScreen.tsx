import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../context/AppDataContext';
import { Card, Donut, KpiCard, Pill, Rank, EmptyState, Avatar } from '../components/ui';
import { ChampionStatus, CampaignStatus, ClaimStatus, RequestStatus, CampaignStatusLabel } from '../lib/enums';
import { formatDate, firstName } from '../lib/format';
import { isCampaignLive } from '../lib/campaignStatus';
import { computeCampaignHealth } from '../lib/campaignHealth';
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
    champions, campaigns, claims, requests, currentUser, currentChampion, isAdmin, participations,
    campaignActivities, campaignDepartments,
    championById, departmentById, activityById, pointsFor,
  } = useAppData();

  const isChampionView = !!currentChampion && !isAdmin;
  const myId = currentChampion?.abs_championid;

  const activeChampions = champions.filter((c) => c.crd49_status === ChampionStatus.Active);
  const activeCampaigns = campaigns.filter((c) => isCampaignLive(c));
  const approvedClaims = claims.filter((c) => c.crd49_status === ClaimStatus.Approved);
  const pendingClaims = claims.filter((c) => c.crd49_status === ClaimStatus.Pending);
  const rejectedClaims = claims.filter((c) => c.crd49_status === ClaimStatus.Rejected);
  const openRequests = requests.filter(
    (r) => r.crd49_status === RequestStatus.Open || r.crd49_status === RequestStatus.InReview,
  );

  // Champion-specific slices
  const myClaims = useMemo(() => claims.filter((c) => c._crd49_champion_value === myId), [claims, myId]);
  const myApproved = myClaims.filter((c) => c.crd49_status === ClaimStatus.Approved);
  const myPending = myClaims.filter((c) => c.crd49_status === ClaimStatus.Pending);
  const myRejected = myClaims.filter((c) => c.crd49_status === ClaimStatus.Rejected);
  const myRequests = useMemo(() => requests.filter((r) => r._crd49_champion_value === myId), [requests, myId]);
  const myOpenRequests = myRequests.filter(
    (r) => r.crd49_status === RequestStatus.Open || r.crd49_status === RequestStatus.InReview,
  );
  const myJoinedLive = useMemo(() => {
    const joined = new Set(
      participations.filter((p) => p._crd49_champion_value === myId).map((p) => p._crd49_campaign_value),
    );
    return campaigns.filter((c) => joined.has(c.abs_campaignid) && isCampaignLive(c));
  }, [participations, campaigns, myId]);

  const myPoints = pointsFor(myId);
  const myRank = useMemo(() => {
    const ranked = [...champions]
      .map((c) => ({ id: c.abs_championid, pts: pointsFor(c.abs_championid) }))
      .sort((a, b) => b.pts - a.pts);
    const idx = ranked.findIndex((r) => r.id === myId);
    return idx >= 0 ? idx + 1 : null;
  }, [champions, pointsFor, myId]);

  // Program-wide campaign health (admin KPI) — RAG across live campaigns.
  const health = useMemo(() => {
    const input = { participations, campaignActivities, claims, campaignDepartments, champions };
    const list = activeCampaigns.map((c) => computeCampaignHealth(c, input));
    const green = list.filter((h) => h.level === 'green').length;
    const amber = list.filter((h) => h.level === 'amber').length;
    const red = list.filter((h) => h.level === 'red').length;
    return { green, amber, red, total: list.length };
  }, [activeCampaigns, participations, campaignActivities, claims, campaignDepartments, champions]);

  const topChampions = useMemo(
    () =>
      [...champions]
        .map((c) => ({ champ: c, pts: pointsFor(c.abs_championid) }))
        .sort((a, b) => b.pts - a.pts)
        .slice(0, 5),
    [champions, pointsFor],
  );

  const recent = useMemo(
    () => [...(isChampionView ? myClaims : claims)].sort((a, b) => (b.crd49_claimeddate ?? '').localeCompare(a.crd49_claimeddate ?? '')).slice(0, 6),
    [isChampionView, myClaims, claims],
  );

  const donutClaims = isChampionView ? myClaims : claims;
  const donutApproved = isChampionView ? myApproved : approvedClaims;
  const donutPending = isChampionView ? myPending : pendingClaims;
  const donutRejected = isChampionView ? myRejected : rejectedClaims;
  const approvalPct = donutClaims.length ? (donutApproved.length / donutClaims.length) * 100 : 0;
  const greetName = firstName(currentChampion?.crd49_displayname || currentUser?.fullName);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Welcome back, {greetName} 👋</h1>
          <div className="page-subtitle">
            {isChampionView
              ? "Here's your AI champion progress at a glance."
              : "Here's what's happening across your AI champion program."}
          </div>
        </div>
      </div>

      {isChampionView ? (
        <div className="grid grid-kpi">
          <KpiCard
            label="My Points"
            value={myPoints.toLocaleString()}
            sub={myRank ? `Rank #${myRank} of ${champions.length}` : 'Unranked'}
            icon="⭐"
            iconBg="var(--amber-soft)"
            iconColor="var(--amber)"
            onClick={() => nav('/leaderboard')}
          />
          <KpiCard
            label="Activities Completed"
            value={myApproved.length}
            sub={`${myClaims.length} claims`}
            icon="🎯"
            iconBg="var(--green-soft)"
            iconColor="var(--green)"
            delta={monthDelta(myApproved)}
            onClick={() => nav('/activities', { state: { tab: 'claims', claimStatus: ClaimStatus.Approved } })}
          />
          <KpiCard
            label="My Pending Claims"
            value={myPending.length}
            sub={myPending.length ? 'Awaiting approval' : 'All caught up'}
            icon="⏳"
            iconBg="var(--purple-soft)"
            iconColor="var(--purple)"
            onClick={() => nav('/activities', { state: { tab: 'claims', claimStatus: ClaimStatus.Pending } })}
          />
          <KpiCard
            label="Campaigns Joined"
            value={myJoinedLive.length}
            sub={`of ${activeCampaigns.length} active`}
            icon="📣"
            iconBg="var(--blue-soft)"
            iconColor="var(--blue)"
            onClick={() => nav('/campaigns')}
          />
        </div>
      ) : (
        <div className="grid grid-kpi">
          <KpiCard
            label="Active Champions"
            value={activeChampions.length}
            sub={`of ${champions.length} total`}
            icon="🧑‍🚀"
            iconBg="var(--purple-soft)"
            iconColor="var(--purple)"
            delta={monthDelta(champions)}
            onClick={() => nav('/champions', { state: { statusFilter: ChampionStatus.Active } })}
          />
          <KpiCard
            label="Active Campaigns"
            value={activeCampaigns.length}
            sub={`${campaigns.length} total`}
            icon="📣"
            iconBg="var(--blue-soft)"
            iconColor="var(--blue)"
            delta={monthDelta(campaigns)}
            onClick={() => nav('/campaigns', { state: { tab: 'active' } })}
          />
          <KpiCard
            label="Activities Completed"
            value={approvedClaims.length}
            sub={`${claims.length} claims`}
            icon="🎯"
            iconBg="var(--green-soft)"
            iconColor="var(--green)"
            delta={monthDelta(approvedClaims)}
            onClick={() => nav('/activities', { state: { tab: 'claims', claimStatus: ClaimStatus.Approved } })}
          />
          <KpiCard
            label="Campaigns At Risk"
            value={health.red}
            sub={health.total
              ? `${health.green} healthy · ${health.amber} watch · ${health.red} at risk`
              : 'No live campaigns'}
            icon="🩺"
            iconBg={health.red ? 'var(--red-soft)' : health.amber ? 'var(--amber-soft)' : 'var(--green-soft)'}
            iconColor={health.red ? 'var(--red)' : health.amber ? 'var(--amber)' : 'var(--green)'}
            onClick={() => nav('/campaigns', { state: { tab: 'active' } })}
          />
        </div>
      )}

      <div className="grid grid-2 mt-24">
        <Card title={isChampionView ? '⏳ My Pending Claims' : '⏳ Pending Claims'} action={<span className="section-link link" onClick={() => nav('/activities', { state: { tab: 'claims', claimStatus: ClaimStatus.Pending } })}>View all</span>}>
          {(isChampionView ? myPending : pendingClaims).length === 0 ? (
            <EmptyState icon="✅" title="No pending claims" message={isChampionView ? 'Claim an activity to earn points.' : 'All caught up!'} />
          ) : (
            <div className="list">
              {(isChampionView ? myPending : pendingClaims).slice(0, 5).map((cl) => {
                const champ = championById.get(cl._crd49_champion_value ?? '');
                const act = activityById.get(cl._crd49_activity_value ?? '');
                return (
                  <div
                    className="list-item clickable"
                    key={cl.abs_activityclaimid}
                    role="button"
                    tabIndex={0}
                    onClick={() => nav('/activities', { state: { tab: 'claims', claimStatus: ClaimStatus.Pending, openClaimId: cl.abs_activityclaimid } })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nav('/activities', { state: { tab: 'claims', claimStatus: ClaimStatus.Pending, openClaimId: cl.abs_activityclaimid } }); } }}
                  >
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

        <Card title={isChampionView ? '📨 My Requests' : '📨 Open Requests'} action={<span className="section-link link" onClick={() => nav('/requests')}>{isChampionView ? 'View all' : 'View all requests'}</span>}>
          {(isChampionView ? myOpenRequests : openRequests).length === 0 ? (
            <EmptyState icon="📭" title={isChampionView ? 'No open requests' : 'No open requests'} message={isChampionView ? 'Submit a request when you need help.' : 'Nothing needs triage.'} />
          ) : (
            <div className="list">
              {(isChampionView ? myOpenRequests : openRequests).slice(0, 5).map((r) => {
                const champ = championById.get(r._crd49_champion_value ?? '');
                return (
                  <div
                    className="list-item clickable"
                    key={r.abs_requestid}
                    role="button"
                    tabIndex={0}
                    onClick={() => nav('/requests', { state: { openRequestId: r.abs_requestid } })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nav('/requests', { state: { openRequestId: r.abs_requestid } }); }
                    }}
                  >
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
        <Card title={isChampionView ? '📊 My Activity Completion' : '📊 Activity Completion'}>
          <div className="donut-wrap">
            <Donut
              percent={approvalPct}
              segments={[
                { value: donutApproved.length, color: 'var(--green)' },
                { value: donutPending.length, color: 'var(--amber)' },
                { value: donutRejected.length, color: 'var(--red)' },
              ]}
            />
            <div>
              <div className="strong">{donutApproved.length} of {donutClaims.length} claims approved</div>
              <div className="legend mt-16">
                <span><span className="legend-dot" style={{ background: 'var(--green)' }} /> Approved · {donutApproved.length}</span>
                <span><span className="legend-dot" style={{ background: 'var(--amber)' }} /> Pending · {donutPending.length}</span>
                <span><span className="legend-dot" style={{ background: 'var(--red)' }} /> Rejected · {donutRejected.length}</span>
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
        <Card title={isChampionView ? '🕑 My Recent Activity' : '🕑 Recent Activity'} action={<span className="section-link link" onClick={() => nav('/activities')}>View all</span>}>
          {recent.length === 0 ? (
            <EmptyState icon="🕑" title="No recent activity" message={isChampionView ? "You haven't claimed anything yet." : undefined} />
          ) : (
            <div className="list">
              {recent.map((cl) => {
                const champ = championById.get(cl._crd49_champion_value ?? '');
                const act = activityById.get(cl._crd49_activity_value ?? '');
                return (
                  <div className="list-item" key={cl.abs_activityclaimid}>
                    <Avatar name={champ?.crd49_displayname ?? '?'} size={30} />
                    <div className="center-col spacer">
                      <span className="item-title">{isChampionView ? 'You' : (champ?.crd49_displayname ?? 'Someone')}</span>
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
