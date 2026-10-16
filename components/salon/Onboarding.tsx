'use client';

// 初めてログインしたときの3ステップ（①メニューと価格・受付締切 ②担当 ③受け付ける性別と LINE の連絡先）。
// 進み具合は DB に残すので、途中でやめても次回は続きから始まる

import type { SupabaseClient } from '@supabase/supabase-js';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import { Pair } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import { Panel, SectionHead } from '@/components/ui/Surface';
import { ArrowLeft, ArrowRight, Check as CheckMark, CheckCircle, ClipboardText } from '@/components/ui/icons';
import { toMessage } from '@/lib/errors';
import SalonSettings from './SalonSettings';
import type { Menu, SalonInfo, Stylist } from './useSalonData';
import ob from './Onboarding.module.css';

const STEPS = [
  { title: 'メニューと価格・受付の締切', note: '当日価格と、開始の何分前まで予約を受けるかを決めます。1つ以上登録してください。' },
  { title: '担当', note: '担当を指定しない場合は、そのまま次へ進めます。' },
  { title: 'お店の場所・受け付ける性別・LINE の連絡先', note: 'お店の住所と位置（必須）は、利用者の画面の地図と距離に使います。LINE の連絡用グループは、デモでは空のままで動きます。設定を終えると、運営にもお知らせが届きます。' },
];

export default function Onboarding({
  client,
  salon,
  menus,
  stylists,
  lineGroup,
  step,
  onSaved,
}: {
  client: SupabaseClient;
  salon: SalonInfo;
  menus: Menu[];
  stylists: Stylist[];
  lineGroup: string | null;
  step: number;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = Math.min(step, 2);
  // 設定を終えるには、受付中のメニューと、お店の場所（住所）が必要（終えると、運営に「新しいサロンが加わりました」と知らせる）
  const hasMenu = menus.some((m) => m.is_active);
  const hasPlace = salon.address.trim() !== '';
  const blocked = (current === 0 && !hasMenu) || (current === 2 && (!hasMenu || !hasPlace));

  async function go(next: number) {
    setBusy(true);
    setError(null);
    const { error: e } = await client.rpc('salon_set_onboarding', { p_salon_id: salon.id, p_step: next });
    setBusy(false);
    if (e) setError(toMessage(e));
    else onSaved();
  }

  return (
    <div className={ob.wrap} data-onboarding="">
      <Panel className={ob.intro}>
        <SectionHead icon={ClipboardText} title="はじめに、3つだけ設定してください" />
        <ol className={ob.steps} data-onboarding-steps="">
          {STEPS.map((s, i) => {
            const state = i < current ? 'done' : i === current ? 'now' : undefined;
            return (
              <li key={s.title} className={ob.step} data-state={state} aria-current={i === current ? 'step' : undefined}>
                <span className={ob.no}>
                  {i < current ? <CheckMark size={20} weight="bold" aria-hidden focusable="false" /> : i + 1}
                </span>
                <span>
                  {s.title}
                  {i < current && <span className="sr-only">（済み）</span>}
                </span>
              </li>
            );
          })}
        </ol>
        <p className={ob.note}>{STEPS[current].note} 途中でやめても、次回は続きから始まります。</p>
      </Panel>

      <div className={ob.main}>
        <SalonSettings
          client={client}
          salon={salon}
          menus={menus}
          stylists={stylists}
          lineGroup={lineGroup}
          onSaved={onSaved}
          only={current === 0 ? 'menus' : current === 1 ? 'stylists' : 'contact'}
        />

        {current === 2 && !hasPlace && (
          <Notice tone="info" role="status">
            上の「お店の情報と場所」で住所と位置を保存すると、設定を終えられます（利用者の画面の地図と距離に使います）。
          </Notice>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <Pair>
          <Button variant="quiet" size="lg" icon={ArrowLeft} disabled={busy || current === 0} onClick={() => go(current - 1)}>
            戻る
          </Button>
          <Button
            variant="primary"
            size="lg"
            icon={current === 2 ? CheckCircle : undefined}
            iconEnd={current === 2 ? undefined : ArrowRight}
            disabled={busy || blocked}
            onClick={() => go(current + 1)}
          >
            {current === 2 ? '設定を終えて始める' : '次へ'}
          </Button>
        </Pair>
      </div>
    </div>
  );
}
