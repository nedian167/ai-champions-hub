import { eventScheduleForm, formatEventTime, type EventSchedule } from '../lib/eventSchedule';
import { formatDate } from '../lib/format';

export function EventScheduleDetails({ event }: { event: EventSchedule }) {
  const { multiDay } = eventScheduleForm(event);
  return (
    <>
      <div className="detail-grid">
        <div><span className="help-text">Date</span><div>{formatDate(event.crd49_eventdate)}</div></div>
        <div><span className="help-text">Start time</span><div>{formatEventTime(event.crd49_eventdate)}</div></div>
        {multiDay && <div><span className="help-text">End date</span><div>{formatDate(event.abs_eventend)}</div></div>}
        <div><span className="help-text">End time</span><div>{formatEventTime(event.abs_eventend)}</div></div>
      </div>
      <p className="help-text">Times are shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}.{multiDay ? ' Multi-day event.' : ''}</p>
    </>
  );
}
