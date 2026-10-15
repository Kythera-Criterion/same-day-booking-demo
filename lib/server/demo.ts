import 'server-only';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { anonClient, isDemoMode, userClient } from './supabase-admin';

// デモ用の API で使う共通の処理（DEMO_MODE=true のときだけ）

export function demoOnly(): NextResponse | null {
  return isDemoMode() ? null : new NextResponse('Not Found', { status: 404 });
}

export const DEMO_USERS = Array.from({ length: 10 }, (_, i) => `user${i + 1}@demo.test`);

// サインインの回数制限にかからないよう、デモ用アカウントのトークンをしばらく使い回す（サーバーのメモリ内だけ）
const cache = new Map<string, { token: string; expiresAt: number; userId: string }>();

export async function demoSession(email: string): Promise<{ client: SupabaseClient; userId: string }> {
  const hit = cache.get(email);
  if (hit && hit.expiresAt - Date.now() > 5 * 60 * 1000) {
    return { client: userClient(hit.token), userId: hit.userId };
  }
  const password = process.env.DEMO_PASSWORD;
  if (!password) throw new Error('DEMO_PASSWORD が設定されていません');
  const { data, error } = await anonClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`${email} でログインできません（npm run setup:demo を実行済みか確認してください）`);
  cache.set(email, {
    token: data.session.access_token,
    expiresAt: (data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
    userId: data.user.id,
  });
  return { client: userClient(data.session.access_token), userId: data.user.id };
}
