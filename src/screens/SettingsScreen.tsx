import { useEffect, useMemo, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import {
  ProgramSettingsSvc, AppAdminsSvc, DepartmentsSvc,
} from '../data/entities';
import { Card, Field, Toggle, EmptyState, Avatar, Pill } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { formatDate } from '../lib/format';

export default function SettingsScreen() {
  const { settings, appAdmins, champions, departments, isAdmin, currentUser, reload } = useAppData();
  const toast = useToast();

  const [cfg, setCfg] = useState({
    selfNom: settings?.crd49_selfnominationenabled ?? false,
    approval: settings?.crd49_activityapprovalrequired ?? false,
    community: settings?.abs_copilotcommunityurl ?? '',
    communityName: settings?.abs_communityname ?? '',
    sharepoint: settings?.crd49_sharepointurl ?? '',
  });
  const [savingCfg, setSavingCfg] = useState(false);

  // Keep the form in sync with the persisted settings record (after load / reload).
  useEffect(() => {
    setCfg({
      selfNom: settings?.crd49_selfnominationenabled ?? false,
      approval: settings?.crd49_activityapprovalrequired ?? false,
      community: settings?.abs_copilotcommunityurl ?? '',
      communityName: settings?.abs_communityname ?? '',
      sharepoint: settings?.crd49_sharepointurl ?? '',
    });
  }, [settings]);

  const [showAdmin, setShowAdmin] = useState(false);
  const [elevateId, setElevateId] = useState('');
  const [deptModal, setDeptModal] = useState<{ id?: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Admins are matched to people by UPN — build a set to filter the champion picker.
  const adminUpns = useMemo(
    () => new Set(appAdmins.map((a) => (a.abs_userid || '').toLowerCase())),
    [appAdmins],
  );

  // Champions who aren't already admins can be elevated.
  const eligibleChampions = useMemo(
    () => champions
      .filter((c) => c.abs_userid && !adminUpns.has(c.abs_userid.toLowerCase()))
      .sort((a, b) => (a.crd49_displayname || '').localeCompare(b.crd49_displayname || '')),
    [champions, adminUpns],
  );

  // The "default" admin is the earliest-added one (the seeded environment admin).
  const defaultAdminId = useMemo(() => {
    if (appAdmins.length === 0) return null;
    return [...appAdmins]
      .sort((a, b) => {
        const ta = new Date(a.abs_addeddate ?? '').getTime() || Infinity;
        const tb = new Date(b.abs_addeddate ?? '').getTime() || Infinity;
        return ta - tb;
      })[0].abs_appadminid;
  }, [appAdmins]);

  // Reason an admin can't be demoted (null = allowed). The default admin is
  // protected until at least one other admin exists; the last admin can never go.
  function demoteBlockReason(a: typeof appAdmins[number]): string | null {
    if (appAdmins.length <= 1) {
      return a.abs_appadminid === defaultAdminId
        ? 'The default administrator can\u2019t be removed while they are the only admin. Assign another admin first.'
        : 'At least one administrator must remain.';
    }
    return null;
  }

  const credit = (
    <div className="settings-credit">
      <span className="settings-credit-label">Developed by:</span> Zafar Ul Islam (<a href="mailto:zafaru@microsoft.com">zafaru@microsoft.com</a>)
    </div>
  );

  if (!isAdmin) {
    return (
      <>
        <Card><EmptyState icon="🔒" title="Admins only" message="Program settings are available to Program Managers and App Admins." /></Card>
        {credit}
      </>
    );
  }

  async function saveConfig() {
    setSavingCfg(true);
    try {
      const fields = {
        crd49_selfnominationenabled: cfg.selfNom,
        crd49_activityapprovalrequired: cfg.approval,
        abs_copilotcommunityurl: cfg.community.trim() || null,
        abs_communityname: cfg.communityName.trim() || null,
        crd49_sharepointurl: cfg.sharepoint.trim() || null,
      };
      if (settings) {
        const res = await ProgramSettingsSvc.update(settings.abs_programsettingsid, fields as never);
        if (!res.success) throw new Error(res.error?.message ?? 'Update failed');
      } else {
        // No settings record yet — create one so configuration always persists.
        const res = await ProgramSettingsSvc.create({ abs_name: 'Program Settings', ...fields } as never);
        if (!res.success) throw new Error(res.error?.message ?? 'Create failed');
      }
      toast.success('Settings saved.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save settings.');
    } finally {
      setSavingCfg(false);
    }
  }

  async function elevateAdmin() {
    const champ = champions.find((c) => c.abs_championid === elevateId);
    if (!champ || !champ.abs_userid) { toast.error('Select a champion to elevate.'); return; }
    setBusy(true);
    try {
      const res = await AppAdminsSvc.create({
        abs_userid: champ.abs_userid,
        abs_displayname: champ.crd49_displayname || champ.abs_userid,
        abs_addedby: currentUser?.userPrincipalName || 'system',
        abs_addeddate: new Date().toISOString(),
      } as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Create failed');
      toast.success(`${champ.crd49_displayname || 'Champion'} is now an admin.`);
      setElevateId('');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to elevate champion.');
    } finally {
      setBusy(false);
    }
  }

  async function demoteAdmin(a: typeof appAdmins[number]) {
    const reason = demoteBlockReason(a);
    if (reason) { toast.error(reason); return; }
    setBusy(true);
    try {
      await AppAdminsSvc.delete(a.abs_appadminid);
      toast.success('Admin demoted.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to demote admin.');
    } finally {
      setBusy(false);
    }
  }

  async function saveDept() {
    if (!deptModal || !deptModal.name.trim()) { toast.error('Name is required.'); return; }
    setBusy(true);
    try {
      if (deptModal.id) {
        const res = await DepartmentsSvc.update(deptModal.id, {
          abs_name: deptModal.name.trim(),
        } as never);
        if (!res.success) throw new Error(res.error?.message ?? 'Update failed');
      } else {
        const res = await DepartmentsSvc.create({
          abs_name: deptModal.name.trim(),
        } as never);
        if (!res.success) throw new Error(res.error?.message ?? 'Create failed');
      }
      toast.success('Department saved.');
      setDeptModal(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save department.');
    } finally {
      setBusy(false);
    }
  }

  async function removeDept(id: string) {
    setBusy(true);
    try {
      await DepartmentsSvc.delete(id);
      toast.success('Department removed.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove department.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <div className="page-subtitle">Configure the program, admins and departments.</div>
        </div>
      </div>

      <div className="grid grid-2">
        <Card title="⚙️ Program Configuration" action={<button className="btn btn-primary btn-sm" disabled={savingCfg} onClick={saveConfig}>{savingCfg ? 'Saving…' : 'Save'}</button>}>
          <div className="list-item">
            <div className="center-col spacer">
              <span className="item-title">Self-Nomination</span>
              <span className="item-sub">Let employees nominate themselves as champions.</span>
            </div>
            <Toggle on={cfg.selfNom} onChange={(v) => setCfg({ ...cfg, selfNom: v })} />
          </div>
          <div className="list-item">
            <div className="center-col spacer">
              <span className="item-title">Activity Approval Required</span>
              <span className="item-sub">Require approver sign-off before points are awarded.</span>
            </div>
            <Toggle on={cfg.approval} onChange={(v) => setCfg({ ...cfg, approval: v })} />
          </div>
          <div className="divider" />
          <Field label="AI Champions Community Name" help="Label shown on the floating community button.">
            <input className="input" value={cfg.communityName} onChange={(e) => setCfg({ ...cfg, communityName: e.target.value })} placeholder="AI Champions Community" />
          </Field>
          <Field label="AI Champions Community URL" help="Shows a floating community button on every page.">
            <input className="input" value={cfg.community} onChange={(e) => setCfg({ ...cfg, community: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label="SharePoint document library URL" help="Where champions upload evidence for claims.">
            <input className="input" value={cfg.sharepoint} onChange={(e) => setCfg({ ...cfg, sharepoint: e.target.value })} placeholder="https://…" />
          </Field>
        </Card>

        <Card title={`👮 Application Admins (${appAdmins.length})`} action={<button className="btn btn-secondary btn-sm" onClick={() => setShowAdmin(true)}>Manage</button>}>
          {appAdmins.length === 0 ? (
            <EmptyState icon="👮" title="No app admins" message="Add an admin to grant elevated access." />
          ) : (
            <div className="list">
              {appAdmins.map((a) => {
                const reason = demoteBlockReason(a);
                const isDefault = a.abs_appadminid === defaultAdminId;
                return (
                  <div className="list-item" key={a.abs_appadminid}>
                    <Avatar name={a.abs_displayname || a.abs_userid} size={34} />
                    <div className="center-col spacer">
                      <span className="item-title">
                        {a.abs_displayname || a.abs_userid}
                        {isDefault && <> <Pill color="purple">Default</Pill></>}
                      </span>
                      <span className="item-sub">{a.abs_userid} · added {formatDate(a.abs_addeddate)}</span>
                    </div>
                    <button className="btn btn-ghost btn-sm" disabled={busy || !!reason} title={reason ?? 'Demote this admin'} onClick={() => demoteAdmin(a)}>Demote</button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Card
        className="mt-24"
        title={`🏢 Departments (${departments.length})`}
        action={<button className="btn btn-primary btn-sm" onClick={() => setDeptModal({ name: '' })}>➕ Add Department</button>}
      >
        {departments.length === 0 ? (
          <EmptyState icon="🏢" title="No departments" />
        ) : (
          <div className="list">
            {departments.map((d) => (
              <div className="list-item" key={d.abs_departmentid}>
                <div className="center-col spacer">
                  <span className="item-title">{d.abs_name}</span>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setDeptModal({ id: d.abs_departmentid, name: d.abs_name })}>Edit</button>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => removeDept(d.abs_departmentid)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {showAdmin && (
        <Modal
          title="Manage Admins"
          onClose={() => setShowAdmin(false)}
          footer={<button className="btn btn-secondary" onClick={() => setShowAdmin(false)}>Done</button>}
        >
          <Field label="Elevate a champion to admin" help="Grant program-admin access to an existing champion.">
            <div className="field-row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <select className="input spacer" value={elevateId} onChange={(e) => setElevateId(e.target.value)} disabled={eligibleChampions.length === 0}>
                <option value="">{eligibleChampions.length === 0 ? 'All champions are already admins' : 'Select a champion…'}</option>
                {eligibleChampions.map((c) => (
                  <option key={c.abs_championid} value={c.abs_championid}>
                    {c.crd49_displayname || c.abs_userid}{c.crd49_departmentname ? ` · ${c.crd49_departmentname}` : ''}
                  </option>
                ))}
              </select>
              <button className="btn btn-primary" disabled={busy || !elevateId} onClick={elevateAdmin}>{busy ? 'Working…' : 'Elevate'}</button>
            </div>
          </Field>

          <div className="divider" />
          <div className="section-label">Current admins ({appAdmins.length})</div>
          <div className="list">
            {appAdmins.map((a) => {
              const reason = demoteBlockReason(a);
              const isDefault = a.abs_appadminid === defaultAdminId;
              return (
                <div className="list-item" key={a.abs_appadminid}>
                  <Avatar name={a.abs_displayname || a.abs_userid} size={32} />
                  <div className="center-col spacer">
                    <span className="item-title">
                      {a.abs_displayname || a.abs_userid}
                      {isDefault && <> <Pill color="purple">Default</Pill></>}
                    </span>
                    <span className="item-sub">{a.abs_userid}</span>
                  </div>
                  <button className="btn btn-ghost btn-sm" disabled={busy || !!reason} title={reason ?? 'Demote this admin'} onClick={() => demoteAdmin(a)}>Demote</button>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {deptModal && (
        <Modal
          title={deptModal.id ? 'Edit Department' : 'Add Department'}
          onClose={() => setDeptModal(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDeptModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy} onClick={saveDept}>{busy ? 'Saving…' : 'Save'}</button>
            </>
          }
        >
          <Field label="Name"><input className="input" value={deptModal.name} onChange={(e) => setDeptModal({ ...deptModal, name: e.target.value })} autoFocus /></Field>
        </Modal>
      )}

      {credit}
    </>
  );
}
