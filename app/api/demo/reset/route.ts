import { NextResponse } from 'next/server';
import { demoOnly } from '@/lib/server/demo';
import { adminClient } from '@/lib/server/supabase-admin';

// デモをリセット：今の時刻を基準に、今日の空き枠と状態を作り直す（必要なら過去7日分の架空データも）
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const blocked = demoOnly();
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as { history?: boolean };
  const { data, error } = await adminClient().rpc('demo_reset', { p_with_history: body.history === true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
