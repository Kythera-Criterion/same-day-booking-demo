// 通知の中身を組み立てる（送信処理と、画面の通知ログのプレビューで共通に使う）
// LINE：店舗名・日時・メニュー・金額・お名前のみ（電話番号とメールアドレスは載せない）
// メール：サロン都合のキャンセルのお知らせ（カルテ・写真・位置情報は載せない）

export type NotificationKind = 'booking_created' | 'booking_cancelled' | 'salon_cancel_mail';
export type NotificationChannel = 'line' | 'email';
export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'simulated' | 'failed';

export type NotificationPayload = {
  salon_name: string;
  start_at: string;
  end_at: string;
  menu_name: string;
  price: number;
  customer_name?: string;
  reason?: 'cancelled_by_customer' | 'cancelled_by_salon';
  salon_phone?: string | null;
};

export type OutboxRow = {
  id: number;
  kind: NotificationKind;
  channel: NotificationChannel;
  salon_id: string | null;
  booking_id: string | null;
  recipient: string | null;
  payload: NotificationPayload;
  status: NotificationStatus;
  attempts: number;
  sent_at: string | null;
  last_error: string | null;
  response: Record<string, unknown> | null;
  created_at: string;
};

export type RenderedLine = { channel: 'line'; title: string; text: string };
export type RenderedEmail = { channel: 'email'; subject: string; text: string };
export type Rendered = RenderedLine | RenderedEmail;

const dateFmt = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
});
const timeFmt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });

export function fmtWhen(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  return `${dateFmt.format(start)} ${timeFmt.format(start)}〜${timeFmt.format(new Date(endAt))}`;
}

const REASON_LABEL: Record<string, string> = {
  cancelled_by_customer: 'お客様からのご連絡',
  cancelled_by_salon: 'サロンの都合',
};

export function renderNotification(kind: NotificationKind, p: NotificationPayload): Rendered {
  const when = fmtWhen(p.start_at, p.end_at);
  const price = `¥${Number(p.price).toLocaleString('ja-JP')}`;

  if (kind === 'booking_created') {
    return {
      channel: 'line',
      title: '新しい予約',
      text: [
        '【新しい予約が入りました】',
        `店舗：${p.salon_name}`,
        `日時：${when}`,
        `メニュー：${p.menu_name}`,
        `当日価格：${price}（店頭払い）`,
        `お名前：${p.customer_name ?? ''} 様`,
      ].join('\n'),
    };
  }

  if (kind === 'booking_cancelled') {
    return {
      channel: 'line',
      title: '予約のキャンセル',
      text: [
        '【予約がキャンセルになりました】',
        `店舗：${p.salon_name}`,
        `日時：${when}`,
        `メニュー：${p.menu_name}`,
        `当日価格：${price}`,
        `お名前：${p.customer_name ?? ''} 様`,
        `理由：${REASON_LABEL[p.reason ?? ''] ?? ''}`,
      ].join('\n'),
    };
  }

  return {
    channel: 'email',
    subject: `【${p.salon_name}】ご予約キャンセルのお知らせ`,
    text: [
      `${p.customer_name ?? ''} 様`,
      '',
      `${p.salon_name} のご予約について、サロンの都合によりキャンセルとなりました。`,
      'ご迷惑をおかけし、申し訳ございません。',
      '',
      `日時：${when}`,
      `メニュー：${p.menu_name}`,
      `当日価格：${price}（店頭払いのため、お支払いは発生していません）`,
      '',
      p.salon_phone ? `ご不明な点は、お店へお電話ください（${p.salon_phone}）。` : 'ご不明な点は、お店へお問い合わせください。',
    ].join('\n'),
  };
}

export const STATUS_LABEL: Record<NotificationStatus, string> = {
  pending: '送信待ち',
  sending: '送信中',
  sent: '送信済み',
  simulated: 'シミュレーション送信',
  failed: '送信失敗',
};
