'use client';

// ホームのヒーロー
//   ・写真は使わず、日本時間の時刻で色が移るグラデーション（朝・昼・夕方・夜。毎分、CSS変数を更新する）
//   ・大きな円形の「今すぐ」ボタン。中に「今、近くで○件の空き」。周りにゆっくり呼吸する光の輪（周期 4.8 秒）
//   ・時間帯は、ヒーローの上に浮かぶ半透明のパネルで選ぶ（件数つき。0件の時間帯は薄くする）

import { useEffect, useState, type CSSProperties } from 'react';
import { WINDOWS, type WindowKey } from '@/lib/time';
import styles from './Hero.module.css';

type Daypart = 'morning' | 'day' | 'evening' | 'night';
// 各時間帯の始まり（日本時間の分）。次の時間帯へ向けて、少しずつ色を混ぜる
const PARTS: { key: Daypart; from: number }[] = [
  { key: 'morning', from: 5 * 60 },
  { key: 'day', from: 10 * 60 },
  { key: 'evening', from: 16 * 60 },
  { key: 'night', from: 19 * 60 },
];

export function daypartAt(date: Date): { from: Daypart; to: Daypart; mix: number } {
  const jst = new Date(date.getTime() + 9 * 3600_000);
  const m = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  // 0時〜5時は夜の続き
  const min = m < PARTS[0].from ? m + 24 * 60 : m;
  let i = PARTS.length - 1;
  for (let k = 0; k < PARTS.length; k++) if (min >= PARTS[k].from) i = k;
  const cur = PARTS[i];
  const next = PARTS[(i + 1) % PARTS.length];
  const end = next.from > cur.from ? next.from : next.from + 24 * 60;
  const mix = Math.round(((min - cur.from) / (end - cur.from)) * 100);
  return { from: cur.key, to: next.key, mix: Math.max(0, Math.min(100, mix)) };
}

const LABEL: Record<Daypart, string> = { morning: '朝', day: '昼', evening: '夕方', night: '夜' };
// パネルの時間帯の呼び名（大きな「今すぐ」ボタンと見分けるため、長さで示す）
const PANEL_LABEL: Record<WindowKey, string> = { now: '30分以内', '1h': '1時間', '3h': '3時間', today: '今日中' };

export function useDaypart() {
  const [part, setPart] = useState(() => daypartAt(new Date()));
  useEffect(() => {
    const t = setInterval(() => setPart(daypartAt(new Date())), 60_000);
    return () => clearInterval(t);
  }, []);
  return part;
}

export function WindowPanel({
  counts,
  loading,
  current,
  onChoose,
  floating = false,
}: {
  counts: Record<WindowKey, number>;
  loading: boolean;
  current?: WindowKey | null;
  onChoose: (key: WindowKey) => void;
  floating?: boolean;
}) {
  return (
    <div className={`${styles.panel} ${floating ? styles.floating : ''}`} role="group" aria-label="いつ行けますか（時間帯と空きの件数）">
      {WINDOWS.map((w) => {
        const n = counts[w.key];
        const empty = !loading && n === 0;
        return (
          <button
            key={w.key}
            type="button"
            className={styles.window}
            data-empty={empty || undefined}
            aria-pressed={current === w.key}
            onClick={() => onChoose(w.key)}
          >
            {/* 読み上げは「30分以内に始まる枠：1件」。見えている文字をそのまま含める（WCAG 2.5.3） */}
            <span className={styles.windowLabel}>
              {PANEL_LABEL[w.key]}
              <span className="sr-only">に始まる枠：</span>
            </span>
            <span className={`${styles.windowCount} num`}>
              {loading ? (
                <>
                  <span aria-hidden>…</span>
                  <span className="sr-only">確かめています</span>
                </>
              ) : (
                n
              )}
              {!loading && <span className="sr-only">件</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function Hero({
  total,
  counts,
  loading,
  onNow,
  onChoose,
}: {
  total: number;
  counts: Record<WindowKey, number>;
  loading: boolean;
  onNow: () => void;
  onChoose: (key: WindowKey) => void;
}) {
  const part = useDaypart();
  return (
    <section
      className={styles.hero}
      data-from={part.from}
      data-to={part.to}
      style={{ '--hero-mix': `${part.mix}%` } as CSSProperties}
      aria-label={`今日の空き枠（${LABEL[part.from]}）`}
    >
      <p className={styles.lead}>空いた時間だけが、今から届く。</p>
      <div className={styles.stage}>
        <button type="button" className={styles.now} onClick={onNow}>
          <span className={`${styles.count} num`} aria-live="polite">
            {loading ? '空きを確かめています' : total > 0 ? `今、近くで${total}件の空き` : '今は空きがありません'}
          </span>
          <span className={styles.nowMain}>今すぐ</span>
          <span className={styles.nowSub}>行けるお店を探す</span>
          <span className={styles.nowNote}>電話不要・店頭払い</span>
        </button>
      </div>
      <WindowPanel counts={counts} loading={loading} onChoose={onChoose} floating />
    </section>
  );
}
