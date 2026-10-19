'use client';

// システム状況：その場で確かめた結果を出す（作り話の「正常」は出さない）
//   ・Web サーバー：/api/health が応える（かかった時間）
//   ・データベース：軽い読み取りが返る（かかった時間。1.5秒より遅ければ注意）
//   ・通知の送信：10分より前から送れていない通知がない・この24時間に送れなかった通知がない
//   ・外部の連携：LINE・メールのキーが入っているか（入っていなければ、シミュレーション送信で動く）
// compact：概要のカード（項目の一覧だけ）／それ以外：システム状況の画面（説明つき）

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Button from '@/components/ui/Button';
import { ArrowClockwise, CheckCircle, Info, WarningCircle, XCircle } from '@/components/ui/icons';
import s from './SystemStatus.module.css';

type Level = 'ok' | 'info' | 'warn' | 'ng';
type Item = { key: string; label: string; level: Level; text: string; detail: string };

const LEVEL_TEXT: Record<Level, string> = { ok: '正常', info: '確認', warn: '注意', ng: '異常' };

async function timed<T>(fn: () => PromiseLike<T>): Promise<{ value: T | null; ms: number; error: boolean }> {
  const t0 = performance.now();
  try {
    const value = await fn();
    return { value, ms: Math.round(performance.now() - t0), error: false };
  } catch {
    return { value: null, ms: Math.round(performance.now() - t0), error: true };
  }
}

export function useSystemStatus(client: SupabaseClient) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const stuckBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    const [web, db, stuck, failed] = await Promise.all([
      timed(() => fetch('/api/health', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))),
      timed(() => client.from('areas').select('id').limit(1)),
      client.from('notification_outbox').select('id', { count: 'exact' }).in('status', ['pending', 'sending']).lt('created_at', stuckBefore).limit(1),
      client.from('notification_outbox').select('id', { count: 'exact' }).eq('status', 'failed').gte('created_at', since).limit(1),
    ]);
    const health = web.value as { line: boolean; mail: boolean; demo: boolean } | null;
    const dbError = db.error || !!(db.value as { error: unknown } | null)?.error;
    const stuckN = stuck.error ? null : (stuck.count ?? 0);
    const failedN = failed.error ? null : (failed.count ?? 0);
    const next: Item[] = [
      {
        key: 'web',
        label: 'Web サーバー',
        level: web.error ? 'ng' : 'ok',
        text: web.error ? '応答なし' : `${web.ms}ms`,
        detail: web.error ? 'サーバーの確認用の URL が応えませんでした。' : '画面を返すサーバーが応えています。',
      },
      {
        key: 'db',
        label: 'データベース',
        level: dbError ? 'ng' : db.ms > 1500 ? 'warn' : 'ok',
        text: dbError ? '読み取りに失敗' : `${db.ms}ms`,
        detail: dbError ? 'データベースから読み取れませんでした。' : db.ms > 1500 ? '読み取りに時間がかかっています。' : '読み取りが返っています。',
      },
      {
        key: 'notify',
        label: '通知の送信',
        level: stuckN === null || failedN === null ? 'ng' : stuckN > 0 || failedN > 0 ? 'warn' : 'ok',
        text:
          stuckN === null || failedN === null
            ? '確かめられません'
            : stuckN > 0
              ? `送信待ち ${stuckN}件`
              : failedN > 0
                ? `失敗 ${failedN}件（24時間）`
                : '滞りなし',
        detail: '10分より前から送れていない通知と、この24時間に送れなかった通知の数です（「通知・記録」で中身を確かめられます）。',
      },
      {
        key: 'external',
        label: '外部の連携（LINE・メール）',
        level: !health ? 'ng' : health.line && health.mail ? 'ok' : 'info',
        text: !health ? '確かめられません' : health.line && health.mail ? '接続済み' : `シミュレーション（${[!health.line && 'LINE', !health.mail && 'メール'].filter(Boolean).join('・')}）`,
        detail: 'キーが入っていない送り先は、実際には送らず「シミュレーション送信」として記録します（デモではこのままで動きます）。',
      },
    ];
    setItems(next);
    setAt(new Date());
    setBusy(false);
  }, [client]);

  useEffect(() => {
    run();
    const t = setInterval(run, 60_000);
    return () => clearInterval(t);
  }, [run]);

  const overall: Level | null = items
    ? items.some((i) => i.level === 'ng')
      ? 'ng'
      : items.some((i) => i.level === 'warn')
        ? 'warn'
        : 'ok'
    : null;
  return { items, at, busy, run, overall };
}

const ICON = { ok: CheckCircle, info: Info, warn: WarningCircle, ng: XCircle };
const OVERALL_TEXT: Record<Level, string> = { ok: '正常稼働中', info: '正常稼働中', warn: '一部に注意', ng: '異常あり' };
const timeFmt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function SystemStatus({ client, compact = false }: { client: SupabaseClient; compact?: boolean }) {
  const { items, at, busy, run, overall } = useSystemStatus(client);
  return (
    <div className={s.box}>
      <div className={s.head}>
        {overall && (
          <span className={`${s.overall} ${s[overall]}`} role="status">
            <span className={s.dot} aria-hidden />
            {OVERALL_TEXT[overall]}
          </span>
        )}
        {!compact && (
          <Button variant="quiet" icon={ArrowClockwise} disabled={busy} onClick={run}>
            もう一度確かめる
          </Button>
        )}
      </div>
      {items === null ? (
        <p className={s.wait}>確かめています…</p>
      ) : (
        <ul className={s.list}>
          {items.map((i) => {
            const Glyph = ICON[i.level];
            return (
              <li key={i.key} className={s.item}>
                <Glyph size={20} weight="fill" className={s[i.level]} aria-hidden focusable="false" />
                <span className={s.body}>
                  <span className={s.label}>{i.label}</span>
                  {!compact && <small className={s.detail}>{i.detail}</small>}
                </span>
                <span className={`${s.value} ${s[i.level]}`}>
                  <span className="sr-only">{LEVEL_TEXT[i.level]}：</span>
                  {compact ? LEVEL_TEXT[i.level] : i.text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {at && <p className={`${s.at} num`}>最終確認 {timeFmt.format(at)}（1分ごとに確かめます）</p>}
    </div>
  );
}
