'use client';

// 利用者の画面：時間帯を選ぶ → 近くの空き枠が最大3件出る → そのまま予約

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Session } from '@supabase/supabase-js';
import LoginBox from '@/components/LoginBox';
import { getClient, isConfigured, one } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import { requestDispatch } from '@/lib/dispatch-client';
import { DEFAULT_POINT, distanceKm, fmtDistance, type LatLng } from '@/lib/geo';
import {
  WINDOWS,
  earliestBookable,
  fmtTime,
  fmtUntil,
  minutesUntil,
  windowEnd,
  type WindowKey,
} from '@/lib/time';

type Salon = { name: string; address: string; lat: number; lng: number };
type Menu = { name: string; duration_min: number };
type SlotRow = {
  id: string;
  start_at: string;
  end_at: string;
  price: number;
  salons: Salon | Salon[] | null;
  menus: Menu | Menu[] | null;
};
type Booked = { start_at: string; salon: string; address: string; menu: string; price: number };
type MyBooking = {
  id: string;
  status: string;
  slots:
    | { start_at: string; salons: { name: string } | { name: string }[] | null }
    | { start_at: string; salons: { name: string } | { name: string }[] | null }[]
    | null;
};

const STATUS_LABEL: Record<string, string> = {
  confirmed: '予約確定',
  completed: '来店済み',
  no_show: '無断キャンセル',
  cancelled_by_salon: 'サロン都合のキャンセル',
};

const ACCOUNTS = [
  { email: 'user1@demo.test', label: '利用者1（山田）' },
  { email: 'user2@demo.test', label: '利用者2（鈴木）' },
];

