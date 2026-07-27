import type { CSSProperties, ReactNode } from 'react';

export type ChartColor = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'gray';

const COLOR_VAR: Record<ChartColor, string> = {
  blue: 'var(--blue)',
  green: 'var(--green)',
  amber: 'var(--amber)',
  red: 'var(--red)',
  purple: 'var(--purple)',
  gray: 'var(--gray)',
};

export interface BarDatum {
  label: string;
  value: number;
  color?: ChartColor;
  hint?: string;
}

/** Horizontal labelled bar chart — good for "by department / by type" breakdowns. */
export function BarList({ data, unit, emptyLabel = 'No data' }: { data: BarDatum[]; unit?: string; emptyLabel?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <div className="chart-empty">{emptyLabel}</div>;
  return (
    <div className="bars">
      {data.map((d) => (
        <div className="bar-row" key={d.label} title={d.hint}>
          <div className="bar-label" title={d.label}>{d.label}</div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${(d.value / max) * 100}%`, background: COLOR_VAR[d.color ?? 'blue'] }}
            />
          </div>
          <div className="bar-value">{d.value.toLocaleString()}{unit ? ` ${unit}` : ''}</div>
        </div>
      ))}
    </div>
  );
}

export interface ColumnPoint {
  label: string;
  a: number;
  b?: number;
}

/** Vertical grouped columns — good for monthly trends (up to two series). */
export function ColumnChart({
  data, seriesA, seriesB, colorA = 'blue', colorB = 'green',
}: {
  data: ColumnPoint[];
  seriesA: string;
  seriesB?: string;
  colorA?: ChartColor;
  colorB?: ChartColor;
}) {
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b ?? 0]));
  return (
    <div className="colchart">
      <div className="colchart-plot">
        {data.map((d) => (
          <div className="colchart-group" key={d.label}>
            <div className="colchart-bars">
              <div
                className="colchart-bar"
                style={{ height: `${(d.a / max) * 100}%`, background: COLOR_VAR[colorA] }}
                title={`${seriesA}: ${d.a}`}
              />
              {seriesB != null && (
                <div
                  className="colchart-bar"
                  style={{ height: `${((d.b ?? 0) / max) * 100}%`, background: COLOR_VAR[colorB] }}
                  title={`${seriesB}: ${d.b ?? 0}`}
                />
              )}
            </div>
            <div className="colchart-xlabel">{d.label}</div>
          </div>
        ))}
      </div>
      <div className="chart-legend">
        <span className="legend-item"><span className="legend-dot" style={{ background: COLOR_VAR[colorA] }} />{seriesA}</span>
        {seriesB != null && <span className="legend-item"><span className="legend-dot" style={{ background: COLOR_VAR[colorB] }} />{seriesB}</span>}
      </div>
    </div>
  );
}

export interface StackSegment { label: string; value: number; color: ChartColor; }

/** Single horizontal 100%-stacked bar with a legend — good for status mixes. */
export function StackBar({ segments }: { segments: StackSegment[] }) {
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));
  return (
    <div>
      <div className="stackbar">
        {segments.filter((s) => s.value > 0).map((s) => (
          <div
            key={s.label}
            className="stackbar-seg"
            style={{ width: `${(s.value / total) * 100}%`, background: COLOR_VAR[s.color] }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <div className="chart-legend">
        {segments.map((s) => (
          <span className="legend-item" key={s.label}>
            <span className="legend-dot" style={{ background: COLOR_VAR[s.color] }} />
            {s.label} · {s.value}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Simple report table with an optional accent header. */
export function ReportTable({ columns, rows }: { columns: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <div className="rtable-wrap">
      <table className="rtable">
        <thead>
          <tr>{columns.map((c, i) => <th key={i} style={i === 0 ? undefined : ({ textAlign: 'right' } as CSSProperties)}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{r.map((cell, ci) => <td key={ci} style={ci === 0 ? undefined : ({ textAlign: 'right' } as CSSProperties)}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
