'use client';

// 軽量なグラフ（SVG）。色は意味の値だけを使う：
//   primary（予約）＝役割の色で塗る ／ secondary（公開した枠）＝沈んだ面とインクの線（時間の色は受付締切のために残す）
//   塗りと線の違いでも見分けられるようにし、凡例（文字つき）・ツールチップ・数値の表を添える（色だけに頼らない）
// 細い棒・4px の角丸・棒どうしの 2px の隙間・控えめな目盛り。実際の幅で描き、目盛りの文字が縮まないようにする
// 折れ線を重ねるとき（予約数の推移の「掲載中の店舗数」）は、同じ1本の目盛りで描く（目盛りを2本にしない）。線はインクの 2px、点は 8px で面の色の輪

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Empty } from '@/components/States';
import { ChartBar, ListBullets, Table } from '@/components/ui/icons';
import s from './Charts.module.css';

export type SeriesTone = 'primary' | 'secondary';

type Series = { key: string; name: string; tone: SeriesTone };
type Row = { label: string; values: Record<string, number> };

const MARK: Record<SeriesTone, string> = { primary: s.markPrimary, secondary: s.markSecondary };
const SWATCH: Record<SeriesTone, string> = { primary: s.swatchPrimary, secondary: s.swatchSecondary };

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

