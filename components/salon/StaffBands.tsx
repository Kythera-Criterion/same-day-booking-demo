'use client';

// 予定の表（9:00〜24:00）。サロンの画面のデザイン案に合わせ、列（担当・曜日）を横に、時刻を縦に並べる。
//   StaffBands：今日の予定を、担当ごとの列で（日表示）
//   WeekBands ：1週間の予定を、曜日ごとの列で（週表示）
// 1時間を72pxで描き、30分ごとに細い線を引く。列の名前（上）と時刻（左）は、スクロールしても残す。
// 現在時刻の線が動き、締切を過ぎた範囲（今から10分後まで）は斜線。今日の列の空いているところを押すと、その時刻から枠を出せる。
// 同じ列で時間が重なる枠（担当なしの枠など）は、列の中で横に分けて並べる

import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { fmtTime, jstDateKey, jstMinuteOfDay } from '@/lib/time';
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

type Column = {
  key: string;
  // 上の行（担当の印と名前・曜日と日付）
  head: ReactNode;
  // 読み上げる列の名前
  label: string;
  slots: SalonSlot[];
  // この列の時刻の経ち方：today（今の時刻の線と斜線）・past（すべて過ぎた）・future（まだ）
  time: 'today' | 'past' | 'future';
  // 空いているところを押したとき（今日の列だけ）
  onEmpty?: (minute: number) => void;
  highlight?: boolean;
};

