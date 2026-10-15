'use client';

// 候補のカード
//   左：大きな開始時刻（桁をそろえる）と、開始までの時間
//   右：役割のラベル・メニュー・店名と徒歩の目安・当日価格
//   左端の細い帯とラベルの色で、役割（いちばん早い／いちばん近い／もうひとつの候補）を見分ける
//   下端：受付締切までの残りに合わせて減る細いバー（残りが少ないと警告の色）
//   埋まったら灰色にして「埋まりました」を見せ、高さを0まで縮めて消す。新しい候補は下から差し込む

import type { CSSProperties } from 'react';
import { ROLE_LABEL, type PickRole } from '@/lib/picks';
import { fmtDistance } from '@/lib/geo';
import { fmtRemaining, fmtTime, fmtYen, minutesUntil } from '@/lib/time';
import { walkMinutes } from '@/lib/walk';
import styles from './CandidateCard.module.css';

export type CandidateSlot = {
  id: string;
  start_at: string;
  deadline_at: string;
  price: number;
  menu_name: string;
  duration_min: number;
  salon_name: string;
  stylist_name: string | null;
  km: number | null;
  role: PickRole | null;
};

// 受付締切の残りを表すバーの長さ（60分を満タンとする）
const FULL_MIN = 60;
const URGENT_MIN = 5;

export default function CandidateCard({
  slot,
  no,
  now,
  gone,
  selected,
  disabled,
  onSelect,
  onBook,
  refFn,
}: {
  slot: CandidateSlot;
  no?: number;
  now: Date;
  gone: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onBook: () => void;
  refFn?: (el: HTMLLIElement | null) => void;
}) {
  const left = Math.max(0, minutesUntil(slot.deadline_at, now));
  const remaining = Math.max(0, Math.min(1, left / FULL_MIN));
  const urgent = left <= URGENT_MIN;
  const role = slot.role ?? 'balanced';
  return (
    <li ref={refFn} className={styles.item} data-gone={gone || undefined}>
      <div className={styles.clip}>
        <article
          className={styles.card}
          data-role={role}
          data-selected={selected || undefined}
          onClick={onSelect}
          aria-label={`${no !== undefined ? `${no}番 ` : ''}${fmtTime(slot.start_at)}開始 ${slot.salon_name}`}
        >
          <div className={styles.when}>
            {no !== undefined && <span className={`${styles.no} num`}>{no}</span>}
            <span className={`${styles.start} num`}>{fmtTime(slot.start_at)}</span>
            <span className={`${styles.until} num`}>{fmtRemaining(minutesUntil(slot.start_at, now))}</span>
          </div>

          <div className={styles.body}>
            {slot.role && <span className={styles.roleLabel}>{ROLE_LABEL[slot.role]}</span>}
            <p className={styles.menu}>
              {slot.menu_name}
              <span className={`${styles.duration} num`}>{slot.duration_min}分</span>
            </p>
            <p className={styles.salon}>{slot.salon_name}</p>
            <p className={`${styles.meta} num`}>
              {slot.km !== null && `徒歩約${walkMinutes(slot.km)}分・${fmtDistance(slot.km)}`}
              {slot.stylist_name && `${slot.km !== null ? '・' : ''}担当 ${slot.stylist_name}`}
            </p>
          </div>

          <div className={styles.side}>
            <p className={styles.price}>
              <span className={styles.priceLabel}>当日価格</span>
              <span className="num">{fmtYen(slot.price)}</span>
            </p>
            <button
              type="button"
              className={`btn btn-primary ${styles.cta}`}
              disabled={disabled || gone}
              onClick={(e) => {
                e.stopPropagation();
                onBook();
              }}
              aria-label={`${fmtTime(slot.start_at)} ${slot.salon_name} を予約する`}
            >
              予約する
            </button>
          </div>

          <div
            className={styles.deadline}
            data-urgent={urgent || undefined}
            style={{ '--remaining': remaining } as CSSProperties}
          >
            <span className={`${styles.deadlineText} num`}>予約受付 残り{left}分</span>
            <span className={styles.bar} aria-hidden />
          </div>

          {gone && (
            <div className={styles.veil} role="status">
              埋まりました
            </div>
          )}
        </article>
      </div>
    </li>
  );
}
