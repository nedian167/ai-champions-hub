import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../context/AppDataContext';
import { CampaignsSvc, CampaignDepartmentsSvc, bind, type Abs_campaigns } from '../data/entities';
import { Card, KpiCard, Pill, EmptyState, Tabs, Field } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { CampaignStatus, CampaignStatusLabel, optionsOf } from '../lib/enums';
import { formatDate, toDateInput } from '../lib/format';
import { campaignStatusColor } from './HomeScreen';

type Tab = 'active' | 'draft' | 'completed';

const BANNER_FALLBACK: Record<number, string> = {
  [CampaignStatus.Active]: 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 55%, #7c3aed 100%)',
  [CampaignStatus.Draft]: 'linear-gradient(135deg, #64748b 0%, #475569 60%, #334155 100%)',
  [CampaignStatus.Completed]: 'linear-gradient(135deg, #10b981 0%, #059669 60%, #047857 100%)',
};

function bannerStyle(c: Abs_campaigns): CSSProperties {
  const fallback = BANNER_FALLBACK[c.crd49_status] ?? BANNER_FALLBACK[CampaignStatus.Active];
  if (c.crd49_imageurl) {
    return {
      backgroundImage: `linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.05) 55%, rgba(0,0,0,0) 100%), url("${c.crd49_imageurl}")`,
    };
  }
  return { backgroundImage: `linear-gradient(to top, rgba(0,0,0,0.35), rgba(0,0,0,0) 60%), ${fallback}` };
}

