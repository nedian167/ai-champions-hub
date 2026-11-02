import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '../context/AppDataContext';
import { CampaignsSvc, EventsSvc } from '../data/entities';
import {
  assertActivityDeletionUnchanged, deleteUnclaimedActivity, inspectActivityDeletion, inspectDeletion,
  type ActivityDeletionImpact, type DeletionPreview, type RecordKind,
} from '../lib/deletion';
import { ClaimStatusLabel } from '../lib/enums';
import { formatDate } from '../lib/format';
import { Modal } from './Modal';
import { useToast } from './Toast';

interface DeleteRecordProps {
  kind: RecordKind;
  id: string;
  name: string;
  onClose: () => void;
  onDeleted?: () => void;
}

function ActivityImpact({
  impact, onClose, showCampaigns = true,
}: {
  impact: ActivityDeletionImpact;
  onClose: () => void;
  showCampaigns?: boolean;
}) {
  const { campaignById, championById } = useAppData();
  return (
    <div>
      {showCampaigns && (
        <>
          <p>{impact.claims.length
            ? 'This activity and its campaign links are protected because claims exist.'
            : 'Deleting this activity removes the individual activity record from every linked campaign, not just the current campaign.'}</p>
          <p>{impact.links.length
            ? `${impact.links.length} campaign link(s) ${impact.claims.length ? 'will be kept' : 'will also be removed'}:`
            : 'No campaign links were found.'} Campaigns themselves will be kept.</p>
          {impact.links.length > 0 && (
            <ul>
              {impact.links.map((link) => (
                <li key={link.abs_campaignactivityid}>
                  {link.crd49_campaignname ?? campaignById.get(link._crd49_campaign_value ?? '')?.abs_name ?? link._crd49_campaign_value ?? link.abs_name}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {impact.claims.length ? (
        <>
          <div className="notice notice-warning" role="alert">
            Deletion is protected: {impact.claims.length} linked claim(s) exist.
            Pending, approved, and rejected claims all protect this activity.
            The activity, its campaign links, claim evidence, and earned points will be kept.
            Review the claims below; rejecting a claim does not make the activity deletable.
          </div>
          <div className="list">
            {impact.claims.map((claim) => (
              <div className="list-item deletion-claim" key={claim.abs_activityclaimid}>
                <div>
                  <b>{claim.abs_name}</b>
                  <div className="help-text">
                    {claim.crd49_championname ?? championById.get(claim._crd49_champion_value ?? '')?.crd49_displayname ?? claim._crd49_champion_value}
                    {' - '}{ClaimStatusLabel[claim.crd49_status] ?? 'Unknown status'}
                    {' - '}{formatDate(claim.crd49_claimeddate)}
                  </div>
                  <div className="help-text">
                    {claim.crd49_campaignname ?? campaignById.get(claim._crd49_campaign_value ?? '')?.abs_name ?? claim._crd49_campaign_value}
                  </div>
                </div>
                <Link className="btn btn-secondary btn-sm" to="/activities" state={{ openClaimId: claim.abs_activityclaimid }} onClick={onClose}>
                  Open claim
                </Link>
              </div>
            ))}
          </div>
        </>
      ) : <p>No claims were found. No claim history or earned points will be deleted.</p>}
    </div>
  );
}

export function DeleteRecordModal(props: DeleteRecordProps) {
  return <DeletionDialog key={`${props.kind}:${props.id}`} {...props} />;
}

function DeletionDialog({ kind, id, name, onClose, onDeleted }: DeleteRecordProps) {
  const { isAdmin, reload } = useAppData();
  const toast = useToast();
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState<ActivityDeletionImpact[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    inspectDeletion(kind, id).then(
      (data) => { if (!cancelled) { setPreview(data); setLoading(false); } },
      (e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not check linked records.');
          setLoading(false);
        }
      },
    );
    return () => { cancelled = true; };
  }, [kind, id, isAdmin]);

  async function refreshPreview() {
    setLoading(true);
    setError('');
    setSelected([]);
    setReviewing(null);
    setAcknowledged(false);
    try {
      setPreview(await inspectDeletion(kind, id));
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : 'Could not check linked records.');
    } finally {
      setLoading(false);
    }
  }

  async function refreshApp() {
    try {
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? `Refresh failed: ${e.message}` : 'Refresh failed. Reload the page.');
    }
  }

  const targets = kind === 'activity' ? preview?.activities ?? [] : reviewing ?? [];
  const protectedActivity = targets.some((item) => item.claims.length > 0);
  const campaignBlocked = kind === 'campaign' && !reviewing
    && (!!preview?.activities.length || !!preview?.blockers.length);
  const canDelete = !!preview && !loading && !busy && !error && !protectedActivity && !campaignBlocked
    && (targets.length ? acknowledged : true);
  const eligible = preview?.activities.filter((item) => !item.claims.length) ?? [];
  const allSelected = eligible.length > 0 && eligible.every((item) => selected.includes(item.activity.abs_activityid));

  function review(items: ActivityDeletionImpact[]) {
    if (busy || loading || error || !items.length) return;
    setReviewing(items);
    setAcknowledged(false);
  }

  async function remove() {
    if (!isAdmin || !canDelete) return;
    setBusy(true);
    let completed = 0;
    try {
      if (targets.length) {
        // Check the whole selection before making the first destructive change.
        for (const target of targets) {
          assertActivityDeletionUnchanged(target, await inspectActivityDeletion(target.activity.abs_activityid));
        }
        for (const target of targets) {
          await deleteUnclaimedActivity(target);
          completed++;
        }
      } else {
        const current = await inspectDeletion(kind, id);
        if (current.activities.length || current.blockers.length) {
          setPreview(current);
          setSelected([]);
          setAcknowledged(false);
          throw new Error('Linked records changed. Review the current dependencies before deleting.');
        }
        if (kind === 'campaign') await CampaignsSvc.delete(id);
        else if (kind === 'event') await EventsSvc.delete(id);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Deletion failed.';
      await refreshApp();
      await refreshPreview();
      setError((current) => [
        completed ? `${completed} of ${targets.length} activities were deleted. No further activities were processed.` : '',
        message, current,
      ].filter(Boolean).join(' '));
      setBusy(false);
      return;
    }
    toast.success(targets.length
      ? `${completed} ${completed === 1 ? 'activity' : 'activities'} deleted. Campaigns were kept.`
      : `${kind === 'campaign' ? 'Campaign' : 'Event'} deleted.`);
    await refreshApp();
    if (kind === 'campaign' && reviewing) {
      await refreshPreview();
      setBusy(false);
      return;
    }
    setBusy(false);
    onClose();
    onDeleted?.();
  }

  if (!isAdmin) return null;

  return (
    <Modal
      title={reviewing ? 'Delete selected activities' : `Delete ${kind}`}
      wide={kind !== 'event'}
      onClose={() => { if (!busy) onClose(); }}
      footer={
        <>
          <button className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
          {reviewing && (
            <button className="btn btn-secondary" disabled={busy} onClick={() => { setReviewing(null); setAcknowledged(false); }}>
              Back to campaign
            </button>
          )}
          {kind === 'campaign' && !reviewing && !!preview?.activities.length && (
            <button className="btn btn-secondary" disabled={busy || loading || !!error || !selected.length}
              onClick={() => review(eligible.filter((item) => selected.includes(item.activity.abs_activityid)))}>
              Review selected activities ({selected.length})
            </button>
          )}
          <button className="btn btn-danger" disabled={!canDelete} onClick={remove}>
            {busy ? 'Deleting...' : reviewing ? `Delete ${targets.length} selected ${targets.length === 1 ? 'activity' : 'activities'}` : `Delete ${kind}`}
          </button>
        </>
      }
    >
      <p>{reviewing ? <>Delete the selected activities before deleting <b>{name}</b>?</> : <>Delete <b>{name}</b>?</>} This action cannot be undone.</p>
      {kind === 'event' && <p>Only this event will be deleted. Its linked campaign will not be deleted.</p>}
      {error && (
        <div className="notice notice-warning" role="alert">
          {error}
          {kind === 'campaign' && !busy && (
            <div className="mt-8"><Link className="link" to="/activities" onClick={onClose}>Open Activities to review remaining records</Link></div>
          )}
        </div>
      )}
      {loading ? <p role="status">Checking linked records...</p> : preview && (
        <>
          {targets.map((impact) => (
            <section className="deletion-impact" key={impact.activity.abs_activityid}>
              <h4>{impact.activity.abs_title}</h4>
              <ActivityImpact impact={impact} onClose={onClose} />
            </section>
          ))}
          {targets.length > 0 && !protectedActivity && (
            <label className="deletion-confirmation">
              <input type="checkbox" checked={acknowledged} disabled={busy || !!error}
                onChange={(e) => setAcknowledged(e.target.checked)} />
              I understand that these activities and all their listed campaign links will be permanently deleted.
              Campaigns will not be deleted by this step.
            </label>
          )}
          {kind === 'campaign' && !reviewing && (
            <>
              {preview.activities.length ? (
                <>
                  <div className="notice notice-warning" role="alert">
                    Delete all {preview.activities.length} linked {preview.activities.length === 1 ? 'activity' : 'activities'} before deleting this campaign.
                    Activities shared with other campaigns are deleted from those campaigns too.
                    Activities with claims cannot be selected or deleted.
                  </div>
                  <label className="deletion-confirmation">
                    <input type="checkbox" checked={allSelected} disabled={busy || !!error || !eligible.length}
                      onChange={(e) => setSelected(e.target.checked ? eligible.map((item) => item.activity.abs_activityid) : [])} />
                    Select all deletable activities ({eligible.length})
                  </label>
                  <div className="list">
                    {preview.activities.map((impact) => {
                      const activityId = impact.activity.abs_activityid;
                      return (
                        <div className="deletion-activity" key={activityId}>
                          <div className="deletion-activity-row">
                            <label className="deletion-confirmation">
                              <input type="checkbox" checked={selected.includes(activityId)}
                                disabled={busy || !!error || !!impact.claims.length}
                                onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, activityId] : ids.filter((value) => value !== activityId))} />
                              <b>{impact.activity.abs_title}</b>
                            </label>
                            <button className="btn btn-danger btn-sm" disabled={busy || !!error || !!impact.claims.length}
                              onClick={() => review([impact])}>Review deletion</button>
                          </div>
                          <div className="help-text">Linked to {impact.links.length} campaign(s). {impact.claims.length} claim(s).</div>
                          {impact.claims.length > 0 && (
                            <details>
                              <summary>View protected claims ({impact.claims.length})</summary>
                              <ActivityImpact impact={impact} onClose={onClose} showCampaigns={false} />
                            </details>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : <p>No linked activities remain.</p>}
              {preview.blockers.length > 0 && (
                <div className="notice notice-warning" role="alert">
                  Other records still protect this campaign: {preview.blockers.join(', ')}.
                  Deleting activities does not remove these records.
                  <ul>
                    {preview.blockers.includes('events') && (
                      <li>In <Link className="link" to="/events" onClick={onClose}>Events</Link>, review each linked event and clear its Campaign field or delete the event with confirmation.</li>
                    )}
                    {preview.blockers.includes('participants') && (
                      <li>Ask a Dataverse administrator to review participant links. Participation history should not be erased just to bypass this safeguard.</li>
                    )}
                    {preview.blockers.includes('audience departments') && (
                      <li>Ask a Dataverse administrator to review and, if appropriate, remove the campaign's audience-department associations.</li>
                    )}
                    {preview.blockers.includes('claims') && <li>Linked claims protect campaign history and earned points. This dialog cannot override that protection.</li>}
                  </ul>
                </div>
              )}
              {!preview.activities.length && !preview.blockers.length && <p>No linked records remain. Confirm campaign deletion to continue.</p>}
            </>
          )}
        </>
      )}
      {!busy && !loading && kind !== 'event' && (
        <button className="btn btn-secondary btn-sm mt-16" onClick={refreshPreview}>Refresh linked records</button>
      )}
      {!busy && !loading && kind === 'event' && error && (
        <button className="btn btn-secondary btn-sm" onClick={refreshPreview}>Retry checks</button>
      )}
    </Modal>
  );
}
