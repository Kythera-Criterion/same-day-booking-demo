'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { one } from '@/lib/supabase';
import { jstTodayEnd, jstTodayStart } from '@/lib/time';

// 1つのアカウントで複数のお店（系列店など）を扱うとき、最後に開いたお店をこの端末に覚えておく
export function currentSalonKey(userId: string) {
  return `salon-current-${userId}`;
}
export function rememberSalon(userId: string, salonId: string) {
  try {
    localStorage.setItem(currentSalonKey(userId), salonId);
  } catch {
    // 保存できなくても動く（最初のお店を開く）
  }
}
function rememberedSalon(userId: string): string | null {
  try {
    return localStorage.getItem(currentSalonKey(userId));
  } catch {
    return null;
  }
}

export type SalonInfo = {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  accepts_genders: string[];
  area_id: string | null;
  lat: number;
  lng: number;
  is_approved: boolean;
};
// 掲載の状態（listed：掲載中／reviewing：審査中／rejected：見送り／suspended：運営が掲載を止めている）
export type Listing = 'listed' | 'reviewing' | 'rejected' | 'suspended';
export type Menu = { id: string; name: string; duration_min: number; price: number; booking_deadline_min: number; is_active: boolean };
// photo：担当の写真（端末で小さく縮めた画像のデータの URL。0020 で追加。まだ流していないデータベースでは読まない）
export type Stylist = { id: string; name: string; is_active: boolean; photo?: string | null };
export type Preset = {
  id: string;
  label: string;
  menu_id: string;
  stylist_id: string | null;
  offsets_min: number[];
  kind: 'offsets' | 'free';
  free_minutes: number | null;
};
export type Booking = {
  id: string;
  status: string;
  booking_no: number | null;
  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  karte: { hair_type?: string; color_history?: string; perm_history?: string } | null;
  conversation_pref: string | null;
  note: string | null;
  photo_path: string | null;
  photo_note: string | null;
  created_at: string;
  cancelled_at?: string | null;
};
export type SalonSlot = {
  id: string;
  start_at: string;
  end_at: string;
  deadline_at: string;
  status: string;
  closed_reason: string | null;
  price: number;
  created_at: string;
  stylist_id: string | null;
  menu_id: string;
  menu: { name: string; duration_min: number } | null;
  stylist: { name: string } | null;
  bookings: Booking[];
};

type RawSlot = Omit<SalonSlot, 'menu' | 'stylist' | 'bookings'> & {
  menus: SalonSlot['menu'] | NonNullable<SalonSlot['menu']>[];
  stylists: SalonSlot['stylist'] | NonNullable<SalonSlot['stylist']>[];
  bookings: Booking[] | null;
};

// お店の枠を、期間を決めて読む（今日の予定・週表示・前日比で共通）。
// 1枠ずつ取り下げて予約もない枠は出さない（「今日はここまで」・掲載の停止で取り下げた枠は残す）
export async function fetchSlots(client: SupabaseClient, salonId: string, from: Date, to: Date): Promise<{ data: SalonSlot[]; error: unknown }> {
  const { data, error } = await client
    .from('slots')
    .select(
      'id,start_at,end_at,deadline_at,status,closed_reason,price,created_at,stylist_id,menu_id,menus(name,duration_min),stylists(name),' +
        'bookings(id,status,booking_no,contact_name,contact_phone,contact_email,karte,conversation_pref,note,photo_path,photo_note,created_at,cancelled_at)',
    )
    .eq('salon_id', salonId)
    .gte('start_at', from.toISOString())
    .lt('start_at', to.toISOString())
    .order('start_at');
  if (error) return { data: [], error };
  const rows = ((data ?? []) as unknown as RawSlot[]).map((r) => ({
    ...r,
    menu: one(r.menus),
    stylist: one(r.stylists),
    bookings: r.bookings ?? [],
  }));
  return {
    data: rows.filter((r) => !(r.status === 'closed' && r.closed_reason !== 'paused' && r.closed_reason !== 'suspended' && r.bookings.length === 0)),
    error: null,
  };
}

// 有効な予約（キャンセル以外）
export function activeBooking(slot: SalonSlot): Booking | null {
  return slot.bookings.find((b) => !b.status.startsWith('cancelled')) ?? null;
}

