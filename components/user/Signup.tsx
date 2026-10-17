'use client';

// 新規登録（スマートフォンの1画面に収まる長さ）
//   ・Google・Yahoo! JAPAN ID で登録（連携のあと、予約に必要な情報だけを入力）
//   ・メールアドレスで登録（2段階）
//       1. メールアドレスとパスワード（外部 ID のボタンと同じカードに置く）
//       2. お名前・電話番号・性別・年代・職業・利用エリア、18歳以上の確認と規約への同意（1つのチェック）
//     → 「メールアドレスの確認のお願い」が届く → リンクを開くと登録が完了し、そのままログインした状態になる
// ラベルは入力欄の上に常に表示し、エラーは入力欄のすぐ下に具体的に書く

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader, { RoleIntro } from '@/components/AppHeader';
import { NotConfigured } from '@/components/States';
import Button, { ButtonLink } from '@/components/ui/Button';
import { Input } from '@/components/ui/Form';
import { Page, Pair, ScreenTitle } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import { Panel } from '@/components/ui/Surface';
import { ArrowRight, EnvelopeSimple, LinkIcon } from '@/components/ui/icons';
import PasswordInput from '@/components/auth/PasswordInput';
import SocialButtons, { AuthErrorNotice, OrDivider, hasAnyProvider } from '@/components/auth/SocialButtons';
import { useRoleSession } from '@/lib/supabase';
import type { Providers } from '@/lib/oauth-shared';
import { TERMS_VERSION } from '@/lib/profile-options';
import { askNotifyPermission, notifyDesktop } from '@/lib/desktop-notify';
import { EMPTY_PROFILE, Field, MiniSteps, ProfileFields, checkProfile, type ProfileErrors, type ProfileForm } from './FormParts';
import s from './Signup.module.css';
import type { Area } from './useUserState';

type Account = { email: string; password: string };
type AccountErrors = Partial<Record<keyof Account, string>>;

const SIGNUP_ERROR: Record<string, string> = {
  invalid_email: 'メールアドレスの形をご確認ください。',
  email_address_invalid: 'このメールアドレスは使えません。別のメールアドレスをお試しください。',
  weak_password: 'もっと推測されにくいパスワードにしてください（8文字以上。英字・数字・記号を混ぜる）。',
  rate_limited: '短い時間に何度も送信されたため、少し時間をおいてお試しください。',
  over_email_send_rate_limit: '短い時間に何度も送信されたため、少し時間をおいてお試しください。',
  signup_disabled: 'ただいま新規登録を受け付けていません。',
};

