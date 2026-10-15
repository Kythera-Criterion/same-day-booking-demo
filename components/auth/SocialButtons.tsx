'use client';

// 「Google で続ける」「Yahoo! JAPAN ID で続ける」のボタン。
// 押すとサーバーで手続きを始め、各社の認証画面（キーが未設定のデモでは、デモ用の認証画面）へ移る。
// 各社のロゴは使わず、文字だけで示す（本番で各社のロゴつきボタンにする場合は、各社のガイドラインに従う）

import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AUTH_ERROR, PROVIDER_IDS, PROVIDER_LABEL, type FlowMode, type FlowRole, type ProviderId, type Providers } from '@/lib/oauth-shared';

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
          <span className="social-mark" aria-hidden>
            {p === 'google' ? 'G' : 'Y!'}
          </span>
          <span>{busy === p ? '移動しています…' : `${PROVIDER_LABEL[p]}で${verb}`}</span>
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

export function AuthErrorNotice({ code }: { code?: string | null }) {
  if (!code) return null;
  return (
    <p className="notice notice-error" role="alert">
      {AUTH_ERROR[code] ?? 'ログインできませんでした。もう一度お試しください。'}
    </p>
  );
}