export function useSalonData(client: SupabaseClient | null, session: Session | null) {
  const [salon, setSalon] = useState<SalonInfo | null | undefined>(undefined);
  const [salons, setSalons] = useState<SalonInfo[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [stylists, setStylists] = useState<Stylist[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [lineGroup, setLineGroup] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [slots, setSlots] = useState<SalonSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userId = session?.user.id ?? null;
  const salonId = salon?.id ?? null;
  // いま開いているお店（読み直しても変えない。切り替えたときと、最初に開くときだけ決める）
  const currentId = useRef<string | null>(null);

  const loadSalon = useCallback(async () => {
    if (!client || !userId) {
      currentId.current = null;
      setSalon(undefined);
      return;
    }
    setError(null);
    const { data: members, error: e } = await client
      .from('salon_members')
      .select('salon_id,salons(id,name,address,phone,accepts_genders,area_id,lat,lng,is_approved)')
      .eq('user_id', userId);
    if (e) {
      setError('サロンの情報を読み込めませんでした。');
      return;
    }
    const list = (members ?? [])
      .map((m) => one(m.salons as SalonInfo | SalonInfo[] | null))
      .filter((x): x is SalonInfo => !!x)
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    const want = currentId.current ?? rememberedSalon(userId);
    const s = list.find((x) => x.id === want) ?? list[0] ?? null;
    if (!s) {
      setSalons(list);
      setSalon(null);
      return;
    }
    currentId.current = s.id;
    const [m, st, p, priv, status] = await Promise.all([
      client.from('menus').select('id,name,duration_min,price,booking_deadline_min,is_active').eq('salon_id', s.id).order('price'),
      // 写真（0020）を流していないデータベースでは、写真なしで読み直す
      client
        .from('stylists')
        .select('id,name,is_active,photo')
        .eq('salon_id', s.id)
        .order('name')
        .then((r) => (r.error ? client.from('stylists').select('id,name,is_active').eq('salon_id', s.id).order('name') : r)),
      client.from('slot_presets').select('id,label,menu_id,stylist_id,offsets_min,kind,free_minutes').eq('salon_id', s.id).order('created_at'),
      client.from('salon_private').select('line_group_id,onboarding_step').eq('salon_id', s.id).maybeSingle(),
      client.rpc('my_salon_status', { p_salon_id: s.id }),
    ]);
    // 読み込んでいる間に別のお店へ切り替えたときは、古い結果を使わない
    if (currentId.current !== s.id) return;
    // お店の名前・メニュー・担当・いつもの枠・掲載の状態は、まとめて切り替える（別のお店の内容が混ざらないように）
    setSalons(list);
    setSalon((prev) => (prev && JSON.stringify(prev) === JSON.stringify(s) ? prev : s));
    setListing(((status.data as Listing | null) ?? (s.is_approved ? 'listed' : 'suspended')) as Listing);
    setMenus((m.data ?? []) as Menu[]);
    setStylists((st.data ?? []) as Stylist[]);
    setPresets((p.data ?? []) as Preset[]);
    setLineGroup((priv.data?.line_group_id as string | null | undefined) ?? null);
    setOnboardingStep((priv.data?.onboarding_step as number | undefined) ?? 0);
  }, [client, userId]);

  const loadSlots = useCallback(async () => {
    if (!client || !salonId) return;
    const { data, error: e } = await fetchSlots(client, salonId, jstTodayStart(), jstTodayEnd());
    if (e) {
      setError('今日の枠を読み込めませんでした。');
      return;
    }
    if (currentId.current !== salonId) return;
    setSlots(data);
  }, [client, salonId]);

  useEffect(() => {
    loadSalon();
  }, [loadSalon]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  // 掲載の状態が変わったら（運営の承認・停止・再開）すぐに読み直す
  useEffect(() => {
    if (!client || !salonId) return;
    const channel = client
      .channel(`salon-listing-${salonId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'listing_events', filter: `salon_id=eq.${salonId}` }, () => loadSalon())
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [client, salonId, loadSalon]);

  // 開くお店を切り替える（覚えてから読み直す）
  const selectSalon = useCallback(
    (id: string) => {
      if (!userId) return;
      currentId.current = id;
      rememberSalon(userId, id);
      setSlots(null);
      loadSalon();
    },
    [userId, loadSalon],
  );

  return { salon, salons, selectSalon, menus, stylists, presets, lineGroup, onboardingStep, listing, slots, error, loadSalon, loadSlots };
}
