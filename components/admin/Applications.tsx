'use client';

// 掲載希望の受付：公開フォームからの申込の一覧。
// 承認すると、サロンとスタッフのアカウントを作り、申込のメールアドレスへ「ご利用開始のご案内」を自動で送る

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Empty, ErrorState, Loading } from '@/components/States';
import { toMessage } from '@/lib/errors';

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
  created_at: string;
};

const STATUS: Record<Application['status'], { label: string; pill: string }> = {
  pending: { label: '未対応', pill: 'pending' },
  approved: { label: '承認済み', pill: 'completed' },
  rejected: { label: '見送り', pill: 'closed' },
};

const MAIL: Record<string, string> = {
  sent: '送信しました',
  simulated: 'シミュレーション送信しました（Resend のキーが未設定のため。中身は「通知・記録」で確認できます）',
  pending: '送信待ちです（まもなく送られます）',
  sending: '送信中です',
  failed: '送信に失敗しました。「メールをもう一度送る」をお試しください',
};

const dt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

type Result = { kind: 'ok' | 'error'; text: string; mail?: string; link?: string | null };

export default function Applications({ client, onChanged }: { client: SupabaseClient; onChanged?: () => void }) {
  const [rows, setRows] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');

  const load = useCallback(async () => {
    const { data, error: e } = await client
      .from('salon_applications')
      .select('id,salon_name,contact_name,email,phone,area_text,question,status,salon_id,invite_sent_at,invite_count,created_at')
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

  async function call(path: string, app: Application) {
    const token = (await client.auth.getSession()).data.session?.access_token;
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ applicationId: app.id }),
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
    setResult({
      kind: 'ok',
      text: `${app.salon_name} を承認しました。${app.email} へ「ご利用開始のご案内」を${body.mailStatus === 'failed' ? '送れませんでした' : '自動で送りました'}。`,
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
    setResult({ kind: 'ok', text: `${app.email} へ、新しいリンクのご案内メールを送りました。`, mail: MAIL[body.mailStatus ?? 'pending'], link: body.inviteLink });
    load();
  }

  async function reject(app: Application) {
    setBusy(app.id);
    const { error: e } = await client.rpc('admin_reject_application', { p_application_id: app.id });
    setBusy(null);
    if (e) setResult({ kind: 'error', text: toMessage(e) });
    load();
    onChanged?.();
  }

  if (error) return <ErrorState onRetry={load}>{error}</ErrorState>;
  if (!rows) return <Loading rows={3} />;

  const shown = filter === 'pending' ? rows.filter((r) => r.status === 'pending') : rows;
  const pendingCount = rows.filter((r) => r.status === 'pending').length;

  return (
    <div className="stack">
      {result && (
        <div className={`notice ${result.kind === 'ok' ? 'notice-ok' : 'notice-error'}`} role="status">
          {result.text}
          {result.mail && (
            <>
              <br />
              メール：{result.mail}
            </>
          )}
          {result.link && (
            <details className="invite-link">
              <summary>ご利用開始のリンクを表示（電話などで個別に伝える場合）</summary>
              <input className="input" readOnly value={result.link} onFocus={(e) => e.target.select()} />
            </details>
          )}
        </div>
      )}
      <div className="row-between">
        <div className="segmented" role="group" aria-label="表示" style={{ minWidth: 260 }}>
          <button aria-pressed={filter === 'pending'} onClick={() => setFilter('pending')}>
            未対応（{pendingCount}）
          </button>
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            すべて（{rows.length}）
          </button>
        </div>
        <p className="fine-print" style={{ margin: 0 }}>
          公開フォーム：<a href="/apply">/apply</a>
        </p>
      </div>
      {shown.length === 0 ? (
        <div className="card">
          <Empty>{filter === 'pending' ? '承認を待っている掲載希望はありません。' : '掲載希望はまだありません。'}</Empty>
        </div>
      ) : (
        shown.map((a) => (
          <section key={a.id} className="card">
            <div className="row-between">
              <p className="card-title" style={{ margin: 0 }}>
                {a.salon_name}
              </p>
              <span className={`pill pill-${STATUS[a.status].pill}`}>{STATUS[a.status].label}</span>
            </div>
            <dl className="detail-dl" style={{ marginTop: 10 }}>
              <dt>担当者</dt>
              <dd>{a.contact_name}</dd>
              <dt>メール</dt>
              <dd className="break">{a.email}</dd>
              <dt>電話</dt>
              <dd>{a.phone ?? '—'}</dd>
              <dt>エリア</dt>
              <dd>{a.area_text}</dd>
              <dt>ご質問</dt>
              <dd>{a.question ?? '—'}</dd>
              <dt>受付</dt>
              <dd className="num">{dt.format(new Date(a.created_at))}</dd>
              {a.status === 'approved' && (
                <>
                  <dt>ご案内</dt>
                  <dd className="num">
                    {a.invite_sent_at ? `${dt.format(new Date(a.invite_sent_at))} に送信（${a.invite_count}回）` : '未送信'}
                    {!a.salon_id && '（サロンは削除済み）'}
                  </dd>
                </>
              )}
            </dl>
            {a.status === 'pending' && (
              <div className="action-pair" style={{ marginTop: 12 }}>
                <button className="btn btn-quiet" disabled={busy !== null} onClick={() => reject(a)}>
                  見送る
                </button>
                <button className="btn btn-primary" disabled={busy !== null} onClick={() => approve(a)}>
                  {busy === a.id ? '処理中…' : '承認してご案内を送る'}
                </button>
              </div>
            )}
            {a.status === 'approved' && a.salon_id && (
              <button className="btn btn-secondary btn-block" style={{ marginTop: 12 }} disabled={busy !== null} onClick={() => resend(a)}>
                {busy === a.id ? '送信中…' : 'ご案内メールをもう一度送る（新しいリンク）'}
              </button>
            )}
          </section>
        ))
      )}
    </div>
  );
}
