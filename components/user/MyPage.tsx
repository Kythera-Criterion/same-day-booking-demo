'use client';

// マイページ：現在の予約、予約の履歴、カルテ（髪質・カラー・パーマ）、会話の好み、予約停止中なら再開日

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { Empty, ErrorState, Loading, NotConfigured } from '@/components/States';
import Button, { ButtonLink } from '@/components/ui/Button';
import { Input, LabeledField, Select, formClass } from '@/components/ui/Form';
import Label, { type LabelKind } from '@/components/ui/Label';
import { Page, ScreenTitle } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import {
  CalendarCheck,
  CaretRight,
  CheckCircle,
  House,
  IdentificationCard,
  Lightning,
  ListBullets,
  NotePencil,
  Prohibit,
  SealCheck,
  SignOut,
  Timer,
  XCircle,
} from '@/components/ui/icons';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { useRoleSession } from '@/lib/supabase';
import { AFTER_LOGOUT, logout } from '@/lib/logout';
import { toMessage } from '@/lib/errors';
import { AGE_GROUPS, CONVERSATION_PREFS, GENDERS, OCCUPATIONS } from '@/lib/profile-options';
import { fmtDate, fmtRemaining, fmtTime, fmtYen, minutesUntil } from '@/lib/time';
import type { Providers } from '@/lib/oauth-shared';
import AccountSettings from './AccountSettings';
import TabBar from './TabBar';
import { needsProfile, useUserState, type MyProfile } from './useUserState';
import s from './MyPage.module.css';

const STATUS_LABEL: Record<string, string> = {
  confirmed: '予約中',
  completed: '来店済み',
  no_show: '無断キャンセル',
  cancelled_by_salon: 'サロン都合のキャンセル',
  cancelled_by_customer: 'キャンセル（お店へ連絡済み）',
};

