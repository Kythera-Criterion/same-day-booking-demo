'use client';

// サロンの新規登録（掲載のお申し込み）
//   1. アカウントを作る：Google・Yahoo! JAPAN ID、またはメールアドレスとパスワード（確認メールのリンクで完了）
//   2. お店の情報を入力する（店名・ご担当者・電話番号・エリア・住所）
//   3. 審査中：運営が承認すると、掲載が始まりメールで知らせる。審査の間も、メニュー・担当・場所の初期設定を進められる

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { Loading, NotConfigured } from '@/components/States';
import PasswordInput from '@/components/auth/PasswordInput';
import SocialButtons, { AuthErrorNotice, OrDivider, hasAnyProvider } from '@/components/auth/SocialButtons';
import { Field, MiniSteps } from '@/components/user/FormParts';
import { useRoleSession } from '@/lib/supabase';
import { logout } from '@/lib/logout';
import { toMessage } from '@/lib/errors';
import type { Providers } from '@/lib/oauth-shared';
import { PRIVACY_URL, TERMS_URL } from '@/lib/profile-options';

type Area = { id: string; name: string };
type Shop = { salon: string; contact: string; phone: string; area: string; address: string; question: string; terms: boolean };
type ShopErrors = Partial<Record<keyof Shop, string>>;
type Account = { name: string; email: string; password: string; terms: boolean };
type AccountErrors = Partial<Record<keyof Account, string>>;

const SIGNUP_ERROR: Record<string, string> = {
  invalid_email: 'メールアドレスの形をご確認ください。',
  weak_password: 'パスワードは8文字以上72文字以下で入力してください。',
  rate_limited: '短い時間に何度も送信されたため、少し時間をおいてお試しください。',
};

const STEP_LABEL = ['アカウント', 'お店の情報', '審査'] as const;
function Steps({ step }: { step: 1 | 2 | 3 }) {
  return <MiniSteps step={step} total={3} label={STEP_LABEL[step - 1]} />;
}

