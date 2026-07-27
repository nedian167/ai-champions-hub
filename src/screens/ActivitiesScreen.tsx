import { useMemo, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import {
  ActivitiesSvc, ActivityClaimsSvc, ClaimEvidencesSvc, ChampionsSvc, bind,
} from '../data/entities';
import { Card, KpiCard, Pill, EmptyState, Tabs, Avatar, Field } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import {
  ActivityType, ActivityTypeLabel, ValidationMode, ValidationModeLabel,
  ClaimStatus, ClaimStatusLabel, optionsOf,
} from '../lib/enums';
import { formatDate } from '../lib/format';
import type { PillColor } from '../components/ui';
import type { Abs_activities } from '../data/entities';

type Tab = 'activities' | 'claims';

function claimColor(s?: number): PillColor {
  return s === ClaimStatus.Approved ? 'green' : s === ClaimStatus.Rejected ? 'red' : 'amber';
}

export default function ActivitiesScreen() {
  const {
    activities, claims, campaigns, settings, currentChampion, isAdmin, reload,
    championById, activityById, campaignById, pointsFor,
  } = useAppData();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('activities');
  const [typeFilter, setTypeFilter] = useState<number | 'all'>('all');
  const [showNew, setShowNew] = useState(false);
  const [claimFor, setClaimFor] = useState<Abs_activities | null>(null);
  const [saving, setSaving] = useState(false);

  const [newForm, setNewForm] = useState({
    title: '', description: '', type: ActivityType.OnlineCourse as number, points: 10,
    validation: ValidationMode.SelfClaimed as number, lmslink: '',
  });
  const [claimForm, setClaimForm] = useState({ campaign: '', notes: '', evidenceurl: '' });

  const myPoints = pointsFor(currentChampion?.abs_championid);
  const myClaims = claims.filter((c) => c._crd49_champion_value === currentChampion?.abs_championid);
  const pendingClaims = claims.filter((c) => c.crd49_status === ClaimStatus.Pending);
  const approvedClaims = claims.filter((c) => c.crd49_status === ClaimStatus.Approved);
  const totalPoints = useMemo(
    () => approvedClaims.reduce((s, c) => s + (activityById.get(c._crd49_activity_value ?? '')?.crd49_points ?? 0), 0),
    [approvedClaims, activityById],
  );

  const shownActivities = activities.filter((a) => typeFilter === 'all' || a.crd49_activitytype === typeFilter);
  const shownClaims = isAdmin ? claims : myClaims;

  async function createActivity() {
    if (!newForm.title.trim()) { toast.error('Title is required.'); return; }
    setSaving(true);
    try {
      const res = await ActivitiesSvc.create({
        abs_title: newForm.title.trim(),
        crd49_description: newForm.description.trim() || undefined,
        crd49_activitytype: newForm.type,
        crd49_points: Number(newForm.points) || 0,
        crd49_validationmode: newForm.validation,
        crd49_lmslink: newForm.lmslink.trim() || undefined,
      } as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Create failed');
      toast.success('Activity created.');
      setShowNew(false);
      setNewForm({ title: '', description: '', type: ActivityType.OnlineCourse, points: 10, validation: ValidationMode.SelfClaimed, lmslink: '' });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create activity.');
    } finally {
      setSaving(false);
    }
  }

  async function submitClaim() {
    if (!currentChampion) { toast.error('No champion record found for you.'); return; }
    if (!claimFor || !claimForm.campaign) { toast.error('Select a campaign for this claim.'); return; }
    setSaving(true);
    try {
      const selfClaimed = claimFor.crd49_validationmode === ValidationMode.SelfClaimed
        && !settings?.crd49_activityapprovalrequired;
      const status = selfClaimed ? ClaimStatus.Approved : ClaimStatus.Pending;
      const res = await ActivityClaimsSvc.create({
        abs_name: `${currentChampion.crd49_displayname} · ${claimFor.abs_title}`,
        'crd49_Activity@odata.bind': bind('activity', claimFor.abs_activityid),
        'crd49_Campaign@odata.bind': bind('campaign', claimForm.campaign),
        'crd49_Champion@odata.bind': bind('champion', currentChampion.abs_championid),
        crd49_claimeddate: new Date().toISOString(),
        crd49_notes: claimForm.notes.trim() || undefined,
        crd49_status: status,
      } as never);
      if (!res.success || !res.data) throw new Error(res.error?.message ?? 'Claim failed');

      if (claimForm.evidenceurl.trim()) {
        await ClaimEvidencesSvc.create({
          abs_name: 'Evidence',
          'abs_ActivityClaim@odata.bind': bind('activityclaim', res.data.abs_activityclaimid),
          abs_evidenceurl: claimForm.evidenceurl.trim(),
          abs_uploadeddate: new Date().toISOString(),
          abs_notes: claimForm.notes.trim() || undefined,
        } as never);
      }

      if (status === ClaimStatus.Approved) {
        await bumpPoints(currentChampion.abs_championid, claimFor.crd49_points ?? 0);
      }
      toast.success(selfClaimed ? 'Activity claimed and approved!' : 'Claim submitted for approval.');
      setClaimFor(null);
      setClaimForm({ campaign: '', notes: '', evidenceurl: '' });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to submit claim.');
    } finally {
      setSaving(false);
    }
  }

  async function bumpPoints(championId: string, delta: number) {
    const champ = championById.get(championId);
    const current = champ?.crd49_totalpoints ?? 0;
    await ChampionsSvc.update(championId, { crd49_totalpoints: current + delta } as never);
  }

  async function decide(claimId: string, approve: boolean) {
    setSaving(true);
    try {
      const claim = claims.find((c) => c.abs_activityclaimid === claimId);
      const res = await ActivityClaimsSvc.update(claimId, {
        crd49_status: approve ? ClaimStatus.Approved : ClaimStatus.Rejected,
      } as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Update failed');
      if (approve && claim) {
        const pts = activityById.get(claim._crd49_activity_value ?? '')?.crd49_points ?? 0;
        if (claim._crd49_champion_value) await bumpPoints(claim._crd49_champion_value, pts);
      }
      toast.success(approve ? 'Claim approved.' : 'Claim rejected.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update claim.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Activities</h1>
          <div className="page-subtitle">Earn points by completing learning activities and claiming them.</div>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={() => setShowNew(true)}>➕ New Activity</button>}
      </div>

      <div className="grid grid-kpi">
        <KpiCard label="Your Points" value={myPoints} icon="⭐" iconBg="var(--amber-soft)" iconColor="var(--amber)" />
        <KpiCard label="Your Completed" value={myClaims.filter((c) => c.crd49_status === ClaimStatus.Approved).length} icon="✅" iconBg="var(--green-soft)" iconColor="var(--green)" />
        <KpiCard label="Your Pending" value={myClaims.filter((c) => c.crd49_status === ClaimStatus.Pending).length} icon="⏳" iconBg="var(--amber-soft)" iconColor="var(--amber)" />
        <KpiCard label="Total Activities" value={activities.length} icon="🎯" iconBg="var(--blue-soft)" iconColor="var(--blue)" />
        <KpiCard label="Pending Claims" value={pendingClaims.length} icon="📥" iconBg="var(--purple-soft)" iconColor="var(--purple)" />
        <KpiCard label="Approved Claims" value={approvedClaims.length} icon="🏅" iconBg="var(--green-soft)" iconColor="var(--green)" />
        <KpiCard label="Total Points" value={totalPoints} icon="💯" iconBg="var(--primary-soft)" iconColor="var(--primary)" />
      </div>

      <div className="mt-24">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'activities', label: `Activities (${activities.length})` },
            { key: 'claims', label: `Claims (${shownClaims.length})` },
          ]}
        />
      </div>

      {tab === 'activities' && (
        <>
          <div className="row" style={{ marginBottom: 16 }}>
            <select className="select" style={{ maxWidth: 220 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">All Types</option>
              {optionsOf(ActivityTypeLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {shownActivities.length === 0 ? (
            <Card><EmptyState icon="🎯" title="No activities" message="Create an activity to get started." /></Card>
          ) : (
            <div className="grid grid-cards">
              {shownActivities.map((a) => (
                <div className="card entity-card" key={a.abs_activityid}>
                  <div className="ec-head">
                    <span className="points-badge">{a.crd49_points} pts</span>
                    <Pill color="blue">{ActivityTypeLabel[a.crd49_activitytype]}</Pill>
                  </div>
                  <h3>{a.abs_title}</h3>
                  <p className="entity-desc">{a.crd49_description || 'No description.'}</p>
                  <div className="row">
                    <Pill color={a.crd49_validationmode === ValidationMode.SelfClaimed ? 'green' : 'amber'}>
                      {ValidationModeLabel[a.crd49_validationmode]}
                    </Pill>
                  </div>
                  {a.crd49_lmslink && <a href={a.crd49_lmslink} target="_blank" rel="noreferrer" className="tag-link link">🔗 Open Learning Content</a>}
                  <div className="divider" />
                  {currentChampion ? (
                    <button className="btn btn-primary btn-sm btn-block" onClick={() => { setClaimFor(a); setClaimForm({ campaign: '', notes: '', evidenceurl: settings?.crd49_sharepointurl ?? '' }); }}>
                      Claim Activity
                    </button>
                  ) : (
                    <span className="help-text">Join a campaign with this activity to earn points.</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'claims' && (
        <Card>
          {shownClaims.length === 0 ? (
            <EmptyState icon="📥" title="No claims yet" message="Claim an activity to see it here." />
          ) : (
            <div className="list">
              {shownClaims.map((cl) => {
                const champ = championById.get(cl._crd49_champion_value ?? '');
                const act = activityById.get(cl._crd49_activity_value ?? '');
                const camp = campaignById.get(cl._crd49_campaign_value ?? '');
                return (
                  <div className="list-item" key={cl.abs_activityclaimid}>
                    <Avatar name={champ?.crd49_displayname ?? '?'} size={36} />
                    <div className="center-col spacer">
                      <span className="item-title">{act?.abs_title ?? 'Activity'}</span>
                      <span className="item-sub">{champ?.crd49_displayname ?? 'Unknown'} · {camp?.abs_name ?? '—'} · {formatDate(cl.crd49_claimeddate)}</span>
                    </div>
                    <Pill color={claimColor(cl.crd49_status)}>{ClaimStatusLabel[cl.crd49_status]}</Pill>
                    {isAdmin && cl.crd49_status === ClaimStatus.Pending && (
                      <div className="row">
                        <button className="btn btn-success btn-sm" disabled={saving} onClick={() => decide(cl.abs_activityclaimid, true)}>Approve</button>
                        <button className="btn btn-danger btn-sm" disabled={saving} onClick={() => decide(cl.abs_activityclaimid, false)}>Reject</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {showNew && (
        <Modal
          title="New Activity"
          wide
          onClose={() => setShowNew(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={createActivity}>{saving ? 'Saving…' : 'Create Activity'}</button>
            </>
          }
        >
          <Field label="Title"><input className="input" value={newForm.title} onChange={(e) => setNewForm({ ...newForm, title: e.target.value })} /></Field>
          <Field label="Description"><textarea className="textarea" value={newForm.description} onChange={(e) => setNewForm({ ...newForm, description: e.target.value })} /></Field>
          <div className="field-row">
            <Field label="Type">
              <select className="select" value={newForm.type} onChange={(e) => setNewForm({ ...newForm, type: Number(e.target.value) })}>
                {optionsOf(ActivityTypeLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Points"><input type="number" className="input" value={newForm.points} onChange={(e) => setNewForm({ ...newForm, points: Number(e.target.value) })} /></Field>
          </div>
          <div className="field-row">
            <Field label="Validation mode">
              <select className="select" value={newForm.validation} onChange={(e) => setNewForm({ ...newForm, validation: Number(e.target.value) })}>
                {optionsOf(ValidationModeLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="LMS link"><input className="input" value={newForm.lmslink} onChange={(e) => setNewForm({ ...newForm, lmslink: e.target.value })} placeholder="https://…" /></Field>
          </div>
        </Modal>
      )}

      {claimFor && (
        <Modal
          title={`Claim: ${claimFor.abs_title}`}
          onClose={() => setClaimFor(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setClaimFor(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={submitClaim}>{saving ? 'Submitting…' : 'Submit Claim'}</button>
            </>
          }
        >
          <Field label="Campaign" help="Choose the campaign you're claiming this under.">
            <select className="select" value={claimForm.campaign} onChange={(e) => setClaimForm({ ...claimForm, campaign: e.target.value })}>
              <option value="">Select a campaign…</option>
              {campaigns.map((c) => <option key={c.abs_campaignid} value={c.abs_campaignid}>{c.abs_name}</option>)}
            </select>
          </Field>
          <Field label="Notes"><textarea className="textarea" value={claimForm.notes} onChange={(e) => setClaimForm({ ...claimForm, notes: e.target.value })} placeholder="Anything the approver should know…" /></Field>
          <div className="divider" />
          <div className="help-text" style={{ marginBottom: 8 }}>
            Evidence — upload your file to the program SharePoint library, then paste the link below.
          </div>
          {settings?.crd49_sharepointurl && (
            <a href={settings.crd49_sharepointurl} target="_blank" rel="noreferrer" className="link tag-link">📁 Open SharePoint library</a>
          )}
          <div className="mt-16">
            <Field label="Evidence URL" help="Paste a link to your supporting evidence.">
              <input className="input" value={claimForm.evidenceurl} onChange={(e) => setClaimForm({ ...claimForm, evidenceurl: e.target.value })} placeholder="https://…" />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
