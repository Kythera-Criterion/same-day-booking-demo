import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchPending } from '@/lib/notify/dispatch';
import type { NotificationKind, NotificationPayload } from '@/lib/notify/format';

// メールを送信待ちに積み、すぐに送る。送信の結果（sent / simulated / pending / failed）を返す
export async function sendMail(
  admin: SupabaseClient,
  opts: { kind: NotificationKind; to: string; payload: NotificationPayload; dedupeKey: string; salonId?: string | null },
): Promise<string> {
  const { error } = await admin.from('notification_outbox').insert({
    dedupe_key: opts.dedupeKey,
    kind: opts.kind,
    channel: 'email',
    salon_id: opts.salonId ?? null,
    recipient: opts.to,
    payload: opts.payload,
  });
  if (error) throw new Error(`メールを積めませんでした（${error.message}）`);
  try {
    await dispatchPending();
  } catch {
    // 送れなかった分は、定期の送信処理がもう一度送る
  }
  const { data } = await admin.from('notification_outbox').select('status').eq('dedupe_key', opts.dedupeKey).maybeSingle();
  return (data?.status as string | undefined) ?? 'pending';
}

export function mailKey(kind: NotificationKind, id: string): string {
  return `${kind}:${id}:${Date.now().toString(36)}`;
}
