'use client';

// 新規登録
//   ・Google・Yahoo! JAPAN ID で登録（連携のあと、予約に必要な情報だけを入力）
//   ・メールアドレスで登録（2段階）
//       1. メールアドレスとパスワード
//       2. 氏名・電話番号・性別・年代・職業・利用エリア、18歳以上の確認、規約への同意
//     → 「メールアドレスの確認のお願い」が届く → リンクを開くと登録が完了し、そのままログインした状態になる
// ラベルは入力欄の上に常に表示し、エラーは入力欄のすぐ下に具体的に書く。選択肢はボタンにする

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { NotConfigured } from '@/components/States';
import PasswordInput from '@/components/auth/PasswordInput';
import SocialButtons, { AuthErrorNotice, OrDivider, hasAnyProvider } from '@/components/auth/SocialButtons';
import { useRoleSession } from '@/lib/supabase';
import type { Providers } from '@/lib/oauth-shared';
import { AGE_GROUPS, GENDERS, OCCUPATIONS, PRIVACY_URL, TERMS_URL, TERMS_VERSION } from '@/lib/profile-options';
import { Choices, Field } from './FormParts';
import type { Area } from './useUserState';

type Form = {
  email: string;
  password: string;
  name: string;
  phone: string;
  gender: string;
  age: string;
  job: string;
  area: string;
  adult: boolean;
  terms: boolean;
};
type Errors = Partial<Record<keyof Form, string>>;

const SIGNUP_ERROR: Record<string, string> = {
  invalid_email: 'メールアドレスの形をご確認ください。',
  weak_password: 'パスワードは8文字以上72文字以下で入力してください。',
  rate_limited: '短い時間に何度も送信されたため、少し時間をおいてお試しください。',
};

