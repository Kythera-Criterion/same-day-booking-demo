import { NextResponse } from 'next/server';
import { isServerConfigured, userFromRequest } from '@/lib/server/supabase-admin';
import { appOrigin } from '@/lib/server/invite';
import { allow, clientIp } from '@/lib/server/rate-limit';
import { BACK_COOKIE, FLOW_COOKIE, authorizeUrl, cookieOptions, isProviderId, newFlow, providerState, sealFlow } from '@/lib/server/oauth';
import { safePath, type FlowMode, type FlowRole } from '@/lib/oauth-shared';

// 外部の ID での登録・ログインを始める。
// 手続きの情報（state・nonce・PKCE）を署名つきの Cookie に入れ、移動先の URL（本物の認証画面、またはデモ用の認証画面）を返す
export const dynamic = 'force-dynamic';

const ROLES: FlowRole[] = ['user', 'salon', 'admin'];
const MODES: FlowMode[] = ['login', 'signup', 'link'];

export async function POST(req: Request) {
  if (!isServerConfigured()) return NextResponse.json({ error: 'provider_off' }, { status: 500 });
  if (!allow(`oauth-start:${clientIp(req)}`, 30, 10 * 60 * 1000)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { provider?: string; role?: string; mode?: string; next?: string; back?: string } | null;
  const provider = body?.provider;
  const role = body?.role as FlowRole;
  const mode = body?.mode as FlowMode;
  if (!isProviderId(provider) || !ROLES.includes(role) || !MODES.includes(mode)) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  // 運営は招待だけで登録する（外部の ID での新規登録はしない）
  if (role === 'admin' && mode === 'signup') return NextResponse.json({ error: 'not_admin' }, { status: 400 });

  const state = providerState(provider);
  if (state === 'off') return NextResponse.json({ error: 'provider_off' }, { status: 400 });

  let linkUser: string | undefined;
  if (mode === 'link') {
    const caller = await userFromRequest(req);
    if (!caller) return NextResponse.json({ error: 'link_session' }, { status: 401 });
    linkUser = caller.user.id;
  }

  const origin = appOrigin(req);
  const { flow, challenge } = newFlow({
    p: provider,
    r: role,
    m: mode,
    n: safePath(body?.next, role === 'salon' ? '/salon' : role === 'admin' ? '/admin' : '/'),
    b: safePath(body?.back, role === 'salon' ? '/salon' : role === 'admin' ? '/admin' : '/login'),
    u: linkUser,
  });
  const url = flow.sim ? `${origin}/auth/demo-provider?provider=${provider}` : authorizeUrl(flow, challenge, origin);
  const res = NextResponse.json({ url, simulated: flow.sim });
  res.cookies.set(FLOW_COOKIE, sealFlow(flow), cookieOptions(origin.startsWith('https://')));
  res.cookies.set(BACK_COOKIE, flow.b, { ...cookieOptions(origin.startsWith('https://')), maxAge: 24 * 60 * 60 });
  return res;
}
