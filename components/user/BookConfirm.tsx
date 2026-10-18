'use client';

// 予約の確認（単独のページ。ログイン後に戻ってきたときや、リンクから開いたとき）

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { ErrorState, Loading, NotConfigured } from '@/components/States';
import { ButtonLink } from '@/components/ui/Button';
import { Page, ScreenTitle } from '@/components/ui/Layout';
import SalonPhoto from '@/components/ui/SalonPhoto';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { CalendarX, Lightning } from '@/components/ui/icons';
import { one, useRoleSession } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import { distanceKm, fmtDistance } from '@/lib/geo';
import { loadOrigin } from '@/lib/origin';
import { fmtTime, jstTodayEnd } from '@/lib/time';
import { walkMinutes } from '@/lib/walk';
import BookingForm, { type Alternative, type BookTarget } from './BookingForm';
import { CancelWaitButton, useCancelWaits } from './CancelWait';
import { needsProfile, useUserState } from './useUserState';
import { genderCondition, stylistLine, useSalonExtras } from './useSalonExtras';
import st from './BookConfirm.module.css';

type RawSlot = {
  id: string;
  start_at: string;
  end_at: string;
  deadline_at: string;
  price: number;
  status: string;
  menus: { name: string; duration_min: number } | { name: string; duration_min: number }[] | null;
  stylists: { name: string } | { name: string }[] | null;
  salons: { id: string; name: string; address: string; lat: number; lng: number } | { id: string; name: string; address: string; lat: number; lng: number }[] | null;
};

export default function BookConfirm({ slotId }: { slotId: string }) {
  const router = useRouter();
  const { client, session, ready, signedOut } = useRoleSession('user');
  const { profile, active, suspendedUntil } = useUserState(client, session);
  const [slot, setSlot] = useState<(BookTarget & { status: string; salon_id: string; stylist_name: string | null }) | null | undefined>(undefined);
  // 同じお店の今日の空き（時刻のチップ。押すと、その枠の確認に切り替わる）
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  // 予約できた直後（予約の画面へ移るまで）は、「受付を終えました」を出さない（自分の予約で枠が埋まるため）
  const [booked, setBooked] = useState(false);

  useEffect(() => {
    if (ready && !session) router.replace(`/login?${signedOut ? 'logged_out=1&' : ''}next=${encodeURIComponent(`/book/${slotId}`)}`);
  }, [ready, session, signedOut, router, slotId]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!client) return;
    setLoadError(null);
    // 途中で切れた・書き間違えたリンクは、「受付を終えました」として扱う
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slotId)) {
      setSlot(null);
      return;
    }
    const { data, error } = await client
      .from('slots')
      .select('id,start_at,end_at,deadline_at,price,status,menus(name,duration_min),stylists(name),salons(id,name,address,lat,lng)')
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
    const stylist = one(raw.stylists);
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
      salon_id: salon?.id ?? '',
      stylist_name: stylist?.name ?? null,
    });
    // 同じお店の今日の空き（表示だけ。予約は選んだ枠で、これまでどおり行う）
    if (salon?.id) {
      const { data: found } = await client.rpc('search_open_slots', { p_until: jstTodayEnd().toISOString(), p_area_id: null });
      setAlternatives(
        ((found ?? []) as { slot_id: string; start_at: string; menu_name: string; salon_id: string }[])
          .filter((f) => f.salon_id === salon.id)
          .map((f) => ({ id: f.slot_id, start_at: f.start_at, menu_name: f.menu_name })),
      );
    }
  }, [client, slotId]);

  useEffect(() => {
    load();
  }, [load]);

  // 開いている間に、枠が埋まった・お店が受付を終えた・掲載が止まったら、その場で表示を変える
  useEffect(() => {
    if (!client) return;
    const channel = client
      .channel(`book-${slotId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots', filter: `id=eq.${slotId}` }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'listing_events' }, () => load())
      .subscribe();
    const timer = setInterval(load, 20_000);
    return () => {
      client.removeChannel(channel);
      clearInterval(timer);
    };
  }, [client, slotId, load]);

  const extras = useSalonExtras(client, slot?.salon_id ? [slot.salon_id] : []);
  const [walk, setWalk] = useState<{ min: number; label: string } | null>(null);
  useEffect(() => {
    if (!slot || slot.lat === undefined || slot.lng === undefined) return;
    const o = loadOrigin();
    if (!o) return;
    const km = distanceKm(o, { lat: slot.lat, lng: slot.lng });
    setWalk({ min: walkMinutes(km), label: fmtDistance(km) });
  }, [slot]);

  // キャンセル待ち（0020）：この枠が埋まっていたら、このお店の待ちに登録できる
  const waitState = useCancelWaits(client, session);
  if (!client) return <NotConfigured />;
  const closed = !booked && slot && (slot.status !== 'open' || new Date(slot.deadline_at).getTime() <= now.getTime());

  return (
    <Page>
      <AppHeader role="利用者">
        <Link href="/">戻る</Link>
      </AppHeader>
      {slot && !closed && (
        <div className={st.hero}>
        <SalonPhoto
          salonId={slot.salon_id}
          salonName={slot.salon_name}
          variant="hero"
          priority
          caption={
            <span className={st.caption}>
              <span className={`${st.captionTime} num`}>今日 {fmtTime(slot.start_at)}〜</span>
              <span className={st.captionName}>{slot.salon_name}</span>
            </span>
          }
        />
        </div>
      )}
      <ScreenTitle tight>予約の確認</ScreenTitle>
      {loadError && <ErrorState onRetry={load}>{loadError}</ErrorState>}
      {slot === undefined && !loadError && <Loading rows={2} />}
      {!booked && (slot === null || closed) && (
        <Panel>
          <SectionHead icon={CalendarX} title="この枠は受付を終えました" as="p" />
          <SubText>ほかの方の予約が入ったか、受付の締切を過ぎました。</SubText>
          {slot && slot.salon_id && (
            <CancelWaitButton state={waitState} signedIn={!!session} salonId={slot.salon_id} salonName={slot.salon_name} block />
          )}
          <ButtonLink href="/" variant="primary" size="md" block icon={Lightning} iconWeight="duotone">
            ほかの枠を探す
          </ButtonLink>
        </Panel>
      )}
      {slot && !closed && session && (
        <BookingForm
          client={client}
          session={session}
          slot={slot}
          walk={walk}
          stylist={stylistLine(slot.stylist_name, extras[slot.salon_id])}
          condition={genderCondition(extras[slot.salon_id])}
          alternatives={alternatives}
          onSwitch={(id) => router.replace(`/book/${id}`)}
          defaultPref={profile?.conversation_pref ?? null}
          activeBookingId={active?.id ?? null}
          suspendedUntil={suspendedUntil}
          now={now}
          profileMissing={needsProfile(profile)}
          onBooked={(id) => {
            setBooked(true);
            router.replace(`/booking/${id}?new=1`);
          }}
          onUnavailable={load}
        />
      )}
    </Page>
  );
}
