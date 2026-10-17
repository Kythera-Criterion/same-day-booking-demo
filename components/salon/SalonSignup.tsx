'use client';

// サロンの新規登録（運営の承認制）
//   1. 申し込み：店名・お名前・メールアドレス・パスワードを入れて「登録する」
//      → 運営の画面の「掲載希望」に届く（アカウントは、確認が済むまでログインできない）
//   2. 運営の確認：運営が承認すると、登録のメールアドレスへ確認のリンクが自動で届く
//   3. 登録の完了：リンクを開くと、登録が完了してサロンの画面にログインし、初期設定（メニュー・担当・お店の場所）へ進む
// すでにアカウントがある場合（お客様・ほかのお店のスタッフ・運営、Google・Yahoo! JAPAN ID で登録した場合）は、
// ログインしたまま申し込み、同じく運営の承認を待つ（2店舗目の申し込みにも使う）

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import AppHeader, { RoleIntro } from '@/components/AppHeader';
import LoginBox from '@/components/LoginBox';
import { Loading, NotConfigured } from '@/components/States';
import PasswordInput from '@/components/auth/PasswordInput';
import SocialButtons, { AuthErrorNotice, OrDivider, hasAnyProvider } from '@/components/auth/SocialButtons';
import Button, { ButtonLink } from '@/components/ui/Button';
import { Check, Field, formClass, Input } from '@/components/ui/Form';
import { Fine, Page, ScreenTitle, Stack } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { PencilSimple, Storefront, UserCircle, WarningCircle } from '@/components/ui/icons';
import { useRoleSession } from '@/lib/supabase';
import { logout } from '@/lib/logout';
import { toMessage } from '@/lib/errors';
import type { Providers } from '@/lib/oauth-shared';
import { PRIVACY_URL, TERMS_URL } from '@/lib/profile-options';
import { askNotifyPermission, notifyDesktop } from '@/lib/desktop-notify';
import sg from './SalonSignup.module.css';

type Form = { salon: string; name: string; email: string; password: string; terms: boolean };
type Errors = Partial<Record<keyof Form, string>>;
type MyApplication = { id: string; status: string; salon_name: string; salon_id: string | null; created_at: string };

const SIGNUP_ERROR: Record<string, string> = {
  invalid_email: 'メールアドレスの形をご確認ください。',
  invalid_input: '店名とお名前を入力してください。',
  email_address_invalid: 'このメールアドレスは使えません。別のメールアドレスをお試しください。',
  weak_password: 'もっと推測されにくいパスワードにしてください（8文字以上。英字・数字・記号を混ぜる）。',
  rate_limited: '短い時間に何度も送信されたため、少し時間をおいてお試しください。',
  over_email_send_rate_limit: '短い時間に何度も送信されたため、少し時間をおいてお試しください。',
  signup_disabled: 'ただいま新規登録を受け付けていません。',
};

const STEP_LABEL = ['申し込み', '運営の確認', '登録の完了'] as const;
// 何段階目か（「1/3」の数字と、3つに分けた線）
function Steps({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className={sg.steps} aria-label={`3段階のうち${step}段階目：${STEP_LABEL[step - 1]}`}>
      <span className={sg.stepsText}>
        <b className={`${sg.stepsCount} num`}>{step}/3</b>
        {STEP_LABEL[step - 1]}
      </span>
      <span className={sg.stepsBar} aria-hidden>
        {[1, 2, 3].map((i) => (
          <i key={i} data-on={i <= step ? '' : undefined} />
        ))}
      </span>
    </div>
  );
}

