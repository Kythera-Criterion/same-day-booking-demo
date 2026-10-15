import { NextResponse } from 'next/server';
import { DEMO_USERS, demoOnly, demoSession } from '@/lib/server/demo';
import { adminClient } from '@/lib/server/supabase-admin';
import { dispatchPending } from '@/lib/notify/dispatch';

// 同時予約チャレンジ：同じ枠に10人のデモ利用者が同時に予約する。成立は1件だけになる
export const dynamic = 'force-dynamic';

export async function POST() {
  const blocked = demoOnly();
  if (blocked) return blocked;

  try {
    const admin = adminClient();
    const sessions = await Promise.all(DEMO_USERS.map((email) => demoSession(email)));
    const { data: slot, error: slotError } = await admin.rpc('demo_prepare_challenge');
    if (slotError) return NextResponse.json({ error: slotError.message }, { status: 500 });

    const { data: profiles } = await admin
      .from('profiles')
      .select('id,display_name')
      .in(
        'id',
        sessions.map((s) => s.userId),
      );
    const names = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string]));

    // 10件を同時に送る
    const started = Date.now();
    const results = await Promise.all(
      sessions.map(async ({ client, userId }, i) => {
        const { error } = await client.rpc('book_slot', { p_slot_id: (slot as { id: string }).id });
        return {
          no: i + 1,
          name: names.get(userId) ?? `利用者${i + 1}`,
          ok: !error,
          code: error ? (error.message.match(/[a-z_]+/)?.[0] ?? 'error') : null,
          ms: Date.now() - started,
        };
      }),
    );
    const { count } = await admin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('slot_id', (slot as { id: string }).id)
      .eq('status', 'confirmed');
    dispatchPending().catch(() => undefined);

    return NextResponse.json({ slot, results, confirmedInDb: count ?? 0 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
