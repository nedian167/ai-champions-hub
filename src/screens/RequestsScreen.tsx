import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppData } from '../context/AppDataContext';
import { ChampionsSvc, RequestsSvc, bind } from '../data/entities';
import { findChampionProfiles } from '../data/champions';
import { Card, KpiCard, Pill, EmptyState, SearchInput, Field } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import {
  ChampionRole, ChampionStatus, RequestCategoryLabel, RequestStatus, RequestStatusLabel, optionsOf,
} from '../lib/enums';
import { formatDate } from '../lib/format';
import { parseThread, lastMessage } from '../lib/requestThread';
import { normalizeChampionUserId } from '../lib/championIdentity';
import type { PillColor } from '../components/ui';
import type { Abs_champions, Abs_requests } from '../data/entities';

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
  const { requests, requestCategories, requestCategoryById, departments, championById, currentChampion, currentUser, isAdmin, reload } = useAppData();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<number | 'all' | 'completed'>('all');
  const [showNew, setShowNew] = useState(false);
  const [msgText, setMsgText] = useState('');
  const [saving, setSaving] = useState(false);
  const [createdChampion, setCreatedChampion] = useState<Abs_champions | null>(null);
  const replyAttempt = useRef<{ id: string; text: string } | null>(null);

  const [form, setForm] = useState({ title: '', categoryId: '', description: '', departmentId: '' });
  const requesterChampion = currentChampion ?? createdChampion;

  // Category display: prefer the configurable lookup, fall back to the legacy option set
  // for older rows created before request categories were made admin-configurable.
  const catLabel = (r: Abs_requests): string => {
    if (r._abs_category_value) {
      return requestCategoryById.get(r._abs_category_value)?.abs_name
        ?? r.abs_categoryname
        ?? '—';
    }
    return RequestCategoryLabel[r.crd49_category ?? -1] ?? '—';
  };

  const myUpn = normalizeChampionUserId(currentUser?.userPrincipalName);
  const isOwner = (r: Abs_requests) => {
    if (requesterChampion && r._crd49_champion_value === requesterChampion.abs_championid) return true;
    const champ = championById.get(r._crd49_champion_value ?? '');
    return !!myUpn && normalizeChampionUserId(champ?.abs_userid) === myUpn;
  };

  // Admins triage every request; a champion only sees and manages their own.
  const visibleRequests = useMemo(
    () => (isAdmin ? requests : requests.filter(isOwner)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requests, isAdmin, requesterChampion, myUpn, championById],
  );
  const targetId = new URLSearchParams(location.search).get('requestId')
    ?? (location.state as { openRequestId?: string } | null)?.openRequestId ?? null;
  const linkedRequest = targetId ? visibleRequests.find((request) => request.abs_requestid === targetId) : undefined;
  const [linkedId, setLinkedId] = useState(targetId);
  const [convoId, setConvoId] = useState<string | null>(targetId);
  const convo = visibleRequests.find((request) => request.abs_requestid === convoId) ?? null;
  const setConvo = (request: Abs_requests | null) => setConvoId(request?.abs_requestid ?? null);
  const [convoStatus, setConvoStatus] = useState<number | null>(null);
  if (targetId !== linkedId) {
    setLinkedId(targetId);
    if (targetId) {
      setConvoId(targetId);
      setConvoStatus(null);
      setMsgText('');
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleRequests.filter((r) => {
      if (catFilter !== 'all' && r._abs_category_value !== catFilter) return false;
      if (statusFilter === 'completed') {
        if (r.crd49_status !== RequestStatus.Approved && r.crd49_status !== RequestStatus.Fulfilled) return false;
      } else if (statusFilter !== 'all' && r.crd49_status !== statusFilter) {
        return false;
      }
      if (q && !`${r.abs_title ?? ''} ${r.crd49_description ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [visibleRequests, search, catFilter, statusFilter]);

  const open = visibleRequests.filter((r) => r.crd49_status === RequestStatus.Open).length;
  const inReview = visibleRequests.filter((r) => r.crd49_status === RequestStatus.InReview).length;
  const completed = visibleRequests.filter((r) => r.crd49_status === RequestStatus.Approved || r.crd49_status === RequestStatus.Fulfilled).length;

  async function createRequest() {
    if (saving) return;
    if (!form.title.trim() || !form.description.trim()) { toast.error('Title and description are required.'); return; }
    if (!requestCategories.some((category) => category.abs_requestcategoryid === form.categoryId)) {
      toast.error('Please choose a configured category.');
      return;
    }
    if (!requesterChampion) {
      if (!currentUser?.userPrincipalName.trim()) {
        toast.error('Sign in through Power Apps to set up your requester profile.');
        return;
      }
      if (!departments.some((department) => department.abs_departmentid === form.departmentId)) {
        toast.error('Please choose your department to set up your requester profile.');
        return;
      }
    }
    setSaving(true);
    let profileCreated = false;
    let requestCreated = false;
    try {
      let requesterId = requesterChampion?.abs_championid;
      if (!requesterId) {
        const upn = normalizeChampionUserId(currentUser!.userPrincipalName);
        const existing = await findChampionProfiles(upn);
        if (existing.length > 1) {
          throw new Error('Multiple Champion profiles match your account. Ask a program admin to resolve them before submitting.');
        }
        let champion = existing[0];
        if (champion?.crd49_status === ChampionStatus.Inactive && !isAdmin) {
          throw new Error('Your Champion profile is disabled. Contact a program admin before submitting a request.');
        }
        if (!champion) {
          const profile = await ChampionsSvc.create({
            abs_userid: upn,
            crd49_displayname: currentUser!.fullName.trim() || upn,
            'crd49_Department@odata.bind': bind('department', form.departmentId),
            crd49_role: ChampionRole.Champion,
            crd49_status: ChampionStatus.Active,
            crd49_totalpoints: 0,
            crd49_joineddate: new Date().toISOString(),
          } as never);
          if (!profile.success || !profile.data?.abs_championid) {
            throw new Error(profile.error?.message ?? 'Could not create your requester profile.');
          }
          champion = profile.data;
          profileCreated = true;
        }
        setCreatedChampion(champion);
        requesterId = champion.abs_championid;
      }
      const res = await RequestsSvc.create({
        abs_title: form.title.trim(),
        'abs_Category@odata.bind': bind('requestcategory', form.categoryId),
        'crd49_Champion@odata.bind': bind('champion', requesterId),
        crd49_description: form.description.trim(),
        crd49_status: RequestStatus.Open,
        crd49_submitteddate: new Date().toISOString(),
      } as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Create failed');
      requestCreated = true;
      toast.success('Request submitted.');
      setShowNew(false);
      setForm({ title: '', categoryId: '', description: '', departmentId: '' });
      await reload();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to submit request.';
      toast.error(requestCreated ? `Request submitted, but refresh failed: ${message}`
        : profileCreated ? `Your profile was created, but the request was not submitted: ${message} Try again; your profile will be reused.`
          : message);
    } finally {
      setSaving(false);
    }
  }

  function openNew() {
    setForm({ title: '', categoryId: requestCategories[0]?.abs_requestcategoryid ?? '', description: '', departmentId: '' });
    setShowNew(true);
  }

  function openConvo(r: Abs_requests) {
    replyAttempt.current = null;
    setConvo(r);
    setConvoStatus(null);
    setMsgText('');
  }

  useEffect(() => {
    if ((location.state as { openRequestId?: string } | null)?.openRequestId) {
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location, navigate]);

  async function sendMessage() {
    if (!convo || saving) return;
    const admin = isAdmin;
    const text = msgText.trim();
    if (!text && !admin) { toast.error('Enter a message before sending.'); return; }

    if (text.length > 4000) { toast.error('Replies must contain no more than 4000 characters.'); return; }
    if (text && replyAttempt.current?.text !== text) {
      replyAttempt.current = { id: crypto.randomUUID(), text };
    }
    setSaving(true);
    let saved = false;
    try {
      const payload: Record<string, unknown> = {};
      if (text) payload.abs_replycommand = JSON.stringify(replyAttempt.current);
      if (admin && convoStatus !== null && convoStatus !== convo.crd49_status) payload.crd49_status = convoStatus;
      if (!Object.keys(payload).length) { setConvo(null); return; }

      const res = await RequestsSvc.update(convo.abs_requestid, payload as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Update failed');
      saved = true;
      replyAttempt.current = null;
      toast.success(admin ? 'Request updated.' : 'Reply sent.');
      setConvo(null);
      setMsgText('');
      await reload();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to send message.';
      toast.error(saved ? `Request saved, but refresh failed: ${message}` : message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {targetId && !linkedRequest && <div role="alert" className="card mb-16">This request is unavailable or you no longer have access to it.</div>}
      <div className="page-header">
        <div>
          <h1>Requests</h1>
          <div className="page-subtitle">{isAdmin ? 'Triage requests from champions and reply back.' : 'Ask for licenses, connectors and AI support — reply here when the team responds.'}</div>
        </div>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={openNew}>➕ New Request</button>
      </div>

      <div className="grid grid-kpi">
        <KpiCard label="Total" value={visibleRequests.length} icon="📨" iconBg="var(--primary-soft)" iconColor="var(--primary)" onClick={() => setStatusFilter('all')} />
        <KpiCard label="Open" value={open} icon="📬" iconBg="var(--amber-soft)" iconColor="var(--amber)" onClick={() => setStatusFilter(RequestStatus.Open)} />
        <KpiCard label="In Review" value={inReview} icon="🔎" iconBg="var(--blue-soft)" iconColor="var(--blue)" onClick={() => setStatusFilter(RequestStatus.InReview)} />
        <KpiCard label="Completed" value={completed} icon="✅" iconBg="var(--green-soft)" iconColor="var(--green)" onClick={() => setStatusFilter('completed')} />
      </div>

      <div className="row mt-24">
        <SearchInput value={search} onChange={setSearch} placeholder="Search requests…" />
        <select className="select" style={{ maxWidth: 220 }} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="all">All Categories</option>
          {requestCategories.map((c) => <option key={c.abs_requestcategoryid} value={c.abs_requestcategoryid}>{c.abs_name}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 200 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value === 'all' ? 'all' : e.target.value === 'completed' ? 'completed' : Number(e.target.value))}>
          <option value="all">All Status</option>
          {optionsOf(RequestStatusLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          <option value="completed">Completed (Approved / Fulfilled)</option>
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
              <div
                className={`card entity-card${canOpen ? ' card-clickable' : ''}`}
                key={r.abs_requestid}
                role={canOpen ? 'button' : undefined}
                tabIndex={canOpen ? 0 : undefined}
                onClick={canOpen ? () => openConvo(r) : undefined}
                onKeyDown={canOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openConvo(r); } } : undefined}
              >
                <div className="ec-head">
                  <Pill color="gray">{catLabel(r)}</Pill>
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
                    <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); openConvo(r); }}>
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
          onClose={() => { if (!saving) setShowNew(false); }}
          footer={
            <>
              <button className="btn btn-secondary" disabled={saving} onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving || requestCategories.length === 0 || (!requesterChampion && (!currentUser?.userPrincipalName.trim() || departments.length === 0))} onClick={createRequest}>{saving ? 'Submitting…' : 'Submit Request'}</button>
            </>
          }
        >
          {!requesterChampion && (
            <>
              <div className="help-text" style={{ marginBottom: 12 }}>
                Your first request needs a Champion profile. Choose your department to create one
                for {currentUser?.fullName || currentUser?.userPrincipalName || 'your signed-in account'}.
                This does not grant program manager or app admin permissions.
              </div>
              {!currentUser?.userPrincipalName.trim() && <div className="notice notice-warning" role="alert">Sign in through Power Apps to set up your requester profile.</div>}
              <Field label="Your department">
                <select className="select" value={form.departmentId} disabled={saving} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                  <option value="">Select your department...</option>
                  {departments.map((department) => <option key={department.abs_departmentid} value={department.abs_departmentid}>{department.abs_name}</option>)}
                </select>
              </Field>
              {departments.length === 0 && <div className="notice notice-warning" role="alert">No departments are configured. Ask a program admin to add a department in Settings.</div>}
            </>
          )}
          <Field label="Title"><input className="input" maxLength={850} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Category">
            <select className="select" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              {requestCategories.length === 0 && <option value="">No categories configured</option>}
              {requestCategories.map((c) => <option key={c.abs_requestcategoryid} value={c.abs_requestcategoryid}>{c.abs_name}</option>)}
            </select>
          </Field>
          {requestCategories.length === 0 && <div className="notice notice-warning" role="alert">No request categories are configured. Ask a program admin to add one in Settings.</div>}
          <Field label="Description"><textarea className="textarea" maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe what you need…" /></Field>
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
              <Pill color="gray">{catLabel(convo)}</Pill>
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
                <select className="select" value={convoStatus ?? convo.crd49_status} onChange={(e) => setConvoStatus(Number(e.target.value))}>
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
