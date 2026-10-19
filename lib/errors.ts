// データベースの関数が返すエラーを、画面に出す言葉に置き換える
const MESSAGES: Record<string, string> = {
  already_booked: 'この枠は直前にほかの方の予約が入りました。別の枠をお選びください。',
  has_active_booking: 'ご予約中の枠があります。同時にお持ちいただける予約は1件までです。',
  too_late: '受付の締切を過ぎた枠です。',
  suspended: '無断キャンセルが続いたため、現在は新しい予約をお受けできません。',
  not_accepted: 'このサロンでは、この枠をご予約いただけません。',
  adult_required: 'ご利用は18歳以上の方に限ります。',
  phone_required: '予約には電話番号の登録が必要です。マイページで登録してください。',
  invalid_photo: '写真を添えられませんでした。もう一度お試しください。',
  not_authenticated: 'ログインしてください。',
  profile_missing: 'プロフィールが見つかりません。',
  slot_not_found: 'この枠は予約できなくなりました（お店の受付の終了・掲載の停止など）。別の枠をお選びください。',
  slot_closed: 'この枠は、お店が受付を終えました。別の枠をお選びください。',
  booking_not_found: '予約が見つかりませんでした。',
  forbidden: 'この操作の権限がありません。',
  overlap: '同じ美容師の時間が重なる枠があります。',
  today_only: '今日の枠だけ扱えます。',
  outside_hours: '9時より前の枠は出せません。',
  not_started: '予約時刻を過ぎてから記録できます。',
  already_closed: 'この予約はすでに処理済みです。',
  not_open: 'この枠は取り下げられません。',
  menu_not_found: 'メニューが見つかりません。',
  stylist_not_found: '担当の美容師が見つかりません。',
  stylist_has_slots: '今日、この美容師の公開中の枠か、まだ来店していない予約があります。枠を取り下げるか担当を変えてから、削除してください。',
  too_many_inquiries: '問い合わせは1日10件までです。続きは明日お送りいただくか、お電話でお問い合わせください。',
  inquiry_not_found: '問い合わせが見つかりません。',
  menu_has_slots: '今日、このメニューの公開中の枠か、まだ来店していない予約があります。枠を取り下げてから、削除してください。',
  invalid_action: 'この操作は行えません。',
  invalid_input: '入力内容をご確認ください。',
  salon_not_listed: '掲載中になると枠を出せます（審査中・掲載停止中は出せません）。',
  already_registered: 'このアカウントは、すでにお店を登録済みです。',
  application_pending: '審査中のお申し込みがあります。運営の確認が終わるまでお待ちください（結果はメールでお知らせします）。',
  application_rejected: '掲載を見送ったお店です。',
  menu_required: '受付中のメニューを1つ以上登録すると、設定を終えられます。',
  address_required: 'お店の住所と場所を保存すると、設定を終えられます（利用者の画面の地図と距離に使います）。',
  cannot_remove_self: '自分自身は外せません。',
  last_admin: '運営メンバーが1人だけのため、外せません。',
  not_found: '見つかりませんでした。',
};

export function errorCode(err: unknown): string | null {
  const raw =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err);
  return Object.keys(MESSAGES).find((key) => raw.includes(key)) ?? null;
}

export function toMessage(err: unknown): string {
  const code = errorCode(err);
  if (code) return MESSAGES[code];
  const raw =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err);
  return `エラーが発生しました（${raw}）`;
}