export default function CampaignsScreen() {
  const nav = useNavigate();
  const {
    campaigns, departments, champions, campaignDepartments, participations, currentChampion, isAdmin, reload,
  } = useAppData();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('active');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', theme: '', description: '', startdate: toDateInput(new Date().toISOString()),
    enddate: '', status: CampaignStatus.Draft as number, owner: '', imageurl: '', departments: [] as string[],
  });

  const [banner, setBanner] = useState<Abs_campaigns | null>(null);
  const [bannerUrl, setBannerUrl] = useState('');
  const [savingBanner, setSavingBanner] = useState(false);

  const canEditBanner = (c: Abs_campaigns) =>
    isAdmin || (!!currentChampion && c._crd49_campaignowner_value === currentChampion.abs_championid);

  const deptsByCampaign = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const cd of campaignDepartments) {
      const cid = cd._abs_campaign_value;
      if (!cid) continue;
      const name = departments.find((d) => d.abs_departmentid === cd._abs_department_value)?.abs_name;
      if (!name) continue;
      m.set(cid, [...(m.get(cid) ?? []), name]);
    }
    return m;
  }, [campaignDepartments, departments]);

  const partCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of participations) {
      const cid = p._crd49_campaign_value;
      if (cid) m.set(cid, (m.get(cid) ?? 0) + 1);
    }
    return m;
  }, [participations]);

  const counts = {
    active: campaigns.filter((c) => c.crd49_status === CampaignStatus.Active).length,
    draft: campaigns.filter((c) => c.crd49_status === CampaignStatus.Draft).length,
    completed: campaigns.filter((c) => c.crd49_status === CampaignStatus.Completed).length,
  };

  const shown = campaigns.filter((c) =>
    tab === 'active' ? c.crd49_status === CampaignStatus.Active
      : tab === 'draft' ? c.crd49_status === CampaignStatus.Draft
        : c.crd49_status === CampaignStatus.Completed,
  );

  function openBanner(c: Abs_campaigns) {
    setBanner(c);
    setBannerUrl(c.crd49_imageurl ?? '');
  }

  async function saveBanner() {
    if (!banner) return;
    setSavingBanner(true);
    try {
      const url = bannerUrl.trim();
      const res = await CampaignsSvc.update(banner.abs_campaignid, {
        crd49_imageurl: url ? url : null,
      } as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Update failed');
      toast.success(url ? 'Banner updated.' : 'Banner removed.');
      setBanner(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update banner.');
    } finally {
      setSavingBanner(false);
    }
  }

  async function createCampaign() {
    if (!form.name.trim() || !form.startdate || !form.enddate) {
      toast.error('Name, start and end date are required.');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        abs_name: form.name.trim(),
        crd49_theme: form.theme.trim() || undefined,
        crd49_description: form.description.trim() || undefined,
        crd49_startdate: new Date(form.startdate).toISOString(),
        crd49_enddate: new Date(form.enddate).toISOString(),
        crd49_status: form.status,
        crd49_imageurl: form.imageurl.trim() || undefined,
      };
      if (form.owner) payload['crd49_CampaignOwner@odata.bind'] = bind('champion', form.owner);
      const res = await CampaignsSvc.create(payload as never);
      if (!res.success || !res.data) throw new Error(res.error?.message ?? 'Create failed');
      const campaignId = res.data.abs_campaignid;
      for (const deptId of form.departments) {
        await CampaignDepartmentsSvc.create({
          abs_name: `${form.name.trim()} audience`,
          'abs_Campaign@odata.bind': bind('campaign', campaignId),
          'abs_Department@odata.bind': bind('department', deptId),
        } as never);
      }
      toast.success('Campaign created.');
      setShow(false);
      setForm({ name: '', theme: '', description: '', startdate: toDateInput(new Date().toISOString()), enddate: '', status: CampaignStatus.Draft, owner: '', imageurl: '', departments: [] });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create campaign.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Campaigns</h1>
          <div className="page-subtitle">Manage AI adoption campaigns and track progress</div>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={() => setShow(true)}>➕ New Campaign</button>}
      </div>

      <div className="grid grid-kpi">
        <KpiCard label="Active Campaigns" value={counts.active} icon="🚀" iconBg="var(--green-soft)" iconColor="var(--green)" />
        <KpiCard label="Drafts" value={counts.draft} icon="🕑" iconBg="var(--gray-soft)" iconColor="var(--gray)" />
        <KpiCard label="Completed" value={counts.completed} icon="✅" iconBg="var(--blue-soft)" iconColor="var(--blue)" />
      </div>

      <div className="mt-24">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'active', label: `Active (${counts.active})` },
            { key: 'draft', label: `Drafts (${counts.draft})` },
            { key: 'completed', label: `Completed (${counts.completed})` },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <Card><EmptyState icon="📣" title="No campaigns here" message="Create a campaign to get started." /></Card>
      ) : (
        <div className="grid grid-cards">
          {shown.map((c) => {
            const audience = deptsByCampaign.get(c.abs_campaignid);
            return (
              <div className="card campaign-card" key={c.abs_campaignid} onClick={() => nav(`/campaigns/${c.abs_campaignid}`)}>
                <div className="cc-banner" style={bannerStyle(c)}>
                  <div className="cc-banner-pills">
                    <Pill color={audience && audience.length ? 'purple' : 'gray'}>
                      🌐 {audience && audience.length ? audience.join(', ') : 'All Employees'}
                    </Pill>
                    <Pill color={campaignStatusColor(c.crd49_status)}>{CampaignStatusLabel[c.crd49_status]}</Pill>
                  </div>
                  {canEditBanner(c) && (
                    <button
                      className="cc-banner-edit"
                      title={c.crd49_imageurl ? 'Change banner image' : 'Add banner image'}
                      onClick={(e) => { e.stopPropagation(); openBanner(c); }}
                    >
                      🖼
                    </button>
                  )}
                  <div className="cc-banner-title">
                    <h3>{c.abs_name}</h3>
                    {c.crd49_theme && <span className="cc-theme">{c.crd49_theme}</span>}
                  </div>
                </div>
                <div className="cc-body">
                  <p className="entity-desc">{c.crd49_description || 'No description provided.'}</p>
                  <div className="row">
                    <span className="item-sub">👥 {partCount.get(c.abs_campaignid) ?? 0}</span>
                    <span className="spacer" />
                    <span className="item-sub">📅 {formatDate(c.crd49_startdate)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {banner && (
        <Modal
          title="Campaign banner"
          onClose={() => setBanner(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setBanner(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={savingBanner} onClick={saveBanner}>{savingBanner ? 'Saving…' : 'Save Banner'}</button>
            </>
          }
        >
          <Field label="Banner image URL" help="Paste a link to an image. Leave empty to remove the banner.">
            <input
              className="input"
              value={bannerUrl}
              onChange={(e) => setBannerUrl(e.target.value)}
              placeholder="https://…/banner.png"
            />
          </Field>
          <div
            className="banner-preview"
            style={bannerUrl.trim()
              ? { backgroundImage: `url("${bannerUrl.trim()}")` }
              : { background: BANNER_FALLBACK[banner.crd49_status] ?? BANNER_FALLBACK[CampaignStatus.Active], color: '#fff' }}
          >
            {bannerUrl.trim() ? '' : 'No banner — a themed gradient is shown instead'}
          </div>
        </Modal>
      )}

      {show && (
        <Modal
          title="New Campaign"
          wide
          onClose={() => setShow(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShow(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={createCampaign}>{saving ? 'Saving…' : 'Create Campaign'}</button>
            </>
          }
        >
          <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="field-row">
            <Field label="Theme"><input className="input" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} placeholder="e.g. Copilot Basics" /></Field>
            <Field label="Owner">
              <select className="select" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
                <option value="">Unassigned</option>
                {champions.map((c) => <option key={c.abs_championid} value={c.abs_championid}>{c.crd49_displayname}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description"><textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="field-row">
            <Field label="Start date"><input type="date" className="input" value={form.startdate} onChange={(e) => setForm({ ...form, startdate: e.target.value })} /></Field>
            <Field label="End date"><input type="date" className="input" value={form.enddate} onChange={(e) => setForm({ ...form, enddate: e.target.value })} /></Field>
          </div>
          <div className="field-row">
            <Field label="Status">
              <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: Number(e.target.value) })}>
                {optionsOf(CampaignStatusLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Banner image URL"><input className="input" value={form.imageurl} onChange={(e) => setForm({ ...form, imageurl: e.target.value })} placeholder="https://…" /></Field>
          </div>
          <Field label="Audience departments" help="Leave empty to target all employees.">
            <div className="row">
              {departments.map((d) => {
                const on = form.departments.includes(d.abs_departmentid);
                return (
                  <button
                    type="button"
                    key={d.abs_departmentid}
                    className={`btn btn-sm ${on ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setForm({
                      ...form,
                      departments: on ? form.departments.filter((x) => x !== d.abs_departmentid) : [...form.departments, d.abs_departmentid],
                    })}
                  >
                    {d.abs_name}
                  </button>
                );
              })}
            </div>
          </Field>
        </Modal>
      )}
    </>
  );
}
