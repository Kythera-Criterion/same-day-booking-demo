import { cookies } from 'next/headers';
import { OidcError } from '@/lib/oidc';
import { isDemoEmail } from '@/lib/oauth-shared';
import { failRedirect, finishFlow } from '@/lib/server/auth-flow';
import { isDemoMode } from '@/lib/server/supabase-admin';
import { FLOW_COOKIE, openFlow, type Flow } from '@/lib/server/oauth';

// デモ用の認証画面（/auth/demo-provider）からの送信を受ける。
// DEMO_MODE=true で、その外部 ID のキーが未設定のときだけ動く。
// 使えるメールアドレスは例示用のドメイン（@example.com・.test）だけで、既存のアカウントとはメールアドレスで結びつけない
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!isDemoMode()) return new Response('Not Found', { status: 404 });
  let flow: Flow | null = null;
  try {
    flow = openFlow((await cookies()).get(FLOW_COOKIE)?.value);
    if (!flow.sim) throw new OidcError('state_mismatch', 'not_simulated');
    const form = await req.formData();
    if (form.get('decision') !== 'allow') throw new OidcError('denied');
    const subject = String(form.get('subject') ?? '');
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const name = String(form.get('name') ?? '').trim().slice(0, 60);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(subject)) throw new OidcError('state_mismatch', 'bad_subject');
    if (!isDemoEmail(email)) throw new OidcError('email_required');
    return await finishFlow(req, flow, { provider: flow.p, subject: `demo-${subject}`, email, emailVerified: true, name });
  } catch (e) {
    return failRedirect(req, flow, e instanceof OidcError ? e.code : 'provider_error');
  }
}
