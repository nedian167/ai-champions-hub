import { useCallback, useEffect, useRef, useState } from 'react';
import type { Abs_events } from '../data/entities';
import { useAppData } from '../context/AppDataContext';
import {
  addToOutlookCalendar, findOutlookEvent, listOutlookCalendars,
  OutlookCreationUncertainError, outlookErrorMessage, type OutlookCalendar, type OutlookEvent,
} from '../lib/outlookCalendar';
import { Modal } from './Modal';
import { Field } from './ui';
import { getEventSchedule } from '../lib/eventSchedule';
import { EventScheduleDetails } from './EventScheduleDetails';

export function OutlookCalendarModal({ event, onClose }: { event: Abs_events; onClose: () => void }) {
  const { currentUser } = useAppData();
  let timeError = '';
  try {
    getEventSchedule(event);
  } catch (failure) {
    timeError = outlookErrorMessage(failure);
  }
  const [calendars, setCalendars] = useState<OutlookCalendar[]>([]);
  const [calendarId, setCalendarId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(!!currentUser && !timeError);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState<OutlookEvent | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [retryConfirmed, setRetryConfirmed] = useState(false);
  const [checkedCalendarId, setCheckedCalendarId] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const busy = useRef(false);
  const selected = calendars.find((item) => item.id === calendarId);
  const chooseCalendar = useCallback((id: string) => {
    setCalendarId(id);
    setChecking(true);
    setCheckedCalendarId('');
    setExisting(null);
    setError('');
    setStatus('');
    setConfirmed(false);
    setRetryConfirmed(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!currentUser || timeError) return;
    listOutlookCalendars().then((items) => {
      if (cancelled) return;
      setCalendars(items);
      chooseCalendar(items[0].id);
    }).catch((failure: unknown) => {
      if (!cancelled) setError(outlookErrorMessage(failure));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [currentUser, loadAttempt, chooseCalendar, timeError]);

  useEffect(() => {
    if (!calendarId) return;
    let cancelled = false;
    findOutlookEvent(calendarId, event.abs_eventid).then((item) => {
      if (!cancelled) {
        setExisting(item);
        setCheckedCalendarId(calendarId);
        if (item) setStatus('Already added to this calendar. No changes were made.');
      }
    }).catch((failure: unknown) => {
      if (!cancelled) setError(outlookErrorMessage(failure));
    }).finally(() => {
      if (!cancelled) setChecking(false);
    });
    return () => { cancelled = true; };
  }, [calendarId, event.abs_eventid]);

  const locked = loading || checking || saving;

  async function checkStatus() {
    if (busy.current || !selected) return;
    busy.current = true;
    setChecking(true);
    setError('');
    try {
      const item = await findOutlookEvent(calendarId, event.abs_eventid);
      setExisting(item);
      setCheckedCalendarId(calendarId);
      setStatus(item ? 'Confirmed in Outlook. No additional copy was created.' :
        uncertain ? 'No matching copy was found yet. Review Outlook before explicitly confirming a retry.' : 'No existing copy was found in this calendar.');
    } catch (failure) {
      setCheckedCalendarId('');
      setError(outlookErrorMessage(failure));
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }

  async function add() {
    if (busy.current || locked || !selected || !confirmed || timeError || existing || checkedCalendarId !== calendarId ||
        (uncertain && !retryConfirmed)) return;
    busy.current = true;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const result = await addToOutlookCalendar(event, calendarId);
      setExisting(result.event);
      setUncertain(false);
      setStatus(result.status === 'added' ? 'Added to your Outlook calendar.' :
        result.status === 'recovered' ? 'Confirmed in Outlook after an interrupted response. No retry was needed.' :
        'Already added to this calendar. No changes were made.');
    } catch (failure) {
      setError(outlookErrorMessage(failure));
      if (failure instanceof OutlookCreationUncertainError) {
        setUncertain(true);
        setRetryConfirmed(false);
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal title="Add to my Outlook calendar" wide onClose={() => { if (!saving && !busy.current) onClose(); }} footer={
      <>
        <button className="btn btn-secondary" disabled={saving} onClick={() => { if (!busy.current) onClose(); }}>Back to event</button>
        {calendarId && <button className="btn btn-secondary" disabled={locked} onClick={checkStatus}>Check Outlook status</button>}
        {!existing && <button className="btn btn-primary" disabled={locked || !selected || !confirmed || !!timeError ||
          checkedCalendarId !== calendarId || (uncertain && !retryConfirmed)} onClick={add}>
          {saving ? 'Adding to Outlook...' : uncertain ? 'Retry adding to Outlook' : 'Add to my calendar'}
        </button>}
      </>
    }>
      <div className="outlook-calendar">
      <p>This creates one personal appointment using your own Office 365 Outlook connection. It does not invite attendees, create a Teams meeting, or synchronize later changes or cancellations.</p>
      {!currentUser && <p role="alert" className="text-danger">Sign in to the Power Apps application before connecting your Outlook calendar.</p>}
      <h4>{event.abs_name}</h4>
      <EventScheduleDetails event={event} />
      {timeError && <p role="alert" className="text-danger">{timeError}</p>}
      {loading && <p role="status">Connecting to Outlook and loading your writable calendars...</p>}
      {error && <p role="alert" className="text-danger">{error}</p>}
      {!loading && !calendars.length && currentUser && !timeError && <button className="btn btn-secondary" onClick={() => {
        setLoading(true); setError(''); setLoadAttempt((attempt) => attempt + 1);
      }}>Retry Outlook connection</button>}
      {calendars.length > 0 && (
        <>
          <Field label="Your Outlook calendar">
            <select className="select" aria-label="Your Outlook calendar" value={calendarId} disabled={locked || uncertain || !!existing}
              onChange={(e) => chooseCalendar(e.target.value)}>
              {calendars.map((item) => <option key={item.id} value={item.id}>{item.name}{item.isDefault ? ' (default)' : ''}</option>)}
            </select>
          </Field>
          <p>Connected Outlook account: <strong>{selected?.ownerAddress}</strong></p>
          {checking && <p role="status">Checking whether this event is already in your calendar...</p>}
          {status && <p role="status">{status}</p>}
          {existing ? (
            <div>
              <p><strong>{existing.subject}</strong> is in this calendar. Its existing schedule is unchanged and may differ from the Hub. Manage or remove the personal copy in Outlook.</p>
              {existing.webLink && <a className="link" href={existing.webLink} target="_blank" rel="noreferrer">Open appointment in Outlook</a>}
            </div>
          ) : (
            <>
              <p><strong>Location:</strong> {event.crd49_location || (event.crd49_meetinglink ? 'Online' : 'Not specified')}</p>
              <p className="help-text">The saved Hub start and end times will be used exactly. To change the schedule, ask a program manager or app admin to edit the event first.</p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{event.crd49_description || 'No description provided.'}</p>
              {event.crd49_meetinglink && <p style={{ overflowWrap: 'anywhere' }}>Meeting link: {event.crd49_meetinglink}</p>}
              <label className="checkbox-row">
                <input type="checkbox" checked={confirmed} disabled={locked} onChange={(e) => setConfirmed(e.target.checked)} />
                Add this appointment to {selected?.name} in the Outlook account {selected?.ownerAddress}. No invitations will be sent.
              </label>
              {uncertain && <label className="checkbox-row">
                <input type="checkbox" checked={retryConfirmed} disabled={locked} onChange={(e) => setRetryConfirmed(e.target.checked)} />
                I checked Outlook and this appointment is not there. Retry using the same duplicate-protection ID.
              </label>}
            </>
          )}
        </>
      )}
      </div>
    </Modal>
  );
}
