'use client';

// 利用の記録（/usage。運営や各画面から独立した別のページ。見られるのは運営のアカウントだけ）
//   デモを開いた人ごとの利用時間と、そのアカウントに送った通知の件数
//   記録は components/UsageTracker が app/api/usage 経由で残す。ここでは読んで、選んで削除・すべて削除する
//   一覧は DB の関数 admin_usage_visits、削除は admin_usage_delete・admin_usage_delete_all（どれも中で運営かどうかを確かめる）
//   表示は「訪問ごと」と「アカウントごと」（ログインしていない訪問は、ブラウザごとにまとめる）
//   その場の知らせ：訪問者がページを開いた・機能を使ったら、Realtime で受け取り、上に閉じられる知らせの帯を出して一覧を読み直す
//   使った機能：押したボタン・リンク・タブなどの名前（usage_events）。訪問ごとは順に、アカウントごとは種類ごとの回数で出す

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppHeader from '@/components/AppHeader';
import LoginBox from '@/components/LoginBox';
import Sheet from '@/components/Sheet';
import { Empty, ErrorState, Loading, NotConfigured } from '@/components/States';
import Button from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Form';
import { Fine, Lead, Page, ScreenTitle, Stack } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import { Panel } from '@/components/ui/Surface';
import Toast from '@/components/ui/Toast';
import { ArrowClockwise, BellRinging, ChartLine, SignOut, Trash, X } from '@/components/ui/icons';
import { toMessage } from '@/lib/errors';
import { logout } from '@/lib/logout';
import { useRoleSession } from '@/lib/supabase';
import t from '@/components/admin/AdminTable.module.css';
import s from './UsageLog.module.css';

type Visit = {
  id: string;
  visitor_id: string;
  started_at: string;
  last_seen_at: string;
  active_sec: number;
  page_views: number;
  first_path: string;
  last_path: string;
  device: 'phone' | 'tablet' | 'pc';
  account_email: string | null;
  account_role: 'user' | 'salon' | 'admin' | null;
  notifications: number;
  features: number;
};
type UsageEvent = { id: number; visit_id: string; at: string; kind: 'page' | 'feature'; label: string | null; path: string };
type Alert = { id: number; at: string; text: string };
type Account = {
  key: string;
  email: string | null;
  role: Visit['account_role'];
  visitorId: string;
  visits: Visit[];
  sec: number;
  notifications: number;
  last: string;
};
type Range = 'today' | 'week' | 'all';
type View = 'visits' | 'accounts';

const LIMIT = 500;
const DEVICE: Record<Visit['device'], string> = { phone: 'スマートフォン', tablet: 'タブレット', pc: 'パソコン' };
const ROLE: Record<NonNullable<Visit['account_role']>, string> = { user: 'お客様', salon: 'サロン', admin: '運営' };
const dt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const tm = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });

// 秒を「1時間2分」「3分4秒」「5秒」に
export function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  if (h > 0) return `${h}時間${m}分`;
  if (m > 0) return `${m}分${r}秒`;
  return `${r}秒`;
}

// ページの道筋から、どの画面か
function screenOf(path: string): string {
  if (path.startsWith('/demo')) return 'デモの舞台';
  if (path.startsWith('/salon')) return 'サロン';
  if (path.startsWith('/admin')) return '運営';
  return 'お客様';
}

// 期間の始まり（日本時間の今日の0時・7日前の0時）
function rangeStart(range: Range): string | null {
  if (range === 'all') return null;
  const jst = new Date(Date.now() + 9 * 3600e3);
  const day = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 3600e3;
  return new Date(range === 'today' ? day : day - 6 * 86_400_000).toISOString();
}

