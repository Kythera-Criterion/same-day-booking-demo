// 画面の【提案】部分の切り替え（.env.local の NEXT_PUBLIC_* で変え、ビルドし直すと反映される）
import type { PickMode } from './picks';

export const UI_OPTIONS = {
  // 候補3件の選び方：roles＝役割の違う3件【提案】／ nearest＝近い順の3件
  pickMode: (process.env.NEXT_PUBLIC_PICK_MODE === 'nearest' ? 'nearest' : 'roles') as PickMode,
  // 予約確定画面の「○時○分ごろに出れば間に合います」【提案】
  showDeparture: process.env.NEXT_PUBLIC_SHOW_DEPARTURE !== 'false',
  // 予約番号（利用者・サロンの両方）【提案】
  showBookingNo: process.env.NEXT_PUBLIC_SHOW_BOOKING_NO !== 'false',
  // 空きがないときの「空きが出たらお知らせします」【提案】
  emptyWatch: process.env.NEXT_PUBLIC_EMPTY_WATCH !== 'false',
  // サロンの画面上部の「今日、空き時間から生まれた予約」【提案】
  salonAchievement: process.env.NEXT_PUBLIC_SALON_ACHIEVEMENT !== 'false',
  // 来店の記録がまだの予約を知らせるまでの分数（仮の値）
  overdueMinutes: Number(process.env.NEXT_PUBLIC_OVERDUE_MINUTES || 15),
};
