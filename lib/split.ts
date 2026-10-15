// 空いた時間を、メニューの所要時間に合わせて枠に切り分ける（画面から切り離した純粋な関数）
// 例：12:00〜13:30 が空いた → 60分のカットなら 12:00 の1枠、15分の前髪カットなら 12:00・12:15・… の6枠
// 出せない枠（受付の締切を過ぎる・9時より前・今日を超える）は、理由を付けて返す

const MINUTE = 60_000;
const JST = 9 * 60 * MINUTE;

export type SplitProblem = 'too_late' | 'outside_hours' | 'today_only';
export type SplitSlot = { start: Date; end: Date; problem: SplitProblem | null };

export type SplitInput = {
  freeStart: Date;
  freeEnd: Date;
  durationMin: number;
  deadlineMin: number;
  now: Date;
  stepMin?: number;
  maxSlots?: number;
  // true（既定）なら、受付の締切に間に合う最初の時刻から並べる（空き始めの、もう予約を受けられない時間は使わない）
  fromBookable?: boolean;
};

function ceilTo(ms: number, stepMin: number) {
  const step = stepMin * MINUTE;
  return Math.ceil(ms / step) * step;
}

function jstDayEnd(now: Date) {
  const j = new Date(now.getTime() + JST);
  return Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + 1) - JST;
}

function jstHour(ms: number) {
  return new Date(ms + JST).getUTCHours();
}

export function problemOf(startMs: number, deadlineMin: number, now: Date): SplitProblem | null {
  if (startMs >= jstDayEnd(now)) return 'today_only';
  if (startMs - deadlineMin * MINUTE <= now.getTime() + 30 * 1000) return 'too_late';
  if (jstHour(startMs) < 9) return 'outside_hours';
  return null;
}

export function splitFreeTime({ freeStart, freeEnd, durationMin, deadlineMin, now, stepMin = 5, maxSlots = 24, fromBookable = true }: SplitInput): SplitSlot[] {
  if (durationMin <= 0 || freeEnd.getTime() <= freeStart.getTime()) return [];
  const out: SplitSlot[] = [];
  const earliest = fromBookable ? now.getTime() + deadlineMin * MINUTE + MINUTE : freeStart.getTime();
  let t = ceilTo(Math.max(freeStart.getTime(), earliest), stepMin);
  while (t + durationMin * MINUTE <= freeEnd.getTime() && out.length < maxSlots) {
    out.push({ start: new Date(t), end: new Date(t + durationMin * MINUTE), problem: problemOf(t, deadlineMin, now) });
    t += durationMin * MINUTE;
  }
  return out;
}

export const SPLIT_PROBLEM_LABEL: Record<SplitProblem, string> = {
  too_late: '受付の締切を過ぎます',
  outside_hours: '9時より前です',
  today_only: '今日中に収まりません',
};
