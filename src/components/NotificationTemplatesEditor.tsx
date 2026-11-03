import { useEffect, useState } from 'react';
import { Card, Field } from './ui';
import { useToast } from './Toast';
import { loadNotificationTemplates, saveNotificationTemplates, type SavedTemplates } from '../data/notificationTemplates';
import {
  defaultTemplate, expandTemplate, fieldLabels, fieldsFor, previewValues, templateKinds,
  validateTemplate, type NotificationTemplate, type TemplateKind,
} from '../lib/notificationTemplates';

export default function NotificationTemplatesEditor() {
  const toast = useToast();
  const [saved, setSaved] = useState<SavedTemplates | null>(null);
  const [kind, setKind] = useState<TemplateKind>('request.created');
  const [form, setForm] = useState<NotificationTemplate>(defaultTemplate('request.created'));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void loadNotificationTemplates().then((result) => {
      if (!cancelled) { setSaved(result); setError(''); }
    }).catch((failure: unknown) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : 'Could not load notification templates.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision]);
  const active = dirty ? form : saved?.configuration.templates.find((item) => item.kind === kind) ?? defaultTemplate(kind);
  let validation = '';
  try { validateTemplate(active); } catch (failure) { validation = failure instanceof Error ? failure.message : 'Invalid template.'; }
  function change(changes: Partial<NotificationTemplate>) { setForm({ ...active, ...changes }); setDirty(true); }
  async function save(reset = false) {
    if (!saved || busy || (!reset && validation)) return;
    setBusy(true);
    try {
      const templates = saved.configuration.templates.filter((item) => item.kind !== kind);
      if (!reset) templates.push(validateTemplate(active));
      const result = await saveNotificationTemplates(saved, { version: 1, templates });
      setSaved(result); setDirty(false);
      toast.success(reset ? 'Default notification template restored.' : 'Notification template saved.');
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'Could not save notification template.');
    } finally { setBusy(false); }
  }
  return (
    <Card title="Notification templates" className="notification-template-editor mt-24">
      <p>Configure Teams cards and email wording for each notification. Existing channel preferences still apply.</p>
      {loading ? <p role="status">Loading templates...</p> : error ? (
        <><p role="alert">{error}</p><p className="help-text">Deploy the template schema and updated plug-in before using this editor.</p>
          <button className="btn btn-secondary" onClick={() => { setLoading(true); setRevision((value) => value + 1); }}>Retry</button></>
      ) : (
        <>
          <Field label="Notification type">
            <select aria-label="Notification type" className="select" value={kind} disabled={busy || dirty} onChange={(e) => {
              const selected = templateKinds.find(([key]) => key === e.target.value);
              if (selected) setKind(selected[0]);
            }}>{templateKinds.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          </Field>
          <p className="help-text">Supported placeholders: {['Title', 'Summary', ...fieldsFor(kind)].map((field) => `{${field}}`).join(', ')}.
            Dates are explicitly UTC. Description and reply excerpts are limited to 500 characters and require selecting their fields.</p>
          <div className="grid grid-2">
            <div>
              <Field label="Card heading"><input aria-label="Card heading" className="input" maxLength={120} value={active.heading} disabled={busy} onChange={(e) => change({ heading: e.target.value })} /></Field>
              <Field label="Email subject"><input aria-label="Email subject" className="input" maxLength={200} value={active.subject} disabled={busy} onChange={(e) => change({ subject: e.target.value })} /></Field>
              <Field label="Message"><textarea aria-label="Message" className="textarea" maxLength={1200} rows={4} value={active.message} disabled={busy} onChange={(e) => change({ message: e.target.value })} /></Field>
              <Field label="Open in Hub button label"><input aria-label="Open in Hub button label" className="input" maxLength={40} value={active.actionLabel} disabled={busy} onChange={(e) => change({ actionLabel: e.target.value })} /></Field>
              <fieldset disabled={busy} className="notification-template-fields"><legend>Included detail fields</legend>
                {fieldsFor(kind).map((field) => <label className="row" key={field}>
                  <input type="checkbox" checked={active.fields.includes(field)} onChange={(e) => change({
                    fields: e.target.checked ? [...active.fields, field] : active.fields.filter((item) => item !== field),
                  })} />{fieldLabels[field]}
                </label>)}
                {kind === 'remind-event' && <label className="row"><input type="checkbox" checked={active.includeMeetingLink}
                  onChange={(e) => change({ includeMeetingLink: e.target.checked })} /><span>Include Join meeting button when a valid HTTPS meeting URL exists</span></label>}
              </fieldset>
              <p className="help-text">Excerpts and meeting links leave the Hub when sent. Include only information approved for the recipient's Teams chat or mailbox.</p>
            </div>
            <div>
              <h3>Teams card preview</h3>
              <p className="help-text">Illustrative layout, not a Teams renderer. Teams may display spacing and colors differently. No messages are sent.</p>
              <div className="notification-template-preview">
                <div className="text-muted">AI Champions Hub</div>
                <h3>{expandTemplate(active.heading, previewValues)}</h3>
                <strong>{previewValues.Title}</strong>
                <p className="notification-template-message">{expandTemplate(active.message, previewValues)}</p>
                <dl>{active.fields.filter((field) => !['Description', 'Reply'].includes(field)).map((field) => (
                  <div key={field}><dt>{fieldLabels[field]}</dt><dd>{previewValues[field]}</dd></div>
                ))}</dl>
                {active.fields.filter((field) => ['Description', 'Reply'].includes(field)).map((field) => (
                  <div key={field}><strong>{fieldLabels[field]}</strong><p>{previewValues[field]}</p></div>
                ))}
                <span className="btn btn-primary">{expandTemplate(active.actionLabel, previewValues)}</span>
                {active.includeMeetingLink && <span className="btn btn-secondary ml-8">Join meeting</span>}
              </div>
              <h3>Email preview</h3>
              <div className="notification-template-preview">
                <strong>Subject: {expandTemplate(active.subject, previewValues)}</strong>
                <h3>{expandTemplate(active.heading, previewValues)}</h3>
                <strong>{previewValues.Title}</strong>
                <p className="notification-template-message">{expandTemplate(active.message, previewValues)}</p>
                <dl>{active.fields.map((field) => <div key={field}><dt>{fieldLabels[field]}</dt><dd>{previewValues[field]}</dd></div>)}</dl>
                <span className="btn btn-primary">{expandTemplate(active.actionLabel, previewValues)}</span>
                {active.includeMeetingLink && <span className="btn btn-secondary ml-8">Join meeting</span>}
              </div>
            </div>
          </div>
          {validation && <p role="alert">{validation}</p>}
          <div className="row mt-16">
            <button className="btn btn-primary" disabled={busy || !!validation || !dirty} onClick={() => void save()}>{busy ? 'Saving...' : 'Save template'}</button>
            <button className="btn btn-secondary" disabled={busy || !dirty} onClick={() => setDirty(false)}>Discard changes</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => void save(true)}>Restore and save default</button>
            <button className="btn btn-secondary" disabled={busy || dirty} onClick={() => { setLoading(true); setRevision((value) => value + 1); }}>Refresh templates</button>
          </div>
          {dirty && <p role="status" className="help-text">Unsaved changes. Save or discard before selecting another notification type.</p>}
        </>
      )}
    </Card>
  );
}
