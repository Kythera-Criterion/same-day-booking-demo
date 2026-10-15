'use client';

// 全サロンの今日の枠と予約、予約停止中の電話番号（一部を伏せて表示）

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Empty, ErrorState, Loading } from '@/components/States';
import { one } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import { fmtDate, fmtTime, fmtYen, jstTodayEnd, jstTodayStart } from '@/lib/time';

type Row = {
  id: string;
  start_at: string;
  status: string;
  price: number;
  salons: { name: string } | { name: string }[] | null;
  menus: { name: string } | { name: string }[] | null;
  bookings: { id: string; status: string; contact_name: string }[] | null;
};
type Suspended = { masked_phone: string; records: number; resume_at: string };

const STATE: Record<string, string> = {
  open: '予約待ち',
  confirmed: '予約あり',
  completed: '来店済み',
  no_show: '無断キャンセル',
  expired: '受付終了',
  closed: '取り下げ',
};

export default function Overview({ client }: { client: SupabaseClient }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [suspended, setSuspended] = useState<Suspended[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([
      client
        .from('slots')
        .select('id,start_at,status,price,salons(name),menus(name),bookings(id,status,contact_name)')
        .gte('start_at', jstTodayStart().toISOString())
        .lt('start_at', jstTodayEnd().toISOString())
        .eq('demo_history', false)
        .order('start_at'),
      client.rpc('admin_suspended_phones'),
    ]);
    if (s.error || p.error) {
      setError(toMessage(s.error ?? p.error));
      return;
    }
    setError(null);
    setRows((s.data ?? []) as unknown as Row[]);
    setSuspended((p.data ?? []) as Suspended[]);
  }, [client]);

  useEffect(() => {
    load();
    const channel = client
      .channel('admin-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, () => load())
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [client, load]);

  if (error) return <ErrorState onRetry={load}>{error}</ErrorState>;
  if (!rows || !suspended) return <Loading rows={3} />;

  const bySalon = new Map<string, Row[]>();
  for (const r of rows) {
    const name = one(r.salons)?.name ?? '（不明）';
    bySalon.set(name, [...(bySalon.get(name) ?? []), r]);
  }

  return (
    <div className="stack">
      <h2 className="section-title">今日の枠と予約（{fmtDate(new Date())}）</h2>
      {bySalon.size === 0 && (
        <div className="card">
          <Empty>今日はまだ、どのサロンも枠を出していません。</Empty>
        </div>
      )}
      {[...bySalon.entries()].map(([name, list]) => (
        <section key={name} className="card">
          <div className="row-between">
            <p className="card-title" style={{ margin: 0 }}>
              {name}
            </p>
            <span className="tiny muted">
              枠 {list.length} ・ 予約 {list.filter((r) => (r.bookings ?? []).some((b) => !b.status.startsWith('cancelled'))).length}
            </span>
          </div>
          <ul className="overview-list">
            {list.map((r) => {
              const b = (r.bookings ?? []).find((x) => !x.status.startsWith('cancelled'));
              const state = b ? b.status : r.status === 'booked' ? 'closed' : r.status;
              return (
                <li key={r.id}>
                  <span className="num">{fmtTime(r.start_at)}</span>
                  <span>
                    {one(r.menus)?.name} ・ {fmtYen(r.price)}
                    {b && <small> ・ {b.contact_name} 様</small>}
                  </span>
                  <span className={`pill pill-${state}`}>{STATE[state] ?? state}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <h2 className="section-title">予約停止中の電話番号</h2>
      <section className="card">
        <p className="card-sub">直近90日で無断キャンセルが2回になった電話番号です。アカウントを削除しても、記録は90日間残ります。</p>
        {suspended.length === 0 ? (
          <Empty>予約停止中の電話番号はありません。</Empty>
        ) : (
          <ul className="overview-list">
            {suspended.map((s) => (
              <li key={s.masked_phone}>
                <span className="num">{s.masked_phone}</span>
                <span>記録 {s.records}回</span>
                <span className="tiny">{fmtDate(s.resume_at)}から予約可</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
