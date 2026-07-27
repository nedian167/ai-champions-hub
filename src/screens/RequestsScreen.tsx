import { useMemo, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import { RequestsSvc, bind } from '../data/entities';
import { Card, KpiCard, Pill, EmptyState, SearchInput, Field } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import {
  RequestCategory, RequestCategoryLabel, RequestStatus, RequestStatusLabel, optionsOf,
} from '../lib/enums';
import { formatDate } from '../lib/format';
import type { PillColor } from '../components/ui';
import type { Abs_requests } from '../data/entities';

function statusColor(s?: number): PillColor {
  switch (s) {
    case RequestStatus.Open: return 'amber';
    case RequestStatus.InReview: return 'blue';
    case RequestStatus.Approved: return 'green';
    case RequestStatus.Fulfilled: return 'purple';
    case RequestStatus.Rejected: return 'red';
    default: return 'gray';
  }
}

export default function RequestsScreen() {
  const { requests, championById, currentChampion, isAdmin, reload } = useAppData();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<number | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<number | 'all'>('all');
  const [showNew, setShowNew] = useState(false);
  const [triage, setTriage] = useState<Abs_requests | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ title: '', category: RequestCategory.License as number, description: '' });
  const [triageForm, setTriageForm] = useState({ status: RequestStatus.Open as number, response: '' });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter((r) => {
      if (catFilter !== 'all' && r.crd49_category !== catFilter) return false;
      if (statusFilter !== 'all' && r.crd49_status !== statusFilter) return false;
      if (q && !`${r.abs_title ?? ''} ${r.crd49_description ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [requests, search, catFilter, statusFilter]);

  const open = requests.filter((r) => r.crd49_status === RequestStatus.Open).length;
  const inReview = requests.filter((r) => r.crd49_status === RequestStatus.InReview).length;
  const completed = requests.filter((r) => r.crd49_status === RequestStatus.Approved || r.crd49_status === RequestStatus.Fulfilled).length;

  async function createRequest() {
    if (!currentChampion) { toast.error('No champion record found for you.'); return; }
    if (!form.title.trim() || !form.description.trim()) { toast.error('Title and description are required.'); return; }
    setSaving(true);
    try {
      const res = await RequestsSvc.create({
        abs_title: form.title.trim(),
        crd49_category: form.category,
        'crd49_Champion@odata.bind': bind('champion', currentChampion.abs_championid),
        crd49_description: form.description.trim(),
        crd49_status: RequestStatus.Open,
        crd49_submitteddate: new Date().toISOString(),
      } as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Create failed');
      toast.success('Request submitted.');
      setShowNew(false);
      setForm({ title: '', category: RequestCategory.License, description: '' });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to submit request.');
    } finally {
      setSaving(false);
    }
  }

  async function saveTriage() {
    if (!triage) return;
    setSaving(true);
    try {
      const res = await RequestsSvc.update(triage.abs_requestid, {
        crd49_status: triageForm.status,
        crd49_response: triageForm.response.trim() || undefined,
      } as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Update failed');
      toast.success('Request updated.');
      setTriage(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update request.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Requests</h1>
          <div className="page-subtitle">Ask for licenses, connectors and AI support.</div>
        </div>
        {currentChampion && <button className="btn btn-primary" onClick={() => setShowNew(true)}>➕ New Request</button>}
      </div>

      <div className="grid grid-kpi">
        <KpiCard label="Total" value={requests.length} icon="📨" iconBg="var(--primary-soft)" iconColor="var(--primary)" />
        <KpiCard label="Open" value={open} icon="📬" iconBg="var(--amber-soft)" iconColor="var(--amber)" />
        <KpiCard label="In Review" value={inReview} icon="🔎" iconBg="var(--blue-soft)" iconColor="var(--blue)" />
        <KpiCard label="Completed" value={completed} icon="✅" iconBg="var(--green-soft)" iconColor="var(--green)" />
      </div>

      <div className="row mt-24">
        <SearchInput value={search} onChange={setSearch} placeholder="Search requests…" />
        <select className="select" style={{ maxWidth: 220 }} value={catFilter} onChange={(e) => setCatFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">All Categories</option>
          {optionsOf(RequestCategoryLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 200 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">All Status</option>
          {optionsOf(RequestStatusLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <Card className="mt-24"><EmptyState icon="📨" title="No requests found" message="Submit a request to get started." /></Card>
      ) : (
        <div className="grid grid-cards mt-24">
          {filtered.map((r) => {
            const champ = championById.get(r._crd49_champion_value ?? '');
            return (
              <div className="card entity-card" key={r.abs_requestid}>
                <div className="ec-head">
                  <Pill color="gray">{RequestCategoryLabel[r.crd49_category]}</Pill>
                  <Pill color={statusColor(r.crd49_status)}>{RequestStatusLabel[r.crd49_status]}</Pill>
                </div>
                <h3>{r.abs_title}</h3>
                <p className="entity-desc">{r.crd49_description}</p>
                {r.crd49_response && <div className="item-sub">💬 {r.crd49_response}</div>}
                <div className="row">
                  <span className="item-sub">{champ?.crd49_displayname ?? 'Unknown'} · {formatDate(r.crd49_submitteddate)}</span>
                  <span className="spacer" />
                  {isAdmin && (
                    <button className="btn btn-secondary btn-sm" onClick={() => { setTriage(r); setTriageForm({ status: r.crd49_status, response: r.crd49_response ?? '' }); }}>Triage</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showNew && (
        <Modal
          title="New Request"
          onClose={() => setShowNew(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={createRequest}>{saving ? 'Submitting…' : 'Submit Request'}</button>
            </>
          }
        >
          <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Category">
            <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: Number(e.target.value) })}>
              {optionsOf(RequestCategoryLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Description"><textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe what you need…" /></Field>
        </Modal>
      )}

      {triage && (
        <Modal
          title="Triage Request"
          onClose={() => setTriage(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setTriage(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={saveTriage}>{saving ? 'Saving…' : 'Save'}</button>
            </>
          }
        >
          <div className="item-title">{triage.abs_title}</div>
          <p className="text-muted">{triage.crd49_description}</p>
          <div className="divider" />
          <Field label="Status">
            <select className="select" value={triageForm.status} onChange={(e) => setTriageForm({ ...triageForm, status: Number(e.target.value) })}>
              {optionsOf(RequestStatusLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Response"><textarea className="textarea" value={triageForm.response} onChange={(e) => setTriageForm({ ...triageForm, response: e.target.value })} placeholder="Reply to the requester…" /></Field>
        </Modal>
      )}
    </>
  );
}
