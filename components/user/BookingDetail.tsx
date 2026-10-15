'use client';

// 予約確定画面＝来店までのライブ画面。
// 開始までの残り時間（減っていく円）、予約番号、出発の目安、地図・電話。サロンの操作で、その場で表示が切り替わる

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import RemainRing from '@/components/RemainRing';
import { ErrorState, Loading, NotConfigured } from '@/components/States';
import { one, useRoleSession } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import { distanceKm } from '@/lib/geo';
import { loadOrigin } from '@/lib/origin';
import { CONVERSATION_PREFS, label } from '@/lib/profile-options';
import { UI_OPTIONS } from '@/lib/ui-options';
import { fmtDate, fmtTime, fmtYen } from '@/lib/time';
import { leaveBy, walkMinutes } from '@/lib/walk';
import Survey from './Survey';

type Salon = { name: string; address: string; phone: string | null; lat: number; lng: number };
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
    const { data, error: e } = await client
      .from('bookings')
      .select(
        'id,status,booking_no,created_at,note,photo_path,conversation_pref,slots(start_at,end_at,price,menus(name,duration_min),salons(name,address,phone,lat,lng))',
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

  useEffect(() => {
    if (!client || !session) return;
    const channel = client
      .channel(`booking-${bookingId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${bookingId}` }, () => {
        setChanged(true);
        load();
      })
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [client, session, bookingId, load]);

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
    <main className="app">
      <AppHeader role="利用者">
        <Link href="/mypage">マイページ</Link>
      </AppHeader>

      {error && <ErrorState onRetry={load}>{error}</ErrorState>}
      {d === undefined && !error && <Loading rows={3} />}
      {d === null && (
        <div className="card">
          <p className="card-title">予約が見つかりませんでした</p>
          <Link href="/" className="btn btn-secondary btn-block">
            ホームへ
          </Link>
        </div>
      )}

      {d && (
        <div className="stack">
          {!ended || d.status === 'completed' ? (
            <ol className="flow" aria-label="予約の流れ">
              <li className={stage >= 1 ? 'is-done' : ''}>予約確定</li>
              <li className={stage >= 2 ? 'is-done' : stage === 1 ? 'is-next' : ''}>来店</li>
            </ol>
          ) : null}

          {ended ? (
            <section className={`status-banner status-${ended.tone} ${changed ? 'is-fresh' : ''}`} role="status">
              <p className="status-title">{ended.title}</p>
              <p className="status-text">{ended.text}</p>
              {ended.search && (
                <Link href="/" className="btn btn-primary btn-block" style={{ marginTop: 14 }}>
                  ほかの枠を探す
                </Link>
              )}
            </section>
          ) : (
            <section className={`live ${changed ? 'is-fresh' : ''}`}>
              <p className="live-label">{isNew ? '予約が確定しました' : 'ご予約中'}</p>
              <RemainRing fraction={fraction} label={`開始まであと${remainMin}分`}>
                <span className="live-sub">開始まで</span>
                <span className="live-main num">
                  {remainMin > 0 ? (
                    <>
                      あと<strong>{remainMin >= 60 ? `${Math.floor(remainMin / 60)}時間${remainMin % 60}` : remainMin}</strong>分
                    </>
                  ) : (
                    'まもなく'
                  )}
                </span>
                <span className="live-sub num">
                  {fmtTime(d.start_at)}〜{fmtTime(d.end_at)}
                </span>
              </RemainRing>
              {UI_OPTIONS.showBookingNo && d.booking_no !== null && (
                <p className="booking-no">
                  <span>予約番号</span>
                  <strong className="num">{d.booking_no}</strong>
                  <small>受付でお伝えください</small>
                </p>
              )}
              {UI_OPTIONS.showDeparture && walk && leave && (
                <p className="depart num">
                  {walk.label === '現在地' ? '' : '基準地点から'}歩いて約{walk.min}分。
                  {leave.getTime() > now.getTime() ? `${fmtTime(leave)}ごろに出れば間に合います。` : 'そろそろ出発しましょう。'}
                </p>
              )}
            </section>
          )}

          <section className="card">
            <p className="salon-name">{d.salon?.name}</p>
            <p className="salon-address">{d.salon?.address}</p>
            <div className="action-pair action-big">
              <a className="btn btn-secondary btn-lg" href={mapUrl} target="_blank" rel="noopener noreferrer">
                地図を開く
              </a>
              {d.salon?.phone ? (
                <a className="btn btn-primary btn-lg" href={`tel:${d.salon.phone}`}>
                  電話する
                </a>
              ) : (
                <span className="btn btn-quiet btn-lg" aria-disabled>
                  電話番号なし
                </span>
              )}
            </div>
            <p className="fine-print">地図にはお店の位置だけを渡します。あなたの現在地は渡しません。</p>
          </section>

          <section className="card">
            <dl className="detail-dl">
              <dt>日時</dt>
              <dd className="num">
                {fmtDate(d.start_at)} {fmtTime(d.start_at)}〜{fmtTime(d.end_at)}
              </dd>
              <dt>メニュー</dt>
              <dd>{d.menu?.name}</dd>
              <dt>所要時間</dt>
              <dd className="num">{d.menu?.duration_min}分</dd>
              <dt>合計</dt>
              <dd className="num">
                <strong>{fmtYen(d.price)}</strong>（店頭でお支払い）
              </dd>
              {d.conversation_pref && (
                <>
                  <dt>会話</dt>
                  <dd>{label(CONVERSATION_PREFS, d.conversation_pref)}</dd>
                </>
              )}
              {d.note && (
                <>
                  <dt>メモ</dt>
                  <dd>{d.note}</dd>
                </>
              )}
              {d.photo_path && (
                <>
                  <dt>写真</dt>
                  <dd>1枚をお店と共有しています</dd>
                </>
              )}
            </dl>
          </section>

          {d.status === 'confirmed' && <p className="notice notice-info">変更・キャンセルはお店へ直接お電話ください。</p>}
          {isNew && d.status === 'confirmed' && <Survey client={client} bookingId={d.id} />}

          <Link href="/" className="btn btn-text">
            ホームへ戻る
          </Link>
        </div>
      )}
    </main>
  );
}
