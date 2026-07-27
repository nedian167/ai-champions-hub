import { useMemo, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import { EventsSvc, bind } from '../data/entities';
import { Card, KpiCard, Pill, EmptyState, Field } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { EventFormat, EventFormatLabel, optionsOf } from '../lib/enums';
import { formatDate, toDateTimeInput } from '../lib/format';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function EventsScreen() {
  const { events, campaigns, isAdmin, reload } = useAppData();
  const toast = useToast();

  const [cursor, setCursor] = useState(() => new Date());
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', campaign: '', description: '', eventdate: '', format: EventFormat.Online as number,
    location: '', meetinglink: '', imageurl: '',
  });

  // "Upcoming" = today or later (with a 1-day grace); anything earlier is "past".
  const upcomingCutoff = Date.now() - 864e5;
  const isUpcoming = (e: typeof events[number]) => new Date(e.crd49_eventdate).getTime() >= upcomingCutoff;

  const upcomingOnline = events.filter((e) => isUpcoming(e) && e.crd49_format === EventFormat.Online).length;
  const upcomingInPerson = events.filter((e) => isUpcoming(e) && e.crd49_format === EventFormat.InPerson).length;
  const pastCount = events.filter((e) => !isUpcoming(e)).length;

  const [detail, setDetail] = useState<null | 'all' | 'online' | 'inperson' | 'past'>(null);
  const detailEvents = useMemo(() => {
    const cutoff = Date.now() - 864e5;
    const up = (e: typeof events[number]) => new Date(e.crd49_eventdate).getTime() >= cutoff;
    const list = detail === 'online'
      ? events.filter((e) => up(e) && e.crd49_format === EventFormat.Online)
      : detail === 'inperson'
        ? events.filter((e) => up(e) && e.crd49_format === EventFormat.InPerson)
        : detail === 'past'
          ? events.filter((e) => !up(e))
          : events;
    return [...list].sort((a, b) => (a.crd49_eventdate ?? '').localeCompare(b.crd49_eventdate ?? ''));
  }, [detail, events]);
  const detailTitle = detail === 'online' ? 'Upcoming Online Events'
    : detail === 'inperson' ? 'Upcoming In-Person Events'
    : detail === 'past' ? 'Past Events'
    : 'All Events';

  const upcoming = useMemo(
    () => [...events]
      .filter((e) => new Date(e.crd49_eventdate).getTime() >= Date.now() - 864e5)
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
    const byDay = new Map<number, string[]>();
    for (const e of events) {
      const dt = new Date(e.crd49_eventdate);
      if (dt.getFullYear() === year && dt.getMonth() === month) {
        byDay.set(dt.getDate(), [...(byDay.get(dt.getDate()) ?? []), e.abs_name]);
      }
    }
    return { cells, byDay, year, month };
  }, [cursor, events]);

  const today = new Date();

  async function createEvent() {
    if (!form.name.trim() || !form.eventdate) { toast.error('Name and date are required.'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        abs_name: form.name.trim(),
        crd49_description: form.description.trim() || undefined,
        crd49_eventdate: new Date(form.eventdate).toISOString(),
        crd49_format: form.format,
        crd49_location: form.location.trim() || undefined,
        crd49_meetinglink: form.meetinglink.trim() || undefined,
        crd49_imageurl: form.imageurl.trim() || undefined,
      };
      if (form.campaign) payload['crd49_Campaign@odata.bind'] = bind('campaign', form.campaign);
      const res = await EventsSvc.create(payload as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Create failed');
      toast.success('Event created.');
      setShow(false);
      setForm({ name: '', campaign: '', description: '', eventdate: '', format: EventFormat.Online, location: '', meetinglink: '', imageurl: '' });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create event.');
    } finally {
      setSaving(false);
    }
  }

  const monthLabel = new Date(grid.year, grid.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Events</h1>
          <div className="page-subtitle">Workshops, live sessions and community meetups.</div>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={() => setShow(true)}>➕ New Event</button>}
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
                  {evs.slice(0, 2).map((name, j) => <div className="cal-event" key={j} title={name}>{name}</div>)}
                  {evs.length > 2 && <div className="item-sub">+{evs.length - 2} more</div>}
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
                <div className="list-item" key={e.abs_eventid}>
                  <div className="center-col spacer">
                    <span className="item-title">{e.abs_name}</span>
                    <span className="item-sub">{formatDate(e.crd49_eventdate)} · {e.crd49_location || (e.crd49_format === EventFormat.Online ? 'Online' : 'In-Person')}</span>
                  </div>
                  <Pill color={e.crd49_format === EventFormat.Online ? 'green' : 'purple'}>{EventFormatLabel[e.crd49_format]}</Pill>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {show && (
        <Modal
          title="New Event"
          wide
          onClose={() => setShow(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShow(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={createEvent}>{saving ? 'Saving…' : 'Create Event'}</button>
            </>
          }
        >
          <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="field-row">
            <Field label="Date & time"><input type="datetime-local" className="input" value={form.eventdate ? toDateTimeInput(form.eventdate) : ''} onChange={(e) => setForm({ ...form, eventdate: e.target.value })} /></Field>
            <Field label="Format">
              <select className="select" value={form.format} onChange={(e) => setForm({ ...form, format: Number(e.target.value) })}>
                {optionsOf(EventFormatLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Campaign">
            <select className="select" value={form.campaign} onChange={(e) => setForm({ ...form, campaign: e.target.value })}>
              <option value="">None</option>
              {campaigns.map((c) => <option key={c.abs_campaignid} value={c.abs_campaignid}>{c.abs_name}</option>)}
            </select>
          </Field>
          <Field label="Description"><textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="field-row">
            <Field label="Location"><input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Room / address" /></Field>
            <Field label="Meeting link"><input className="input" value={form.meetinglink} onChange={(e) => setForm({ ...form, meetinglink: e.target.value })} placeholder="https://teams…" /></Field>
          </div>
        </Modal>
      )}
      {detail && (
        <Modal title={`${detailTitle} (${detailEvents.length})`} wide onClose={() => setDetail(null)}>
          {detailEvents.length === 0 ? (
            <EmptyState icon="📅" title="No events" message="Nothing to show in this category yet." />
          ) : (
            <div className="list">
              {detailEvents.map((e) => (
                <div className="list-item" key={e.abs_eventid}>
                  <div className="center-col spacer">
                    <span className="item-title">{e.abs_name}</span>
                    <span className="item-sub">
                      {formatDate(e.crd49_eventdate)}
                      {e.crd49_location ? ` · ${e.crd49_location}` : ''}
                      {e.crd49_meetinglink ? ' · ' : ''}
                      {e.crd49_meetinglink && (
                        <a href={e.crd49_meetinglink} target="_blank" rel="noreferrer" className="link">Join link</a>
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
