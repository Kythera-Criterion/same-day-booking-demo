'use client';

// 初めてログインしたときの3ステップ（①メニューと価格・受付締切 ②担当 ③受け付ける性別と LINE の連絡先）。
// 進み具合は DB に残すので、途中でやめても次回は続きから始まる

import type { SupabaseClient } from '@supabase/supabase-js';
import { useState } from 'react';
import { toMessage } from '@/lib/errors';
import SalonSettings from './SalonSettings';
import type { Menu, SalonInfo, Stylist } from './useSalonData';
import styles from './Onboarding.module.css';

const STEPS = [
  { title: 'メニューと当日価格', note: '当日価格と、開始の何分前まで予約を受けるかを決めます。1つ以上登録してください。' },
  { title: '担当の名前', note: '担当を指定しない場合は、そのまま次へ進めます。' },
  { title: 'お店の場所と連絡先', note: '位置は、お客様の画面の距離に使います。受け付ける性別と LINE の連絡先もここで決めます（LINE はデモでは空のままで動きます）。' },
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
      <section className={styles.intro} aria-labelledby="onb-title">
        <p className={styles.kicker}>はじめの設定 {current + 1} / {STEPS.length}</p>
        <h1 id="onb-title" className={styles.title}>
          {STEPS[current].title}
        </h1>
        <p className={styles.note}>{STEPS[current].note}</p>
        <ol className={styles.dots} aria-label="設定の進み具合（途中でやめても、次回は続きから始まります）">
          {STEPS.map((s, i) => {
            const state = i < current ? 'done' : i === current ? 'now' : 'todo';
            return (
              <li key={s.title} className={styles.dot} data-state={state} aria-current={state === 'now' ? 'step' : undefined}>
                <span className={styles.dotLabel}>
                  {i + 1}. {s.title}
                  {state === 'done' ? '（済み）' : ''}
                </span>
              </li>
            );
          })}
        </ol>
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
