// 徒歩の目安（画面から切り離した純粋な関数）。80mを1分として、端末の中だけで計算する
export const WALK_METERS_PER_MIN = 80;

export function walkMinutes(km: number): number {
  return Math.max(1, Math.ceil((km * 1000) / WALK_METERS_PER_MIN));
}

// 「この時刻ごろに出れば間に合う」：開始時刻から、徒歩の時間と余裕（既定5分）を引き、5分単位に切り下げる
export function leaveBy(start: Date, walkMin: number, bufferMin = 5): Date {
  const step = 5 * 60_000;
  const t = start.getTime() - (walkMin + bufferMin) * 60_000;
  return new Date(Math.floor(t / step) * step);
}
