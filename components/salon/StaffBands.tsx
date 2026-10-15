'use client';

// 担当ごとの「今日だけ」の帯（9:00〜24:00）。タブレットの横向き向け。
// 現在時刻の線が動き、締切を過ぎた範囲（今から10分後まで）は斜線。空いているところをタップすると、その時刻から枠を出せる。
// 同じ担当で時間が重なる枠（担当なしの枠など）は、帯の中で段を分けて並べる

import { useEffect, useRef, type MouseEvent } from 'react';
import { fmtTime, jstMinuteOfDay } from '@/lib/time';
import { activeBooking, type SalonSlot, type Stylist } from './useSalonData';
import { STATE_LABEL, slotState } from './Timeline';

const START = 9 * 60;
const END = 24 * 60;
const SPAN = END - START;
const LANE_H = 30;
const pct = (min: number) => `${((Math.min(Math.max(min, START), END) - START) / SPAN) * 100}%`;

function lanesOf(slots: SalonSlot[]) {
  const ends: number[] = [];
  return [...slots]
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map((s) => {
      const a = jstMinuteOfDay(s.start_at);
      const z = jstMinuteOfDay(s.end_at) || END;
      let lane = ends.findIndex((e) => e <= a);
      if (lane === -1) {
        lane = ends.length;
        ends.push(z);
      } else ends[lane] = z;
      return { s, a, z, lane };
    });
}

export default function StaffBands({
  slots,
  stylists,
  now,
  freshIds,
  showNo,
  onSelect,
  onEmpty,
}: {
  slots: SalonSlot[];
  stylists: Stylist[];
  now: Date;
  freshIds: string[];
  showNo: boolean;
  onSelect: (slot: SalonSlot) => void;
  onEmpty: (start: Date, stylistId: string | null) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const nowMin = jstMinuteOfDay(now);
  const rows: { id: string | null; name: string }[] = [
    ...stylists.filter((s) => s.is_active || slots.some((x) => x.stylist_id === s.id)).map((s) => ({ id: s.id, name: s.name })),
    { id: null, name: '担当なし' },
  ];
  const hours = Array.from({ length: 16 }, (_, i) => 9 + i);

  // 開いたときは、今の時刻が左から4分の1あたりに来るようにする
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const inner = el.scrollWidth - 84;
    el.scrollLeft = Math.max(0, ((Math.max(nowMin, START) - START) / SPAN) * inner - el.clientWidth / 4);
    // 最初の1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function tapEmpty(e: MouseEvent<HTMLDivElement>, stylistId: string | null) {
    const rect = e.currentTarget.getBoundingClientRect();
    const minute = START + ((e.clientX - rect.left) / rect.width) * SPAN;
    const rounded = Math.ceil(minute / 5) * 5;
    const todayStartMs = now.getTime() - jstMinuteOfDay(now) * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();
    onEmpty(new Date(todayStartMs + rounded * 60_000), stylistId);
  }

  return (
    <div className="bands-scroll" ref={scroller}>
      <div className="bands" role="grid" aria-label="担当ごとの今日の予定">
        <div className="bands-head" aria-hidden>
          <span />
          <div className="bands-scale">
            {hours.map((h) => (
              <span key={h} style={{ left: pct(h * 60) }}>
                {h}:00
              </span>
            ))}
          </div>
        </div>
        {rows.map((row) => {
          const placed = lanesOf(slots.filter((s) => (s.stylist_id ?? null) === row.id));
          const lanes = Math.max(1, ...placed.map((p) => p.lane + 1));
          return (
            <div key={row.id ?? 'none'} className="band-row" role="row">
              <span className="band-name" role="rowheader">
                {row.name}
              </span>
              <div
                className="band-track"
                style={{ height: lanes * LANE_H + 8 }}
                onClick={(e) => tapEmpty(e, row.id)}
                role="gridcell"
                aria-label={`${row.name}：空いている時刻を押すと、その時刻から枠を出せます`}
              >
                <span className="band-past" style={{ width: pct(nowMin + 10) }} aria-hidden />
                {hours.map((h) => (
                  <span key={h} className="band-hour" style={{ left: pct(h * 60) }} aria-hidden />
                ))}
                {nowMin >= START && nowMin <= END && <span className="band-now" style={{ left: pct(nowMin) }} aria-hidden />}
                {placed.map(({ s, a, z, lane }) => {
                  const st = slotState(s);
                  const b = activeBooking(s);
                  return (
                    <button
                      key={s.id}
                      className={`band-block tl-${st} ${b && freshIds.includes(b.id) ? 'is-fresh' : ''}`}
                      style={{ left: pct(a), width: `calc(${pct(z)} - ${pct(a)} - 2px)`, top: 4 + lane * LANE_H, height: LANE_H - 3 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(s);
                      }}
                      title={`${fmtTime(s.start_at)}〜${fmtTime(s.end_at)} ${b ? `${b.contact_name} 様` : STATE_LABEL[st] ?? st}`}
                    >
                      <span className="num">{fmtTime(s.start_at)}</span>
                      <span className="band-label">
                        {b ? `${b.contact_name}様` : STATE_LABEL[st] ?? st}
                        {b && showNo && b.booking_no !== null && ` ${b.booking_no}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
