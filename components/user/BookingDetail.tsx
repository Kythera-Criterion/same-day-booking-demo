'use client';

// 予約確定画面＝来店までのライブ画面。
// お店の写真、開始までの残り時間（減っていく円）、受付で見せる予約番号のチケット、出発の目安、地図・電話。サロンの操作で、その場で表示が切り替わる

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import RemainRing from '@/components/RemainRing';
import { ErrorState, Loading, NotConfigured } from '@/components/States';
import Button, { ButtonLink } from '@/components/ui/Button';
import { Fine, Page, Pair, Stack } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import SalonPhoto from '@/components/ui/SalonPhoto';
import { DataList, Panel, SectionHead } from '@/components/ui/Surface';
import {
  CalendarX,
  CheckCircle,
  House,
  Lightning,
  MapPin,
  NavigationArrow,
  PersonSimpleWalk,
  Phone,
  SealCheck,
  Storefront,
  Ticket,
  XCircle,
} from '@/components/ui/icons';
import { one, useRoleSession } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import { distanceKm } from '@/lib/geo';
import { loadOrigin } from '@/lib/origin';
import { CONVERSATION_PREFS, label } from '@/lib/profile-options';
import { UI_OPTIONS } from '@/lib/ui-options';
import { fmtDate, fmtTime, fmtYen } from '@/lib/time';
import { leaveBy, walkMinutes } from '@/lib/walk';
import Survey from './Survey';
import TabBar from './TabBar';
import s from './BookingDetail.module.css';

type Salon = { id: string; name: string; address: string; phone: string | null; lat: number; lng: number };
type Menu = { name: string; duration_min: number };
type Detail = {
  id: string;
  status: string;
  booking_no: number | null;
  created_at: string;
  note: string | null;
  photo_path: string | null;
  conversation_pref: string | null;
  start_at: string;
  end_at: string;
  price: number;
  menu: Menu | null;
  salon: Salon | null;
};
type Raw = Omit<Detail, 'start_at' | 'end_at' | 'price' | 'menu' | 'salon'> & {
  slots: { start_at: string; end_at: string; price: number; menus: Menu | Menu[] | null; salons: Salon | Salon[] | null } | null;
};

const ENDED: Record<string, { title: string; tone: string; text: string; search: boolean }> = {
  completed: { title: 'ご来店ありがとうございました', tone: 'done', text: 'またのご利用をお待ちしています。', search: false },
  cancelled_by_salon: {
    title: 'サロンの都合でキャンセルになりました',
    tone: 'cancel',
    text: 'ご迷惑をおかけしました。お支払いは発生していません。お知らせのメールもお送りしています。',
    search: true,
  },
  cancelled_by_customer: { title: 'キャンセルを承りました', tone: 'cancel', text: 'お店へのご連絡ありがとうございました。', search: true },
  no_show: { title: 'ご来店が確認できませんでした', tone: 'cancel', text: 'お店から無断キャンセルとして記録されました。', search: false },
};