export default function Signup({ providers, authError, next = '/' }: { providers: Providers; authError?: string | null; next?: string }) {
  const router = useRouter();
  const { client, session } = useRoleSession('user');
  const [areas, setAreas] = useState<Area[]>([]);
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<Form>({ email: '', password: '', name: '', phone: '', gender: '', age: '', job: '', area: '', adult: false, terms: false });
  const [errors, setErrors] = useState<Errors>({});
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

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function check1(): Errors {
    const e: Errors = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) e.email = 'メールアドレスの形で入力してください（例：name@example.com）。';
    if (form.password.length < 8) e.password = 'パスワードは8文字以上で入力してください。';
    else if (form.password.length > 72) e.password = 'パスワードは72文字以下で入力してください。';
    return e;
  }
  function check2(): Errors {
    const e: Errors = {};
    if (!form.name.trim()) e.name = 'お名前を入力してください。';
    if (!/^0\d{1,4}-?\d{1,4}-?\d{3,4}$/.test(form.phone)) e.phone = '電話番号を数字で入力してください（例：090-1234-5678）。';
    if (!form.gender) e.gender = '性別を選んでください。';
    if (!form.age) e.age = '年代を選んでください。';
    if (!form.job) e.job = '職業を選んでください。';
    if (!form.area) e.area = '利用エリアを選んでください。';
    if (!form.adult) e.adult = 'ご利用は18歳以上の方に限ります。';
    if (!form.terms) e.terms = '利用規約とプライバシーポリシーへの同意が必要です。';
    return e;
  }

  function toStep2(ev: FormEvent) {
    ev.preventDefault();
    const e = check1();
    setErrors(e);
    if (Object.keys(e).length === 0) {
      setStep(2);
      window.scrollTo({ top: 0 });
    } else {
      document.getElementById(Object.keys(e)[0])?.focus();
    }
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e = check2();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      document.getElementById(Object.keys(e)[0])?.focus();
      return;
    }
    setBusy(true);
    setSubmitError(null);
    const email = form.email.trim().toLowerCase();
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        email,
        password: form.password,
        next,
        data: {
          display_name: form.name.trim(),
          phone: form.phone,
          gender: form.gender,
          age_group: form.age,
          occupation: form.job,
          area_id: form.area,
          adult_confirmed: 'true',
          terms_version: TERMS_VERSION,
        },
      }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string; demoLink?: string | null; demoNote?: string | null } | undefined;
    setBusy(false);
    if (!res || !res.ok) {
      setSubmitError(SIGNUP_ERROR[body?.error ?? ''] ?? `登録できませんでした（${body?.error ?? '通信エラー'}）。少し時間をおいてお試しください。`);
      return;
    }
    setDemoLink(body?.demoLink ?? null);
    setDemoNote(body?.demoNote ?? null);
    setSentTo(email);
    setCooldown(60);
    window.scrollTo({ top: 0 });
  }

  if (!client) return <NotConfigured />;

  if (sentTo) {
    return (
      <main className="app">
        <AppHeader role="利用者" />
        <section className="card fade-in">
          <p className="welcome-kicker">あと少しで完了です</p>
          <p className="card-title">確認メールを送りました</p>
          <p className="card-sub">
            <strong className="break">{sentTo}</strong> に届いた「メールアドレスの確認のお願い」のリンクを開くと、登録が完了し、そのままログインした状態になります。
          </p>
          <ul className="delete-list">
            <li>数分たっても届かないときは、迷惑メールのフォルダもご確認ください。</li>
            <li>携帯電話のメール（キャリアメール）で受信の設定をしている場合は、このサービスからのメールを受け取れるようにしてください。</li>
            <li>アドレスを間違えた場合は、「入力し直す」からやり直せます。</li>
          </ul>
          {demoLink && (
            <div className="notice notice-info demo-link">
              <strong>デモ：</strong>メールの送信キーが未設定のため、メールは送られていません（「シミュレーション送信」として記録しました）。下のボタンが、メールの中のリンクと同じです。
              <a className="btn btn-primary btn-block" href={demoLink} style={{ marginTop: 8 }}>
                メールのリンクを開く（デモ）
              </a>
            </div>
          )}
          {demoNote === 'exists' && (
            <p className="notice notice-info">
              <strong>デモ：</strong>このアドレスはすでに登録済みのため、「登録済みのお知らせ」メールを送りました（本番では、登録の有無が外から分からないよう、画面には同じ案内を出します）。
            </p>
          )}
          {resendMsg && <p className="notice notice-info">{resendMsg}</p>}
          <div className="action-pair">
            <button className="btn btn-quiet" disabled={cooldown > 0} onClick={resend}>
              {cooldown > 0 ? `もう一度送る（${cooldown}秒後）` : '確認メールをもう一度送る'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setSentTo(null);
                setDemoLink(null);
                setDemoNote(null);
                setStep(1);
              }}
            >
              入力し直す
            </button>
          </div>
          <p className="login-forgot">
            <Link href="/login">ログイン画面へ</Link>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="app">
      <AppHeader role="利用者">
        <Link href="/login">ログイン</Link>
      </AppHeader>
      <h1 className="screen-title">新規登録（無料）</h1>
      <AuthErrorNotice code={authError} />

      {step === 1 && hasAnyProvider(providers) && (
        <section className="card">
          <p className="card-title">かんたん登録</p>
          <p className="card-sub">お使いのアカウントで登録できます。パスワードを新しく決める必要はありません。</p>
          <SocialButtons providers={providers} role="user" mode="signup" next={next} back="/signup" verb="登録" />
        </section>
      )}
      {step === 1 && hasAnyProvider(providers) && <OrDivider>またはメールアドレスで登録</OrDivider>}

      <div className="progress" aria-label={`2段階のうち${step}段階目`}>
        <div className="progress-bar">
          <span style={{ width: step === 1 ? '50%' : '100%' }} />
        </div>
        <ol className="progress-steps">
          <li className={step >= 1 ? 'is-on' : ''}>1. ログイン情報</li>
          <li className={step >= 2 ? 'is-on' : ''}>2. お客様の情報</li>
        </ol>
      </div>

      {step === 1 && (
        <form className="card" onSubmit={toStep2} noValidate>
          <Field id="email" label="メールアドレス" required error={errors.email} hint="Gmail・Yahoo!メール・携帯電話のメールなど、ふだんお使いのアドレス。確認のメールをお送りします。">
            <input id="email" className="input" type="email" inputMode="email" autoComplete="email" value={form.email}
              aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : 'email-hint'}
              onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field id="password" label="パスワード" required error={errors.password} hint="8文字以上。英字・数字・記号を混ぜると安全です。">
            <PasswordInput id="password" isNew value={form.password} invalid={!!errors.password}
              describedBy={errors.password ? 'password-error' : 'password-hint'} onChange={(v) => set('password', v)} />
          </Field>
          <button className="btn btn-primary btn-lg btn-block" type="submit">
            次へ
          </button>
          <p className="login-forgot">
            すでにアカウントをお持ちの方は <Link href="/login">ログイン</Link>
          </p>
        </form>
      )}

      {step === 2 && (
        <form className="card" onSubmit={submit} noValidate>
          <Field id="name" label="お名前" required error={errors.name} hint="ご予約したお店にお伝えします。">
            <input id="name" className="input" autoComplete="name" maxLength={60} value={form.name}
              aria-invalid={!!errors.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field id="phone" label="電話番号" required error={errors.phone} hint="ご予約したお店にお伝えします。">
            <input id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel" value={form.phone}
              aria-invalid={!!errors.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field id="gender" label="性別" required error={errors.gender} hint="お店が受け付ける条件に合う枠だけを表示するために使います。お店には伝えません。">
            <Choices id="gender" options={[...GENDERS]} value={form.gender} onChange={(v) => set('gender', v)} />
          </Field>
          <Field id="age" label="年代" required error={errors.age}>
            <Choices id="age" options={[...AGE_GROUPS]} value={form.age} onChange={(v) => set('age', v)} />
          </Field>
          <Field id="job" label="職業" required error={errors.job} hint="年代・職業はお店には伝えず、サービスの改善だけに使います。">
            <Choices id="job" options={OCCUPATIONS.map((o) => ({ value: o, label: o }))} value={form.job} onChange={(v) => set('job', v)} />
          </Field>
          <Field id="area" label="利用エリア" required error={errors.area}>
            <Choices id="area" options={areas.map((a) => ({ value: a.id, label: a.name }))} value={form.area} onChange={(v) => set('area', v)} />
          </Field>

          <div className={`field ${errors.adult ? 'has-error' : ''}`}>
            <label className="check">
              <input id="adult" type="checkbox" checked={form.adult} onChange={(e) => set('adult', e.target.checked)} />
              <span>
                18歳以上です<span className="req">必須</span>
              </span>
            </label>
            {errors.adult && <span className="field-error" role="alert">{errors.adult}</span>}
          </div>
          <div className={`field ${errors.terms ? 'has-error' : ''}`}>
            <label className="check">
              <input id="terms" type="checkbox" checked={form.terms} onChange={(e) => set('terms', e.target.checked)} />
              <span>
                <a href={TERMS_URL} target="_blank" rel="noreferrer">利用規約</a>と
                <a href={PRIVACY_URL} target="_blank" rel="noreferrer">プライバシーポリシー</a>に同意します
                <span className="req">必須</span>
              </span>
            </label>
            {errors.terms && <span className="field-error" role="alert">{errors.terms}</span>}
          </div>

          {submitError && <p className="notice notice-error" role="alert">{submitError}</p>}
          <div className="action-pair">
            <button type="button" className="btn btn-quiet" onClick={() => setStep(1)}>
              戻る
            </button>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? '送信中…' : '確認メールを送る'}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
