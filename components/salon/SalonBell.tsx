'use client';

// お知らせのベル：今日入った予約とキャンセルを、新しい順に並べる。まだ見ていないものがあれば、ベルに点を付ける。
// 見たかどうかは、この端末に覚える（お店ごと。読み書きできなくても動き、そのときは開くまで点が付く）

import { useEffect, useRef, useState } from 'react';
import { Bell, BellRinging, CalendarX } from '@/components/ui/icons';
import { fmtTime } from '@/lib/time';
import type { SalonSlot } from './useSalonData';
import s from './SalonTools.module.css';

type Item = { id: string; at: string; kind: 'booked' | 'cancelled'; slot: SalonSlot; name: string };

function seenKey(salonId: string) {
  return `salon-bell-seen-${salonId}`;
}

export default function SalonBell({ salonId, slots, onSelect }: { salonId: string; slots: SalonSlot[]; onSelect: (slot: SalonSlot) => void }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string>('');
  // 開いたときの、前に見た時刻（開いている間、それより新しいものに「新着」を付ける）
  const [before, setBefore] = useState<string>('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setSeen(localStorage.getItem(seenKey(salonId)) ?? '');
    } catch {
      setSeen('');
    }
  }, [salonId]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const items: Item[] = slots
    .flatMap((slot) =>
      slot.bookings.flatMap((b) => {
        const out: Item[] = [{ id: `${b.id}-b`, at: b.created_at, kind: 'booked', slot, name: b.contact_name }];
        if (b.status.startsWith('cancelled') && b.cancelled_at) out.push({ id: `${b.id}-c`, at: b.cancelled_at, kind: 'cancelled', slot, name: b.contact_name });
        return out;
      }),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  const unseen = items.filter((i) => i.at > seen).length;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      const now = new Date().toISOString();
      try {
        localStorage.setItem(seenKey(salonId), now);
      } catch {
        // 覚えられなくても動く
      }
      setBefore(seen);
      setSeen(now);
    }
  }

  return (
    <div className={s.bell} ref={box}>
      <button
        type="button"
        className={s.bellButton}
        aria-expanded={open}
        aria-label={unseen > 0 ? `お知らせ（まだ見ていないもの ${unseen}件）` : 'お知らせ'}
        onClick={toggle}
      >
        {unseen > 0 ? <BellRinging size={24} weight="fill" aria-hidden focusable="false" /> : <Bell size={24} aria-hidden focusable="false" />}
        {unseen > 0 && <span className={s.bellDot} aria-hidden />}
      </button>
      {open && (
        <div className={`${s.pop} ${s.popRight}`}>
          <p className={s.popHead}>今日のお知らせ</p>
          {items.length === 0 ? (
            <p className={s.popEmpty}>今日はまだ、予約もキャンセルもありません。</p>
          ) : (
            <ul className={s.popList}>
              {items.slice(0, 12).map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    className={s.popItem}
                    onClick={() => {
                      setOpen(false);
                      onSelect(i.slot);
                    }}
                  >
                    <span className={i.kind === 'booked' ? s.popIconBooked : s.popIconCancel} aria-hidden>
                      {i.kind === 'booked' ? <BellRinging size={20} weight="fill" /> : <CalendarX size={20} />}
                    </span>
                    <span className={s.popBody}>
                      <span className={s.popTitle}>
                        {i.kind === 'booked' ? '新しい予約' : 'キャンセル'}：{i.name} 様
                        {i.at > before && <span className={s.popNew}>新着</span>}
                      </span>
                      <span className={s.popSub}>
                        {fmtTime(i.slot.start_at)}〜 {i.slot.menu?.name}
                      </span>
                    </span>
                    <span className={`${s.popAt} num`}>{fmtTime(i.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