export default function BookingDetail({ bookingId, isNew }: { bookingId: string; isNew: boolean }) {
  const router = useRouter();
  const { client, session, ready, signedOut } = useRoleSession('user');
  const [d, setD] = useState<Detail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [walk, setWalk] = useState<{ min: number; label: string } | null>(null);

  useEffect(() => {
    if (ready && !session) router.replace(`/login?${signedOut ? 'logged_out=1&' : ''}next=${encodeURIComponent(`/booking/${bookingId}`)}`);
  }, [ready, session, signedOut, router, bookingId]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!client || !session) return;
    // 途中で切れた・書き間違えたリンクは、「見つかりません」として扱う
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
      setD(null);
      return;
    }
    const { data, error: e } = await client
      .from('bookings')
      .select(
        'id,status,booking_no,created_at,note,photo_path,conversation_pref,slots(start_at,end_at,price,menus(name,duration_min),salons(id,name,address,phone,lat,lng))',
      )
      .eq('id', bookingId)
      .maybeSingle();
    if (e) {
      setError(toMessage(e));
      return;
    }
    const raw = data as Raw | null;
    const slot = raw ? one(raw.slots) : null;
    if (!raw || !slot) {
      setD(null);
      return;
    }
    setD({ ...raw, start_at: slot.start_at, end_at: slot.end_at, price: slot.price, menu: one(slot.menus), salon: one(slot.salons) });
  }, [client, session, bookingId]);

  useEffect(() => {
    load();
  }, [load]);

  // 歩いて何分か：ホームで使った基準地点（現在地または利用エリアの基準地点）から、端末の中で計算する
  useEffect(() => {
    if (!d?.salon) return;
    const o = loadOrigin();
    if (!o) return;
    setWalk({ min: walkMinutes(distanceKm(o, d.salon)), label: o.label });
  }, [d?.salon]);

  // サロンが来店済み・キャンセルにしたら、その場で表示を変える。
  // 受け取りの準備ができた時点でも読み直し（準備の間に変わった分を取りこぼさない）、念のため30秒ごとにも読み直す
  const signedIn = !!session;
  useEffect(() => {
    if (!client || !signedIn) return;
    const channel = client
      .channel(`booking-${bookingId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${bookingId}` }, () => {
        setChanged(true);
        load();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') load();
      });
    const timer = setInterval(load, 30_000);
    return () => {
      client.removeChannel(channel);
      clearInterval(timer);
    };
  }, [client, signedIn, bookingId, load]);

  if (!client) return <NotConfigured />;

  const ended = d ? ENDED[d.status] : undefined;
  const startMs = d ? new Date(d.start_at).getTime() : 0;
  const remainMin = d ? Math.max(0, Math.ceil((startMs - now.getTime()) / 60_000)) : 0;
  const totalMs = d ? Math.max(60_000, startMs - new Date(d.created_at).getTime()) : 1;
  const fraction = d ? (startMs - now.getTime()) / totalMs : 0;
  const leave = d && walk ? leaveBy(new Date(d.start_at), walk.min) : null;
  const mapUrl = d?.salon ? `https://www.google.com/maps/search/?api=1&query=${d.salon.lat},${d.salon.lng}` : '#';
  const stage = d?.status === 'completed' ? 2 : 1;

  return (
    <Page tabs>
      <AppHeader role="利用者">
        <Link href="/mypage">マイページ</Link>
      </AppHeader>

      {error && <ErrorState onRetry={load}>{error}</ErrorState>}
      {d === undefined && !error && <Loading rows={3} />}
      {d === null && (
        <Panel>
          <SectionHead icon={CalendarX} title="予約が見つかりませんでした" />
          <ButtonLink href="/" variant="secondary" size="md" block>
            ホームへ
          </ButtonLink>
        </Panel>
      )}

      {d && (
        <>
          <div className={s.hero}>
          <SalonPhoto
            salonId={d.salon?.id}
            salonName={d.salon?.name ?? ''}
            variant="hero"
            priority
            caption={
              <span className={s.heroCaption}>
                <span className={`${s.heroTime} num`}>
                  {fmtDate(d.start_at)} {fmtTime(d.start_at)}〜{fmtTime(d.end_at)}
                </span>
                <span className={s.heroName}>{d.salon?.name}</span>
              </span>
            }
          />
          </div>
          <Stack gap={3}>
            {!ended || d.status === 'completed' ? (
              <ol className={s.flow} aria-label="予約の流れ">
                <li data-state={stage >= 1 ? 'done' : undefined}>
                  <CheckCircle size={20} weight={stage >= 1 ? 'fill' : 'regular'} aria-hidden focusable="false" />
                  予約確定
                </li>
                <li data-state={stage >= 2 ? 'done' : stage === 1 ? 'next' : undefined}>
                  <SealCheck size={20} weight={stage >= 2 ? 'fill' : 'regular'} aria-hidden focusable="false" />
                  来店
                </li>
              </ol>
            ) : null}

            {ended ? (
              <section className={`${s.ended} ${changed ? s.changed : ''}`} role="status">
                <p className={s.endedTitle} data-tone={ended.tone}>
                  {ended.tone === 'done' ? (
                    <SealCheck size={24} weight="fill" aria-hidden focusable="false" />
                  ) : (
                    <XCircle size={24} weight="duotone" aria-hidden focusable="false" />
                  )}
                  {ended.title}
                </p>
                <p className={s.endedText}>{ended.text}</p>
                {ended.search && (
                  <ButtonLink href="/" variant="primary" size="md" block icon={Lightning} iconWeight="duotone">
                    ほかの枠を探す
                  </ButtonLink>
                )}
              </section>
            ) : (
              <section className={`${s.live} ${changed ? s.changed : ''}`} data-live="">
                <p className={s.liveLabel}>
                  <CheckCircle size={24} weight="fill" aria-hidden focusable="false" />
                  {isNew ? '予約が確定しました' : 'ご予約中'}
                </p>
                <RemainRing fraction={fraction} label={`開始まであと${remainMin}分`}>
                  <span className={s.liveSub}>開始まで</span>
                  <span className={`${s.liveMain} num`} data-long={remainMin >= 60 ? 'true' : undefined}>
                    {remainMin > 0 ? (
                      <>
                        あと<strong>{remainMin >= 60 ? `${Math.floor(remainMin / 60)}時間${remainMin % 60}` : remainMin}</strong>分
                      </>
                    ) : (
                      'まもなく'
                    )}
                  </span>
                  <span className={`${s.liveSub} num`}>
                    {fmtTime(d.start_at)}〜{fmtTime(d.end_at)}
                  </span>
                </RemainRing>
                {UI_OPTIONS.showBookingNo && d.booking_no !== null && (
                  <div className={s.ticket}>
                    <span className={s.ticketIcon}>
                      <Ticket size={24} weight="duotone" aria-hidden focusable="false" />
                    </span>
                    <span className={s.ticketLabel}>予約番号</span>
                    <strong className={s.ticketNo}>{d.booking_no}</strong>
                    <small className={s.ticketNote}>受付でお伝えください</small>
                  </div>
                )}
                {UI_OPTIONS.showDeparture && walk && leave && (
                  <p className={`${s.depart} num`}>
                    <PersonSimpleWalk size={20} aria-hidden focusable="false" />
                    {walk.label === '現在地' ? '' : '基準地点から'}歩いて約{walk.min}分。
                    {leave.getTime() > now.getTime() ? `${fmtTime(leave)}ごろに出れば間に合います。` : 'そろそろ出発しましょう。'}
                  </p>
                )}
              </section>
            )}

            <Panel className={s.shop}>
              <SectionHead icon={Storefront} title={d.salon?.name} />
              <p className={s.shopAddress}>
                <MapPin size={20} aria-hidden focusable="false" />
                {d.salon?.address}
              </p>
              <Pair>
                <ButtonLink href={mapUrl} variant="secondary" size="lg" icon={NavigationArrow} target="_blank" rel="noopener noreferrer">
                  地図を開く
                </ButtonLink>
                {d.salon?.phone ? (
                  <ButtonLink href={`tel:${d.salon.phone}`} variant="primary" size="lg" icon={Phone}>
                    電話する
                  </ButtonLink>
                ) : (
                  <Button variant="quiet" size="lg" icon={Phone} aria-disabled>
                    電話番号なし
                  </Button>
                )}
              </Pair>
              <Fine>地図にはお店の位置だけを渡します。あなたの現在地は渡しません。</Fine>
            </Panel>

            <Panel>
              <SectionHead icon={Ticket} title="予約の内容" />
              <DataList
                items={[
                  ['日時', <span key="t" className="num">{`${fmtDate(d.start_at)} ${fmtTime(d.start_at)}〜${fmtTime(d.end_at)}`}</span>],
                  ['メニュー', d.menu?.name],
                  ['所要時間', <span key="m" className="num">{`${d.menu?.duration_min}分`}</span>],
                  [
                    '合計',
                    <span key="p" className="num">
                      <strong>{fmtYen(d.price)}</strong>（店頭でお支払い）
                    </span>,
                  ],
                  ...(d.conversation_pref ? ([['会話', label(CONVERSATION_PREFS, d.conversation_pref)]] as [string, string][]) : []),
                  ...(d.note ? ([['メモ', d.note]] as [string, string][]) : []),
                  ...(d.photo_path ? ([['写真', '1枚をお店と共有しています']] as [string, string][]) : []),
                ]}
              />
            </Panel>

            {d.status === 'confirmed' && (
              <Notice tone="neutral" icon={Phone}>
                変更・キャンセルはお店へ直接お電話ください。
              </Notice>
            )}
            {isNew && d.status === 'confirmed' && <Survey client={client} bookingId={d.id} />}

            <ButtonLink href="/" variant="text" icon={House}>
              ホームへ戻る
            </ButtonLink>
          </Stack>
        </>
      )}
      <TabBar activeBookingId={d && d.status === 'confirmed' ? d.id : null} />
    </Page>
  );
}
