'use client';

// 掲載希望の受付：公開フォームからの申込の一覧。承認するとサロンとスタッフのアカウントを作る

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
  created_at: string;
};

const STATUS: Record<Application['status'], { label: string; pill: string }> = {
  pending: { label: '未対応', pill: 'pending' },
  approved: { label: '承認済み', pill: 'completed' },
  rejected: { label: '見送り', pill: 'closed' },
};

const dt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function Applications({ client }: { client: SupabaseClient }) {
  const [rows, setRows] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string; link?: string | null } | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await client
      .from('salon_applications')
      .select('id,salon_name,contact_name,email,phone,area_text,question,status,created_at')
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

  async function approve(app: Application) {
    setBusy(app.id);
    setResult(null);
    const token = (await client.auth.getSession()).data.session?.access_token;
    const res = await fetch('/api/admin/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ applicationId: app.id }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; inviteLink?: string | null; staffEmail?: string };
    setBusy(null);
    if (!res.ok) {
      setResult({ kind: 'error', text: toMessage({ message: body.error ?? '承認できませんでした' }) });
      return;
    }
    setResult({
      kind: 'ok',
      text: `${app.salon_name} を承認し、スタッフのアカウント（${body.staffEmail}）を作りました。`,
      link: body.inviteLink,
    });
    load();
  }

  async function reject(app: Application) {
    setBusy(app.id);
    const { error: e } = await client.rpc('admin_reject_application', { p_application_id: app.id });
    setBusy(null);
    if (e) setResult({ kind: 'error', text: toMessage(e) });
    load();
  }

  if (error) return <ErrorState onRetry={load}>{error}</ErrorState>;
  if (!rows) return <Loading rows={3} />;

  return (
    <div className="stack">
      {result && (
        <div className={`notice ${result.kind === 'ok' ? 'notice-ok' : 'notice-error'}`}>
          {result.text}
          {result.link && (
            <>
              <br />
              招待リンク（スタッフの方へお送りください）：
              <input className="input" readOnly value={result.link} onFocus={(e) => e.target.select()} />
            </>
          )}
        </div>
      )}
      <p className="fine-print" style={{ marginTop: 0 }}>
        公開フォーム：<a href="/apply">/apply</a>（店舗名・担当者名・メールアドレス・電話番号（任意）・掲載を希望するエリア・ご質問）
      </p>
      {rows.length === 0 ? (
        <div className="card">
          <Empty>掲載希望はまだありません。</Empty>
        </div>
      ) : (
        rows.map((a) => (
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
              <dd>{dt.format(new Date(a.created_at))}</dd>
            </dl>
            {a.status === 'pending' && (
              <div className="action-pair" style={{ marginTop: 12 }}>
                <button className="btn btn-quiet" disabled={busy !== null} onClick={() => reject(a)}>
                  見送る
                </button>
                <button className="btn btn-primary" disabled={busy !== null} onClick={() => approve(a)}>
                  {busy === a.id ? '処理中…' : '承認する'}
                </button>
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
