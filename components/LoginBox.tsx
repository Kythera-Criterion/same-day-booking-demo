'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { demoLogin } from '@/lib/demo-login';
import PasswordInput from '@/components/auth/PasswordInput';
import { OrDivider } from '@/components/auth/SocialButtons';
import Button from '@/components/ui/Button';
import { Field, Input, LabeledField } from '@/components/ui/Form';
import Notice from '@/components/ui/Notice';
import { Panel, SectionHead } from '@/components/ui/Surface';
import { Key } from '@/components/ui/icons';
import s from './LoginBox.module.css';

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
  defaultEmail = '',
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
  defaultEmail?: string;
}) {
  const [email, setEmail] = useState(defaultEmail);
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
          ? resendRole === 'salon'
            ? // サロンの新規登録は運営の承認制：承認されると、確認のリンクが届く
              'お申し込みは、運営の確認待ちです。確認が済むと、ご登録のメールアドレスに確認のリンクをお送りします。リンクを開くと登録が完了し、ログインできるようになります（リンクの期限が切れたときは、運営事務局へご連絡ください）。'
            : 'メールアドレスの確認がまだ済んでいません。届いた「メールアドレスの確認のお願い」のリンクを開いてください。'
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
    <Panel as="section">
      <SectionHead icon={Key} title={title} />
      {notice}

      {demoMode && demoAccounts.length > 0 && (
        <>
          <p className={s.lead}>デモ用のアカウントで、ワンタップでログインできます。</p>
          <div className={s.demo}>
            {demoAccounts.map((a) => (
              <button key={a.email} type="button" className={s.account} disabled={busy !== null} onClick={() => oneTap(a)}>
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
        <LabeledField label="メールアドレス">
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </LabeledField>
        <Field id="login-password" label="パスワード">
          <PasswordInput id="login-password" value={password} onChange={setPassword} required />
        </Field>
        {(error || resent) && (
          <div className={s.messages}>
            {error && (
              <Notice tone="danger" role="alert">
                <div className={s.errorBody}>
                  <span>{error}</span>
                  {unconfirmed && resendRole === 'user' && (
                    <Button variant="text" size="sm" disabled={busy !== null} onClick={resendConfirm}>
                      {busy === 'resend' ? '送信中…' : '確認メールをもう一度送る'}
                    </Button>
                  )}
                </div>
              </Notice>
            )}
            {resent && <Notice tone="info">{resent}</Notice>}
          </div>
        )}
        <Button variant="primary" size="md" block type="submit" disabled={busy !== null}>
          {busy === 'form' ? 'ログイン中…' : 'ログイン'}
        </Button>
        {forgotHref && (
          <p className={s.forgot}>
            <a href={forgotHref}>パスワードを忘れた方</a>
          </p>
        )}
      </form>
      {footer}
    </Panel>
  );
}
