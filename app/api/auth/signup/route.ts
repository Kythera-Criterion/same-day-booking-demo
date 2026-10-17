import { NextResponse } from 'next/server';
import { adminClient, isDemoMode, isServerConfigured } from '@/lib/server/supabase-admin';
import { appOrigin } from '@/lib/server/invite';
import { completeUrl, findUserByEmail } from '@/lib/server/accounts';
import { mailKey, sendMail } from '@/lib/server/mail';
import { allow, clientIp } from '@/lib/server/rate-limit';
import { safePath } from '@/lib/oauth-shared';

// メールアドレスとパスワードでの新規登録（利用者・サロン）。
// サロンは運営の承認制：アカウントを確認前のまま作り（確認のメールはまだ送らない）、掲載希望として運営に届ける。
//   運営が承認すると、確認のリンクを送る（/api/admin/approve）。リンクを開くと登録が完了してログインする。
// 利用者は、次の手順：
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
  const salonName = role === 'salon' && typeof raw.salon_name === 'string' ? raw.salon_name.trim().slice(0, 80) : '';
  if (role === 'salon' && (!salonName || !(data.display_name ?? '').trim())) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  // 店名もアカウントに残す（新規登録の知らせ〔0018〕で、どのお店の登録かを運営に伝える）
  if (role === 'salon') data.salon_name = salonName;
  if (typeof raw.terms_version === 'string') data.terms_version = raw.terms_version.slice(0, 40);
  if (raw.adult_confirmed === 'true') data.adult_confirmed = 'true';

  const admin = adminClient();
  const origin = appOrigin(req);
  const next = safePath(body?.next, role === 'salon' ? '/salon/signup' : '/');
  const name = data.display_name ?? '';

  // 確認がまだのアカウントに、もう一度申し込んだとき（入力し直した場合など）は、前の入力を残さず、新しい内容で作り直す
  // （確認前のアカウントには予約もログインもないため、作り直しても失うものはない）
  const existingId = await findUserByEmail(admin, email);
  if (existingId) {
    const { data: ex } = await admin.auth.admin.getUserById(existingId);
    // 作り直すのは、自分で申し込んで確認がまだのアカウントだけ（招待中のスタッフ・運営や、お店・運営の権限があるアカウントは消さない）
    const selfSignup = !!ex.user && !ex.user.email_confirmed_at && !ex.user.last_sign_in_at && !ex.user.invited_at && !!ex.user.user_metadata?.signup_role;
    if (selfSignup) {
      const [{ data: m }, { data: op }] = await Promise.all([
        admin.from('salon_members').select('salon_id').eq('user_id', existingId).limit(1),
        admin.from('admins').select('user_id').eq('user_id', existingId).limit(1),
      ]);
      if ((m?.length ?? 0) === 0 && (op?.length ?? 0) === 0) {
        // 前の申し込み（運営の確認待ち）は、新しい申し込みに置き換える
        await admin.from('salon_applications').delete().eq('applicant_user_id', existingId).eq('status', 'pending');
        await admin.auth.admin.deleteUser(existingId);
      }
    }
  }

  // 登録済みのアドレス：ログインかパスワードの再設定を案内する（画面の返事は同じにして、登録の有無を外から分からなくする）
  async function accountExists() {
    const userId = await findUserByEmail(admin, email);
    const mail = await sendMail(admin, {
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
    return NextResponse.json({ ok: true, mail, demoLink: null, demoNote: isDemoMode() ? 'exists' : null });
  }

  // サロン：アカウントを確認前のまま作り、掲載希望として運営に届ける（確認のリンクは、運営が承認したときに送る）
  if (role === 'salon') {
    const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: false, user_metadata: data });
    if (ce || !created.user) {
      if (/already|exists|registered/i.test(ce?.message ?? '')) return accountExists();
      return NextResponse.json({ error: (ce as { code?: string } | null)?.code ?? 'signup_failed' }, { status: 400 });
    }
    const { error: ae } = await admin.from('salon_applications').insert({
      salon_name: salonName,
      contact_name: (data.display_name ?? '').trim(),
      email,
      area_text: '（初期設定で入力）',
      applicant_user_id: created.user.id,
    });
    if (ae) {
      await admin.auth.admin.deleteUser(created.user.id);
      return NextResponse.json({ error: 'signup_failed' }, { status: 500 });
    }
    await admin.from('audit_logs').insert({ actor: created.user.id, action: 'salon_signup', target_id: created.user.id, detail: { salon_name: salonName } });
    return NextResponse.json({ ok: true, mail: 'none', demoLink: null, demoNote: null });
  }

  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'signup', email, password, options: { data } });
  let mail: string;
  let demoLink: string | null = null;

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
    return accountExists();
  } else {
    // 画面で日本語の理由に置き換えられるよう、英語の文ではなく理由のコードを返す
    return NextResponse.json({ error: (error as { code?: string } | null)?.code ?? 'signup_failed' }, { status: 400 });
  }

  return NextResponse.json({ ok: true, mail, demoLink, demoNote: null });
}
