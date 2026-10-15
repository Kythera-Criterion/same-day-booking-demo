import { NextResponse } from 'next/server';
import { anonClient, isDemoMode } from '@/lib/server/supabase-admin';

// ワンタップのデモログイン：パスワードは画面側に置かず、サーバー側でサインインしてセッションだけを返す
// DEMO_MODE=true のときだけ動く（それ以外は404）
export const dynamic = 'force-dynamic';

const ALLOWED = /^(user([1-9]|10)|salon-[abc]|admin)@demo\.test$/;

export async function POST(req: Request) {
  if (!isDemoMode()) return new NextResponse('Not Found', { status: 404 });

  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email ?? '';
  if (!ALLOWED.test(email)) return NextResponse.json({ error: 'デモ用のアカウントではありません' }, { status: 400 });

  const password = process.env.DEMO_PASSWORD;
  if (!password) return NextResponse.json({ error: 'DEMO_PASSWORD が設定されていません' }, { status: 500 });

  const { data, error } = await anonClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return NextResponse.json({ error: 'ログインできませんでした。npm run setup:demo を実行済みか確認してください' }, { status: 401 });
  }
  return NextResponse.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
}
