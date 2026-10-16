'use client';

// 施術中でも見逃さないための仕組み
//   AlertGate        ：営業の始めに「通知音をオンにして始める」（ブラウザは操作の前に音を鳴らせないため）。画面も消えないようにする
//   NewBookingAlert  ：予約が入ると画面全体を濃い面で覆い（点滅はしない）、音が繰り返し鳴る。どこを押しても「確認しました」になり、詳細が開く

import { useEffect, useRef } from 'react';
import { chime, unlockSound, vibrate } from '@/lib/alerts';
import { fmtTime } from '@/lib/time';
import Button from '@/components/ui/Button';
import Notice from '@/components/ui/Notice';
import { BellRinging, HandTap, Ticket } from '@/components/ui/icons';
import s from './Alerts.module.css';

export function AlertGate({
  wake,
  onStart,
}: {
  wake: 'idle' | 'on' | 'unsupported';
  onStart: () => void;
}) {
  return (
    <section className={s.gate} aria-labelledby="gate-title">
      <span className={s.gateIcon}>
        <BellRinging size={24} weight="duotone" aria-hidden focusable="false" />
      </span>
      <div>
        <p className={s.gateTitle} id="gate-title">
          営業を始める前に
        </p>
        <p className={s.gateText}>予約が入ったときに音で知らせるため、最初に一度だけ押してください。画面も消えないようにします。</p>
      </div>
      <Button
        variant="primary"
        size="lg"
        icon={BellRinging}
        className={s.gateAction}
        onClick={() => {
          unlockSound();
          onStart();
        }}
      >
        通知音をオンにして始める
      </Button>
      {wake === 'unsupported' && (
        <div className={s.gateNote}>
          <Notice tone="info">この端末では、画面が自動で消えるのを止められません。端末の設定で、画面の自動ロックを長めにしてください。</Notice>
        </div>
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
  const ackRef = useRef<HTMLDivElement>(null);

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
  return (
    <div
      ref={ackRef}
      className={s.incoming}
      role="alertdialog"
      aria-label="新しい予約が入りました。どこかを押すと確認します"
      tabIndex={-1}
      onClick={onAcknowledge}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') && onAcknowledge()}
    >
      <div className={s.inner}>
        <p className={s.label}>
          <BellRinging size={24} weight="fill" aria-hidden focusable="false" />
          新しい予約が入りました{items.length > 1 ? `（ほか${items.length - 1}件）` : ''}
        </p>
        <p className={s.time}>{first.startAt ? fmtTime(first.startAt) : ''}</p>
        {first.menu && <p className={s.menu}>{first.menu}</p>}
        <p className={s.name}>{first.name} 様</p>
        {showNo && first.bookingNo !== null && (
          <p className={s.no}>
            <Ticket size={24} weight="duotone" aria-hidden focusable="false" />
            予約番号 <strong>{first.bookingNo}</strong>
          </p>
        )}
        <p className={s.tap}>
          <HandTap size={24} aria-hidden focusable="false" />
          画面のどこかを押すと「確認しました」になり、詳細が開きます
        </p>
      </div>
    </div>
  );
}
