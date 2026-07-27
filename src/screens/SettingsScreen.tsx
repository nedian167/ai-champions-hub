import { useEffect, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import {
  ProgramSettingsSvc, AppAdminsSvc, DepartmentsSvc,
} from '../data/entities';
import { Card, Field, Toggle, EmptyState, Avatar } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { formatDate } from '../lib/format';

export default function SettingsScreen() {
  const { settings, appAdmins, departments, isAdmin, currentUser, reload } = useAppData();
  const toast = useToast();

  const [cfg, setCfg] = useState({
    selfNom: settings?.crd49_selfnominationenabled ?? false,
    approval: settings?.crd49_activityapprovalrequired ?? false,
    community: settings?.abs_copilotcommunityurl ?? '',
    sharepoint: settings?.crd49_sharepointurl ?? '',
  });
  const [savingCfg, setSavingCfg] = useState(false);

  // Keep the form in sync with the persisted settings record (after load / reload).
  useEffect(() => {
    setCfg({
      selfNom: settings?.crd49_selfnominationenabled ?? false,
      approval: settings?.crd49_activityapprovalrequired ?? false,
      community: settings?.abs_copilotcommunityurl ?? '',
      sharepoint: settings?.crd49_sharepointurl ?? '',
    });
  }, [settings]);

  const [showAdmin, setShowAdmin] = useState(false);
  const [adminForm, setAdminForm] = useState({ userid: '', displayname: '' });
  const [deptModal, setDeptModal] = useState<{ id?: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isAdmin) {
    return <Card><EmptyState icon="🔒" title="Admins only" message="Program settings are available to Program Managers and App Admins." /></Card>;
  }

  async function saveConfig() {
    setSavingCfg(true);
    try {
      const fields = {
        crd49_selfnominationenabled: cfg.selfNom,
        crd49_activityapprovalrequired: cfg.approval,
        abs_copilotcommunityurl: cfg.community.trim() || null,
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

  async function addAdmin() {
    if (!adminForm.userid.trim()) { toast.error('User ID is required.'); return; }
    setBusy(true);
    try {
      const res = await AppAdminsSvc.create({
        abs_userid: adminForm.userid.trim(),
        abs_displayname: adminForm.displayname.trim() || adminForm.userid.trim(),
        abs_addedby: currentUser?.userPrincipalName || 'system',
        abs_addeddate: new Date().toISOString(),
      } as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Create failed');
      toast.success('Admin added.');
      setShowAdmin(false);
      setAdminForm({ userid: '', displayname: '' });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add admin.');
    } finally {
      setBusy(false);
    }
  }

  async function removeAdmin(id: string) {
    setBusy(true);
    try {
      await AppAdminsSvc.delete(id);
      toast.success('Admin removed.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove admin.');
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
          <Field label="Copilot Community URL" help="Shows a floating community button on every page.">
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
              {appAdmins.map((a) => (
                <div className="list-item" key={a.abs_appadminid}>
                  <Avatar name={a.abs_displayname || a.abs_userid} size={34} />
                  <div className="center-col spacer">
                    <span className="item-title">{a.abs_displayname || a.abs_userid}</span>
                    <span className="item-sub">{a.abs_userid} · added {formatDate(a.abs_addeddate)}</span>
                  </div>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => removeAdmin(a.abs_appadminid)}>Remove</button>
                </div>
              ))}
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
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowAdmin(false)}>Close</button>
              <button className="btn btn-primary" disabled={busy} onClick={addAdmin}>{busy ? 'Adding…' : 'Add Admin'}</button>
            </>
          }
        >
          <div className="field-row">
            <Field label="User ID (email / UPN)"><input className="input" value={adminForm.userid} onChange={(e) => setAdminForm({ ...adminForm, userid: e.target.value })} placeholder="user@contoso.com" /></Field>
            <Field label="Display name"><input className="input" value={adminForm.displayname} onChange={(e) => setAdminForm({ ...adminForm, displayname: e.target.value })} /></Field>
          </div>
          {appAdmins.length > 0 && (
            <>
              <div className="divider" />
              <div className="list">
                {appAdmins.map((a) => (
                  <div className="list-item" key={a.abs_appadminid}>
                    <div className="center-col spacer">
                      <span className="item-title">{a.abs_displayname || a.abs_userid}</span>
                      <span className="item-sub">{a.abs_userid}</span>
                    </div>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => removeAdmin(a.abs_appadminid)}>Remove</button>
                  </div>
                ))}
              </div>
            </>
          )}
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
    </>
  );
}
