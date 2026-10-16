import { NextResponse } from 'next/server';
import { adminClient, isServerConfigured, userClient, userFromRequest } from '@/lib/server/supabase-admin';
import { mailKey, sendMail } from '@/lib/server/mail';

// 掲載希望を見送る：運営の権限で DB の関数（admin_reject_application）を呼び、申込のメールアドレスへ「見送りのご連絡」を送る
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!isServerConfigured()) return NextResponse.json({ error: 'サーバーの設定が足りません' }, { status: 500 });
  const caller = await userFromRequest(req);
  if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const asCaller = userClient(caller.token);
  const { data: isAdmin } = await asCaller.rpc('is_admin');
  if (isAdmin !== true) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { applicationId?: string; notify?: boolean } | null;
  if (!body?.applicationId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { data: app } = await asCaller
    .from('salon_applications')
    .select('id,email,contact_name,salon_name,salon_id,applicant_user_id')
    .eq('id', body.applicationId)
    .maybeSingle();
  if (!app) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { error } = await asCaller.rpc('admin_reject_application', { p_application_id: app.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  let mailStatus = 'skipped';
  if (body.notify !== false) {
    try {
      mailStatus = await sendMail(adminClient(), {
        kind: 'salon_rejected_mail',
        to: app.email,
        salonId: app.salon_id,
        dedupeKey: mailKey('salon_rejected_mail', app.id),
        payload: { salon_name: app.salon_name, contact_name: app.contact_name, email: app.email },
      });
    } catch {
      mailStatus = 'failed';
    }
  }
  // 新規登録で作った、確認前（一度もログインしていない）のアカウントは消す（同じメールアドレスで、改めて申し込めるように）
  if (app.applicant_user_id) {
    const admin = adminClient();
    const { data: u } = await admin.auth.admin.getUserById(app.applicant_user_id);
    if (u.user && !u.user.email_confirmed_at && !u.user.last_sign_in_at && u.user.user_metadata?.signup_role === 'salon') {
      const [{ data: m }, { data: op }] = await Promise.all([
        admin.from('salon_members').select('salon_id').eq('user_id', app.applicant_user_id).limit(1),
        admin.from('admins').select('user_id').eq('user_id', app.applicant_user_id).limit(1),
      ]);
      if ((m?.length ?? 0) === 0 && (op?.length ?? 0) === 0) await admin.auth.admin.deleteUser(app.applicant_user_id);
    }
  }
  return NextResponse.json({ ok: true, mailStatus });
}