// アカウント（ログインしていない訪問はブラウザ）ごとにまとめる。通知の件数はアカウントごとに1回だけ数える
function byAccount(rows: Visit[]): Account[] {
  const map = new Map<string, Account>();
  for (const v of rows) {
    const key = v.account_email ? `mail:${v.account_email.toLowerCase()}` : `browser:${v.visitor_id}`;
    const a = map.get(key);
    if (a) {
      a.visits.push(v);
      a.sec += v.active_sec;
      if (v.last_seen_at > a.last) a.last = v.last_seen_at;
    } else {
      map.set(key, { key, email: v.account_email, role: v.account_role, visitorId: v.visitor_id, visits: [v], sec: v.active_sec, notifications: v.notifications, last: v.last_seen_at });
    }
  }
  return [...map.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
}

// 訪問者の呼び方（ログインしていればメールアドレス）
function whoOf(v: Visit | undefined): string {
  if (!v) return '訪問者';
  return v.account_email ?? `ログインなしの訪問者（ブラウザ ${v.visitor_id.slice(0, 8)}）`;
}

// 出来事の文（知らせの帯・訪問ごとの順の一覧で使う）
function eventText(e: UsageEvent): string {
  return e.kind === 'page' ? `${screenOf(e.path)}のページを開いた（${e.path}）` : `「${e.label}」を使った（${screenOf(e.path)} ${e.path}）`;
}

function AccountCell({ email, role, visitorId }: { email: string | null; role: Visit['account_role']; visitorId: string }) {
  if (!email) {
    return (
      <>
        <span className={s.anon}>ログインなし</span>
        <small className={`${t.line} num`}>ブラウザ {visitorId.slice(0, 8)}</small>
      </>
    );
  }
  return (
    <>
      <span className={`${s.email} break`}>{email}</span>
      {role && <small className={t.line}>{ROLE[role]}のアカウント</small>}
    </>
  );
}

// アカウントごとの、使った機能（多い順に8種類まで）
function FeatureChips({ list }: { list: [string, number][] }) {
  if (list.length === 0) return <span className={s.anon}>なし</span>;
  return (
    <ul className={s.chips}>
      {list.slice(0, 8).map(([label, n]) => (
        <li key={label}>
          {label} <span className="num">×{n}</span>
        </li>
      ))}
      {list.length > 8 && <li className={s.more}>ほか {list.length - 8}種類</li>}
    </ul>
  );
}

export default function UsageLog({ demoMode }: { demoMode: boolean }) {
  const { client, session, ready, signedOut } = useRoleSession('admin');
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [range, setRange] = useState<Range>('all');
  const [view, setView] = useState<View>('visits');
  const [rows, setRows] = useState<Visit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 選んだ訪問（アカウントごとの表示では、そのアカウントの訪問をまとめて選ぶ）
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [confirm, setConfirm] = useState<'picked' | 'all' | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  // その場の知らせ（新しい順。閉じるまで残す。多いときは新しい5件）
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const rowsRef = useRef<Visit[]>([]);

  useEffect(() => {
    if (!client || !session) {
      setIsAdmin(null);
      return;
    }
    client.rpc('is_admin').then(({ data }) => setIsAdmin(data === true));
  }, [client, session]);

  const load = useCallback(async () => {
    if (!client) return;
    const { data, error: e } = await client.rpc('admin_usage_visits', { p_from: rangeStart(range) });
    if (e) {
      setError(toMessage(e));
      return;
    }
    setError(null);
    const list = (data ?? []) as Visit[];
    rowsRef.current = list;
    setRows(list);
    // 使った機能・開いたページ（期間の中の新しい3000件まで）
    let q = client.from('usage_events').select('id,visit_id,at,kind,label,path').order('id', { ascending: false }).limit(3000);
    const from = rangeStart(range);
    if (from) q = q.gte('at', from);
    const ev = await q;
    if (!ev.error) setEvents((ev.data ?? []) as UsageEvent[]);
    // 表示から外れた記録は、選んだものからも外す
    setPicked((prev) => new Set([...prev].filter((id) => list.some((r) => r.id === id))));
  }, [client, range]);

  // 開いている間は30秒ごとにも読み直す（Realtime がつながらないときの備え）
  useEffect(() => {
    if (!isAdmin) return;
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [isAdmin, load]);

  // その場の知らせ：ページを開いた・機能を使ったら、すぐに知らせて読み直す。訪問の更新（利用時間・アカウント）は読み直すだけ
  //   アカウントの結びつけは出来事のすぐあとに届くので、知らせの文は読み直したあとの記録で作る
  useEffect(() => {
    if (!client || !isAdmin) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reloadSoon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(), 250);
    };
    const channel = client
      .channel(`usage-live-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'usage_events' }, (payload) => {
        const e = payload.new as UsageEvent;
        setEvents((list) => (list.some((x) => x.id === e.id) ? list : [e, ...list]));
        reloadSoon();
        setTimeout(() => {
          const v = rowsRef.current.find((r) => r.id === e.visit_id);
          const text = `${whoOf(v)} が${eventText(e)}`;
          setAlerts((list) => [{ id: e.id, at: e.at, text }, ...list.filter((x) => x.id !== e.id)].slice(0, 5));
        }, 600);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usage_visits' }, reloadSoon)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      client.removeChannel(channel);
    };
  }, [client, isAdmin, load]);

  // 訪問ごとの出来事（古い順）
  const eventsByVisit = useMemo(() => {
    const map = new Map<string, UsageEvent[]>();
    for (const e of [...events].reverse()) {
      const list = map.get(e.visit_id);
      if (list) list.push(e);
      else map.set(e.visit_id, [e]);
    }
    return map;
  }, [events]);

  // アカウントごとの、使った機能の種類と回数（多い順）
  function featureCounts(visits: Visit[]): [string, number][] {
    const count = new Map<string, number>();
    for (const v of visits) {
      for (const e of eventsByVisit.get(v.id) ?? []) {
        if (e.kind === 'feature' && e.label) count.set(e.label, (count.get(e.label) ?? 0) + 1);
      }
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]);
  }

  const accounts = useMemo(() => byAccount(rows ?? []), [rows]);

  const totals = useMemo(() => {
    const list = rows ?? [];
    const sec = list.reduce((a, r) => a + r.active_sec, 0);
    const signedIn = accounts.filter((a) => a.email);
    return {
      visits: list.length,
      accounts: signedIn.length,
      notifications: signedIn.reduce((a, x) => a + x.notifications, 0),
      sec,
      avg: list.length ? Math.round(sec / list.length) : 0,
    };
  }, [rows, accounts]);

  const allPicked = !!rows && rows.length > 0 && rows.every((r) => picked.has(r.id));

  function toggle(ids: string[], on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function remove() {
    if (!client || !confirm) return;
    setBusy(true);
    const res =
      confirm === 'all' ? await client.rpc('admin_usage_delete_all') : await client.rpc('admin_usage_delete', { p_ids: [...picked] });
    setBusy(false);
    setConfirm(null);
    if (res.error) {
      setError(toMessage(res.error));
      return;
    }
    setPicked(new Set());
    setDone(`${res.data ?? 0}件の記録を削除しました`);
    setTimeout(() => setDone(null), 5000);
    load();
  }

  if (!client) return <NotConfigured />;

  return (
    <Page width={!session || isAdmin === false ? 'phone' : 'wide'}>
      <AppHeader home="/usage">
        {session && (
          <button onClick={() => logout('admin', '/usage?logged_out=1')}>
            <SignOut size={20} aria-hidden focusable="false" />
            ログアウト
          </button>
        )}
      </AppHeader>

      {ready && !session && (
        <Stack gap={4}>
          <ScreenTitle>利用の記録</ScreenTitle>
          {signedOut && <Notice tone="neutral">ログアウトしました。</Notice>}
          <LoginBox
            client={client}
            title="運営としてログイン"
            demoMode={demoMode}
            demoAccounts={[{ email: 'admin@demo.test', label: '運営（デモ）' }]}
            forgotHref="/forgot?role=admin"
            resendRole={null}
            footer={<Fine center>利用の記録は、運営のアカウントだけが見られます。</Fine>}
          />
        </Stack>
      )}
      {session && isAdmin === null && <Loading rows={3} />}
      {session && isAdmin === false && (
        <ErrorState>
          このアカウント（<span className="break">{session.user.email}</span>）には運営の権限がありません。
        </ErrorState>
      )}

      {session && isAdmin && (
        <Stack gap={4}>
          <div className={s.head}>
            <ScreenTitle>利用の記録</ScreenTitle>
            <Lead>
              デモを開いた人ごとの利用時間（ページが前面に出ていた時間）・使った機能と、ログインしていたアカウントのメールアドレス、そのアカウントに送った通知（メール）の件数です。訪問者がページを開いたり機能を使ったりすると、この画面の上にすぐ知らせが出ます。
            </Lead>
          </div>

          {alerts.length > 0 && (
            <section className={s.alerts} aria-label="訪問の知らせ" data-usage-alerts="">
              {alerts.map((a) => (
                <div key={a.id} className={s.alert} role="status">
                  <BellRinging size={20} weight="duotone" aria-hidden focusable="false" />
                  <p className={s.alertText}>
                    <span className="num">{tm.format(new Date(a.at))}</span> {a.text}
                  </p>
                  <button
                    type="button"
                    className={s.alertClose}
                    aria-label="この知らせを閉じる"
                    onClick={() => setAlerts((list) => list.filter((x) => x.id !== a.id))}
                  >
                    <X size={20} aria-hidden focusable="false" />
                  </button>
                </div>
              ))}
              {alerts.length > 1 && (
                <Button variant="text" size="sm" onClick={() => setAlerts([])}>
                  知らせをすべて閉じる
                </Button>
              )}
            </section>
          )}

          <div className={s.tools}>
            <div className={s.filters}>
              <Segmented
                label="期間"
                value={range}
                onChange={setRange}
                options={[
                  { value: 'today', label: '今日' },
                  { value: 'week', label: '7日間' },
                  { value: 'all', label: 'すべて' },
                ]}
              />
              <Segmented
                label="表示"
                value={view}
                onChange={setView}
                options={[
                  { value: 'visits', label: '訪問ごと' },
                  { value: 'accounts', label: 'アカウントごと' },
                ]}
              />
            </div>
            <Button variant="quiet" size="sm" icon={ArrowClockwise} onClick={load}>
              読み直す
            </Button>
          </div>

          <dl className={s.kpis} aria-label="期間の合計">
            <div className={s.kpi}>
              <dt>訪問</dt>
              <dd className="num">
                {totals.visits}
                <small>件（ログインあり {totals.accounts}人）</small>
              </dd>
            </div>
            <div className={s.kpi}>
              <dt>通知の件数</dt>
              <dd className="num">
                {totals.notifications}
                <small>件</small>
              </dd>
            </div>
            <div className={s.kpi}>
              <dt>利用時間の合計</dt>
              <dd className="num">{fmtDuration(totals.sec)}</dd>
            </div>
            <div className={s.kpi}>
              <dt>1回の訪問の平均</dt>
              <dd className="num">{fmtDuration(totals.avg)}</dd>
            </div>
          </dl>

          {error && <ErrorState onRetry={load}>{error}</ErrorState>}

          <Panel flush>
            <div className={s.bar}>
              <span className={s.count} aria-live="polite">
                {picked.size > 0 ? `${picked.size}件を選択中` : '削除する記録を選んでください'}
              </span>
              <div className={s.barActions}>
                <Button variant="danger" size="sm" icon={Trash} disabled={picked.size === 0} onClick={() => setConfirm('picked')}>
                  選んだ記録を削除
                </Button>
                <Button variant="dangerSolid" size="sm" icon={Trash} disabled={!rows || rows.length === 0} onClick={() => setConfirm('all')}>
                  すべて削除
                </Button>
              </div>
            </div>

            {!rows && !error && (
              <div className={s.pad}>
                <Loading rows={3} />
              </div>
            )}
            {rows && rows.length === 0 && <Empty icon={ChartLine}>この期間の記録はありません。</Empty>}

            {rows && rows.length > 0 && view === 'visits' && (
              <div className={t.wrap}>
                <table className={t.table}>
                  <thead>
                    <tr>
                      <th scope="col" className={s.pick}>
                        <input
                          type="checkbox"
                          aria-label="表示中の記録をすべて選ぶ"
                          checked={allPicked}
                          onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                        />
                      </th>
                      <th scope="col">訪問の日時</th>
                      <th scope="col">アカウント</th>
                      <th scope="col">利用時間</th>
                      <th scope="col">通知</th>
                      <th scope="col">使った機能</th>
                      <th scope="col">見たページ</th>
                      <th scope="col">端末</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={s.row} data-picked={picked.has(r.id) ? 'true' : undefined}>
                        <td className={s.pick}>
                          <input
                            type="checkbox"
                            aria-label={`${dt.format(new Date(r.started_at))} の記録を選ぶ`}
                            checked={picked.has(r.id)}
                            onChange={(e) => toggle([r.id], e.target.checked)}
                          />
                        </td>
                        <td className={`num ${t.nowrap}`}>
                          {dt.format(new Date(r.started_at))}
                          <small className={t.line}>最後の操作 {tm.format(new Date(r.last_seen_at))}</small>
                        </td>
                        <td>
                          <AccountCell email={r.account_email} role={r.account_role} visitorId={r.visitor_id} />
                        </td>
                        <td className={`num ${t.figure}`}>{fmtDuration(r.active_sec)}</td>
                        <td className={`num ${t.nowrap}`}>{r.account_email ? `${r.notifications}件` : '—'}</td>
                        <td className={s.features}>
                          {(eventsByVisit.get(r.id) ?? []).length === 0 ? (
                            <span className="num">{r.features}件</span>
                          ) : (
                            <details>
                              <summary className="num">{r.features}件・順に見る</summary>
                              <ol className={s.timeline}>
                                {(eventsByVisit.get(r.id) ?? []).map((e) => (
                                  <li key={e.id} data-kind={e.kind}>
                                    <span className="num">{tm.format(new Date(e.at))}</span> {eventText(e)}
                                  </li>
                                ))}
                              </ol>
                            </details>
                          )}
                        </td>
                        <td>
                          <span className="num">{r.page_views}ページ</span>
                          <small className={`${t.line} ${s.path}`}>
                            {screenOf(r.first_path)}（{r.first_path}）
                            {r.last_path !== r.first_path && ` → ${r.last_path}`}
                          </small>
                        </td>
                        <td className={t.nowrap}>{DEVICE[r.device]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {rows && rows.length > 0 && view === 'accounts' && (
              <div className={t.wrap}>
                <table className={t.table}>
                  <thead>
                    <tr>
                      <th scope="col" className={s.pick}>
                        <input
                          type="checkbox"
                          aria-label="表示中のアカウントをすべて選ぶ"
                          checked={allPicked}
                          onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                        />
                      </th>
                      <th scope="col">アカウント</th>
                      <th scope="col">訪問</th>
                      <th scope="col">利用時間の合計</th>
                      <th scope="col">通知</th>
                      <th scope="col">使った機能（回数）</th>
                      <th scope="col">最後の訪問</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((a) => {
                      const ids = a.visits.map((v) => v.id);
                      const on = ids.every((id) => picked.has(id));
                      return (
                        <tr key={a.key} className={s.row} data-picked={on ? 'true' : undefined}>
                          <td className={s.pick}>
                            <input
                              type="checkbox"
                              aria-label={`${a.email ?? `ブラウザ ${a.visitorId.slice(0, 8)}`} の記録をすべて選ぶ`}
                              checked={on}
                              onChange={(e) => toggle(ids, e.target.checked)}
                            />
                          </td>
                          <td>
                            <AccountCell email={a.email} role={a.role} visitorId={a.visitorId} />
                          </td>
                          <td className={`num ${t.nowrap}`}>{a.visits.length}回</td>
                          <td className={`num ${t.figure}`}>{fmtDuration(a.sec)}</td>
                          <td className={`num ${t.nowrap}`}>{a.email ? `${a.notifications}件` : '—'}</td>
                          <td className={s.features}>
                            <FeatureChips list={featureCounts(a.visits)} />
                          </td>
                          <td className={`num ${t.nowrap}`}>{dt.format(new Date(a.last))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Fine>
            通知の件数は、そのメールアドレスに宛てて送った（またはシミュレーション送信として記録した）メールの数です。
            {rows && rows.length >= LIMIT && ` 新しい順に ${LIMIT}件まで表示しています。`}
          </Fine>

          {confirm && (
            <Sheet label={confirm === 'all' ? 'すべての記録を削除しますか' : '選んだ記録を削除しますか'} narrow onClose={() => !busy && setConfirm(null)}>
              <Stack gap={4}>
                <p className={s.confirmText}>
                  {confirm === 'all' ? '利用の記録をすべて（表示している期間に関係なく）削除します。' : `選んだ ${picked.size}件の記録を削除します。`}
                  削除した記録は元に戻せません（送った通知そのものは消えません）。
                </p>
                <div className={s.choice}>
                  <Button variant="quiet" size="md" disabled={busy} onClick={() => setConfirm(null)}>
                    やめる
                  </Button>
                  <Button variant="dangerSolid" size="md" icon={Trash} disabled={busy} onClick={remove}>
                    {confirm === 'all' ? 'すべて削除する' : `${picked.size}件を削除する`}
                  </Button>
                </div>
              </Stack>
            </Sheet>
          )}

          {done && (
            <Toast tone="success" position="bottom" icon={Trash}>
              {done}
            </Toast>
          )}
        </Stack>
      )}
    </Page>
  );
}