export default function SalonSignup({ providers, authError }: { providers: Providers; authError?: string | null }) {
  const router = useRouter();
  const { client, session, ready } = useRoleSession('salon');
  const [member, setMember] = useState<boolean | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [account, setAccount] = useState<Account>({ name: '', email: '', password: '', terms: false });
  const [accountErrors, setAccountErrors] = useState<AccountErrors>({});
  const [shop, setShop] = useState<Shop>({ salon: '', contact: '', phone: '', area: '', address: '', question: '', terms: false });
  const [shopErrors, setShopErrors] = useState<ShopErrors>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [demoLink, setDemoLink] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const checkMember = useCallback(async () => {
    if (!client || !session) {
      setMember(null);
      return;
    }
    const { data } = await client.from('salon_members').select('salon_id').eq('user_id', session.user.id).limit(1).maybeSingle();
    setMember(!!data);
    const { data: p } = await client.from('profiles').select('display_name').eq('id', session.user.id).maybeSingle();
    const name = (p?.display_name as string | undefined) || (session.user.user_metadata?.display_name as string | undefined) || '';
    setShop((s) => (s.contact ? s : { ...s, contact: name }));
  }, [client, session]);

  useEffect(() => {
    checkMember();
  }, [checkMember]);

  // すでにお店を登録済みなら、サロンの画面へ
  useEffect(() => {
    if (member && !done) router.replace('/salon');
  }, [member, done, router]);

  useEffect(() => {
    client
      ?.from('areas')
      .select('id,name')
      .order('sort_order')
      .then(({ data }) => setAreas((data ?? []) as Area[]));
  }, [client]);

  async function createAccount(ev: FormEvent) {
    ev.preventDefault();
    const e: AccountErrors = {};
    if (!account.name.trim()) e.name = 'ご担当者のお名前を入力してください。';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(account.email.trim())) e.email = 'メールアドレスの形で入力してください（例：salon@example.com）。';
    if (account.password.length < 8) e.password = 'パスワードは8文字以上で入力してください。';
    if (!account.terms) e.terms = '利用規約とプライバシーポリシーへの同意が必要です。';
    setAccountErrors(e);
    if (Object.keys(e).length > 0) {
      document.getElementById(`a-${Object.keys(e)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    setSubmitError(null);
    const email = account.email.trim().toLowerCase();
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'salon', email, password: account.password, next: '/salon/signup', data: { display_name: account.name.trim() } }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string; demoLink?: string | null } | undefined;
    setBusy(false);
    if (!res || !res.ok) {
      setSubmitError(SIGNUP_ERROR[body?.error ?? ''] ?? `登録できませんでした（${body?.error ?? '通信エラー'}）`);
      return;
    }
    setDemoLink(body?.demoLink ?? null);
    setSentTo(email);
  }

  async function registerShop(ev: FormEvent) {
    ev.preventDefault();
    if (!client) return;
    const e: ShopErrors = {};
    if (!shop.salon.trim()) e.salon = '店名を入力してください。';
    if (!shop.contact.trim()) e.contact = 'ご担当者のお名前を入力してください。';
    if (!/^0\d{1,4}-?\d{1,4}-?\d{3,4}$/.test(shop.phone)) e.phone = 'お店の電話番号を数字で入力してください（例：086-123-4567）。';
    if (!shop.area) e.area = 'エリアを選んでください。';
    if (!shop.address.trim()) e.address = '住所を入力してください。';
    if (!shop.terms) e.terms = '掲載の条件への同意が必要です。';
    setShopErrors(e);
    if (Object.keys(e).length > 0) {
      document.getElementById(`s-${Object.keys(e)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    setSubmitError(null);
    const { error } = await client.rpc('salon_self_register', {
      p_salon_name: shop.salon.trim(),
      p_contact_name: shop.contact.trim(),
      p_phone: shop.phone,
      p_area_id: shop.area,
      p_address: shop.address.trim(),
      p_question: shop.question.trim() || null,
    });
    setBusy(false);
    if (error) {
      setSubmitError(error.message.includes('already_registered') ? 'このアカウントは、すでにお店を登録済みです。' : toMessage(error));
      return;
    }
    setDone(true);
    window.scrollTo({ top: 0 });
  }

  if (!client) return <NotConfigured />;

  const header = (
    <AppHeader role="サロン" home="/salon">
      {session ? <button onClick={() => logout('salon')}>ログアウト</button> : <Link href="/salon">ログイン</Link>}
    </AppHeader>
  );

  if (!ready || (session && member === null)) {
    return (
      <main className="app">
        {header}
        <Loading rows={3} />
      </main>
    );
  }

  // 3. 受付完了（審査中）
  if (done) {
    return (
      <main className="app">
        {header}
        <Steps step={3} />
        <section className="card fade-in">
          <p className="welcome-kicker">お申し込みを受け付けました</p>
          <h1 className="screen-title" style={{ margin: '0 0 6px' }}>
            {shop.salon} 様
          </h1>
          <p className="card-sub">
            運営が内容を確認します（審査中）。承認されると掲載が始まり、<strong className="break">{session?.user.email}</strong> へ「掲載開始のお知らせ」をお送りします。
          </p>
          <p className="card-sub">審査の間に、初期設定を済ませておくと、承認後すぐに空き枠を公開できます。</p>
          <ol className="welcome-steps">
            <li>メニューと価格・受付の締切</li>
            <li>担当</li>
            <li>お店の場所（地図の位置）・受け付ける性別・LINE の連絡先</li>
          </ol>
          <Link href="/salon" className="btn btn-primary btn-lg btn-block">
            初期設定へ進む
          </Link>
        </section>
      </main>
    );
  }

  // 2. お店の情報
  if (session) {
    return (
      <main className="app">
        {header}
        <h1 className="screen-title screen-title-tight">お店の情報</h1>
        <form className="card form-compact" onSubmit={registerShop} noValidate>
          <Steps step={2} />
          <p className="form-account">
            ✓ アカウントを作成しました：<strong className="break">{session.user.email}</strong>
          </p>
          <p className="form-note">（任意）以外は必須です。審査の結果はメールでお知らせします。</p>
          <Field id="s-salon" label="店名（利用者の画面に表示）" error={shopErrors.salon}>
            <input id="s-salon" className="input" maxLength={80} value={shop.salon} aria-invalid={!!shopErrors.salon} onChange={(e) => setShop({ ...shop, salon: e.target.value })} />
          </Field>
          <div className="field-row">
            <Field id="s-contact" label="ご担当者" error={shopErrors.contact}>
              <input id="s-contact" className="input" maxLength={60} autoComplete="name" value={shop.contact} aria-invalid={!!shopErrors.contact} onChange={(e) => setShop({ ...shop, contact: e.target.value })} />
            </Field>
            <Field id="s-phone" label="お店の電話番号" error={shopErrors.phone}>
              <input id="s-phone" className="input" type="tel" inputMode="tel" placeholder="086-123-4567" value={shop.phone} aria-invalid={!!shopErrors.phone} onChange={(e) => setShop({ ...shop, phone: e.target.value })} />
            </Field>
          </div>
          <Field id="s-area" label="エリア" error={shopErrors.area}>
            <select id="s-area" className="select" value={shop.area} aria-invalid={!!shopErrors.area} onChange={(e) => setShop({ ...shop, area: e.target.value })}>
              <option value="">選択</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="s-address" label="住所（地図の位置はあとで合わせられます）" error={shopErrors.address}>
            <input id="s-address" className="input" maxLength={120} autoComplete="street-address" value={shop.address} aria-invalid={!!shopErrors.address} onChange={(e) => setShop({ ...shop, address: e.target.value })} />
          </Field>
          <details className="form-optional">
            <summary>ご質問・ご要望（任意）</summary>
            <textarea id="s-question" className="textarea" maxLength={1000} value={shop.question} aria-label="ご質問・ご要望" onChange={(e) => setShop({ ...shop, question: e.target.value })} />
          </details>
          <div className={`field ${shopErrors.terms ? 'has-error' : ''}`}>
            <label className="check check-tight">
              <input id="s-terms" type="checkbox" checked={shop.terms} onChange={(e) => setShop({ ...shop, terms: e.target.checked })} />
              <span>
                <a href={TERMS_URL} target="_blank" rel="noreferrer">利用規約（掲載店の条項）</a>に同意し、お客様の情報は予約の対応だけに使います
              </span>
            </label>
            {shopErrors.terms && <span className="field-error" role="alert">{shopErrors.terms}</span>}
          </div>
          {submitError && <p className="notice notice-error" role="alert">{submitError}</p>}
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
            {busy ? '送信中…' : 'この内容で申し込む'}
          </button>
        </form>
      </main>
    );
  }

  // 1-b. 確認メールの送信後
  if (sentTo) {
    return (
      <main className="app">
        {header}
        <Steps step={1} />
        <section className="card fade-in">
          <p className="card-title">確認メールを送りました</p>
          <p className="card-sub">
            <strong className="break">{sentTo}</strong> に届いた「メールアドレスの確認のお願い」のリンクを開くと、アカウントの作成が完了し、続けてお店の情報を入力できます。届かないときは、迷惑メールのフォルダもご確認ください。
          </p>
          {demoLink && (
            <div className="notice notice-info demo-link">
              <strong>デモ：</strong>メールの送信キーが未設定のため、メールは送られていません。下のボタンが、メールの中のリンクと同じです。
              <a className="btn btn-primary btn-block" href={demoLink} style={{ marginTop: 8 }}>
                メールのリンクを開く（デモ）
              </a>
            </div>
          )}
          <button className="btn btn-quiet btn-block" onClick={() => setSentTo(null)}>
            入力し直す
          </button>
        </section>
      </main>
    );
  }

  // 1. アカウントを作る
  return (
    <main className="app">
      {header}
      <h1 className="screen-title screen-title-tight">掲載のお申し込み（無料）</h1>
      <AuthErrorNotice code={authError} />
      <section className="card form-compact">
        <Steps step={1} />
        {hasAnyProvider(providers) && (
          <>
            <SocialButtons providers={providers} role="salon" mode="signup" next="/salon/signup" back="/salon/signup" verb="登録" />
            <OrDivider>またはメールアドレスで</OrDivider>
          </>
        )}
        <form onSubmit={createAccount} noValidate>
          <Field id="a-name" label="ご担当者のお名前" error={accountErrors.name}>
            <input id="a-name" className="input" maxLength={60} autoComplete="name" value={account.name} aria-invalid={!!accountErrors.name} onChange={(e) => setAccount({ ...account, name: e.target.value })} />
          </Field>
          <Field id="a-email" label="メールアドレス（ログインと連絡用）" error={accountErrors.email}>
            <input id="a-email" className="input" type="email" inputMode="email" autoComplete="email" value={account.email} aria-invalid={!!accountErrors.email} onChange={(e) => setAccount({ ...account, email: e.target.value })} />
          </Field>
          <Field id="a-password" label="パスワード（8文字以上）" error={accountErrors.password}>
            <PasswordInput id="a-password" isNew value={account.password} invalid={!!accountErrors.password} onChange={(v) => setAccount({ ...account, password: v })} />
          </Field>
          <div className={`field ${accountErrors.terms ? 'has-error' : ''}`}>
            <label className="check check-tight">
              <input id="a-terms" type="checkbox" checked={account.terms} onChange={(e) => setAccount({ ...account, terms: e.target.checked })} />
              <span>
                <a href={TERMS_URL} target="_blank" rel="noreferrer">利用規約</a>と<a href={PRIVACY_URL} target="_blank" rel="noreferrer">プライバシーポリシー</a>に同意します
              </span>
            </label>
            {accountErrors.terms && <span className="field-error" role="alert">{accountErrors.terms}</span>}
          </div>
          {submitError && <p className="notice notice-error" role="alert">{submitError}</p>}
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
            {busy ? '送信中…' : '確認メールを送る'}
          </button>
        </form>
        <p className="login-forgot">
          <Link href="/salon">ログイン</Link>
          <span className="link-sep" aria-hidden>／</span>
          <Link href="/apply">まずは相談する</Link>
        </p>
      </section>
    </main>
  );
}
