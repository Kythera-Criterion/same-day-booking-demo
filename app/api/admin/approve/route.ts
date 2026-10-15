import { NextResponse } from 'next/server';
import { adminClient, isServerConfigured, userClient, userFromRequest } from '@/lib/server/supabase-admin';

// 掲載希望の承認：運営だけが呼べる。
//   1. 呼び出した人が運営かを、その人の権限で確かめる（is_admin）
//   2. スタッフのアカウントをサーバー側で作り、招待リンクを発行する（メールはまだ送らない）
//   3. サロンの作成とスタッフの紐づけは、運営の権限で DB の関数（admin_approve_application）が行う
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
    .select('id,email,contact_name,salon_name,status')
    .eq('id', body.applicationId)
    .maybeSingle();
  if (appError || !app) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (app.status !== 'pending') return NextResponse.json({ error: 'already_closed' }, { status: 409 });

  // スタッフのアカウント（すでにあればそれを使う）。招待リンクを作るだけで、メールは送らない
  const admin = adminClient();
  const origin = new URL(req.url).origin;
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'invite',
    email: app.email,
    options: { data: { display_name: `${app.salon_name} ${app.contact_name}` }, redirectTo: `${origin}/salon` },
  });
  let staffId = link?.user?.id ?? null;
  let inviteLink: string | null = link?.properties?.action_link ?? null;
  if (linkError) {
    // すでに登録済みのメールアドレスなら、そのアカウントを紐づける
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    staffId = list?.users.find((u) => u.email === app.email)?.id ?? null;
    inviteLink = null;
    if (!staffId) return NextResponse.json({ error: `アカウントを作れませんでした（${linkError.message}）` }, { status: 500 });
  }

  const { data: salonId, error: approveError } = await asCaller.rpc('admin_approve_application', {
    p_application_id: app.id,
    p_staff_user_id: staffId,
  });
  if (approveError) return NextResponse.json({ error: approveError.message }, { status: 400 });

  return NextResponse.json({ salonId, staffEmail: app.email, inviteLink });
}
