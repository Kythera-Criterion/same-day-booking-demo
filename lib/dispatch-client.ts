'use client';

import { useEffect } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

// 送信待ちの通知を送るよう、サーバーへ頼む（予約・キャンセルの直後に呼ぶ）。
// 失敗しても画面の操作は止めない（定期実行で後から送られる）
export async function requestDispatch(client: SupabaseClient): Promise<void> {
  try {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch('/api/notifications/dispatch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // 定期実行に任せる
  }
}

// サロン・運営の画面を開いている間、定期的に送信を頼む（デモ用の定期実行。本番は CRON_SECRET つきの定期実行を使う）
export function useDispatchTicker(client: SupabaseClient | null, enabled: boolean, intervalMs = 30_000) {
  useEffect(() => {
    if (!client || !enabled) return;
    requestDispatch(client);
    const timer = setInterval(() => requestDispatch(client), intervalMs);
    return () => clearInterval(timer);
  }, [client, enabled, intervalMs]);
}
