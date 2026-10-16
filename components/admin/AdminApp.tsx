'use client';

// 運営の画面：実証の数字・掲載希望・全サロンの今日・サロン・通知と操作の記録・終了処理の試し実行
// 運営への知らせ：
//   ・新しい掲載希望：届いたらその場で知らせ、見ていない間に届いたものはログインした最初の画面で知らせる
//   ・新しく加わったサロン：承認したお店が初期設定を終えてサロンの画面で使い始めたら、同じように知らせる
//     （「サロン」のタブに件数が出て、タブを開くと確かめたことになる）

import { useCallback, useEffect, useState } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import AppHeader, { RoleIntro } from '@/components/AppHeader';
import LoginBox from '@/components/LoginBox';
import Sheet from '@/components/Sheet';
import { ErrorState, Loading, NotConfigured } from '@/components/States';
import { useRoleSession } from '@/lib/supabase';
import { useDispatchTicker } from '@/lib/dispatch-client';
import SocialButtons, { AuthErrorNotice, LoggedOutNotice, hasAnyProvider } from '@/components/auth/SocialButtons';
import { logout } from '@/lib/logout';
import type { Providers } from '@/lib/oauth-shared';
import Button from '@/components/ui/Button';
import { Fine, Page } from '@/components/ui/Layout';
import { SectionHead, SubText } from '@/components/ui/Surface';
import Toast from '@/components/ui/Toast';
import { Bell, CalendarCheck, ChartBar, ClipboardText, Flag, SignOut, Sparkle, Storefront, UsersThree } from '@/components/ui/icons';
import Applications from './Applications';
import Dashboard from './Dashboard';
import Logs from './Logs';
import Members from './Members';
import Overview from './Overview';
import Salons from './Salons';
import TrialEnd from './TrialEnd';
import s from './AdminApp.module.css';

const TABS = [
  { key: 'dashboard', label: '実証の数字' },
  { key: 'overview', label: '今日の状況' },
  { key: 'salons', label: 'サロン' },
  { key: 'applications', label: '掲載希望' },
  { key: 'logs', label: '通知・記録' },
  { key: 'members', label: '運営メンバー' },
  { key: 'trial', label: '終了処理' },
] as const;
type TabKey = (typeof TABS)[number]['key'];
// タブのアイコン（ふだんは regular、開いているタブは fill）
const TAB_ICON: Record<TabKey, PhosphorIcon> = {
  dashboard: ChartBar,
  overview: CalendarCheck,
  salons: Storefront,
  applications: ClipboardText,
  logs: Bell,
  members: UsersThree,
  trial: Flag,
};
type Pending = { id: string; salon_name: string; area_text: string; created_at: string };
type Joined = { id: number; salon_id: string | null; salon_name: string; at: string };

const dt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// この端末で、最後に掲載希望の一覧を開いた日時（運営ごと）
function seenKey(uid: string) {
  return `admin-applications-seen-${uid}`;
}
function readSeen(uid: string): number {
  try {
    return Number(localStorage.getItem(seenKey(uid)) ?? 0);
  } catch {
    return 0;
  }
}
function writeSeen(uid: string) {
  try {
    localStorage.setItem(seenKey(uid), String(Date.now()));
  } catch {
    // 保存できなくても動く
  }
}

// この端末で、最後に確かめた「新しく加わったサロン」のお知らせの番号（運営ごと）
function joinedKey(uid: string) {
  return `admin-joined-seen-${uid}`;
}
function readJoinedSeen(uid: string): number {
  try {
    return Number(localStorage.getItem(joinedKey(uid)) ?? 0);
  } catch {
    return 0;
  }
}
function writeJoinedSeen(uid: string, id: number) {
  try {
    if (id > readJoinedSeen(uid)) localStorage.setItem(joinedKey(uid), String(id));
  } catch {
    // 保存できなくても動く
  }
}

