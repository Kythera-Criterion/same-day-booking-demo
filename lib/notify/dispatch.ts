import 'server-only';
import { adminClient } from '@/lib/server/supabase-admin';
import { renderNotification, type OutboxRow, type Rendered } from '@/lib/notify/format';

// 送信待ちの通知を取り出して送る。
// 取り出しはデータベースの claim_notifications（for update skip locked）で行うため、
// 予約直後の呼び出しと定期実行が重なっても、同じ通知を二度送らない。
// LINE・Resend のキーがない場合は「シミュレーション送信」として中身を記録する。

const MAX_ATTEMPTS = 5;

type SendResult =
  | { status: 'sent'; response: Record<string, unknown> }
  | { status: 'simulated'; response: Record<string, unknown> }
  | { status: 'retry' | 'failed'; error: string; response?: Record<string, unknown> };

async function sendLine(row: OutboxRow, rendered: Rendered): Promise<SendResult> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !row.recipient) {
    return {
      status: 'simulated',
      response: { simulated: true, reason: !token ? 'no_line_key' : 'no_line_group', rendered },
    };
  }
  // Messaging API のプッシュメッセージ。X-Line-Retry-Key で再送時の二重配信も防ぐ
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Line-Retry-Key': lineRetryKey(row.id),
    },
    body: JSON.stringify({ to: row.recipient, messages: [{ type: 'text', text: rendered.text }] }),
  });
  if (res.ok || res.status === 409) {
    return { status: 'sent', response: { http: res.status, rendered } };
  }
  const body = await res.text();
  return {
    status: res.status >= 500 || res.status === 429 ? 'retry' : 'failed',
    error: `LINE ${res.status}: ${body.slice(0, 300)}`,
  };
}

async function sendEmail(row: OutboxRow, rendered: Rendered): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from || !row.recipient || rendered.channel !== 'email') {
    return {
      status: 'simulated',
      response: { simulated: true, reason: !key || !from ? 'no_resend_key' : 'no_recipient', rendered },
    };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `outbox-${row.id}`,
    },
    body: JSON.stringify({
      from,
      to: [row.recipient],
      subject: rendered.subject,
      text: rendered.text,
      ...(rendered.html ? { html: rendered.html } : {}),
      ...(process.env.MAIL_REPLY_TO ? { reply_to: process.env.MAIL_REPLY_TO } : {}),
    }),
  });
  const body = await res.text();
  if (res.ok) return { status: 'sent', response: { http: res.status, body: safeJson(body), rendered } };
  return {
    status: res.status >= 500 || res.status === 429 ? 'retry' : 'failed',
    error: `Resend ${res.status}: ${body.slice(0, 300)}`,
  };
}

export type DispatchSummary = { processed: number; sent: number; simulated: number; failed: number; retry: number };

export async function dispatchPending(limit = 10): Promise<DispatchSummary> {
  const admin = adminClient();
  const summary: DispatchSummary = { processed: 0, sent: 0, simulated: 0, failed: 0, retry: 0 };

  const { data, error } = await admin.rpc('claim_notifications', { p_limit: limit });
  if (error) throw new Error(`claim_notifications: ${error.message}`);
  const rows = (data ?? []) as OutboxRow[];

  for (const row of rows) {
    summary.processed++;
    let result: SendResult;
    try {
      const rendered = renderNotification(row.kind, row.payload);
      result = row.channel === 'line' ? await sendLine(row, rendered) : await sendEmail(row, rendered);
    } catch (e) {
      result = { status: 'retry', error: e instanceof Error ? e.message : String(e) };
    }

    if (result.status === 'sent' || result.status === 'simulated') {
      await admin.rpc('finish_notification', { p_id: row.id, p_status: result.status, p_response: result.response });
      // 実際に送ったご案内メールは、記録からリンクを消す（ログイン用のリンクを残さない）
      if (result.status === 'sent' && row.kind === 'salon_welcome_mail') {
        await admin
          .from('notification_outbox')
          .update({ payload: { ...row.payload, invite_link: null, link_redacted: true }, response: { http: 200 } })
          .eq('id', row.id);
      }
      summary[result.status]++;
    } else {
      const giveUp = result.status === 'failed' || row.attempts >= MAX_ATTEMPTS;
      await admin.rpc('finish_notification', {
        p_id: row.id,
        p_status: giveUp ? 'failed' : 'pending',
        p_error: result.error,
        p_response: result.response ?? null,
      });
      summary[giveUp ? 'failed' : 'retry']++;
    }
  }
  return summary;
}

// LINE の X-Line-Retry-Key は UUID 形式。通知の番号から決まった値を作る
function lineRetryKey(id: number): string {
  const hex = id.toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 300);
  }
}
