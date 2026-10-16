'use client';

// 実証終了時の個人情報の削除・加工。デモでは、実行前に対象件数だけを表示する「試し実行」まで

import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import Button from '@/components/ui/Button';
import Label, { type LabelKind } from '@/components/ui/Label';
import { Stack } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { ChartBar, EyeSlash, Play, ShieldWarning, TrashSimple } from '@/components/ui/icons';
import { toMessage } from '@/lib/errors';
import s from './TrialEnd.module.css';

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

// 扱いのラベル：色だけでなく、アイコン（ごみ箱・伏せる・集計）でも見分ける
const ACTION: Record<Item['action'], { label: string; kind: LabelKind; icon: PhosphorIcon }> = {
  delete: { label: '削除', kind: 'danger', icon: TrashSimple },
  anonymize: { label: '識別できない形に加工', kind: 'action', icon: EyeSlash },
  keep: { label: '残す（集計用）', kind: 'state', icon: ChartBar },
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
    <Stack gap={4} className={s.root}>
      <Panel>
        <SectionHead icon={ShieldWarning} title="実証終了時の削除・加工" />
        <SubText>
          実証の終了時に、個人情報を削除するか、個人を識別できない形に加工します。デモでは対象の件数を数える「試し実行」だけを行い、データは変更しません（実行したことは操作記録に残ります）。
        </SubText>
        <Button variant="primary" size="md" block icon={Play} disabled={busy} onClick={dryRun}>
          {busy ? '数えています…' : '試し実行（対象件数を表示）'}
        </Button>
      </Panel>
      {error && <Notice tone="danger">{error}</Notice>}
      {items && (
        <Panel flush className={s.result}>
          <p className={s.when}>
            {at && new Date(at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} 時点の対象件数（試し実行・変更なし）
          </p>
          <ul className={s.list}>
            {items.map((i) => (
              <li key={i.key}>
                <span className={`num ${s.count}`}>{i.count.toLocaleString()}件</span>
                <span className={s.what}>{ITEM_LABEL[i.key] ?? i.key}</span>
                <Label kind={ACTION[i.action].kind} icon={ACTION[i.action].icon}>
                  {ACTION[i.action].label}
                </Label>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </Stack>
  );
}
