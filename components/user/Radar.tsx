'use client';

// 距離レーダー：地図サービスを使わず、自分（または利用エリアの基準地点）を中心に候補を並べる。
// 方位と距離は端末の中で計算する。候補は「番号と開始時刻」を入れた小さな丸いラベルで表す。
// 同じお店の枠など、位置が重なる点は1つにまとめる。新しく出た候補だけ、一度だけ波紋のように広がる

import { useEffect, useRef } from 'react';
import styles from './Radar.module.css';

export type RadarPoint = { id: string; no: number; label: string; km: number; bearing: number };

const SIZE = 280;
const C = SIZE / 2;
const R = 124; // 外周
const KM_TO_PX = R * 0.8; // 1km を外周の8割に
const MERGE_PX = 22;
const LABEL_H = 22;

type Group = { x: number; y: number; outside: boolean; points: RadarPoint[] };

function place(points: RadarPoint[]): Group[] {
  const groups: Group[] = [];
  for (const p of [...points].sort((a, b) => a.no - b.no)) {
    const outside = p.km * KM_TO_PX > R - 14;
    const d = Math.min(p.km * KM_TO_PX, R - 14);
    const rad = (p.bearing * Math.PI) / 180;
    const x = C + d * Math.sin(rad);
    const y = C - d * Math.cos(rad);
    const near = groups.find((g) => Math.hypot(g.x - x, g.y - y) < MERGE_PX);
    if (near) near.points.push(p);
    else groups.push({ x, y, outside, points: [p] });
  }
  return groups;
}

export default function Radar({
  points,
  originLabel,
  selected,
  onSelect,
}: {
  points: RadarPoint[];
  originLabel: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const groups = place(points);
  // すでに見せた候補（波紋は新しい候補だけに付ける）
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (seen.current) for (const p of points) if (!seen.current.has(p.id)) fresh.add(p.id);
  useEffect(() => {
    seen.current = new Set([...(seen.current ?? []), ...points.map((p) => p.id)]);
  }, [points]);

  return (
    <figure className={styles.radar} aria-label={`距離レーダー（${originLabel}から見た候補の位置）`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" className={styles.svg}>
        <circle cx={C} cy={C} r={R} className={styles.edge} />
        <circle cx={C} cy={C} r={KM_TO_PX} className={styles.ring} />
        <circle cx={C} cy={C} r={KM_TO_PX / 2} className={styles.ring} />
        <line x1={C} y1={C - R} x2={C} y2={C - R + 8} className={styles.tick} />
        <text x={C + 6} y={C - KM_TO_PX / 2 + 12} className={styles.scale}>500m</text>
        <text x={C + 6} y={C - KM_TO_PX + 12} className={styles.scale}>1km</text>
        <text x={C} y={C - R + 22} textAnchor="middle" className={styles.scale}>北</text>
        <circle cx={C} cy={C} r={5} className={styles.me} />
        <text x={C} y={C + 20} textAnchor="middle" className={styles.meLabel}>
          {originLabel}
        </text>
        {groups.map((g) => {
          const on = g.points.some((p) => p.id === selected);
          const first = g.points.find((p) => p.id === selected) ?? g.points[0];
          const nos = g.points.map((p) => p.no).join('・');
          const time = g.points.length > 1 ? `${g.points[0].label}ほか` : g.points[0].label;
          const text = `${nos} ${time}`;
          // ラベルの幅：半角（数字・記号）は約 7、全角（・・ほか）は約 12（文字 12px のとき）
          const w = 16 + [...text].reduce((n, ch) => n + (/[\x20-\x7e]/.test(ch) ? 7 : 12), 0);
          const isNew = g.points.some((p) => fresh.has(p.id));
          const km = g.points[0].km;
          // ラベルは点の少し上に置く（中心の「基準地点」の文字や点そのものを隠さない）。上端に近いときは下へ
          const dy = g.y < LABEL_H * 2 ? LABEL_H : -LABEL_H;
          return (
            <g
              key={g.points.map((p) => p.id).join('-')}
              className={styles.pt}
              data-on={on || undefined}
              data-out={g.outside || undefined}
              transform={`translate(${g.x} ${g.y})`}
              role="button"
              tabIndex={0}
              aria-label={`${text}（${nos}番の候補：${g.points.map((p) => p.label).join('、')}開始・${km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`}）`}
              onClick={() => {
                // まとまった点は、押すたびに次の候補へ
                const i = g.points.findIndex((p) => p.id === selected);
                onSelect((i >= 0 ? g.points[(i + 1) % g.points.length] : first).id);
              }}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(first.id)}
            >
              {isNew && <circle r={LABEL_H / 2} className={styles.ripple} />}
              <rect x={-w / 2 - 8} y={Math.min(0, dy) - LABEL_H} width={w + 16} height={LABEL_H * 3} className={styles.hit} />
              <line x1={0} y1={0} x2={0} y2={dy / 2} className={styles.stem} />
              <circle r={3} className={styles.dot} />
              <rect x={-w / 2} y={dy - LABEL_H / 2} width={w} height={LABEL_H} rx={LABEL_H / 2} className={styles.label} />
              <text y={dy + 4} textAnchor="middle" className={styles.text}>
                {text}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
