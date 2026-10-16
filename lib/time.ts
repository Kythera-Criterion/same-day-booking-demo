// 時刻はすべて日本時間で判定する（利用者の端末の時刻設定に左右されないように）
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

export type WindowKey = 'now' | '1h' | '3h' | 'today';

export const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: 'now', label: '今すぐ' },
  { key: '1h', label: '1時間以内' },
  { key: '3h', label: '3時間以内' },
  { key: 'today', label: '今日中' },
];

// 「今すぐ」は30分以内として扱う
const WINDOW_MINUTES: Record<WindowKey, number | null> = {
  now: 30,
  '1h': 60,
  '3h': 180,
  today: null,
};

function jstParts(now: Date) {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return { y: jst.getUTCFullYear(), m: jst.getUTCMonth(), d: jst.getUTCDate() };
}

export function jstTodayStart(now = new Date()): Date {
  const { y, m, d } = jstParts(now);
  return new Date(Date.UTC(y, m, d) - JST_OFFSET_MS);
}

export function jstTodayEnd(now = new Date()): Date {
  const { y, m, d } = jstParts(now);
  return new Date(Date.UTC(y, m, d + 1) - JST_OFFSET_MS);
}

// 日本時間の日付（例：2026-10-16）。日付が変わったかどうかを見るのに使う
export function jstDateKey(now = new Date()): string {
  const { y, m, d } = jstParts(now);
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function jstHour(date: Date): number {
  return new Date(date.getTime() + JST_OFFSET_MS).getUTCHours();
}

// 選んだ時間帯の終わり（今日の終わりを超えない）
export function windowEnd(key: WindowKey, now = new Date()): Date {
  const end = jstTodayEnd(now);
  const minutes = WINDOW_MINUTES[key];
  if (minutes === null) return end;
  const t = new Date(now.getTime() + minutes * MINUTE);
  return t < end ? t : end;
}

// 予約を受け付ける最も早い開始時刻（開始10分前まで）
export function earliestBookable(now = new Date()): Date {
  return new Date(now.getTime() + 10 * MINUTE);
}

export function fmtTime(value: string | Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function minutesUntil(value: string | Date, now = new Date()): number {
  return Math.round((new Date(value).getTime() - now.getTime()) / MINUTE);
}

// 「あと○分」「あと1時間5分」
export function fmtRemaining(minutes: number): string {
  if (minutes <= 0) return 'まもなく';
  if (minutes < 60) return `あと${minutes}分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `あと${h}時間` : `あと${h}時間${m}分`;
}

const dateFmt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' });

// 「10月15日(木)」
export function fmtDate(value: string | Date): string {
  return dateFmt.format(new Date(value));
}

export function fmtYen(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`;
}

export function fmtUntil(minutes: number): string {
  if (minutes < 60) return `${minutes}分後`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}時間後` : `${h}時間${m}分後`;
}

// 「○分後」の開始時刻（5分単位に切り上げ）
export function startAfter(minutes: number, now = new Date()): Date {
  const step = 5 * MINUTE;
  return new Date(Math.ceil((now.getTime() + minutes * MINUTE) / step) * step);
}

// その開始時刻で枠を出せるか（今日・9時以降・受付の締切がまだ先）。理由を返す
export function slotStartProblem(start: Date, deadlineMin: number, now = new Date()): string | null {
  if (start.getTime() >= jstTodayEnd(now).getTime()) return '今日中に収まりません';
  if (jstHour(start) < 9) return '9時より前です';
  if (start.getTime() - deadlineMin * MINUTE <= now.getTime() + 30 * 1000) return '受付の締切を過ぎます';
  return null;
}

// 日本時間の「時」と「分」を、0時からの分数で
export function jstMinuteOfDay(value: string | Date): number {
  const d = new Date(new Date(value).getTime() + JST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// サロンが枠を出すときの開始時刻の候補（15分刻み、今から15分以上先、今日中、9時以降）
export function startTimeOptions(now = new Date(), count = 8): Date[] {
  const step = 15 * MINUTE;
  const end = jstTodayEnd(now).getTime();
  const options: Date[] = [];
  let t = Math.ceil((now.getTime() + 15 * MINUTE) / step) * step;
  while (options.length < count && t < end) {
    const d = new Date(t);
    if (jstHour(d) >= 9) options.push(d);
    t += step;
  }
  return options;
}