export default function SalonSignup({ providers, authError, demoMode = false }: { providers: Providers; authError?: string | null; demoMode?: boolean }) {
  const { client, session, ready } = useRoleSession('salon');
  // このアカウントがスタッフになっているお店と、いちばん新しい申し込み（undefined：確認中）
  const [mySalons, setMySalons] = useState<{ id: string; name: string }[] | null>(null);
  const [myApp, setMyApp] = useState<MyApplication | null | undefined>(undefined);
  const [form, setForm] = useState<Form>({ salon: '', name: '', email: '', password: '', terms: false });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // ログインせずに申し込んだあと（運営の確認待ち）
  const [appliedTo, setAppliedTo] = useState<string | null>(null);
  const [demoNote, setDemoNote] = useState<string | null>(null);

  // 読み直しが重なったときは、最後に始めたものの結果だけを使う（古い結果で上書きしない）
  const loadSeq = useRef(0);
  const loadMine = useCallback(async () => {
    const seq = ++loadSeq.current;
    // 申し込みの途中でログインした直後は、画面の session がまだ古いことがあるため、クライアントの今のログインを使う
    const current = session ?? (client ? (await client.auth.getSession()).data.session : null);
    if (!client || !current) {
      if (seq !== loadSeq.current) return;
      setMySalons(null);
      setMyApp(undefined);
      return;
    }
    const [{ data: members }, { data: apps }, { data: p }] = await Promise.all([
      client.from('salon_members').select('salons(id,name)').eq('user_id', current.user.id),
      client.rpc('my_salon_application'),
      client.from('profiles').select('display_name').eq('id', current.user.id).maybeSingle(),
    ]);
    if (seq !== loadSeq.current) return;
    setMySalons(
      (members ?? [])
        .map((m) => (Array.isArray(m.salons) ? m.salons[0] : m.salons) as { id: string; name: string } | null | undefined)
        .filter((x): x is { id: string; name: string } => !!x),
    );
    setMyApp(((apps as MyApplication[] | null) ?? [])[0] ?? null);
    const name = (p?.display_name as string | undefined) || (current.user.user_metadata?.display_name as string | undefined) || '';
    setForm((f) => (f.name ? f : { ...f, name }));
  }, [client, session]);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  // ログイン中のアカウントで申し込む（審査待ちの申し込みがすでにあれば、それを表示する）
  async function applyAsMember() {
    if (!client) return;
    const { error } = await client.rpc('salon_apply', { p_salon_name: form.salon.trim(), p_contact_name: form.name.trim() });
    if (error && !error.message.includes('application_pending')) {
      setSubmitError(toMessage(error));
      return;
    }
    if (!error) notifyDesktop('掲載の申し込みを受け付けました', `${form.salon.trim()} の申し込みを運営が確認しています。承認されると、サロンの画面で使えるようになります。`, 'salon-signup');
    await loadMine();
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e: Errors = {};
    if (!form.salon.trim()) e.salon = '店名を入力してください。';
    if (!form.name.trim()) e.name = 'お名前を入力してください。';
    if (!session) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) e.email = 'メールアドレスの形で入力してください（例：salon@example.com）。';
      if (form.password.length < 8) e.password = '8文字以上で入力してください。';
      else if (form.password.length > 72) e.password = '72文字以下で入力してください。';
    }
    if (!form.terms) e.terms = '利用規約とプライバシーポリシーへの同意が必要です。';
    setErrors(e);
    if (Object.keys(e).length > 0) {
      document.getElementById(`a-${Object.keys(e)[0]}`)?.focus();
      return;
    }
    if (!client) return;
    // 申し込むボタンを押したこの時に、パソコンへの通知の許可を求める（許可されたら、受付・登録完了を通知する）
    askNotifyPermission();
    setBusy(true);
    setSubmitError(null);

    // ログイン中なら、そのアカウントで申し込む
    if (session) {
      await applyAsMember();
      setBusy(false);
      window.scrollTo({ top: 0 });
      return;
    }

    const email = form.email.trim().toLowerCase();
    // すでにアカウントがあり、パスワードも合っていれば、新しく作らずにそのアカウントで申し込む
    const { error: signInError } = await client.auth.signInWithPassword({ email, password: form.password });
    if (!signInError) {
      await applyAsMember();
      setBusy(false);
      window.scrollTo({ top: 0 });
      return;
    }

    // 新しく申し込む（確認前のアカウントを作り、運営に届ける）。確認前の申し込みをやり直した場合は、新しい内容に置き換わる
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'salon', email, password: form.password, data: { display_name: form.name.trim(), salon_name: form.salon.trim() } }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string; demoNote?: string | null } | undefined;
    setBusy(false);
    if (!res || !res.ok) {
      setSubmitError(
        SIGNUP_ERROR[body?.error ?? ''] ?? (res ? '登録できませんでした。少し時間をおいてお試しください。' : '通信できませんでした。電波の状態をご確認のうえ、もう一度お試しください。'),
      );
      return;
    }
    setDemoNote(body?.demoNote ?? null);
    setAppliedTo(email);
    notifyDesktop('掲載の申し込みを受け付けました', `運営が確認したあと、${email} にご案内をお送りします。`, 'salon-signup');
    window.scrollTo({ top: 0 });
  }

  if (!client) return <NotConfigured />;

  const header = (
    <AppHeader role="サロン" home="/salon">
      {session ? <button onClick={() => logout('salon')}>ログアウト</button> : <Link href="/salon">ログイン</Link>}
    </AppHeader>
  );

  if (!ready || (session && (mySalons === null || myApp === undefined))) {
    return (
      <Page>
        {header}
        <Loading rows={3} />
      </Page>
    );
  }

  const terms = (
    <div className={formClass.field}>
      <Check id="a-terms" checked={form.terms} onChange={(v) => set('terms', v)}>
        <a href={TERMS_URL} target="_blank" rel="noreferrer">
          利用規約（掲載店の条項）
        </a>
        と
        <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
          プライバシーポリシー
        </a>
        に同意します
      </Check>
      {errors.terms && (
        <span className={formClass.error} role="alert">
          <WarningCircle size={20} aria-hidden focusable="false" />
          {errors.terms}
        </span>
      )}
    </div>
  );
  const shopFields = (
    <>
      <Field id="a-salon" label="店名" error={errors.salon}>
        <Input id="a-salon" maxLength={80} value={form.salon} aria-invalid={!!errors.salon} onChange={(e) => set('salon', e.target.value)} />
      </Field>
      <Field id="a-name" label="ご担当者のお名前" error={errors.name}>
        <Input id="a-name" maxLength={60} autoComplete="name" value={form.name} aria-invalid={!!errors.name} onChange={(e) => set('name', e.target.value)} />
      </Field>
    </>
  );
  const demoAdmin = demoMode && (
    <Notice tone="info">
      <strong>デモ：</strong>
      <Link href="/admin">運営の画面</Link>の「掲載希望」で承認すると、確認のリンクのメールが送られます（シミュレーション送信）。中身は運営の画面の「通知・記録」で確かめられ、リンクを開くと登録が完了します。
    </Notice>
  );
  const submitNotice = submitError && (
    <Notice tone="danger" role="alert" className={sg.below}>
      {submitError}
    </Notice>
  );

  // ログインせずに申し込んだあと：運営の確認待ち
  if (appliedTo && !session) {
    return (
      <Page>
        {header}
        <ScreenTitle tight>お申し込みを受け付けました</ScreenTitle>
        <Stack gap={4}>
          <Panel>
            <Steps step={2} />
            <Stack gap={3}>
              <p className={sg.text}>
                運営が内容を確認したあと、<strong className="break">{appliedTo}</strong> に確認のリンクをお送りします。リンクを開くと登録が完了し、サロンの画面でメニュー・担当・お店の場所などを設定できます。
              </p>
              <p className={sg.text}>確認が済むまでは、ログインできません。届かないときは、迷惑メールのフォルダもご確認ください。</p>
              {demoNote === 'exists' ? (
                <Notice tone="info" role="status">
                  <strong>デモ：</strong>このメールアドレスは登録済みです（お客様・ほかのお店・運営のアカウントを含む）。新しいアカウントは作らず、「登録済みのお知らせ」を送りました（本番では画面に出しません）。下の欄から、そのアカウントのパスワードでログインして申し込んでください。
                </Notice>
              ) : (
                demoAdmin
              )}
              <Button variant="quiet" size="md" block icon={PencilSimple} onClick={() => setAppliedTo(null)}>
                入力し直す
              </Button>
            </Stack>
          </Panel>
          {demoNote === 'exists' && (
            <LoginBox
              client={client}
              title="登録済みのアカウントで申し込む"
              defaultEmail={appliedTo}
              forgotHref="/forgot?role=salon"
              resendRole="salon"
              notice={<SubText>ログインすると、入力した店名とお名前で申し込めます。</SubText>}
            />
          )}
        </Stack>
      </Page>
    );
  }

  // ログイン中：審査待ちの申し込みがある
  if (session && myApp?.status === 'pending') {
    return (
      <Page>
        {header}
        <ScreenTitle tight>運営の確認待ちです</ScreenTitle>
        <Panel>
          <Steps step={2} />
          <SectionHead icon={Storefront} title={myApp.salon_name} as="p" />
          <Stack gap={3}>
            <p className={sg.text}>
              お申し込みを受け付けました。運営が確認したあと、<strong className="break">{session.user.email}</strong> に確認のリンクをお送りします。リンクを開くと、サロンの画面でメニュー・担当・お店の場所などを設定できます。
            </p>
            {demoAdmin}
            {mySalons && mySalons.length > 0 && (
              <ButtonLink href="/salon" variant="secondary" size="md" block>
                サロンの画面に戻る
              </ButtonLink>
            )}
          </Stack>
        </Panel>
      </Page>
    );
  }

  // ログイン中：このアカウントで申し込む
  if (session) {
    return (
      <Page>
        {header}
        <RoleIntro kind="salon" compact />
        <ScreenTitle tight>掲載のお申し込み（無料）</ScreenTitle>
        <Panel as="form" onSubmit={submit} noValidate>
          <Steps step={1} />
          {mySalons && mySalons.length > 0 ? (
            <p className={sg.account}>
              <UserCircle size={20} aria-hidden focusable="false" />
              <span>
                <strong className="break">{session.user.email}</strong> は「{mySalons.map((x) => x.name).join('」「')}」のスタッフです。このアカウントのまま、別のお店を追加で申し込みます（
                <Link href="/salon">サロンの画面に戻る</Link>）
              </span>
            </p>
          ) : (
            <p className={sg.account}>
              <UserCircle size={20} aria-hidden focusable="false" />
              <span>
                申し込むアカウント：<strong className="break">{session.user.email}</strong>
              </span>
            </p>
          )}
          {myApp?.status === 'rejected' && !mySalons?.length && (
            <Notice tone="info" className={sg.below}>
              前回のお申し込み（{myApp.salon_name}）は、掲載を見送らせていただきました。内容を見直して、もう一度申し込めます。
            </Notice>
          )}
          {shopFields}
          {terms}
          {submitNotice}
          <Button variant="primary" size="lg" block type="submit" disabled={busy}>
            {busy ? '送信中…' : '登録する'}
          </Button>
          <div className={sg.above}>
            <Fine>運営が確認したあと、確認のリンクをメールでお送りします。</Fine>
          </div>
        </Panel>
      </Page>
    );
  }

  // ログインしていない：新規登録
  return (
    <Page>
      {header}
      <RoleIntro kind="salon" compact />
      <ScreenTitle tight>掲載のお申し込み（無料）</ScreenTitle>
      <AuthErrorNotice code={authError} />
      <Panel>
        <Steps step={1} />
        {hasAnyProvider(providers) && (
          <>
            <SocialButtons providers={providers} role="salon" mode="signup" next="/salon/signup" back="/salon/signup" verb="登録" />
            <OrDivider>またはメールアドレスで</OrDivider>
          </>
        )}
        <form onSubmit={submit} noValidate>
          {shopFields}
          <Field id="a-email" label="メールアドレス（ログインと連絡用）" error={errors.email}>
            <Input id="a-email" type="email" inputMode="email" autoComplete="email" value={form.email} aria-invalid={!!errors.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field id="a-password" label="パスワード（8文字以上）" error={errors.password}>
            <PasswordInput id="a-password" isNew value={form.password} invalid={!!errors.password} onChange={(v) => set('password', v)} />
          </Field>
          {terms}
          {submitNotice}
          <Button variant="primary" size="lg" block type="submit" disabled={busy}>
            {busy ? '送信中…' : '登録する'}
          </Button>
        </form>
        <div className={sg.above}>
          <Fine>運営が確認したあと、ご登録のメールアドレスに確認のリンクをお送りします。リンクを開くと登録が完了します。</Fine>
        </div>
        <p className={sg.links}>
          <Link href="/salon">ログイン</Link>
          <span className={sg.sep} aria-hidden>
            ／
          </span>
          <Link href="/apply">まずは相談する</Link>
        </p>
      </Panel>
    </Page>
  );
}
