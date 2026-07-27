import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppData } from '../context/AppDataContext';
import {
  ActivitiesSvc, ActivityClaimsSvc, ClaimEvidencesSvc, ChampionsSvc, CampaignActivitiesSvc, bind,
} from '../data/entities';
import { Card, KpiCard, Pill, EmptyState, Tabs, Avatar, Field } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import {
  ActivityType, ActivityTypeLabel, ValidationMode, ValidationModeLabel,
  ClaimStatus, ClaimStatusLabel, optionsOf,
} from '../lib/enums';
import { formatDate } from '../lib/format';
import { isCampaignLive } from '../lib/campaignStatus';
import {
  campaignIdsForActivity, isActivityActive, claimableCampaignsForActivity, joinedCampaignIds,
} from '../lib/access';
import type { PillColor } from '../components/ui';
import type { Abs_activities, Abs_activityclaims } from '../data/entities';

type Tab = 'activities' | 'claims';

function claimColor(s?: number): PillColor {
  return s === ClaimStatus.Approved ? 'green' : s === ClaimStatus.Rejected ? 'red' : 'amber';
}

export default function ActivitiesScreen() {
  const {
    activities, claims, evidence, campaigns, campaignActivities, participations,
    settings, currentChampion, isAdmin, reload,
    championById, activityById, campaignById, pointsFor,
  } = useAppData();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>(
    () => ((location.state as { tab?: Tab } | null)?.tab === 'claims' ? 'claims' : 'activities'),
  );
  const [typeFilter, setTypeFilter] = useState<number | 'all'>('all');
  const [claimStatusFilter, setClaimStatusFilter] = useState<number | 'all'>(
    () => {
      const s = (location.state as { claimStatus?: number } | null)?.claimStatus;
      return typeof s === 'number' ? s : 'all';
    },
  );
  const [showNew, setShowNew] = useState(false);
  const [claimFor, setClaimFor] = useState<Abs_activities | null>(null);
  const [detail, setDetail] = useState<Abs_activityclaims | null>(null);
  const [saving, setSaving] = useState(false);
  const autoOpenedRef = useRef<string | null>(null);

  const [newForm, setNewForm] = useState({
    title: '', description: '', type: ActivityType.OnlineCourse as number, points: 10,
    validation: ValidationMode.SelfClaimed as number, lmslink: '', campaign: '',
  });
  const [claimForm, setClaimForm] = useState({ campaign: '', notes: '', evidenceurl: '' });

  const myPoints = pointsFor(currentChampion?.abs_championid);
  const myClaims = claims.filter((c) => c._crd49_champion_value === currentChampion?.abs_championid);
  const isChampionView = !!currentChampion && !isAdmin;
  const pendingClaims = claims.filter((c) => c.crd49_status === ClaimStatus.Pending);
  const approvedClaims = claims.filter((c) => c.crd49_status === ClaimStatus.Approved);
  const totalPoints = useMemo(
    () => approvedClaims.reduce((s, c) => s + (activityById.get(c._crd49_activity_value ?? '')?.crd49_points ?? 0), 0),
    [approvedClaims, activityById],
  );

  const shownActivities = activities.filter((a) => typeFilter === 'all' || a.crd49_activitytype === typeFilter);

  // Campaigns the current champion has joined that are still live — these unlock activities.
  const joinedLiveCampaigns = useMemo(
    () => {
      const joined = joinedCampaignIds(currentChampion?.abs_championid, participations);
      return campaigns.filter((c) => joined.has(c.abs_campaignid) && isCampaignLive(c));
    },
    [campaigns, participations, currentChampion],
  );

  // Activity ids a champion can access = linked to a joined+live campaign.
  const accessibleActivityIds = useMemo(() => {
    const set = new Set<string>();
    const liveJoined = new Set(joinedLiveCampaigns.map((c) => c.abs_campaignid));
    for (const ca of campaignActivities) {
      if (ca._crd49_campaign_value && liveJoined.has(ca._crd49_campaign_value) && ca._crd49_activity_value) {
        set.add(ca._crd49_activity_value);
      }
    }
    return set;
  }, [campaignActivities, joinedLiveCampaigns]);

  // Admins see every activity; champions see only the ones their joined campaigns unlock.
  const visibleActivities = useMemo(
    () => (isAdmin ? shownActivities : shownActivities.filter((a) => accessibleActivityIds.has(a.abs_activityid))),
    [isAdmin, shownActivities, accessibleActivityIds],
  );

  const allClaims = isAdmin ? claims : myClaims;
  const shownClaims = allClaims.filter((c) => claimStatusFilter === 'all' || c.crd49_status === claimStatusFilter);

  function goClaims(status: number | 'all') {
    setClaimStatusFilter(status);
    setTab('claims');
  }

  useEffect(() => {
    const openId = (location.state as { openClaimId?: string } | null)?.openClaimId;
    if (openId && autoOpenedRef.current !== openId) {
      const cl = claims.find((c) => c.abs_activityclaimid === openId);
      if (cl) {
        autoOpenedRef.current = openId;
        setTab('claims');
        setDetail(cl);
      }
    }
  }, [location.state, claims]);

  useEffect(() => {
    const st = location.state as { openNew?: boolean; campaignId?: string } | null;
    if (st?.openNew && autoOpenedRef.current !== 'new') {
      autoOpenedRef.current = 'new';
      openNewActivity(st.campaignId);
      navigate(location.pathname, { replace: true, state: { tab: 'activities' } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  function closeDetail() {
    setDetail(null);
    if ((location.state as { openClaimId?: string } | null)?.openClaimId) {
      navigate(location.pathname, { replace: true, state: { tab: 'claims', claimStatus: ClaimStatus.Pending } });
      autoOpenedRef.current = null;
    }
  }

  async function createActivity() {
    if (!newForm.title.trim()) { toast.error('Title is required.'); return; }
    if (!newForm.campaign) { toast.error('Select the campaign this activity belongs to.'); return; }
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
      if (!res.success || !res.data) throw new Error(res.error?.message ?? 'Create failed');

      // Link the new activity to its campaign (activities are always created under a campaign).
      const link = await CampaignActivitiesSvc.create({
        abs_name: newForm.title.trim(),
        'crd49_Activity@odata.bind': bind('activity', res.data.abs_activityid),
        'crd49_Campaign@odata.bind': bind('campaign', newForm.campaign),
      } as never);
      if (!link.success) throw new Error(link.error?.message ?? 'Failed to link activity to campaign');

      toast.success('Activity created under campaign.');
      setShowNew(false);
      setNewForm({ title: '', description: '', type: ActivityType.OnlineCourse, points: 10, validation: ValidationMode.SelfClaimed, lmslink: '', campaign: '' });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create activity.');
    } finally {
      setSaving(false);
    }
  }

  function openNewActivity(campaignId?: string) {
    setNewForm({ title: '', description: '', type: ActivityType.OnlineCourse, points: 10, validation: ValidationMode.SelfClaimed, lmslink: '', campaign: campaignId ?? '' });
    setShowNew(true);
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

      let evidenceFailed = false;
      if (claimForm.evidenceurl.trim()) {
        const evRes = await ClaimEvidencesSvc.create({
          abs_name: 'Evidence',
          'abs_ActivityClaim@odata.bind': bind('activityclaim', res.data.abs_activityclaimid),
          abs_evidenceurl: claimForm.evidenceurl.trim(),
          abs_uploadeddate: new Date().toISOString(),
          abs_notes: claimForm.notes.trim() || undefined,
        } as never);
        if (!evRes.success) {
          evidenceFailed = true;
          console.error('Evidence create failed:', evRes.error);
        }
      }

      if (status === ClaimStatus.Approved) {
        await bumpPoints(currentChampion.abs_championid, claimFor.crd49_points ?? 0);
      }
      if (evidenceFailed) {
        toast.error('Claim saved, but the evidence link could not be attached. Please try re-submitting the evidence.');
      } else {
        toast.success(selfClaimed ? 'Activity claimed and approved!' : 'Claim submitted for approval.');
      }
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
      setDetail(null);
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
        {isAdmin && <button className="btn btn-primary" onClick={() => openNewActivity()}>➕ New Activity</button>}
      </div>

      <div className="grid grid-kpi">
        {isChampionView ? (
          <>
            <KpiCard label="Your Points" value={myPoints} icon="⭐" iconBg="var(--amber-soft)" iconColor="var(--amber)" onClick={() => goClaims(ClaimStatus.Approved)} />
            <KpiCard label="Your Completed" value={myClaims.filter((c) => c.crd49_status === ClaimStatus.Approved).length} icon="✅" iconBg="var(--green-soft)" iconColor="var(--green)" onClick={() => goClaims(ClaimStatus.Approved)} />
            <KpiCard label="Your Pending" value={myClaims.filter((c) => c.crd49_status === ClaimStatus.Pending).length} icon="⏳" iconBg="var(--amber-soft)" iconColor="var(--amber)" onClick={() => goClaims(ClaimStatus.Pending)} />
            <KpiCard label="Available Activities" value={accessibleActivityIds.size} icon="🎯" iconBg="var(--blue-soft)" iconColor="var(--blue)" onClick={() => setTab('activities')} />
          </>
        ) : (
          <>
            <KpiCard label="Total Activities" value={activities.length} icon="🎯" iconBg="var(--blue-soft)" iconColor="var(--blue)" onClick={() => setTab('activities')} />
            <KpiCard label="Total Points" value={totalPoints} icon="💯" iconBg="var(--primary-soft)" iconColor="var(--primary)" onClick={() => goClaims(ClaimStatus.Approved)} />
            <KpiCard label="Pending Claims" value={pendingClaims.length} icon="📥" iconBg="var(--purple-soft)" iconColor="var(--purple)" onClick={() => goClaims(ClaimStatus.Pending)} />
            <KpiCard label="Approved Claims" value={approvedClaims.length} icon="🏅" iconBg="var(--green-soft)" iconColor="var(--green)" onClick={() => goClaims(ClaimStatus.Approved)} />
          </>
        )}
      </div>

      <div className="mt-24">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'activities', label: `Activities (${visibleActivities.length})` },
            { key: 'claims', label: `Claims (${allClaims.length})` },
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
          {visibleActivities.length === 0 ? (
            <Card>
              {isAdmin ? (
                <EmptyState icon="🎯" title="No activities" message="Create an activity under a campaign to get started." action={<button className="btn btn-primary" onClick={() => openNewActivity()}>➕ New Activity</button>} />
              ) : joinedLiveCampaigns.length === 0 ? (
                <EmptyState icon="🔒" title="Join a campaign to unlock activities" message="Activities live inside campaigns. Join an active campaign to see and claim its activities." action={<button className="btn btn-primary" onClick={() => navigate('/campaigns')}>Browse campaigns</button>} />
              ) : (
                <EmptyState icon="🎯" title="No activities available" message="The campaigns you've joined don't have any activities yet." />
              )}
            </Card>
          ) : (
            <div className="grid grid-cards">
              {visibleActivities.map((a) => {
                const linkedIds = campaignIdsForActivity(a.abs_activityid, campaignActivities);
                const linkedNames = linkedIds.map((cid) => campaignById.get(cid)?.abs_name).filter(Boolean) as string[];
                const active = isActivityActive(a.abs_activityid, campaignActivities, campaignById);
                const claimable = claimableCampaignsForActivity(a.abs_activityid, currentChampion?.abs_championid, campaignActivities, participations, campaignById);
                return (
                  <div className={`card entity-card${active ? '' : ' campaign-expired'}`} key={a.abs_activityid}>
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
                      {!active && <Pill color="gray">Inactive</Pill>}
                    </div>
                    <div className="item-sub" style={{ marginTop: 8 }}>
                      {linkedNames.length ? `📣 ${linkedNames.join(', ')}` : '📣 Not linked to a campaign'}
                    </div>
                    {a.crd49_lmslink && <a href={a.crd49_lmslink} target="_blank" rel="noreferrer" className="tag-link link">🔗 Open Learning Content</a>}
                    <div className="divider" />
                    {claimable.length > 0 ? (
                      <button className="btn btn-primary btn-sm btn-block" onClick={() => { setClaimFor(a); setClaimForm({ campaign: claimable.length === 1 ? claimable[0].abs_campaignid : '', notes: '', evidenceurl: settings?.crd49_sharepointurl ?? '' }); }}>
                        Claim Activity
                      </button>
                    ) : !active ? (
                      <span className="help-text">This activity's campaign is inactive.</span>
                    ) : currentChampion ? (
                      <span className="help-text">Join this activity's campaign to claim it.</span>
                    ) : (
                      <span className="help-text">Join a campaign to earn points.</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'claims' && (
        <Card>
          <div className="row" style={{ marginBottom: 16 }}>
            <select className="select" style={{ maxWidth: 220 }} value={claimStatusFilter} onChange={(e) => setClaimStatusFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">All Claim Status</option>
              {optionsOf(ClaimStatusLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {shownClaims.length === 0 ? (
            <EmptyState icon="📥" title="No claims yet" message="Claim an activity to see it here." />
          ) : (
            <div className="list">
              {shownClaims.map((cl) => {
                const champ = championById.get(cl._crd49_champion_value ?? '');
                const act = activityById.get(cl._crd49_activity_value ?? '');
                const camp = campaignById.get(cl._crd49_campaign_value ?? '');
                return (
                  <div
                    className="list-item clickable"
                    key={cl.abs_activityclaimid}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetail(cl)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail(cl); } }}
                  >
                    <Avatar name={champ?.crd49_displayname ?? '?'} size={36} />
                    <div className="center-col spacer">
                      <span className="item-title">{act?.abs_title ?? 'Activity'}</span>
                      <span className="item-sub">{champ?.crd49_displayname ?? 'Unknown'} · {camp?.abs_name ?? '—'} · {formatDate(cl.crd49_claimeddate)}</span>
                    </div>
                    <Pill color={claimColor(cl.crd49_status)}>{ClaimStatusLabel[cl.crd49_status]}</Pill>
                    {isAdmin && cl.crd49_status === ClaimStatus.Pending && (
                      <div className="row" onClick={(e) => e.stopPropagation()}>
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
          <Field label="Campaign" help="Activities are always created under a campaign. Champions must join the campaign to access this activity.">
            <select className="select" value={newForm.campaign} onChange={(e) => setNewForm({ ...newForm, campaign: e.target.value })}>
              <option value="">Select a campaign…</option>
              {campaigns.map((c) => <option key={c.abs_campaignid} value={c.abs_campaignid}>{c.abs_name}{isCampaignLive(c) ? '' : ' (inactive)'}</option>)}
            </select>
          </Field>
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
          <Field label="Campaign" help="You can only claim under a live campaign you've joined that includes this activity.">
            <select className="select" value={claimForm.campaign} onChange={(e) => setClaimForm({ ...claimForm, campaign: e.target.value })}>
              <option value="">Select a campaign…</option>
              {claimableCampaignsForActivity(claimFor.abs_activityid, currentChampion?.abs_championid, campaignActivities, participations, campaignById).map((c) => <option key={c.abs_campaignid} value={c.abs_campaignid}>{c.abs_name}</option>)}
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
      {detail && (() => {
        const champ = championById.get(detail._crd49_champion_value ?? '');
        const act = activityById.get(detail._crd49_activity_value ?? '');
        const camp = campaignById.get(detail._crd49_campaign_value ?? '');
        const pts = act?.crd49_points ?? 0;
        const ev = evidence.filter((e) => e._abs_activityclaim_value === detail.abs_activityclaimid);
        const canDecide = isAdmin && detail.crd49_status === ClaimStatus.Pending;
        return (
          <Modal
            title="Claim details"
            onClose={closeDetail}
            footer={
              canDecide ? (
                <>
                  <button className="btn btn-danger" disabled={saving} onClick={() => decide(detail.abs_activityclaimid, false)}>Reject</button>
                  <button className="btn btn-success" disabled={saving} onClick={() => decide(detail.abs_activityclaimid, true)}>{saving ? 'Saving…' : 'Approve'}</button>
                </>
              ) : (
                <button className="btn btn-secondary" onClick={closeDetail}>Close</button>
              )
            }
          >
            <div className="row" style={{ alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <Avatar name={champ?.crd49_displayname ?? '?'} size={44} />
              <div className="center-col spacer">
                <span className="item-title">{act?.abs_title ?? 'Activity'}</span>
                <span className="item-sub">{champ?.crd49_displayname ?? 'Unknown'}</span>
              </div>
              <Pill color={claimColor(detail.crd49_status)}>{ClaimStatusLabel[detail.crd49_status]}</Pill>
            </div>
            <div className="detail-grid">
              <div><span className="help-text">Campaign</span><div>{camp?.abs_name ?? '—'}</div></div>
              <div><span className="help-text">Points</span><div>{pts}</div></div>
              <div><span className="help-text">Claimed</span><div>{formatDate(detail.crd49_claimeddate)}</div></div>
              <div><span className="help-text">Type</span><div>{act ? ActivityTypeLabel[act.crd49_activitytype] : '—'}</div></div>
            </div>
            {detail.crd49_notes && (
              <>
                <div className="divider" />
                <span className="help-text">Notes</span>
                <div>{detail.crd49_notes}</div>
              </>
            )}
            <div className="divider" />
            <span className="help-text">Evidence</span>
            {ev.length === 0 ? (
              <div className="item-sub">No evidence attached.</div>
            ) : (
              <div className="list mt-8">
                {ev.map((e) => (
                  <div className="list-item" key={e.abs_claimevidenceid}>
                    <div className="center-col spacer">
                      {e.abs_evidenceurl ? (
                        <a href={e.abs_evidenceurl} target="_blank" rel="noreferrer" className="link item-title">🔗 Open evidence</a>
                      ) : (
                        <span className="item-title">Evidence</span>
                      )}
                      <span className="item-sub">{e.abs_notes ?? ''}{e.abs_uploadeddate ? ` · ${formatDate(e.abs_uploadeddate)}` : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Modal>
        );
      })()}
    </>
  );
}
