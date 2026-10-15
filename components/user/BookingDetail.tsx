'use client';

// 予約確定画面：開始までの時間を大きく表示し、毎分更新する。サロンが状態を変えると、その場で表示が変わる

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { ErrorState, Loading, NotConfigured } from '@/components/States';
import { one, useRoleSession } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import { CONVERSATION_PREFS, label } from '@/lib/profile-options';
import { fmtDate, fmtRemaining, fmtTime, fmtYen, minutesUntil } from '@/lib/time';
import Survey from './Survey';

type Salon = { name: string; address: string; phone: string | null; lat: number; lng: number };
type Menu = { name: string; duration_min: number };
type Detail = {
  id: string;
  status: string;
  note: string | null;
  photo_path: string | null;
  conversation_pref: string | null;
  start_at: string;
  end_at: string;
  price: number;
  menu: Menu | null;
  salon: Salon | null;
};
type Raw = {
  id: string;
  status: string;
  note: string | null;
  photo_path: string | null;
  conversation_pref: string | null;
  slots: {
    start_at: string;
    end_at: string;
    price: number;
    menus: Menu | Menu[] | null;
    salons: Salon | Salon[] | null;
  } | null;
};

const STATUS_VIEW: Record<string, { title: string; tone: string; text: string }> = {
  completed: { title: 'ご来店ありがとうございました', tone: 'done', text: 'またのご利用をお待ちしています。' },
  cancelled_by_salon: {
    title: 'サロンの都合でキャンセルになりました',
    tone: 'cancel',
    text: 'ご迷惑をおかけしました。お支払いは発生していません。お知らせのメールもお送りしています。',
  },
  cancelled_by_customer: { title: 'キャンセルを承りました', tone: 'cancel', text: 'お店へのご連絡ありがとうございました。' },
  no_show: { title: 'ご来店が確認できませんでした', tone: 'cancel', text: 'お店から無断キャンセルとして記録されました。' },
};

export default function BookingDetail({ bookingId, isNew }: { bookingId: string; isNew: boolean }) {
  const router = useRouter();
  const { client, session, ready } = useRoleSession('user');
  const [detail, setDetail] = useState<Detail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (ready && !session) router.replace(`/login?next=${encodeURIComponent(`/booking/${bookingId}`)}`);
  }, [ready, session, router, bookingId]);

  // 「開始まで あと○分」は毎分更新する（分の切り替わりに合わせて15秒ごとに確かめる）
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!client || !session) return;
    const { data, error: e } = await client
      .from('bookings')
      .select('id,status,note,photo_path,conversation_pref,slots(start_at,end_at,price,menus(name,duration_min),salons(name,address,phone,lat,lng))')
      .eq('id', bookingId)
      .maybeSingle();
    if (e) {
      setError(toMessage(e));
      return;
    }
    const raw = data as Raw | null;
    if (!raw || !raw.slots) {
      setDetail(null);
      return;
    }
    const slot = one(raw.slots);
    setDetail({
      id: raw.id,
      status: raw.status,
      note: raw.note,
      photo_path: raw.photo_path,
      conversation_pref: raw.conversation_pref,
      start_at: slot!.start_at,
      end_at: slot!.end_at,
      price: slot!.price,
      menu: one(slot!.menus),
      salon: one(slot!.salons),
    });
  }, [client, session, bookingId]);

  useEffect(() => {
    load();
  }, [load]);

  // サロンが来店済み・キャンセルにすると、その場で表示を変える
  useEffect(() => {
    if (!client || !session) return;
    const channel = client
      .channel(`booking-${bookingId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${bookingId}` },
        () => {
          setChanged(true);
          load();
        },
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [client, session, bookingId, load]);

  if (!client) return <NotConfigured />;

  const view = detail ? STATUS_VIEW[detail.status] : undefined;
  const min = detail ? minutesUntil(detail.start_at, now) : 0;
  const mapUrl = detail?.salon
    ? `https://www.google.com/maps/search/?api=1&query=${detail.salon.lat},${detail.salon.lng}`
    : '#';

  return (
    <main className="app">
      <AppHeader role="利用者">
        <Link href="/mypage">マイページ</Link>
      </AppHeader>

      {error && <ErrorState onRetry={load}>{error}</ErrorState>}
      {detail === undefined && !error && <Loading rows={3} />}
      {detail === null && (
        <div className="card">
          <p className="card-title">予約が見つかりませんでした</p>
          <Link href="/" className="btn btn-secondary btn-block">
            ホームへ
          </Link>
        </div>
      )}

      {detail && (
        <div className="stack">
          {view ? (
            <section className={`status-banner status-${view.tone} ${changed ? 'is-fresh' : ''}`}>
              <p className="status-title">{view.title}</p>
              <p className="status-text">{view.text}</p>
            </section>
          ) : (
            <section className={`countdown ${changed ? 'is-fresh' : ''} ${isNew ? 'fade-in' : ''}`}>
              <p className="countdown-label">{isNew ? '予約が確定しました' : 'ご予約中'}</p>
              <p className="countdown-main num">
                {min > 0 ? (
                  <>
                    <small>開始まで</small> {fmtRemaining(min).replace('あと', 'あと ')}
                  </>
                ) : (
                  'まもなく開始です'
                )}
              </p>
              <p className="countdown-sub num">
                {fmtDate(detail.start_at)} {fmtTime(detail.start_at)}〜{fmtTime(detail.end_at)}
              </p>
            </section>
          )}

          <section className="card">
            <p className="salon-name">{detail.salon?.name}</p>
            <p className="salon-address">{detail.salon?.address}</p>
            <div className="action-pair">
              <a className="btn btn-secondary" href={mapUrl} target="_blank" rel="noopener noreferrer">
                地図を開く
              </a>
              {detail.salon?.phone ? (
                <a className="btn btn-secondary" href={`tel:${detail.salon.phone}`}>
                  電話する
                </a>
              ) : (
                <span className="btn btn-quiet" aria-disabled>
                  電話番号なし
                </span>
              )}
            </div>
            <p className="fine-print">地図はお店の位置で開きます。あなたの現在地は渡しません。</p>
          </section>

          <section className="card">
            <dl className="detail-dl">
              <dt>メニュー</dt>
              <dd>{detail.menu?.name}</dd>
              <dt>所要時間</dt>
              <dd>{detail.menu?.duration_min}分</dd>
              <dt>合計</dt>
              <dd className="num">
                <strong>{fmtYen(detail.price)}</strong>（店頭でお支払い）
              </dd>
              {detail.conversation_pref && (
                <>
                  <dt>会話</dt>
                  <dd>{label(CONVERSATION_PREFS, detail.conversation_pref)}</dd>
                </>
              )}
              {detail.note && (
                <>
                  <dt>メモ</dt>
                  <dd>{detail.note}</dd>
                </>
              )}
              {detail.photo_path && (
                <>
                  <dt>写真</dt>
                  <dd>1枚をお店と共有しています</dd>
                </>
              )}
            </dl>
          </section>

          {detail.status === 'confirmed' && (
            <p className="notice notice-info">変更・キャンセルはお店へ直接お電話ください。</p>
          )}

          {isNew && detail.status === 'confirmed' && <Survey client={client} bookingId={detail.id} />}

          <Link href="/" className="btn btn-text">
            ホームへ戻る
          </Link>
        </div>
      )}
    </main>
  );
}
