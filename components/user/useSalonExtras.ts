'use client';

// 候補カード・予約の確認で使う、お店の補足（表示だけに使う。読み取りのみ）
//   ・受け付ける性別（「女性限定」などの条件のラベル）
//   ・担当の得意なスタイル（「担当 佐藤（ショートが得意）」）

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export type SalonExtra = { genders: string[]; styles: Record<string, string[]> };

export function useSalonExtras(client: SupabaseClient | null, salonIds: string[]) {
  const [extras, setExtras] = useState<Record<string, SalonExtra>>({});
  const key = [...new Set(salonIds)].sort().join(',');

  useEffect(() => {
    if (!client || !key) return;
    const ids = key.split(',').filter((id) => !(id in extras));
    if (ids.length === 0) return;
    let alive = true;
    (async () => {
      const [{ data: salons }, { data: stylists }] = await Promise.all([
        client.from('salons').select('id,accepts_genders').in('id', ids),
        client.from('stylists').select('salon_id,name,styles').in('salon_id', ids),
      ]);
      if (!alive) return;
      setExtras((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = { genders: [], styles: {} };
        for (const s of (salons ?? []) as { id: string; accepts_genders: string[] | null }[]) next[s.id].genders = s.accepts_genders ?? [];
        for (const st of (stylists ?? []) as { salon_id: string; name: string; styles: string[] | null }[]) {
          if (next[st.salon_id]) next[st.salon_id].styles[st.name] = st.styles ?? [];
        }
        return next;
      });
    })();
    return () => {
      alive = false;
    };
    // extras は追加分の判定にだけ使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);

  return extras;
}

// 「女性限定」「男性限定」（どちらも受け付けるお店は出さない）
export function genderCondition(extra: SalonExtra | undefined): string | null {
  if (!extra || extra.genders.length !== 1) return null;
  return extra.genders[0] === 'female' ? '女性限定' : extra.genders[0] === 'male' ? '男性限定' : null;
}

// 「佐藤（ショートが得意）」
export function stylistLine(name: string | null, extra: SalonExtra | undefined): string | null {
  if (!name) return null;
  const styles = extra?.styles[name] ?? [];
  return styles.length > 0 ? `${name}（${styles.slice(0, 2).join('・')}が得意）` : name;
}
