// 検証スクリプト共通の設定
import { createClient } from '@supabase/supabase-js';

export const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const PASSWORD = process.env.DEMO_PASSWORD || 'demo-pass-2026';

export const SALON_A = '11111111-1111-4111-8111-111111111111';
export const SALON_B = '22222222-2222-4222-8222-222222222222';
export const SALON_C = '33333333-3333-4333-8333-333333333333';
export const MENU_A = 'd1111111-1111-4111-8111-111111111111';
export const AREA_STATION = 'e0000001-0000-4000-8000-000000000001';

// デモ用の利用者10人
export const DEMO_USERS = Array.from({ length: 10 }, (_, i) => `user${i + 1}@demo.test`);

if (!URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('.env.local に NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY を設定してください。');
  process.exit(1);
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

// 管理者（RLSを通らない）。テスト用の枠を用意するときだけ使う
export const admin = createClient(URL, SERVICE_KEY, noSession);

// 一般の利用者・サロンと同じ権限でログインしたクライアント
export async function signIn(email) {
  const client = createClient(URL, ANON_KEY, noSession);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`${email} でログインできません。先に npm run setup:demo を実行してください（${error.message}）`);
  return client;
}

export function anon() {
  return createClient(URL, ANON_KEY, noSession);
}

// 同時予約の確認用の枠を作る（デモ用の利用者に残っている予約は閉じておく）
export async function createTestSlot() {
  const { data, error } = await admin.rpc('demo_prepare_challenge');
  if (error) {
    if (error.message.includes('today_only')) {
      console.error('今日はもう枠を作れる時間がありません（日本時間で22時ごろまでに実行してください）。');
      process.exit(1);
    }
    throw new Error(`${error.message}（supabase/migrations/0002〜0004 を適用済みか確認してください）`);
  }
  return data;
}

// テストで作った予約と枠を片付ける
export async function removeTestSlot(slotId) {
  const { data: bookings } = await admin.from('bookings').select('id').eq('slot_id', slotId);
  const ids = (bookings ?? []).map((b) => b.id);
  if (ids.length > 0) {
    await admin.from('notification_outbox').delete().in('booking_id', ids);
    await admin.from('bookings').delete().in('id', ids);
  }
  await admin.from('slots').delete().eq('id', slotId);
}

export function jstTime(iso) {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
