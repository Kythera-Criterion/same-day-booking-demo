'use client';

// 担当ごとの「今日だけ」の帯（9:00〜24:00）。タブレットの横向き向け。
//   ・CSS Grid で 15分ごとの60列に分け、担当ごとに1行。担当の名前の列は、横にスクロールしても固定
//   ・現在時刻の線は CSS変数（--now-col と --now-frac）で位置を決め、毎分更新する
//   ・受付の締切を過ぎた範囲（今から10分後まで）は斜線で薄く覆う
//   ・公開中・予約あり・来店済み・取り下げは、色だけでなく、塗り・枠線・模様でも見分けられるようにする
//   ・空いているところに触れると薄く強調し、押すとその時刻から枠を出すシートを開く
//   ・同じ担当で時間が重なる枠（担当なしの枠など）は、帯の中で段を分けて並べる

import { useEffect, useId, useRef, type CSSProperties } from 'react';
import { fmtTime, jstMinuteOfDay } from '@/lib/time';
import { activeBooking, type SalonSlot, type Stylist } from './useSalonData';
import { STATE_LABEL, slotState } from './Timeline';
import styles from './StaffBands.module.css';

const START = 9 * 60;
const END = 24 * 60;
const STEP = 15;
const COLS = (END - START) / STEP; // 60列
const PAST_MARGIN = 10; // 締切の目安（今から10分後までは出せない）

const colOf = (min: number) => (Math.min(Math.max(min, START), END) - START) / STEP; // 0〜60（小数あり）

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

// 枠の位置：始まりの列と、その列の中のずれ（5分単位の枠も正確に置く）
function place(a: number, z: number) {
  const c0 = colOf(a);
  const c1 = Math.max(c0 + 0.2, colOf(z));
  const first = Math.floor(c0);
  const last = Math.ceil(c1);
  const span = Math.max(1, last - first);
  return {
    gridColumn: `${first + 2} / span ${span}`,
    '--inset-start': (c0 - first) / span,
    '--inset-end': (last - c1) / span,
  } as CSSProperties;
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
  const uid = useId();
  const nowMin = jstMinuteOfDay(now);
  const nowCol = colOf(nowMin);
  const pastCol = colOf(nowMin + PAST_MARGIN);
  const rows: { id: string | null; name: string }[] = [
    ...stylists.filter((s) => s.is_active || slots.some((x) => x.stylist_id === s.id)).map((s) => ({ id: s.id, name: s.name })),
    { id: null, name: '担当なし' },
  ];
  const hours = Array.from({ length: COLS / 4 }, (_, i) => START / 60 + i);
  const todayStartMs = now.getTime() - nowMin * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();

  // 開いたときは、今の時刻の30分前が左端に来るようにする（最初の1回だけ）
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const cell = el.querySelector<HTMLElement>(`[data-col="${Math.max(0, Math.floor(nowCol) - 2)}"]`);
    const name = el.querySelector<HTMLElement>('[data-namecol]');
    if (cell && name) el.scrollLeft = cell.offsetLeft - name.offsetWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showNow = nowMin >= START && nowMin <= END;
  const gridVars = {
    '--cols': COLS,
    '--now-col': Math.floor(nowCol) + 2,
    '--now-frac': nowCol - Math.floor(nowCol),
  } as CSSProperties;

  return (
    <div className={styles.scroll} ref={scroller}>
      {/* 枠は列をまたぐため表の形にはせず、担当ごとのまとまり（group）にする。時刻の目盛りは見た目だけ（各枠の名前に時刻を含める） */}
      <div className={styles.table} role="group" aria-label="担当ごとの今日の予定" style={gridVars}>
        <div className={styles.head} aria-hidden>
          <span className={styles.corner} data-namecol>
            担当
          </span>
          {hours.map((h, i) => (
            <span key={h} className={`${styles.hour} num`} style={{ gridColumn: `${i * 4 + 2} / span 4` }}>
              {h}:00
            </span>
          ))}
          {showNow && (
            <span className={`${styles.nowTag} num`} aria-hidden>
              {fmtTime(now)}
            </span>
          )}
        </div>

        {rows.map((row) => {
          const placed = lanesOf(slots.filter((s) => (s.stylist_id ?? null) === row.id));
          const lanes = Math.max(1, ...placed.map((p) => p.lane + 1));
          return (
            <div
              key={row.id ?? 'none'}
              className={styles.row}
              role="group"
              aria-labelledby={`${uid}-${row.id ?? 'none'}`}
              style={{ '--lanes': lanes } as CSSProperties}
            >
              <span className={styles.name} id={`${uid}-${row.id ?? 'none'}`}>
                {row.name}
              </span>
              {Array.from({ length: COLS }, (_, c) => {
                const startMin = START + c * STEP;
                const past = c < pastCol;
                return (
                  <button
                    key={c}
                    type="button"
                    tabIndex={-1}
                    data-col={c}
                    data-past={past || undefined}
                    data-hour={c % 4 === 0 || undefined}
                    className={styles.cell}
                    style={{ gridColumn: c + 2 }}
                    disabled={past}
                    aria-label={`${row.name} ${Math.floor(startMin / 60)}:${String(startMin % 60).padStart(2, '0')}から枠を出す`}
                    onClick={() => onEmpty(new Date(todayStartMs + Math.max(startMin, Math.ceil((nowMin + PAST_MARGIN) / 5) * 5) * 60_000), row.id)}
                  />
                );
              })}
              {showNow && <span className={styles.now} aria-hidden />}
              {placed.map(({ s, a, z, lane }) => {
                const st = slotState(s);
                const b = activeBooking(s);
                const narrow = z - a <= 30;
                const who = b ? `${b.contact_name} 様` : STATE_LABEL[st] ?? st;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`${styles.block} ${b && freshIds.includes(b.id) ? 'is-fresh' : ''}`}
                    data-state={st}
                    data-narrow={narrow || undefined}
                    style={{ ...place(a, z), gridRow: lane + 1 }}
                    onClick={() => onSelect(s)}
                    title={`${fmtTime(s.start_at)}〜${fmtTime(s.end_at)} ${s.menu?.name ?? ''} ${who}${b && showNo && b.booking_no !== null ? `（予約番号 ${b.booking_no}）` : ''}`}
                  >
                    {/* 読み上げの名前は見えている文字＋見えない補足（終了時刻・状態）。見えている文字をそのまま含める（WCAG 2.5.3） */}
                    <span className={`${styles.time} num`}>
                      {fmtTime(s.start_at)}
                      {narrow ? <span className="sr-only">〜{fmtTime(s.end_at)}</span> : `〜${fmtTime(s.end_at)}`}
                    </span>
                    {b && <span className="sr-only">{STATE_LABEL[st] ?? st}</span>}
                    {narrow ? (
                      <span className="sr-only">{who}</span>
                    ) : (
                      <span className={styles.label}>
                        {who}
                        {b && showNo && b.booking_no !== null && (
                          <span className={`${styles.no} num`}>
                            <span className="sr-only">予約番号</span>
                            {b.booking_no}
                          </span>
                        )}
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
