import { NextResponse } from 'next/server';

// 運営の「システム状況」：サーバーが動いているか・通知の送り先（LINE・メール）のキーが入っているか。
// キーの中身は返さない（入っているかどうかだけ）
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    line: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
    mail: !!process.env.RESEND_API_KEY,
    demo: process.env.DEMO_MODE === 'true',
  });
}
