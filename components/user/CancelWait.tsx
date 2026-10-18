'use client';

// キャンセル待ち：「このお店に今日空きが出たら、メールで知らせてほしい」と登録する。
// 空きが出たら（サロンが枠を出した・キャンセルで枠が公開に戻った）、1回だけメールで知らせる（データベースが積む。0020）。
// 0020 を流していないデータベースでは、ボタンを出さない

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import Button from '@/components/ui/Button';
import { BellRinging, Check, X } from '@/components/ui/icons';
import { jstDateKey } from '@/lib/time';
import { toMessage } from '@/lib/errors';
import s from './CancelWait.module.css';

export type CancelWaits = {
  // 0020 を流したデータベースか（読めたか）
  supported: boolean;
  // 今日のキャンセル待ち（お店の ID → 知らせた時刻。まだなら null）
  waits: Map<string, string | null>;
  join: (salonId: string) => Promise<string | null>;
  leave: (salonId: string) => Promise<string | null>;
};

export function useCancelWaits(client: SupabaseClient | null, session: Session | null): CancelWaits {
  const [supported, setSupported] = useState(false);
  const [waits, setWaits] = useState<Map<string, string | null>>(() => new Map());

  const load = useCallback(async () => {
    if (!client) return;
    if (!session) {
      // ログインしていなくても、使えるかどうかだけは確かめる（ボタンを押すとログインへ）
      // 件数だけの問い合わせ（head）は、表がないときにエラーを返さないため、1件だけ読んで確かめる
      const { error } = await client.from('cancel_waits').select('id').limit(1);
      setSupported(!error);
      setWaits(new Map());
      return;
    }
    const { data, error } = await client.from('cancel_waits').select('salon_id,notified_at').eq('user_id', session.user.id).eq('day', jstDateKey());
    setSupported(!error);
    setWaits(new Map(((data ?? []) as { salon_id: string; notified_at: string | null }[]).map((w) => [w.salon_id, w.notified_at])));
  }, [client, session]);

  useEffect(() => {
    load();
  }, [load]);

  const join = useCallback(
    async (salonId: string) => {
      if (!client) return 'not_configured';
      const { error } = await client.rpc('join_cancel_wait', { p_salon_id: salonId });
      await load();
      return error ? toMessage(error) : null;
    },
    [client, load],
  );
  const leave = useCallback(
    async (salonId: string) => {
      if (!client) return 'not_configured';
      const { error } = await client.rpc('leave_cancel_wait', { p_salon_id: salonId });
      await load();
      return error ? toMessage(error) : null;
    },
    [client, load],
  );

  return { supported, waits, join, leave };
}

// 1つのお店の、キャンセル待ちのボタン（登録・解除）。ログインしていなければ、ログインへ
export function CancelWaitButton({
  state,
  signedIn,
  salonId,
  salonName,
  block = false,
}: {
  state: CancelWaits;
  signedIn: boolean;
  salonId: string;
  salonName: string;
  block?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state.supported) return null;

  if (!signedIn) {
    return (
      <Link href={`/login?next=${encodeURIComponent('/')}`} className={s.login}>
        <BellRinging size={20} aria-hidden focusable="false" />
        ログインして、{salonName}のキャンセル待ちに登録
      </Link>
    );
  }

  const waiting = state.waits.has(salonId);
  const notified = waiting && state.waits.get(salonId) !== null;
  return (
    <span className={`${s.wrap} ${block ? s.block : ''}`}>
      {waiting ? (
        <span className={s.on}>
          <span className={s.status} role="status">
            <Check size={20} aria-hidden focusable="false" />
            {notified ? `${salonName}：空きが出たのでメールでお知らせしました` : `${salonName}のキャンセル待ち中`}
          </span>
          <Button
            variant="text"
            icon={notified ? BellRinging : X}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(notified ? await state.join(salonId) : await state.leave(salonId));
              setBusy(false);
            }}
          >
            {notified ? 'もう一度待つ' : '解除'}
          </Button>
        </span>
      ) : (
        <Button
          variant="secondary"
          size="md"
          block={block}
          icon={BellRinging}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(await state.join(salonId));
            setBusy(false);
          }}
        >
          {salonName}のキャンセル待ちに登録
        </Button>
      )}
      {error && (
        <span className={s.error} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
