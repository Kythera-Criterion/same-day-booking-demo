import { NextResponse } from 'next/server';
import { adminClient, isServerConfigured, userFromRequest } from '@/lib/server/supabase-admin';
import { isProviderId } from '@/lib/server/oauth';

// ログイン中のアカウントに連携している外部の ID（Google・Yahoo! JAPAN ID）の一覧と、連携の解除
export const dynamic = 'force-dynamic';

async function load(userId: string) {
  const admin = adminClient();
  const [ids, pw] = await Promise.all([
    admin.from('social_identities').select('provider,email,created_at,last_used_at').eq('user_id', userId).order('created_at'),
    admin.rpc('user_has_password', { p_user_id: userId }),
  ]);
  return { identities: ids.data ?? [], hasPassword: pw.data === true };
}

export async function GET(req: Request) {
  if (!isServerConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 500 });
  const caller = await userFromRequest(req);
  if (!caller) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  return NextResponse.json(await load(caller.user.id));
}

export async function DELETE(req: Request) {
  if (!isServerConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 500 });
  const caller = await userFromRequest(req);
  if (!caller) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { provider?: string } | null;
  if (!isProviderId(body?.provider)) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  // ほかにログインする方法（パスワード・別の連携）が残らないなら、解除させない
  const before = await load(caller.user.id);
  const others = before.identities.filter((i) => i.provider !== body.provider).length;
  if (!before.hasPassword && others === 0) return NextResponse.json({ error: 'last_method' }, { status: 409 });

  const admin = adminClient();
  const { error } = await admin.from('social_identities').delete().eq('user_id', caller.user.id).eq('provider', body.provider);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from('audit_logs').insert({ actor: caller.user.id, action: 'unlink_identity', target_id: caller.user.id, detail: { provider: body.provider } });
  return NextResponse.json(await load(caller.user.id));
}
