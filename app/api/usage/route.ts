import { NextResponse } from 'next/server';
import { allow, clientIp } from '@/lib/server/rate-limit';
import { adminClient, anonClient, isServerConfigured } from '@/lib/server/supabase-admin';

// デモの利用の記録を受け取る（components/UsageTracker から。離れるときは sendBeacon で届く）
//   ・ページを開いた・利用時間・使った機能（押したボタンなどの名前）は、DB の関数 usage_track に渡す（だれでも呼べる関数）
//   ・ログインのトークンが付いていれば、ここで確かめてから、そのアカウント（番号・メールアドレス・役割）を訪問に結びつける
//     （usage_set_account はサーバー側からだけ呼べる。画面が名乗ったメールアドレスは使わない）
//   IP アドレスは残さない（回数制限にだけ使う）
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ['start', 'beat', 'feature'];
const ROLES = ['user', 'salon', 'admin'];

export async function POST(req: Request) {
  if (!isServerConfigured()) return new NextResponse(null, { status: 204 });
  if (!allow(`usage:${clientIp(req)}`, 1200, 10 * 60_000)) return NextResponse.json({ error: 'too many' }, { status: 429 });

  // sendBeacon は text/plain で送るので、本文を文字列で受けてから読む
  let body: { visit?: unknown; visitor?: unknown; kind?: unknown; path?: unknown; seconds?: unknown; device?: unknown; token?: unknown; role?: unknown; label?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { visit, visitor, kind, path, seconds, device, token, role, label } = body;
  if (typeof visit !== 'string' || !UUID.test(visit) || typeof visitor !== 'string' || !UUID.test(visitor) || typeof kind !== 'string' || !KINDS.includes(kind)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const { error } = await anonClient().rpc('usage_track', {
    p_visit_id: visit,
    p_visitor_id: visitor,
    p_kind: kind,
    p_path: typeof path === 'string' ? path.slice(0, 200) : null,
    p_seconds: typeof seconds === 'number' && Number.isFinite(seconds) ? Math.round(seconds) : 0,
    p_device: typeof device === 'string' ? device : null,
    p_label: typeof label === 'string' ? label.slice(0, 80) : null,
  });
  if (error) return NextResponse.json({ error: 'failed' }, { status: 400 });

  if ((kind === 'start' || kind === 'beat') && typeof token === 'string' && token.length < 4096 && typeof role === 'string' && ROLES.includes(role)) {
    const admin = adminClient();
    const { data } = await admin.auth.getUser(token);
    if (data.user?.email) {
      await admin.rpc('usage_set_account', {
        p_visit_id: visit,
        p_visitor_id: visitor,
        p_user_id: data.user.id,
        p_email: data.user.email,
        p_role: role,
      });
    }
  }
  return new NextResponse(null, { status: 204 });
}
