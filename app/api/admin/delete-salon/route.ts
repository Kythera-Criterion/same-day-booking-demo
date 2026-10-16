import { NextResponse } from 'next/server';
import { adminClient, isServerConfigured, userClient, userFromRequest } from '@/lib/server/supabase-admin';

// サロンを削除する（運営だけ）。
//   ・削除してよいかの判定（予約の履歴がない・デモ用でない）とサロンの削除は、運営の権限で DB の関数が行う
//   ・そのサロンだけのスタッフのアカウントは、サーバー側で消す
//     （ほかのサロンのスタッフ・運営・利用者として予約したことがあるアカウント・デモ用のアカウントは残す）
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!isServerConfigured()) return NextResponse.json({ error: 'サーバーの設定が足りません' }, { status: 500 });
  const caller = await userFromRequest(req);
  if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const asCaller = userClient(caller.token);

  const body = (await req.json().catch(() => null)) as { salonId?: string } | null;
  if (!body?.salonId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { data, error } = await asCaller.rpc('admin_delete_salon', { p_salon_id: body.salonId });
  if (error) {
    const code = /forbidden|demo_salon|has_bookings|not_found/.exec(error.message)?.[0] ?? error.message;
    return NextResponse.json({ error: code }, { status: code === 'forbidden' ? 403 : 409 });
  }
  const result = data as { name: string; staff: string[]; slots: number };

  const admin = adminClient();
  const removed: string[] = [];
  const kept: string[] = [];
  for (const userId of result.staff ?? []) {
    const [{ data: other }, { data: op }, { data: asCustomer }, { data: agreed }, { data: prof }, { data: u }] = await Promise.all([
      admin.from('salon_members').select('salon_id').eq('user_id', userId).limit(1),
      admin.from('admins').select('user_id').eq('user_id', userId).limit(1),
      admin.from('bookings').select('id').eq('user_id', userId).limit(1),
      // お客様として登録しているアカウント（規約への同意・18歳以上の確認がある）も残す
      admin.from('consents').select('id').eq('user_id', userId).limit(1),
      admin.from('profiles').select('adult_confirmed_at').eq('id', userId).maybeSingle(),
      admin.auth.admin.getUserById(userId),
    ]);
    const email = u?.user?.email ?? '';
    const isCustomer = (asCustomer?.length ?? 0) > 0 || (agreed?.length ?? 0) > 0 || !!prof?.adult_confirmed_at;
    if ((other?.length ?? 0) > 0 || (op?.length ?? 0) > 0 || isCustomer || email.endsWith('@demo.test')) {
      kept.push(email);
      continue;
    }
    const { error: delError } = await admin.auth.admin.deleteUser(userId);
    if (delError) kept.push(email);
    else removed.push(email);
  }

  return NextResponse.json({ name: result.name, slots: result.slots, removedStaff: removed, keptStaff: kept });
}
