'use client';

// 運営の検索：店舗名・お客様の名前・予約番号・問い合わせの受付番号で探す。
// お店・ユーザー・問い合わせは押すとその画面へ、予約はその場で中身（日時・お店・メニュー・状態）を出す

import { useEffect, useId, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CalendarCheck, ChatCircle, MagnifyingGlass, Storefront, User, X } from '@/components/ui/icons';
import { one } from '@/lib/supabase';
import type { AdminTab } from './AdminHome';
import s from '../salon/SalonTools.module.css';

type Hit = { key: string; group: string; icon: typeof Storefront; title: string; sub: string; tab?: AdminTab };

const BOOKING_STATUS: Record<string, string> = {
  confirmed: '予約中',
  completed: '来店済み',
  no_show: '無断キャンセル',
  cancelled_by_customer: 'キャンセル（お客様）',
  cancelled_by_salon: 'キャンセル（サロン）',
};
const dt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function AdminSearch({ client, onOpen }: { client: SupabaseClient; onOpen: (tab: AdminTab) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);
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

  useEffect(() => {
    // 検索の文字の % と _ は、そのままの文字として探す
    const word = q.trim().replace(/[%_\\]/g, '');
    if (!word) {
      setHits(null);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      const num = /^\d+$/.test(word) ? Number(word) : null;
      const qno = /^q-?(\d+)$/i.exec(word)?.[1];
      const [sl, bk, us, iq] = await Promise.all([
        client.from('salons').select('id,name,address,is_approved').ilike('name', `%${word}%`).limit(5),
        (num !== null
          ? client.from('bookings').select('id,booking_no,contact_name,status,slots(start_at,salons(name),menus(name))').eq('booking_no', num)
          : client.from('bookings').select('id,booking_no,contact_name,status,slots(start_at,salons(name),menus(name))').ilike('contact_name', `%${word}%`)
        )
          .order('created_at', { ascending: false })
          .limit(6),
        client.rpc('admin_list_users', { p_query: word }),
        qno
          ? client.from('inquiries').select('id,no,subject,status').eq('no', Number(qno)).limit(3)
          : client.from('inquiries').select('id,no,subject,status').ilike('subject', `%${word}%`).limit(3),
      ]);
      if (!alive) return;
      const out: Hit[] = [];
      for (const x of (sl.data ?? []) as { id: string; name: string; address: string; is_approved: boolean }[]) {
        out.push({ key: `s-${x.id}`, group: 'お店', icon: Storefront, title: x.name, sub: `${x.address}${x.is_approved ? '' : '（掲載していない）'}`, tab: 'salons' });
      }
      for (const x of (bk.data ?? []) as unknown as {
        id: string;
        booking_no: number | null;
        contact_name: string;
        status: string;
        slots: { start_at: string; salons: { name: string } | null; menus: { name: string } | null } | null;
      }[]) {
        const slot = one(x.slots);
        out.push({
          key: `b-${x.id}`,
          group: '予約',
          icon: CalendarCheck,
          title: `${x.contact_name} 様${x.booking_no !== null ? `（予約番号 ${x.booking_no}）` : ''}`,
          sub: `${slot ? dt.format(new Date(slot.start_at)) : ''} ${one(slot?.salons ?? null)?.name ?? ''} ・ ${one(slot?.menus ?? null)?.name ?? ''} ・ ${BOOKING_STATUS[x.status] ?? x.status}`,
        });
      }
      if (!us.error) {
        for (const x of ((us.data ?? []) as { id: string; display_name: string; email_masked: string | null }[]).slice(0, 4)) {
          out.push({ key: `u-${x.id}`, group: 'ユーザー', icon: User, title: x.display_name || '（名前なし）', sub: x.email_masked ?? '', tab: 'users' });
        }
      }
      if (!iq.error) {
        for (const x of (iq.data ?? []) as { id: string; no: number; subject: string }[]) {
          out.push({ key: `q-${x.id}`, group: '問い合わせ', icon: ChatCircle, title: `Q-${x.no} ${x.subject}`, sub: '', tab: 'inquiries' });
        }
      }
      setHits(out);
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, client]);

  return (
    <div className={s.search} ref={box}>
      <MagnifyingGlass size={20} className={s.searchIcon} aria-hidden focusable="false" />
      <input
        type="search"
        role="combobox"
        aria-autocomplete="list"
        className={s.searchInput}
        placeholder="店舗名・お客様の名前・予約番号で検索"
        aria-label="店舗名・お客様の名前・予約番号・問い合わせの受付番号で検索"
        aria-expanded={open && !!q.trim()}
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
      {open && q.trim() && (
        <div className={s.pop} id={listId}>
          <p className={s.popHead} role="status">
            {hits === null ? '探しています…' : `${hits.length}件`}
          </p>
          {hits && hits.length === 0 && <p className={s.popEmpty}>見つかりませんでした。予約番号は数字だけ、問い合わせは「Q-1001」の形で入力してください。</p>}
          {hits && hits.length > 0 && (
            <ul className={s.popList}>
              {hits.map((h) => (
                <li key={h.key}>
                  {h.tab ? (
                    <button
                      type="button"
                      className={s.popItem}
                      onClick={() => {
                        setOpen(false);
                        onOpen(h.tab!);
                      }}
                    >
                      <h.icon size={20} aria-hidden focusable="false" />
                      <span className={s.popBody}>
                        <span className={s.popTitle}>{h.title}</span>
                        <span className={s.popSub}>
                          {h.group}
                          {h.sub && ` ・ ${h.sub}`}
                        </span>
                      </span>
                    </button>
                  ) : (
                    <div className={s.popItem}>
                      <h.icon size={20} aria-hidden focusable="false" />
                      <span className={s.popBody}>
                        <span className={s.popTitle}>{h.title}</span>
                        <span className={s.popSub}>{h.sub}</span>
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
