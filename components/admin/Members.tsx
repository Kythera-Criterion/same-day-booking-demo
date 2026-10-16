'use client';

// 運営メンバー：一覧・招待・再送・外す。運営の登録は、ここからの招待だけで行う（公開の登録画面はない）
// 自分のアカウントのログインの方法（パスワード・Google・Yahoo! JAPAN ID の連携）もここで変える

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Sheet from '@/components/Sheet';
import AccountSecurity from '@/components/auth/AccountSecurity';
import { ErrorState, Loading } from '@/components/States';
import Button from '@/components/ui/Button';
import { Input, LabeledField } from '@/components/ui/Form';
import Label from '@/components/ui/Label';
import { Pair, ScreenTitle, Stack } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { EnvelopeSimple, HourglassMedium, PaperPlaneTilt, User, UserMinus, UserPlus, UsersThree } from '@/components/ui/icons';
import { toMessage } from '@/lib/errors';
import type { Providers } from '@/lib/oauth-shared';
import t from './AdminTable.module.css';
import s from './Members.module.css';

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
  link_failed: '招待のリンクを作れませんでした。少し時間をおいてお試しください。',
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
    <Stack gap={4}>
      {result && (
        <div data-result={result.kind}>
          <Notice tone={result.kind === 'ok' ? 'success' : 'danger'} role="status">
            {result.text}
            {result.link && (
              <details className={s.invite} data-invite-link="">
                <summary className={s.inviteToggle}>招待のリンクを表示（メール以外で個別に伝える場合）</summary>
                <Input readOnly value={result.link} onFocus={(e) => e.target.select()} />
              </details>
            )}
          </Notice>
        </div>
      )}

      <div className={s.grid}>
        <Panel>
          <SectionHead icon={UserPlus} title="運営メンバーを招待する" as="p" />
          <SubText>運営の登録は、この招待だけで行います。招待した方には、パスワードを決めるリンクつきのメールが届きます（すでにアカウントがある方には、運営の権限を加えて知らせます）。</SubText>
          <form onSubmit={submit} noValidate>
            <LabeledField label="メールアドレス">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
            </LabeledField>
            <LabeledField label="お名前（任意）">
              <Input maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </LabeledField>
            <Button variant="primary" size="md" block type="submit" icon={PaperPlaneTilt} disabled={busy !== null || !email.trim()}>
              {busy === 'invite' ? '送信中…' : '招待のメールを送る'}
            </Button>
          </form>
        </Panel>

        <Panel flush>
          <div className={s.listHead}>
            <SectionHead icon={UsersThree} title="メンバーの一覧" as="p" aside={<span className="num">{rows.length}人</span>} />
          </div>
          <div className={t.wrap}>
            <table className={t.table}>
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
                  <tr key={m.user_id}>
                    <td className={s.memberCell}>
                      <span className={s.who}>
                        <span className={t.name}>{m.display_name || '（お名前未設定）'}</span>
                        {m.is_me && (
                          <Label kind="action" icon={User} weight="fill">
                            自分
                          </Label>
                        )}
                      </span>
                      <small className={`${t.line} break`}>{m.email}</small>
                    </td>
                    <td className={`num ${t.nowrap}`}>{dt.format(new Date(m.created_at))}</td>
                    <td className={`num ${t.nowrap}`}>
                      {m.last_sign_in_at ? (
                        dt.format(new Date(m.last_sign_in_at))
                      ) : (
                        <Label kind="state" icon={HourglassMedium}>
                          招待中
                        </Label>
                      )}
                    </td>
                    <td>
                      <span className={t.actions}>
                        {!m.last_sign_in_at && (
                          <Button variant="text" icon={EnvelopeSimple} disabled={busy !== null} onClick={() => invite({ email: m.email, name: m.display_name }, true)}>
                            {busy === m.email ? '送信中…' : '招待を再送'}
                          </Button>
                        )}
                        {!m.is_me && (
                          <Button variant="text" icon={UserMinus} className={s.danger} disabled={busy !== null} onClick={() => setRemoving(m)}>
                            外す
                          </Button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <ScreenTitle as="h2" tight>
        自分のアカウント
      </ScreenTitle>
      <div className={s.account}>
        <AccountSecurity client={client} role="admin" providers={providers} returnPath="/admin?tab=members" linked={linked} authError={authError} />
      </div>

      {removing && (
        <Sheet label="運営メンバーから外しますか" role="alertdialog" narrow onClose={() => setRemoving(null)}>
          <SectionHead icon={UserMinus} title={`${removing.display_name || removing.email} を運営メンバーから外しますか？`} as="p" />
          <ul className={s.points}>
            <li>運営の画面を使えなくなります。いま開いている画面も、次の操作から権限がなくなります。</li>
            <li>アカウントそのもの（利用者・サロンのスタッフとしての利用）は残ります。</li>
            <li>もう一度加えるときは、招待し直してください。</li>
          </ul>
          <Pair>
            <Button variant="quiet" size="md" onClick={() => setRemoving(null)}>
              やめる
            </Button>
            <Button variant="dangerSolid" size="md" disabled={busy !== null} onClick={remove}>
              外す
            </Button>
          </Pair>
        </Sheet>
      )}
    </Stack>
  );
}
