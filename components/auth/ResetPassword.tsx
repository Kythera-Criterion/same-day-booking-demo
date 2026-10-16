'use client';

// 再設定のリンクから開く画面：新しいパスワードを決める。
// リンク（一度だけ使える token_hash）は、そのアカウントの役割（利用者・サロン・運営）の保存先で確かめる。
// リンクを確かめられたときだけ入力欄を出す（ほかのアカウントでログインしている端末でも、別の人のパスワードを変えない）

import { useEffect, useRef, useState, type FormEvent } from 'react';
import AppHeader, { RoleIntro, type RoleKind } from '@/components/AppHeader';
import PasswordInput from '@/components/auth/PasswordInput';
import { Loading, NotConfigured } from '@/components/States';
import Button, { ButtonLink } from '@/components/ui/Button';
import { Field } from '@/components/ui/Form';
import { Page, ScreenTitle } from '@/components/ui/Layout';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { CheckCircle, EnvelopeSimple, Key, LinkIcon, UserCircle } from '@/components/ui/icons';
import { getClient, isConfigured } from '@/lib/supabase';
import s from './ResetPassword.module.css';

const HOME: Record<RoleKind, { href: string; label: string }> = {
  user: { href: '/', label: 'ホームへ' },
  salon: { href: '/salon', label: 'サロンの画面へ' },
  admin: { href: '/admin', label: '運営の画面へ' },
};
const HEADER_LABEL: Record<RoleKind, string> = { user: '利用者', salon: 'サロン', admin: '運営' };

type Phase = 'checking' | 'form' | 'invalid' | 'done';

export default function ResetPassword({ role, tokenHash }: { role: string; tokenHash: string | null }) {
  const kind: RoleKind = role === 'salon' || role === 'admin' ? role : 'user';
  const [phase, setPhase] = useState<Phase>('checking');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!isConfigured || started.current) return;
    started.current = true;
    (async () => {
      const client = getClient(kind);
      // 以前の形のリンク（Supabase から届いたもの）：利用者の保存先で受け取った再設定のログインだけを使う
      const legacy = typeof window !== 'undefined' && /type=recovery/.test(window.location.hash);
      if (!tokenHash && !legacy) {
        setPhase('invalid');
        return;
      }
      if (tokenHash) {
        const { data, error: e } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
        // リンクの情報を URL に残さない
        window.history.replaceState(null, '', `/reset?role=${kind}`);
        if (e || !data.session) {
          setPhase('invalid');
          return;
        }
        setEmail(data.session.user.email ?? '');
        setPhase('form');
        return;
      }
      const user = getClient('user');
      const { data } = await user.auth.getSession();
      if (!data.session) {
        setPhase('invalid');
        return;
      }
      setEmail(data.session.user.email ?? '');
      setPhase('form');
    })();
  }, [kind, tokenHash]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setError('パスワードは8文字以上で入力してください。');
    if (pw !== pw2) return setError('確認のため、同じパスワードをもう一度入力してください。');
    setBusy(true);
    setError(null);
    const client = tokenHash ? getClient(kind) : getClient('user');
    const { error: e2 } = await client.auth.updateUser({ password: pw });
    setBusy(false);
    if (e2) {
      setError(
        /different/i.test(e2.message)
          ? '今までと違うパスワードにしてください。'
          : /weak|characters/i.test(e2.message)
            ? 'もっと推測されにくいパスワードにしてください（英字・数字・記号を混ぜる）。'
            : 'パスワードを変更できませんでした。もう一度お試しください。',
      );
      return;
    }
    // 以前の形のリンクは利用者の保存先で受け取るため、サロン・運営のアカウントなら、変更後にその保存先からは外す
    if (!tokenHash && kind !== 'user') await getClient('user').auth.signOut({ scope: 'local' });
    setPhase('done');
  }

  if (!isConfigured) return <NotConfigured />;
  const home = HOME[kind];

  return (
    <Page>
      <AppHeader role={HEADER_LABEL[kind]} home={kind === 'user' ? '/' : `/${kind}`} />
      <RoleIntro kind={kind} />
      <ScreenTitle>新しいパスワード</ScreenTitle>
      {phase === 'checking' && <Loading rows={2} />}
      {phase === 'invalid' && (
        <Panel as="section">
          <SectionHead icon={LinkIcon} title="このリンクは使えません" as="p" />
          <SubText>有効期限が切れたか、すでに使われたリンクです。お手数ですが、もう一度再設定のメールを送ってください。</SubText>
          <ButtonLink href={`/forgot?role=${kind}`} variant="secondary" size="md" block icon={EnvelopeSimple}>
            再設定のメールを送る
          </ButtonLink>
        </Panel>
      )}
      {phase === 'done' && (
        <Panel as="section">
          <SectionHead icon={CheckCircle} title="パスワードを変更しました" as="p" />
          <SubText>新しいパスワードで、ログインできます。</SubText>
          <ButtonLink href={tokenHash || kind === 'user' ? home.href : `/${kind}`} variant="primary" size="md" block>
            {tokenHash || kind === 'user' ? home.label : 'ログインへ'}
          </ButtonLink>
        </Panel>
      )}
      {phase === 'form' && (
        <Panel as="form" onSubmit={submit} noValidate>
          {email && (
            <p className={s.account}>
              <UserCircle size={20} aria-hidden focusable="false" />
              <span>
                アカウント：<strong className="break">{email}</strong>
              </span>
            </p>
          )}
          <Field id="pw" label="新しいパスワード（8文字以上）">
            <PasswordInput id="pw" isNew value={pw} onChange={setPw} invalid={!!error} />
          </Field>
          <Field id="pw2" label="もう一度" error={error ?? undefined}>
            <PasswordInput id="pw2" autoComplete="new-password" value={pw2} onChange={setPw2} invalid={!!error} />
          </Field>
          <Button variant="primary" size="lg" block type="submit" disabled={busy} icon={Key}>
            {busy ? '変更中…' : 'パスワードを変更する'}
          </Button>
        </Panel>
      )}
    </Page>
  );
}
