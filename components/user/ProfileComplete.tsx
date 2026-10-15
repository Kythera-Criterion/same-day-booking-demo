'use client';

// 登録の仕上げ：Google・Yahoo! JAPAN ID で登録した方（または、予約に必要な情報が足りない方）に、
// 予約に必要な情報（お名前・電話番号・性別・年代・職業・利用エリア）と、18歳以上の確認・規約への同意をお願いする

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { Loading, NotConfigured } from '@/components/States';
import { useRoleSession } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import { safePath } from '@/lib/oauth-shared';
import { AGE_GROUPS, GENDERS, OCCUPATIONS, PRIVACY_URL, TERMS_URL, TERMS_VERSION } from '@/lib/profile-options';
import { Choices, Field } from './FormParts';
import { useUserState } from './useUserState';

type Form = { name: string; phone: string; gender: string; age: string; job: string; area: string; adult: boolean; terms: boolean };
type Errors = Partial<Record<keyof Form, string>>;

export default function ProfileComplete({ next: nextParam, isNew }: { next: string | null; isNew: boolean }) {
  const router = useRouter();
  const next = safePath(nextParam, '/');
  const { client, session, ready } = useRoleSession('user');
  const { areas, profile, loaded } = useUserState(client, session);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !session) router.replace(`/login?next=${encodeURIComponent(`/signup/complete?next=${next}`)}`);
  }, [ready, session, router, next]);

  useEffect(() => {
    if (!profile || form) return;
    setForm({
      name: profile.display_name ?? '',
      phone: profile.phone ?? '',
      gender: profile.gender ?? '',
      age: profile.age_group ?? '',
      job: profile.occupation ?? '',
      area: profile.area_id ?? '',
      adult: !!profile.adult_confirmed_at,
      terms: !!profile.adult_confirmed_at,
    });
  }, [profile, form]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function check(f: Form): Errors {
    const e: Errors = {};
    if (!f.name.trim()) e.name = 'お名前を入力してください。';
    if (!/^0\d{1,4}-?\d{1,4}-?\d{3,4}$/.test(f.phone)) e.phone = '電話番号を数字で入力してください（例：090-1234-5678）。';
    if (!f.gender) e.gender = '性別を選んでください。';
    if (!f.age) e.age = '年代を選んでください。';
    if (!f.job) e.job = '職業を選んでください。';
    if (!f.area) e.area = '利用エリアを選んでください。';
    if (!f.adult) e.adult = 'ご利用は18歳以上の方に限ります。';
    if (!f.terms) e.terms = '利用規約とプライバシーポリシーへの同意が必要です。';
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!client || !form || !profile) return;
    const e = check(form);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      document.getElementById(Object.keys(e)[0])?.focus();
      return;
    }
    setBusy(true);
    setSubmitError(null);
    const { error: e1 } = await client.rpc('update_my_profile', {
      p_display_name: form.name.trim(),
      p_phone: form.phone,
      p_gender: form.gender,
      p_age_group: form.age,
      p_occupation: form.job,
      p_area_id: form.area,
      p_conversation_pref: profile.conversation_pref,
      p_hair_type: profile.hair_type,
      p_color_history: profile.color_history,
      p_perm_history: profile.perm_history,
    });
    const { error: e2 } = e1 ? { error: null } : await client.rpc('confirm_terms', { p_version: TERMS_VERSION, p_adult: true });
    setBusy(false);
    if (e1 || e2) {
      setSubmitError(toMessage(e1 ?? e2));
      return;
    }
    router.replace(next);
  }

  if (!client) return <NotConfigured />;

  return (
    <main className="app">
      <AppHeader role="利用者" />
      {isNew && <p className="notice notice-ok">アカウントを作成しました。あと少しで登録が完了します。</p>}
      <h1 className="screen-title">ご予約に必要な情報</h1>
      <p className="card-sub" style={{ marginTop: -6 }}>
        ご予約の前に、次の情報を登録してください。{session?.user.email && <>ログイン用メールアドレス：<strong className="break">{session.user.email}</strong></>}
      </p>
      {(!loaded || !form) && <Loading rows={3} />}
      {loaded && form && (
        <form className="card" onSubmit={submit} noValidate>
          <Field id="name" label="お名前" required error={errors.name} hint="ご予約したお店にお伝えします。">
            <input id="name" className="input" autoComplete="name" maxLength={60} value={form.name} aria-invalid={!!errors.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field id="phone" label="電話番号" required error={errors.phone} hint="ご予約したお店にお伝えします。">
            <input id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} aria-invalid={!!errors.phone} onChange={(e) => set('phone', e.target.value)} />
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
                <a href={TERMS_URL} target="_blank" rel="noreferrer">利用規約</a>と<a href={PRIVACY_URL} target="_blank" rel="noreferrer">プライバシーポリシー</a>に同意します
                <span className="req">必須</span>
              </span>
            </label>
            {errors.terms && <span className="field-error" role="alert">{errors.terms}</span>}
          </div>
          {submitError && <p className="notice notice-error" role="alert">{submitError}</p>}
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
            {busy ? '登録しています…' : '登録して始める'}
          </button>
          <p className="fine-print" style={{ textAlign: 'center' }}>
            あとで入力する場合は <Link href="/">ホームへ</Link>（空き枠は見られますが、予約の前に入力が必要です）
          </p>
        </form>
      )}
    </main>
  );
}
