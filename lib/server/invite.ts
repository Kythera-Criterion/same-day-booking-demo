import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// 承認したサロンのスタッフへ送る「ご利用開始」のリンクを作り、ご案内メールを送信待ちに積む。
// リンクはこのサイトの /welcome を直接開く形（token_hash つき）。Supabase のリダイレクト先の設定に左右されない

export type Application = {
  id: string;
  salon_name: string;
  contact_name: string;
  email: string;
  salon_id: string | null;
  invite_count: number;
};

export function appOrigin(req: Request): string {
  return (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '');
}

// 新しいアカウントなら招待、すでにあるアカウントならログイン用のリンクを作る（運営への招待は role=admin）。
// パスワードのあるアカウント（サロンの画面の「新規登録」で申し込んだ、確認前のアカウントを含む）には、必ずログイン用のリンクを使う。
// 招待のリンクを開くと「パスワードを決める前」の扱いになり、申し込みのときに決めたパスワードが使えなくなるため。
// ログイン用のリンクを開くと、メールアドレスの確認も済む（確認前のアカウントは、ここで登録が完了する）
export async function createStartLink(
  admin: SupabaseClient,
  email: string,
  displayName: string,
  origin: string,
  prefer: 'invite' | 'magiclink' = 'invite',
  role: 'salon' | 'admin' = 'salon',
): Promise<{ userId: string; link: string; type: 'invite' | 'magiclink'; created: boolean }> {
  const { data: existing } = await admin.rpc('find_user_id_by_email', { p_email: email });
  const { data: hasPassword } = existing ? await admin.rpc('user_has_password', { p_user_id: existing }) : { data: false };
  const order: ('invite' | 'magiclink')[] =
    hasPassword === true ? ['magiclink'] : prefer === 'invite' ? ['invite', 'magiclink'] : ['magiclink', 'invite'];
  let lastError = '';
  for (const type of order) {
    const { data, error } = await admin.auth.admin.generateLink(
      type === 'invite' ? { type, email, options: { data: { display_name: displayName } } } : { type, email },
    );
    const hashed = data?.properties?.hashed_token;
    if (!error && data?.user && hashed) {
      const roleParam = role === 'admin' ? '&role=admin' : '';
      return { userId: data.user.id, link: `${origin}/welcome?token_hash=${encodeURIComponent(hashed)}&type=${type}${roleParam}`, type, created: !existing };
    }
    lastError = error?.message ?? 'no_link';
  }
  throw new Error(`ご利用開始のリンクを作れませんでした（${lastError}）`);
}

// ご案内メールを送信待ちに積み、送った回数と日時を掲載希望に残す
export async function enqueueWelcome(admin: SupabaseClient, app: Application, salonId: string | null, link: string, passwordSet = false) {
  const count = (app.invite_count ?? 0) + 1;
  const { error } = await admin.from('notification_outbox').insert({
    dedupe_key: `salon_welcome_mail:${app.id}:${count}`,
    kind: 'salon_welcome_mail',
    channel: 'email',
    salon_id: salonId,
    recipient: app.email,
    payload: {
      salon_name: app.salon_name,
      contact_name: app.contact_name,
      email: app.email,
      invite_link: link,
      resend: count > 1,
      password_set: passwordSet,
    },
  });
  if (error) throw new Error(`ご案内メールを積めませんでした（${error.message}）`);
  await admin.from('salon_applications').update({ invite_sent_at: new Date().toISOString(), invite_count: count }).eq('id', app.id);
  return count;
}

// 積んだご案内メールの送信結果（送信済み／シミュレーション送信／送信待ち／失敗）
export async function welcomeStatus(admin: SupabaseClient, appId: string, count: number): Promise<string> {
  const { data } = await admin
    .from('notification_outbox')
    .select('status')
    .eq('dedupe_key', `salon_welcome_mail:${appId}:${count}`)
    .maybeSingle();
  return (data?.status as string | undefined) ?? 'pending';
}
