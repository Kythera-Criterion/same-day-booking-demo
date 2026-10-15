import 'server-only';
import { createHash } from 'node:crypto';
import { isDemoMode } from './supabase-admin';
import { OidcError, isVerified, pkcePair, randomToken, readSignedValue, signValue, verifyIdToken, type Jwk } from '@/lib/oidc';
import type { FlowMode, FlowRole, ProviderId, Providers, ProviderState } from '@/lib/oauth-shared';

// 外部の ID での登録・ログイン（サーバー側）。
// どちらも OpenID Connect の認可コードフロー（PKCE・state・nonce つき）で、キーはサーバーの環境変数だけに置く。
//   Google            ：GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
//   Yahoo! JAPAN ID   ：YAHOO_JAPAN_CLIENT_ID / YAHOO_JAPAN_CLIENT_SECRET
// キーが未設定で DEMO_MODE=true のときは、デモ用の認証画面（/auth/demo-provider）で流れを試せる

type ProviderConfig = {
  id: ProviderId;
  authorizeUrl: string;
  tokenUrl: string;
  issuers: string[];
  jwksUrl: string;
  userinfoUrl: string;
  scope: string;
  tokenAuth: 'basic' | 'post';
  extra: Record<string, string>;
  clientId: string;
  clientSecret: string;
};

function config(id: ProviderId): ProviderConfig {
  if (id === 'google') {
    return {
      id,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      issuers: ['https://accounts.google.com', 'accounts.google.com'],
      jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
      userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      scope: 'openid email profile',
      tokenAuth: 'post',
      extra: { prompt: 'select_account' },
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    };
  }
  return {
    id,
    authorizeUrl: 'https://auth.login.yahoo.co.jp/yconnect/v2/authorization',
    tokenUrl: 'https://auth.login.yahoo.co.jp/yconnect/v2/token',
    issuers: ['https://auth.login.yahoo.co.jp/yconnect/v2'],
    jwksUrl: 'https://auth.login.yahoo.co.jp/yconnect/v2/jwks',
    userinfoUrl: 'https://userinfo.yahooapis.jp/yconnect/v2/attribute',
    scope: 'openid email profile',
    tokenAuth: 'basic',
    extra: {},
    clientId: process.env.YAHOO_JAPAN_CLIENT_ID ?? '',
    clientSecret: process.env.YAHOO_JAPAN_CLIENT_SECRET ?? '',
  };
}

export function isProviderId(v: unknown): v is ProviderId {
  return v === 'google' || v === 'yahoo';
}

export function providerState(id: ProviderId): ProviderState {
  const c = config(id);
  if (c.clientId && c.clientSecret) return 'live';
  return isDemoMode() ? 'simulated' : 'off';
}

export function providerStates(): Providers {
  return { google: providerState('google'), yahoo: providerState('yahoo') };
}

export function redirectUri(origin: string, id: ProviderId): string {
  return `${origin}/api/auth/callback/${id}`;
}

// ---------------------------------------------------------
// 手続き中の情報（署名つきの Cookie。10分で切れる）
// ---------------------------------------------------------
export const FLOW_COOKIE = 'sdb_oauth_flow';
export const FLOW_COOKIE_PATH = '/api/auth';
const FLOW_TTL_MS = 10 * 60 * 1000;

export type Flow = {
  p: ProviderId;
  r: FlowRole;
  m: FlowMode;
  n: string; // 成功したときの移動先
  b: string; // 失敗・キャンセルのときの戻り先
  s: string; // state
  o: string; // nonce
  v: string; // PKCE の verifier
  u?: string; // 連携するアカウント（マイページなどから連携するとき）
  sim: boolean;
  exp: number;
};

function flowSecret(): string {
  const explicit = process.env.AUTH_FLOW_SECRET;
  if (explicit) return explicit;
  // 専用の値がなければ、サーバーだけが持つ秘密の値から作る（画面側には出ない）
  return createHash('sha256').update(`auth-flow|${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`).digest('hex');
}

