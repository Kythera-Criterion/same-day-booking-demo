// OpenID Connect（Google・Yahoo! JAPAN ID など）の手続きで使う、純粋な処理だけを集めたもの。
// サーバー側の処理だけが読み込む（node:crypto を使う）。単体テストから直接読み込めるよう、ほかのファイルを import しない

import { createHmac, createHash, createPublicKey, randomBytes, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto';

export class OidcError extends Error {
  code: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

export function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes));
}

// PKCE（認可コードの横取りを防ぐ）
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(48);
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

// ---------------------------------------------------------
// 手続き中の情報を、改ざんできない形で Cookie に入れる（HMAC-SHA256 の署名つき）
// ---------------------------------------------------------
export function signValue(payload: object, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(createHmac('sha256', secret).update(body).digest());
  return `${body}.${mac}`;
}

export function readSignedValue<T extends { exp: number }>(value: string | undefined | null, secret: string, nowMs = Date.now()): T {
  if (!value) throw new OidcError('expired', 'no_cookie');
  const [body, mac] = value.split('.');
  if (!body || !mac) throw new OidcError('state_mismatch', 'malformed');
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = fromB64url(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new OidcError('state_mismatch', 'bad_signature');
  const payload = JSON.parse(fromB64url(body).toString('utf8')) as T;
  if (typeof payload.exp !== 'number' || payload.exp < nowMs) throw new OidcError('expired');
  return payload;
}

export function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------------------------------------------------------
// ID トークン（JWT）の検証：署名（RS256）・発行者・宛先・有効期限・nonce
// ---------------------------------------------------------
export type Jwk = JsonWebKey & { kid?: string; kty?: string; alg?: string; use?: string };
export type IdClaims = {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  given_name?: string;
  family_name?: string;
  [key: string]: unknown;
};

export function decodeJwt(token: string): { header: { alg?: string; kid?: string }; claims: IdClaims; signingInput: string; signature: Buffer } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new OidcError('provider_error', 'id_token_malformed');
  try {
    return {
      header: JSON.parse(fromB64url(parts[0]).toString('utf8')),
      claims: JSON.parse(fromB64url(parts[1]).toString('utf8')),
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: fromB64url(parts[2]),
    };
  } catch {
    throw new OidcError('provider_error', 'id_token_malformed');
  }
}

export function verifyIdToken(opts: {
  idToken: string;
  jwks: Jwk[];
  issuers: string[];
  audience: string;
  nonce: string;
  nowSec?: number;
  skewSec?: number;
}): IdClaims {
  const { header, claims, signingInput, signature } = decodeJwt(opts.idToken);
  if (header.alg !== 'RS256') throw new OidcError('provider_error', `unsupported_alg_${header.alg}`);
  const jwk = opts.jwks.find((k) => k.kid === header.kid && (k.kty ?? 'RSA') === 'RSA') ?? (header.kid ? null : opts.jwks.find((k) => k.kty === 'RSA'));
  if (!jwk) throw new OidcError('provider_error', 'unknown_kid');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  if (!verify('RSA-SHA256', Buffer.from(signingInput), key, signature)) throw new OidcError('provider_error', 'bad_signature');

  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const skew = opts.skewSec ?? 120;
  if (!opts.issuers.includes(claims.iss)) throw new OidcError('provider_error', 'bad_issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.audience)) throw new OidcError('provider_error', 'bad_audience');
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) throw new OidcError('expired', 'id_token_expired');
  if (typeof claims.iat === 'number' && claims.iat - skew > now) throw new OidcError('provider_error', 'iat_in_future');
  if (!claims.nonce || !sameString(String(claims.nonce), opts.nonce)) throw new OidcError('state_mismatch', 'bad_nonce');
  if (!claims.sub) throw new OidcError('provider_error', 'no_sub');
  return claims;
}

export function isVerified(v: unknown): boolean {
  return v === true || v === 'true';
}