export default function Signup({ providers, authError, next = '/' }: { providers: Providers; authError?: string | null; next?: string }) {
  const router = useRouter();
  const { client, session } = useRoleSession('user');
  const [areas, setAreas] = useState<Area[]>([]);
  const [step, setStep] = useState<1 | 2>(1);
  const [account, setAccount] = useState<Account>({ email: '', password: '' });
  const [accountErrors, setAccountErrors] = useState<AccountErrors>({});
  const [profile, setProfile] = useState<ProfileForm>(EMPTY_PROFILE);
  const [profileErrors, setProfileErrors] = useState<ProfileErrors>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [demoLink, setDemoLink] = useState<string | null>(null);
  const [demoNote, setDemoNote] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  // すでにログインしているなら、登録の画面は出さない
  useEffect(() => {
    if (session && !sentTo) router.replace(next);
  }, [session, sentTo, router, next]);

  // 確認メールの再送は60秒おきまで
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    client
      ?.from('areas')
      .select('id,name,lat,lng')
      .order('sort_order')
      .then(({ data }) => setAreas((data ?? []) as Area[]));
  }, [client]);

  async function resend() {
    if (!sentTo) return;
    setResendMsg(null);
    const res = await fetch('/api/auth/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: sentTo, role: 'user', next }),
    });
    const body = (await res.json().catch(() => ({}))) as { demoLink?: string | null };
    setCooldown(60);
    if (!res.ok) {
      setResendMsg('送信が混み合っています。少し時間をおいてお試しください。');
      return;
    }
    if (body.demoLink) setDemoLink(body.demoLink);
    setResendMsg('確認メールをもう一度送りました（確認がまだのアドレスの場合）。');
  }

  function setA<K extends keyof Account>(key: K, value: Account[K]) {
    setAccount((f) => ({ ...f, [key]: value }));
    setAccountErrors((e) => ({ ...e, [key]: undefined }));
  }
  function setP<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setProfile((f) => ({ ...f, [key]: value }));
    setProfileErrors((e) => ({ ...e, [key]: undefined }));
  }

  function toStep2(ev: FormEvent) {
    ev.preventDefault();
    const e: AccountErrors = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(account.email.trim())) e.email = 'メールアドレスの形で入力してください（例：name@example.com）。';
    if (account.password.length < 8) e.password = '8文字以上で入力してください。';
    else if (account.password.length > 72) e.password = '72文字以下で入力してください。';
    setAccountErrors(e);
    if (Object.keys(e).length === 0) {
      setStep(2);
      window.scrollTo({ top: 0 });
    } else {
      document.getElementById(Object.keys(e)[0])?.focus();
    }
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e = checkProfile(profile);
    setProfileErrors(e);
    if (Object.keys(e).length > 0) {
      document.getElementById(Object.keys(e)[0])?.focus();
      return;
    }
    // 登録のボタンを押したこの時に、パソコンへの通知の許可を求める（許可されたら、仮登録・登録完了を通知する）
    askNotifyPermission();
    setBusy(true);
    setSubmitError(null);
    const email = account.email.trim().toLowerCase();
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        email,
        password: account.password,
        next,
        data: {
          display_name: profile.name.trim(),
          phone: profile.phone.trim(),
          gender: profile.gender,
          age_group: profile.age,
          occupation: profile.job,
          area_id: profile.area,
          adult_confirmed: 'true',
          terms_version: TERMS_VERSION,
        },
      }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string; demoLink?: string | null; demoNote?: string | null } | undefined;
    setBusy(false);
    if (!res || !res.ok) {
      setSubmitError(SIGNUP_ERROR[body?.error ?? ''] ?? (res ? '登録できませんでした。少し時間をおいてお試しください。' : '通信できませんでした。電波の状態をご確認のうえ、もう一度お試しください。'));
      return;
    }
    setDemoLink(body?.demoLink ?? null);
    setDemoNote(body?.demoNote ?? null);
    setSentTo(email);
    setCooldown(60);
    notifyDesktop('仮登録が完了しました', `確認のメールを ${email} にお送りしました。メールのリンクを開くと、登録が完了します。`, 'signup');
    window.scrollTo({ top: 0 });
  }

  if (!client) return <NotConfigured />;

  if (sentTo) {
    return (
      <Page>
        <AppHeader role="利用者" />
        <Panel as="section" roomy className={s.sent}>
          <div className={s.body}>
            <p className={s.kicker}>
              <EnvelopeSimple size={20} aria-hidden focusable="false" />
              あと少しで完了です
            </p>
            <p className={s.title}>確認メールを送りました</p>
            <p className={s.text}>
              <strong className="break">{sentTo}</strong> に届いたメールのリンクを開くと、登録が完了してログインします。届かないときは、迷惑メールのフォルダと、携帯電話のメールの受信設定をご確認ください。
            </p>
            {demoLink && (
              <div className={s.demo}>
                <Notice tone="info">
                  <strong>デモ：</strong>メールは送られません。下のボタンがメールのリンクと同じです。
                </Notice>
                <ButtonLink variant="primary" size="md" block external icon={LinkIcon} href={demoLink}>
                  メールのリンクを開く（デモ）
                </ButtonLink>
              </div>
            )}
            {demoNote === 'exists' && (
              <Notice tone="info">
                <strong>デモ：</strong>登録済みのアドレスのため、「登録済みのお知らせ」を送りました（本番では画面に出しません）。
              </Notice>
            )}
            {resendMsg && <Notice tone="info">{resendMsg}</Notice>}
            <Pair>
              <Button variant="quiet" disabled={cooldown > 0} onClick={resend}>
                {cooldown > 0 ? `再送（${cooldown}秒後）` : '確認メールを再送'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setSentTo(null);
                  setDemoLink(null);
                  setDemoNote(null);
                  setStep(1);
                }}
              >
                入力し直す
              </Button>
            </Pair>
            <p className={s.links}>
              <Link href="/login">ログイン画面へ</Link>
            </p>
          </div>
        </Panel>
      </Page>
    );
  }

  return (
    <Page>
      <AppHeader role="利用者">
        <Link href="/login">ログイン</Link>
      </AppHeader>
      <RoleIntro kind="user" compact />
      <ScreenTitle tight>新規登録（無料）</ScreenTitle>
      <AuthErrorNotice code={authError} />

      {step === 1 && (
        <Panel as="section">
          {hasAnyProvider(providers) && (
            <>
              <SocialButtons providers={providers} role="user" mode="signup" next={next} back="/signup" verb="登録" />
              <OrDivider>またはメールアドレスで</OrDivider>
            </>
          )}
          <form onSubmit={toStep2} noValidate>
            <Field id="email" label="メールアドレス" error={accountErrors.email} hint="確認のメールが届きます。">
              <Input id="email" type="email" inputMode="email" autoComplete="email" value={account.email}
                aria-invalid={!!accountErrors.email} aria-describedby={accountErrors.email ? 'email-error' : 'email-hint'}
                onChange={(e) => setA('email', e.target.value)} />
            </Field>
            <Field id="password" label="パスワード（8文字以上）" error={accountErrors.password}>
              <PasswordInput id="password" isNew value={account.password} invalid={!!accountErrors.password}
                describedBy={accountErrors.password ? 'password-error' : undefined} onChange={(v) => setA('password', v)} />
            </Field>
            <Button variant="primary" size="lg" block type="submit" iconEnd={ArrowRight}>
              次へ（お客様の情報）
            </Button>
          </form>
          <p className={s.links}>
            アカウントをお持ちの方は <Link href="/login">ログイン</Link>
          </p>
        </Panel>
      )}

      {step === 2 && (
        <Panel as="form" onSubmit={submit} noValidate>
          <div className={s.stepHead}>
            <MiniSteps step={2} total={2} label="お客様の情報" />
            <Button variant="text" size="sm" onClick={() => setStep(1)}>
              ← 戻る
            </Button>
          </div>
          <ProfileFields form={profile} errors={profileErrors} onChange={setP} areas={areas} />
          {submitError && (
            <Notice tone="danger" role="alert" className={s.error}>
              {submitError}
            </Notice>
          )}
          <Button variant="primary" size="lg" block type="submit" disabled={busy} icon={EnvelopeSimple}>
            {busy ? '送信中…' : '確認メールを送る'}
          </Button>
        </Panel>
      )}
    </Page>
  );
}
