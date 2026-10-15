'use client';

// サロンの画面：メニューと時刻を選んで今日の空き枠を出す → 予約が入るとすぐ表示される

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Session } from '@supabase/supabase-js';
import LoginBox from '@/components/LoginBox';
import { getClient, isConfigured, one } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import { requestDispatch, useDispatchTicker } from '@/lib/dispatch-client';
import NotificationLog from '@/components/NotificationLog';
import { fmtTime, jstTodayEnd, jstTodayStart, startTimeOptions } from '@/lib/time';

type Menu = { id: string; name: string; duration_min: number; price: number };
type Stylist = { id: string; name: string };
type BookingRow = {
  id: string;
  status: string;
  contact_name: string;
  contact_phone: string | null;
  note: string | null;
  created_at: string;
};
type SalonSlot = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  price: number;
  menus: { name: string } | { name: string }[] | null;
  stylists: { name: string } | { name: string }[] | null;
  bookings: BookingRow[] | null;
};

const ACCOUNTS = [
  { email: 'salon-a@demo.test', label: 'HAIR ROOM AOI' },
  { email: 'salon-b@demo.test', label: 'atelier nagi' },
];

const STATUS_LABEL: Record<string, string> = {
  confirmed: '予約あり',
  completed: '来店済み',
  no_show: '無断キャンセル',
  cancelled_by_salon: 'サロン都合でキャンセル',
};

