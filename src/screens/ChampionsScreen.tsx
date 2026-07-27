import { useMemo, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import { ChampionsSvc, bind } from '../data/entities';
import { Card, KpiCard, Pill, Avatar, EmptyState, SearchInput, Field } from '../components/ui';
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
  const { champions, departments, departmentById, pointsFor, isAdmin, reload, currentUser } = useAppData();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<number | 'all'>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

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

  const active = champions.filter((c) => c.crd49_status === ChampionStatus.Active).length;
  const pending = champions.filter((c) => c.crd49_status === ChampionStatus.Pending).length;

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
        <KpiCard label="Total Champions" value={champions.length} icon="🧑‍🚀" iconBg="var(--purple-soft)" iconColor="var(--purple)" />
        <KpiCard label="Active" value={active} icon="✅" iconBg="var(--green-soft)" iconColor="var(--green)" />
        <KpiCard label="Pending Approval" value={pending} icon="⏳" iconBg="var(--amber-soft)" iconColor="var(--amber)" />
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
                <Pill color={statusColor(c.crd49_status)}>{ChampionStatusLabel[c.crd49_status]}</Pill>
              </div>
              <div className="meta-row">🏢 {departmentById.get(c._crd49_department_value ?? '')?.abs_name ?? '—'}</div>
              <div className="row">
                <span className="points-badge">{pointsFor(c.abs_championid)} pts</span>
                <span className="spacer" />
                <span className="item-sub">Joined {formatDate(c.crd49_joineddate)}</span>
              </div>
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
          <Field label="Display name">
            <input className="input" value={form.displayname} onChange={(e) => setForm({ ...form, displayname: e.target.value })} placeholder="Ada Lovelace" />
          </Field>
          <Field label="User ID (email / UPN)" help={currentUser ? undefined : 'Tip: use the champion\'s work email.'}>
            <input className="input" value={form.userid} onChange={(e) => setForm({ ...form, userid: e.target.value })} placeholder="ada@contoso.com" />
          </Field>
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
    </>
  );
}
