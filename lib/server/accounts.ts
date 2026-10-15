import 'server-only';
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OidcError } from '@/lib/oidc';
import type { FlowRole } from '@/lib/oauth-shared';
import type { ExternalProfile, Flow } from './oauth';

// 外部の ID と、このサービスのアカウントを結びつける。
//   1. すでに連携済みなら、そのアカウント
//   2. 連携先で確認済みのメールアドレスと同じアカウントがあれば、連携してそのアカウント
//      （メールの確認がまだのアカウントなら、確認済みにし、それまでのパスワードは無効にする。
//        他人が先にそのアドレスで仮登録していた場合に、乗っ取られないようにするため）
//   3. どちらでもなければ、新しくアカウントを作る（運営のログインでは作らない）
// デモ用の認証画面からのときは、2 を行わない（実在する人のアカウントに入れないようにする）

export type Resolved = { userId: string; email: string; created: boolean; linked: boolean };

export async function findUserByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  const { data, error } = await admin.rpc('find_user_id_by_email', { p_email: email });
  if (error) throw new OidcError('provider_error', `lookup_${error.message}`);
  return (data as string | null) ?? null;
}

async function isAdminUser(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin.from('admins').select('user_id').eq('user_id', userId).maybeSingle();
  return !!data;
}

async function link(admin: SupabaseClient, profile: ExternalProfile, userId: string) {
  const { error } = await admin
    .from('social_identities')
    .upsert({ provider: profile.provider, subject: profile.subject, user_id: userId, email: profile.email, last_used_at: new Date().toISOString() });
  if (error) throw new OidcError('provider_error', `link_${error.message}`);
}

export async function resolveAccount(admin: SupabaseClient, flow: Flow, profile: ExternalProfile): Promise<Resolved> {
  const { data: known } = await admin
    .from('social_identities')
    .select('user_id')
    .eq('provider', profile.provider)
    .eq('subject', profile.subject)
    .maybeSingle();

  // マイページなどからの連携：ログイン中のアカウントに結びつける
  if (flow.m === 'link') {
    if (!flow.u) throw new OidcError('link_session');
    if (known && known.user_id !== flow.u) throw new OidcError('already_linked_other');
    await link(admin, profile, flow.u);
    const { data } = await admin.auth.admin.getUserById(flow.u);
    return { userId: flow.u, email: data.user?.email ?? '', created: false, linked: !known };
  }

  let userId: string | null = (known?.user_id as string | undefined) ?? null;
  let linked = false;

  if (!userId) {
    if (!profile.email) throw new OidcError('email_required');
    if (!profile.emailVerified) throw new OidcError('email_unverified');
    const existing = await findUserByEmail(admin, profile.email);
    if (existing) {
      if (flow.sim) throw new OidcError('account_exists');
      if (flow.r === 'admin' && !(await isAdminUser(admin, existing))) throw new OidcError('not_admin');
      const { data: u } = await admin.auth.admin.getUserById(existing);
      if (u.user && !u.user.email_confirmed_at) {
        await admin.auth.admin.updateUserById(existing, { email_confirm: true, password: randomBytes(32).toString('hex') });
        await admin.rpc('mark_passwordless', { p_user_id: existing });
      }
      await link(admin, profile, existing);
      userId = existing;
      linked = true;
    }
  }

  if (userId) {
    if (flow.r === 'admin' && !(await isAdminUser(admin, userId))) throw new OidcError('not_admin');
    await admin.from('social_identities').update({ last_used_at: new Date().toISOString() }).eq('provider', profile.provider).eq('subject', profile.subject);
    const { data } = await admin.auth.admin.getUserById(userId);
    if (!data.user?.email) throw new OidcError('session_failed', 'no_email');
    return { userId, email: data.user.email, created: false, linked };
  }

  // 新しいアカウント
  if (flow.r === 'admin') throw new OidcError('not_admin');
  const { data: created, error } = await admin.auth.admin.createUser({
    email: profile.email!,
    email_confirm: true,
    user_metadata: { display_name: profile.name, signup_via: profile.provider, signup_role: flow.r },
  });
  if (error || !created.user) {
    if (/already|exists|registered/i.test(error?.message ?? '')) throw new OidcError('account_exists');
    throw new OidcError('provider_error', `create_${error?.message ?? ''}`);
  }
  await link(admin, profile, created.user.id);
  // 本人の知らない仮のパスワードが入るため、「パスワードなし」として控える（マイページで決められる）
  await admin.rpc('mark_passwordless', { p_user_id: created.user.id });
  return { userId: created.user.id, email: created.user.email ?? profile.email!, created: true, linked: true };
}

// ログイン状態を作るための、一度だけ使えるトークン（画面側で verifyOtp に渡す）
export async function sessionToken(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const hashed = data?.properties?.hashed_token;
  if (error || !hashed) throw new OidcError('session_failed', error?.message);
  return hashed;
}

export function completeUrl(origin: string, opts: { tokenHash: string; type: 'magiclink' | 'signup'; role: FlowRole; next: string; via?: string; isNew?: boolean }) {
  const q = new URLSearchParams({ token_hash: opts.tokenHash, type: opts.type, role: opts.role, next: opts.next });
  if (opts.via) q.set('via', opts.via);
  if (opts.isNew) q.set('new', '1');
  return `${origin}/auth/complete?${q.toString()}`;
}
