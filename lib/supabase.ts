import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isConfigured = url !== '' && anonKey !== '';

const clients = new Map<string, SupabaseClient>();

// 同じブラウザで「利用者」と「サロン」に別々にログインできるよう、ログイン情報の保存先を分ける。
// また、タブごとに別の利用者でログインできるよう sessionStorage を使う（同時予約の実演用）。
export function getClient(kind: 'user' | 'salon'): SupabaseClient {
  const existing = clients.get(kind);
  if (existing) return existing;

  const client = createClient(url, anonKey, {
    auth: {
      storageKey: `demo-${kind}-auth`,
      storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  clients.set(kind, client);
  return client;
}

// 埋め込みで取得した関連データは、配列でも単体でも扱えるようにする
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
