'use client';

// ログインの方法：ログイン用メールアドレス、パスワード（設定・変更）、連携している外部の ID（Google・Yahoo! JAPAN ID）の連携・解除。
// 利用者のマイページ・サロンの設定・運営の「運営メンバー」で共通に使う

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import PasswordInput from './PasswordInput';
import { startSocial } from './SocialButtons';
import { AUTH_ERROR, PROVIDER_IDS, PROVIDER_LABEL, type FlowRole, type ProviderId, type Providers } from '@/lib/oauth-shared';

type Identity = { provider: ProviderId; email: string | null; created_at: string; last_used_at: string };

const dt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' });

export default function AccountSecurity({
  client,
  role,
  providers,
  returnPath,
  linked,
  authError,
}: {
  client: SupabaseClient;
  role: FlowRole;
  providers: Providers;
  returnPath: string;
  linked?: string | null;
  authError?: string | null;
}) {
  const [email, setEmail] = useState('');
  const [identities, setIdentities] = useState<Identity[] | null>(null);
  const [hasPassword, setHasPassword] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
    linked && PROVIDER_IDS.includes(linked as ProviderId)
      ? { kind: 'ok', text: `${PROVIDER_LABEL[linked as ProviderId]}と連携しました。次回から、${PROVIDER_LABEL[linked as ProviderId]}でログインできます。` }
      : authError
        ? { kind: 'error', text: AUTH_ERROR[authError] ?? '連携できませんでした。' }
        : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');

  const token = useCallback(async () => (await client.auth.getSession()).data.session?.access_token ?? '', [client]);

  const load = useCallback(async () => {
    const { data } = await client.auth.getUser();
    setEmail(data.user?.email ?? '');
    const res = await fetch('/api/auth/identities', { headers: { Authorization: `Bearer ${await token()}` } });
    if (!res.ok) {
      setIdentities([]);
      return;
    }
    const body = (await res.json()) as { identities: Identity[]; hasPassword: boolean };
    setIdentities(body.identities);
    setHasPassword(body.hasPassword);
  }, [client, token]);

  useEffect(() => {
    load();
    // 連携の結果を URL に残さない
    if (linked || authError) {
      const url = new URL(window.location.href);
      url.searchParams.delete('linked');
      url.searchParams.delete('auth_error');
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    }
  }, [load, linked, authError]);

  async function connect(provider: ProviderId) {
    setBusy(provider);
    setMsg(null);
    const message = await startSocial({ provider, role, mode: 'link', next: returnPath, back: returnPath, client });
    if (message) {
      setMsg({ kind: 'error', text: message });
      setBusy(null);
    }
  }

  async function disconnect(provider: ProviderId) {
    setBusy(provider);
    setMsg(null);
    const res = await fetch('/api/auth/identities', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ provider }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!res.ok) {
      setMsg({
        kind: 'error',
        text:
          body.error === 'last_method'
            ? 'ほかにログインする方法がないため、解除できません。先にパスワードを設定してください。'
            : `解除できませんでした（${body.error ?? res.status}）`,
      });
      return;
    }
    setMsg({ kind: 'ok', text: `${PROVIDER_LABEL[provider]}との連携を解除しました。` });
    load();
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setMsg({ kind: 'error', text: 'パスワードは8文字以上で入力してください。' });
    if (pw !== pw2) return setMsg({ kind: 'error', text: '確認のため、同じパスワードをもう一度入力してください。' });
    setBusy('pw');
    const { error } = await client.auth.updateUser({ password: pw });
    setBusy(null);
    if (error) {
      setMsg({ kind: 'error', text: error.message.includes('different') ? '今までと違うパスワードにしてください。' : `設定できませんでした（${error.message}）` });
      return;
    }
    setPw('');
    setPw2('');
    setMsg({ kind: 'ok', text: hasPassword ? 'パスワードを変更しました。' : 'パスワードを設定しました。メールアドレスとパスワードでもログインできます。' });
    setHasPassword(true);
  }

  const shown = PROVIDER_IDS.filter((p) => providers[p] !== 'off' || identities?.some((i) => i.provider === p));
  // パスワードがなく、連携が1つだけなら、それを外すとログインできなくなる
  const lastMethod = !hasPassword && (identities?.length ?? 0) <= 1;

  return (
    <section className="card account-security">
      <p className="card-title">ログインの方法</p>
      <dl className="detail-dl">
        <dt>メールアドレス</dt>
        <dd className="break">{email || '—'}</dd>
      </dl>

      {msg && (
        <p className={`notice ${msg.kind === 'ok' ? 'notice-ok' : 'notice-error'}`} role={msg.kind === 'error' ? 'alert' : 'status'}>
          {msg.text}
        </p>
      )}

      {shown.length > 0 && (
        <ul className="linked-list" aria-label="連携している外部のアカウント">
          {shown.map((p) => {
            const id = identities?.find((i) => i.provider === p);
            return (
              <li key={p}>
                <span className={`social-mark social-${p}`} aria-hidden>
                  {p === 'google' ? 'G' : 'Y!'}
                </span>
                <span className="linked-body">
                  <strong>{PROVIDER_LABEL[p]}</strong>
                  <small>
                    {identities === null
                      ? '確認中…'
                      : id
                        ? `連携済み${id.email ? `（${id.email}）` : ''}・${dt.format(new Date(id.created_at))}から`
                        : '未連携'}
                    {providers[p] === 'simulated' && '・デモ'}
                    {id && lastMethod && <span className="linked-hint">パスワードを設定すると、連携を解除できます</span>}
                  </small>
                </span>
                {identities !== null &&
                  (id ? (
                    <button className="btn btn-quiet btn-sm" disabled={busy !== null || lastMethod} onClick={() => disconnect(p)}>
                      {busy === p ? '解除中…' : '解除'}
                    </button>
                  ) : providers[p] !== 'off' ? (
                    <button className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => connect(p)}>
                      {busy === p ? '移動しています…' : '連携する'}
                    </button>
                  ) : null)}
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={savePassword} noValidate className="pw-form">
        <p className="field-label" style={{ marginTop: 12 }}>
          {hasPassword ? 'パスワードの変更' : 'パスワードの設定'}
        </p>
        {!hasPassword && <p className="field-hint">外部のアカウントで登録したため、パスワードはまだありません。設定すると、メールアドレスとパスワードでもログインできます。</p>}
        <div className="field-row">
          <div className="field">
            <label className="field-label" htmlFor={`${role}-new-pw`}>
              新しいパスワード
            </label>
            <PasswordInput id={`${role}-new-pw`} isNew value={pw} onChange={setPw} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${role}-new-pw2`}>
              もう一度
            </label>
            <PasswordInput id={`${role}-new-pw2`} isNew={false} autoComplete="new-password" value={pw2} onChange={setPw2} />
          </div>
        </div>
        <button className="btn btn-secondary btn-block" type="submit" disabled={busy !== null || !pw}>
          {busy === 'pw' ? '保存中…' : hasPassword ? 'パスワードを変更' : 'パスワードを設定'}
        </button>
      </form>
    </section>
  );
}
