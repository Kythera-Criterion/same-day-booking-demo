'use client';

// 新規登録（2段階）
//   1. メールアドレスとパスワード
//   2. 氏名・電話番号・性別・年代・職業・利用エリア、18歳以上の確認、規約への同意
// ラベルは入力欄の上に常に表示し、エラーは入力欄のすぐ下に具体的に書く。選択肢はボタンにする

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import AppHeader from '@/components/AppHeader';
import { NotConfigured } from '@/components/States';
import { useRoleSession } from '@/lib/supabase';
import { AGE_GROUPS, GENDERS, OCCUPATIONS, PRIVACY_URL, TERMS_URL, TERMS_VERSION } from '@/lib/profile-options';
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

function Field({ id, label, required, error, hint, children }: { id: string; label: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label className="field-label" htmlFor={id} id={`${id}-label`}>
        {label}
        {required && <span className="req">必須</span>}
      </label>
      {children}
      {hint && !error && <span className="field-hint" id={`${id}-hint`}>{hint}</span>}
      {error && (
        <span className="field-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function Choices({ id, options, value, onChange }: { id: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div id={id} tabIndex={-1} className="choice-row" role="radiogroup" aria-labelledby={`${id}-label`}>
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value} className="choice" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function Signup() {
  const { client } = useRoleSession('user');
  const [areas, setAreas] = useState<Area[]>([]);
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<Form>({ email: '', password: '', name: '', phone: '', gender: '', age: '', job: '', area: '', adult: false, terms: false });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  // 確認メールの再送は60秒おきまで（送りすぎると制限にかかるため）
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function resend() {
    if (!client || !sentTo) return;
    setResendMsg(null);
    const { error } = await client.auth.resend({
      type: 'signup',
      email: sentTo,
      options: { emailRedirectTo: `${window.location.origin}/login?verified=1` },
    });
    setCooldown(60);
    setResendMsg(error ? '送信が混み合っています。少し時間をおいてお試しください。' : '確認メールをもう一度送りました。');
  }

  useEffect(() => {
    client
      ?.from('areas')
      .select('id,name,lat,lng')
      .order('sort_order')
      .then(({ data }) => setAreas((data ?? []) as Area[]));
  }, [client]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function check1(): Errors {
    const e: Errors = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) e.email = 'メールアドレスの形で入力してください（例：name@example.com）。';
    if (form.password.length < 8) e.password = 'パスワードは8文字以上で入力してください。';
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

  function next(ev: FormEvent) {
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
    if (!client) return;
    const e = check2();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      document.getElementById(Object.keys(e)[0])?.focus();
      return;
    }
    setBusy(true);
    setSubmitError(null);
    const { data, error } = await client.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/login?verified=1`,
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
      },
    });
    setBusy(false);
    if (error) {
      setSubmitError(
        error.message.includes('rate limit')
          ? '確認メールの送信が混み合っています。少し時間をおいてお試しください。'
          : error.message.includes('already')
            ? 'このメールアドレスはすでに登録されています。ログインしてください。'
            : `登録できませんでした（${error.message}）`,
      );
      return;
    }
    if (data.session) {
      window.location.href = '/';
      return;
    }
    setSentTo(form.email);
    setCooldown(60);
  }

  if (!client) return <NotConfigured />;

  if (sentTo) {
    return (
      <main className="app">
        <AppHeader role="利用者" />
        <section className="card fade-in">
          <p className="card-title">確認メールを送りました</p>
          <p className="card-sub">
            {sentTo} に届いたメールのリンクを開くと、登録が完了します。届かないときは、迷惑メールのフォルダもご確認ください。
          </p>
          {resendMsg && <p className="notice notice-info">{resendMsg}</p>}
          <div className="action-pair">
            <button className="btn btn-quiet" disabled={cooldown > 0} onClick={resend}>
              {cooldown > 0 ? `もう一度送る（${cooldown}秒後）` : '確認メールをもう一度送る'}
            </button>
            <Link className="btn btn-secondary" href="/login">
              ログイン画面へ
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app">
      <AppHeader role="利用者">
        <Link href="/login">ログイン</Link>
      </AppHeader>
      <h1 className="screen-title">新規登録</h1>
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
        <form className="card" onSubmit={next} noValidate>
          <Field id="email" label="メールアドレス" required error={errors.email} hint="確認のメールをお送りします。">
            <input id="email" className="input" type="email" inputMode="email" autoComplete="email" value={form.email}
              aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : 'email-hint'}
              onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field id="password" label="パスワード" required error={errors.password} hint="8文字以上">
            <input id="password" className="input" type="password" autoComplete="new-password" value={form.password}
              aria-invalid={!!errors.password} aria-describedby={errors.password ? 'password-error' : 'password-hint'}
              onChange={(e) => set('password', e.target.value)} />
          </Field>
          <button className="btn btn-primary btn-lg btn-block" type="submit">
            次へ
          </button>
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
