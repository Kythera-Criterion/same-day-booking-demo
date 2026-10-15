import { NextResponse } from 'next/server';
import { adminClient, isServerConfigured, userFromRequest } from '@/lib/server/supabase-admin';

// 利用者のアカウントを削除する（本人だけ）。
//   ・ご予約中（確定済みで、枠の終了時刻を過ぎていない予約がある）なら削除しない
//   ・サロンのスタッフ・運営のアカウントは、ここでは削除しない
//   ・ヘア写真は消す。予約の写し（お店に渡した内容）と無断キャンセルの記録は、規約どおり残る
//     （プロフィールは削除され、予約の user_id は空になる。無断キャンセルの記録は電話番号に紐づき90日間残る）
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!isServerConfigured()) return NextResponse.json({ error: 'サーバーの設定が足りません' }, { status: 500 });
  const caller = await userFromRequest(req);
  if (!caller) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  const uid = caller.user.id;

  if ((caller.user.email ?? '').endsWith('@demo.test')) {
    return NextResponse.json({ error: 'demo_account' }, { status: 403 });
  }

  const admin = adminClient();

  const [{ data: staff }, { data: op }] = await Promise.all([
    admin.from('salon_members').select('salon_id').eq('user_id', uid).limit(1),
    admin.from('admins').select('user_id').eq('user_id', uid).limit(1),
  ]);
  if ((staff?.length ?? 0) > 0 || (op?.length ?? 0) > 0) {
    return NextResponse.json({ error: 'staff_account' }, { status: 403 });
  }

  const { data: active } = await admin
    .from('bookings')
    .select('id,slots!inner(end_at)')
    .eq('user_id', uid)
    .eq('status', 'confirmed')
    .gt('slots.end_at', new Date().toISOString())
    .limit(1);
  if ((active?.length ?? 0) > 0) return NextResponse.json({ error: 'has_active_booking' }, { status: 409 });

  // ヘア写真（本人のフォルダ）を消す
  const { data: files } = await admin.storage.from('hair-photos').list(uid, { limit: 1000 });
  if (files && files.length > 0) {
    await admin.storage.from('hair-photos').remove(files.map((f) => `${uid}/${f.name}`));
  }

  await admin.from('audit_logs').insert({ actor: uid, action: 'delete_account', target_id: uid });
  const { error } = await admin.auth.admin.deleteUser(uid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
