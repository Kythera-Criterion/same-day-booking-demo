'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { demoLogin } from '@/lib/demo-login';

type Account = { email: string; label: string; sub?: string };

// メールアドレスとパスワードでのログイン。デモモードでは、ワンタップのデモログインも出す
export default function LoginBox({
  client,
  title,
  demoAccounts = [],
  demoMode = false,
  forgotHref = '/forgot',
  footer,
}: {
  client: SupabaseClient;
  title: string;
  demoAccounts?: Account[];
  demoMode?: boolean;
  forgotHref?: string | null;
  footer?: ReactNode;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy('form');
    setError(null);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    setBusy(null);
    if (signInError) {
      setError(
        signInError.message.includes('Email not confirmed')
          ? 'メールアドレスの確認がまだ済んでいません。届いたメールのリンクを開いてください。'
          : 'ログインできませんでした。メールアドレスとパスワードをご確認ください。',
      );
    }
  }

  async function oneTap(account: Account) {
    setBusy(account.email);
    setError(null);
    const message = await demoLogin(client, account.email);
    setBusy(null);
    if (message) setError(message);
  }

  return (
    <section className="card fade-in">
      <h2 className="card-title">{title}</h2>

      {demoMode && demoAccounts.length > 0 && (
        <>
          <p className="card-sub">デモ用のアカウントで、ワンタップでログインできます。</p>
          <div className="chips" style={{ marginBottom: 16 }}>
            {demoAccounts.map((a) => (
              <button key={a.email} type="button" className="chip" disabled={busy !== null} onClick={() => oneTap(a)}>
                {busy === a.email ? 'ログイン中…' : a.label}
                {a.sub && <small>{a.sub}</small>}
              </button>
            ))}
          </div>
        </>
      )}

      <form onSubmit={submit}>
        <label className="field">
          <span className="field-label">メールアドレス</span>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">パスワード</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="notice notice-error">{error}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy !== null}>
          {busy === 'form' ? 'ログイン中…' : 'ログイン'}
        </button>
        {forgotHref && (
          <p className="login-forgot">
            <a href={forgotHref}>パスワードを忘れた方</a>
          </p>
        )}
      </form>
      {footer}
    </section>
  );
}
