// 検証スクリプト共通の設定
import { createClient } from '@supabase/supabase-js';

export const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const PASSWORD = process.env.DEMO_PASSWORD || 'demo-pass-2026';

export const SALON_A = '11111111-1111-4111-8111-111111111111';
export const SALON_B = '22222222-2222-4222-8222-222222222222';
export const MENU_A = 'd1111111-1111-4111-8111-111111111111';

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

// 今日の、今から40分以上先の開始時刻（日本時間9時以降、今日中）。作れない時間帯なら null
export function testStartTime(offsetMinutes = 40) {
  const now = Date.now();
  const step = 5 * 60 * 1000;
  let t = Math.ceil((now + offsetMinutes * 60 * 1000) / step) * step;
  const jstNow = new Date(now + 9 * 3600 * 1000);
  const todayEnd = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate() + 1) - 9 * 3600 * 1000;
  const nineAm = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate(), 9, 30) - 9 * 3600 * 1000;
  if (t < nineAm) t = nineAm;
  if (t + 60 * 60 * 1000 > todayEnd) return null;
  return new Date(t);
}

export async function createTestSlot(salonId = SALON_A, menuId = MENU_A) {
  const start = testStartTime();
  if (!start) {
    console.error('今日はもう枠を作れる時間がありません（日本時間で23時より前に実行してください）。');
    process.exit(1);
  }
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const { data, error } = await admin
    .from('slots')
    .insert({ salon_id: salonId, menu_id: menuId, start_at: start.toISOString(), end_at: end.toISOString(), price: 4500 })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function jstTime(iso) {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
