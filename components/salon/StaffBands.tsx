'use client';

// 担当ごとの「今日だけ」の予定（9:00〜24:00）。サロンの画面のデザイン案に合わせ、担当を列に、時刻を縦に並べる。
// 1時間を72pxで描き、30分ごとに細い線を引く。担当の名前（上）と時刻（左）は、スクロールしても残す。
// 現在時刻の線が動き、締切を過ぎた範囲（今から10分後まで）は斜線。空いているところを押すと、その時刻から枠を出せる。
// 同じ担当で時間が重なる枠（担当なしの枠など）は、列の中で横に分けて並べる

import { useEffect, useRef, type MouseEvent } from 'react';
import { fmtTime, jstMinuteOfDay } from '@/lib/time';
import { activeBooking, type SalonSlot, type Stylist } from './useSalonData';
import { STATE_LABEL, slotState } from './Timeline';
import { FreshMark, StateIcon, stateClass } from './SlotStateMark';
import st from './StaffBands.module.css';

const START = 9 * 60;
const END = 24 * 60;
const PX_PER_MIN = 1.2; // 1時間 = 72px（30分 = 36px）
const TRACK_H = (END - START) * PX_PER_MIN;
const y = (min: number) => (Math.min(Math.max(min, START), END) - START) * PX_PER_MIN;

function lanesOf(slots: SalonSlot[]) {
  const ends: number[] = [];
  const placed = [...slots]
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map((s) => {
      const a = jstMinuteOfDay(s.start_at);
      // 0時をまたぐ枠（23時台に始まり、翌日に終わる）は、予定の終わり（24:00）までとして扱う
      const endRaw = jstMinuteOfDay(s.end_at);
      const z = endRaw <= a ? END : endRaw;
      let lane = ends.findIndex((e) => e <= a);
      if (lane === -1) {
        lane = ends.length;
        ends.push(z);
      } else ends[lane] = z;
      return { s, a, z, lane };
    });
  return { placed, lanes: Math.max(1, ends.length) };
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
  const cols: { id: string | null; name: string }[] = [
    ...stylists.filter((s) => s.is_active || slots.some((x) => x.stylist_id === s.id)).map((s) => ({ id: s.id, name: s.name })),
    { id: null, name: '担当なし' },
  ];
  const hours = Array.from({ length: (END - START) / 60 + 1 }, (_, i) => START + i * 60);

  // 開いたときは、今の時刻の30分ほど前が上に来るようにする（担当の名前の行は上に残る）
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = Math.max(0, y(Math.floor((nowMin - 30) / 30) * 30));
    // 最初の1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function tapEmpty(e: MouseEvent<HTMLDivElement>, stylistId: string | null) {
    const rect = e.currentTarget.getBoundingClientRect();
    const minute = START + (e.clientY - rect.top) / PX_PER_MIN;
    const rounded = Math.ceil(minute / 5) * 5;
    const todayStartMs = now.getTime() - jstMinuteOfDay(now) * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();
    onEmpty(new Date(todayStartMs + rounded * 60_000), stylistId);
  }

  return (
    <div className={st.scroll} ref={scroller}>
      <div
        className={st.grid}
        role="group"
        aria-label="担当ごとの今日の予定"
        style={{ gridTemplateColumns: `var(--day-time-w) repeat(${cols.length}, minmax(var(--day-col-min), 1fr))` }}
      >
        {/* 上の行：担当の名前（スクロールしても残す） */}
        <span className={st.corner} aria-hidden>
          時間
        </span>
        {cols.map((c) => (
          <span key={c.id ?? 'none'} className={st.head} aria-hidden>
            <span className={`${st.avatar} ${c.id ? '' : st.avatarNone}`}>{c.id ? [...c.name][0] : '－'}</span>
            <span className={st.who}>
              <span className={st.name}>{c.name}</span>
              <span className={st.role}>{c.id ? 'スタイリスト' : '担当を決めない枠'}</span>
            </span>
          </span>
        ))}

        {/* 左の列：時刻 */}
        <div className={st.axis} style={{ height: TRACK_H }} aria-hidden>
          {hours.map((m) => (
            <span key={m} className={st.hour} style={{ top: y(m) }}>
              {String(Math.floor(m / 60)).padStart(2, '0')}:00
            </span>
          ))}
        </div>

        {cols.map((c) => {
          const { placed, lanes } = lanesOf(slots.filter((s) => (s.stylist_id ?? null) === c.id));
          return (
            <div key={c.id ?? 'none'} className={st.col} style={{ height: TRACK_H }} role="group" aria-label={c.name} onClick={(e) => tapEmpty(e, c.id)}>
              <span className="sr-only">{c.name}：空いている時刻を押すと、その時刻から枠を出せます</span>
              <span className={st.past} style={{ height: y(nowMin + 10) }} aria-hidden />
              {nowMin >= START && nowMin <= END && <span className={st.now} style={{ top: y(nowMin) }} aria-hidden />}
              {placed.map(({ s, a, z, lane }) => {
                const state = slotState(s);
                const b = activeBooking(s);
                const h = Math.max(20, y(z) - y(a) - 3);
                const who = b ? `${b.contact_name} 様` : STATE_LABEL[state] ?? state;
                const fresh = !!b && freshIds.includes(b.id);
                const size = h >= 64 ? 'lg' : h >= 40 ? 'md' : 'sm';
                return (
                  <button
                    key={s.id}
                    className={`${st.block} ${stateClass(state)} ${st[size]}`}
                    data-state={state}
                    style={{
                      top: y(a) + 1,
                      height: h,
                      left: `calc(${(lane / lanes) * 100}% + var(--space-1))`,
                      width: `calc(${100 / lanes}% - var(--space-2))`,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(s);
                    }}
                    title={`${fmtTime(s.start_at)}〜${fmtTime(s.end_at)} ${s.menu?.name ?? ''} ${who}${b && showNo && b.booking_no !== null ? `（予約番号 ${b.booking_no}）` : ''}`}
                  >
                    <span className={st.blockTop}>
                      <StateIcon state={state} />
                      <span className={`${st.time} num`}>
                        {fmtTime(s.start_at)} - {fmtTime(s.end_at)}
                      </span>
                      {fresh && size === 'lg' && <FreshMark />}
                    </span>
                    {size === 'sm' ? (
                      <span className="sr-only">{`${who} ${s.menu?.name ?? ''}`}</span>
                    ) : (
                      <span className={st.label}>
                        {who}
                        {b && showNo && b.booking_no !== null && (
                          <span className={st.no}>
                            <span className="sr-only">予約番号</span>
                            {b.booking_no}
                          </span>
                        )}
                      </span>
                    )}
                    {size === 'lg' && s.menu && (
                      <span className={st.menu}>
                        {s.menu.name}（{s.menu.duration_min}分）
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
