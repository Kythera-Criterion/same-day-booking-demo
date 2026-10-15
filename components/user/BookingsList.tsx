'use client';

// 予約の表示（ホーム・予約・マイページで共通）
//   ActiveCard：ご予約中の枠（開始まで○分）。押すと来店までのライブ画面へ
//   HistoryList：これまでの予約（状態は色と文字の両方で示す）

import Link from 'next/link';
import { Empty } from '@/components/States';
import { fmtDate, fmtRemaining, fmtTime, fmtYen, minutesUntil } from '@/lib/time';
import type { MyBooking } from './useUserState';

export const STATUS_LABEL: Record<string, string> = {
  confirmed: '予約中',
  completed: '来店済み',
  no_show: '無断キャンセル',
  cancelled_by_salon: 'サロン都合のキャンセル',
  cancelled_by_customer: 'キャンセル（お店へ連絡済み）',
};

export function ActiveCard({ booking, now }: { booking: MyBooking; now: Date }) {
  if (!booking.slot) return null;
  return (
    <Link href={`/booking/${booking.id}`} className="active-card fade-in">
      <span className="active-label">ご予約中</span>
      <span className="active-time num">
        今日 {fmtTime(booking.slot.start_at)}
        <em>{fmtRemaining(minutesUntil(booking.slot.start_at, now))}</em>
      </span>
      <span className="active-sub">
        {booking.slot.salon?.name} ・ {booking.slot.menu?.name}
      </span>
      <span className="active-go">来店までの画面を開く →</span>
    </Link>
  );
}

export function NoActive() {
  return (
    <div className="card">
      <Empty>いまご予約はありません。</Empty>
      <Link href="/" className="btn btn-primary btn-block">
        今から行けるお店を探す
      </Link>
    </div>
  );
}

export function HistoryList({ bookings }: { bookings: MyBooking[] }) {
  return (
    <div className="card">
      {bookings.length === 0 ? (
        <Empty>履歴はまだありません。</Empty>
      ) : (
        <ul className="history">
          {bookings.map((b) => (
            <li key={b.id}>
              <Link href={`/booking/${b.id}`}>
                <span>
                  <span className="history-date num">{b.slot ? `${fmtDate(b.slot.start_at)} ${fmtTime(b.slot.start_at)}` : '--'}</span>
                  <span className="history-sub">
                    {b.slot?.salon?.name} ・ {b.slot?.menu?.name} ・ {b.slot ? fmtYen(b.slot.price) : ''}
                  </span>
                </span>
                <span className={`pill pill-${b.status}`}>{STATUS_LABEL[b.status] ?? b.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
