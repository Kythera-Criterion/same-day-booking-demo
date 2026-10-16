'use client';

// 全サロンの今日の枠と予約、予約停止中の電話番号（一部を伏せて表示）

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { Empty, ErrorState, Loading } from '@/components/States';
import Label, { type LabelKind } from '@/components/ui/Label';
import { Stack } from '@/components/ui/Layout';
import { Panel } from '@/components/ui/Surface';
import { CalendarCheck, Clock, Prohibit, SealCheck, ShieldWarning, Storefront, User, XCircle } from '@/components/ui/icons';
import { one } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import { fmtDate, fmtTime, fmtYen, jstTodayEnd, jstTodayStart } from '@/lib/time';
import t from './AdminTable.module.css';
import s from './Overview.module.css';

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

// 状態のラベル：色だけでなく、アイコンと塗り（予約あり・来店済みは塗り、公開中は枠線、終わったものは面）で見分ける
const STATE_LOOK: Record<string, { kind: LabelKind; icon: PhosphorIcon; weight?: 'fill' }> = {
  open: { kind: 'condition', icon: Clock },
  confirmed: { kind: 'action', icon: User, weight: 'fill' },
  completed: { kind: 'strong', icon: SealCheck, weight: 'fill' },
  no_show: { kind: 'danger', icon: Prohibit },
  expired: { kind: 'state', icon: XCircle },
  closed: { kind: 'state', icon: XCircle },
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
    <Stack gap={4}>
      <h2 className={s.heading}>
        <CalendarCheck size={24} aria-hidden focusable="false" />
        今日の枠と予約（{fmtDate(new Date())}）
      </h2>
      {bySalon.size === 0 && (
        <Panel>
          <Empty icon={CalendarCheck}>今日はまだ、どのサロンも枠を出していません。</Empty>
        </Panel>
      )}
      <div className={s.salons}>
        {[...bySalon.entries()].map(([name, list]) => (
          <Panel key={name} flush>
            <div className={s.salonHead}>
              <p className={s.salonName}>
                <Storefront size={20} aria-hidden focusable="false" />
                {name}
              </p>
              <span className={`num ${s.counts}`}>
                枠 {list.length} ・ 予約 {list.filter((r) => (r.bookings ?? []).some((b) => !b.status.startsWith('cancelled'))).length}
              </span>
            </div>
            <div className={t.wrap}>
              <table className={t.table}>
                <thead>
                  <tr>
                    <th scope="col">時刻</th>
                    <th scope="col">メニュー・料金</th>
                    <th scope="col">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const b = (r.bookings ?? []).find((x) => !x.status.startsWith('cancelled'));
                    const state = b ? b.status : r.status === 'booked' ? 'closed' : r.status;
                    const look = STATE_LOOK[state] ?? STATE_LOOK.closed;
                    return (
                      <tr key={r.id}>
                        <td className={`num ${t.figure}`}>{fmtTime(r.start_at)}</td>
                        <td>
                          {one(r.menus)?.name} ・ <span className="num">{fmtYen(r.price)}</span>
                          {b && <small> ・ {b.contact_name} 様</small>}
                        </td>
                        <td className={s.stateCell}>
                          <Label kind={look.kind} icon={look.icon} weight={look.weight}>
                            {STATE[state] ?? state}
                          </Label>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        ))}
      </div>

      <h2 className={s.heading}>
        <ShieldWarning size={24} aria-hidden focusable="false" />
        予約停止中の電話番号
      </h2>
      <Panel flush>
        <p className={s.sub}>直近90日で無断キャンセルが2回になった電話番号です。アカウントを削除しても、記録は90日間残ります。</p>
        {suspended.length === 0 ? (
          <Empty icon={ShieldWarning}>予約停止中の電話番号はありません。</Empty>
        ) : (
          <div className={t.wrap}>
            <table className={t.table}>
              <thead>
                <tr>
                  <th scope="col">電話番号</th>
                  <th scope="col">無断キャンセル</th>
                  <th scope="col">予約できる日</th>
                </tr>
              </thead>
              <tbody>
                {suspended.map((x) => (
                  <tr key={x.masked_phone}>
                    <td className={`num ${t.figure}`}>{x.masked_phone}</td>
                    <td>
                      記録 <span className="num">{x.records}</span>回
                    </td>
                    <td>
                      <span className="num">{fmtDate(x.resume_at)}</span>から予約可
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Stack>
  );
}
