import { NextResponse } from 'next/server';
import { adminClient, isServerConfigured, userClient, userFromRequest } from '@/lib/server/supabase-admin';
import { appOrigin, createStartLink, enqueueWelcome, welcomeStatus, type Application } from '@/lib/server/invite';
import { dispatchPending } from '@/lib/notify/dispatch';
import { mailKey, sendMail } from '@/lib/server/mail';

// ご利用開始のご案内メールを送り直す（リンクの期限切れ・メールが届かないとき）。運営だけ
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!isServerConfigured()) return NextResponse.json({ error: 'サーバーの設定が足りません' }, { status: 500 });
  const caller = await userFromRequest(req);
  if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const asCaller = userClient(caller.token);
  const { data: isAdmin } = await asCaller.rpc('is_admin');
  if (isAdmin !== true) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { applicationId?: string } | null;
  if (!body?.applicationId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { data: app } = await asCaller
    .from('salon_applications')
    .select('id,email,contact_name,salon_name,status,salon_id,invite_count,applicant_user_id')
    .eq('id', body.applicationId)
    .maybeSingle();
  if (!app) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (app.status !== 'approved' || !app.salon_id) return NextResponse.json({ error: 'not_approved' }, { status: 409 });

  const admin = adminClient();
  // 確認が済んでいるアカウント（自分でログインできる）には「掲載開始のお知らせ」を、
  // 確認がまだのアカウント（新規登録のリンクを開いていない）には、確認のリンクつきのご案内を送り直す
  const { data: applicant } = app.applicant_user_id ? await admin.auth.admin.getUserById(app.applicant_user_id) : { data: null };
  if (applicant?.user?.email_confirmed_at) {
    try {
      const mailStatus = await sendMail(admin, {
        kind: 'salon_approved_mail',
        to: app.email,
        salonId: app.salon_id,
        dedupeKey: mailKey('salon_approved_mail', app.id),
        payload: { salon_name: app.salon_name, contact_name: app.contact_name, email: app.email, login_link: `${appOrigin(req)}/salon` },
      });
      const count = (app.invite_count ?? 0) + 1;
      await admin.from('salon_applications').update({ invite_sent_at: new Date().toISOString(), invite_count: count }).eq('id', app.id);
      await admin.from('audit_logs').insert({ actor: caller.user.id, action: 'resend_approved_mail', target_id: app.id });
      return NextResponse.json({ staffEmail: app.email, inviteLink: null, mailStatus, count, selfRegistered: true });
    } catch (e) {
      console.error('[resend-invite]', e);
      return NextResponse.json({ error: 'mail_failed' }, { status: 500 });
    }
  }
  try {
    const start = await createStartLink(admin, app.email, `${app.salon_name} ${app.contact_name}`, appOrigin(req), 'invite');
    // 念のため、スタッフの紐づけがなければ付け直す
    await admin.from('salon_members').upsert({ salon_id: app.salon_id, user_id: start.userId });
    const link = `${start.link}&salon=${encodeURIComponent(app.salon_id)}`;
    const { data: passwordSet } = await admin.rpc('user_has_password', { p_user_id: start.userId });
    const count = await enqueueWelcome(admin, app as Application, app.salon_id, link, passwordSet === true);
    await dispatchPending();
    const mailStatus = await welcomeStatus(admin, app.id, count);
    await admin.from('audit_logs').insert({ actor: caller.user.id, action: 'resend_invite', target_id: app.id });
    return NextResponse.json({ staffEmail: app.email, inviteLink: link, mailStatus, count });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
