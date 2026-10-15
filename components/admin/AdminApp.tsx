'use client';

// 運営の画面：実証の数字・掲載希望・全サロンの今日・通知と操作の記録・終了処理の試し実行

import { useEffect, useState } from 'react';
import AppHeader from '@/components/AppHeader';
import LoginBox from '@/components/LoginBox';
import { ErrorState, Loading, NotConfigured } from '@/components/States';
import { useRoleSession } from '@/lib/supabase';
import { useDispatchTicker } from '@/lib/dispatch-client';
import Applications from './Applications';
import Dashboard from './Dashboard';
import Logs from './Logs';
import Overview from './Overview';
import Salons from './Salons';
import TrialEnd from './TrialEnd';

const TABS = [
  { key: 'dashboard', label: '実証の数字' },
  { key: 'overview', label: '今日の状況' },
  { key: 'salons', label: 'サロン' },
  { key: 'applications', label: '掲載希望' },
  { key: 'logs', label: '通知・記録' },
  { key: 'trial', label: '終了処理' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function AdminApp({ demoMode }: { demoMode: boolean }) {
  const { client, session, ready } = useRoleSession('admin');
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tab, setTab] = useState<TabKey>('dashboard');

  useDispatchTicker(client, isAdmin === true);

  useEffect(() => {
    if (!client || !session) {
      setIsAdmin(null);
      return;
    }
    client.rpc('is_admin').then(({ data }) => setIsAdmin(data === true));
  }, [client, session]);

  if (!client) return <NotConfigured />;

  return (
    <main className="app app-wide">
      <AppHeader role="運営" home="/admin">
        {session && <button onClick={() => client.auth.signOut()}>ログアウト</button>}
      </AppHeader>

      {ready && !session && (
        <LoginBox
          client={client}
          title="運営としてログイン"
          demoMode={demoMode}
          demoAccounts={[{ email: 'admin@demo.test', label: '運営（デモ）' }]}
          forgotHref="/forgot?role=admin"
        />
      )}
      {session && isAdmin === null && <Loading rows={3} />}
      {session && isAdmin === false && <ErrorState>このアカウントには運営の権限がありません。</ErrorState>}

      {session && isAdmin && (
        <>
          <nav className="admin-tabs" aria-label="運営のメニュー">
            {TABS.map((t) => (
              <button key={t.key} aria-current={tab === t.key ? 'page' : undefined} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </nav>
          {tab === 'dashboard' && <Dashboard client={client} demoMode={demoMode} />}
          {tab === 'overview' && <Overview client={client} />}
          {tab === 'salons' && <Salons client={client} />}
          {tab === 'applications' && <Applications client={client} />}
          {tab === 'logs' && <Logs client={client} />}
          {tab === 'trial' && <TrialEnd client={client} />}
        </>
      )}
    </main>
  );
}
