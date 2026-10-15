import { NextResponse } from 'next/server';
import { adminClient, isServerConfigured, userClient, userFromRequest } from '@/lib/server/supabase-admin';
import { appOrigin, createStartLink } from '@/lib/server/invite';
import { findUserByEmail } from '@/lib/server/accounts';
import { mailKey, sendMail } from '@/lib/server/mail';
import { allow } from '@/lib/server/rate-limit';

// 運営メンバーを招待する（運営だけが呼べる。運営の登録は、この招待だけで行う）
//   ・まだアカウントがないメールアドレス：アカウントを作り、パスワードを決めるリンクつきの招待メールを送る
//   ・すでにアカウントがある（利用者・サロンのスタッフなど）：運営の権限を加え、運営の画面のログイン先を知らせる
//   ・招待したのにまだログインしていない人へは、新しいリンクでもう一度送れる（resend）
export const dynamic = 'force-dynamic';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: Request) {
  if (!isServerConfigured()) return NextResponse.json({ error: 'サーバーの設定が足りません' }, { status: 500 });
  const caller = await userFromRequest(req);
  if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const asCaller = userClient(caller.token);
  const { data: isAdmin } = await asCaller.rpc('is_admin');
  if (isAdmin !== true) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!allow(`invite-admin:${caller.user.id}`, 20, 60 * 60 * 1000)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { email?: string; name?: string; resend?: boolean } | null;
  const email = String(body?.email ?? '').trim().toLowerCase();
  const name = String(body?.name ?? '').trim().slice(0, 60);
  if (!EMAIL.test(email)) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });

  const admin = adminClient();
  const origin = appOrigin(req);
  const existing = await findUserByEmail(admin, email);

  let userId: string;
  let inviteLink: string | null = null;
  let isNewAccount = false;
  if (existing) {
    const { data: u } = await admin.auth.admin.getUserById(existing);
    userId = existing;
    // パスワードを決める前の招待中のアカウントなら、新しいリンクを作り直す
    if (u.user && !u.user.last_sign_in_at) {
      const start = await createStartLink(admin, email, name, origin, 'invite', 'admin').catch(() => null);
      inviteLink = start?.link ?? null;
      isNewAccount = start?.type === 'invite';
    }
  } else {
    if (body?.resend) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    let start;
    try {
      start = await createStartLink(admin, email, name, origin, 'invite', 'admin');
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
    userId = start.userId;
    inviteLink = start.link;
    isNewAccount = true;
  }

  const { data: already } = await admin.from('admins').select('user_id').eq('user_id', userId).maybeSingle();
  if (already && !body?.resend) return NextResponse.json({ error: 'already_admin' }, { status: 409 });
  if (!already) {
    const { error } = await admin.from('admins').insert({ user_id: userId, invited_by: caller.user.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (name) await admin.from('profiles').update({ display_name: name }).eq('id', userId).eq('display_name', '');
  await admin
    .from('audit_logs')
    .insert({ actor: caller.user.id, action: body?.resend ? 'resend_admin_invite' : 'invite_admin', target_id: userId, detail: { email } });

  const { data: inviter } = await admin.from('profiles').select('display_name').eq('id', caller.user.id).maybeSingle();
  let mailStatus = 'pending';
  try {
    mailStatus = await sendMail(admin, {
      kind: 'admin_invite_mail',
      to: email,
      dedupeKey: mailKey('admin_invite_mail', userId),
      payload: {
        salon_name: '',
        display_name: name,
        email,
        invite_link: inviteLink,
        login_link: `${origin}/admin`,
        existing: !isNewAccount && !inviteLink,
        inviter: (inviter?.display_name as string | undefined) || caller.user.email || '',
        resend: !!body?.resend,
      },
    });
  } catch {
    mailStatus = 'failed';
  }
  return NextResponse.json({ ok: true, userId, inviteLink, mailStatus });
}
