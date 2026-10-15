import { NextResponse } from 'next/server';
import { dispatchPending } from '@/lib/notify/dispatch';
import { bearerToken, isServerConfigured, userFromRequest } from '@/lib/server/supabase-admin';

// 送信待ちの通知を送る。呼び出し元は次のどちらか：
//   ・予約・キャンセルの直後に画面から（ログイン中のユーザーのトークンつき）
//   ・定期実行（Authorization: Bearer <CRON_SECRET>。Vercel Cron などから GET でも呼べる）
export const dynamic = 'force-dynamic';

async function authorized(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && bearerToken(req) === secret) return true;
  return (await userFromRequest(req)) !== null;
}

async function handle(req: Request, allowUser: boolean) {
  if (!isServerConfigured()) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY が設定されていません' }, { status: 500 });
  }
  const secret = process.env.CRON_SECRET;
  const ok = allowUser ? await authorized(req) : !!secret && bearerToken(req) === secret;
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const summary = await dispatchPending(20);
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handle(req, true);
}

export async function GET(req: Request) {
  return handle(req, false);
}
