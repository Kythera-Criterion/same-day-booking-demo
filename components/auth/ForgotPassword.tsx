'use client';

// パスワードを忘れたとき：登録したメールアドレスに、再設定のリンクを送る。
// 登録の有無が他人に分からないよう、送れたかどうかに関わらず同じ案内を出す

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import AppHeader from '@/components/AppHeader';
import { NotConfigured } from '@/components/States';
import { useRoleSession } from '@/lib/supabase';

const BACK: Record<string, { href: string; label: string }> = {
  user: { href: '/login', label: '利用者のログインへ戻る' },
  salon: { href: '/salon', label: 'サロンのログインへ戻る' },
  admin: { href: '/admin', label: '運営のログインへ戻る' },
};

export default function ForgotPassword({ role }: { role: string }) {
  const { client } = useRoleSession('user');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const back = BACK[role] ?? BACK.user;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!client) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError('メールアドレスの形で入力してください（例：name@example.com）。');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: e2 } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset?role=${encodeURIComponent(role)}`,
    });
    setBusy(false);
    if (e2 && e2.message.includes('rate limit')) {
      setError('送信が混み合っています。少し時間をおいてお試しください。');
      return;
    }
    setSent(true);
  }

  if (!client) return <NotConfigured />;

  return (
    <main className="app">
      <AppHeader />
      <h1 className="screen-title">パスワードの再設定</h1>
      {sent ? (
        <section className="card fade-in">
          <p className="card-title">再設定のメールを送りました</p>
          <p className="card-sub">
            {email} が登録されていれば、再設定のリンクが届きます。リンクを開いて、新しいパスワードを決めてください。届かないときは、迷惑メールのフォルダもご確認ください。
          </p>
          <Link href={back.href} className="btn btn-secondary btn-block">
            {back.label}
          </Link>
        </section>
      ) : (
        <form className="card" onSubmit={submit} noValidate>
          <p className="card-sub">登録したメールアドレスに、パスワードを決め直すためのリンクをお送りします。</p>
          <div className={`field ${error ? 'has-error' : ''}`}>
            <label className="field-label" htmlFor="email">
              メールアドレス<span className="req">必須</span>
            </label>
            <input id="email" className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} />
            {error && (
              <span className="field-error" role="alert">
                {error}
              </span>
            )}
          </div>
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
            {busy ? '送信中…' : '再設定のメールを送る'}
          </button>
          <p className="login-forgot">
            <Link href={back.href}>{back.label}</Link>
          </p>
        </form>
      )}
    </main>
  );
}
