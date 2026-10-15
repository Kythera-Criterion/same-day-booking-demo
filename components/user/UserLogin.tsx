'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader, { RoleIntro } from '@/components/AppHeader';
import LoginBox from '@/components/LoginBox';
import { Loading, NotConfigured } from '@/components/States';
import SocialButtons, { AuthErrorNotice, LoggedOutNotice, hasAnyProvider } from '@/components/auth/SocialButtons';
import { useRoleSession } from '@/lib/supabase';
import { safePath, type Providers } from '@/lib/oauth-shared';

const DEMO_ACCOUNTS = [
  { email: 'user1@demo.test', label: '山田 花子', sub: '女性・20代' },
  { email: 'user2@demo.test', label: '鈴木 一郎', sub: '男性・30代' },
  { email: 'user3@demo.test', label: '佐藤 美咲', sub: '女性・18〜19歳' },
];

export default function UserLogin({
  next,
  verified,
  demoMode,
  providers,
  authError,
  loggedOut = false,
}: {
  next: string;
  verified: boolean;
  demoMode: boolean;
  providers: Providers;
  authError?: string | null;
  loggedOut?: boolean;
}) {
  const router = useRouter();
  const { client, session, ready } = useRoleSession('user');
  const target = safePath(next, '/');

  useEffect(() => {
    if (session) router.replace(target);
  }, [session, router, target]);

  if (!client) return <NotConfigured />;
  const back = `/login${target !== '/' ? `?next=${encodeURIComponent(target)}` : ''}`;

  return (
    <main className="app">
      <AppHeader role="利用者" />
      <RoleIntro kind="user" />
      {verified &&<p className="notice notice-ok">メールアドレスを確認しました。ログインしてください。</p>}
      {loggedOut && !session && <LoggedOutNotice />}
      <AuthErrorNotice code={authError} />
      {!ready || session ? (
        <Loading rows={2} />
      ) : (
        <LoginBox
          client={client}
          title="ログイン"
          demoMode={demoMode}
          demoAccounts={DEMO_ACCOUNTS}
          social={hasAnyProvider(providers) ? <SocialButtons providers={providers} role="user" mode="login" next={target} back={back} /> : null}
          footer={
            <div className="signup-cta">
              <p>はじめての方</p>
              <Link className="btn btn-secondary btn-block" href={`/signup${target !== '/' ? `?next=${encodeURIComponent(target)}` : ''}`}>
                新規登録（無料）
              </Link>
            </div>
          }
        />
      )}
    </main>
  );
}
