'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { demoLogin } from '@/lib/demo-login';
import PasswordInput from '@/components/auth/PasswordInput';
import { OrDivider } from '@/components/auth/SocialButtons';

type Account = { email: string; label: string; sub?: string };

// メールアドレスとパスワードでのログイン。外部の ID（Google・Yahoo! JAPAN ID）のボタンは social に渡す。
// デモモードでは、ワンタップのデモログインも出す
export default function LoginBox({
  client,
  title,
  demoAccounts = [],
  demoMode = false,
  forgotHref = '/forgot',
  footer,
  social,
  notice,
  resendRole = 'user',
}: {
  client: SupabaseClient;
  title: string;
  demoAccounts?: Account[];
  demoMode?: boolean;
  forgotHref?: string | null;
  footer?: ReactNode;
  social?: ReactNode;
  notice?: ReactNode;
  resendRole?: 'user' | 'salon' | null;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resent, setResent] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy('form');
    setError(null);
    setResent(null);
    const { error: signInError } = await client.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(null);
    if (signInError) {
      const notConfirmed = signInError.message.includes('Email not confirmed');
      setUnconfirmed(notConfirmed);
      setError(
        notConfirmed
          ? 'メールアドレスの確認がまだ済んでいません。届いた「メールアドレスの確認のお願い」のリンクを開いてください。'
          : 'ログインできませんでした。メールアドレスとパスワードをご確認ください。',
      );
    }
  }

  // 確認メールの再送（確認がまだのアカウントだけに届く）
  async function resendConfirm() {
    setBusy('resend');
    const res = await fetch('/api/auth/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), role: resendRole }),
    });
    const body = (await res.json().catch(() => ({}))) as { demoLink?: string | null };
    setBusy(null);
    if (!res.ok) {
      setResent('送信が混み合っています。1分ほどおいてお試しください。');
      return;
    }
    if (body.demoLink) {
      window.location.assign(body.demoLink);
      return;
    }
    setResent('確認メールをもう一度送りました。');
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
      {notice}

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

      {social && (
        <>
          {social}
          <OrDivider>またはメールアドレスでログイン</OrDivider>
        </>
      )}

      <form onSubmit={submit}>
        <label className="field">
          <span className="field-label">メールアドレス</span>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <div className="field">
          <label className="field-label" htmlFor="login-password">
            パスワード
          </label>
          <PasswordInput id="login-password" value={password} onChange={setPassword} required />
        </div>
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
            {unconfirmed && resendRole && (
              <button type="button" className="btn btn-text btn-sm" disabled={busy !== null} onClick={resendConfirm}>
                {busy === 'resend' ? '送信中…' : '確認メールをもう一度送る'}
              </button>
            )}
          </div>
        )}
        {resent && <p className="notice notice-info">{resent}</p>}
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