export default function SalonPage() {
  const supabase = useMemo(() => (isConfigured ? getClient('salon') : null), []);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [salon, setSalon] = useState<{ id: string; name: string } | null>(null);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [stylists, setStylists] = useState<Stylist[]>([]);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [stylistId, setStylistId] = useState<string>('');
  const [startAt, setStartAt] = useState<string | null>(null);
  const [slots, setSlots] = useState<SalonSlot[]>([]);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
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

  // ログインしたスタッフが所属するサロンと、そのメニュー・美容師を読み込む
  useEffect(() => {
    if (!supabase || !session) {
      setSalon(null);
      return;
    }
    (async () => {
      const { data: member } = await supabase
        .from('salon_members')
        .select('salon_id,salons(name)')
        .limit(1)
        .maybeSingle();
      if (!member) {
        setNotice({ kind: 'error', text: 'このアカウントはどのサロンにも所属していません。' });
        return;
      }
      const salonName = one(member.salons as { name: string } | { name: string }[] | null)?.name ?? '';
      setSalon({ id: member.salon_id as string, name: salonName });
      const [{ data: m }, { data: st }] = await Promise.all([
        supabase.from('menus').select('id,name,duration_min,price').eq('salon_id', member.salon_id).order('price'),
        supabase.from('stylists').select('id,name').eq('salon_id', member.salon_id).order('name'),
      ]);
      setMenus((m ?? []) as Menu[]);
      setStylists((st ?? []) as Stylist[]);
      if (m && m.length > 0) setMenuId((m[0] as Menu).id);
    })();
  }, [supabase, session]);

  const loadToday = useCallback(async () => {
    if (!supabase || !salon) return;
    const { data, error } = await supabase
      .from('slots')
      .select(
        'id,start_at,end_at,status,price,menus(name),stylists(name),bookings(id,status,contact_name,contact_phone,note,created_at)',
      )
      .eq('salon_id', salon.id)
      .neq('status', 'closed')
      .gte('start_at', jstTodayStart().toISOString())
      .lt('start_at', jstTodayEnd().toISOString())
      .order('start_at');
    if (error) {
      setNotice({ kind: 'error', text: toMessage(error) });
      return;
    }
    setSlots((data ?? []) as unknown as SalonSlot[]);
  }, [supabase, salon]);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  // 予約が入った瞬間に画面へ反映する（権限上、自分のサロンの予約だけが届く）
  useEffect(() => {
    if (!supabase || !salon) return;
    const channel = supabase
      .channel('salon-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings' }, (payload) => {
        const row = payload.new as { id: string; contact_name: string };
        setFreshIds((ids) => [...ids, row.id]);
        setNotice({ kind: 'ok', text: `新しい予約が入りました（${row.contact_name} 様）` });
        loadToday();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings' }, () => loadToday())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, () => loadToday())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, salon, loadToday]);

  const timeOptions = useMemo(() => startTimeOptions(now), [now]);
  useDispatchTicker(supabase, !!salon);

  async function publish() {
    if (!supabase || !menuId || !startAt) return;
    setBusy(true);
    setNotice(null);
    const { error } = await supabase.rpc('create_slot', {
      p_menu_id: menuId,
      p_start_at: startAt,
      p_stylist_id: stylistId || null,
    });
    setBusy(false);
    if (error) {
      setNotice({ kind: 'error', text: toMessage(error) });
      return;
    }
    setNotice({ kind: 'ok', text: `${fmtTime(startAt)} の枠を出しました。` });
    setStartAt(null);
    loadToday();
  }

  async function updateBooking(bookingId: string, action: 'complete' | 'no_show' | 'cancel') {
    if (!supabase) return;
    const confirmText: Record<string, string> = {
      no_show: '無断キャンセルとして記録します。よろしいですか？',
      cancel: 'サロン都合でキャンセルします。お客様へのご連絡もお願いします。よろしいですか？',
    };
    if (confirmText[action] && !window.confirm(confirmText[action])) return;
    const { error } = await supabase.rpc('salon_update_booking', { p_booking_id: bookingId, p_action: action });
    if (error) setNotice({ kind: 'error', text: toMessage(error) });
    else requestDispatch(supabase);
    loadToday();
  }

  async function closeSlot(slotId: string) {
    if (!supabase) return;
    const { error } = await supabase.rpc('close_slot', { p_slot_id: slotId });
    if (error) setNotice({ kind: 'error', text: toMessage(error) });
    loadToday();
  }

  if (!isConfigured || !supabase) {
    return (
      <main className="page page-wide">
        <div className="card">
          <h2 className="card-title">設定が必要です</h2>
          <p>.env.local に Supabase のURLとキーを設定してから、もう一度起動してください。</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page page-wide">
      <header className="top">
        <h1>
          {salon?.name ?? '当日予約デモ'}
          <span className="role">サロンの画面</span>
        </h1>
        <Link href="/">利用者の画面へ</Link>
      </header>

      {ready && !session && <LoginBox client={supabase} title="サロンのスタッフとしてログイン" accounts={ACCOUNTS} />}

      {session && (
        <div className="whoami">
          <span>{session.user.email} でログイン中</span>
          <button className="linkbtn" onClick={() => supabase.auth.signOut()}>
            ログアウト
          </button>
        </div>
      )}

      {notice && <p className={`msg ${notice.kind === 'ok' ? 'msg-ok' : 'msg-error'}`}>{notice.text}</p>}

      {salon && (
        <section className="card">
          <h2 className="card-title">今日の空き枠を出す</h2>

          <p className="step">メニュー</p>
          <div className="chips">
            {menus.map((m) => (
              <button
                key={m.id}
                className={`chip ${menuId === m.id ? 'chip-on' : ''}`}
                onClick={() => setMenuId(m.id)}
              >
                {m.name}（{m.duration_min}分・¥{m.price.toLocaleString()}）
              </button>
            ))}
          </div>

          <p className="step">開始時刻</p>
          <div className="chips">
            {timeOptions.map((t) => {
              const iso = t.toISOString();
              return (
                <button key={iso} className={`chip ${startAt === iso ? 'chip-on' : ''}`} onClick={() => setStartAt(iso)}>
                  {fmtTime(t)}
                </button>
              );
            })}
            {timeOptions.length === 0 && <span className="row-sub">今日はこれ以上枠を出せる時間がありません。</span>}
          </div>

          {stylists.length > 0 && (
            <label className="field">
              <span>担当（任意）</span>
              <select value={stylistId} onChange={(e) => setStylistId(e.target.value)}>
                <option value="">指定しない</option>
                {stylists.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button className="btn btn-primary" disabled={!menuId || !startAt || busy} onClick={publish}>
            {busy ? '公開中…' : startAt ? `${fmtTime(startAt)} の枠を出す` : '時刻を選んでください'}
          </button>
          <p className="card-note">出した枠は、すぐに利用者の画面に表示されます。</p>
        </section>
      )}

      {salon && (
        <section className="card">
          <h2 className="card-title">今日の枠と予約</h2>
          {slots.length === 0 && <p className="empty">今日出している枠はまだありません。</p>}
          <ul className="list">
            {slots.map((s) => {
              const booking = (s.bookings ?? []).find((b) => b.status !== 'cancelled_by_salon') ?? null;
              const isFresh = booking !== null && freshIds.includes(booking.id);
              const menu = one(s.menus);
              const stylist = one(s.stylists);
              return (
                <li key={s.id} className={`row ${isFresh ? 'flash' : ''}`}>
                  <div className="row-head">
                    <span className="row-time">
                      {fmtTime(s.start_at)}〜{fmtTime(s.end_at)}
                    </span>
                    {booking ? (
                      <span className={`badge ${isFresh ? 'badge-new' : ''}`}>
                        {isFresh ? '新しい予約' : STATUS_LABEL[booking.status] ?? booking.status}
                      </span>
                    ) : (
                      <span className="badge badge-open">予約待ち</span>
                    )}
                  </div>
                  <div className="row-sub">
                    {menu?.name}
                    {stylist && ` ・ 担当 ${stylist.name}`} ・ ¥{s.price.toLocaleString()}
                  </div>

                  {booking && (
                    <>
                      <div className="row-guest">
                        {booking.contact_name} 様
                        {booking.contact_phone && (
                          <>
                            {' '}
                            ・ <a href={`tel:${booking.contact_phone}`}>{booking.contact_phone}</a>
                          </>
                        )}
                      </div>
                      {booking.note && <div className="row-sub">メモ：{booking.note}</div>}
                      {booking.status === 'confirmed' && (
                        <div className="row-actions">
                          <button className="btn btn-ghost" onClick={() => updateBooking(booking.id, 'complete')}>
                            来店済み
                          </button>
                          <button className="btn btn-ghost" onClick={() => updateBooking(booking.id, 'no_show')}>
                            無断キャンセル
                          </button>
                          <button className="btn btn-danger" onClick={() => updateBooking(booking.id, 'cancel')}>
                            サロン都合でキャンセル
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  {!booking && s.status === 'open' && (
                    <div className="row-actions">
                      <button className="btn btn-ghost" onClick={() => closeSlot(s.id)}>
                        この枠を取り下げる
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {salon && (
        <section className="card">
          <h2 className="card-title">通知ログ</h2>
          <NotificationLog client={supabase} salonId={salon.id} limit={10} />
        </section>
      )}
    </main>
  );
}
