import { NextResponse } from 'next/server';
import { adminClient, isServerConfigured, userClient, userFromRequest } from '@/lib/server/supabase-admin';
import { appOrigin, createStartLink, enqueueWelcome, welcomeStatus, type Application } from '@/lib/server/invite';
import { dispatchPending } from '@/lib/notify/dispatch';

// 掲載希望の承認：運営だけが呼べる。
//   1. 呼び出した人が運営かを、その人の権限で確かめる（is_admin）
//   2. スタッフのアカウントと「ご利用開始」のリンクを、サーバー側で作る
//   3. サロンの作成とスタッフの紐づけは、運営の権限で DB の関数（admin_approve_application）が行う
//   4. 申込のメールアドレスへ「ご利用開始のご案内」を自動で送る（キーがなければシミュレーション送信）
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
    .select('id,email,contact_name,salon_name,status,salon_id,invite_count')
    .eq('id', body.applicationId)
    .maybeSingle();
  if (appError || !app) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (app.status !== 'pending') return NextResponse.json({ error: 'already_closed' }, { status: 409 });

  const admin = adminClient();
  let start;
  try {
    start = await createStartLink(admin, app.email, `${app.salon_name} ${app.contact_name}`, appOrigin(req), 'invite');
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const { data: salonId, error: approveError } = await asCaller.rpc('admin_approve_application', {
    p_application_id: app.id,
    p_staff_user_id: start.userId,
  });
  if (approveError) {
    // 承認できなかったときは、いま作ったばかりのアカウントを残さない
    if (start.type === 'invite') await admin.auth.admin.deleteUser(start.userId);
    return NextResponse.json({ error: approveError.message }, { status: 400 });
  }

  // ご利用開始のご案内メールを積んで、すぐに送る
  let mailStatus = 'pending';
  try {
    const count = await enqueueWelcome(admin, app as Application, salonId as string, start.link);
    await dispatchPending();
    mailStatus = await welcomeStatus(admin, app.id, count);
  } catch {
    mailStatus = 'failed';
  }

  return NextResponse.json({ salonId, staffEmail: app.email, inviteLink: start.link, mailStatus });
}
