import type { CSSProperties, ReactNode } from 'react';
import { colorFromString, initials } from '../lib/format';

/* ---------------- Avatar ---------------- */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        background: colorFromString(name),
        fontSize: size * 0.4,
      }}
      title={name}
    >
      {initials(name)}
    </div>
  );
}

/* ---------------- Pill ---------------- */
export type PillColor = 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'gray';
export function Pill({ color, children }: { color: PillColor; children: ReactNode }) {
  return <span className={`pill ${color}`}>{children}</span>;
}

/* ---------------- KPI card ---------------- */
export function KpiCard({
  label,
  value,
  icon,
  iconBg,
  iconColor,
  sub,
  delta,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  iconBg?: string;
  iconColor?: string;
  sub?: ReactNode;
  delta?: number;
}) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {icon && (
          <span
            className="kpi-icon"
            style={{ background: iconBg ?? 'var(--primary-soft)', color: iconColor ?? 'var(--primary)' }}
          >
            {icon}
          </span>
        )}
      </div>
      <div className="kpi-value">{value}</div>
      {sub != null && <div className="kpi-sub">{sub}</div>}
      {delta != null && delta !== 0 && (
        <div className={`kpi-delta ${delta > 0 ? 'up' : 'down'}`}>
          {delta > 0 ? '▲' : '▼'} {Math.abs(delta)} this month
        </div>
      )}
    </div>
  );
}

/* ---------------- Card ---------------- */
export function Card({
  title,
  action,
  children,
  className = '',
  bodyClass = 'card-pad',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <div className={`card ${className}`}>
      <div className={bodyClass}>
        {(title || action) && (
          <div className="card-header">
            {title && <div className="card-title">{title}</div>}
            {action}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ---------------- Empty state ---------------- */
export function EmptyState({
  icon = '📭',
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {message && <p className="text-muted">{message}</p>}
      {action && <div className="mt-16">{action}</div>}
    </div>
  );
}

/* ---------------- Tabs ---------------- */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: ReactNode }[];
  active: T;
  onChange: (k: T) => void;
}) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.key}
          className={`tab ${active === t.key ? 'active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Search ---------------- */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search">
      <span className="search-icon">🔍</span>
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/* ---------------- Field helpers ---------------- */
export function Field({
  label,
  children,
  help,
}: {
  label?: ReactNode;
  children: ReactNode;
  help?: ReactNode;
}) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {help && <span className="help-text">{help}</span>}
    </div>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" className="toggle" data-on={on} onClick={() => onChange(!on)} />;
}

/* ---------------- Donut ---------------- */
export function Donut({ percent, centerLabel }: { percent: number; centerLabel?: ReactNode }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="donut" style={{ '--pct': pct } as CSSProperties}>
      <div className="donut-hole">{centerLabel ?? `${pct}%`}</div>
    </div>
  );
}

/* ---------------- Rank badge ---------------- */
export function Rank({ n }: { n: number }) {
  const cls = n === 1 ? 'gold' : n === 2 ? 'silver' : n === 3 ? 'bronze' : '';
  return <div className={`rank ${cls}`}>{n}</div>;
}
