import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isConfigured = url !== '' && anonKey !== '';

export type Role = 'user' | 'salon' | 'admin';

const clients = new Map<string, SupabaseClient>();

// 同じブラウザで「利用者」「サロン」「運営」に別々にログインできるよう、ログイン情報の保存先を役割ごとに分ける。
// 保存先は localStorage：タブを閉じても、次に開いたときにログインしたまま使える。
export function getClient(kind: Role): SupabaseClient {
  const existing = clients.get(kind);
  if (existing) return existing;

  const client = createClient(url, anonKey, {
    auth: {
      storageKey: `demo-${kind}-auth`,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      // メールのリンクで戻ってきたときのログインは、利用者の画面だけで受け取る
      detectSessionInUrl: kind === 'user',
    },
  });
  clients.set(kind, client);
  return client;
}

// 役割ごとのログイン状態。
// signedOut：この画面を開いている間にログアウトした（別のタブでのログアウト・ログインの期限切れを含む）
export function useRoleSession(kind: Role) {
  const client = useMemo(() => (isConfigured ? getClient(kind) : null), [kind]);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    if (!client) return;
    let active = true;
    client.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = client.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_OUT') setSignedOut(true);
      else if (s) setSignedOut(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [client]);

  return { client, session, ready, signedOut };
}

// 埋め込みで取得した関連データは、配列でも単体でも扱えるようにする
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
