'use client';

// 掲載希望の受付：サロンの新規登録（/salon/signup）と、公開フォーム（/apply）からの申込の一覧。
//   新規登録：承認すると、お店を作り、ご登録のメールアドレスへ確認のリンクを自動で送る（リンクを開くと登録が完了する）
//   以前の形の自己登録（お店を作成済み）：承認すると掲載が始まり、「掲載開始のお知らせ」を送る
//   フォーム：承認すると、サロンとスタッフのアカウントを作り、「ご利用開始のご案内」を送る
//   見送る：確認のうえ、「見送りのご連絡」を送る（送らないことも選べる）

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Sheet from '@/components/Sheet';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { Empty, ErrorState, Loading } from '@/components/States';
import Button from '@/components/ui/Button';
import { Check, Input, Segmented } from '@/components/ui/Form';
import Label, { type LabelKind } from '@/components/ui/Label';
import { Pair, Stack } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import { DataList, Panel, SectionHead } from '@/components/ui/Surface';
import { CheckCircle, ClipboardText, HourglassMedium, LinkIcon, PaperPlaneTilt, Storefront, UserPlus, XCircle } from '@/components/ui/icons';
import { toMessage } from '@/lib/errors';
import s from './Applications.module.css';

type Application = {
  id: string;
  salon_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  area_text: string;
  question: string | null;
  status: 'pending' | 'approved' | 'rejected';
  salon_id: string | null;
  invite_sent_at: string | null;
  invite_count: number;
  applicant_user_id: string | null;
  created_at: string;
};

// 申込の状態：色だけでなく、アイコン（砂時計・確認済み・×）でも見分ける
const STATUS: Record<Application['status'], { label: string; kind: LabelKind; icon: PhosphorIcon }> = {
  pending: { label: '未対応', kind: 'action', icon: HourglassMedium },
  approved: { label: '承認済み', kind: 'success', icon: CheckCircle },
  rejected: { label: '見送り', kind: 'state', icon: XCircle },
};

const MAIL: Record<string, string> = {
  sent: '送信しました',
  simulated: 'シミュレーション送信しました（Resend のキーが未設定のため。中身は「通知・記録」で確認できます）',
  pending: '送信待ちです（まもなく送られます）',
  sending: '送信中です',
  failed: '送信に失敗しました。「メールをもう一度送る」をお試しください',
};

const dt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// 申込の種類：新規登録（サロンの画面から）・以前の形の自己登録（審査の前にお店を作成済み）・公開フォーム
function kindOf(a: { applicant_user_id: string | null; salon_id: string | null; status: string }): 'signup' | 'self' | 'form' {
  if (!a.applicant_user_id) return 'form';
  return a.salon_id && a.status === 'pending' ? 'self' : 'signup';
}

type Result = { kind: 'ok' | 'error'; text: string; mail?: string; link?: string | null };

