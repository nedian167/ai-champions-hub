import { useEffect, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import {
  ActivitiesSvc, ActivityClaimsSvc, CampaignActivitiesSvc, CampaignDepartmentsSvc,
  CampaignParticipationsSvc, CampaignsSvc, EventsSvc,
} from '../data/entities';
import { Modal } from './Modal';
import { useToast } from './Toast';

type RecordKind = 'campaign' | 'activity' | 'event';

const recordServices = { campaign: CampaignsSvc, activity: ActivitiesSvc, event: EventsSvc };
const recordLabels = { campaign: 'Campaign', activity: 'Activity', event: 'Event' };

async function deletionBlockers(kind: RecordKind, id: string): Promise<string[]> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Invalid record ID.');
  }
  if (kind === 'event') return [];
  const filter = `_crd49_${kind}_value eq ${id}`;
  const checks = kind === 'campaign'
    ? [
      { label: 'activity links', result: CampaignActivitiesSvc.getAll({ filter, top: 1 }) },
      { label: 'participants', result: CampaignParticipationsSvc.getAll({ filter, top: 1 }) },
      { label: 'claims', result: ActivityClaimsSvc.getAll({ filter, top: 1 }) },
      { label: 'events', result: EventsSvc.getAll({ filter, top: 1 }) },
      { label: 'audience departments', result: CampaignDepartmentsSvc.getAll({ filter: `_abs_campaign_value eq ${id}`, top: 1 }) },
    ]
    : [
      { label: 'campaign links', result: CampaignActivitiesSvc.getAll({ filter, top: 1 }) },
      { label: 'claims', result: ActivityClaimsSvc.getAll({ filter, top: 1 }) },
    ];
  return (await Promise.all(checks.map(async ({ label, result }) => {
    const res = await result;
    if (!res.success || !res.data) {
      throw new Error(res.error?.message ?? `Could not check linked ${label}. Deletion is blocked.`);
    }
    return res.data.length ? label : null;
  }))).filter((label): label is string => label !== null);
}

export function DeleteRecordModal({
  kind, id, name, onClose, onDeleted,
}: {
  kind: RecordKind;
  id: string;
  name: string;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const { isAdmin, reload } = useAppData();
  const toast = useToast();
  const [blockers, setBlockers] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    deletionBlockers(kind, id).then(
      (linked) => { if (!cancelled) setBlockers(linked); },
      (e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not check linked records.'); },
    );
    return () => { cancelled = true; };
  }, [kind, id, isAdmin]);

  async function remove() {
    if (!isAdmin || deleting || blockers === null || blockers.length || error) return;
    setDeleting(true);
    try {
      // Recheck the server rather than trusting a potentially stale context snapshot.
      const linked = await deletionBlockers(kind, id);
      setBlockers(linked);
      if (linked.length) {
        setDeleting(false);
        return;
      }
      await recordServices[kind].delete(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to delete ${kind}.`);
      setDeleting(false);
      return;
    }
    toast.success(`${recordLabels[kind]} deleted.`);
    try {
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? `Deleted, but refresh failed: ${e.message}` : 'Deleted, but refresh failed. Reload the page.');
    }
    setDeleting(false);
    onClose();
    onDeleted?.();
  }

  if (!isAdmin) return null;

  return (
    <Modal
      title={`Delete ${kind}`}
      onClose={() => { if (!deleting) onClose(); }}
      footer={
        <>
          <button className="btn btn-secondary" disabled={deleting} onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" disabled={deleting || blockers === null || blockers.length > 0 || !!error} onClick={remove}>
            {deleting ? 'Deleting...' : `Delete ${kind}`}
          </button>
        </>
      }
    >
      <p>Delete <b>{name}</b>? This action cannot be undone.</p>
      <p>{kind === 'event'
        ? 'Only this event will be deleted. Its linked campaign will not be deleted.'
        : 'No linked records will be deleted. History and earned points must be preserved.'}</p>
      {error ? <div className="notice notice-warning" role="alert">{error} Close and reopen this dialog to try again.</div>
        : blockers === null ? <p role="status">Checking linked records...</p>
          : blockers.length > 0 ? (
            <div className="notice notice-warning" role="alert">
              Deletion is blocked by linked {blockers.join(', ')}. Remove these links or records first.
            </div>
          ) : <p>{kind === 'event' ? 'Confirm deletion to continue.' : 'No linked records found. Confirm deletion to continue.'}</p>}
    </Modal>
  );
}
