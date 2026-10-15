'use client';

// 今日のタイムライン（9時〜24時）。枠と予約を状態ごとの色で並べる

import { useEffect, useMemo, useRef } from 'react';
import { fmtTime, jstMinuteOfDay } from '@/lib/time';
import { activeBooking, type SalonSlot } from './useSalonData';

const START = 9 * 60;
const END = 24 * 60;
const PX_PER_MIN = 2.4; // 15分 = 36px（短い枠どうしが重ならない高さ）

export const STATE_LABEL: Record<string, string> = {
  open: '予約待ち',
  confirmed: '予約あり',
  completed: '来店済み',
  no_show: '無断キャンセル',
  expired: '受付終了',
  closed: '取り下げ',
  paused: '今日はここまで',
  booked: '予約あり',
};

export function slotState(slot: SalonSlot): string {
  const b = activeBooking(slot);
  if (b) return b.status;
  if (slot.status === 'closed' && slot.closed_reason === 'paused') return 'paused';
  return slot.status === 'booked' ? 'closed' : slot.status;
}

export default function Timeline({
  slots,
  now,
  freshIds,
  onSelect,
}: {
  slots: SalonSlot[];
  now: Date;
  freshIds: string[];
  onSelect: (slot: SalonSlot) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const nowMin = jstMinuteOfDay(now);

  // 重なる枠は横に並べる（美容師ごとに枠が重なりうるため）
  const placed = useMemo(() => {
    const laneEnds: number[] = [];
    return slots.map((slot) => {
      const s = Math.max(START, jstMinuteOfDay(slot.start_at));
      const endRaw = jstMinuteOfDay(slot.end_at);
      const e = Math.min(END, endRaw <= s ? END : endRaw);
      let lane = laneEnds.findIndex((end) => end <= s);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(e);
      } else {
        laneEnds[lane] = e;
      }
      return { slot, s, e, lane };
    });
  }, [slots]);
  const lanes = Math.max(1, ...placed.map((p) => p.lane + 1));

  // 開いたときは、今の時刻のあたりを表示する
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const y = (Math.min(Math.max(nowMin, START), END) - START) * PX_PER_MIN - 80;
    el.scrollTop = Math.max(0, y);
    // 最初の1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hours = Array.from({ length: (END - START) / 60 + 1 }, (_, i) => START / 60 + i);

  return (
    <div className="timeline" ref={ref}>
      <div className="timeline-canvas" style={{ height: (END - START) * PX_PER_MIN }}>
        {hours.map((h) => (
          <div key={h} className="timeline-hour" style={{ top: (h * 60 - START) * PX_PER_MIN }}>
            <span>{h}:00</span>
          </div>
        ))}
        {nowMin >= START && nowMin <= END && (
          <div className="timeline-now" style={{ top: (nowMin - START) * PX_PER_MIN }}>
            <span>{fmtTime(now)}</span>
          </div>
        )}
        <div className="timeline-lanes">
          {placed.map(({ slot, s, e, lane }) => {
            const state = slotState(slot);
            const b = activeBooking(slot);
            const height = Math.max(24, (e - s) * PX_PER_MIN - 3);
            return (
              <button
                key={slot.id}
                className={`tl-block tl-${state} ${height < 44 ? 'tl-compact' : ''} ${b && freshIds.includes(b.id) ? 'is-fresh' : ''}`}
                style={{
                  top: (s - START) * PX_PER_MIN + 1,
                  height,
                  left: `calc(${(lane / lanes) * 100}% + 2px)`,
                  width: `calc(${100 / lanes}% - 4px)`,
                }}
                onClick={() => onSelect(slot)}
              >
                <span className="tl-time num">
                  {fmtTime(slot.start_at)}〜{fmtTime(slot.end_at)}
                </span>
                <span className="tl-title">{b ? `${b.contact_name} 様` : STATE_LABEL[state] ?? state}</span>
                {height > 52 && (
                  <span className="tl-sub">
                    {slot.menu?.name}
                    {slot.stylist && ` ・ ${slot.stylist.name}`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
