'use client';

// 今日の予定の検索：予約番号・お客様の名前・メニュー・担当で探し、押すとその枠の詳細を開く。
// 画面の中にある今日の枠だけを絞り込む（サーバーへは問い合わせない）

import { useEffect, useId, useRef, useState } from 'react';
import { MagnifyingGlass, X } from '@/components/ui/icons';
import { fmtTime } from '@/lib/time';
import { activeBooking, type SalonSlot } from './useSalonData';
import { STATE_LABEL, slotState } from './Timeline';
import { StateIcon } from './SlotStateMark';
import s from './SalonTools.module.css';

// ひらがな・カタカナ・全角英数字・大文字小文字の違いを気にせず比べる
function norm(text: string) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '');
}

export default function SalonSearch({ slots, showNo, onSelect }: { slots: SalonSlot[]; showNo: boolean; onSelect: (slot: SalonSlot) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const key = norm(q);
  const hits = key
    ? slots.filter((x) => {
        const b = activeBooking(x) ?? x.bookings[0] ?? null;
        const words = [b?.contact_name ?? '', x.menu?.name ?? '', x.stylist?.name ?? '', STATE_LABEL[slotState(x)] ?? ''];
        if (b?.booking_no !== null && b?.booking_no !== undefined && String(b.booking_no) === key) return true;
        return words.some((w) => norm(w).includes(key));
      })
    : [];

  return (
    <div className={s.search} ref={box}>
      <MagnifyingGlass size={20} className={s.searchIcon} aria-hidden focusable="false" />
      <input
        type="search"
        role="combobox"
        aria-autocomplete="list"
        className={s.searchInput}
        placeholder="予約番号・お客様の名前・メニューで検索"
        aria-label="今日の予定を検索（予約番号・お客様の名前・メニュー・担当）"
        aria-expanded={open && !!key}
        aria-controls={listId}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {q && (
        <button type="button" className={s.searchClear} aria-label="検索の文字を消す" onClick={() => setQ('')}>
          <X size={20} aria-hidden focusable="false" />
        </button>
      )}
      {open && key && (
        <div className={s.pop} id={listId}>
          <p className={s.popHead} role="status">
            今日の予定から {hits.length}件
          </p>
          {hits.length === 0 ? (
            <p className={s.popEmpty}>見つかりませんでした。予約番号は数字だけで入力してください。</p>
          ) : (
            <ul className={s.popList}>
              {hits.slice(0, 8).map((x) => {
                const b = activeBooking(x) ?? x.bookings[0] ?? null;
                const state = slotState(x);
                return (
                  <li key={x.id}>
                    <button
                      type="button"
                      className={s.popItem}
                      onClick={() => {
                        setOpen(false);
                        onSelect(x);
                      }}
                    >
                      <span className={`${s.popTime} num`}>{fmtTime(x.start_at)}</span>
                      <span className={s.popBody}>
                        <span className={s.popTitle}>
                          {b ? `${b.contact_name} 様` : STATE_LABEL[state] ?? state}
                          {b && showNo && b.booking_no !== null && <span className={s.popNo}>{b.booking_no}</span>}
                        </span>
                        <span className={s.popSub}>
                          {x.menu?.name}
                          {x.stylist && ` ・ ${x.stylist.name}`}
                        </span>
                      </span>
                      <StateIcon state={state} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