export function newFlow(input: Omit<Flow, 's' | 'o' | 'v' | 'exp' | 'sim'>): { flow: Flow; challenge: string } {
  const { verifier, challenge } = pkcePair();
  const sim = providerState(input.p) === 'simulated';
  return { flow: { ...input, s: randomToken(24), o: randomToken(24), v: verifier, sim, exp: Date.now() + FLOW_TTL_MS }, challenge };
}

export function sealFlow(flow: Flow): string {
  return signValue(flow, flowSecret());
}

export function openFlow(value: string | undefined | null): Flow {
  return readSignedValue<Flow>(value, flowSecret());
}

export function cookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: FLOW_COOKIE_PATH, maxAge: FLOW_TTL_MS / 1000 };
}

export function authorizeUrl(flow: Flow, challenge: string, origin: string): string {
  const c = config(flow.p);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: redirectUri(origin, flow.p),
    scope: c.scope,
    state: flow.s,
    nonce: flow.o,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...c.extra,
  });
  return `${c.authorizeUrl}?${params.toString()}`;
}

// ---------------------------------------------------------
// 認可コードをトークンに替え、ID トークンを検証して、本人の情報を取り出す
// ---------------------------------------------------------
export type ExternalProfile = {
  provider: ProviderId;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
};

const jwksCache = new Map<string, { keys: Jwk[]; at: number }>();

async function loadJwks(url: string, force = false): Promise<Jwk[]> {
  const hit = jwksCache.get(url);
  if (!force && hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.keys;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new OidcError('provider_error', `jwks_${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  jwksCache.set(url, { keys, at: Date.now() });
  return keys;
}

export async function exchangeCode(flow: Flow, code: string, origin: string): Promise<ExternalProfile> {
  const c = config(flow.p);
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(origin, flow.p),
    code_verifier: flow.v,
  });
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (c.tokenAuth === 'basic') {
    headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.clientSecret)}`).toString('base64')}`;
  } else {
    form.set('client_id', c.clientId);
    form.set('client_secret', c.clientSecret);
  }
  const res = await fetch(c.tokenUrl, { method: 'POST', headers, body: form, cache: 'no-store' });
  const token = (await res.json().catch(() => ({}))) as { id_token?: string; access_token?: string; error?: string };
  if (!res.ok || !token.id_token) throw new OidcError('provider_error', `token_${res.status}_${token.error ?? ''}`);

  let jwks = await loadJwks(c.jwksUrl);
  let claims;
  try {
    claims = verifyIdToken({ idToken: token.id_token, jwks, issuers: c.issuers, audience: c.clientId, nonce: flow.o });
  } catch (e) {
    // 鍵が入れ替わった直後なら、取り直してもう一度確かめる
    if (!(e instanceof OidcError) || !String(e.message).includes('unknown_kid')) throw e;
    jwks = await loadJwks(c.jwksUrl, true);
    claims = verifyIdToken({ idToken: token.id_token, jwks, issuers: c.issuers, audience: c.clientId, nonce: flow.o });
  }

  let email = typeof claims.email === 'string' ? claims.email : null;
  let verified = isVerified(claims.email_verified);
  let name = [claims.family_name, claims.given_name].filter(Boolean).join(' ') || (typeof claims.name === 'string' ? claims.name : '');

  // Yahoo! JAPAN ID は、メールアドレスを UserInfo から受け取る（Google も ID トークンにない場合は同じ）
  if ((!email || !name) && token.access_token) {
    const ui = await fetch(c.userinfoUrl, { headers: { Authorization: `Bearer ${token.access_token}` }, cache: 'no-store' });
    if (ui.ok) {
      const info = (await ui.json()) as Record<string, unknown>;
      if (info.sub && info.sub !== claims.sub) throw new OidcError('provider_error', 'userinfo_sub_mismatch');
      if (!email && typeof info.email === 'string') {
        email = info.email;
        verified = isVerified(info.email_verified);
      }
      if (!name) name = [info.family_name, info.given_name].filter(Boolean).join(' ') || String(info.name ?? info.nickname ?? '');
    }
  }

  return {
    provider: flow.p,
    subject: String(claims.sub),
    email: email ? email.trim().toLowerCase() : null,
    emailVerified: verified,
    name: name.slice(0, 60),
  };
}
