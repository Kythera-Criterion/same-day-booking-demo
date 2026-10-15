'use client';

// 登録の仕上げ：Google・Yahoo! JAPAN ID で登録した方（または、予約に必要な情報が足りない方）に、
// 予約に必要な情報（お名前・電話番号・性別・年代・職業・利用エリア）と、18歳以上の確認・規約への同意をお願いする。
// 入力の部品は新規登録の2段階目と共通（スマートフォンの1画面に収まる長さ）

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { Loading, NotConfigured } from '@/components/States';
import { useRoleSession } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import { safePath } from '@/lib/oauth-shared';
import { TERMS_VERSION } from '@/lib/profile-options';
import { ProfileFields, checkProfile, type ProfileErrors, type ProfileForm } from './FormParts';
import { useUserState } from './useUserState';

export default function ProfileComplete({ next: nextParam, isNew }: { next: string | null; isNew: boolean }) {
  const router = useRouter();
  const next = safePath(nextParam, '/');
  const { client, session, ready, signedOut } = useRoleSession('user');
  const { areas, profile, loaded } = useUserState(client, session);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !session) router.replace(`/login?${signedOut ? 'logged_out=1&' : ''}next=${encodeURIComponent(`/signup/complete?next=${next}`)}`);
  }, [ready, session, signedOut, router, next]);

  useEffect(() => {
    if (!profile || form) return;
    setForm({
      name: profile.display_name ?? '',
      phone: profile.phone ?? '',
      gender: profile.gender ?? '',
      age: profile.age_group ?? '',
      job: profile.occupation ?? '',
      area: profile.area_id ?? '',
      agree: !!profile.adult_confirmed_at,
    });
  }, [profile, form]);

  function set<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!client || !form || !profile) return;
    const e = checkProfile(form);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      document.getElementById(Object.keys(e)[0])?.focus();
      return;
    }
    setBusy(true);
    setSubmitError(null);
    const { error: e1 } = await client.rpc('update_my_profile', {
      p_display_name: form.name.trim(),
      p_phone: form.phone.trim(),
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
      <h1 className="screen-title screen-title-tight">{isNew ? 'あと少しで登録完了です' : 'ご予約に必要な情報'}</h1>
      {(!loaded || !form) && <Loading rows={3} />}
      {loaded && form && (
        <form className="card form-compact" onSubmit={submit} noValidate>
          {session?.user.email && (
            <p className="form-account">
              ログイン用：<strong className="break">{session.user.email}</strong>
            </p>
          )}
          <ProfileFields form={form} errors={errors} onChange={set} areas={areas} />
          {submitError && <p className="notice notice-error" role="alert">{submitError}</p>}
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
            {busy ? '登録しています…' : '登録して始める'}
          </button>
          <p className="login-forgot">
            <Link href="/">あとで入力する</Link>（予約の前に必要です）
          </p>
        </form>
      )}
    </main>
  );
}
