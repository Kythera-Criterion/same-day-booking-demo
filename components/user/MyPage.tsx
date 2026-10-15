'use client';

// マイページ：現在の予約（履歴は「予約」タブ）、カルテ（髪質・カラー・パーマ）、会話の好み、登録情報、ログインの方法、予約停止中なら再開日

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { ErrorState, Loading, NotConfigured } from '@/components/States';
import { useRoleSession } from '@/lib/supabase';
import { AFTER_LOGOUT, logout } from '@/lib/logout';
import { toMessage } from '@/lib/errors';
import { AGE_GROUPS, CONVERSATION_PREFS, GENDERS, OCCUPATIONS } from '@/lib/profile-options';
import { fmtDate } from '@/lib/time';
import type { Providers } from '@/lib/oauth-shared';
import AccountSettings from './AccountSettings';
import { ActiveCard, NoActive } from './BookingsList';
import TabBar from './TabBar';
import { needsProfile, useUserState, type MyProfile } from './useUserState';


type Draft = Pick<
  MyProfile,
  'display_name' | 'phone' | 'gender' | 'age_group' | 'occupation' | 'area_id' | 'conversation_pref' | 'hair_type' | 'color_history' | 'perm_history'
>;

export default function MyPage({ providers, linked, authError }: { providers: Providers; linked?: string | null; authError?: string | null }) {
  const router = useRouter();
  const { client, session, ready, signedOut } = useRoleSession('user');
  const [deleted, setDeleted] = useState(false);
  const { areas, profile, bookings, active, suspendedUntil, loaded, error, reload } = useUserState(client, session);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState<'karte' | 'profile' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [now, setNow] = useState(() => new Date());

  // ログインしていなければログインの画面へ（別のタブでログアウトしたときは「ログアウトしました」を出す）
  useEffect(() => {
    if (ready && !session && !deleted) router.replace(signedOut ? AFTER_LOGOUT.user : '/login?next=/mypage');
  }, [ready, session, signedOut, router, deleted]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (profile) {
      setDraft({
        display_name: profile.display_name,
        phone: profile.phone,
        gender: profile.gender,
        age_group: profile.age_group,
        occupation: profile.occupation,
        area_id: profile.area_id,
        conversation_pref: profile.conversation_pref,
        hair_type: profile.hair_type,
        color_history: profile.color_history,
        perm_history: profile.perm_history,
      });
    }
  }, [profile]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  async function save(kind: 'karte' | 'profile') {
    if (!client || !draft) return;
    setSaving(kind);
    setMessage(null);
    const { error: e } = await client.rpc('update_my_profile', {
      p_display_name: draft.display_name,
      p_phone: draft.phone ?? '',
      p_gender: draft.gender,
      p_age_group: draft.age_group,
      p_occupation: draft.occupation,
      p_area_id: draft.area_id,
      p_conversation_pref: draft.conversation_pref,
      p_hair_type: draft.hair_type,
      p_color_history: draft.color_history,
      p_perm_history: draft.perm_history,
    });
    setSaving(null);
    if (e) {
      setMessage({ kind: 'error', text: toMessage(e) });
      return;
    }
    setMessage({ kind: 'ok', text: '保存しました。次のご予約から、お店にお伝えします。' });
    reload();
  }

  const [leaving, setLeaving] = useState(false);
  async function signOutHere() {
    setLeaving(true);
    await logout('user');
  }

  if (!client) return <NotConfigured />;

  if (deleted) {
    return (
      <main className="app">
        <AppHeader role="利用者" />
        <section className="card fade-in" style={{ marginTop: 16 }}>
          <p className="card-title">アカウントを削除しました</p>
          <p className="card-sub">ご利用ありがとうございました。</p>
          <Link href="/" className="btn btn-secondary btn-block">
            ホームへ
          </Link>
        </section>
      </main>
    );
  }

  const history = bookings.filter((b) => b.id !== active?.id);

  return (
    <main className="app">
      <AppHeader role="利用者" />

      <h1 className="screen-title">{profile ? `${profile.display_name} さん` : 'マイページ'}</h1>

      {error && <ErrorState onRetry={reload}>{error}</ErrorState>}
      {!loaded && <Loading rows={3} />}

      {loaded && (
        <div className="stack">
          {suspendedUntil && (
            <div className="notice notice-error">
              無断キャンセルが続いたため、新しいご予約をお受けできません。
              <strong> {fmtDate(suspendedUntil)}から予約できます。</strong>
            </div>
          )}

          {profile && needsProfile(profile) && (
            <Link href="/signup/complete?next=/mypage" className="notice notice-info finish-banner">
              <strong>登録を仕上げてください</strong>
              ご予約の前に、電話番号・18歳以上の確認などの入力が必要です。 <span className="finish-go">入力する →</span>
            </Link>
          )}

          <h2 className="section-title">現在の予約</h2>
          {active && active.slot ? <ActiveCard booking={active} now={now} /> : <NoActive />}
          <Link href="/bookings" className="btn btn-secondary btn-block">
            これまでの予約を見る（{history.length}件）
          </Link>
          {message && <p className={`notice ${message.kind === 'ok' ? 'notice-ok' : 'notice-error'}`}>{message.text}</p>}

          {draft && (
            <>
              <h2 className="section-title">カルテ・会話の好み</h2>
              <section className="card">
                <p className="card-sub">ご予約のときに、その時点の内容をお店へお伝えします。</p>
                <label className="field">
                  <span className="field-label">髪質</span>
                  <input className="input" maxLength={200} value={draft.hair_type ?? ''} onChange={(e) => set('hair_type', e.target.value)} placeholder="例：細くてやわらかい・くせが強い" />
                </label>
                <label className="field">
                  <span className="field-label">カラーの履歴</span>
                  <input className="input" maxLength={200} value={draft.color_history ?? ''} onChange={(e) => set('color_history', e.target.value)} placeholder="例：2か月前にブラウン" />
                </label>
                <label className="field">
                  <span className="field-label">パーマの履歴</span>
                  <input className="input" maxLength={200} value={draft.perm_history ?? ''} onChange={(e) => set('perm_history', e.target.value)} placeholder="例：半年前にデジタルパーマ" />
                </label>
                <div className="field">
                  <span className="field-label">施術中の会話</span>
                  <div className="segmented" role="group" aria-label="施術中の会話">
                    {CONVERSATION_PREFS.map((c) => (
                      <button key={c.value} aria-pressed={draft.conversation_pref === c.value} onClick={() => set('conversation_pref', c.value)}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button className="btn btn-primary btn-block" disabled={saving !== null} onClick={() => save('karte')}>
                  {saving === 'karte' ? '保存中…' : 'カルテを保存'}
                </button>
              </section>

              <h2 className="section-title">登録情報</h2>
              <section className="card">
                <label className="field">
                  <span className="field-label">お名前</span>
                  <input className="input" maxLength={60} value={draft.display_name} onChange={(e) => set('display_name', e.target.value)} />
                </label>
                <label className="field">
                  <span className="field-label">電話番号</span>
                  <input className="input" type="tel" value={draft.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
                </label>
                <div className="field">
                  <span className="field-label">性別</span>
                  <div className="segmented" role="group" aria-label="性別">
                    {GENDERS.map((g) => (
                      <button key={g.value} aria-pressed={draft.gender === g.value} onClick={() => set('gender', g.value)}>
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="field">
                  <span className="field-label">年代</span>
                  <select className="select" value={draft.age_group ?? ''} onChange={(e) => set('age_group', e.target.value || null)}>
                    <option value="">未設定</option>
                    {AGE_GROUPS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">職業</span>
                  <select className="select" value={draft.occupation ?? ''} onChange={(e) => set('occupation', e.target.value || null)}>
                    <option value="">未設定</option>
                    {OCCUPATIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">利用エリア</span>
                  <select className="select" value={draft.area_id ?? ''} onChange={(e) => set('area_id', e.target.value || null)}>
                    <option value="">未設定</option>
                    {areas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn btn-secondary btn-block" disabled={saving !== null} onClick={() => save('profile')}>
                  {saving === 'profile' ? '保存中…' : '登録情報を保存'}
                </button>
              </section>
            </>
          )}

          <AccountSettings
            client={client}
            hasActiveBooking={!!active}
            onDeleted={() => setDeleted(true)}
            providers={providers}
            linked={linked}
            authError={authError}
          />

          <button className="btn btn-text" disabled={leaving} onClick={signOutHere}>
            {leaving ? 'ログアウトしています…' : 'ログアウト'}
          </button>
        </div>
      )}
      <TabBar hasActive={!!active} />
    </main>
  );
}
