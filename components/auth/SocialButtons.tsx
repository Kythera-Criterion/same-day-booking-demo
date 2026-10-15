'use client';

// 「Google で続ける」「Yahoo! JAPAN IDで続ける」のボタン。
// 押すとサーバーで手続きを始め、各社の認証画面（キーが未設定のデモでは、デモ用の認証画面）へ移る。
// アイコンは各社の公式の素材をそのまま使う（public/brand。色・形を変えない）
//   Google：https://developers.google.com/identity/branding-guidelines
//           標準の「G」を白地に。ボタンは白地・#747775 の1pxの枠・#1F1F1F の文字
//   Yahoo! JAPAN：https://developer.yahoo.co.jp/yconnect/loginbuttons.html
//           赤（#ff0033）のアイコン。周りに高さ・幅の1/3以上の余白、ボタンの周りに10px以上の余白

import { useState } from 'react';
import Image from 'next/image';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AUTH_ERROR, PROVIDER_IDS, PROVIDER_LABEL, type FlowMode, type FlowRole, type ProviderId, type Providers } from '@/lib/oauth-shared';

// 各社の公式のアイコン（高さをそろえ、縦横の比は変えない）
export function ProviderIcon({ provider, height = 20 }: { provider: ProviderId; height?: number }) {
  return provider === 'google' ? (
    <Image className="provider-icon" src="/brand/google-g.png" alt="" width={height} height={Math.round((height * 204) / 200)} unoptimized aria-hidden />
  ) : (
    <Image className="provider-icon" src="/brand/yahoo-japan-icon.svg" alt="" width={Math.round((height * 64) / 36)} height={height} unoptimized aria-hidden />
  );
}

// ボタンの文言（Google の日本語の文言「Google で続ける」、Yahoo! JAPAN の推奨「Yahoo! JAPAN IDでログイン」にそろえる）
export function providerText(provider: ProviderId, verb: string): string {
  return provider === 'google' ? `Google で${verb}` : `${PROVIDER_LABEL[provider]}で${verb}`;
}

export async function startSocial(opts: {
  provider: ProviderId;
  role: FlowRole;
  mode: FlowMode;
  next: string;
  back: string;
  client?: SupabaseClient | null;
}): Promise<string | null> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.mode === 'link' && opts.client) {
    const token = (await opts.client.auth.getSession()).data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch('/api/auth/oauth/start', {
    method: 'POST',
    headers,
    body: JSON.stringify({ provider: opts.provider, role: opts.role, mode: opts.mode, next: opts.next, back: opts.back }),
  });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) return AUTH_ERROR[body.error ?? ''] ?? '連携を始められませんでした。少し時間をおいてお試しください。';
  window.location.assign(body.url);
  return null;
}

export function hasAnyProvider(providers: Providers | undefined): boolean {
  return !!providers && PROVIDER_IDS.some((p) => providers[p] !== 'off');
}

export default function SocialButtons({
  providers,
  role,
  mode,
  next,
  back,
  verb = '続ける',
}: {
  providers: Providers;
  role: FlowRole;
  mode: Exclude<FlowMode, 'link'>;
  next: string;
  back: string;
  verb?: string;
}) {
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = PROVIDER_IDS.filter((p) => providers[p] !== 'off');
  if (shown.length === 0) return null;
  const simulated = shown.some((p) => providers[p] === 'simulated');

  async function go(provider: ProviderId) {
    setBusy(provider);
    setError(null);
    const message = await startSocial({ provider, role, mode, next, back });
    if (message) {
      setError(message);
      setBusy(null);
    }
  }

  return (
    <div className="social">
      {shown.map((p) => (
        <button key={p} type="button" className={`btn btn-block social-btn social-${p}`} disabled={busy !== null} onClick={() => go(p)}>
          <ProviderIcon provider={p} height={p === 'google' ? 20 : 16} />
          <span className="social-text">{busy === p ? '移動しています…' : providerText(p, verb)}</span>
          {providers[p] === 'simulated' && <span className="social-demo">デモ</span>}
        </button>
      ))}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {simulated && (
        <p className="fine-print social-note">
          「デモ」の表示がある方法は、連携のキーが未設定のため、デモ用の認証画面で流れを試せます（実際の Google・Yahoo! JAPAN には接続しません）。
        </p>
      )}
    </div>
  );
}

export function OrDivider({ children = 'または' }: { children?: string }) {
  return (
    <div className="or-divider" role="separator">
      <span>{children}</span>
    </div>
  );
}

export function LoggedOutNotice() {
  return (
    <p className="notice notice-ok" role="status">
      ログアウトしました。続けて使うときは、もう一度ログインしてください。
    </p>
  );
}

export function AuthErrorNotice({ code }: { code?: string | null }) {
  if (!code) return null;
  return (
    <p className="notice notice-error" role="alert">
      {AUTH_ERROR[code] ?? 'ログインできませんでした。もう一度お試しください。'}
    </p>
  );
}
