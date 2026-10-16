import { NextResponse } from 'next/server';
import { adminClient, isServerConfigured, userClient, userFromRequest } from '@/lib/server/supabase-admin';
import { appOrigin, createStartLink, enqueueWelcome, welcomeStatus, type Application } from '@/lib/server/invite';
import { mailKey, sendMail } from '@/lib/server/mail';
import { dispatchPending } from '@/lib/notify/dispatch';

// 掲載希望の承認：運営だけが呼べる。
//   1. 呼び出した人が運営かを、その人の権限で確かめる（is_admin）
//   ・以前の形の自己登録（アカウント・サロンが作成済み）：掲載を始め、「掲載開始のお知らせ」を送る
//   ・サロンの画面の「新規登録」からの申込（アカウントは作成済み・確認前）と、公開フォームからの申込：
//     2. 「ご利用開始」のリンクを、サーバー側で作る（新規登録のアカウントには、登録の確認とログインを兼ねたリンク。
//        フォームの申込には、アカウントを作ってパスワードを決めるリンク）
//     3. サロンの作成とスタッフの紐づけは、運営の権限で DB の関数（admin_approve_application）が行う
//     4. 申込のメールアドレスへ「ご利用開始のご案内」を自動で送る（キーがなければシミュレーション送信）
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

  const { data: app, error: appError } = await asCaller
    .from('salon_applications')
    .select('id,email,contact_name,salon_name,status,salon_id,invite_count,applicant_user_id')
    .eq('id', body.applicationId)
    .maybeSingle();
  if (appError || !app) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (app.status !== 'pending') return NextResponse.json({ error: 'already_closed' }, { status: 409 });

  const admin = adminClient();
  const origin = appOrigin(req);

  // サロンが自分で登録した申込
  if (app.salon_id) {
    const { data: salonId, error: approveError } = await asCaller.rpc('admin_approve_application', { p_application_id: app.id, p_staff_user_id: null });
    if (approveError) return NextResponse.json({ error: approveError.message }, { status: 400 });
    let mailStatus = 'pending';
    try {
      mailStatus = await sendMail(admin, {
        kind: 'salon_approved_mail',
        to: app.email,
        salonId: salonId as string,
        dedupeKey: mailKey('salon_approved_mail', app.id),
        payload: { salon_name: app.salon_name, contact_name: app.contact_name, email: app.email, login_link: `${origin}/salon` },
      });
      await admin.from('salon_applications').update({ invite_sent_at: new Date().toISOString(), invite_count: (app.invite_count ?? 0) + 1 }).eq('id', app.id);
    } catch {
      mailStatus = 'failed';
    }
    return NextResponse.json({ salonId, staffEmail: app.email, inviteLink: null, mailStatus, selfRegistered: true });
  }

  let start;
  try {
    start = await createStartLink(admin, app.email, `${app.salon_name} ${app.contact_name}`, origin, 'invite');
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const { data: salonId, error: approveError } = await asCaller.rpc('admin_approve_application', {
    p_application_id: app.id,
    p_staff_user_id: start.userId,
  });
  if (approveError) {
    // 承認できなかったときは、いま作ったばかりのアカウントを残さない（申し込んだ人のアカウントなど、前からあるものは消さない）
    if (start.created) await admin.auth.admin.deleteUser(start.userId);
    return NextResponse.json({ error: approveError.message }, { status: 400 });
  }

  // ご利用開始のご案内メールを積んで、すぐに送る。
  // リンクには承認したお店を付ける（2店舗目の申し込みでも、開いたときにそのお店を表示する）
  const link = `${start.link}&salon=${encodeURIComponent(salonId as string)}`;
  const { data: passwordSet } = await admin.rpc('user_has_password', { p_user_id: start.userId });
  let mailStatus = 'pending';
  try {
    const count = await enqueueWelcome(admin, app as Application, salonId as string, link, passwordSet === true);
    await dispatchPending();
    mailStatus = await welcomeStatus(admin, app.id, count);
  } catch {
    mailStatus = 'failed';
  }

  return NextResponse.json({ salonId, staffEmail: app.email, inviteLink: link, mailStatus });
}
