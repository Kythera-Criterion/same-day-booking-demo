import { NextResponse } from 'next/server';
import { adminClient, isDemoMode, isServerConfigured } from '@/lib/server/supabase-admin';
import { appOrigin } from '@/lib/server/invite';
import { findUserByEmail } from '@/lib/server/accounts';
import { mailKey, sendMail } from '@/lib/server/mail';
import { allow, clientIp } from '@/lib/server/rate-limit';

// パスワードの再設定（利用者・サロン・運営）。
//   1. 一度だけ使える再設定のリンクを作る（そのアカウントの役割の画面で、リンクを確かめる）
//   2. 「パスワードの再設定」のメールを、このサービスから送る（Supabase 標準のメール送信の制限に左右されない）
// 登録の有無が外から分からないよう、返事はいつも同じにする（メールのキーがないデモでは、リンクを画面に返す）
export const dynamic = 'force-dynamic';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: Request) {
  if (!isServerConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 500 });
  const body = (await req.json().catch(() => null)) as { email?: string; role?: string } | null;
  const email = String(body?.email ?? '').trim().toLowerCase();
  const role = body?.role === 'salon' || body?.role === 'admin' ? body.role : 'user';
  if (!EMAIL.test(email) || email.length > 120) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  if (!allow(`forgot-mail:${email}`, 3, 10 * 60 * 1000) || !allow(`forgot-ip:${clientIp(req)}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const admin = adminClient();
  const userId = await findUserByEmail(admin, email);
  let demoLink: string | null = null;
  if (userId) {
    const { data: link, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
    const hashed = link?.properties?.hashed_token;
    if (error || !hashed) return NextResponse.json({ error: 'link_failed' }, { status: 500 });
    const url = `${appOrigin(req)}/reset?token_hash=${encodeURIComponent(hashed)}&role=${role}`;
    const { data: profile } = await admin.from('profiles').select('display_name').eq('id', userId).maybeSingle();
    const mail = await sendMail(admin, {
      kind: 'password_reset_mail',
      to: email,
      dedupeKey: mailKey('password_reset_mail', userId),
      payload: { salon_name: '', role, email, display_name: (profile?.display_name as string | undefined) ?? '', invite_link: url },
    });
    if (isDemoMode() && mail === 'simulated') demoLink = url;
    await admin.from('audit_logs').insert({ actor: userId, action: 'password_reset_request', target_id: userId, detail: { role } });
  }
  return NextResponse.json({ ok: true, demoLink });
}
