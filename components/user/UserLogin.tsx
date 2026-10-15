'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import LoginBox from '@/components/LoginBox';
import { Loading, NotConfigured } from '@/components/States';
import { useRoleSession } from '@/lib/supabase';

const DEMO_ACCOUNTS = [
  { email: 'user1@demo.test', label: '山田 花子', sub: '女性・20代' },
  { email: 'user2@demo.test', label: '鈴木 一郎', sub: '男性・30代' },
  { email: 'user3@demo.test', label: '佐藤 美咲', sub: '女性・18〜19歳' },
];

export default function UserLogin({ next, verified, demoMode }: { next: string; verified: boolean; demoMode: boolean }) {
  const router = useRouter();
  const { client, session, ready } = useRoleSession('user');
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  useEffect(() => {
    if (session) router.replace(target);
  }, [session, router, target]);

  if (!client) return <NotConfigured />;

  return (
    <main className="app">
      <AppHeader role="利用者" />
      {verified && <p className="notice notice-ok">メールアドレスを確認しました。ログインしてください。</p>}
      {!ready || session ? (
        <Loading rows={2} />
      ) : (
        <LoginBox
          client={client}
          title="ログイン"
          demoMode={demoMode}
          demoAccounts={DEMO_ACCOUNTS}
          footer={
            <p className="card-sub" style={{ marginTop: 16, textAlign: 'center' }}>
              はじめての方は <Link href="/signup">新規登録</Link>
            </p>
          }
        />
      )}
    </main>
  );
}
