import { NextResponse } from 'next/server';
import { adminClient, isDemoMode, isServerConfigured } from '@/lib/server/supabase-admin';
import { appOrigin } from '@/lib/server/invite';
import { completeUrl, findUserByEmail } from '@/lib/server/accounts';
import { mailKey, sendMail } from '@/lib/server/mail';
import { allow, clientIp } from '@/lib/server/rate-limit';
import { safePath } from '@/lib/oauth-shared';

// 「メールアドレスの確認のお願い」をもう一度送る（確認がまだのアカウントだけ。60秒に1回まで）
// 返事は、アカウントの有無にかかわらず同じにする
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!isServerConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 500 });
  const body = (await req.json().catch(() => null)) as { email?: string; role?: string; next?: string } | null;
  const email = String(body?.email ?? '').trim().toLowerCase();
  const role = body?.role === 'salon' ? 'salon' : 'user';
  if (!email) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  if (!allow(`resend-mail:${email}`, 1, 60 * 1000) || !allow(`resend-ip:${clientIp(req)}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const admin = adminClient();
  const userId = await findUserByEmail(admin, email);
  if (!userId) return NextResponse.json({ ok: true, mail: 'skipped', demoLink: null });
  const { data: u } = await admin.auth.admin.getUserById(userId);
  if (!u.user || u.user.email_confirmed_at) return NextResponse.json({ ok: true, mail: 'skipped', demoLink: null });

  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error || !link?.properties?.hashed_token) return NextResponse.json({ error: error?.message ?? 'link_failed' }, { status: 500 });
  const origin = appOrigin(req);
  const next = safePath(body?.next, role === 'salon' ? '/salon/signup' : '/');
  const confirm = completeUrl(origin, { tokenHash: link.properties.hashed_token, type: 'magiclink', role, next, via: 'email', isNew: true });
  const mail = await sendMail(admin, {
    kind: 'signup_confirm_mail',
    to: email,
    dedupeKey: mailKey('signup_confirm_mail', userId),
    payload: {
      salon_name: '',
      role,
      display_name: (u.user.user_metadata?.display_name as string | undefined) ?? '',
      email,
      invite_link: confirm,
      resend: true,
    },
  });
  return NextResponse.json({ ok: true, mail, demoLink: isDemoMode() && mail === 'simulated' ? confirm : null });
}
