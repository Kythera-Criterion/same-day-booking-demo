'use client';

// 担当ごとの「今日だけ」の帯（9:00〜24:00）。タブレットの横向き向け。
// 1時間を180pxで描き、15分ごとに細い線を引く。時刻は枠の幅が狭くても切らずに出す。
// 現在時刻の線が動き、締切を過ぎた範囲（今から10分後まで）は斜線。空いているところを押すと、その時刻から枠を出せる。
// 同じ担当で時間が重なる枠（担当なしの枠など）は、帯の中で段を分けて並べる

import { useEffect, useRef, type MouseEvent } from 'react';
import { fmtTime, jstMinuteOfDay } from '@/lib/time';
import { activeBooking, type SalonSlot, type Stylist } from './useSalonData';
import { STATE_LABEL, slotState } from './Timeline';

const START = 9 * 60;
const END = 24 * 60;
const PX_PER_MIN = 3; // 1時間 = 180px（15分 = 45px）
const NAME_W = 92;
const LANE_H = 44;
const TRACK_W = (END - START) * PX_PER_MIN;
const x = (min: number) => (Math.min(Math.max(min, START), END) - START) * PX_PER_MIN;

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
  const quarters = Array.from({ length: (END - START) / 15 + 1 }, (_, i) => START + i * 15);

  // 開いたときは、今の時刻の30分前が左端に来るようにする
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, x(nowMin - 30));
    // 最初の1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function tapEmpty(e: MouseEvent<HTMLDivElement>, stylistId: string | null) {
    const rect = e.currentTarget.getBoundingClientRect();
    const minute = START + (e.clientX - rect.left) / PX_PER_MIN;
    const rounded = Math.ceil(minute / 5) * 5;
    const todayStartMs = now.getTime() - jstMinuteOfDay(now) * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();
    onEmpty(new Date(todayStartMs + rounded * 60_000), stylistId);
  }

  return (
    <div className="bands-scroll" ref={scroller}>
      <div className="bands" role="grid" aria-label="担当ごとの今日の予定" style={{ width: NAME_W + TRACK_W + 24 }}>
        <div className="bands-head" aria-hidden style={{ gridTemplateColumns: `${NAME_W}px ${TRACK_W}px` }}>
          <span className="band-corner" />
          <div className="bands-scale">
            {quarters
              .filter((m) => m % 30 === 0)
              .map((m) => (
                <span key={m} className={m % 60 === 0 ? 'is-hour' : 'is-half'} style={{ left: x(m) }}>
                  {Math.floor(m / 60)}:{m % 60 === 0 ? '00' : '30'}
                </span>
              ))}
          </div>
        </div>
        {rows.map((row) => {
          const placed = lanesOf(slots.filter((s) => (s.stylist_id ?? null) === row.id));
          const lanes = Math.max(1, ...placed.map((p) => p.lane + 1));
          return (
            <div key={row.id ?? 'none'} className="band-row" role="row" style={{ gridTemplateColumns: `${NAME_W}px ${TRACK_W}px` }}>
              <span className="band-name" role="rowheader">
                {row.name}
              </span>
              <div
                className="band-track"
                style={{ height: lanes * LANE_H + 8, width: TRACK_W }}
                onClick={(e) => tapEmpty(e, row.id)}
                role="gridcell"
                aria-label={`${row.name}：空いている時刻を押すと、その時刻から枠を出せます`}
              >
                <span className="band-past" style={{ width: x(nowMin + 10) }} aria-hidden />
                {quarters.map((m) => (
                  <span key={m} className={`band-tick ${m % 60 === 0 ? 'is-hour' : m % 30 === 0 ? 'is-half' : ''}`} style={{ left: x(m) }} aria-hidden />
                ))}
                {nowMin >= START && nowMin <= END && <span className="band-now" style={{ left: x(nowMin) }} aria-hidden />}
                {placed.map(({ s, a, z, lane }) => {
                  const st = slotState(s);
                  const b = activeBooking(s);
                  const w = Math.max(40, x(z) - x(a) - 3);
                  const who = b ? `${b.contact_name} 様` : STATE_LABEL[st] ?? st;
                  return (
                    <button
                      key={s.id}
                      className={`band-block tl-${st} ${w < 120 ? 'is-narrow' : ''} ${b && freshIds.includes(b.id) ? 'is-fresh' : ''}`}
                      style={{ left: x(a) + 1, width: w, top: 4 + lane * LANE_H, height: LANE_H - 4 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(s);
                      }}
                      title={`${fmtTime(s.start_at)}〜${fmtTime(s.end_at)} ${s.menu?.name ?? ''} ${who}${b && showNo && b.booking_no !== null ? `（予約番号 ${b.booking_no}）` : ''}`}
                      aria-label={`${fmtTime(s.start_at)}〜${fmtTime(s.end_at)} ${who}`}
                    >
                      <span className="band-time num">
                        {fmtTime(s.start_at)}
                        {w >= 120 && `〜${fmtTime(s.end_at)}`}
                      </span>
                      {w >= 120 && (
                        <span className="band-label">
                          {who}
                          {b && showNo && b.booking_no !== null && <span className="band-no num">{b.booking_no}</span>}
                        </span>
                      )}
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
