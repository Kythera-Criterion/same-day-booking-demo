'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { one } from '@/lib/supabase';
import { jstTodayEnd, jstTodayStart } from '@/lib/time';

export type SalonInfo = { id: string; name: string; address: string; phone: string | null; accepts_genders: string[] };
export type Menu = { id: string; name: string; duration_min: number; price: number; booking_deadline_min: number; is_active: boolean };
export type Stylist = { id: string; name: string; is_active: boolean };
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
  menu: { name: string; duration_min: number } | null;
  stylist: { name: string } | null;
  bookings: Booking[];
};

type RawSlot = Omit<SalonSlot, 'menu' | 'stylist' | 'bookings'> & {
  menus: SalonSlot['menu'] | NonNullable<SalonSlot['menu']>[];
  stylists: SalonSlot['stylist'] | NonNullable<SalonSlot['stylist']>[];
  bookings: Booking[] | null;
};

// 有効な予約（キャンセル以外）
export function activeBooking(slot: SalonSlot): Booking | null {
  return slot.bookings.find((b) => !b.status.startsWith('cancelled')) ?? null;
}

export function useSalonData(client: SupabaseClient | null, session: Session | null) {
  const [salon, setSalon] = useState<SalonInfo | null | undefined>(undefined);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [stylists, setStylists] = useState<Stylist[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [lineGroup, setLineGroup] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);
  const [slots, setSlots] = useState<SalonSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSalon = useCallback(async () => {
    if (!client || !session) {
      setSalon(undefined);
      return;
    }
    setError(null);
    const { data: member, error: e } = await client
      .from('salon_members')
      .select('salon_id,salons(id,name,address,phone,accepts_genders)')
      .eq('user_id', session.user.id)
      .limit(1)
      .maybeSingle();
    if (e) {
      setError('サロンの情報を読み込めませんでした。');
      return;
    }
    const s = member ? one(member.salons as SalonInfo | SalonInfo[] | null) : null;
    setSalon(s);
    if (!s) return;
    const [m, st, p, priv] = await Promise.all([
      client.from('menus').select('id,name,duration_min,price,booking_deadline_min,is_active').eq('salon_id', s.id).order('price'),
      client.from('stylists').select('id,name,is_active').eq('salon_id', s.id).order('name'),
      client.from('slot_presets').select('id,label,menu_id,stylist_id,offsets_min,kind,free_minutes').eq('salon_id', s.id).order('created_at'),
      client.from('salon_private').select('line_group_id,onboarding_step').eq('salon_id', s.id).maybeSingle(),
    ]);
    setMenus((m.data ?? []) as Menu[]);
    setStylists((st.data ?? []) as Stylist[]);
    setPresets((p.data ?? []) as Preset[]);
    setLineGroup((priv.data?.line_group_id as string | null | undefined) ?? null);
    setOnboardingStep((priv.data?.onboarding_step as number | undefined) ?? 0);
  }, [client, session]);

  const loadSlots = useCallback(async () => {
    if (!client || !salon) return;
    const { data, error: e } = await client
      .from('slots')
      .select(
        'id,start_at,end_at,deadline_at,status,closed_reason,price,created_at,stylist_id,menus(name,duration_min),stylists(name),' +
          'bookings(id,status,booking_no,contact_name,contact_phone,contact_email,karte,conversation_pref,note,photo_path,photo_note,created_at)',
      )
      .eq('salon_id', salon.id)
      .gte('start_at', jstTodayStart().toISOString())
      .lt('start_at', jstTodayEnd().toISOString())
      .order('start_at');
    if (e) {
      setError('今日の枠を読み込めませんでした。');
      return;
    }
    const rows = ((data ?? []) as unknown as RawSlot[]).map((r) => ({
      ...r,
      menu: one(r.menus),
      stylist: one(r.stylists),
      bookings: r.bookings ?? [],
    }));
    // 1枠ずつ取り下げて予約もない枠は表示しない（「今日はここまで」で取り下げた枠は、元に戻せるよう残す）
    setSlots(rows.filter((r) => !(r.status === 'closed' && r.closed_reason !== 'paused' && r.bookings.length === 0)));
  }, [client, salon]);

  useEffect(() => {
    loadSalon();
  }, [loadSalon]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  return { salon, menus, stylists, presets, lineGroup, onboardingStep, slots, error, loadSalon, loadSlots };
}
