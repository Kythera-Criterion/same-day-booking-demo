'use client';

// サロンの一覧：掲載の状態・場所の設定・メニューとスタッフの数・今日の枠と予約。掲載を止める・再開する

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Sheet from '@/components/Sheet';
import { Empty, ErrorState, Loading } from '@/components/States';
import { one } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import { jstTodayEnd, jstTodayStart } from '@/lib/time';

type Row = {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  is_approved: boolean;
  accepts_genders: string[];
  areas: { name: string } | { name: string }[] | null;
  menus: { count: number }[];
  salon_members: { count: number }[];
};
type Today = { salon_id: string; status: string; bookings: { status: string }[] | null };

export default function Salons({ client }: { client: SupabaseClient }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [today, setToday] = useState<Today[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, t] = await Promise.all([
      client
        .from('salons')
        .select('id,name,address,phone,is_approved,accepts_genders,areas(name),menus(count),salon_members(count)')
        .order('name'),
      client
        .from('slots')
        .select('salon_id,status,bookings(status)')
        .gte('start_at', jstTodayStart().toISOString())
        .lt('start_at', jstTodayEnd().toISOString())
        .eq('demo_history', false),
    ]);
    if (s.error || t.error) {
      setError(toMessage(s.error ?? t.error));
      return;
    }
    setError(null);
    setRows((s.data ?? []) as unknown as Row[]);
    setToday((t.data ?? []) as unknown as Today[]);
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle() {
    if (!target) return;
    setBusy(true);
    const { error: e } = await client.rpc('admin_set_salon_approved', { p_salon_id: target.id, p_approved: !target.is_approved });
    setBusy(false);
    if (e) {
      setMessage(toMessage(e));
    } else {
      setMessage(target.is_approved ? `${target.name} の掲載を止めました。` : `${target.name} の掲載を再開しました。`);
    }
    setTarget(null);
    load();
  }

  if (error) return <ErrorState onRetry={load}>{error}</ErrorState>;
  if (!rows) return <Loading rows={3} />;
  if (rows.length === 0)
    return (
      <div className="card">
        <Empty>サロンはまだありません。掲載希望を承認すると、ここに表示されます。</Empty>
      </div>
    );

  return (
    <div className="stack">
      {message && <p className="notice notice-ok">{message}</p>}
      <div className="card card-flush">
        <div className="slot-table-wrap" style={{ paddingTop: 8 }}>
          <table className="slot-table">
            <thead>
              <tr>
                <th scope="col">サロン</th>
                <th scope="col">エリア</th>
                <th scope="col">受付</th>
                <th scope="col">メニュー・スタッフ</th>
                <th scope="col">今日</th>
                <th scope="col">掲載</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mine = today.filter((t) => t.salon_id === r.id);
                const booked = mine.filter((t) => (t.bookings ?? []).some((b) => !b.status.startsWith('cancelled'))).length;
                const open = mine.filter((t) => t.status === 'open').length;
                const noPlace = !r.address.trim();
                return (
                  <tr key={r.id} style={{ cursor: 'default' }}>
                    <td>
                      <strong>{r.name}</strong>
                      <small>{noPlace ? '⚠ 住所・場所が未設定' : r.address}</small>
                    </td>
                    <td>{one(r.areas)?.name ?? '未設定'}</td>
                    <td>{r.accepts_genders.length === 2 ? 'どなたでも' : r.accepts_genders.includes('female') ? '女性のみ' : '男性のみ'}</td>
                    <td className="num">
                      メニュー {r.menus[0]?.count ?? 0}
                      <small>スタッフ {r.salon_members[0]?.count ?? 0}</small>
                    </td>
                    <td className="num">
                      予約 {booked}
                      <small>公開中 {open}</small>
                    </td>
                    <td>
                      <span className={`pill ${r.is_approved ? 'pill-open' : 'pill-closed'}`}>{r.is_approved ? '掲載中' : '停止中'}</span>
                      <div>
                        <button className="btn btn-text btn-sm" onClick={() => setTarget(r)}>
                          {r.is_approved ? '掲載を止める' : '掲載を再開'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {target && (
        <Sheet label={target.is_approved ? '掲載を止めますか' : '掲載を再開しますか'} role="alertdialog" narrow onClose={() => setTarget(null)}>
          <p className="card-title">
            {target.name} の{target.is_approved ? '掲載を止めますか？' : '掲載を再開しますか？'}
          </p>
          <p className="card-sub">
            {target.is_approved
              ? '止めると、このサロンの枠は利用者の検索に出なくなり、新しい予約もできなくなります。入っている予約はそのままです。'
              : '再開すると、このサロンの公開中の枠が、すぐに利用者の検索に出ます。'}
          </p>
          <div className="action-pair">
            <button className="btn btn-quiet" onClick={() => setTarget(null)}>
              やめる
            </button>
            <button className={`btn ${target.is_approved ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={toggle}>
              {target.is_approved ? '掲載を止める' : '掲載を再開する'}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
