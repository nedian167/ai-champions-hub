import { useEffect, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import { Card, EmptyState } from '../components/ui';
import { useToast } from '../components/Toast';
import NotificationTemplatesEditor from '../components/NotificationTemplatesEditor';
import {
  loadNotificationPreferences, saveNotificationPreferences, loadNotificationDeliveries,
  type NotificationPreference, type NotificationDelivery,
} from '../data/notifications';
import {
  defaultNotificationSettings, deliveryStatus, notificationCategories, notificationChannels,
  readNotificationSettings, type NotificationSettings,
} from '../lib/notifications';
import { formatDate } from '../lib/format';

export default function NotificationsScreen() {
  const { currentUser, isAdmin, isBootstrapAdmin } = useAppData();
  const toast = useToast();
  const [record, setRecord] = useState<NotificationPreference | null>(null);
  const [form, setForm] = useState<NotificationSettings>({ ...defaultNotificationSettings });
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const objectId = currentUser?.objectId;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [preference, history] = await Promise.all([
          loadNotificationPreferences(objectId ?? ''),
          loadNotificationDeliveries(objectId ?? ''),
        ]);
        if (cancelled) return;
        setRecord(preference);
        setForm(preference ? readNotificationSettings(preference) : { ...defaultNotificationSettings });
        setDeliveries(history);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load notifications.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [objectId, revision]);

  function refresh() {
    setLoading(true);
    setError('');
    setRevision((value) => value + 1);
  }

  async function save() {
    if (saving || loading || error || !objectId) return;
    setSaving(true);
    try {
      const saved = await saveNotificationPreferences(objectId, record?.abs_notificationpreferenceid, form);
      setRecord(saved);
      setForm(readNotificationSettings(saved));
      toast.success('Notification preferences saved.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save notification preferences.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div><h1>Notifications</h1><div className="page-subtitle">Choose how AI Champions Hub keeps you informed.</div></div>
        <button className="btn btn-secondary" disabled={saving || loading} onClick={refresh}>Refresh</button>
      </div>
      {loading ? <Card><p role="status">Loading your notification preferences...</p></Card> : error ? (
        <Card><div role="alert">{error}</div><p className="help-text">If this module was just deployed, ask an administrator to confirm the notification solution and security roles are installed.</p></Card>
      ) : (
        <>
          <Card title="Your notification preferences">
            <p>Notifications are off until you opt in. Settings belong to your signed-in account; a Champion profile is not required.</p>
            <label className="row mt-16">
              <input type="checkbox" checked={form.abs_paused} disabled={saving} onChange={(e) => setForm({ ...form, abs_paused: e.target.checked })} />
              Pause all notifications without losing my channel choices
            </label>
            {form.abs_paused && <p role="status" className="help-text">Notifications are paused after you save. Messages already being sent cannot be recalled.</p>}
            <div className="rtable-wrap mt-16">
              <table className="rtable">
                <thead><tr><th>Category</th><th>Channel</th></tr></thead>
                <tbody>
                  {notificationCategories.map(({ field, label, description }) => (
                    <tr key={field}>
                      <td><strong>{label}</strong><div className="help-text">{description}</div></td>
                      <td>
                        <select aria-label={`${label} notification channel`} className="select" style={{ minWidth: 170 }} value={form[field]} disabled={saving || form.abs_paused}
                          onChange={(e) => {
                            const channel = notificationChannels.find((item) => item.value === Number(e.target.value));
                            if (channel) setForm({ ...form, [field]: channel.value });
                          }}>
                          {notificationChannels.map(({ value, label: channelLabel }) => <option key={value} value={value}>{channelLabel}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="help-text mt-16">Alerts are processed in the background. Daily reminders run at 07:00 UTC. Teams notifications are private cards; email is sent separately only when you choose it. There is no automatic switch to another channel.</p>
            <button className="btn btn-primary mt-16" disabled={saving} onClick={() => void save()}>{saving ? 'Saving...' : 'Save preferences'}</button>
          </Card>
          <Card title="Recent delivery activity" className="mt-24">
            {deliveries.length === 0 ? <EmptyState icon="📭" title="No notifications yet" message="Once you opt in, your latest 25 delivery records will appear here." /> : (
              <div className="rtable-wrap">
                <table className="rtable">
                  <thead><tr><th>Notification</th><th>Channel</th><th>Status</th><th>Created</th></tr></thead>
                  <tbody>{deliveries.map((delivery) => (
                    <tr key={delivery.abs_notificationdeliveryid}>
                      <td>{delivery.abs_name}{delivery.abs_error && <div className="help-text">{delivery.abs_error}</div>}</td>
                      <td>{delivery.abs_channel === 1 ? 'Teams' : delivery.abs_channel === 2 ? 'Email' : 'Invalid channel'}</td>
                      <td>{deliveryStatus[delivery.abs_state] ?? 'Invalid delivery status'}</td>
                      <td>{formatDate(delivery.createdon)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <p className="help-text">Sent means the connector accepted the message, not that it was read. For failed or unconfirmed deliveries, contact a program administrator. Unconfirmed messages are not automatically resent.</p>
          </Card>
        </>
      )}
      {isAdmin && !isBootstrapAdmin && <NotificationTemplatesEditor />}
    </>
  );
}
