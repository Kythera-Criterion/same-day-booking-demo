'use client';

// 通知ログと操作記録

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import NotificationLog from '@/components/NotificationLog';
import { Empty, ErrorState, Loading } from '@/components/States';
import { toMessage } from '@/lib/errors';

type Audit = { id: number; actor: string | null; action: string; target_id: string | null; at: string };

const ACTION_LABEL: Record<string, string> = {
  create_slot: '枠を公開',
  close_slot: '枠を取り下げ',
  booking_complete: '来店済みにした',
  booking_no_show: '無断キャンセルを記録',
  booking_cancel_customer: 'キャンセル（お客様から連絡）',
  booking_cancel_salon: 'キャンセル（サロンの都合）',
  upsert_menu: 'メニューを保存',
  upsert_stylist: '美容師を保存',
  update_salon_settings: '店舗の設定を保存',
  approve_application: '掲載希望を承認',
  reject_application: '掲載希望を見送り',
  trial_end_dry_run: '終了処理の試し実行',
};

const dt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function Logs({ client }: { client: SupabaseClient }) {
  const [tab, setTab] = useState<'notify' | 'audit'>('notify');
  const [audit, setAudit] = useState<Audit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAudit = useCallback(async () => {
    const { data, error: e } = await client.from('audit_logs').select('id,actor,action,target_id,at').order('id', { ascending: false }).limit(60);
    if (e) setError(toMessage(e));
    else setAudit((data ?? []) as Audit[]);
  }, [client]);

  useEffect(() => {
    if (tab === 'audit') loadAudit();
  }, [tab, loadAudit]);

  return (
    <div className="stack">
      <div className="segmented" role="group" aria-label="記録の種類">
        <button aria-pressed={tab === 'notify'} onClick={() => setTab('notify')}>
          通知ログ
        </button>
        <button aria-pressed={tab === 'audit'} onClick={() => setTab('audit')}>
          操作記録
        </button>
      </div>
      {tab === 'notify' && (
        <section className="card">
          <p className="card-sub">すべてのサロン宛ての LINE と、利用者へのメール。キーがない場合はシミュレーション送信として中身を記録します。</p>
          <NotificationLog client={client} limit={30} showRecipient />
        </section>
      )}
      {tab === 'audit' && (
        <section className="card">
          {error && <ErrorState onRetry={loadAudit}>{error}</ErrorState>}
          {!audit && !error && <Loading rows={3} />}
          {audit && audit.length === 0 && <Empty>操作記録はまだありません。</Empty>}
          {audit && audit.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>日時</th>
                    <th>操作</th>
                    <th>操作した人</th>
                    <th>対象</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td className="num">{dt.format(new Date(a.at))}</td>
                      <td>{ACTION_LABEL[a.action] ?? a.action}</td>
                      <td className="mono">{a.actor ? a.actor.slice(0, 8) : '—'}</td>
                      <td className="mono">{a.target_id ? a.target_id.slice(0, 8) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
