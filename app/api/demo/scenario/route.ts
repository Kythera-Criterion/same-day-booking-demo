import { NextResponse } from 'next/server';
import { demoOnly, demoSession } from '@/lib/server/demo';
import { adminClient } from '@/lib/server/supabase-admin';
import { dispatchPending } from '@/lib/notify/dispatch';
import { slotStartProblem, startAfter } from '@/lib/time';

// シナリオ再生の1ステップずつ（画面側が数秒おきに順に呼ぶ）
//   publish  サロンAが枠を出す
//   book     利用者が予約する
//   notify   サロンへの通知を送る
//   visit    サロンが来店済みにする（運営の数字が増える）
export const dynamic = 'force-dynamic';

const SALON_EMAIL = 'salon-a@demo.test';
const MENU_ID = 'd1111111-1111-4111-8111-111111111111';

type Body = { step?: string; slotId?: string; bookingId?: string; user?: string };

export async function POST(req: Request) {
  const blocked = demoOnly();
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as Body;

  try {
    if (body.step === 'publish') {
      const { client } = await demoSession(SALON_EMAIL);
      const now = new Date();
      const start = [30, 40, 50, 60, 75, 90].map((m) => startAfter(m, now)).find((d) => !slotStartProblem(d, 10, now));
      if (!start) return NextResponse.json({ error: '今日はもう枠を出せる時間がありません' }, { status: 409 });
      const { data, error } = await client.rpc('create_slot', { p_menu_id: MENU_ID, p_start_at: start.toISOString() });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ slot: data });
    }

    if (body.step === 'book' && body.slotId) {
      const email = /^user([1-9]|10)@demo\.test$/.test(body.user ?? '') ? body.user! : 'user1@demo.test';
      const { client, userId } = await demoSession(email);
      // デモ用：この利用者に残っている予約を閉じてから予約する（1アカウント1件のため）
      const admin = adminClient();
      const { data: open } = await admin
        .from('bookings')
        .select('id,slots!inner(end_at)')
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .gt('slots.end_at', new Date().toISOString());
      if (open && open.length > 0) {
        await admin
          .from('bookings')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .in(
            'id',
            open.map((b) => b.id),
          );
      }
      const { data, error } = await client.rpc('book_slot', { p_slot_id: body.slotId, p_note: 'デモのシナリオ再生' });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ booking: data });
    }

    if (body.step === 'notify') {
      return NextResponse.json({ dispatch: await dispatchPending() });
    }

    if (body.step === 'visit' && body.bookingId) {
      const { client } = await demoSession(SALON_EMAIL);
      const { data, error } = await client.rpc('salon_update_booking', { p_booking_id: body.bookingId, p_action: 'complete' });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ booking: data });
    }

    return NextResponse.json({ error: 'invalid_step' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