// 履歴の状態のラベル：色だけでなく、アイコンでも区別する
const STATUS_LOOK: Record<string, { kind: LabelKind; icon: PhosphorIcon }> = {
  confirmed: { kind: 'action', icon: CheckCircle },
  completed: { kind: 'state', icon: SealCheck },
  no_show: { kind: 'danger', icon: Prohibit },
  cancelled_by_salon: { kind: 'state', icon: XCircle },
  cancelled_by_customer: { kind: 'state', icon: XCircle },
};

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

  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    if (profile && filledFor.current !== profile.id) {
      filledFor.current = profile.id;
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

  // 「カルテを保存」はカルテ・会話の好みだけ、「登録情報を保存」は登録情報だけを保存する（もう一方の入力中の内容は、保存しない）
  async function save(kind: 'karte' | 'profile') {
    if (!client || !draft || !profile) return;
    const base = kind === 'karte' ? profile : draft;
    const karte = kind === 'karte' ? draft : profile;
    setSaving(kind);
    setMessage(null);
    const { error: e } = await client.rpc('update_my_profile', {
      p_display_name: base.display_name,
      p_phone: base.phone ?? '',
      p_gender: base.gender,
      p_age_group: base.age_group,
      p_occupation: base.occupation,
      p_area_id: base.area_id,
      p_conversation_pref: karte.conversation_pref,
      p_hair_type: karte.hair_type,
      p_color_history: karte.color_history,
      p_perm_history: karte.perm_history,
    });
    setSaving(null);
    if (e) {
      setMessage({
        kind: 'error',
        text:
          kind === 'profile' && e.message.includes('suspended')
            ? '予約停止中は、電話番号を変更できません（予約停止は電話番号で判定するため）。電話番号を元に戻して保存してください。'
            : toMessage(e),
      });
      return;
    }
    setMessage({ kind: 'ok', text: kind === 'karte' ? 'カルテを保存しました。次のご予約から、お店にお伝えします。' : '登録情報を保存しました。' });
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
      <Page>
        <AppHeader role="利用者" />
        <Panel as="section" className={s.deleted}>
          <div className={s.deletedBody}>
            <SectionHead icon={CheckCircle} title="アカウントを削除しました" as="p" />
            <SubText>ご利用ありがとうございました。</SubText>
            <ButtonLink href="/" variant="secondary" size="md" block icon={House}>
              ホームへ
            </ButtonLink>
          </div>
        </Panel>
      </Page>
    );
  }

  const history = bookings.filter((b) => b.id !== active?.id);

  return (
    <Page tabs>
      <AppHeader role="利用者">
        <Link href="/">ホーム</Link>
      </AppHeader>

      <ScreenTitle>{profile ? `${profile.display_name} さん` : 'マイページ'}</ScreenTitle>

      {error && <ErrorState onRetry={reload}>{error}</ErrorState>}
      {!loaded && <Loading rows={3} />}

      {loaded && (
        <div className={s.sections}>
          {(suspendedUntil || (profile && needsProfile(profile))) && (
            <div className={s.alerts}>
              {suspendedUntil && (
                <Notice tone="danger" icon={Prohibit}>
                  無断キャンセルが続いたため、新しいご予約をお受けできません。
                  <strong> {fmtDate(suspendedUntil)} {fmtTime(suspendedUntil)}から予約できます。</strong>
                </Notice>
              )}

              {profile && needsProfile(profile) && (
                <Link href="/signup/complete?next=/mypage" className={s.finish}>
                  <NotePencil size={20} aria-hidden focusable="false" />
                  <span>
                    <strong>登録を仕上げてください</strong>
                    ご予約の前に、電話番号・18歳以上の確認などの入力が必要です。 <span className={s.finishGo}>入力する →</span>
                  </span>
                </Link>
              )}
            </div>
          )}

          <div id="bookings" className={s.bookings}>
            <section className={s.section}>
              <SectionHead icon={CalendarCheck} title="現在の予約" />
              {active && active.slot ? (
                <Link href={`/booking/${active.id}`} className={s.active}>
                  <span className={s.activeLabel}>
                    <CheckCircle size={20} weight="fill" aria-hidden focusable="false" />
                    ご予約中
                  </span>
                  <span className={`${s.activeTime} num`}>
                    <span className={s.today}>今日</span> <span className={s.clock}>{fmtTime(active.slot.start_at)}</span>
                    <em>
                      <Timer size={20} weight="duotone" aria-hidden focusable="false" />
                      {fmtRemaining(minutesUntil(active.slot.start_at, now))}
                    </em>
                  </span>
                  <span className={s.activeSub}>
                    {active.slot.salon?.name} ・ {active.slot.menu?.name}
                  </span>
                  <span className={s.activeGo}>予約内容を見る →</span>
                </Link>
              ) : (
                <Panel className={s.emptyPanel}>
                  <Empty>いまご予約はありません。</Empty>
                  <ButtonLink href="/" variant="primary" size="md" block icon={Lightning} iconWeight="duotone">
                    今から行けるお店を探す
                  </ButtonLink>
                </Panel>
              )}
            </section>

            <section className={s.section}>
              <SectionHead icon={ListBullets} title="予約の履歴" />
              <Panel flush>
                {history.length === 0 ? (
                  <Empty>履歴はまだありません。</Empty>
                ) : (
                  <ul className={s.history} data-history="">
                    {history.map((b) => {
                      const look = STATUS_LOOK[b.status] ?? STATUS_LOOK.cancelled_by_customer;
                      return (
                        <li key={b.id}>
                          <Link href={`/booking/${b.id}`}>
                            <span className={s.historyBody}>
                              <span className={`${s.historyDate} num`}>
                                {b.slot ? `${fmtDate(b.slot.start_at)} ${fmtTime(b.slot.start_at)}` : '--'}
                              </span>
                              <span className={s.historySub}>
                                {b.slot?.salon?.name} ・ {b.slot?.menu?.name} ・ {b.slot ? fmtYen(b.slot.price) : ''}
                              </span>
                              <Label kind={look.kind} icon={look.icon} className={s.historyState}>
                                {STATUS_LABEL[b.status] ?? b.status}
                              </Label>
                            </span>
                            <CaretRight size={20} className={s.historyCaret} aria-hidden focusable="false" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
            </section>
          </div>

          {message && <Notice tone={message.kind === 'ok' ? 'success' : 'danger'}>{message.text}</Notice>}

          {draft && (
            <>
              <section className={s.section}>
                <SectionHead icon={NotePencil} title="カルテ・会話の好み" />
                <Panel>
                  <p className={s.lead}>ご予約のときに、その時点の内容をお店へお伝えします。</p>
                  <LabeledField label="髪質">
                    <Input maxLength={200} value={draft.hair_type ?? ''} onChange={(e) => set('hair_type', e.target.value)} placeholder="例：細くてやわらかい・くせが強い" />
                  </LabeledField>
                  <LabeledField label="カラーの履歴">
                    <Input maxLength={200} value={draft.color_history ?? ''} onChange={(e) => set('color_history', e.target.value)} placeholder="例：2か月前にブラウン" />
                  </LabeledField>
                  <LabeledField label="パーマの履歴">
                    <Input maxLength={200} value={draft.perm_history ?? ''} onChange={(e) => set('perm_history', e.target.value)} placeholder="例：半年前にデジタルパーマ" />
                  </LabeledField>
                  <div className={formClass.field}>
                    <span className={formClass.label}>施術中の会話</span>
                    <div className={s.choices} role="group" aria-label="施術中の会話">
                      {CONVERSATION_PREFS.map((c) => (
                        <button key={c.value} type="button" className={formClass.choice} aria-pressed={draft.conversation_pref === c.value} onClick={() => set('conversation_pref', c.value)}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button variant="primary" size="md" block disabled={saving !== null} onClick={() => save('karte')}>
                    {saving === 'karte' ? '保存中…' : 'カルテを保存'}
                  </Button>
                </Panel>
              </section>

              <section className={s.section}>
                <SectionHead icon={IdentificationCard} title="登録情報" />
                <Panel>
                  <LabeledField label="お名前">
                    <Input maxLength={60} value={draft.display_name} onChange={(e) => set('display_name', e.target.value)} />
                  </LabeledField>
                  <LabeledField label="電話番号">
                    <Input type="tel" value={draft.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
                  </LabeledField>
                  <div className={formClass.field}>
                    <span className={formClass.label}>性別</span>
                    <div className={s.choices} role="group" aria-label="性別">
                      {GENDERS.map((g) => (
                        <button key={g.value} type="button" className={formClass.choice} aria-pressed={draft.gender === g.value} onClick={() => set('gender', g.value)}>
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <LabeledField label="年代">
                    <Select value={draft.age_group ?? ''} onChange={(e) => set('age_group', e.target.value || null)}>
                      <option value="">未設定</option>
                      {AGE_GROUPS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </Select>
                  </LabeledField>
                  <LabeledField label="職業">
                    <Select value={draft.occupation ?? ''} onChange={(e) => set('occupation', e.target.value || null)}>
                      <option value="">未設定</option>
                      {OCCUPATIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  </LabeledField>
                  <LabeledField label="利用エリア">
                    <Select value={draft.area_id ?? ''} onChange={(e) => set('area_id', e.target.value || null)}>
                      <option value="">未設定</option>
                      {areas.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </Select>
                  </LabeledField>
                  <Button variant="secondary" size="md" block disabled={saving !== null} onClick={() => save('profile')}>
                    {saving === 'profile' ? '保存中…' : '登録情報を保存'}
                  </Button>
                </Panel>
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

          <Button variant="text" icon={SignOut} className={s.signOut} disabled={leaving} onClick={signOutHere}>
            {leaving ? 'ログアウトしています…' : 'ログアウト'}
          </Button>
        </div>
      )}
      <TabBar activeBookingId={active?.id ?? null} />
    </Page>
  );
}
