import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { b64url, pkcePair, readSignedValue, signValue, verifyIdToken, OidcError, type Jwk } from '../../lib/oidc.ts';
import { isDemoEmail, safePath } from '../../lib/oauth-shared.ts';

// テスト用の鍵（各社の公開鍵の代わり）
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as Jwk), kid: 'k1', alg: 'RS256', use: 'sig' };
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

const NOW = 1_800_000_000;
const base = { iss: 'https://accounts.google.com', aud: 'client-1', sub: 'user-123', nonce: 'n-abc', iat: NOW - 10, exp: NOW + 300, email: 'a@example.com', email_verified: true };

function jwt(claims: object, opts: { kid?: string; key?: typeof privateKey; alg?: string } = {}) {
  const header = b64url(JSON.stringify({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const sig = createSign('RSA-SHA256').update(`${header}.${body}`).sign(opts.key ?? privateKey);
  return `${header}.${body}.${b64url(sig)}`;
}
const verify = (token: string, over: Partial<Parameters<typeof verifyIdToken>[0]> = {}) =>
  verifyIdToken({ idToken: token, jwks: [jwk], issuers: ['https://accounts.google.com', 'accounts.google.com'], audience: 'client-1', nonce: 'n-abc', nowSec: NOW, ...over });
const code = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e instanceof OidcError ? e.message : String(e);
  }
};

test('正しい ID トークンを受け入れ、本人の情報を取り出す', () => {
  const c = verify(jwt(base));
  assert.equal(c.sub, 'user-123');
  assert.equal(c.email, 'a@example.com');
});

test('nonce が違えば断る（別の手続きのトークンの使い回しを防ぐ）', () => {
  assert.match(code(() => verify(jwt({ ...base, nonce: 'other' }))), /^state_mismatch: bad_nonce/);
  assert.match(code(() => verify(jwt({ ...base, nonce: undefined }))), /^state_mismatch/);
});

test('宛先（aud）・発行者（iss）が違えば断る', () => {
  assert.match(code(() => verify(jwt({ ...base, aud: 'someone-else' }))), /bad_audience/);
  assert.match(code(() => verify(jwt({ ...base, aud: ['x', 'client-1'] }))), /^ok$/);
  assert.match(code(() => verify(jwt({ ...base, iss: 'https://evil.example' }))), /bad_issuer/);
});

test('有効期限を過ぎたトークンは断る（2分のずれまでは許す）', () => {
  assert.match(code(() => verify(jwt({ ...base, exp: NOW - 60 }))), /^ok$/);
  assert.match(code(() => verify(jwt({ ...base, exp: NOW - 600 }))), /^expired/);
});

test('署名が合わない・鍵が分からない・方式が違うトークンは断る', () => {
  assert.match(code(() => verify(jwt(base, { key: other.privateKey }))), /bad_signature/);
  assert.match(code(() => verify(jwt(base, { kid: 'unknown' }))), /unknown_kid/);
  assert.match(code(() => verify(jwt(base, { alg: 'HS256' }))), /unsupported_alg/);
  const t = jwt(base).split('.');
  const forged = `${t[0]}.${b64url(JSON.stringify({ ...base, sub: 'admin' }))}.${t[2]}`;
  assert.match(code(() => verify(forged)), /bad_signature/);
});

test('手続きの Cookie：署名つきで読み戻せ、書き換え・期限切れは断る', () => {
  const v = signValue({ a: 1, exp: Date.now() + 60_000 }, 'secret');
  assert.equal(readSignedValue<{ a: number; exp: number }>(v, 'secret').a, 1);
  assert.match(code(() => readSignedValue(v, 'other-secret')), /^state_mismatch/);
  const [body, mac] = v.split('.');
  const tampered = `${b64url(JSON.stringify({ a: 2, exp: Date.now() + 60_000 }))}.${mac}`;
  assert.notEqual(tampered.split('.')[0], body);
  assert.match(code(() => readSignedValue(tampered, 'secret')), /^state_mismatch/);
  assert.match(code(() => readSignedValue(signValue({ exp: Date.now() - 1 }, 'secret'), 'secret')), /^expired/);
  assert.match(code(() => readSignedValue(undefined, 'secret')), /^expired/);
});

test('PKCE：challenge は verifier の SHA-256', () => {
  const { verifier, challenge } = pkcePair();
  assert.ok(verifier.length >= 43);
  assert.equal(challenge, b64url(createHash('sha256').update(verifier).digest()));
});

test('移動先は、このサイトの中のパスだけ（外部への転送を防ぐ）', () => {
  assert.equal(safePath('/mypage'), '/mypage');
  assert.equal(safePath('/book/abc?x=1'), '/book/abc?x=1');
  assert.equal(safePath('https://evil.example'), '/');
  assert.equal(safePath('//evil.example'), '/');
  assert.equal(safePath('/\\evil.example'), '/');
  assert.equal(safePath(undefined, '/salon'), '/salon');
});

test('デモ用の認証画面では、例示用のメールアドレスだけ使える', () => {
  assert.ok(isDemoEmail('google.demo1234@example.com'));
  assert.ok(isDemoEmail('someone@shop.test'));
  assert.ok(!isDemoEmail('someone@gmail.com'));
  assert.ok(!isDemoEmail('someone@yahoo.co.jp'));
  assert.ok(!isDemoEmail('x@example.com.evil.jp'));
});
