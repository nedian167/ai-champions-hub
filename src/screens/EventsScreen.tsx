import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppData } from '../context/AppDataContext';
import { EventsSvc, bind, type Abs_events } from '../data/entities';
import { Card, KpiCard, Pill, EmptyState, Field } from '../components/ui';
import { Modal } from '../components/Modal';
import { DeleteRecordModal } from '../components/DeleteRecordModal';
import { OutlookCalendarModal } from '../components/OutlookCalendarModal';
import { EventScheduleDetails } from '../components/EventScheduleDetails';
import { useToast } from '../components/Toast';
import { EventFormat, EventFormatLabel, optionsOf } from '../lib/enums';
import { formatDate } from '../lib/format';
import { buildEventSchedule, eventHasNotEnded, eventOccursOnDate, eventScheduleForm, formatEventSchedule } from '../lib/eventSchedule';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const blankForm = () => ({
  name: '', campaign: '', description: '', date: '', startTime: '', endTime: '', endDate: '', multiDay: false,
  format: EventFormat.Online as number, location: '', meetinglink: '', imageurl: '',
});

export default function EventsScreen() {
  const { events, campaigns, isAdmin, reload, currentUser } = useAppData();
  const toast = useToast();
  const location = useLocation();
  const linkedEventId = new URLSearchParams(location.search).get('eventId');

  const [cursor, setCursor] = useState(() => new Date());
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(linkedEventId);
  const [openedEventId, setOpenedEventId] = useState(linkedEventId);
  if (openedEventId !== linkedEventId) {
    setOpenedEventId(linkedEventId);
    setSelectedId(linkedEventId);
  }
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Abs_events | null>(null);
  const [addingToOutlook, setAddingToOutlook] = useState(false);
  const selectedEvent = events.find((event) => event.abs_eventid === selectedId);
  const [form, setForm] = useState(blankForm);

  // Keep the existing one-day grace, but include multi-day events until their end.
  const upcomingCutoff = Date.now() - 864e5;
  const isUpcoming = (e: typeof events[number]) => eventHasNotEnded(e, upcomingCutoff);

  const upcomingOnline = events.filter((e) => isUpcoming(e) && e.crd49_format === EventFormat.Online).length;
  const upcomingInPerson = events.filter((e) => isUpcoming(e) && e.crd49_format === EventFormat.InPerson).length;
  const pastCount = events.filter((e) => !isUpcoming(e)).length;

  const [detail, setDetail] = useState<null | 'all' | 'online' | 'inperson' | 'past' | 'day'>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const detailEvents = useMemo(() => {
    const cutoff = Date.now() - 864e5;
    const up = (e: typeof events[number]) => eventHasNotEnded(e, cutoff);
    const list = detail === 'online'
      ? events.filter((e) => up(e) && e.crd49_format === EventFormat.Online)
      : detail === 'inperson'
        ? events.filter((e) => up(e) && e.crd49_format === EventFormat.InPerson)
        : detail === 'past'
          ? events.filter((e) => !up(e))
          : detail === 'day' && selectedDay
            ? events.filter((e) => eventOccursOnDate(e, selectedDay))
            : events;
    return [...list].sort((a, b) => (a.crd49_eventdate ?? '').localeCompare(b.crd49_eventdate ?? ''));
  }, [detail, events, selectedDay]);
  const detailTitle = detail === 'online' ? 'Upcoming Online Events'
    : detail === 'inperson' ? 'Upcoming In-Person Events'
    : detail === 'past' ? 'Past Events'
    : detail === 'day' ? `Events on ${formatDate(selectedDay?.toISOString())}`
    : 'All Events';

  const upcoming = useMemo(
    () => [...events]
      .filter((e) => eventHasNotEnded(e, Date.now() - 864e5))
      .sort((a, b) => (a.crd49_eventdate ?? '').localeCompare(b.crd49_eventdate ?? '')),
    [events],
  );

  const grid = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < first; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    const byDay = new Map<number, Abs_events[]>();
    for (const e of events) {
      for (let day = 1; day <= days; day++) {
        if (eventOccursOnDate(e, new Date(year, month, day))) {
          byDay.set(day, [...(byDay.get(day) ?? []), e]);
        }
      }
    }
    return { cells, byDay, year, month };
  }, [cursor, events]);

  const today = new Date();

  function openNew() {
    setEditingId(null);
    setSelectedId(null);
    setForm(blankForm());
    setShow(true);
  }

  function openEdit(event: Abs_events) {
    if (!isAdmin) return;
    setEditingId(event.abs_eventid);
    setForm({
      name: event.abs_name,
      campaign: event._crd49_campaign_value ?? '',
      description: event.crd49_description ?? '',
      ...eventScheduleForm(event),
      format: event.crd49_format,
      location: event.crd49_location ?? '',
      meetinglink: event.crd49_meetinglink ?? '',
      imageurl: event.crd49_imageurl ?? '',
    });
    setShow(true);
  }

  async function saveEvent() {
    if (!isAdmin || saving) return;
    if (!form.name.trim()) { toast.error('Name is required.'); return; }
    let schedule: ReturnType<typeof buildEventSchedule>;
    try {
      schedule = buildEventSchedule(form, events.find((event) => event.abs_eventid === editingId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Choose a valid event schedule.');
      return;
    }
    const format = Object.values(EventFormat).find((value) => value === form.format);
    if (format === undefined) { toast.error('Choose a valid event format.'); return; }
    for (const [label, value] of [['Meeting link', form.meetinglink], ['Image URL', form.imageurl]]) {
      if (!value.trim()) continue;
      try {
        const url = new URL(value.trim());
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Invalid protocol');
      } catch {
        toast.error(`${label} must be a valid http or https URL.`);
        return;
      }
    }
    setSaving(true);
    let saved = false;
    try {
      const payload = {
        abs_name: form.name.trim(),
        crd49_description: form.description.trim(),
        crd49_eventdate: schedule.start,
        abs_eventend: schedule.end,
        crd49_format: format,
        crd49_location: form.location.trim(),
        crd49_meetinglink: form.meetinglink.trim(),
        crd49_imageurl: form.imageurl.trim(),
      };
      const campaign = form.campaign ? bind('campaign', form.campaign) : null;
      const changes = { ...payload, 'crd49_Campaign@odata.bind': campaign };
      // Dataverse accepts null to clear a lookup; generated SDK lookup types omit it.
      const res = editingId
        ? await EventsSvc.update(editingId, changes as Parameters<typeof EventsSvc.update>[1])
        : await EventsSvc.create({
          ...payload,
          ...(campaign ? { 'crd49_Campaign@odata.bind': campaign } : {}),
        } as Parameters<typeof EventsSvc.create>[0]);
      if (!res.success) throw new Error(res.error?.message ?? (editingId ? 'Update failed' : 'Create failed'));
      saved = true;
      toast.success(editingId ? 'Event updated.' : 'Event created.');
      setShow(false);
      setEditingId(null);
      setForm(blankForm());
      await reload();
    } catch (e) {
      const message = e instanceof Error ? e.message : `Failed to ${editingId ? 'update' : 'create'} event.`;
      toast.error(saved ? `Event saved, but refresh failed: ${message}` : message);
    } finally {
      setSaving(false);
    }
  }

  const monthLabel = new Date(grid.year, grid.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <>
      {linkedEventId && !events.some((event) => event.abs_eventid === linkedEventId) && <div role="alert" className="card mb-16">This event is unavailable or you no longer have access to it.</div>}
      <div className="page-header">
        <div>
          <h1>Events</h1>
          <div className="page-subtitle">Workshops, live sessions and community meetups.</div>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={openNew}>➕ New Event</button>}
      </div>

      <div className="grid grid-kpi">
        <KpiCard label="Total Events" value={events.length} icon="📅" iconBg="var(--blue-soft)" iconColor="var(--blue)" onClick={() => setDetail('all')} />
        <KpiCard label="Online" sub="upcoming" value={upcomingOnline} icon="💻" iconBg="var(--green-soft)" iconColor="var(--green)" onClick={() => setDetail('online')} />
        <KpiCard label="In-Person" sub="upcoming" value={upcomingInPerson} icon="📍" iconBg="var(--purple-soft)" iconColor="var(--purple)" onClick={() => setDetail('inperson')} />
        <KpiCard label="Past Events" value={pastCount} icon="🗂️" iconBg="var(--gray-soft)" iconColor="var(--gray)" onClick={() => setDetail('past')} />
      </div>

      <div className="grid grid-2 mt-24">
        <Card
          title={monthLabel}
          action={
            <div className="row">
              <button className="icon-btn" onClick={() => setCursor(new Date(grid.year, grid.month - 1, 1))}>‹</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setCursor(new Date())}>Today</button>
              <button className="icon-btn" onClick={() => setCursor(new Date(grid.year, grid.month + 1, 1))}>›</button>
            </div>
          }
        >
          <div className="calendar">
            {WEEKDAYS.map((w) => <div className="cal-head" key={w}>{w}</div>)}
            {grid.cells.map((d, i) => {
              if (d === null) return <div className="cal-cell empty" key={`e${i}`} />;
              const isToday = today.getFullYear() === grid.year && today.getMonth() === grid.month && today.getDate() === d;
              const evs = grid.byDay.get(d) ?? [];
              return (
                <div className={`cal-cell ${isToday ? 'today' : ''}`} key={d}>
                  <div className="cal-daynum">{d}</div>
                  {evs.slice(0, 2).map((event) => (
                    <button className="cal-event" key={event.abs_eventid} title={`${event.abs_name}: ${formatEventSchedule(event)}`} onClick={() => setSelectedId(event.abs_eventid)}>{event.abs_name}</button>
                  ))}
                  {evs.length > 2 && (
                    <button className="cal-more link" onClick={() => { setSelectedDay(new Date(grid.year, grid.month, d)); setDetail('day'); }}>+{evs.length - 2} more</button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Upcoming Events">
          {upcoming.length === 0 ? (
            <EmptyState icon="📅" title="No upcoming events" message="Create an event to get started." />
          ) : (
            <div className="list">
              {upcoming.slice(0, 8).map((e) => (
                <div
                  className="list-item clickable"
                  key={e.abs_eventid}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(e.abs_eventid)}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setSelectedId(e.abs_eventid); } }}
                >
                  <div className="center-col spacer">
                    <span className="item-title">{e.abs_name}</span>
                    <span className="item-sub">{formatEventSchedule(e)} · {e.crd49_location || (e.crd49_format === EventFormat.Online ? 'Online' : 'In-Person')}</span>
                  </div>
                  <Pill color={e.crd49_format === EventFormat.Online ? 'green' : 'purple'}>{EventFormatLabel[e.crd49_format]}</Pill>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {selectedEvent && !show && !removing && !addingToOutlook && (
        <Modal
          title={selectedEvent.abs_name}
          wide
          onClose={() => setSelectedId(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setSelectedId(null)}>Close</button>
              <button className="btn btn-primary" onClick={() => setAddingToOutlook(true)}>Add to my Outlook calendar</button>
              {isAdmin && (
                <>
                  <button className="btn btn-secondary" onClick={() => openEdit(selectedEvent)}>Edit Event</button>
                  <button className="btn btn-danger" onClick={() => setRemoving(selectedEvent)}>Delete Event</button>
                </>
              )}
            </>
          }
        >
          {selectedEvent.crd49_imageurl && <div className="campaign-hero" style={{ backgroundImage: `url("${selectedEvent.crd49_imageurl}")` }} />}
          <EventScheduleDetails event={selectedEvent} />
          {!selectedEvent.abs_eventend && <p className="help-text">End time is not set. A program manager or app admin must complete this event's schedule before it can be added to Outlook.</p>}
          <div className="detail-grid">
            <div><span className="help-text">Format</span><div>{EventFormatLabel[selectedEvent.crd49_format]}</div></div>
            <div><span className="help-text">Location</span><div>{selectedEvent.crd49_location || (selectedEvent.crd49_format === EventFormat.Online ? 'Online' : 'Not specified')}</div></div>
            <div><span className="help-text">Campaign</span><div>{campaigns.find((campaign) => campaign.abs_campaignid === selectedEvent._crd49_campaign_value)?.abs_name ?? selectedEvent.crd49_campaignname ?? 'None'}</div></div>
          </div>
          <div className="divider" />
          <p style={{ whiteSpace: 'pre-wrap' }}>{selectedEvent.crd49_description || 'No description provided.'}</p>
          {selectedEvent.crd49_meetinglink && (
            /^https?:\/\//i.test(selectedEvent.crd49_meetinglink)
              ? <a href={selectedEvent.crd49_meetinglink} target="_blank" rel="noreferrer" className="link">Open meeting link</a>
              : <p className="text-muted">The meeting link is invalid. Ask a program admin to update it.</p>
          )}
        </Modal>
      )}

      {selectedEvent && addingToOutlook && (
        <OutlookCalendarModal key={`${selectedEvent.abs_eventid}:${currentUser?.objectId}:${selectedEvent.crd49_eventdate}:${selectedEvent.abs_eventend}`} event={selectedEvent} onClose={() => setAddingToOutlook(false)} />
      )}

      {removing && isAdmin && (
        <DeleteRecordModal kind="event" id={removing.abs_eventid} name={removing.abs_name} onClose={() => setRemoving(null)} onDeleted={() => setSelectedId(null)} />
      )}

      {show && isAdmin && (
        <Modal
          title={editingId ? 'Edit Event' : 'New Event'}
          wide
          onClose={() => { if (!saving) setShow(false); }}
          footer={
            <>
              <button className="btn btn-secondary" disabled={saving} onClick={() => setShow(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={saveEvent}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Event'}</button>
            </>
          }
        >
          <Field label="Name"><input className="input" maxLength={850} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Schedule">
            <select className="select" aria-label="Schedule" value={form.multiDay ? 'multi' : 'single'}
              onChange={(e) => setForm({ ...form, multiDay: e.target.value === 'multi' })}>
              <option value="single">Single-day event</option>
              <option value="multi">Multi-day event</option>
            </select>
          </Field>
          <div className="field-row">
            <Field label="Date"><input type="date" className="input" aria-label="Date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            {form.multiDay && <Field label="End date"><input type="date" className="input" aria-label="End date" required min={form.date} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>}
          </div>
          <div className="field-row">
            <Field label="Start time"><input type="time" className="input" aria-label="Start time" required value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></Field>
            <Field label="End time"><input type="time" className="input" aria-label="End time" required value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></Field>
          </div>
          <p className="help-text">Times are in {Intl.DateTimeFormat().resolvedOptions().timeZone}. End time must be after Start time; use Multi-day and an End date for overnight events.</p>
          <Field label="Format">
            <select className="select" value={form.format} onChange={(e) => setForm({ ...form, format: Number(e.target.value) })}>
              {optionsOf(EventFormatLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Campaign">
            <select className="select" value={form.campaign} onChange={(e) => setForm({ ...form, campaign: e.target.value })}>
              <option value="">None</option>
              {form.campaign && !campaigns.some((campaign) => campaign.abs_campaignid === form.campaign) && <option value={form.campaign}>Current campaign (unavailable)</option>}
              {campaigns.map((c) => <option key={c.abs_campaignid} value={c.abs_campaignid}>{c.abs_name}</option>)}
            </select>
          </Field>
          <Field label="Description"><textarea className="textarea" maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="field-row">
            <Field label="Location"><input className="input" maxLength={100} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Room / address" /></Field>
            <Field label="Meeting link"><input className="input" maxLength={2000} value={form.meetinglink} onChange={(e) => setForm({ ...form, meetinglink: e.target.value })} placeholder="https://teams…" /></Field>
          </div>
          <Field label="Image URL"><input className="input" maxLength={2000} value={form.imageurl} onChange={(e) => setForm({ ...form, imageurl: e.target.value })} placeholder="https://..." /></Field>
        </Modal>
      )}
      {detail && !selectedEvent && !show && !removing && (
        <Modal title={`${detailTitle} (${detailEvents.length})`} wide onClose={() => setDetail(null)}>
          {detailEvents.length === 0 ? (
            <EmptyState icon="📅" title="No events" message="Nothing to show in this category yet." />
          ) : (
            <div className="list">
              {detailEvents.map((e) => (
                <div
                  className="list-item clickable"
                  key={e.abs_eventid}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(e.abs_eventid)}
                  onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); setSelectedId(e.abs_eventid); } }}
                >
                  <div className="center-col spacer">
                    <span className="item-title">{e.abs_name}</span>
                    <span className="item-sub">
                      {formatEventSchedule(e)}
                      {e.crd49_location ? ` · ${e.crd49_location}` : ''}
                      {e.crd49_meetinglink ? ' · ' : ''}
                      {e.crd49_meetinglink && /^https?:\/\//i.test(e.crd49_meetinglink) && (
                        <a href={e.crd49_meetinglink} target="_blank" rel="noreferrer" className="link" onClick={(ev) => ev.stopPropagation()}>Join link</a>
                      )}
                    </span>
                    {e.crd49_description && <span className="item-sub">{e.crd49_description}</span>}
                  </div>
                  <Pill color={e.crd49_format === EventFormat.Online ? 'green' : 'purple'}>{EventFormatLabel[e.crd49_format]}</Pill>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
