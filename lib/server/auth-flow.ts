import 'server-only';
import { NextResponse } from 'next/server';
import { OidcError } from '@/lib/oidc';
import { safePath } from '@/lib/oauth-shared';
import { adminClient } from './supabase-admin';
import { completeUrl, resolveAccount, sessionToken } from './accounts';
import { appOrigin } from './invite';
import { BACK_COOKIE, FLOW_COOKIE, FLOW_COOKIE_PATH, type ExternalProfile, type Flow } from './oauth';

// 外部の ID の手続きの最後：アカウントを決めてログイン状態を作り、画面へ戻す（失敗したら、元の画面へ理由つきで戻す）

function withParam(path: string, key: string, value: string): string {
  const url = new URL(path, 'http://x');
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

function clearCookie(res: NextResponse) {
  res.cookies.set(FLOW_COOKIE, '', { path: FLOW_COOKIE_PATH, maxAge: 0 });
  return res;
}

export function failRedirect(req: Request, flow: Pick<Flow, 'b'> | null, code: string, fallback = '/login'): NextResponse {
  // 手続きの Cookie が切れていても、始めた画面（サロン・運営のログインなど）へ戻す
  const saved = new RegExp(`(?:^|;\\s*)${BACK_COOKIE}=([^;]+)`).exec(req.headers.get('cookie') ?? '')?.[1];
  const back = safePath(flow?.b ?? (saved ? decodeURIComponent(saved) : undefined), fallback);
  return clearCookie(NextResponse.redirect(`${appOrigin(req)}${withParam(back, 'auth_error', code)}`, 303));
}

export async function finishFlow(req: Request, flow: Flow, profile: ExternalProfile): Promise<NextResponse> {
  const origin = appOrigin(req);
  const admin = adminClient();
  try {
    const account = await resolveAccount(admin, flow, profile);
    await admin.from('audit_logs').insert({
      actor: account.userId,
      action: flow.m === 'link' ? 'link_identity' : account.created ? 'signup_social' : 'login_social',
      target_id: account.userId,
      detail: { provider: profile.provider, role: flow.r, simulated: flow.sim },
    });
    // 連携だけなら、ログイン中の画面へそのまま戻す
    if (flow.m === 'link') {
      return clearCookie(NextResponse.redirect(`${origin}${withParam(safePath(flow.n), 'linked', profile.provider)}`, 303));
    }
    const tokenHash = await sessionToken(admin, account.email);
    return clearCookie(
      NextResponse.redirect(
        completeUrl(origin, { tokenHash, type: 'magiclink', role: flow.r, next: safePath(flow.n), via: profile.provider, isNew: account.created }),
        303,
      ),
    );
  } catch (e) {
    const code = e instanceof OidcError ? e.code : 'provider_error';
    if (!(e instanceof OidcError) || code === 'provider_error') console.error('[auth] finish failed', e);
    return failRedirect(req, flow, code);
  }
}
