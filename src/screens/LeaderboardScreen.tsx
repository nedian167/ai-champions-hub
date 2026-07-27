import { useMemo, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import { Card, Tabs, Rank, Avatar, EmptyState, Pill } from '../components/ui';
import { CampaignStatusLabel } from '../lib/enums';
import { campaignStatusColor } from './HomeScreen';

type Tab = 'champions' | 'departments' | 'campaigns';

export default function LeaderboardScreen() {
  const {
    champions, departments, campaigns, participations,
    departmentById, pointsByChampion, pointsFor,
  } = useAppData();

  const [tab, setTab] = useState<Tab>('champions');
  const [deptFilter, setDeptFilter] = useState<string>('all');

  const rankedChampions = useMemo(
    () => champions
      .filter((c) => deptFilter === 'all' || c._crd49_department_value === deptFilter)
      .map((c) => ({ c, pts: pointsFor(c.abs_championid) }))
      .sort((a, b) => b.pts - a.pts),
    [champions, deptFilter, pointsFor],
  );

  const rankedDepartments = useMemo(() => {
    const totals = new Map<string, { pts: number; count: number }>();
    for (const c of champions) {
      const dept = c._crd49_department_value;
      if (!dept) continue;
      const cur = totals.get(dept) ?? { pts: 0, count: 0 };
      cur.pts += pointsFor(c.abs_championid);
      cur.count += 1;
      totals.set(dept, cur);
    }
    return [...totals.entries()]
      .map(([id, v]) => ({ name: departmentById.get(id)?.abs_name ?? '—', ...v }))
      .sort((a, b) => b.pts - a.pts);
  }, [champions, pointsFor, departmentById]);

  const rankedCampaigns = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of participations) {
      const cid = p._crd49_campaign_value;
      if (cid) counts.set(cid, (counts.get(cid) ?? 0) + 1);
    }
    return campaigns
      .map((c) => ({ c, participants: counts.get(c.abs_campaignid) ?? 0 }))
      .sort((a, b) => b.participants - a.participants);
  }, [campaigns, participations]);

  void pointsByChampion;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Leaderboard</h1>
          <div className="page-subtitle">Celebrate the champions and teams leading AI adoption.</div>
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'champions', label: 'Champions' },
          { key: 'departments', label: 'Departments' },
          { key: 'campaigns', label: 'Campaigns' },
        ]}
      />

      {tab === 'champions' && (
        <>
          <div className="row" style={{ marginBottom: 16 }}>
            <select className="select" style={{ maxWidth: 240 }} value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
              <option value="all">All Departments</option>
              {departments.map((d) => <option key={d.abs_departmentid} value={d.abs_departmentid}>{d.abs_name}</option>)}
            </select>
          </div>
          <Card>
            {rankedChampions.length === 0 ? <EmptyState icon="🏆" title="No champions to rank" /> : (
              <div className="list">
                {rankedChampions.map((r, i) => (
                  <div className="list-item" key={r.c.abs_championid}>
                    <Rank n={i + 1} />
                    <Avatar name={r.c.crd49_displayname ?? '?'} size={38} />
                    <div className="center-col spacer">
                      <span className="item-title">{r.c.crd49_displayname}</span>
                      <span className="item-sub">{departmentById.get(r.c._crd49_department_value ?? '')?.abs_name ?? '—'}</span>
                    </div>
                    <span className="points-badge">{r.pts} pts</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'departments' && (
        <Card>
          {rankedDepartments.length === 0 ? <EmptyState icon="🏢" title="No department data" /> : (
            <div className="list">
              {rankedDepartments.map((d, i) => (
                <div className="list-item" key={d.name}>
                  <Rank n={i + 1} />
                  <div className="center-col spacer">
                    <span className="item-title">{d.name}</span>
                    <span className="item-sub">{d.count} champions</span>
                  </div>
                  <span className="points-badge">{d.pts} pts</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'campaigns' && (
        <Card>
          {rankedCampaigns.length === 0 ? <EmptyState icon="📣" title="No campaigns" /> : (
            <div className="list">
              {rankedCampaigns.map((r, i) => (
                <div className="list-item" key={r.c.abs_campaignid}>
                  <Rank n={i + 1} />
                  <div className="center-col spacer">
                    <span className="item-title">{r.c.abs_name}</span>
                    <span className="item-sub">{r.c.crd49_theme || '—'}</span>
                  </div>
                  <Pill color={campaignStatusColor(r.c.crd49_status)}>{CampaignStatusLabel[r.c.crd49_status]}</Pill>
                  <span className="points-badge">{r.participants} 👥</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
}
