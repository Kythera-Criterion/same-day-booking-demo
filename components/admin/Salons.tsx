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
  slots: { bookings: { count: number }[] }[];
};

const DEMO_SALONS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];
const DELETE_ERROR: Record<string, string> = {
  has_bookings: '予約の履歴があるため削除できません。実証の数字と、お客様の予約・無断キャンセルの記録を残すためです。代わりに掲載を止めてください。',
  demo_salon: 'デモ用のサロンは削除できません。',
  forbidden: 'この操作の権限がありません。',
  not_found: 'サロンが見つかりませんでした。',
};
type Today = { salon_id: string; status: string; bookings: { status: string }[] | null };

export default function Salons({ client }: { client: SupabaseClient }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [today, setToday] = useState<Today[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Row | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, t] = await Promise.all([
      client
        .from('salons')
        .select('id,name,address,phone,is_approved,accepts_genders,areas(name),menus(count),salon_members(count),slots(bookings(count))')
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

  async function remove() {
    if (!removing) return;
    setBusy(true);
    setRemoveError(null);
    const token = (await client.auth.getSession()).data.session?.access_token;
    const res = await fetch('/api/admin/delete-salon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ salonId: removing.id }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; name?: string; removedStaff?: string[]; keptStaff?: string[] };
    setBusy(false);
    if (!res.ok) {
      setRemoveError(DELETE_ERROR[body.error ?? ''] ?? `削除できませんでした（${body.error ?? res.status}）`);
      return;
    }
    setMessage(
      `${body.name} を削除しました。` +
        ((body.removedStaff?.length ?? 0) > 0 ? `スタッフのアカウント（${body.removedStaff!.join('、')}）も削除しました。` : '') +
        ((body.keptStaff?.length ?? 0) > 0 ? `ほかでも使われているアカウント（${body.keptStaff!.join('、')}）は残しました。` : ''),
    );
    setRemoving(null);
    setConfirmName('');
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
                <th scope="col">削除</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mine = today.filter((t) => t.salon_id === r.id);
                const booked = mine.filter((t) => (t.bookings ?? []).some((b) => !b.status.startsWith('cancelled'))).length;
                const open = mine.filter((t) => t.status === 'open').length;
                const noPlace = !r.address.trim();
                const history = (r.slots ?? []).reduce((sum, s) => sum + (s.bookings?.[0]?.count ?? 0), 0);
                const isDemo = DEMO_SALONS.includes(r.id);
                const why = isDemo ? 'デモ用のサロンは削除できません' : history > 0 ? `予約の履歴が${history}件あるため削除できません（掲載を止めてください）` : null;
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
                    <td>
                      <button
                        className="btn btn-text btn-sm danger-text"
                        disabled={!!why}
                        title={why ?? undefined}
                        onClick={() => {
                          setRemoving(r);
                          setConfirmName('');
                          setRemoveError(null);
                        }}
                      >
                        削除
                      </button>
                      <small>{isDemo ? 'デモ用' : history > 0 ? `予約の履歴 ${history}件` : '予約の履歴なし'}</small>
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
          {(() => {
            const mine = today.filter((t) => t.salon_id === target.id);
            const open = mine.filter((t) => t.status === 'open').length;
            const upcoming = mine.filter((t) => (t.bookings ?? []).some((b) => b.status === 'confirmed')).length;
            return target.is_approved ? (
              <ul className="delete-list">
                <li>公開中の枠（今日 {open}件）をすぐに取り下げ、利用者の画面から消します。新しい予約もできなくなります。</li>
                <li>
                  これからの予約（今日 {upcoming}件）はそのまま残ります。予約したお客様には、来店のためにお店の情報が表示され続けます。
                  {upcoming > 0 && '必要に応じて、サロンへご連絡ください。'}
                </li>
                <li>サロンの画面には「掲載が止められています」と表示されます。再開はいつでもできます。</li>
              </ul>
            ) : (
              <p className="card-sub">再開すると、止めたときに取り下げた枠のうち、受付の締切前のものを再び公開し、利用者の検索に出します。</p>
            );
          })()}
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

      {removing && (
        <Sheet label="サロンを削除しますか" role="alertdialog" narrow onClose={() => setRemoving(null)}>
          <p className="card-title">{removing.name} を削除しますか？</p>
          <ul className="delete-list">
            <li>サロン・メニュー・担当・今日までの枠・いつもの枠・LINE の設定を削除します。元に戻せません。</li>
            <li>このサロンだけのスタッフのアカウントも削除します（ほかのサロン・運営・利用者としても使われているアカウントは残します）。</li>
            <li>掲載希望の記録と操作の記録は残ります。</li>
            <li>予約の履歴があるサロンは削除できません。その場合は掲載を止めてください。</li>
          </ul>
          <label className="field">
            <span className="field-label">確認のため、店名「{removing.name}」を入力してください</span>
            <input className="input" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
          </label>
          {removeError && (
            <p className="notice notice-error" role="alert">
              {removeError}
            </p>
          )}
          <div className="action-pair">
            <button className="btn btn-quiet" onClick={() => setRemoving(null)}>
              やめる
            </button>
            <button className="btn btn-danger" disabled={busy || confirmName.trim() !== removing.name} onClick={remove}>
              {busy ? '削除中…' : '削除する'}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