export default function AdminApp({
  demoMode,
  providers,
  authError,
  linked,
  initialTab,
  loggedOut = false,
}: {
  demoMode: boolean;
  providers: Providers;
  authError?: string | null;
  linked?: string | null;
  initialTab?: string | null;
  loggedOut?: boolean;
}) {
  const { client, session, ready, signedOut } = useRoleSession('admin');
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tab, setTab] = useState<TabKey>(TABS.some((t) => t.key === initialTab) ? (initialTab as TabKey) : 'dashboard');
  const [pending, setPending] = useState<Pending[]>([]);
  // ログインした最初の画面で知らせる、見ていない間に届いた掲載希望と、新しく加わったサロン
  const [unseen, setUnseen] = useState<{ apps: Pending[]; joined: Joined[] } | null>(null);
  const [toast, setToast] = useState<Pending | null>(null);
  // まだ確かめていない「新しく加わったサロン」（「サロン」のタブを開くまで、件数を出す）
  const [joined, setJoined] = useState<Joined[]>([]);
  const [joinToast, setJoinToast] = useState<Joined | null>(null);
  // サロンの一覧で「新しく加わりました」と示すお店
  const [freshSalons, setFreshSalons] = useState<string[]>([]);

  useDispatchTicker(client, isAdmin === true);

  // 開いている間にログアウトした（別のタブ・ログインの期限切れ）ときは、前の運営の画面の状態を残さない
  useEffect(() => {
    if (!signedOut || session) return;
    setTab('dashboard');
    setPending([]);
    setUnseen(null);
    setToast(null);
    setJoined([]);
    setJoinToast(null);
    setFreshSalons([]);
  }, [signedOut, session]);

  useEffect(() => {
    if (!client || !session) {
      setIsAdmin(null);
      return;
    }
    client.rpc('is_admin').then(({ data }) => setIsAdmin(data === true));
  }, [client, session]);

  const loadPending = useCallback(async () => {
    if (!client) return [];
    const { data } = await client
      .from('salon_applications')
      .select('id,salon_name,area_text,created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    const rows = (data ?? []) as Pending[];
    setPending(rows);
    return rows;
  }, [client]);

  // まだ確かめていない「新しく加わったサロン」（この端末で初めて開いたときは、直近7日の分だけ）
  const loadJoined = useCallback(async () => {
    if (!client || !session) return [];
    const seen = readJoinedSeen(session.user.id);
    let query = client.from('admin_notices').select('id,salon_id,salon_name,at').eq('kind', 'salon_joined').gt('id', seen);
    if (seen === 0) query = query.gte('at', new Date(Date.now() - 7 * 86_400_000).toISOString());
    const { data } = await query.order('id', { ascending: false }).limit(20);
    const rows = (data ?? []) as Joined[];
    setJoined(rows);
    return rows;
  }, [client, session]);

  // ログインした最初の画面：見ていない間に届いた掲載希望・新しく加わったサロンがあれば知らせる
  useEffect(() => {
    if (!isAdmin || !session) return;
    Promise.all([loadPending(), loadJoined()]).then(([rows, joins]) => {
      const seen = readSeen(session.user.id);
      const fresh = rows.filter((r) => new Date(r.created_at).getTime() > seen);
      if (fresh.length > 0 || joins.length > 0) setUnseen({ apps: fresh, joined: joins });
    });
  }, [isAdmin, session, loadPending, loadJoined]);

  // ログイン中に届いた掲載希望・新しく加わったサロンは、その場で知らせる
  useEffect(() => {
    if (!client || !isAdmin) return;
    const channel = client
      .channel(`admin-notices-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'salon_applications' }, (payload) => {
        loadPending();
        if (payload.eventType === 'INSERT') {
          const row = payload.new as Pending;
          setToast(row);
          setTimeout(() => setToast((t) => (t?.id === row.id ? null : t)), 8000);
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_notices' }, (payload) => {
        const row = payload.new as Joined & { kind: string };
        if (row.kind !== 'salon_joined') return;
        setJoined((list) => (list.some((x) => x.id === row.id) ? list : [row, ...list]));
        setJoinToast(row);
        setTimeout(() => setJoinToast((t) => (t?.id === row.id ? null : t)), 12000);
      })
      .subscribe((status) => {
        // つながり直したときは、その間に加わったサロンを読み直す
        if (status === 'SUBSCRIBED') loadJoined();
      });
    return () => {
      client.removeChannel(channel);
    };
  }, [client, isAdmin, loadPending, loadJoined]);

  function openApplications() {
    setTab('applications');
    setUnseen(null);
    setToast(null);
    if (session) writeSeen(session.user.id);
  }

  // 「サロン」のタブを開くと、新しく加わったサロンを確かめたことにする（一覧では、そのお店を目立たせる）
  function openSalons() {
    setTab('salons');
    setUnseen(null);
    setJoinToast(null);
    if (joined.length > 0) {
      setFreshSalons(joined.map((j) => j.salon_id).filter((x): x is string => !!x));
      if (session) writeJoinedSeen(session.user.id, Math.max(...joined.map((j) => j.id)));
      setJoined([]);
    }
  }

  if (!client) return <NotConfigured />;

  return (
    // ログインの画面は、利用者の画面と同じスマートフォンの幅にそろえる（運営の画面だけ広く使う）
    <Page width={!session || isAdmin === false ? 'phone' : 'wide'}>
      <AppHeader role="運営" home="/admin">
        {session && (
          <button onClick={() => logout('admin')}>
            <SignOut size={20} aria-hidden focusable="false" />
            ログアウト
          </button>
        )}
      </AppHeader>

      {ready && !session && (
        <>
          <RoleIntro kind="admin" />
          {(loggedOut || signedOut) && <LoggedOutNotice />}
          <AuthErrorNotice code={authError} />
          <LoginBox
            client={client}
            title="運営としてログイン"
            demoMode={demoMode}
            demoAccounts={[{ email: 'admin@demo.test', label: '運営（デモ）' }]}
            forgotHref="/forgot?role=admin"
            resendRole={null}
            social={
              hasAnyProvider(providers) ? (
                <SocialButtons providers={providers} role="admin" mode="login" next={initialTab === 'members' ? '/admin?tab=members' : '/admin'} back="/admin" />
              ) : null
            }
            footer={
              <div className={s.loginFoot}>
                <Fine center>運営メンバーの登録は、既存の運営メンバーからの招待で行います。</Fine>
              </div>
            }
          />
        </>
      )}
      {session && isAdmin === null && <Loading rows={3} />}
      {session && isAdmin === false && (
        <ErrorState>
          このアカウント（<span className="break">{session.user.email}</span>）には運営の権限がありません。運営メンバーに招待を依頼してください。
          <Button variant="text" size="sm" icon={SignOut} onClick={() => logout('admin')}>
            別のアカウントでログイン
          </Button>
        </ErrorState>
      )}

      {session && isAdmin && (
        <>
          {pending.length > 0 && tab !== 'applications' && (
            <button className={s.pendingBar} onClick={openApplications}>
              <ClipboardText size={24} weight="duotone" aria-hidden focusable="false" />
              <span className={s.pendingText}>
                承認を待っている掲載希望が <span className={`num ${s.pendingCount}`}>{pending.length}件</span> あります
              </span>
              <span className={s.pendingGo}>承認の画面へ →</span>
            </button>
          )}
          <nav className={s.tabs} aria-label="運営のメニュー" data-admin-tabs="">
            {TABS.map((t) => {
              const current = tab === t.key;
              const Glyph = TAB_ICON[t.key];
              return (
                <button
                  key={t.key}
                  className={s.tab}
                  aria-current={current ? 'page' : undefined}
                  onClick={() => (t.key === 'applications' ? openApplications() : t.key === 'salons' ? openSalons() : setTab(t.key))}
                >
                  <Glyph size={20} weight={current ? 'fill' : 'regular'} aria-hidden focusable="false" />
                  {t.label}
                  {t.key === 'applications' && pending.length > 0 && (
                    <span className={`num ${s.badge} ${s.badgePending}`} data-tab-badge="pending" aria-label={`承認待ち ${pending.length}件`}>
                      {pending.length}
                    </span>
                  )}
                  {t.key === 'salons' && joined.length > 0 && (
                    <span className={`num ${s.badge} ${s.badgeNew}`} data-tab-badge="joined" aria-label={`新しく加わったサロン ${joined.length}件`}>
                      {joined.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          <div className={s.body}>
            {tab === 'dashboard' && <Dashboard client={client} demoMode={demoMode} />}
            {tab === 'overview' && <Overview client={client} />}
            {tab === 'salons' && <Salons client={client} fresh={freshSalons} />}
            {tab === 'applications' && <Applications client={client} onChanged={loadPending} />}
            {tab === 'logs' && <Logs client={client} />}
            {tab === 'members' && <Members client={client} providers={providers} linked={linked} authError={authError} />}
            {tab === 'trial' && <TrialEnd client={client} />}
          </div>

          {unseen && (
            <Sheet label={unseen.apps.length > 0 ? '新しい掲載希望が届いています' : '新しいサロンが加わりました'} narrow onClose={() => setUnseen(null)}>
              <p className={s.kicker}>
                <Bell size={20} weight="duotone" aria-hidden focusable="false" />
                お知らせ
              </p>
              {unseen.apps.length > 0 && (
                <section className={s.group}>
                  <SectionHead icon={ClipboardText} title={`新しい掲載希望が ${unseen.apps.length}件 届いています`} as="p" />
                  <SubText>前回この画面を開いてから届いた申込です。内容を確かめて、承認するか見送ってください。</SubText>
                  <ul className={s.items}>
                    {unseen.apps.slice(0, 5).map((p) => (
                      <li key={p.id}>
                        <strong>{p.salon_name}</strong>
                        <span className="num">
                          {p.area_text} ・ {dt.format(new Date(p.created_at))}
                        </span>
                      </li>
                    ))}
                    {unseen.apps.length > 5 && <li className={s.more}>ほか {unseen.apps.length - 5}件</li>}
                  </ul>
                </section>
              )}
              {unseen.joined.length > 0 && (
                <section className={s.group}>
                  <SectionHead icon={Sparkle} title={`新しいサロンが ${unseen.joined.length}件 加わりました`} as="p" />
                  <SubText>承認したお店が初期設定（メニュー・担当・お店の場所）を終えて、サロンの画面で使い始めました。</SubText>
                  <ul className={s.items}>
                    {unseen.joined.slice(0, 5).map((j) => (
                      <li key={j.id}>
                        <strong>{j.salon_name}</strong>
                        <span className="num">{dt.format(new Date(j.at))} に設定を完了</span>
                      </li>
                    ))}
                    {unseen.joined.length > 5 && <li className={s.more}>ほか {unseen.joined.length - 5}件</li>}
                  </ul>
                  {unseen.apps.length > 0 && (
                    <div className={s.also}>
                      <Button variant="text" size="sm" icon={Storefront} onClick={openSalons}>
                        加わったサロンを一覧で見る →
                      </Button>
                    </div>
                  )}
                </section>
              )}
              <div className={s.choice}>
                <Button variant="quiet" size="md" onClick={() => setUnseen(null)}>
                  あとで
                </Button>
                {unseen.apps.length > 0 ? (
                  <Button variant="primary" size="md" onClick={openApplications}>
                    承認の画面を開く
                  </Button>
                ) : (
                  <Button variant="primary" size="md" onClick={openSalons}>
                    サロンの一覧を開く
                  </Button>
                )}
              </div>
            </Sheet>
          )}

          {toast && (
            <div data-toast="application">
              <Toast
                tone="action"
                position="top"
                icon={ClipboardText}
                action={
                  <Button variant="onStrong" size="sm" onClick={openApplications}>
                    開く
                  </Button>
                }
              >
                新しい掲載希望が届きました：{toast.salon_name}
              </Toast>
            </div>
          )}

          {joinToast && (
            <div data-toast="joined">
              <Toast
                tone="success"
                position="bottom"
                icon={Storefront}
                action={
                  <Button variant="onStrong" size="sm" onClick={openSalons}>
                    見る
                  </Button>
                }
              >
                <strong>新しいサロンが加わりました：{joinToast.salon_name}</strong>
                <small>初期設定を終えて、サロンの画面で使い始めました</small>
              </Toast>
            </div>
          )}
        </>
      )}
    </Page>
  );
}
