'use client';

// 軽量なグラフ（SVG）。色は検証済みの2色（予約・公開した枠。値は tokens.css の --color-chart-1・--color-chart-2）。
// 細い棒・4px の角丸・棒どうしの 2px の隙間・控えめな目盛り。各グラフに数値の表を添える

import { useState, type ReactNode } from 'react';

export const SERIES_COLORS = { primary: 'var(--color-chart-1)', secondary: 'var(--color-chart-2)' };

type Series = { key: string; name: string; color: string };
type Row = { label: string; values: Record<string, number> };

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="chart-legend">
      {series.map((s) => (
        <span key={s.key}>
          <i style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

function DataTable({ rows, series, labelHeader }: { rows: Row[]; series: Series[]; labelHeader: string }) {
  return (
    <details className="chart-table">
      <summary>数値を表で見る</summary>
      <table>
        <thead>
          <tr>
            <th>{labelHeader}</th>
            {series.map((s) => (
              <th key={s.key}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              {series.map((s) => (
                <td key={s.key} className="num">
                  {r.values[s.key] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

// 縦棒（1〜2系列のグループ棒）
export function ColumnChart({
  title,
  rows,
  series,
  labelHeader,
  height = 180,
  footnote,
}: {
  title: string;
  rows: Row[];
  series: Series[];
  labelHeader: string;
  height?: number;
  footnote?: ReactNode;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...rows.flatMap((r) => series.map((s) => r.values[s.key] ?? 0))));
  const W = 640;
  const H = height;
  const padL = 32;
  const padB = 24;
  const plotW = W - padL - 8;
  const plotH = H - padB - 8;
  const band = plotW / Math.max(1, rows.length);
  const barW = Math.max(4, Math.min(22, (band - 10) / series.length - 2));
  const ticks = [0, max / 2, max];
  const every = Math.ceil(rows.length / 12);

  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      <Legend series={series} />
      <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} preserveAspectRatio="none">
          {ticks.map((t) => {
            const y = 8 + plotH - (t / max) * plotH;
            return (
              <g key={t}>
                <line x1={padL} x2={W - 8} y1={y} y2={y} className="chart-grid" />
                <text x={padL - 6} y={y + 4} textAnchor="end" className="chart-axis">
                  {t}
                </text>
              </g>
            );
          })}
          {rows.map((r, i) => {
            const x0 = padL + i * band + (band - (barW + 2) * series.length + 2) / 2;
            return (
              <g key={r.label}>
                {hover === i && <rect x={padL + i * band} y={8} width={band} height={plotH} className="chart-hover" />}
                {series.map((s, j) => {
                  const v = r.values[s.key] ?? 0;
                  const h = (v / max) * plotH;
                  const x = x0 + j * (barW + 2);
                  const y = 8 + plotH - h;
                  const rr = Math.min(4, h / 2, barW / 2);
                  return v > 0 ? (
                    <path
                      key={s.key}
                      d={`M${x},${8 + plotH} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + barW - rr} Q${x + barW},${y} ${x + barW},${y + rr} V${8 + plotH} Z`}
                      style={{ fill: s.color }}
                    />
                  ) : null;
                })}
                {i % every === 0 && (
                  <text x={padL + i * band + band / 2} y={H - 6} textAnchor="middle" className="chart-axis">
                    {r.label}
                  </text>
                )}
                <rect
                  x={padL + i * band}
                  y={0}
                  width={band}
                  height={H}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onTouchStart={() => setHover(i)}
                />
              </g>
            );
          })}
          <line x1={padL} x2={W - 8} y1={8 + plotH} y2={8 + plotH} className="chart-base" />
        </svg>
        {hover !== null && rows[hover] && (
          <div className="chart-tip" style={{ left: `${((padL + hover * band + band / 2) / W) * 100}%` }}>
            <strong>{rows[hover].label}</strong>
            {series.map((s) => (
              <span key={s.key}>
                <i style={{ background: s.color }} />
                {s.name} {rows[hover].values[s.key] ?? 0}
              </span>
            ))}
          </div>
        )}
      </div>
      {footnote && <p className="chart-note">{footnote}</p>}
      <DataTable rows={rows} series={series} labelHeader={labelHeader} />
    </figure>
  );
}

// 横棒（1系列）。項目が多い内訳（サロン別・年代別・職業別・アンケート）に使う
export function BarList({
  title,
  rows,
  unit = '件',
  color = SERIES_COLORS.primary,
}: {
  title: string;
  rows: { label: string; value: number; sub?: string }[];
  unit?: string;
  color?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      {rows.length === 0 ? (
        <p className="state">データがありません。</p>
      ) : (
        <ul className="barlist">
          {rows.map((r) => (
            <li key={r.label} title={`${r.label}：${r.value}${unit}`}>
              <span className="barlist-label">
                {r.label}
                {r.sub && <small>{r.sub}</small>}
              </span>
              <span className="barlist-track">
                <span className="barlist-bar" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
              </span>
              <span className="barlist-value num">
                {r.value}
                <small>{unit}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
