'use client';

// 運営の画面：実証の数字・掲載希望・全サロンの今日・サロン・通知と操作の記録・終了処理の試し実行
// 運営が見ていない間に届いた掲載希望は、ログインした最初の画面で知らせ、承認の画面へ案内する

import { useCallback, useEffect, useState } from 'react';
import AppHeader, { RoleIntro } from '@/components/AppHeader';
import LoginBox from '@/components/LoginBox';
import Sheet from '@/components/Sheet';
import { ErrorState, Loading, NotConfigured } from '@/components/States';
import { useRoleSession } from '@/lib/supabase';
import { useDispatchTicker } from '@/lib/dispatch-client';
import SocialButtons, { AuthErrorNotice, LoggedOutNotice, hasAnyProvider } from '@/components/auth/SocialButtons';
import { logout } from '@/lib/logout';
import type { Providers } from '@/lib/oauth-shared';
import Applications from './Applications';
import Dashboard from './Dashboard';
import Logs from './Logs';
import Members from './Members';
import Overview from './Overview';
import Salons from './Salons';
import TrialEnd from './TrialEnd';

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
type Pending = { id: string; salon_name: string; area_text: string; created_at: string };

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
  const [unseen, setUnseen] = useState<Pending[] | null>(null);
  const [toast, setToast] = useState<Pending | null>(null);

  useDispatchTicker(client, isAdmin === true);

  // 開いている間にログアウトした（別のタブ・ログインの期限切れ）ときは、前の運営の画面の状態を残さない
  useEffect(() => {
    if (!signedOut || session) return;
    setTab('dashboard');
    setPending([]);
    setUnseen(null);
    setToast(null);
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

  // ログインした最初の画面：見ていない間に届いた掲載希望があれば知らせる
  useEffect(() => {
    if (!isAdmin || !session) return;
    loadPending().then((rows) => {
      const seen = readSeen(session.user.id);
      const fresh = rows.filter((r) => new Date(r.created_at).getTime() > seen);
      if (fresh.length > 0) setUnseen(fresh);
    });
  }, [isAdmin, session, loadPending]);

  // ログイン中に届いた掲載希望は、その場で知らせる
  useEffect(() => {
    if (!client || !isAdmin) return;
    const channel = client
      .channel('admin-pending-applications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'salon_applications' }, (payload) => {
        loadPending();
        if (payload.eventType === 'INSERT') {
          const row = payload.new as Pending;
          setToast(row);
          setTimeout(() => setToast((t) => (t?.id === row.id ? null : t)), 8000);
        }
      })
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [client, isAdmin, loadPending]);

  function openApplications() {
    setTab('applications');
    setUnseen(null);
    setToast(null);
    if (session) writeSeen(session.user.id);
  }

  if (!client) return <NotConfigured />;

  return (
    // ログインの画面は、利用者の画面と同じスマートフォンの幅にそろえる（運営の画面だけ広く使う）
    <main className={!session || isAdmin === false ? 'app' : 'app app-wide'}>
      <AppHeader role="運営" home="/admin">
        {session && <button onClick={() => logout('admin')}>ログアウト</button>}
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
            footer={<p className="fine-print" style={{ textAlign: 'center', marginTop: 14 }}>運営メンバーの登録は、既存の運営メンバーからの招待で行います。</p>}
          />
        </>
      )}
      {session && isAdmin === null && <Loading rows={3} />}
      {session && isAdmin === false && (
        <ErrorState>
          このアカウント（{session.user.email}）には運営の権限がありません。運営メンバーに招待を依頼してください。
          <button className="btn btn-text" onClick={() => logout('admin')}>
            別のアカウントでログイン
          </button>
        </ErrorState>
      )}

      {session && isAdmin && (
        <>
          {pending.length > 0 && tab !== 'applications' && (
            <button className="pending-bar" onClick={openApplications}>
              <span className="pending-dot" aria-hidden />
              承認を待っている掲載希望が {pending.length}件 あります
              <span className="pending-go">承認の画面へ →</span>
            </button>
          )}
          <nav className="admin-tabs" aria-label="運営のメニュー">
            {TABS.map((t) => (
              <button
                key={t.key}
                aria-current={tab === t.key ? 'page' : undefined}
                onClick={() => (t.key === 'applications' ? openApplications() : setTab(t.key))}
              >
                {t.label}
                {t.key === 'applications' && pending.length > 0 && (
                  <span className="tab-badge num" aria-label={`承認待ち ${pending.length}件`}>
                    {pending.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
          {tab === 'dashboard' && <Dashboard client={client} demoMode={demoMode} />}
          {tab === 'overview' && <Overview client={client} />}
          {tab === 'salons' && <Salons client={client} />}
          {tab === 'applications' && <Applications client={client} onChanged={loadPending} />}
          {tab === 'logs' && <Logs client={client} />}
          {tab === 'members' && <Members client={client} providers={providers} linked={linked} authError={authError} />}
          {tab === 'trial' && <TrialEnd client={client} />}

          {unseen && (
            <Sheet label="新しい掲載希望が届いています" narrow onClose={() => setUnseen(null)}>
              <p className="welcome-kicker">お知らせ</p>
              <p className="card-title">新しい掲載希望が {unseen.length}件 届いています</p>
              <p className="card-sub">前回この画面を開いてから届いた申込です。内容を確かめて、承認するか見送ってください。</p>
              <ul className="pending-list">
                {unseen.slice(0, 5).map((p) => (
                  <li key={p.id}>
                    <strong>{p.salon_name}</strong>
                    <span className="num">
                      {p.area_text} ・ {dt.format(new Date(p.created_at))}
                    </span>
                  </li>
                ))}
                {unseen.length > 5 && <li className="muted">ほか {unseen.length - 5}件</li>}
              </ul>
              <div className="action-pair">
                <button className="btn btn-quiet" onClick={() => setUnseen(null)}>
                  あとで
                </button>
                <button className="btn btn-primary" onClick={openApplications}>
                  承認の画面を開く
                </button>
              </div>
            </Sheet>
          )}

          {toast && (
            <div className="toast toast-top toast-accent toast-action" role="status">
              <span>新しい掲載希望が届きました：{toast.salon_name}</span>
              <button className="btn btn-sm toast-btn" onClick={openApplications}>
                開く
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
