'use client';

// 運営の「ユーザー」：お客様のアカウントの一覧（名前・メールアドレスと電話番号は一部を伏せる・予約の数・来店・無断キャンセル・予約停止中か）。
// 0022 を流していないデータベースでは、その旨を出す

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Empty, ErrorState, Loading } from '@/components/States';
import { Input } from '@/components/ui/Form';
import Label from '@/components/ui/Label';
import Notice from '@/components/ui/Notice';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { Prohibit, Users } from '@/components/ui/icons';
import { toMessage } from '@/lib/errors';
import t from './AdminTable.module.css';
import s from './AdminUsers.module.css';

type User = {
  id: string;
  display_name: string;
  email_masked: string | null;
  phone_masked: string | null;
  gender: string | null;
  age_group: string | null;
  area_name: string | null;
  created_at: string;
  bookings: number;
  completed: number;
  no_shows: number;
  last_booking_at: string | null;
  suspended_until: string | null;
};

const GENDER: Record<string, string> = { female: '女性', male: '男性' };
const day = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });

export default function AdminUsers({ client }: { client: SupabaseClient }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(
    async (query: string) => {
      const { data, error: e } = await client.rpc('admin_list_users', { p_query: query || null });
      if (e) {
        // 関数がない（0022 を流していない）
        if (/admin_list_users|function|schema cache/i.test(e.message)) setMissing(true);
        else setError(toMessage(e));
        return;
      }
      setError(null);
      setUsers((data ?? []) as User[]);
    },
    [client],
  );

  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  if (missing) return <Notice tone="info">ユーザーの一覧は、データベースの更新（0022）のあとに使えます。</Notice>;

  const now = Date.now();
  return (
    <Panel>
      <SectionHead icon={Users} title="ユーザー（お客様のアカウント）" as="h2" />
      <SubText>メールアドレスと電話番号は一部を伏せて出します。サロンのスタッフと運営のアカウントは含みません。</SubText>
      <div className={s.search}>
        <Input type="search" placeholder="名前・メールアドレスで絞り込む" aria-label="ユーザーを名前・メールアドレスで絞り込む" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <ErrorState onRetry={() => load(q.trim())}>{error}</ErrorState>}
      {users === null && !error ? (
        <Loading rows={3} />
      ) : users && users.length === 0 ? (
        <Empty icon={Users}>{q ? '条件に合うユーザーはいません。' : 'まだユーザーはいません。'}</Empty>
      ) : (
        users && (
          <>
            <p className={`${s.count} num`}>{users.length}人</p>
            <div className={t.wrap}>
              <table className={t.table}>
                <thead>
                  <tr>
                    <th>名前</th>
                    <th>メールアドレス</th>
                    <th>電話番号</th>
                    <th>性別・年代・エリア</th>
                    <th>登録日</th>
                    <th className={t.end}>予約</th>
                    <th className={t.end}>来店</th>
                    <th className={t.end}>無断</th>
                    <th>最後の予約</th>
                    <th>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const suspended = u.suspended_until && new Date(u.suspended_until).getTime() > now;
                    return (
                      <tr key={u.id}>
                        <td>{u.display_name || '（未設定）'}</td>
                        <td className="num">{u.email_masked ?? '—'}</td>
                        <td className="num">{u.phone_masked ?? '—'}</td>
                        <td>{[u.gender ? GENDER[u.gender] : null, u.age_group, u.area_name].filter(Boolean).join('・') || '—'}</td>
                        <td className="num">{day.format(new Date(u.created_at))}</td>
                        <td className={`num ${t.end}`}>{u.bookings}</td>
                        <td className={`num ${t.end}`}>{u.completed}</td>
                        <td className={`num ${t.end}`}>{u.no_shows}</td>
                        <td className="num">{u.last_booking_at ? day.format(new Date(u.last_booking_at)) : '—'}</td>
                        <td>
                          {suspended ? (
                            <Label kind="danger" icon={Prohibit}>
                              予約停止中（{day.format(new Date(u.suspended_until!))}まで）
                            </Label>
                          ) : (
                            <Label kind="success">利用できる</Label>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </Panel>
  );
}