// 描く場所の実際の幅（px）。SVG を拡大・縮小せずに描くため
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(240, Math.round(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function Swatch({ tone, line = false }: { tone: SeriesTone; line?: boolean }) {
  return <i className={line ? s.swatchLine : `${s.swatch} ${SWATCH[tone]}`} aria-hidden />;
}

function Legend({ series, lineKey }: { series: Series[]; lineKey?: string }) {
  if (series.length < 2) return null;
  return (
    <ul className={s.legend} aria-label="凡例">
      {series.map((x) => (
        <li key={x.key}>
          <Swatch tone={x.tone} line={x.key === lineKey} />
          {x.name}
        </li>
      ))}
    </ul>
  );
}

function DataTable({ rows, series, labelHeader }: { rows: Row[]; series: Series[]; labelHeader: string }) {
  return (
    <details className={s.tableBox}>
      <summary className={s.tableToggle}>
        <Table size={20} aria-hidden focusable="false" />
        数値を表で見る
      </summary>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>{labelHeader}</th>
              {series.map((x) => (
                <th key={x.key} className={s.numCell}>
                  {x.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                {series.map((x) => (
                  <td key={x.key} className={`num ${s.numCell}`}>
                    {r.values[x.key] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// 縦棒（1〜2系列のグループ棒）
export function ColumnChart({
  title,
  rows,
  series,
  labelHeader,
  height = 200,
  footnote,
  line,
}: {
  title: string;
  rows: Row[];
  series: Series[];
  labelHeader: string;
  height?: number;
  footnote?: ReactNode;
  // 棒に重ねる折れ線（1系列。同じ目盛りで描く）
  line?: Series;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [wrapRef, W] = useWidth(640);
  const all = line ? [...series, line] : series;
  const max = niceMax(Math.max(1, ...rows.flatMap((r) => all.map((x) => r.values[x.key] ?? 0))));
  const H = height;
  const padL = 36;
  const padR = 4;
  const padT = 8;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padB - padT;
  const base = padT + plotH;
  const band = plotW / Math.max(1, rows.length);
  const barW = Math.max(4, Math.min(22, (band - 10) / series.length - 2));
  const ticks = [0, max / 2, max];
  // 目盛りの文字（12px）が重ならないよう、幅に合わせて間引く
  const every = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(plotW / 44))));
  const tipLeft = hover === null ? 0 : Math.min(W - 72, Math.max(72, padL + hover * band + band / 2));

  return (
    <figure className={s.figure}>
      <figcaption className={s.title}>
        <ChartBar size={20} aria-hidden focusable="false" />
        {title}
      </figcaption>
      <Legend series={all} lineKey={line?.key} />
      <div className={s.plot} ref={wrapRef} onMouseLeave={() => setHover(null)}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className={s.svg}>
          {ticks.map((t) => {
            const y = base - (t / max) * plotH;
            return (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y} y2={y} className={s.grid} />
                <text x={padL - 8} y={y + 4} textAnchor="end" className={s.axis}>
                  {t}
                </text>
              </g>
            );
          })}
          {rows.map((r, i) => {
            const x0 = padL + i * band + (band - (barW + 2) * series.length + 2) / 2;
            return (
              <g key={r.label}>
                {hover === i && <rect x={padL + i * band} y={padT} width={band} height={plotH} className={s.hoverBand} />}
                {series.map((x, j) => {
                  const v = r.values[x.key] ?? 0;
                  const h = (v / max) * plotH;
                  const bx = x0 + j * (barW + 2);
                  const y = base - h;
                  const rr = Math.min(4, h / 2, barW / 2);
                  return v > 0 ? (
                    <path
                      key={x.key}
                      d={`M${bx},${base} V${y + rr} Q${bx},${y} ${bx + rr},${y} H${bx + barW - rr} Q${bx + barW},${y} ${bx + barW},${y + rr} V${base} Z`}
                      className={MARK[x.tone]}
                    />
                  ) : null;
                })}
                {i % every === 0 && (
                  <text x={padL + i * band + band / 2} y={H - 8} textAnchor="middle" className={s.axis}>
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
          <line x1={padL} x2={W - padR} y1={base} y2={base} className={s.baseline} />
          {line && rows.length > 0 && (
            <g pointerEvents="none">
              <polyline
                className={s.lineMark}
                points={rows.map((r, i) => `${padL + i * band + band / 2},${base - ((r.values[line.key] ?? 0) / max) * plotH}`).join(' ')}
              />
              {rows.map((r, i) => (
                <circle
                  key={r.label}
                  className={s.lineDot}
                  cx={padL + i * band + band / 2}
                  cy={base - ((r.values[line.key] ?? 0) / max) * plotH}
                  r={hover === i ? 5 : 4}
                />
              ))}
            </g>
          )}
        </svg>
        {hover !== null && rows[hover] && (
          <div className={s.tip} style={{ left: tipLeft }}>
            <strong>{rows[hover].label}</strong>
            {all.map((x) => (
              <span key={x.key}>
                <Swatch tone={x.tone} line={x.key === line?.key} />
                {x.name} <b className="num">{rows[hover].values[x.key] ?? 0}</b>
              </span>
            ))}
          </div>
        )}
      </div>
      {footnote && <p className={s.note}>{footnote}</p>}
      <DataTable rows={rows} series={all} labelHeader={labelHeader} />
    </figure>
  );
}

// 横棒（1系列）。項目が多い内訳（サロン別・年代別・職業別・アンケート）に使う
export function BarList({
  title,
  rows,
  unit = '件',
  tone = 'primary',
}: {
  title: string;
  rows: { label: string; value: number; sub?: string }[];
  unit?: string;
  tone?: SeriesTone;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure className={s.figure}>
      <figcaption className={s.title}>
        <ListBullets size={20} aria-hidden focusable="false" />
        {title}
      </figcaption>
      {rows.length === 0 ? (
        <Empty icon={ChartBar}>データがありません。</Empty>
      ) : (
        <ul className={s.barlist}>
          {rows.map((r) => (
            <li key={r.label} title={`${r.label}：${r.value}${unit}`}>
              <span className={s.barLabel}>
                {r.label}
                {r.sub && <small>{r.sub}</small>}
              </span>
              <span className={s.track}>
                <span className={`${s.bar} ${tone === 'secondary' ? s.barSecondary : s.barPrimary}`} style={{ inlineSize: `${(r.value / max) * 100}%` }} />
              </span>
              <span className={`num ${s.barValue}`}>
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
