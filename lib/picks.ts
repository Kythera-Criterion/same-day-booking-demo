// 候補の選び方（画面から切り離した純粋な関数）
//   roles   ：役割の違う3件（いちばん早く始まる・いちばん近い・時間と距離のバランス）【提案】
//   nearest ：近い順の3件
// 同じ枠が複数の役割に当たるときは、次の候補で埋める。「もっと見る」は残りを開始時刻の早い順に。

export type PickMode = 'roles' | 'nearest';
export type PickRole = 'earliest' | 'nearest' | 'balanced';

export type Candidate = { id: string; startMs: number; km: number | null };
export type Picked<T extends Candidate> = T & { role: PickRole | null };

export const ROLE_LABEL: Record<PickRole, string> = {
  earliest: 'いちばん早く始まる',
  nearest: 'いちばん近い',
  balanced: 'もうひとつの候補',
};

const dist = (c: Candidate) => (c.km === null ? Number.POSITIVE_INFINITY : c.km);

function byStart(a: Candidate, b: Candidate) {
  return a.startMs - b.startMs || dist(a) - dist(b) || a.id.localeCompare(b.id);
}
function byDistance(a: Candidate, b: Candidate) {
  return dist(a) - dist(b) || a.startMs - b.startMs || a.id.localeCompare(b.id);
}

export function pickThree<T extends Candidate>(candidates: T[], mode: PickMode = 'roles'): Picked<T>[] {
  if (mode === 'nearest') {
    return [...candidates].sort(byDistance).slice(0, 3).map((c) => ({ ...c, role: null }));
  }

  const used = new Set<string>();
  const out: Picked<T>[] = [];
  const take = (list: T[], role: PickRole) => {
    const c = list.find((x) => !used.has(x.id));
    if (!c) return;
    used.add(c.id);
    out.push({ ...c, role });
  };

  take([...candidates].sort(byStart), 'earliest');
  take([...candidates].sort(byDistance), 'nearest');

  // 時間と距離を、それぞれ候補の中の幅で 0〜1 にそろえて足し、小さいものを選ぶ
  const starts = candidates.map((c) => c.startMs);
  const kms = candidates.map(dist).filter(Number.isFinite);
  const sMin = Math.min(...starts);
  const sSpan = Math.max(...starts) - sMin || 1;
  const kMin = kms.length ? Math.min(...kms) : 0;
  const kSpan = kms.length ? Math.max(...kms) - kMin || 1 : 1;
  const score = (c: Candidate) => (c.startMs - sMin) / sSpan + (Number.isFinite(dist(c)) ? (dist(c) - kMin) / kSpan : 1);
  take([...candidates].sort((a, b) => score(a) - score(b) || byStart(a, b)), 'balanced');

  return out;
}

// 「もっと見る」：選んだ3件以外を、開始時刻の早い順に
export function restByStart<T extends Candidate>(candidates: T[], picked: Candidate[]): T[] {
  const ids = new Set(picked.map((p) => p.id));
  return candidates.filter((c) => !ids.has(c.id)).sort(byStart);
}