export default function Applications({ client, onChanged }: { client: SupabaseClient; onChanged?: () => void }) {
  const [rows, setRows] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [rejecting, setRejecting] = useState<Application | null>(null);
  const [notifyReject, setNotifyReject] = useState(true);

  const load = useCallback(async () => {
    const { data, error: e } = await client
      .from('salon_applications')
      .select('id,salon_name,contact_name,email,phone,area_text,question,status,salon_id,invite_sent_at,invite_count,applicant_user_id,created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (e) setError(toMessage(e));
    else setRows((data ?? []) as Application[]);
  }, [client]);

  useEffect(() => {
    load();
    const channel = client
      .channel('admin-applications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'salon_applications' }, () => load())
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [client, load]);

  async function call(path: string, app: Application, extra: Record<string, unknown> = {}) {
    const token = (await client.auth.getSession()).data.session?.access_token;
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ applicationId: app.id, ...extra }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; inviteLink?: string | null; mailStatus?: string };
    return { ok: res.ok, body };
  }

  async function approve(app: Application) {
    setBusy(app.id);
    setResult(null);
    const { ok, body } = await call('/api/admin/approve', app);
    setBusy(null);
    if (!ok) {
      setResult({ kind: 'error', text: toMessage({ message: body.error ?? '承認できませんでした' }) });
      return;
    }
    const k = kindOf(app);
    const mailName = k === 'self' ? '掲載開始のお知らせ' : k === 'signup' ? 'ご利用開始のご案内（確認のリンクつき）' : 'ご利用開始のご案内';
    setResult({
      kind: 'ok',
      text: `${app.salon_name} を承認しました${k === 'self' ? '（掲載を始めました）' : '（お店を作りました）'}。${app.email} へ「${mailName}」を${body.mailStatus === 'failed' ? '送れませんでした' : '自動で送りました'}。`,
      mail: MAIL[body.mailStatus ?? 'pending'],
      link: body.inviteLink,
    });
    load();
    onChanged?.();
  }

  async function resend(app: Application) {
    setBusy(app.id);
    setResult(null);
    const { ok, body } = await call('/api/admin/resend-invite', app);
    setBusy(null);
    if (!ok) {
      setResult({ kind: 'error', text: toMessage({ message: body.error ?? '送れませんでした' }) });
      return;
    }
    setResult({
      kind: 'ok',
      text: body.inviteLink ? `${app.email} へ、新しいリンクのご案内メールを送りました。` : `${app.email} へ、「掲載開始のお知らせ」をもう一度送りました。`,
      mail: MAIL[body.mailStatus ?? 'pending'],
      link: body.inviteLink,
    });
    load();
  }

  async function reject(app: Application, notify: boolean) {
    setBusy(app.id);
    setResult(null);
    const { ok, body } = await call('/api/admin/reject', app, { notify });
    setBusy(null);
    setRejecting(null);
    if (!ok) setResult({ kind: 'error', text: toMessage({ message: body.error ?? '見送れませんでした' }) });
    else
      setResult({
        kind: 'ok',
        text: `${app.salon_name} の掲載を見送りました。${notify ? `${app.email} へ「見送りのご連絡」を送りました。` : 'メールは送っていません。'}`,
        mail: notify ? MAIL[body.mailStatus ?? 'pending'] : undefined,
      });
    load();
    onChanged?.();
  }

  if (error) return <ErrorState onRetry={load}>{error}</ErrorState>;
  if (!rows) return <Loading rows={3} />;

  const shown = filter === 'pending' ? rows.filter((r) => r.status === 'pending') : rows;
  const pendingCount = rows.filter((r) => r.status === 'pending').length;

  return (
    <Stack gap={4}>
      {result && (
        <div data-result={result.kind}>
          <Notice tone={result.kind === 'ok' ? 'success' : 'danger'} role="status">
            {result.text}
            {result.mail && (
              <>
                <br />
                メール：{result.mail}
              </>
            )}
            {result.link && (
              <details className={s.invite} data-invite-link="">
                <summary className={s.inviteToggle}>ご利用開始のリンクを表示（電話などで個別に伝える場合）</summary>
                <Input readOnly value={result.link} onFocus={(e) => e.target.select()} />
              </details>
            )}
          </Notice>
        </div>
      )}
      <div className={s.toolbar}>
        <Segmented
          label="表示"
          className={s.filter}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'pending', label: `未対応（${pendingCount}）` },
            { value: 'all', label: `すべて（${rows.length}）` },
          ]}
        />
        <p className={s.formLink}>
          <LinkIcon size={20} aria-hidden focusable="false" />
          <span>
            公開フォーム：<a href="/apply">/apply</a>
          </span>
        </p>
      </div>
      {shown.length === 0 ? (
        <Panel>
          <Empty icon={ClipboardText}>{filter === 'pending' ? '承認を待っている掲載希望はありません。' : '掲載希望はまだありません。'}</Empty>
        </Panel>
      ) : (
        <div className={s.cards}>
          {shown.map((a) => {
            const status = STATUS[a.status];
            return (
              <Panel key={a.id} className={s.card} data-application="" data-status={a.status}>
                <div className={s.cardHead}>
                  <p className={s.name}>
                    <Storefront size={24} weight="duotone" aria-hidden focusable="false" />
                    {a.salon_name}
                  </p>
                  <span className={s.labels}>
                    <Label kind="condition" icon={a.applicant_user_id ? UserPlus : ClipboardText}>
                      {a.applicant_user_id ? '新規登録' : 'フォーム'}
                    </Label>
                    <Label kind={status.kind} icon={status.icon} weight={a.status === 'approved' ? 'fill' : undefined}>
                      {status.label}
                    </Label>
                  </span>
                </div>
                <p className={s.kind}>
                  {kindOf(a) === 'signup'
                    ? 'サロンの画面の「新規登録」からの申込です。承認すると、お店を作り、ご登録のメールアドレスへ確認のリンクを自動で送ります。リンクを開くと登録が完了し、サロンの画面に入れます（新しく作ったアカウントは、それまでログインできません）。'
                    : kindOf(a) === 'self'
                      ? 'お店が自分でアカウントを作り、お店の情報を登録済みです。承認すると、そのまま掲載が始まります。'
                      : '公開フォームからの申込です。承認すると、サロンとスタッフのアカウントを作り、ご利用開始のご案内を送ります。'}
                </p>
                <DataList
                  className={s.details}
                  items={[
                    ['担当者', a.contact_name],
                    ['メール', <span key="mail" className="break">{a.email}</span>],
                    ['電話', <span key="tel" className="num">{a.phone ?? '—'}</span>],
                    ['エリア', a.area_text],
                    ['ご質問', a.question ?? '—'],
                    ['受付', <span key="at" className="num">{dt.format(new Date(a.created_at))}</span>],
                    ...(a.status === 'approved'
                      ? ([
                          [
                            'ご案内',
                            <span key="invite" className="num">
                              {a.invite_sent_at ? `${dt.format(new Date(a.invite_sent_at))} に送信（${a.invite_count}回）` : '未送信'}
                              {!a.salon_id && '（サロンは削除済み）'}
                            </span>,
                          ],
                        ] as [ReactNode, ReactNode][])
                      : []),
                  ]}
                />
                {a.status === 'pending' && (
                  <div className={s.actions}>
                    <Button
                      variant="quiet"
                      size="md"
                      icon={XCircle}
                      disabled={busy !== null}
                      onClick={() => {
                        setNotifyReject(true);
                        setRejecting(a);
                      }}
                    >
                      見送る
                    </Button>
                    <Button variant="primary" size="md" icon={CheckCircle} disabled={busy !== null} onClick={() => approve(a)}>
                      {busy === a.id ? '処理中…' : kindOf(a) === 'self' ? '承認して掲載を始める' : kindOf(a) === 'signup' ? '承認して確認のリンクを送る' : '承認してご案内を送る'}
                    </Button>
                  </div>
                )}
                {a.status === 'approved' && a.salon_id && (
                  <Button variant="secondary" size="md" block icon={PaperPlaneTilt} className={s.resend} disabled={busy !== null} onClick={() => resend(a)}>
                    {busy === a.id ? '送信中…' : 'ご案内メールをもう一度送る'}
                  </Button>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      {rejecting && (
        <Sheet label="掲載を見送りますか" role="alertdialog" narrow onClose={() => setRejecting(null)}>
          <SectionHead icon={XCircle} title={`${rejecting.salon_name} の掲載を見送りますか？`} as="p" />
          <ul className={s.points}>
            <li>申込は「見送り」になります。元に戻せません。</li>
            {kindOf(rejecting) === 'signup' && <li>新規登録で作った確認前のアカウントは削除します（同じメールアドレスで、改めて申し込めます）。</li>}
            {kindOf(rejecting) === 'self' && <li>お店が作ったアカウントとお店の情報は残ります（掲載はされません）。不要なら「サロン」のタブから削除できます。</li>}
          </ul>
          <Check checked={notifyReject} onChange={setNotifyReject} className={s.notify}>
            {rejecting.email} へ「見送りのご連絡」をメールで送る
          </Check>
          <Pair>
            <Button variant="quiet" size="md" onClick={() => setRejecting(null)}>
              やめる
            </Button>
            <Button variant="dangerSolid" size="md" disabled={busy !== null} onClick={() => reject(rejecting, notifyReject)}>
              {busy === rejecting.id ? '処理中…' : '見送る'}
            </Button>
          </Pair>
        </Sheet>
      )}
    </Stack>
  );
}
