import { NextResponse } from 'next/server';
import { adminClient, isDemoMode, isServerConfigured } from '@/lib/server/supabase-admin';
import { appOrigin } from '@/lib/server/invite';
import { completeUrl, findUserByEmail } from '@/lib/server/accounts';
import { mailKey, sendMail } from '@/lib/server/mail';
import { allow, clientIp } from '@/lib/server/rate-limit';
import { safePath } from '@/lib/oauth-shared';

// メールアドレスとパスワードでの新規登録（利用者・サロン）。
//   1. アカウントを「メール未確認」で作り、確認用のリンクを作る（Supabase の送信の上限に左右されないよう、メールはこのサービスから送る）
//   2. 「メールアドレスの確認のお願い」を送る。リンクを開くと確認が済み、そのままログインした状態になる
//   3. すでに登録済みのアドレスなら、そのことを知らせるメールを送る（画面の返事は同じにして、登録の有無を外から分からなくする）
// メールのキーがないデモでは、確認用のリンクを画面に返す（DEMO_MODE=true のときだけ）
export const dynamic = 'force-dynamic';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USER_KEYS = ['display_name', 'phone', 'gender', 'age_group', 'occupation', 'area_id', 'conversation_pref', 'adult_confirmed', 'terms_version'] as const;

type Body = { role?: string; email?: string; password?: string; data?: Record<string, unknown>; next?: string };

export async function POST(req: Request) {
  if (!isServerConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 500 });
  const body = (await req.json().catch(() => null)) as Body | null;
  const role = body?.role === 'salon' ? 'salon' : 'user';
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  if (!EMAIL.test(email) || email.length > 120) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  if (password.length < 8 || password.length > 72) return NextResponse.json({ error: 'weak_password' }, { status: 400 });

  const ip = clientIp(req);
  if (!allow(`signup-ip:${ip}`, 10, 10 * 60 * 1000) || !allow(`signup-mail:${email}`, 3, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // 画面から受け取る登録情報は、決まった項目だけを通す（DB 側のトリガーでも形を確かめる）
  const raw = body?.data ?? {};
  const data: Record<string, string> = { signup_role: role };
  if (role === 'user') {
    for (const k of USER_KEYS) if (typeof raw[k] === 'string') data[k] = String(raw[k]).slice(0, 80);
  } else if (typeof raw.display_name === 'string') {
    data.display_name = raw.display_name.slice(0, 60);
  }
  if (typeof raw.terms_version === 'string') data.terms_version = raw.terms_version.slice(0, 40);
  if (raw.adult_confirmed === 'true') data.adult_confirmed = 'true';

  const admin = adminClient();
  const origin = appOrigin(req);
  const next = safePath(body?.next, role === 'salon' ? '/salon/signup' : '/');
  const name = data.display_name ?? '';

  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'signup', email, password, options: { data } });
  let mail: string;
  let demoLink: string | null = null;
  let demoNote: string | null = null;

  if (!error && link?.properties?.hashed_token && link.user) {
    const confirm = completeUrl(origin, { tokenHash: link.properties.hashed_token, type: 'signup', role, next, via: 'email', isNew: true });
    mail = await sendMail(admin, {
      kind: 'signup_confirm_mail',
      to: email,
      dedupeKey: mailKey('signup_confirm_mail', link.user.id),
      payload: { salon_name: '', role, display_name: name, email, invite_link: confirm },
    });
    if (isDemoMode() && mail === 'simulated') demoLink = confirm;
    await admin.from('audit_logs').insert({ actor: link.user.id, action: 'signup_email', target_id: link.user.id, detail: { role } });
  } else if (error && /already|exists|registered/i.test(error.message)) {
    // 登録済み：ログインかパスワードの再設定を案内する
    const userId = await findUserByEmail(admin, email);
    mail = await sendMail(admin, {
      kind: 'account_exists_mail',
      to: email,
      dedupeKey: mailKey('account_exists_mail', userId ?? email),
      payload: {
        salon_name: '',
        role,
        email,
        login_link: `${origin}${role === 'salon' ? '/salon' : '/login'}`,
        reset_link: `${origin}/forgot${role === 'salon' ? '?role=salon' : ''}`,
      },
    });
    // デモでは、試している人に分かるよう理由を返す（本番では返さない）
    if (isDemoMode()) demoNote = 'exists';
  } else {
    return NextResponse.json({ error: error?.message ?? 'signup_failed' }, { status: 400 });
  }

  return NextResponse.json({ ok: true, mail, demoLink, demoNote });
}
