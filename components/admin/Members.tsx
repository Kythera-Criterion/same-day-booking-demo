'use client';

// 運営メンバー：一覧・招待・再送・外す。運営の登録は、ここからの招待だけで行う（公開の登録画面はない）
// 自分のアカウントのログインの方法（パスワード・Google・Yahoo! JAPAN ID の連携）もここで変える

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Sheet from '@/components/Sheet';
import AccountSecurity from '@/components/auth/AccountSecurity';
import { ErrorState, Loading } from '@/components/States';
import { toMessage } from '@/lib/errors';
import type { Providers } from '@/lib/oauth-shared';

type Member = { user_id: string; email: string; display_name: string; created_at: string; last_sign_in_at: string | null; is_me: boolean };

const MAIL: Record<string, string> = {
  sent: '送信しました',
  simulated: 'シミュレーション送信しました（メールの送信キーが未設定のため。中身は「通知・記録」で確認できます）',
  pending: '送信待ちです（まもなく送られます）',
  failed: '送信に失敗しました。もう一度お試しください',
};
const INVITE_ERROR: Record<string, string> = {
  already_admin: 'このメールアドレスは、すでに運営メンバーです。',
  invalid_email: 'メールアドレスの形をご確認ください。',
  rate_limited: '短い時間に招待を送りすぎています。しばらくお待ちください。',
  forbidden: 'この操作の権限がありません。',
};
const REMOVE_ERROR: Record<string, string> = {
  cannot_remove_self: '自分自身は外せません。ほかの運営メンバーに依頼してください。',
  last_admin: '運営メンバーが1人だけのため、外せません。',
};

const dt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function Members({
  client,
  providers,
  linked,
  authError,
}: {
  client: SupabaseClient;
  providers: Providers;
  linked?: string | null;
  authError?: string | null;
}) {
  const [rows, setRows] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string; link?: string | null } | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await client.rpc('admin_list_admins');
    if (e) setError(toMessage(e));
    else {
      setError(null);
      setRows((data ?? []) as Member[]);
    }
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  async function invite(target: { email: string; name: string }, resend = false) {
    setBusy(resend ? target.email : 'invite');
    setResult(null);
    const token = (await client.auth.getSession()).data.session?.access_token;
    const res = await fetch('/api/admin/invite-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: target.email, name: target.name, resend }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; mailStatus?: string; inviteLink?: string | null };
    setBusy(null);
    if (!res.ok) {
      setResult({ kind: 'error', text: INVITE_ERROR[body.error ?? ''] ?? `招待できませんでした（${body.error ?? res.status}）` });
      return;
    }
    setResult({
      kind: 'ok',
      text: `${target.email} へ${resend ? '招待のメールをもう一度' : '運営メンバーへの招待を'}送りました。メール：${MAIL[body.mailStatus ?? 'pending'] ?? body.mailStatus}`,
      link: body.inviteLink,
    });
    if (!resend) {
      setEmail('');
      setName('');
    }
    load();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setResult({ kind: 'error', text: INVITE_ERROR.invalid_email });
      return;
    }
    await invite({ email: email.trim(), name: name.trim() });
  }

  async function remove() {
    if (!removing) return;
    setBusy('remove');
    const { error: e } = await client.rpc('admin_remove_admin', { p_user_id: removing.user_id });
    setBusy(null);
    const code = e ? Object.keys(REMOVE_ERROR).find((k) => e.message.includes(k)) : null;
    setResult(e ? { kind: 'error', text: code ? REMOVE_ERROR[code] : toMessage(e) } : { kind: 'ok', text: `${removing.email} を運営メンバーから外しました（アカウントそのものは残ります）。` });
    setRemoving(null);
    load();
  }

  if (error) return <ErrorState onRetry={load}>{error}</ErrorState>;
  if (!rows) return <Loading rows={3} />;

  return (
    <div className="stack">
      {result && (
        <div className={`notice ${result.kind === 'ok' ? 'notice-ok' : 'notice-error'}`} role="status">
          {result.text}
          {result.link && (
            <details className="invite-link">
              <summary>招待のリンクを表示（メール以外で個別に伝える場合）</summary>
              <input className="input" readOnly value={result.link} onFocus={(e) => e.target.select()} />
            </details>
          )}
        </div>
      )}

      <section className="card">
        <p className="card-title">運営メンバーを招待する</p>
        <p className="card-sub">運営の登録は、この招待だけで行います。招待した方には、パスワードを決めるリンクつきのメールが届きます（すでにアカウントがある方には、運営の権限を加えて知らせます）。</p>
        <form onSubmit={submit} noValidate>
          <div className="field-row">
            <label className="field">
              <span className="field-label">メールアドレス</span>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
            </label>
            <label className="field">
              <span className="field-label">お名前（任意）</span>
              <input className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy !== null || !email.trim()}>
            {busy === 'invite' ? '送信中…' : '招待のメールを送る'}
          </button>
        </form>
      </section>

      <section className="card card-flush">
        <div className="slot-table-wrap" style={{ paddingTop: 8 }}>
          <table className="slot-table">
            <thead>
              <tr>
                <th scope="col">メンバー</th>
                <th scope="col">追加</th>
                <th scope="col">最後のログイン</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.user_id} style={{ cursor: 'default' }}>
                  <td>
                    <strong>
                      {m.display_name || '（お名前未設定）'}
                      {m.is_me && <span className="pill pill-open" style={{ marginLeft: 6 }}>自分</span>}
                    </strong>
                    <small className="break">{m.email}</small>
                  </td>
                  <td className="num">{dt.format(new Date(m.created_at))}</td>
                  <td className="num">{m.last_sign_in_at ? dt.format(new Date(m.last_sign_in_at)) : <span className="pill pill-pending">招待中</span>}</td>
                  <td>
                    {!m.last_sign_in_at && (
                      <button className="btn btn-text btn-sm" disabled={busy !== null} onClick={() => invite({ email: m.email, name: m.display_name }, true)}>
                        {busy === m.email ? '送信中…' : '招待を再送'}
                      </button>
                    )}
                    {!m.is_me && (
                      <button className="btn btn-text btn-sm danger-text" disabled={busy !== null} onClick={() => setRemoving(m)}>
                        外す
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <h2 className="section-title">自分のアカウント</h2>
      <AccountSecurity client={client} role="admin" providers={providers} returnPath="/admin?tab=members" linked={linked} authError={authError} />

      {removing && (
        <Sheet label="運営メンバーから外しますか" role="alertdialog" narrow onClose={() => setRemoving(null)}>
          <p className="card-title">{removing.display_name || removing.email} を運営メンバーから外しますか？</p>
          <ul className="delete-list">
            <li>運営の画面を使えなくなります。いま開いている画面も、次の操作から権限がなくなります。</li>
            <li>アカウントそのもの（利用者・サロンのスタッフとしての利用）は残ります。</li>
            <li>もう一度加えるときは、招待し直してください。</li>
          </ul>
          <div className="action-pair">
            <button className="btn btn-quiet" onClick={() => setRemoving(null)}>
              やめる
            </button>
            <button className="btn btn-danger" disabled={busy !== null} onClick={remove}>
              外す
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
