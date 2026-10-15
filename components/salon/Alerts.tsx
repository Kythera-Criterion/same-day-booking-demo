'use client';

// 施術中でも見逃さないための仕組み
//   AlertGate        ：営業の始めに「通知音をオンにして始める」（ブラウザは操作の前に音を鳴らせないため）。画面も消えないようにする
//   NewBookingAlert  ：予約が入ると画面全体が穏やかに点滅し、音が繰り返し鳴る。どこを押しても「確認しました」になり、詳細が開く

import { useEffect, useRef } from 'react';
import { chime, unlockSound, vibrate } from '@/lib/alerts';
import { fmtTime } from '@/lib/time';
import styles from './IncomingAlert.module.css';

export function AlertGate({
  wake,
  onStart,
}: {
  wake: 'idle' | 'on' | 'unsupported';
  onStart: () => void;
}) {
  return (
    <section className="gate card">
      <div>
        <p className="card-title">営業を始める前に</p>
        <p className="card-sub" style={{ marginBottom: 0 }}>
          予約が入ったときに音で知らせるため、最初に一度だけ押してください。画面も消えないようにします。
        </p>
      </div>
      <button
        className="btn btn-primary btn-lg"
        onClick={() => {
          unlockSound();
          onStart();
        }}
      >
        通知音をオンにして始める
      </button>
      {wake === 'unsupported' && (
        <p className="notice notice-info" style={{ margin: 0 }}>
          この端末では、画面が自動で消えるのを止められません。端末の設定で、画面の自動ロックを長めにしてください。
        </p>
      )}
    </section>
  );
}

export type IncomingBooking = {
  bookingId: string;
  slotId: string;
  name: string;
  startAt: string | null;
  menu: string | null;
  bookingNo: number | null;
};

export function NewBookingAlert({
  items,
  soundOn,
  showNo,
  onAcknowledge,
}: {
  items: IncomingBooking[];
  soundOn: boolean;
  showNo: boolean;
  onAcknowledge: () => void;
}) {
  const first = items[0];
  const ackRef = useRef<HTMLButtonElement>(null);

  // 確認されるまで、音を繰り返す（3.5秒ごと）。振動は対応している端末だけ
  useEffect(() => {
    if (!first) return;
    if (soundOn) chime();
    vibrate();
    const t = setInterval(() => {
      if (soundOn) chime();
    }, 3500);
    ackRef.current?.focus();
    return () => clearInterval(t);
  }, [first, soundOn]);

  if (!first) return null;
  // レイヤー全体を1つのボタンにする（どこを押しても「確認しました」）
  return (
    <button
      ref={ackRef}
      type="button"
      className={styles.layer}
      onClick={onAcknowledge}
      onKeyDown={(e) => e.key === 'Escape' && onAcknowledge()}
    >
      {/* 読み上げの名前は、画面に見えている文字そのもの（WCAG 2.5.3） */}
      <span className={styles.inner}>
        <span className={styles.label}>
          <span className={styles.labelDot} aria-hidden />
          新しい予約{items.length > 1 ? `（ほか${items.length - 1}件）` : ''}
        </span>
        <span className={`${styles.time} num`}>{first.startAt ? fmtTime(first.startAt) : ''}</span>
        <span className={styles.menu}>{first.menu ?? ''}</span>
        <span className={styles.name}>{first.name} 様</span>
        {showNo && first.bookingNo !== null && (
          <span className={`${styles.no} num`}>
            予約番号 <strong>{first.bookingNo}</strong>
          </span>
        )}
        <span className={styles.tap}>画面のどこかを押すと「確認しました」になり、詳細が開きます</span>
      </span>
    </button>
  );
}