function DayGrid({
  label,
  columns,
  now,
  freshIds,
  showNo,
  compact = false,
  onSelect,
}: {
  label: string;
  columns: Column[];
  now: Date;
  freshIds: string[];
  showNo: boolean;
  compact?: boolean;
  onSelect: (slot: SalonSlot) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const nowMin = jstMinuteOfDay(now);
  const hours = Array.from({ length: (END - START) / 60 + 1 }, (_, i) => START + i * 60);

  // 開いたときは、今の時刻の30分ほど前が上に来るようにする（列の名前の行は上に残る）
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = Math.max(0, y(Math.floor((nowMin - 30) / 30) * 30));
    // 最初の1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function tap(e: MouseEvent<HTMLDivElement>, col: Column) {
    if (!col.onEmpty) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minute = START + (e.clientY - rect.top) / PX_PER_MIN;
    col.onEmpty(Math.ceil(minute / 5) * 5);
  }

  return (
    <div className={`${st.scroll} ${compact ? st.compact : ''}`} ref={scroller}>
      <div
        className={st.grid}
        role="group"
        aria-label={label}
        style={{ gridTemplateColumns: `var(--day-time-w) repeat(${columns.length}, minmax(var(--day-col-min), 1fr))` }}
      >
        <span className={st.corner} aria-hidden>
          時間
        </span>
        {columns.map((c) => (
          <span key={c.key} className={`${st.head} ${c.highlight ? st.headToday : ''}`} aria-hidden>
            {c.head}
          </span>
        ))}

        <div className={st.axis} style={{ height: TRACK_H }} aria-hidden>
          {hours.map((m) => (
            <span key={m} className={st.hour} style={{ top: y(m) }}>
              {String(Math.floor(m / 60)).padStart(2, '0')}:00
            </span>
          ))}
        </div>

        {columns.map((c) => {
          const { placed, lanes } = lanesOf(c.slots);
          return (
            <div
              key={c.key}
              className={`${st.col} ${c.onEmpty ? st.colTap : ''}`}
              style={{ height: TRACK_H }}
              role="group"
              aria-label={c.label}
              onClick={(e) => tap(e, c)}
            >
              {c.onEmpty && <span className="sr-only">{c.label}：空いている時刻を押すと、その時刻から枠を出せます</span>}
              {c.time !== 'future' && (
                <span className={st.past} style={{ height: c.time === 'past' ? TRACK_H : y(nowMin + 10) }} aria-hidden />
              )}
              {c.time === 'today' && nowMin >= START && nowMin <= END && <span className={st.now} style={{ top: y(nowMin) }} aria-hidden />}
              {placed.map(({ s, a, z, lane }) => {
                const state = slotState(s);
                const b = activeBooking(s);
                const h = Math.max(20, y(z) - y(a) - 3);
                const who = b ? `${b.contact_name} 様` : STATE_LABEL[state] ?? state;
                const fresh = !!b && freshIds.includes(b.id);
                // 週表示（列が狭い）は、時刻とアイコンだけ（名前・メニューは読み上げと、ポインタを重ねたときの説明に）
                const size = compact ? 'sm' : h >= 64 ? 'lg' : h >= 40 ? 'md' : 'sm';
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
                    title={`${fmtTime(s.start_at)}〜${fmtTime(s.end_at)} ${s.menu?.name ?? ''} ${who}${s.stylist ? ` ・ ${s.stylist.name}` : ''}${b && showNo && b.booking_no !== null ? `（予約番号 ${b.booking_no}）` : ''}`}
                  >
                    <span className={st.blockTop}>
                      <StateIcon state={state} />
                      {/* 週表示で時間の重なる枠が横に並ぶと狭いので、アイコンだけにする（時刻は読み上げと説明に） */}
                      {compact && lanes > 1 ? (
                        <span className="sr-only">{fmtTime(s.start_at)}</span>
                      ) : (
                        <span className={`${st.time} num`}>
                          {fmtTime(s.start_at)}
                          {!compact && ` - ${fmtTime(s.end_at)}`}
                        </span>
                      )}
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

// 担当の印：写真があれば写真、なければ名前の最初の1文字
export function StylistAvatar({ name, photo, none = false }: { name: string; photo?: string | null; none?: boolean }) {
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element -- 端末で縮めた小さな写真（データの URL）をそのまま出す
    return <img className={st.avatar} src={photo} alt="" />;
  }
  return <span className={`${st.avatar} ${none ? st.avatarNone : ''}`}>{none ? '－' : [...name][0]}</span>;
}

// 今日の予定（担当ごとの列）
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
  const todayStartMs = now.getTime() - jstMinuteOfDay(now) * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();
  const rows: { id: string | null; name: string; photo: string | null }[] = [
    ...stylists
      .filter((s) => s.is_active || slots.some((x) => x.stylist_id === s.id))
      .map((s) => ({ id: s.id, name: s.name, photo: s.photo ?? null })),
    { id: null, name: '担当なし', photo: null },
  ];
  return (
    <DayGrid
      label="担当ごとの今日の予定"
      now={now}
      freshIds={freshIds}
      showNo={showNo}
      onSelect={onSelect}
      columns={rows.map((r) => ({
        key: r.id ?? 'none',
        label: r.name,
        time: 'today',
        slots: slots.filter((s) => (s.stylist_id ?? null) === r.id),
        onEmpty: (minute) => onEmpty(new Date(todayStartMs + minute * 60_000), r.id),
        head: (
          <>
            <StylistAvatar name={r.name} photo={r.photo} none={!r.id} />
            <span className={st.who}>
              <span className={st.name}>{r.name}</span>
              <span className={st.role}>{r.id ? 'スタイリスト' : '担当を決めない枠'}</span>
            </span>
          </>
        ),
      }))}
    />
  );
}

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

// 1週間の予定（曜日ごとの列）。weekStart は月曜日の0時（日本時間）
export function WeekBands({
  slots,
  weekStart,
  now,
  freshIds,
  showNo,
  onSelect,
  onEmpty,
}: {
  slots: SalonSlot[];
  weekStart: Date;
  now: Date;
  freshIds: string[];
  showNo: boolean;
  onSelect: (slot: SalonSlot) => void;
  onEmpty: (start: Date) => void;
}) {
  const today = jstDateKey(now);
  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86_400_000));
  return (
    <DayGrid
      label="1週間の予定"
      now={now}
      freshIds={freshIds}
      showNo={showNo}
      compact
      onSelect={onSelect}
      columns={days.map((d) => {
        const key = jstDateKey(d);
        const time = key === today ? 'today' : key < today ? 'past' : 'future';
        const jst = new Date(d.getTime() + 9 * 3_600_000);
        return {
          key,
          label: `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日（${DOW[jst.getUTCDay()]}）`,
          time,
          highlight: time === 'today',
          slots: slots.filter((s) => jstDateKey(new Date(s.start_at)) === key),
          // 枠を出せるのは今日だけ（当日の空きを届けるサービスのため）
          onEmpty: time === 'today' ? (minute: number) => onEmpty(new Date(d.getTime() + minute * 60_000)) : undefined,
          head: (
            <span className={st.day}>
              <span className={`${st.dow} ${jst.getUTCDay() === 0 ? st.sun : jst.getUTCDay() === 6 ? st.sat : ''}`}>{DOW[jst.getUTCDay()]}</span>
              <span className={`${st.date} num`}>
                {jst.getUTCMonth() + 1}/{jst.getUTCDate()}
              </span>
              {time === 'today' && <span className={st.todayMark}>今日</span>}
            </span>
          ),
        };
      })}
    />
  );
}
