/** Formatting + small utility helpers shared across screens. */

/** "Jan 5, 2026" */
export function formatDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "Jan 5, 2026, 2:30 PM" */
export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** For <input type="date"> value binding — yyyy-mm-dd. */
export function toDateInput(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** For <input type="datetime-local"> value binding. */
export function toDateTimeInput(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}

/** Initials from a display name, e.g. "Ada Lovelace" -> "AL". */
export function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** First name only. */
export function firstName(name?: string | null): string {
  if (!name) return 'there';
  return name.trim().split(/\s+/)[0] || 'there';
}

/** Deterministic HSL colour from a string (for avatars). */
export function colorFromString(input?: string | null): string {
  const s = input || '?';
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}deg 55% 45%)`;
}

/** Percent delta helper -> { text, positive }. */
export function delta(current: number, previous: number): { text: string; positive: boolean } {
  if (previous <= 0) {
    if (current <= 0) return { text: '0%', positive: true };
    return { text: '+100%', positive: true };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  return { text: `${pct >= 0 ? '+' : ''}${pct}%`, positive: pct >= 0 };
}

export function pluralize(n: number, word: string, plural?: string): string {
  return `${n} ${n === 1 ? word : plural ?? word + 's'}`;
}
