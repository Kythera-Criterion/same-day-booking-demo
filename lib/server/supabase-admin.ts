import 'server-only';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

// サーバー側の処理（app/api 配下）だけで使う。画面側のコードから読み込むとビルドが失敗する
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

export function isServerConfigured(): boolean {
  return url !== '' && anonKey !== '' && serviceKey !== '';
}

// RLS を通らないクライアント。関数の呼び出しとアカウント作成だけに使う
export function adminClient(): SupabaseClient {
  return createClient(url, serviceKey, noSession);
}

// ログイン前のクライアント（サーバー側でのデモログインに使う）
export function anonClient(): SupabaseClient {
  return createClient(url, anonKey, noSession);
}

// 呼び出した人の権限で動くクライアント（RLS と関数の中の権限確認がそのまま効く）
export function userClient(accessToken: string): SupabaseClient {
  return createClient(url, anonKey, {
    ...noSession,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

// リクエストの Authorization からログイン中のユーザーを確かめる
export async function userFromRequest(req: Request): Promise<{ user: User; token: string } | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const { data, error } = await anonClient().auth.getUser(token);
  if (error || !data.user) return null;
  return { user: data.user, token };
}

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}
