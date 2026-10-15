'use client';

// 実証終了時の個人情報の削除・加工。デモでは、実行前に対象件数だけを表示する「試し実行」まで

import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toMessage } from '@/lib/errors';

type Item = { key: string; action: 'delete' | 'anonymize' | 'keep'; count: number };

const ITEM_LABEL: Record<string, string> = {
  profiles: '利用者のプロフィール（氏名・電話番号・メール・カルテ）',
  booking_contacts: '予約に写した連絡先（氏名・電話番号・メール）',
  booking_kartes: '予約に写したカルテ・メモ',
  hair_photos: 'ヘア写真',
  no_show_records: '無断キャンセルの記録',
  notification_recipients: '通知の宛先とお名前',
  salon_applications: '掲載希望の申込（担当者名・連絡先）',
  consents: '規約への同意の記録',
  booking_demographics: '予約時の年代・職業（個人と結びつかない形）',
  survey_answers: 'アンケートの回答（個人と結びつかない形）',
};

const ACTION: Record<Item['action'], { label: string; pill: string }> = {
  delete: { label: '削除', pill: 'no_show' },
  anonymize: { label: '識別できない形に加工', pill: 'pending' },
  keep: { label: '残す（集計用）', pill: 'completed' },
};

export default function TrialEnd({ client }: { client: SupabaseClient }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function dryRun() {
    setBusy(true);
    setError(null);
    const { data, error: e } = await client.rpc('admin_trial_end_dry_run');
    setBusy(false);
    if (e) {
      setError(toMessage(e));
      return;
    }
    const r = data as { items: Item[]; executed_at: string };
    setItems(r.items);
    setAt(r.executed_at);
  }

  return (
    <div className="stack">
      <section className="card">
        <h2 className="card-title">実証終了時の削除・加工</h2>
        <p className="card-sub">
          実証の終了時に、個人情報を削除するか、個人を識別できない形に加工します。デモでは対象の件数を数える「試し実行」だけを行い、データは変更しません（実行したことは操作記録に残ります）。
        </p>
        <button className="btn btn-primary btn-block" disabled={busy} onClick={dryRun}>
          {busy ? '数えています…' : '試し実行（対象件数を表示）'}
        </button>
      </section>
      {error && <p className="notice notice-error">{error}</p>}
      {items && (
        <section className="card fade-in">
          <p className="card-sub">
            {at && new Date(at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} 時点の対象件数（試し実行・変更なし）
          </p>
          <ul className="overview-list">
            {items.map((i) => (
              <li key={i.key}>
                <span className="num">{i.count.toLocaleString()}件</span>
                <span>{ITEM_LABEL[i.key] ?? i.key}</span>
                <span className={`pill pill-${ACTION[i.action].pill}`}>{ACTION[i.action].label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
