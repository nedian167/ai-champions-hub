import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppData } from '../context/AppDataContext';
import { CampaignsSvc, CampaignActivitiesSvc, CampaignParticipationsSvc, ActivitiesSvc, bind } from '../data/entities';
import { Card, KpiCard, Pill, EmptyState, Tabs, Avatar, Field } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { CampaignStatus, CampaignStatusLabel, ActivityType, ActivityTypeLabel, ValidationMode, ValidationModeLabel, optionsOf } from '../lib/enums';
import { formatDate, toDateInput } from '../lib/format';
import {
  effectiveCampaignStatus, effectiveStatusColor, effectiveStatusLabel, isCampaignExpired, isCampaignLive,
} from '../lib/campaignStatus';

type Tab = 'activities' | 'participants' | 'events';

export default function CampaignDetailScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const {
    campaignById, championById, departmentById, activityById,
    campaignDepartments, campaignActivities, participations, events, currentChampion, isAdmin, reload,
  } = useAppData();
  const toast = useToast();

  const campaign = id ? campaignById.get(id) : undefined;
  const [tab, setTab] = useState<Tab>('activities');
  const [editing, setEditing] = useState(false);
  const [showNewAct, setShowNewAct] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actForm, setActForm] = useState({
    title: '', description: '', type: ActivityType.OnlineCourse as number, points: 10,
    validation: ValidationMode.SelfClaimed as number, lmslink: '',
  });
  const [form, setForm] = useState(() => ({
    name: campaign?.abs_name ?? '',
    theme: campaign?.crd49_theme ?? '',
    description: campaign?.crd49_description ?? '',
    startdate: toDateInput(campaign?.crd49_startdate),
    enddate: toDateInput(campaign?.crd49_enddate),
    status: campaign?.crd49_status ?? CampaignStatus.Draft as number,
    imageurl: campaign?.crd49_imageurl ?? '',
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
        crd49_imageurl: form.imageurl.trim() ? form.imageurl.trim() : null,
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
  const canEdit = isAdmin || (!!currentChampion && campaign._crd49_campaignowner_value === currentChampion.abs_championid);
  const eff = effectiveCampaignStatus(campaign);
  const expired = isCampaignExpired(campaign);
  const live = isCampaignLive(campaign);
  const joined = !!currentChampion && parts.some((p) => p._crd49_champion_value === currentChampion.abs_championid);

  async function joinCampaign() {
    if (!currentChampion) return;
    setSaving(true);
    try {
      const res = await CampaignParticipationsSvc.create({
        abs_name: `${currentChampion.crd49_displayname ?? 'Champion'} · ${campaign!.abs_name}`,
        crd49_enrolleddate: new Date().toISOString(),
        'crd49_Campaign@odata.bind': bind('campaign', campaign!.abs_campaignid),
        'crd49_Champion@odata.bind': bind('champion', currentChampion.abs_championid),
      } as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Join failed');
      toast.success(`You've joined ${campaign!.abs_name}. Its activities are now available.`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to join campaign.');
    } finally {
      setSaving(false);
    }
  }

  async function createActivity() {
    if (!actForm.title.trim()) { toast.error('Title is required.'); return; }
    setSaving(true);
    try {
      const res = await ActivitiesSvc.create({
        abs_title: actForm.title.trim(),
        crd49_description: actForm.description.trim() || undefined,
        crd49_activitytype: actForm.type,
        crd49_points: Number(actForm.points) || 0,
        crd49_validationmode: actForm.validation,
        crd49_lmslink: actForm.lmslink.trim() || undefined,
      } as never);
      if (!res.success || !res.data) throw new Error(res.error?.message ?? 'Create failed');
      const link = await CampaignActivitiesSvc.create({
        abs_name: actForm.title.trim(),
        'crd49_Activity@odata.bind': bind('activity', res.data.abs_activityid),
        'crd49_Campaign@odata.bind': bind('campaign', campaign!.abs_campaignid),
      } as never);
      if (!link.success) throw new Error(link.error?.message ?? 'Failed to link activity');
      toast.success('Activity created under this campaign.');
      setShowNewAct(false);
      setActForm({ title: '', description: '', type: ActivityType.OnlineCourse, points: 10, validation: ValidationMode.SelfClaimed, lmslink: '' });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create activity.');
    } finally {
      setSaving(false);
    }
  }

  async function reactivate() {
    setSaving(true);
    try {
      const newEnd = new Date();
      newEnd.setDate(newEnd.getDate() + 30);
      const res = await CampaignsSvc.update(campaign!.abs_campaignid, {
        crd49_status: CampaignStatus.Active,
        crd49_enddate: newEnd.toISOString(),
      } as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Update failed');
      toast.success(`Campaign reactivated — new end date ${formatDate(newEnd.toISOString())}.`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reactivate campaign.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="link" onClick={() => nav('/campaigns')}>← Campaigns</span>
      </div>
      {campaign.crd49_imageurl && (
        <div
          className="campaign-hero"
          style={{ backgroundImage: `url("${campaign.crd49_imageurl}")` }}
        />
      )}
      <div className="page-header">
        <div>
          <div className="row">
            <h1>{campaign.abs_name}</h1>
            <Pill color={effectiveStatusColor(eff)}>{effectiveStatusLabel[eff]}</Pill>
          </div>
          <div className="page-subtitle">{campaign.crd49_theme || 'Campaign'}</div>
        </div>
        <div className="row">
          {!isAdmin && currentChampion && (
            joined ? (
              <Pill color="green">✓ Joined</Pill>
            ) : live ? (
              <button className="btn btn-primary" disabled={saving} onClick={joinCampaign}>{saving ? 'Joining…' : '➕ Join Campaign'}</button>
            ) : (
              <Pill color="gray">Inactive — can't join</Pill>
            )
          )}
          {isAdmin && <button className="btn btn-secondary" onClick={() => setShowNewAct(true)}>🎯 New Activity</button>}
          {canEdit && <button className="btn btn-secondary" onClick={() => setEditing(true)}>✏️ Edit</button>}
        </div>
      </div>

      {expired && (
        <div className="notice notice-warning" role="status">
          <div className="center-col spacer">
            <b>⏰ This campaign is inactive</b>
            <span className="item-sub">
              It ended on {formatDate(campaign.crd49_enddate)}. {canEdit
                ? 'Extend the end date to a future date to reactivate it.'
                : 'Contact a program manager to reactivate it.'}
            </span>
          </div>
          {canEdit && (
            <div className="row">
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Change end date</button>
              <button className="btn btn-primary btn-sm" disabled={saving} onClick={reactivate}>
                {saving ? 'Reactivating…' : 'Reactivate +30 days'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-kpi">
        <KpiCard label="Activities" value={acts.length} icon="🎯" iconBg="var(--green-soft)" iconColor="var(--green)" onClick={() => setTab('activities')} />
        <KpiCard label="Participants" value={parts.length} icon="👥" iconBg="var(--purple-soft)" iconColor="var(--purple)" onClick={() => setTab('participants')} />
        <KpiCard label="Events" value={camEvents.length} icon="📅" iconBg="var(--blue-soft)" iconColor="var(--blue)" onClick={() => setTab('events')} />
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
          acts.length === 0 ? (
            <EmptyState
              icon="🎯"
              title="No activities linked"
              message={isAdmin ? 'Add the first activity for this campaign.' : live ? 'Join this campaign to be notified when activities are added.' : undefined}
              action={isAdmin ? <button className="btn btn-primary" onClick={() => setShowNewAct(true)}>🎯 New Activity</button> : undefined}
            />
          ) : (
            <div className="list">
              {acts.map((a) => a && (
                <div
                  className="list-item clickable"
                  key={a.abs_activityid}
                  role="button"
                  tabIndex={0}
                  onClick={() => nav('/activities')}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); nav('/activities'); } }}
                >
                  <div className="center-col spacer">
                    <span className="item-title">{a.abs_title}</span>
                    <span className="item-sub">{ActivityTypeLabel[a.crd49_activitytype]}</span>
                  </div>
                  {!live && <Pill color="gray">Inactive</Pill>}
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
          <Field label="Banner image URL" help="Paste a link to an image. Leave empty to remove the banner.">
            <input className="input" value={form.imageurl} onChange={(e) => setForm({ ...form, imageurl: e.target.value })} placeholder="https://…/banner.png" />
          </Field>
        </Modal>
      )}

      {showNewAct && (
        <Modal
          title={`New Activity · ${campaign.abs_name}`}
          wide
          onClose={() => setShowNewAct(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowNewAct(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={createActivity}>{saving ? 'Saving…' : 'Create Activity'}</button>
            </>
          }
        >
          <div className="help-text" style={{ marginBottom: 12 }}>This activity will be linked to <b>{campaign.abs_name}</b>. Champions must join this campaign to access it.</div>
          <Field label="Title"><input className="input" value={actForm.title} onChange={(e) => setActForm({ ...actForm, title: e.target.value })} /></Field>
          <Field label="Description"><textarea className="textarea" value={actForm.description} onChange={(e) => setActForm({ ...actForm, description: e.target.value })} /></Field>
          <div className="field-row">
            <Field label="Type">
              <select className="select" value={actForm.type} onChange={(e) => setActForm({ ...actForm, type: Number(e.target.value) })}>
                {optionsOf(ActivityTypeLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Points"><input type="number" className="input" value={actForm.points} onChange={(e) => setActForm({ ...actForm, points: Number(e.target.value) })} /></Field>
          </div>
          <div className="field-row">
            <Field label="Validation mode">
              <select className="select" value={actForm.validation} onChange={(e) => setActForm({ ...actForm, validation: Number(e.target.value) })}>
                {optionsOf(ValidationModeLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="LMS link"><input className="input" value={actForm.lmslink} onChange={(e) => setActForm({ ...actForm, lmslink: e.target.value })} placeholder="https://…" /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}
