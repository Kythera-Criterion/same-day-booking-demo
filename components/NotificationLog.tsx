'use client';

// 通知ログ：送信した通知（シミュレーション送信を含む）を、LINE 風・メール風のプレビューで確認する

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { STATUS_LABEL, renderNotification, type OutboxRow } from '@/lib/notify/format';

const REASON_LABEL: Record<string, string> = {
  no_line_key: 'LINE のキーが未設定のため',
  no_line_group: '連絡用グループが未設定のため',
  no_resend_key: 'Resend のキーが未設定のため',
  no_recipient: '宛先がないため',
};

const timeFmt = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export default function NotificationLog({
  client,
  salonId,
  limit = 20,
  showRecipient = false,
}: {
  client: SupabaseClient;
  salonId?: string;
  limit?: number;
  showRecipient?: boolean;
}) {
  const [rows, setRows] = useState<OutboxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<number | null>(null);

  const load = useCallback(async () => {
    let query = client
      .from('notification_outbox')
      .select('id,kind,channel,salon_id,booking_id,recipient,payload,status,attempts,sent_at,last_error,response,created_at')
      .order('id', { ascending: false })
      .limit(limit);
    if (salonId) query = query.eq('salon_id', salonId);
    const { data, error: loadError } = await query;
    if (loadError) {
      setError('通知ログを読み込めませんでした。');
      return;
    }
    setError(null);
    setRows((data ?? []) as OutboxRow[]);
  }, [client, salonId, limit]);

  useEffect(() => {
    load();
    const channel = client
      .channel(`notification-log-${salonId ?? 'all'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notification_outbox' }, (payload) => {
        const row = payload.new as { id?: number };
        if (payload.eventType === 'INSERT' && row.id) setFreshId(row.id);
        load();
      })
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [client, salonId, load]);

  if (error) return <p className="state state-error">{error}</p>;
  if (rows === null) return <div className="skeleton-list" aria-busy="true"><span /><span /></div>;
  if (rows.length === 0) return <p className="state">まだ通知はありません。</p>;

  return (
    <ul className="notify-list">
      {rows.map((row) => {
        const rendered = renderNotification(row.kind, row.payload);
        const reason = typeof row.response?.reason === 'string' ? REASON_LABEL[row.response.reason] : null;
        return (
          <li key={row.id} className={`notify ${row.id === freshId ? 'is-fresh' : ''}`}>
            <div className="notify-head">
              <span className={`notify-channel notify-${row.channel}`}>{row.channel === 'line' ? 'LINE' : 'メール'}</span>
              <span className={`pill pill-${row.status}`}>{STATUS_LABEL[row.status]}</span>
              <time className="notify-time">{timeFmt.format(new Date(row.sent_at ?? row.created_at))}</time>
            </div>
            {rendered.channel === 'line' ? (
              <div className="line-preview">
                <div className="line-room">
                  連絡用グループ{showRecipient || row.recipient ? '' : '（未設定）'}
                </div>
                <p className="line-bubble">{rendered.text}</p>
              </div>
            ) : (
              <div className="mail-preview">
                <div className="mail-meta">
                  <span>件名：{rendered.subject}</span>
                  {showRecipient && <span>宛先：{row.recipient ?? '（なし）'}</span>}
                </div>
                <p className="mail-body">{rendered.text}</p>
              </div>
            )}
            {row.status === 'simulated' && reason && <p className="notify-note">{reason}、送信したことにして記録しました。</p>}
            {row.last_error && <p className="notify-note notify-error">{row.last_error}</p>}
          </li>
        );
      })}
    </ul>
  );
}
