'use client';

// 通知ログ：送信した通知（シミュレーション送信を含む）を、LINE 風・メール風のプレビューで確認する

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { Empty, ErrorState, Loading } from '@/components/States';
import Label, { type LabelKind } from '@/components/ui/Label';
import { Bell, ChatCircle, CheckCircle, EnvelopeSimple, HourglassMedium, Info, WarningCircle } from '@/components/ui/icons';
import { STATUS_LABEL, renderNotification, type OutboxRow } from '@/lib/notify/format';
import s from './NotificationLog.module.css';

const REASON_LABEL: Record<string, string> = {
  no_line_key: 'LINE のキーが未設定のため',
  no_line_group: '連絡用グループが未設定のため',
  no_resend_key: 'Resend のキーが未設定のため',
  no_recipient: '宛先がないため',
};

// 送信の状態：色だけでなく、アイコンでも見分ける
const STATUS_LOOK: Record<OutboxRow['status'], { kind: LabelKind; icon: PhosphorIcon }> = {
  pending: { kind: 'state', icon: HourglassMedium },
  sending: { kind: 'state', icon: HourglassMedium },
  sent: { kind: 'success', icon: CheckCircle },
  simulated: { kind: 'action', icon: Info },
  failed: { kind: 'danger', icon: WarningCircle },
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

  if (error) return <ErrorState>{error}</ErrorState>;
  if (rows === null) return <Loading rows={2} />;
  if (rows.length === 0) return <Empty icon={Bell}>まだ通知はありません。</Empty>;

  return (
    <ul className={s.list}>
      {rows.map((row) => {
        const rendered = renderNotification(row.kind, row.payload);
        const reason = typeof row.response?.reason === 'string' ? REASON_LABEL[row.response.reason] : null;
        const look = STATUS_LOOK[row.status] ?? STATUS_LOOK.pending;
        return (
          <li key={row.id} className={`${s.item} ${row.id === freshId ? s.fresh : ''}`}>
            <div className={s.head}>
              <Label kind="condition" icon={row.channel === 'line' ? ChatCircle : EnvelopeSimple}>
                {row.channel === 'line' ? 'LINE' : 'メール'}
              </Label>
              <Label kind={look.kind} icon={look.icon}>
                {STATUS_LABEL[row.status]}
              </Label>
              <time className={`num ${s.time}`}>{timeFmt.format(new Date(row.sent_at ?? row.created_at))}</time>
            </div>
            {rendered.channel === 'line' ? (
              <div className={s.line}>
                <div className={s.room}>
                  連絡用グループ{showRecipient || row.recipient ? '' : '（未設定）'}
                </div>
                <p className={s.bubble}>{rendered.text}</p>
              </div>
            ) : (
              <div className={s.mail}>
                <div className={s.meta}>
                  <span>件名：{rendered.subject}</span>
                  {showRecipient && <span className="break">宛先：{row.recipient ?? '（なし）'}</span>}
                </div>
                <p className={s.body}>{rendered.text}</p>
              </div>
            )}
            {row.status === 'simulated' && reason && <p className={s.note}>{reason}、送信したことにして記録しました。</p>}
            {row.last_error && <p className={`${s.note} ${s.error}`}>{row.last_error}</p>}
          </li>
        );
      })}
    </ul>
  );
}