export default function UserPage() {
  const supabase = useMemo(() => (isConfigured ? getClient('user') : null), []);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [win, setWin] = useState<WindowKey>('1h');
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [point, setPoint] = useState<LatLng>(DEFAULT_POINT);
  const [usingGps, setUsingGps] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mine, setMine] = useState<MyBooking[]>([]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const loadSlots = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const current = new Date();
    const { data, error } = await supabase
      .from('slots')
      .select('id,start_at,end_at,price,salons(name,address,lat,lng),menus(name,duration_min)')
      .eq('status', 'open')
      .gte('start_at', earliestBookable(current).toISOString())
      .lt('start_at', windowEnd(win, current).toISOString())
      .order('start_at')
      .limit(50);
    setLoading(false);
    if (error) {
      setNotice({ kind: 'error', text: toMessage(error) });
      return;
    }
    setSlots((data ?? []) as unknown as SlotRow[]);
  }, [supabase, win]);

  const loadMine = useCallback(async () => {
    if (!supabase || !session) {
      setMine([]);
      return;
    }
    const { data } = await supabase
      .from('bookings')
      .select('id,status,slots(start_at,salons(name))')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(5);
    setMine((data ?? []) as unknown as MyBooking[]);
  }, [supabase, session]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  // サロンが枠を出した瞬間に一覧へ反映する。
  // ほかの人が予約した枠は権限上この画面には通知されないため、20秒ごとにも読み直す。
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel('user-slots')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, () => loadSlots())
      .subscribe();
    const timer = setInterval(loadSlots, 20_000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [supabase, loadSlots]);

  const top3 = useMemo(() => {
    return slots
      .map((s) => {
        const salon = one(s.salons);
        const menu = one(s.menus);
        const km = salon ? distanceKm(point, { lat: salon.lat, lng: salon.lng }) : null;
        return { ...s, salon, menu, km };
      })
      .sort((a, b) => (a.km ?? 999) - (b.km ?? 999) || a.start_at.localeCompare(b.start_at))
      .slice(0, 3);
  }, [slots, point]);

  function applyCurrentLocation() {
    if (!navigator.geolocation) {
      setNotice({ kind: 'error', text: 'この端末では現在地を取得できません。駅前を基準に表示します。' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setUsingGps(true);
      },
      () => setNotice({ kind: 'error', text: '現在地を取得できませんでした。駅前を基準に表示します。' }),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }

  async function book(slot: (typeof top3)[number]) {
    if (!supabase) return;
    setBusyId(slot.id);
    setNotice(null);
    const { error } = await supabase.rpc('book_slot', { p_slot_id: slot.id });
    setBusyId(null);
    if (error) {
      setNotice({ kind: 'error', text: toMessage(error) });
      loadSlots();
      return;
    }
    requestDispatch(supabase);
    setBooked({
      start_at: slot.start_at,
      salon: slot.salon?.name ?? '',
      address: slot.salon?.address ?? '',
      menu: slot.menu?.name ?? '',
      price: slot.price,
    });
    loadSlots();
    loadMine();
  }

  if (!isConfigured || !supabase) {
    return (
      <main className="page">
        <div className="card">
          <h2 className="card-title">設定が必要です</h2>
          <p>.env.local に Supabase のURLとキーを設定してから、もう一度起動してください。</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="top">
        <h1>
          当日予約デモ<span className="role">利用者の画面</span>
        </h1>
        <Link href="/salon">サロンの画面へ</Link>
      </header>

      {ready && !session && <LoginBox client={supabase} title="利用者としてログイン" accounts={ACCOUNTS} />}

      {session && (
        <div className="whoami">
          <span>{session.user.email} でログイン中</span>
          <button className="linkbtn" onClick={() => supabase.auth.signOut()}>
            ログアウト
          </button>
        </div>
      )}

      {booked && (
        <section className="card done">
          <h2>予約が確定しました</h2>
          <div className="big">今日 {fmtTime(booked.start_at)}</div>
          <div className="slot-until">開始まで {fmtUntil(minutesUntil(booked.start_at, now))}</div>
          <dl>
            <dt>サロン</dt>
            <dd>{booked.salon}</dd>
            <dt>場所</dt>
            <dd>{booked.address}</dd>
            <dt>メニュー</dt>
            <dd>{booked.menu}</dd>
            <dt>お支払い</dt>
            <dd>¥{booked.price.toLocaleString()}（店頭でお支払い）</dd>
          </dl>
          <button className="btn btn-ghost" onClick={() => setBooked(null)}>
            閉じる
          </button>
        </section>
      )}

      {notice && <p className={`msg ${notice.kind === 'ok' ? 'msg-ok' : 'msg-error'}`}>{notice.text}</p>}

      <div className="tabs">
        {WINDOWS.map((w) => (
          <button key={w.key} className={`tab ${win === w.key ? 'tab-on' : ''}`} onClick={() => setWin(w.key)}>
            {w.label}
          </button>
        ))}
      </div>

      <div className="place">
        <span>基準：{usingGps ? '現在地' : '駅前（デモの基準地点）'}</span>
        {!usingGps && (
          <button className="linkbtn" onClick={applyCurrentLocation}>
            現在地を使う
          </button>
        )}
      </div>

      {top3.map((s) => (
        <article className="slot" key={s.id}>
          <div>
            <div className="slot-time">{fmtTime(s.start_at)}</div>
            <div className="slot-until">{fmtUntil(minutesUntil(s.start_at, now))}</div>
          </div>
          <div>
            <div className="slot-menu">{s.menu?.name}</div>
            <div className="slot-meta">
              {s.salon?.name}
              {s.km !== null && ` ・ ${fmtDistance(s.km)}`}
            </div>
            <div className="slot-price">¥{s.price.toLocaleString()}</div>
          </div>
          <button className="btn btn-small" disabled={!session || busyId !== null} onClick={() => book(s)}>
            {busyId === s.id ? '予約中…' : '予約'}
          </button>
        </article>
      ))}

      {!loading && top3.length === 0 && <p className="empty">この時間帯に出ている枠はありません。</p>}

      <p className="card-note">
        現在地はこの端末の中だけで距離の計算に使い、サーバーには送りません。開始10分前を過ぎた枠は表示されません。
      </p>

      {session && mine.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2 className="card-title">最近の予約</h2>
          <ul className="list mine">
            {mine.map((b) => {
              const slot = one(b.slots);
              const salon = one(slot?.salons);
              return (
                <li key={b.id}>
                  <span>
                    {slot ? fmtTime(slot.start_at) : '--:--'} {salon?.name}
                  </span>
                  <span className="badge">{STATUS_LABEL[b.status] ?? b.status}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
