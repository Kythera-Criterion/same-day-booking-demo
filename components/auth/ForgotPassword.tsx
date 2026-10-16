'use client';

// パスワードを忘れたとき：登録したメールアドレスに、再設定のリンクを送る（メールはこのサービスから送る）。
// 登録の有無が他人に分からないよう、登録があってもなくても同じ案内を出す。通信の失敗などは、その場で知らせる

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import AppHeader, { RoleIntro, type RoleKind } from '@/components/AppHeader';
import { NotConfigured } from '@/components/States';
import Button, { ButtonLink } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import { Page, ScreenTitle } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { ArrowLeft, EnvelopeSimple, LinkIcon } from '@/components/ui/icons';
import { useRoleSession } from '@/lib/supabase';
import s from './ForgotPassword.module.css';

const BACK: Record<string, { href: string; label: string }> = {
  user: { href: '/login', label: '利用者のログインへ戻る' },
  salon: { href: '/salon', label: 'サロンのログインへ戻る' },
  admin: { href: '/admin', label: '運営のログインへ戻る' },
};

const HEADER_LABEL: Record<RoleKind, string> = { user: '利用者', salon: 'サロン', admin: '運営' };

export default function ForgotPassword({ role }: { role: string }) {
  const { client } = useRoleSession('user');
  const [demoLink, setDemoLink] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const back = BACK[role] ?? BACK.user;
  const kind: RoleKind = role === 'salon' || role === 'admin' ? role : 'user';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!client) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError('メールアドレスの形で入力してください（例：name@example.com）。');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), role: kind }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string; demoLink?: string | null } | undefined;
    setBusy(false);
    if (!res || !res.ok) {
      setError(
        body?.error === 'rate_limited'
          ? '短い時間に何度も送られたため、少し時間をおいてお試しください。'
          : body?.error === 'invalid_email'
            ? 'メールアドレスの形で入力してください（例：name@example.com）。'
            : '送れませんでした。通信の状態をご確認のうえ、もう一度お試しください。',
      );
      return;
    }
    setDemoLink(body?.demoLink ?? null);
    setSent(true);
  }

  if (!client) return <NotConfigured />;

  return (
    <Page>
      <AppHeader role={HEADER_LABEL[kind]} home={kind === 'user' ? '/' : `/${kind}`} />
      <RoleIntro kind={kind} />
      <ScreenTitle>パスワードの再設定</ScreenTitle>
      {sent ? (
        <Panel as="section">
          <SectionHead icon={EnvelopeSimple} title="再設定のメールを送りました" as="p" />
          <SubText>
            {email} が登録されていれば、再設定のリンクが届きます。リンクを開いて、新しいパスワードを決めてください。届かないときは、迷惑メールのフォルダもご確認ください。
          </SubText>
          <div className={s.sent}>
            {demoLink && (
              <div className={s.demo}>
                <Notice tone="info">
                  <strong>デモ：</strong>メールの送信キーが未設定のため、メールは送られていません。下のボタンが、メールの中のリンクと同じです。
                </Notice>
                <ButtonLink variant="primary" size="md" block external icon={LinkIcon} href={demoLink}>
                  メールのリンクを開く（デモ）
                </ButtonLink>
              </div>
            )}
            <ButtonLink href={back.href} variant="secondary" size="md" block icon={ArrowLeft}>
              {back.label}
            </ButtonLink>
          </div>
        </Panel>
      ) : (
        <Panel as="form" onSubmit={submit} noValidate>
          <p className={s.lead}>登録したメールアドレスに、パスワードを決め直すためのリンクをお送りします。</p>
          <Field id="email" label="メールアドレス" required error={error ?? undefined}>
            <Input id="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} />
          </Field>
          <Button variant="primary" size="lg" block type="submit" disabled={busy} icon={EnvelopeSimple}>
            {busy ? '送信中…' : '再設定のメールを送る'}
          </Button>
          <p className={s.back}>
            <Link href={back.href}>{back.label}</Link>
          </p>
        </Panel>
      )}
    </Page>
  );
}
