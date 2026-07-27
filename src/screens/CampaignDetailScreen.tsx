import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppData } from '../context/AppDataContext';
import { CampaignsSvc } from '../data/entities';
import { Card, KpiCard, Pill, EmptyState, Tabs, Avatar, Field } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { CampaignStatus, CampaignStatusLabel, ActivityTypeLabel, optionsOf } from '../lib/enums';
import { formatDate, toDateInput } from '../lib/format';
import { campaignStatusColor } from './HomeScreen';

type Tab = 'activities' | 'participants' | 'events';

export default function CampaignDetailScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const {
    campaignById, championById, departmentById, activityById,
    campaignDepartments, campaignActivities, participations, events, isAdmin, reload,
  } = useAppData();
  const toast = useToast();

  const campaign = id ? campaignById.get(id) : undefined;
  const [tab, setTab] = useState<Tab>('activities');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    name: campaign?.abs_name ?? '',
    theme: campaign?.crd49_theme ?? '',
    description: campaign?.crd49_description ?? '',
    startdate: toDateInput(campaign?.crd49_startdate),
    enddate: toDateInput(campaign?.crd49_enddate),
    status: campaign?.crd49_status ?? CampaignStatus.Draft as number,
  }));

  const audience = useMemo(
    () => campaignDepartments
      .filter((cd) => cd._abs_campaign_value === id)
      .map((cd) => departmentById.get(cd._abs_department_value ?? '')?.abs_name)
      .filter(Boolean) as string[],
    [campaignDepartments, departmentById, id],
  );

  const acts = useMemo(
    () => campaignActivities.filter((ca) => ca._crd49_campaign_value === id)
      .map((ca) => activityById.get(ca._crd49_activity_value ?? ''))
      .filter(Boolean),
    [campaignActivities, activityById, id],
  );

  const parts = useMemo(
    () => participations.filter((p) => p._crd49_campaign_value === id),
    [participations, id],
  );

  const camEvents = useMemo(() => events.filter((e) => e._crd49_campaign_value === id), [events, id]);

  if (!campaign) {
    return (
      <Card><EmptyState icon="🔍" title="Campaign not found" message="It may have been removed." action={<button className="btn btn-secondary" onClick={() => nav('/campaigns')}>Back to campaigns</button>} /></Card>
    );
  }

  async function save() {
    setSaving(true);
    try {
      const res = await CampaignsSvc.update(campaign!.abs_campaignid, {
        abs_name: form.name.trim(),
        crd49_theme: form.theme.trim() || undefined,
        crd49_description: form.description.trim() || undefined,
        crd49_startdate: form.startdate ? new Date(form.startdate).toISOString() : undefined,
        crd49_enddate: form.enddate ? new Date(form.enddate).toISOString() : undefined,
        crd49_status: form.status,
      } as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Update failed');
      toast.success('Campaign updated.');
      setEditing(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update campaign.');
    } finally {
      setSaving(false);
    }
  }

  const owner = championById.get(campaign._crd49_campaignowner_value ?? '');

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="link" onClick={() => nav('/campaigns')}>← Campaigns</span>
      </div>
      <div className="page-header">
        <div>
          <div className="row">
            <h1>{campaign.abs_name}</h1>
            <Pill color={campaignStatusColor(campaign.crd49_status)}>{CampaignStatusLabel[campaign.crd49_status]}</Pill>
          </div>
          <div className="page-subtitle">{campaign.crd49_theme || 'Campaign'}</div>
        </div>
        {isAdmin && <button className="btn btn-secondary" onClick={() => setEditing(true)}>✏️ Edit</button>}
      </div>

      <div className="grid grid-kpi">
        <KpiCard label="Activities" value={acts.length} icon="🎯" iconBg="var(--green-soft)" iconColor="var(--green)" />
        <KpiCard label="Participants" value={parts.length} icon="👥" iconBg="var(--purple-soft)" iconColor="var(--purple)" />
        <KpiCard label="Events" value={camEvents.length} icon="📅" iconBg="var(--blue-soft)" iconColor="var(--blue)" />
      </div>

      <div className="grid grid-2 mt-24">
        <Card title="Overview">
          <p className="text-muted">{campaign.crd49_description || 'No description provided.'}</p>
          <div className="divider" />
          <div className="stat-inline">
            <div className="si"><span className="item-sub">Start</span><b>{formatDate(campaign.crd49_startdate)}</b></div>
            <div className="si"><span className="item-sub">End</span><b>{formatDate(campaign.crd49_enddate)}</b></div>
            <div className="si"><span className="item-sub">Owner</span><b>{owner?.crd49_displayname ?? 'Unassigned'}</b></div>
          </div>
        </Card>
        <Card title="Audience">
          {audience.length === 0 ? (
            <Pill color="gray">All Employees</Pill>
          ) : (
            <div className="row">{audience.map((a) => <Pill key={a} color="purple">{a}</Pill>)}</div>
          )}
        </Card>
      </div>

      <div className="mt-24">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'activities', label: `Activities (${acts.length})` },
            { key: 'participants', label: `Participants (${parts.length})` },
            { key: 'events', label: `Events (${camEvents.length})` },
          ]}
        />
      </div>

      <Card>
        {tab === 'activities' && (
          acts.length === 0 ? <EmptyState icon="🎯" title="No activities linked" /> : (
            <div className="list">
              {acts.map((a) => a && (
                <div className="list-item" key={a.abs_activityid}>
                  <div className="center-col spacer">
                    <span className="item-title">{a.abs_title}</span>
                    <span className="item-sub">{ActivityTypeLabel[a.crd49_activitytype]}</span>
                  </div>
                  <span className="points-badge">{a.crd49_points} pts</span>
                </div>
              ))}
            </div>
          )
        )}
        {tab === 'participants' && (
          parts.length === 0 ? <EmptyState icon="👥" title="No participants yet" /> : (
            <div className="list">
              {parts.map((p) => {
                const champ = championById.get(p._crd49_champion_value ?? '');
                return (
                  <div className="list-item" key={p.abs_campaignparticipationid}>
                    <Avatar name={champ?.crd49_displayname ?? '?'} size={34} />
                    <div className="center-col spacer">
                      <span className="item-title">{champ?.crd49_displayname ?? 'Unknown'}</span>
                      <span className="item-sub">Enrolled {formatDate(p.crd49_enrolleddate)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
        {tab === 'events' && (
          camEvents.length === 0 ? <EmptyState icon="📅" title="No events" /> : (
            <div className="list">
              {camEvents.map((e) => (
                <div className="list-item" key={e.abs_eventid}>
                  <div className="center-col spacer">
                    <span className="item-title">{e.abs_name}</span>
                    <span className="item-sub">{formatDate(e.crd49_eventdate)} · {e.crd49_location || 'Online'}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </Card>

      {editing && (
        <Modal
          title="Edit Campaign"
          wide
          onClose={() => setEditing(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save Changes'}</button>
            </>
          }
        >
          <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Theme"><input className="input" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} /></Field>
          <Field label="Description"><textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="field-row">
            <Field label="Start date"><input type="date" className="input" value={form.startdate} onChange={(e) => setForm({ ...form, startdate: e.target.value })} /></Field>
            <Field label="End date"><input type="date" className="input" value={form.enddate} onChange={(e) => setForm({ ...form, enddate: e.target.value })} /></Field>
          </div>
          <Field label="Status">
            <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: Number(e.target.value) })}>
              {optionsOf(CampaignStatusLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </Modal>
      )}
    </>
  );
}
