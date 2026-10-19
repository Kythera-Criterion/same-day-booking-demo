'use client';

// 運営のお知らせのベル：承認待ちの掲載希望・新しく加わったサロン・この24時間に送れなかった通知・未対応の問い合わせ。
// 件数をベルに出し、押すと一覧（押すとその画面へ）

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Bell, BellRinging, ChatCircle, ClipboardText, Sparkle, WarningCircle } from '@/components/ui/icons';
import type { AdminTab } from './AdminHome';
import s from '../salon/SalonTools.module.css';

type Item = { key: string; icon: typeof Bell; title: string; sub: string; tab: AdminTab };

export default function AdminBell({
  client,
  pending,
  joined,
  onOpen,
}: {
  client: SupabaseClient;
  pending: { id: string; salon_name: string }[];
  joined: { id: number; salon_name: string }[];
  onOpen: (tab: AdminTab) => void;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(0);
  const [inquiries, setInquiries] = useState<{ id: string; no: number; subject: string }[]>([]);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [f, q] = await Promise.all([
      client.from('notification_outbox').select('id', { count: 'exact' }).eq('status', 'failed').gte('created_at', new Date(Date.now() - 86_400_000).toISOString()).limit(1),
      client.from('inquiries').select('id,no,subject').eq('status', 'open').order('created_at', { ascending: false }).limit(5),
    ]);
    setFailed(f.count ?? 0);
    setInquiries(q.error ? [] : ((q.data ?? []) as { id: string; no: number; subject: string }[]));
  }, [client]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    const channel = client
      .channel(`admin-bell-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inquiries' }, () => load())
      .subscribe();
    return () => {
      clearInterval(t);
      client.removeChannel(channel);
    };
  }, [client, load]);

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

  const items: Item[] = [
    ...pending.slice(0, 5).map((p) => ({ key: `p-${p.id}`, icon: ClipboardText, title: '掲載希望の承認待ち', sub: p.salon_name, tab: 'applications' as AdminTab })),
    ...inquiries.map((q) => ({ key: `q-${q.id}`, icon: ChatCircle, title: `問い合わせ Q-${q.no}`, sub: q.subject, tab: 'inquiries' as AdminTab })),
    ...joined.slice(0, 5).map((j) => ({ key: `j-${j.id}`, icon: Sparkle, title: '新しいサロンが加わりました', sub: j.salon_name, tab: 'salons' as AdminTab })),
    ...(failed > 0 ? [{ key: 'failed', icon: WarningCircle, title: '通知の送信に失敗', sub: `この24時間に ${failed}件`, tab: 'logs' as AdminTab }] : []),
  ];
  const count = pending.length + inquiries.length + joined.length + (failed > 0 ? 1 : 0);

  return (
    <div className={s.bell} ref={box}>
      <button type="button" className={s.bellButton} aria-expanded={open} aria-label={count > 0 ? `お知らせ（${count}件）` : 'お知らせ'} onClick={() => setOpen(!open)}>
        {count > 0 ? <BellRinging size={24} weight="fill" aria-hidden focusable="false" /> : <Bell size={24} aria-hidden focusable="false" />}
        {count > 0 && (
          <span className={`${s.bellCount} num`} aria-hidden>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className={`${s.pop} ${s.popRight}`}>
          <p className={s.popHead}>お知らせ</p>
          {items.length === 0 ? (
            <p className={s.popEmpty}>今、お知らせはありません。</p>
          ) : (
            <ul className={s.popList}>
              {items.map((i) => (
                <li key={i.key}>
                  <button
                    type="button"
                    className={s.popItem}
                    onClick={() => {
                      setOpen(false);
                      onOpen(i.tab);
                    }}
                  >
                    <span className={s.popIconBooked} aria-hidden>
                      <i.icon size={20} />
                    </span>
                    <span className={s.popBody}>
                      <span className={s.popTitle}>{i.title}</span>
                      <span className={s.popSub}>{i.sub}</span>
                    </span>
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
