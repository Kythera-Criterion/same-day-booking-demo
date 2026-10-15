// データベースの関数が返すエラーを、画面に出す言葉に置き換える
const MESSAGES: Record<string, string> = {
  already_booked: 'この枠は直前にほかの方の予約が入りました。別の枠をお選びください。',
  too_late: '開始10分前を過ぎた枠は予約できません。',
  suspended: '無断キャンセルが続いたため、現在は新しい予約をお受けできません。',
  not_accepted: 'このサロンでは、この枠をご予約いただけません。',
  not_authenticated: 'ログインしてください。',
  profile_missing: 'プロフィールが見つかりません。',
  slot_not_found: '枠が見つかりませんでした。',
  forbidden: 'この操作の権限がありません。',
  overlap: '同じ美容師の時間が重なる枠があります。',
  today_only: '今日の枠だけ出せます。',
  outside_hours: '9時より前の枠は出せません。',
  not_started: '予約時刻を過ぎてから記録できます。',
  already_closed: 'この予約はすでに処理済みです。',
  not_open: 'この枠は取り下げられません。',
  menu_not_found: 'メニューが見つかりません。',
};

export function toMessage(err: unknown): string {
  const raw =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err);
  for (const key of Object.keys(MESSAGES)) {
    if (raw.includes(key)) return MESSAGES[key];
  }
  return `エラーが発生しました（${raw}）`;
}
