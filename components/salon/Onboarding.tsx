'use client';

// 初めてログインしたときの3ステップ（①メニューと価格・受付締切 ②担当 ③受け付ける性別と LINE の連絡先）。
// 進み具合は DB に残すので、途中でやめても次回は続きから始まる

import type { SupabaseClient } from '@supabase/supabase-js';
import { useState } from 'react';
import { toMessage } from '@/lib/errors';
import SalonSettings from './SalonSettings';
import type { Menu, SalonInfo, Stylist } from './useSalonData';

const STEPS = [
  { title: 'メニューと価格・受付の締切', note: '当日価格と、開始の何分前まで予約を受けるかを決めます。1つ以上登録してください。' },
  { title: '担当', note: '担当を指定しない場合は、そのまま次へ進めます。' },
  { title: '受け付ける性別と LINE の連絡先', note: '予約の知らせを受け取る連絡用グループを設定します（デモでは空のままで動きます）。' },
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

  async function go(next: number) {
    setBusy(true);
    setError(null);
    const { error: e } = await client.rpc('salon_set_onboarding', { p_salon_id: salon.id, p_step: next });
    setBusy(false);
    if (e) setError(toMessage(e));
    else onSaved();
  }

  return (
    <div className="stack onboarding">
      <section className="card">
        <p className="card-title">はじめに、3つだけ設定してください</p>
        <ol className="onb-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className={i < current ? 'is-done' : i === current ? 'is-now' : ''}>
              <span className="onb-no">{i < current ? '✓' : i + 1}</span>
              {s.title}
            </li>
          ))}
        </ol>
        <p className="card-sub" style={{ margin: 0 }}>
          {STEPS[current].note} 途中でやめても、次回は続きから始まります。
        </p>
      </section>

      <SalonSettings
        client={client}
        salon={salon}
        menus={menus}
        stylists={stylists}
        lineGroup={lineGroup}
        onSaved={onSaved}
        only={current === 0 ? 'menus' : current === 1 ? 'stylists' : 'contact'}
      />

      {error && <p className="notice notice-error">{error}</p>}
      <div className="action-pair">
        <button className="btn btn-quiet" disabled={busy || current === 0} onClick={() => go(current - 1)}>
          戻る
        </button>
        <button className="btn btn-primary" disabled={busy || (current === 0 && menus.filter((m) => m.is_active).length === 0)} onClick={() => go(current + 1)}>
          {current === 2 ? '設定を終えて始める' : '次へ'}
        </button>
      </div>
    </div>
  );
}
