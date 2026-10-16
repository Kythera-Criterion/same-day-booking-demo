'use client';

// 今日のタイムライン（9時〜24時）。枠と予約を、状態ごとの塗り・枠線・模様・アイコンで並べる

import { useEffect, useMemo, useRef } from 'react';
import { fmtTime, jstMinuteOfDay } from '@/lib/time';
import { activeBooking, type SalonSlot } from './useSalonData';
import { FreshMark, StateIcon, stateClass } from './SlotStateMark';
import st from './Timeline.module.css';

const START = 9 * 60;
const END = 24 * 60;
const PX_PER_MIN = 2.4; // 15分 = 36px（短い枠どうしが重ならない高さ）
const GAP = 3; // 縦に続く枠のすき間
const MIN_HEIGHT = 32; // とても短い枠でも、1行（時刻と名前）が収まる高さ

// 枠の高さに合わせて、中に出す内容を変える（文字が途中で切れないように）
//   xs：1行（開始時刻と名前） sm：時刻＋名前 md：＋メニュー（1行） lg：＋メニュー（2行まで）
function sizeOf(height: number): 'xs' | 'sm' | 'md' | 'lg' {
  if (height < 44) return 'xs';
  if (height < 66) return 'sm';
  if (height < 86) return 'md';
  return 'lg';
}

export const STATE_LABEL: Record<string, string> = {
  open: '予約待ち',
  confirmed: '予約あり',
  completed: '来店済み',
  no_show: '無断キャンセル',
  expired: '受付終了',
  closed: '取り下げ',
  paused: '今日はここまで',
  suspended: '掲載停止で取り下げ',
  booked: '予約あり',
};

export function slotState(slot: SalonSlot): string {
  const b = activeBooking(slot);
  if (b) return b.status;
  if (slot.status === 'closed' && slot.closed_reason === 'paused') return 'paused';
  if (slot.status === 'closed' && slot.closed_reason === 'suspended') return 'suspended';
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
  //   重なり合う枠のまとまりごとに列の数を決める（重ならない枠は、幅いっぱいに出す）
  //   とても短い枠は見た目の高さを最低限とるので、その見た目の下端で重なりを判定する
  const placed = useMemo(() => {
    const items = slots
      .map((slot) => {
        const s = Math.max(START, jstMinuteOfDay(slot.start_at));
        const endRaw = jstMinuteOfDay(slot.end_at);
        const e = Math.min(END, endRaw <= s ? END : endRaw);
        const height = Math.max(MIN_HEIGHT, (e - s) * PX_PER_MIN - GAP);
        const visualEnd = s + (height + GAP) / PX_PER_MIN;
        return { slot, s, e, height, visualEnd, lane: 0, lanes: 1 };
      })
      .sort((a, b) => a.s - b.s || a.visualEnd - b.visualEnd);

    let group: typeof items = [];
    let laneEnds: number[] = [];
    let groupEnd = -Infinity;
    const closeGroup = () => {
      for (const it of group) it.lanes = Math.max(1, laneEnds.length);
      group = [];
      laneEnds = [];
    };
    for (const it of items) {
      if (it.s >= groupEnd) {
        closeGroup();
        groupEnd = -Infinity;
      }
      let lane = laneEnds.findIndex((end) => end <= it.s);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(it.visualEnd);
      } else {
        laneEnds[lane] = it.visualEnd;
      }
      it.lane = lane;
      group.push(it);
      groupEnd = Math.max(groupEnd, it.visualEnd);
    }
    closeGroup();
    return items;
  }, [slots]);

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
    <div className={st.scroll} ref={ref}>
      <div className={st.canvas} style={{ height: (END - START) * PX_PER_MIN }}>
        {hours.map((h) => (
          <div key={h} className={st.hour} style={{ top: (h * 60 - START) * PX_PER_MIN }}>
            <span>{h}:00</span>
          </div>
        ))}
        {nowMin >= START && nowMin <= END && (
          <div className={st.now} style={{ top: (nowMin - START) * PX_PER_MIN }}>
            <span>{fmtTime(now)}</span>
          </div>
        )}
        <div className={st.lanes}>
          {placed.map(({ slot, s, height, lane, lanes }) => {
            const state = slotState(slot);
            const b = activeBooking(slot);
            const size = sizeOf(height);
            return (
              <button
                key={slot.id}
                className={`${st.block} ${stateClass(state)}`}
                data-state={state}
                data-size={size}
                style={{
                  top: (s - START) * PX_PER_MIN + 1,
                  height,
                  left: `calc(${(lane / lanes) * 100}% + 2px)`,
                  width: `calc(${100 / lanes}% - 4px)`,
                }}
                onClick={() => onSelect(slot)}
              >
                <span className={st.top}>
                  <StateIcon state={state} />
                  <span className={st.time}>
                    {fmtTime(slot.start_at)}
                    <span className={st.timeEnd}>〜{fmtTime(slot.end_at)}</span>
                  </span>
                  {b && freshIds.includes(b.id) && (
                    <span className={st.fresh}>
                      <FreshMark />
                    </span>
                  )}
                </span>
                <span className={st.title}>{b ? `${b.contact_name} 様` : STATE_LABEL[state] ?? state}</span>
                {(size === 'md' || size === 'lg') && (
                  <span className={st.sub}>
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
