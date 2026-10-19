'use client';

// 通知ログと操作記録

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import NotificationLog from '@/components/NotificationLog';
import { Empty, ErrorState, Loading } from '@/components/States';
import { Segmented } from '@/components/ui/Form';
import { Stack } from '@/components/ui/Layout';
import { Panel } from '@/components/ui/Surface';
import { Bell, ClipboardText } from '@/components/ui/icons';
import { toMessage } from '@/lib/errors';
import t from './AdminTable.module.css';
import s from './Logs.module.css';

type Audit = { id: number; actor: string | null; action: string; target_id: string | null; at: string };

export const ACTION_LABEL: Record<string, string> = {
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
  pause_today: '今日はここまで（まとめて取り下げ）',
  resume_today: '取り下げた枠を元に戻す',
  update_salon_profile: 'お店の情報と場所を保存',
  suspend_salon: 'サロンの掲載を停止',
  resume_salon: 'サロンの掲載を再開',
  delete_account: 'アカウントを削除',
  salon_signup: 'サロンの新規登録（申し込み）',
  salon_apply: 'サロンの掲載の申し込み',
  salon_joined: '新しいサロンが加わった（初期設定を完了）',
  resend_invite: 'ご利用開始のご案内を再送',
  resend_approved_mail: '掲載開始のお知らせを再送',
  usage_delete: '利用の記録を選んで削除',
  usage_delete_all: '利用の記録をすべて削除',
  update_inquiry: '問い合わせの状態を変更',
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
    <Stack gap={4}>
      <Segmented
        label="記録の種類"
        className={s.switch}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'notify', label: '通知ログ' },
          { value: 'audit', label: '操作記録' },
        ]}
      />
      {tab === 'notify' && (
        <Panel>
          <p className={s.lead}>
            <Bell size={20} aria-hidden focusable="false" />
            すべてのサロン宛ての LINE と、利用者へのメール。キーがない場合はシミュレーション送信として中身を記録します。
          </p>
          <NotificationLog client={client} limit={30} showRecipient />
        </Panel>
      )}
      {tab === 'audit' && (
        <Panel flush>
          {error && (
            <div className={s.pad}>
              <ErrorState onRetry={loadAudit}>{error}</ErrorState>
            </div>
          )}
          {!audit && !error && (
            <div className={s.pad}>
              <Loading rows={3} />
            </div>
          )}
          {audit && audit.length === 0 && <Empty icon={ClipboardText}>操作記録はまだありません。</Empty>}
          {audit && audit.length > 0 && (
            <div className={`${t.wrap} ${s.auditWrap}`}>
              <table className={t.table}>
                <thead>
                  <tr>
                    <th scope="col">日時</th>
                    <th scope="col">操作</th>
                    <th scope="col">操作した人</th>
                    <th scope="col">対象</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td className={`num ${t.nowrap}`}>{dt.format(new Date(a.at))}</td>
                      <td>{ACTION_LABEL[a.action] ?? a.action}</td>
                      <td className={`num ${s.id}`}>{a.actor ? a.actor.slice(0, 8) : '—'}</td>
                      <td className={`num ${s.id}`}>{a.target_id ? a.target_id.slice(0, 8) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </Stack>
  );
}
