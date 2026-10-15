'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { one } from '@/lib/supabase';

export type Area = { id: string; name: string; lat: number; lng: number };

export type MyProfile = {
  id: string;
  display_name: string;
  phone: string | null;
  gender: string | null;
  email: string | null;
  age_group: string | null;
  occupation: string | null;
  area_id: string | null;
  conversation_pref: string | null;
  hair_type: string | null;
  color_history: string | null;
  perm_history: string | null;
  adult_confirmed_at: string | null;
};

// 予約に必要な情報（お名前・電話番号・18歳以上の確認）が足りないか。Google・Yahoo! JAPAN ID で登録した直後など
export function needsProfile(p: Pick<MyProfile, 'display_name' | 'phone' | 'adult_confirmed_at'> | null): boolean {
  if (!p) return false;
  return !p.display_name?.trim() || !(p.phone ?? '').replace(/\D/g, '') || !p.adult_confirmed_at;
}

export type MyBooking = {
  id: string;
  status: string;
  created_at: string;
  slot: {
    start_at: string;
    end_at: string;
    price: number;
    menu: { name: string; duration_min: number } | null;
    salon: { name: string } | null;
  } | null;
};

type RawSlot = {
  start_at: string;
  end_at: string;
  price: number;
  menus: { name: string; duration_min: number } | { name: string; duration_min: number }[] | null;
  salons: { name: string } | { name: string }[] | null;
};
type RawBooking = { id: string; status: string; created_at: string; slots: RawSlot | RawSlot[] | null };

export function normalizeBooking(raw: RawBooking): MyBooking {
  const slot = one(raw.slots);
  return {
    id: raw.id,
    status: raw.status,
    created_at: raw.created_at,
    slot: slot
      ? { start_at: slot.start_at, end_at: slot.end_at, price: slot.price, menu: one(slot.menus), salon: one(slot.salons) }
      : null,
  };
}

// 利用者の基本の状態（エリア・プロフィール・予約・予約停止）
export function useUserState(client: SupabaseClient | null, session: Session | null) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [suspendedUntil, setSuspendedUntil] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!client) return;
    setError(null);
    const { data: areaRows, error: areaError } = await client.from('areas').select('id,name,lat,lng').order('sort_order');
    if (areaError) {
      setError('エリアを読み込めませんでした。');
      setLoaded(true);
      return;
    }
    setAreas((areaRows ?? []) as Area[]);

    if (!session) {
      setProfile(null);
      setBookings([]);
      setSuspendedUntil(null);
      setLoaded(true);
      return;
    }
    const [p, b, s] = await Promise.all([
      client
        .from('profiles')
        .select('id,display_name,phone,gender,email,age_group,occupation,area_id,conversation_pref,hair_type,color_history,perm_history,adult_confirmed_at')
        .eq('id', session.user.id)
        .maybeSingle(),
      client
        .from('bookings')
        .select('id,status,created_at,slots(start_at,end_at,price,menus(name,duration_min),salons(name))')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(30),
      client.rpc('my_suspension'),
    ]);
    if (p.error || b.error) setError('情報を読み込めませんでした。');
    setProfile((p.data ?? null) as MyProfile | null);
    setBookings(((b.data ?? []) as unknown as RawBooking[]).map(normalizeBooking));
    setSuspendedUntil((s.data as string | null) ?? null);
    setLoaded(true);
  }, [client, session]);

  useEffect(() => {
    reload();
  }, [reload]);

  // 自分の予約が変わったら（別の端末での予約・サロンによる来店済みやキャンセル）すぐに読み直す
  useEffect(() => {
    if (!client || !session) return;
    const channel = client
      .channel(`my-bookings-${session.user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `user_id=eq.${session.user.id}` },
        () => reload(),
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [client, session, reload]);

  const now = Date.now();
  const active =
    bookings.find((b) => b.status === 'confirmed' && b.slot && new Date(b.slot.end_at).getTime() > now) ?? null;

  return { areas, profile, bookings, active, suspendedUntil, loaded, error, reload };
}
