// Conversation threads for Requests are stored as JSON inside the existing
// `crd49_response` (ntext) column, so no schema changes are needed. Legacy
// plain-text responses are treated as a single admin message.

export type ThreadAuthor = 'admin' | 'requester';

export interface ThreadMessage {
  by: ThreadAuthor;
  name: string;
  text: string;
  at: string; // ISO timestamp ('' when unknown, e.g. migrated legacy text)
}

interface ThreadEnvelope {
  v: number;
  messages: ThreadMessage[];
}

function normalizeMessage(m: unknown): ThreadMessage | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (typeof o.text !== 'string' || !o.text) return null;
  return {
    by: o.by === 'requester' ? 'requester' : 'admin',
    name: typeof o.name === 'string' && o.name ? o.name : (o.by === 'requester' ? 'Requester' : 'Admin'),
    text: o.text,
    at: typeof o.at === 'string' ? o.at : '',
  };
}

/** Parse a stored `crd49_response` value into an ordered list of messages. */
export function parseThread(raw?: string | null): ThreadMessage[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as ThreadEnvelope | ThreadMessage[];
      const list = Array.isArray(parsed) ? parsed : parsed?.messages;
      if (Array.isArray(list)) {
        const msgs = list.map(normalizeMessage).filter((m): m is ThreadMessage => m !== null);
        return msgs;
      }
    } catch {
      // Not valid JSON — fall through to legacy handling.
    }
  }
  // Legacy: a plain-text response entered before threading existed.
  return [{ by: 'admin', name: 'Admin', text: raw, at: '' }];
}

/** Serialize messages back to the stored envelope shape. */
export function serializeThread(messages: ThreadMessage[]): string {
  return JSON.stringify({ v: 1, messages } satisfies ThreadEnvelope);
}

/** Convenience: append a message and return the serialized value. */
export function appendMessage(raw: string | null | undefined, message: ThreadMessage): string {
  return serializeThread([...parseThread(raw), message]);
}

/** Last message in the thread, for card previews. */
export function lastMessage(raw?: string | null): ThreadMessage | undefined {
  const msgs = parseThread(raw);
  return msgs[msgs.length - 1];
}
