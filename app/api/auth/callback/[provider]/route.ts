import { cookies } from 'next/headers';
import { OidcError, sameString } from '@/lib/oidc';
import { failRedirect, finishFlow } from '@/lib/server/auth-flow';
import { appOrigin } from '@/lib/server/invite';
import { FLOW_COOKIE, exchangeCode, isProviderId, openFlow, type Flow } from '@/lib/server/oauth';

// 本物の認証画面（Google・Yahoo! JAPAN ID）から戻ってくる先。
// ここを各社の開発者向けの設定に「リダイレクト URI」として登録する：
//   {APP_URL}/api/auth/callback/google
//   {APP_URL}/api/auth/callback/yahoo
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const url = new URL(req.url);
  let flow: Flow | null = null;
  try {
    flow = openFlow((await cookies()).get(FLOW_COOKIE)?.value);
    if (!isProviderId(provider) || flow.p !== provider || flow.sim) throw new OidcError('state_mismatch', 'provider');
    const state = url.searchParams.get('state') ?? '';
    if (!state || !sameString(state, flow.s)) throw new OidcError('state_mismatch');
    // 連携の画面で「キャンセル」「同意しない」を選んだ
    const err = url.searchParams.get('error');
    if (err) throw new OidcError(err === 'access_denied' || err === 'consent_required' || err === 'login_required' ? 'denied' : 'provider_error', err);
    const code = url.searchParams.get('code');
    if (!code) throw new OidcError('provider_error', 'no_code');
    const profile = await exchangeCode(flow, code, appOrigin(req));
    return await finishFlow(req, flow, profile);
  } catch (e) {
    const code = e instanceof OidcError ? e.code : 'provider_error';
    if (code === 'provider_error') console.error('[auth] callback failed', e);
    return failRedirect(req, flow, code);
  }
}
