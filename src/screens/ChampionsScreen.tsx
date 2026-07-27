import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppData } from '../context/AppDataContext';
import { ChampionsSvc, bind, type Abs_champions } from '../data/entities';
import { Card, KpiCard, Pill, Avatar, EmptyState, SearchInput, Field } from '../components/ui';
import { PeoplePicker } from '../components/PeoplePicker';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import {
  ChampionRole, ChampionStatus, ChampionStatusLabel, optionsOf,
} from '../lib/enums';
import { formatDate } from '../lib/format';
import type { PillColor } from '../components/ui';

function statusColor(s?: number): PillColor {
  return s === ChampionStatus.Active ? 'green' : s === ChampionStatus.Pending ? 'amber' : 'gray';
}

export default function ChampionsScreen() {
  const { champions, departments, departmentById, pointsFor, isAdmin, reload, claims } = useAppData();
  const toast = useToast();
  const location = useLocation();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<number | 'all'>(
    () => {
      const s = (location.state as { statusFilter?: number } | null)?.statusFilter;
      return typeof s === 'number' ? s : 'all';
    },
  );
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<Abs_champions | null>(null);
  const [editForm, setEditForm] = useState({
    displayname: '', userid: '', department: '',
    role: ChampionRole.Champion as number, status: ChampionStatus.Active as number,
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [removing, setRemoving] = useState<Abs_champions | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [form, setForm] = useState({
    displayname: '', userid: '', department: '',
    role: ChampionRole.Champion as number, status: ChampionStatus.Active as number,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return champions.filter((c) => {
      if (statusFilter !== 'all' && c.crd49_status !== statusFilter) return false;
      if (deptFilter !== 'all' && c._crd49_department_value !== deptFilter) return false;
      if (q && !`${c.crd49_displayname ?? ''} ${c.abs_userid ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [champions, search, statusFilter, deptFilter]);

  // Most recent claim date per champion — shown as "last activity" on the card.
  const lastActivityById = useMemo(() => {
    const map = new Map<string, number>();
    for (const cl of claims) {
      const id = cl._crd49_champion_value;
      if (!id) continue;
      const raw = cl.crd49_claimeddate ?? cl.createdon;
      if (!raw) continue;
      const t = new Date(raw).getTime();
      if (isNaN(t)) continue;
      const prev = map.get(id);
      if (prev == null || t > prev) map.set(id, t);
    }
    return map;
  }, [claims]);

  const active = champions.filter((c) => c.crd49_status === ChampionStatus.Active).length;
  const pending = champions.filter((c) => c.crd49_status === ChampionStatus.Pending).length;

  const deptIdByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of departments) if (d.abs_name) m.set(d.abs_name.trim().toLowerCase(), d.abs_departmentid);
    return m;
  }, [departments]);

  function matchDept(name?: string): string {
    if (!name) return '';
    return deptIdByName.get(name.trim().toLowerCase()) ?? '';
  }

  async function addChampion() {
    if (!form.displayname.trim() || !form.userid.trim() || !form.department) {
      toast.error('Name, email and department are required.');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        crd49_displayname: form.displayname.trim(),
        abs_userid: form.userid.trim(),
        'crd49_Department@odata.bind': bind('department', form.department),
        crd49_role: form.role,
        crd49_status: form.status,
        crd49_totalpoints: 0,
        crd49_joineddate: new Date().toISOString(),
      };
      const res = await ChampionsSvc.create(payload as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Create failed');
      toast.success('Champion added.');
      setShowAdd(false);
      setForm({ displayname: '', userid: '', department: '', role: ChampionRole.Champion, status: ChampionStatus.Active });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add champion.');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(c: Abs_champions) {
    setEditForm({
      displayname: c.crd49_displayname ?? '',
      userid: c.abs_userid ?? '',
      department: c._crd49_department_value ?? '',
      role: c.crd49_role,
      status: c.crd49_status,
    });
    setEditing(c);
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editForm.displayname.trim() || !editForm.userid.trim() || !editForm.department) {
      toast.error('Name, email and department are required.');
      return;
    }
    setSavingEdit(true);
    try {
      const payload: Record<string, unknown> = {
        crd49_displayname: editForm.displayname.trim(),
        abs_userid: editForm.userid.trim(),
        'crd49_Department@odata.bind': bind('department', editForm.department),
        crd49_role: editForm.role,
        crd49_status: editForm.status,
      };
      const res = await ChampionsSvc.update(editing.abs_championid, payload as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Update failed');
      toast.success('Champion updated.');
      setEditing(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update champion.');
    } finally {
      setSavingEdit(false);
    }
  }

  async function toggleStatus(c: Abs_champions) {
    const next = c.crd49_status === ChampionStatus.Inactive ? ChampionStatus.Active : ChampionStatus.Inactive;
    setBusyId(c.abs_championid);
    try {
      const res = await ChampionsSvc.update(c.abs_championid, { crd49_status: next } as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Update failed');
      toast.success(
        next === ChampionStatus.Inactive
          ? 'Champion disabled — app access revoked.'
          : 'Champion enabled.',
      );
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update status.');
    } finally {
      setBusyId(null);
    }
  }

  async function removeChampion() {
    if (!removing) return;
    setBusyId(removing.abs_championid);
    try {
      await ChampionsSvc.delete(removing.abs_championid);
      toast.success('Champion removed.');
      setRemoving(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove champion.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Champions</h1>
          <div className="page-subtitle">The people driving AI adoption across your organization.</div>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>➕ Add Champion</button>
        )}
      </div>

      <div className="grid grid-kpi">
        <KpiCard label="Total Champions" value={champions.length} icon="🧑‍🚀" iconBg="var(--purple-soft)" iconColor="var(--purple)" onClick={() => setStatusFilter('all')} />
        <KpiCard label="Active" value={active} icon="✅" iconBg="var(--green-soft)" iconColor="var(--green)" onClick={() => setStatusFilter(ChampionStatus.Active)} />
        <KpiCard label="Pending Approval" value={pending} icon="⏳" iconBg="var(--amber-soft)" iconColor="var(--amber)" onClick={() => setStatusFilter(ChampionStatus.Pending)} />
      </div>

      <div className="row mt-24">
        <SearchInput value={search} onChange={setSearch} placeholder="Search champions…" />
        <select className="select" style={{ maxWidth: 200 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">All Status</option>
          {optionsOf(ChampionStatusLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 220 }} value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
          <option value="all">All Departments</option>
          {departments.map((d) => <option key={d.abs_departmentid} value={d.abs_departmentid}>{d.abs_name}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <Card className="mt-24"><EmptyState icon="🧑‍🚀" title="No champions found" message="Try adjusting your filters." /></Card>
      ) : (
        <div className="grid grid-cards mt-24">
          {filtered.map((c) => (
            <div className="card entity-card" key={c.abs_championid}>
              <div className="ec-head">
                <div className="row">
                  <Avatar name={c.crd49_displayname ?? '?'} size={44} />
                  <div className="center-col">
                    <span className="item-title">{c.crd49_displayname}</span>
                    <span className="item-sub">{c.abs_userid}</span>
                  </div>
                </div>
                <div className="ec-status">
                  <Pill color={statusColor(c.crd49_status)}>{ChampionStatusLabel[c.crd49_status]}</Pill>
                  <span className="ec-last-activity">
                    {lastActivityById.has(c.abs_championid)
                      ? `Last activity ${formatDate(new Date(lastActivityById.get(c.abs_championid)!).toISOString())}`
                      : 'No activity yet'}
                  </span>
                </div>
              </div>
              <div className="meta-row">🏢 {departmentById.get(c._crd49_department_value ?? '')?.abs_name ?? '—'}</div>
              <div className="row">
                <span className="points-badge">{pointsFor(c.abs_championid)} pts</span>
                <span className="spacer" />
                <span className="item-sub">Joined {formatDate(c.crd49_joineddate)}</span>
              </div>
              {isAdmin && (
                <div className="ec-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>✏️ Edit</button>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busyId === c.abs_championid}
                    onClick={() => toggleStatus(c)}
                  >
                    {c.crd49_status === ChampionStatus.Inactive ? '▶️ Enable' : '⏸️ Disable'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--red)' }}
                    disabled={busyId === c.abs_championid}
                    onClick={() => setRemoving(c)}
                  >
                    🗑️ Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <Modal
          title="Add Champion"
          onClose={() => setShowAdd(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={addChampion}>{saving ? 'Saving…' : 'Add Champion'}</button>
            </>
          }
        >
          <Field label="Find person in directory (GAL)" help="Search the Microsoft 365 address list — selecting a person fills in their name and User ID.">
            <PeoplePicker
              value={form.displayname || form.userid ? { displayName: form.displayname, userId: form.userid } : null}
              onChange={(p) =>
                setForm({
                  ...form,
                  displayname: p?.displayName ?? '',
                  userid: p?.userId ?? '',
                  department: p?.department ? (matchDept(p.department) || form.department) : form.department,
                })
              }
            />
          </Field>
          <div className="field-row">
            <Field label="Display name">
              <input className="input" value={form.displayname} onChange={(e) => setForm({ ...form, displayname: e.target.value })} placeholder="Ada Lovelace" />
            </Field>
            <Field label="User ID (email / UPN)">
              <input className="input" value={form.userid} onChange={(e) => setForm({ ...form, userid: e.target.value })} placeholder="ada@contoso.com" />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Department">
              <select className="select" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                <option value="">Select…</option>
                {departments.map((d) => <option key={d.abs_departmentid} value={d.abs_departmentid}>{d.abs_name}</option>)}
              </select>
            </Field>
            <Field label="Role">
              <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: Number(e.target.value) })}>
                <option value={ChampionRole.Champion}>Champion</option>
                <option value={ChampionRole.ProgramManager}>Program Manager</option>
              </select>
            </Field>
          </div>
          <Field label="Status">
            <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: Number(e.target.value) })}>
              {optionsOf(ChampionStatusLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </Modal>
      )}

      {editing && (
        <Modal
          title="Edit Champion"
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={savingEdit} onClick={saveEdit}>{savingEdit ? 'Saving…' : 'Save Changes'}</button>
            </>
          }
        >
          <Field label="Find person in directory (GAL)" help="Search the Microsoft 365 address list to update this champion's identity.">
            <PeoplePicker
              value={editForm.displayname || editForm.userid ? { displayName: editForm.displayname, userId: editForm.userid } : null}
              onChange={(p) =>
                setEditForm({
                  ...editForm,
                  displayname: p?.displayName ?? '',
                  userid: p?.userId ?? '',
                  department: p?.department ? (matchDept(p.department) || editForm.department) : editForm.department,
                })
              }
            />
          </Field>
          <div className="field-row">
            <Field label="Display name">
              <input className="input" value={editForm.displayname} onChange={(e) => setEditForm({ ...editForm, displayname: e.target.value })} placeholder="Ada Lovelace" />
            </Field>
            <Field label="User ID (email / UPN)">
              <input className="input" value={editForm.userid} onChange={(e) => setEditForm({ ...editForm, userid: e.target.value })} placeholder="ada@contoso.com" />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Department">
              <select className="select" value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}>
                <option value="">Select…</option>
                {departments.map((d) => <option key={d.abs_departmentid} value={d.abs_departmentid}>{d.abs_name}</option>)}
              </select>
            </Field>
            <Field label="Role">
              <select className="select" value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: Number(e.target.value) })}>
                <option value={ChampionRole.Champion}>Champion</option>
                <option value={ChampionRole.ProgramManager}>Program Manager</option>
              </select>
            </Field>
          </div>
          <Field label="Status" help="Set to Inactive to disable this champion's access to the app.">
            <select className="select" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: Number(e.target.value) })}>
              {optionsOf(ChampionStatusLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </Modal>
      )}

      {removing && (
        <Modal
          title="Remove champion?"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setRemoving(null)}>Cancel</button>
              <button className="btn btn-danger" disabled={busyId === removing.abs_championid} onClick={removeChampion}>
                {busyId === removing.abs_championid ? 'Removing…' : 'Remove'}
              </button>
            </>
          }
        >
          <p>
            This permanently deletes <strong>{removing.crd49_displayname || removing.abs_userid}</strong> from
            the Champions directory. This cannot be undone.
          </p>
          <p className="text-muted" style={{ fontSize: '0.86rem' }}>
            To temporarily block access instead, use <strong>Disable</strong>.
          </p>
        </Modal>
      )}
    </>
  );
}
