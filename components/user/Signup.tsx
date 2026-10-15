'use client';

// 新規登録：メールアドレスとパスワード → メールのリンクで本人確認（Supabase Auth）
// 氏名・電話番号・性別・年代・職業・利用エリア、18歳以上の確認、規約への同意

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import AppHeader from '@/components/AppHeader';
import { NotConfigured } from '@/components/States';
import { useRoleSession } from '@/lib/supabase';
import { AGE_GROUPS, GENDERS, OCCUPATIONS, PRIVACY_URL, TERMS_URL, TERMS_VERSION } from '@/lib/profile-options';
import type { Area } from './useUserState';

export default function Signup() {
  const { client } = useRoleSession('user');
  const [areas, setAreas] = useState<Area[]>([]);
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    phone: '',
    gender: '',
    age: '',
    job: '',
    area: '',
    adult: false,
    terms: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    client
      ?.from('areas')
      .select('id,name,lat,lng')
      .order('sort_order')
      .then(({ data }) => setAreas((data ?? []) as Area[]));
  }, [client]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!client) return;
    setError(null);
    if (!form.adult) return setError('ご利用は18歳以上の方に限ります。');
    if (!form.terms) return setError('利用規約とプライバシーポリシーへの同意が必要です。');
    if (!/^[0-9-]{10,13}$/.test(form.phone)) return setError('電話番号は数字（ハイフン可）で入力してください。');

    setBusy(true);
    const { data, error: e2 } = await client.auth.signUp({
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
    if (e2) {
      setError(
        e2.message.includes('rate limit')
          ? '確認メールの送信が混み合っています。少し時間をおいてお試しください。'
          : e2.message.includes('already')
            ? 'このメールアドレスはすでに登録されています。'
            : `登録できませんでした（${e2.message}）`,
      );
      return;
    }
    if (data.session) {
      window.location.href = '/';
      return;
    }
    setSentTo(form.email);
  }

  if (!client) return <NotConfigured />;

  if (sentTo) {
    return (
      <main className="app">
        <AppHeader role="利用者" />
        <section className="card fade-in">
          <p className="card-title">確認メールを送りました</p>
          <p className="card-sub">
            {sentTo} に届いたメールのリンクを開くと、登録が完了します。メールが届かないときは、迷惑メールのフォルダもご確認ください。
          </p>
          <Link className="btn btn-secondary btn-block" href="/login">
            ログイン画面へ
          </Link>
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
      <form className="card" onSubmit={submit}>
        <label className="field">
          <span className="field-label">メールアドレス</span>
          <input className="input" type="email" autoComplete="email" required value={form.email} onChange={(e) => set('email', e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">パスワード（8文字以上）</span>
          <input className="input" type="password" autoComplete="new-password" minLength={8} required value={form.password} onChange={(e) => set('password', e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">お名前</span>
          <input className="input" autoComplete="name" required maxLength={60} value={form.name} onChange={(e) => set('name', e.target.value)} />
          <span className="field-hint">ご予約したお店にお伝えします。</span>
        </label>
        <label className="field">
          <span className="field-label">電話番号</span>
          <input className="input" type="tel" autoComplete="tel" inputMode="tel" required value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          <span className="field-hint">ご予約したお店にお伝えします。</span>
        </label>

        <div className="field">
          <span className="field-label">性別</span>
          <div className="segmented" role="group" aria-label="性別">
            {GENDERS.map((g) => (
              <button type="button" key={g.value} aria-pressed={form.gender === g.value} onClick={() => set('gender', g.value)}>
                {g.label}
              </button>
            ))}
          </div>
          <span className="field-hint">お店が受け付ける条件に合う枠だけを表示するために使います。お店には伝えません。</span>
        </div>
        <label className="field">
          <span className="field-label">年代</span>
          <select className="select" required value={form.age} onChange={(e) => set('age', e.target.value)}>
            <option value="" disabled>
              選んでください
            </option>
            {AGE_GROUPS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">職業</span>
          <select className="select" required value={form.job} onChange={(e) => set('job', e.target.value)}>
            <option value="" disabled>
              選んでください
            </option>
            {OCCUPATIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <span className="field-hint">年代・職業はお店には伝えず、サービスの改善だけに使います。</span>
        </label>
        <label className="field">
          <span className="field-label">利用エリア</span>
          <select className="select" required value={form.area} onChange={(e) => set('area', e.target.value)}>
            <option value="" disabled>
              選んでください
            </option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>

        <label className="check">
          <input type="checkbox" checked={form.adult} onChange={(e) => set('adult', e.target.checked)} />
          <span>18歳以上です</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={form.terms} onChange={(e) => set('terms', e.target.checked)} />
          <span>
            <a href={TERMS_URL} target="_blank" rel="noreferrer">
              利用規約
            </a>
            と
            <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
              プライバシーポリシー
            </a>
            に同意します
          </span>
        </label>

        {error && <p className="notice notice-error">{error}</p>}
        <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy || !form.gender}>
          {busy ? '送信中…' : '確認メールを送る'}
        </button>
      </form>
    </main>
  );
}
