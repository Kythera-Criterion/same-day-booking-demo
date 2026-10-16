'use client';

// 距離レーダー：地図サービスを使わず、自分（または利用エリアの基準地点）を中心に候補を並べる。
// 方位と距離は端末の中で計算する。点のラベルは店名ではなく開始時刻。
// 同じお店の枠など、位置が重なる点は1つにまとめ、番号と時刻を並べて出す

import s from './Radar.module.css';

export type RadarPoint = { id: string; no: number; label: string; km: number; bearing: number };

const SIZE = 280;
const C = SIZE / 2;
const R = 118; // 外周
const KM_TO_PX = R * 0.8; // 1km を外周の8割に
const MERGE_PX = 16;

type Group = { x: number; y: number; outside: boolean; points: RadarPoint[] };

function place(points: RadarPoint[]): Group[] {
  const groups: Group[] = [];
  for (const p of [...points].sort((a, b) => a.no - b.no)) {
    const outside = p.km * KM_TO_PX > R - 10;
    const d = Math.min(p.km * KM_TO_PX, R - 10);
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
  return (
    <figure className={s.radar} aria-label={`距離レーダー（${originLabel}から見た候補の位置）`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="group">
        <circle cx={C} cy={C} r={R} className={s.edge} />
        <circle cx={C} cy={C} r={KM_TO_PX} className={s.ring} />
        <circle cx={C} cy={C} r={KM_TO_PX / 2} className={s.ring} />
        <line x1={C} y1={C - R} x2={C} y2={C + R} className={s.axis} />
        <line x1={C - R} y1={C} x2={C + R} y2={C} className={s.axis} />
        <text x={C + 4} y={C + KM_TO_PX / 2 - 4} className={s.scale}>500m</text>
        <text x={C + 4} y={C + KM_TO_PX - 4} className={s.scale}>1km</text>
        <text x={C} y={C - R - 6} textAnchor="middle" className={s.scale}>北</text>
        <circle cx={C} cy={C} r={6} className={s.me} />
        <text x={C} y={C + 20} textAnchor="middle" className={s.meLabel}>
          {originLabel}
        </text>
        {groups.map((g) => {
          const on = g.points.some((p) => p.id === selected);
          const first = g.points.find((p) => p.id === selected) ?? g.points[0];
          const nos = g.points.map((p) => p.no).join('・');
          const times = g.points.map((p) => p.label).join(' / ');
          const km = g.points[0].km;
          const cls = `${on ? s.on : ''} ${g.outside ? s.out : ''}`;
          return (
            <g key={g.points.map((p) => p.id).join('-')}>
            <g
              className={`${s.pt} ${cls}`}
              transform={`translate(${g.x} ${g.y})`}
              role="button"
              tabIndex={0}
              aria-label={`${nos} ${times}開始（候補の${nos}番・${km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`}）`}
              onClick={() => {
                // まとまった点は、押すたびに次の候補へ
                const i = g.points.findIndex((p) => p.id === selected);
                onSelect((i >= 0 ? g.points[(i + 1) % g.points.length] : first).id);
              }}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(first.id)}
            >
              <circle r={22} className={s.hit} />
              <rect
                x={-(nos.length > 1 ? 9 + nos.length * 4 : 11) - (on ? 3 : 0)}
                y={-11 - (on ? 3 : 0)}
                width={(nos.length > 1 ? 18 + nos.length * 8 : 22) + (on ? 6 : 0)}
                height={22 + (on ? 6 : 0)}
                rx={11 + (on ? 3 : 0)}
                className={s.dot}
              />
            </g>
            {/* 番号と時刻は、押せる点の上に重ねる飾り（読み上げは点の名前で伝える。押した位置は下の点に届く） */}
            <g className={`${s.labels} ${cls}`} transform={`translate(${g.x} ${g.y})`} aria-hidden>
              <text y={4} textAnchor="middle" className={s.no}>
                {nos}
              </text>
              <text y={on ? -20 : -17} textAnchor="middle" className={s.time}>
                {times}
              </text>
            </g>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
