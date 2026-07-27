import { useEffect, useRef, useState } from 'react';
import { DirectorySvc } from '../data/entities';
import { Avatar } from './ui';

export type DirectoryPerson = {
  displayName: string;
  userId: string;
  department?: string;
};

type GalUser = {
  DisplayName?: string;
  UserPrincipalName?: string;
  Mail?: string;
  Department?: string;
  JobTitle?: string;
};

function toPerson(u: GalUser): DirectoryPerson {
  return {
    displayName: u.DisplayName ?? '',
    userId: (u.UserPrincipalName || u.Mail || '').toLowerCase(),
    department: u.Department,
  };
}

/**
 * Searches the Microsoft 365 Global Address List (GAL) via the Office 365 Users
 * connector and lets the user pick a person. Selecting fills Display Name + User ID.
 */
export function PeoplePicker({
  value,
  onChange,
  placeholder = 'Search people by name or email…',
}: {
  value: DirectoryPerson | null;
  onChange: (p: DirectoryPerson | null) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GalUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await DirectorySvc.SearchUserV2(term, 15, true);
        if (id !== seq.current) return;
        if (res.success) {
          setResults((res.data?.value as GalUser[]) ?? []);
        } else {
          setError('Directory search failed.');
          setResults([]);
        }
      } catch {
        if (id !== seq.current) return;
        setError('Directory search failed.');
        setResults([]);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function pick(u: GalUser) {
    onChange(toPerson(u));
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  if (value) {
    return (
      <div className="people-selected">
        <Avatar name={value.displayName || value.userId} size={36} />
        <div className="center-col">
          <span className="item-title">{value.displayName || '—'}</span>
          <span className="item-sub">{value.userId}</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="people-picker" ref={boxRef}>
      <div className="search">
        <span className="search-icon">🔍</span>
        <input
          className="input"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
      </div>
      {open && (query.trim().length >= 2 || loading) && (
        <div className="people-menu">
          {loading && <div className="people-status">Searching directory…</div>}
          {!loading && error && <div className="people-status">{error}</div>}
          {!loading && !error && results.length === 0 && (
            <div className="people-status">No matches in the directory.</div>
          )}
          {!loading &&
            results.map((u) => (
              <button
                type="button"
                key={u.UserPrincipalName || u.Mail || u.DisplayName}
                className="people-option"
                onClick={() => pick(u)}
              >
                <Avatar name={u.DisplayName || u.UserPrincipalName || '?'} size={32} />
                <div className="center-col">
                  <span className="item-title">{u.DisplayName}</span>
                  <span className="item-sub">
                    {(u.UserPrincipalName || u.Mail || '').toLowerCase()}
                    {u.JobTitle ? ` · ${u.JobTitle}` : ''}
                  </span>
                </div>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
