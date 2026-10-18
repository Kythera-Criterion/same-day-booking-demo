'use client';

// 予約（下のタブの「予約」）：現在の予約と、予約の履歴だけを出す
// カルテ・登録情報・ログインの方法などは「マイページ」に分け、どちらの画面かで迷わないようにする

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { Empty, ErrorState, Loading, NotConfigured } from '@/components/States';
import { ButtonLink } from '@/components/ui/Button';
import Label, { type LabelKind } from '@/components/ui/Label';
import { Page, ScreenTitle } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import { Panel, SectionHead } from '@/components/ui/Surface';
import { CalendarCheck, CaretRight, CheckCircle, Lightning, ListBullets, Prohibit, SealCheck, Timer, XCircle } from '@/components/ui/icons';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { useRoleSession } from '@/lib/supabase';
import { AFTER_LOGOUT } from '@/lib/logout';
import { fmtDate, fmtRemaining, fmtTime, fmtYen, minutesUntil } from '@/lib/time';
import TabBar from './TabBar';
import { useUserState } from './useUserState';
import s from './Bookings.module.css';

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

export default function Bookings() {
  const router = useRouter();
  const { client, session, ready, signedOut } = useRoleSession('user');
  const { bookings, active, suspendedUntil, loaded, error, reload } = useUserState(client, session);
  const [now, setNow] = useState(() => new Date());

  // ログインしていなければログインの画面へ（別のタブでログアウトしたときは「ログアウトしました」を出す）
  useEffect(() => {
    if (ready && !session) router.replace(signedOut ? AFTER_LOGOUT.user : '/login?next=/bookings');
  }, [ready, session, signedOut, router]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!client) return <NotConfigured />;

  const history = bookings.filter((b) => b.id !== active?.id);

  return (
    <Page tabs>
      <AppHeader role="利用者">
        <Link href="/">ホーム</Link>
      </AppHeader>

      <ScreenTitle>ご予約</ScreenTitle>

      {error && <ErrorState onRetry={reload}>{error}</ErrorState>}
      {!loaded && <Loading rows={3} />}

      {loaded && (
        <div className={s.sections}>
          {suspendedUntil && (
            <Notice tone="danger" icon={Prohibit}>
              無断キャンセルが続いたため、新しいご予約をお受けできません。
              <strong> {fmtDate(suspendedUntil)} {fmtTime(suspendedUntil)}から予約できます。</strong>
            </Notice>
          )}

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
                <ButtonLink href="/?step=pick" variant="primary" size="md" block icon={Lightning} iconWeight="duotone">
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
      )}
      <TabBar activeBookingId={active?.id ?? null} />
    </Page>
  );
}
