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
import { parseThread, serializeThread, lastMessage, type ThreadMessage } from '../lib/requestThread';
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
  const { requests, championById, currentChampion, currentUser, isAdmin, reload } = useAppData();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<number | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<number | 'all'>('all');
  const [showNew, setShowNew] = useState(false);
  const [convo, setConvo] = useState<Abs_requests | null>(null);
  const [convoStatus, setConvoStatus] = useState<number>(RequestStatus.Open);
  const [msgText, setMsgText] = useState('');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ title: '', category: RequestCategory.License as number, description: '' });

  const myUpn = (currentUser?.userPrincipalName ?? '').toLowerCase();
  const isOwner = (r: Abs_requests) => {
    if (currentChampion && r._crd49_champion_value === currentChampion.abs_championid) return true;
    const champ = championById.get(r._crd49_champion_value ?? '');
    return !!myUpn && (champ?.abs_userid ?? '').toLowerCase() === myUpn;
  };

  const myName = currentUser?.fullName
    || currentChampion?.crd49_displayname
    || (isAdmin ? 'Administrator' : 'Requester');

  // Admins triage every request; a champion only sees and manages their own.
  const visibleRequests = useMemo(
    () => (isAdmin ? requests : requests.filter(isOwner)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requests, isAdmin, currentChampion, myUpn, championById],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleRequests.filter((r) => {
      if (catFilter !== 'all' && r.crd49_category !== catFilter) return false;
      if (statusFilter !== 'all' && r.crd49_status !== statusFilter) return false;
      if (q && !`${r.abs_title ?? ''} ${r.crd49_description ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [visibleRequests, search, catFilter, statusFilter]);

  const open = visibleRequests.filter((r) => r.crd49_status === RequestStatus.Open).length;
  const inReview = visibleRequests.filter((r) => r.crd49_status === RequestStatus.InReview).length;
  const completed = visibleRequests.filter((r) => r.crd49_status === RequestStatus.Approved || r.crd49_status === RequestStatus.Fulfilled).length;

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

  function openConvo(r: Abs_requests) {
    setConvo(r);
    setConvoStatus(r.crd49_status);
    setMsgText('');
  }

  async function sendMessage() {
    if (!convo) return;
    const admin = isAdmin;
    const text = msgText.trim();
    if (!text && !admin) { toast.error('Enter a message before sending.'); return; }

    const messages = parseThread(convo.crd49_response);
    if (text) {
      const msg: ThreadMessage = {
        by: admin ? 'admin' : 'requester',
        name: myName,
        text,
        at: new Date().toISOString(),
      };
      messages.push(msg);
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (messages.length) payload.crd49_response = serializeThread(messages);
      if (admin) payload.crd49_status = convoStatus;
      if (!Object.keys(payload).length) { setConvo(null); return; }

      const res = await RequestsSvc.update(convo.abs_requestid, payload as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Update failed');
      toast.success(admin ? 'Request updated.' : 'Reply sent.');
      setConvo(null);
      setMsgText('');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send message.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Requests</h1>
          <div className="page-subtitle">{isAdmin ? 'Triage requests from champions and reply back.' : 'Ask for licenses, connectors and AI support — reply here when the team responds.'}</div>
        </div>
        {currentChampion && <button className="btn btn-primary" onClick={() => setShowNew(true)}>➕ New Request</button>}
      </div>

      <div className="grid grid-kpi">
        <KpiCard label="Total" value={visibleRequests.length} icon="📨" iconBg="var(--primary-soft)" iconColor="var(--primary)" />
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
        <Card className="mt-24"><EmptyState icon="📨" title="No requests found" message={isAdmin ? 'No requests have been submitted yet.' : "You haven't submitted any requests yet. Create one to get started."} /></Card>
      ) : (
        <div className="grid grid-cards mt-24">
          {filtered.map((r) => {
            const champ = championById.get(r._crd49_champion_value ?? '');
            const last = lastMessage(r.crd49_response);
            const owner = isOwner(r);
            const canOpen = isAdmin || owner;
            return (
              <div className="card entity-card" key={r.abs_requestid}>
                <div className="ec-head">
                  <Pill color="gray">{RequestCategoryLabel[r.crd49_category]}</Pill>
                  <Pill color={statusColor(r.crd49_status)}>{RequestStatusLabel[r.crd49_status]}</Pill>
                </div>
                <h3>{r.abs_title}</h3>
                <p className="entity-desc">{r.crd49_description}</p>
                {last && (
                  <div className="item-sub">💬 <strong>{last.name}:</strong> {last.text}</div>
                )}
                <div className="row">
                  <span className="item-sub">{champ?.crd49_displayname ?? 'Unknown'} · {formatDate(r.crd49_submitteddate)}</span>
                  <span className="spacer" />
                  {canOpen && (
                    <button className="btn btn-secondary btn-sm" onClick={() => openConvo(r)}>
                      {isAdmin ? 'Respond' : 'Reply'}
                    </button>
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

      {convo && (() => {
        const champ = championById.get(convo._crd49_champion_value ?? '');
        const requesterName = champ?.crd49_displayname ?? 'Requester';
        const thread = parseThread(convo.crd49_response);
        return (
          <Modal
            title={isAdmin ? 'Respond to Request' : 'Conversation'}
            onClose={() => setConvo(null)}
            footer={
              <>
                <button className="btn btn-secondary" onClick={() => setConvo(null)}>Close</button>
                <button className="btn btn-primary" disabled={saving} onClick={sendMessage}>
                  {saving ? 'Sending…' : isAdmin ? 'Send / Update' : 'Send Reply'}
                </button>
              </>
            }
          >
            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
              <Pill color="gray">{RequestCategoryLabel[convo.crd49_category]}</Pill>
              <Pill color={statusColor(convo.crd49_status)}>{RequestStatusLabel[convo.crd49_status]}</Pill>
            </div>
            <div className="item-title">{convo.abs_title}</div>

            <div className="thread">
              <div className="msg msg-requester">
                <div className="msg-meta">{requesterName} · {formatDate(convo.crd49_submitteddate)}</div>
                <div className="msg-body">{convo.crd49_description}</div>
              </div>
              {thread.map((m, i) => (
                <div key={i} className={`msg ${m.by === 'admin' ? 'msg-admin' : 'msg-requester'}`}>
                  <div className="msg-meta">{m.name}{m.at ? ` · ${formatDate(m.at)}` : ''}</div>
                  <div className="msg-body">{m.text}</div>
                </div>
              ))}
            </div>

            <div className="divider" />
            {isAdmin && (
              <Field label="Status">
                <select className="select" value={convoStatus} onChange={(e) => setConvoStatus(Number(e.target.value))}>
                  {optionsOf(RequestStatusLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
            )}
            <Field label={isAdmin ? 'Reply message' : 'Your reply'}>
              <textarea
                className="textarea"
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                placeholder={isAdmin ? 'Write a reply to the requester…' : 'Reply to the program team…'}
              />
            </Field>
            {isAdmin && <div className="text-muted" style={{ fontSize: 12 }}>You can update status without adding a message.</div>}
          </Modal>
        );
      })()}
    </>
  );
}
