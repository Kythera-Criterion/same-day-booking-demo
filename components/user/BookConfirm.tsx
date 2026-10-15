'use client';

// 予約の確認（単独のページ。ログイン後に戻ってきたときや、リンクから開いたとき）

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { ErrorState, Loading, NotConfigured } from '@/components/States';
import { one, useRoleSession } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import BookingForm, { type BookTarget } from './BookingForm';
import { useUserState } from './useUserState';

type RawSlot = {
  id: string;
  start_at: string;
  end_at: string;
  deadline_at: string;
  price: number;
  status: string;
  menus: { name: string; duration_min: number } | { name: string; duration_min: number }[] | null;
  salons: { name: string; address: string; lat: number; lng: number } | { name: string; address: string; lat: number; lng: number }[] | null;
};

export default function BookConfirm({ slotId }: { slotId: string }) {
  const router = useRouter();
  const { client, session, ready } = useRoleSession('user');
  const { profile, active, suspendedUntil } = useUserState(client, session);
  const [slot, setSlot] = useState<(BookTarget & { status: string }) | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (ready && !session) router.replace(`/login?next=${encodeURIComponent(`/book/${slotId}`)}`);
  }, [ready, session, router, slotId]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!client) return;
    setLoadError(null);
    const { data, error } = await client
      .from('slots')
      .select('id,start_at,end_at,deadline_at,price,status,menus(name,duration_min),salons(name,address,lat,lng)')
      .eq('id', slotId)
      .maybeSingle();
    if (error) {
      setLoadError(toMessage(error));
      return;
    }
    const raw = data as RawSlot | null;
    if (!raw) {
      setSlot(null);
      return;
    }
    const menu = one(raw.menus);
    const salon = one(raw.salons);
    setSlot({
      id: raw.id,
      start_at: raw.start_at,
      end_at: raw.end_at,
      deadline_at: raw.deadline_at,
      price: raw.price,
      status: raw.status,
      menu_name: menu?.name ?? '',
      duration_min: menu?.duration_min ?? 0,
      salon_name: salon?.name ?? '',
      salon_address: salon?.address ?? '',
      lat: salon?.lat,
      lng: salon?.lng,
    });
  }, [client, slotId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!client) return <NotConfigured />;
  const closed = slot && (slot.status !== 'open' || new Date(slot.deadline_at).getTime() <= now.getTime());

  return (
    <main className="app">
      <AppHeader role="利用者">
        <Link href="/">戻る</Link>
      </AppHeader>
      <h1 className="screen-title">予約の確認</h1>
      {loadError && <ErrorState onRetry={load}>{loadError}</ErrorState>}
      {slot === undefined && !loadError && <Loading rows={2} />}
      {(slot === null || closed) && (
        <div className="card">
          <p className="card-title">この枠は受付を終えました</p>
          <p className="card-sub">ほかの方の予約が入ったか、受付の締切を過ぎました。</p>
          <Link href="/" className="btn btn-secondary btn-block">
            ほかの枠を探す
          </Link>
        </div>
      )}
      {slot && !closed && session && (
        <BookingForm
          client={client}
          session={session}
          slot={slot}
          defaultPref={profile?.conversation_pref ?? null}
          activeBookingId={active?.id ?? null}
          suspendedUntil={suspendedUntil}
          now={now}
          onBooked={(id) => router.replace(`/booking/${id}?new=1`)}
          onUnavailable={load}
        />
      )}
    </main>
  );
}
