'use client';

// ログインの方法：ログイン用メールアドレス、パスワード（設定・変更）、連携している外部の ID（Google・Yahoo! JAPAN ID）の連携・解除。
// 利用者のマイページ・サロンの設定・運営の「運営メンバー」で共通に使う

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import PasswordInput from './PasswordInput';
import { ProviderIcon, startSocial } from './SocialButtons';
import Button from '@/components/ui/Button';
import { Field } from '@/components/ui/Form';
import Notice from '@/components/ui/Notice';
import { DataList, Panel, SectionHead } from '@/components/ui/Surface';
import { Key, LinkIcon, LockSimple } from '@/components/ui/icons';
import { PROVIDER_IDS, PROVIDER_LABEL, authErrorText, type FlowRole, type ProviderId, type Providers } from '@/lib/oauth-shared';
import s from './AccountSecurity.module.css';

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
        ? { kind: 'error', text: authErrorText(authError, '連携できませんでした。') }
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
    <Panel as="section">
      <SectionHead icon={Key} title="ログインの方法" as="p" />
      <DataList items={[['メールアドレス', <span key="e" className="break">{email || '—'}</span>]]} />

      {msg && (
        <Notice tone={msg.kind === 'ok' ? 'success' : 'danger'} role={msg.kind === 'error' ? 'alert' : 'status'} className={s.notice}>
          {msg.text}
        </Notice>
      )}

      {shown.length > 0 && (
        <ul className={s.linked} aria-label="連携している外部のアカウント">
          {shown.map((p) => {
            const id = identities?.find((i) => i.provider === p);
            return (
              <li key={p}>
                <span className={s.linkedIcon}>
                  <ProviderIcon provider={p} height={p === 'google' ? 20 : 14} />
                </span>
                <span className={s.linkedBody}>
                  <strong>{PROVIDER_LABEL[p]}</strong>
                  <small>
                    {identities === null
                      ? '確認中…'
                      : id
                        ? `連携済み${id.email ? `（${id.email}）` : ''}・${dt.format(new Date(id.created_at))}から`
                        : '未連携'}
                    {providers[p] === 'simulated' && '・デモ'}
                    {id && lastMethod && <span className={s.linkedHint}>パスワードを設定すると、連携を解除できます</span>}
                  </small>
                </span>
                {identities !== null &&
                  (id ? (
                    <Button variant="quiet" size="sm" disabled={busy !== null || lastMethod} onClick={() => disconnect(p)}>
                      {busy === p ? '解除中…' : '解除'}
                    </Button>
                  ) : providers[p] !== 'off' ? (
                    <Button variant="secondary" size="sm" icon={LinkIcon} disabled={busy !== null} onClick={() => connect(p)}>
                      {busy === p ? '移動しています…' : '連携する'}
                    </Button>
                  ) : null)}
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={savePassword} noValidate className={s.pwForm}>
        <p className={s.formTitle}>
          <LockSimple size={20} aria-hidden focusable="false" />
          {hasPassword ? 'パスワードの変更' : 'パスワードの設定'}
        </p>
        {!hasPassword && <p className={s.hint}>外部のアカウントで登録したため、パスワードはまだありません。設定すると、メールアドレスとパスワードでもログインできます。</p>}
        <div className={s.pwRow}>
          <Field id={`${role}-new-pw`} label="新しいパスワード">
            <PasswordInput id={`${role}-new-pw`} isNew value={pw} onChange={setPw} />
          </Field>
          <Field id={`${role}-new-pw2`} label="もう一度">
            <PasswordInput id={`${role}-new-pw2`} isNew={false} autoComplete="new-password" value={pw2} onChange={setPw2} />
          </Field>
        </div>
        <Button variant="secondary" size="md" block type="submit" disabled={busy !== null || !pw}>
          {busy === 'pw' ? '保存中…' : hasPassword ? 'パスワードを変更' : 'パスワードを設定'}
        </Button>
      </form>
    </Panel>
  );
}
