'use client';

import type { SupabaseClient } from '@supabase/supabase-js';

// サーバー側でサインインしたセッションを受け取り、役割ごとの保存先に入れる（パスワードは画面側に置かない）
export async function demoLogin(client: SupabaseClient, email: string): Promise<string | null> {
  try {
    const res = await fetch('/api/demo/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string };
    if (!res.ok || !body.access_token || !body.refresh_token) return body.error ?? 'ログインできませんでした。';
    const { error } = await client.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
    return error ? error.message : null;
  } catch {
    return 'ログインできませんでした。';
  }
}
