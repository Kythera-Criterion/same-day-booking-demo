// 通知の中身を組み立てる（送信処理と、画面の通知ログのプレビューで共通に使う）
// LINE：店舗名・日時・メニュー・金額・お名前のみ（電話番号とメールアドレスは載せない）
// メール：サロン都合のキャンセルのお知らせ（カルテ・写真・位置情報は載せない）
//       承認したサロンへの「ご利用開始のご案内」（ご利用開始のリンクつき）

export type NotificationKind = 'booking_created' | 'booking_cancelled' | 'salon_cancel_mail' | 'salon_welcome_mail';
export type NotificationChannel = 'line' | 'email';
export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'simulated' | 'failed';

export type NotificationPayload = {
  salon_name: string;
  start_at?: string;
  end_at?: string;
  menu_name?: string;
  price?: number;
  customer_name?: string;
  reason?: 'cancelled_by_customer' | 'cancelled_by_salon';
  salon_phone?: string | null;
  // ご利用開始のご案内
  contact_name?: string;
  email?: string;
  invite_link?: string | null;
  link_redacted?: boolean;
  resend?: boolean;
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
export type RenderedEmail = { channel: 'email'; subject: string; text: string; html?: string };
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
  if (kind === 'salon_welcome_mail') return renderWelcome(p);
  const when = fmtWhen(p.start_at ?? '', p.end_at ?? '');
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

// ---------------------------------------------------------
// 承認したサロンへの「ご利用開始のご案内」（一般的なビジネスメールの形：件名・宛名・挨拶・本文・手順・登録内容・注意・署名）
// 文面は仮置き。サービス名・問い合わせ先が決まったら、ここを書き換える
// ---------------------------------------------------------
export const SERVICE_NAME = '当日予約デモ';
export const SENDER_NAME = '当日予約デモ 運営事務局';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderWelcome(p: NotificationPayload): RenderedEmail {
  const name = p.contact_name ?? '';
  const salon = p.salon_name;
  const link = p.link_redacted ? '（送信済みのため、この記録ではリンクを表示しません）' : (p.invite_link ?? '（リンクを作れませんでした。運営事務局へご連絡ください）');
  const subject = `【${SERVICE_NAME}】掲載のお申し込みありがとうございます（ご利用開始のご案内）${p.resend ? '［再送］' : ''}`;

  const text = [
    `${salon}`,
    `${name} 様`,
    '',
    `このたびは「${SERVICE_NAME}」への掲載をお申し込みいただき、誠にありがとうございます。`,
    `${SERVICE_NAME} 運営事務局です。`,
    '',
    `お申し込みの内容を確認し、${salon} 様の掲載を承認いたしました。`,
    '本日から、空いてしまった時間を「当日の空き枠」として公開し、今から行きたいお客様へ届けることができます。',
    '以下の手順で、ご利用を開始してください。',
    '',
    '■ ご利用開始の手順（数分で終わります）',
    '1. 下記のリンクを開き、ログイン用のパスワードを設定してください。',
    `   ${link}`,
    '2. 続けて表示される3つの初期設定（メニューと価格・担当・お店の場所など）を行ってください。',
    '3. 設定が終わったら、営業の合間に「＋ 枠を出す」から空き枠を公開できます。',
    '',
    '■ ご登録内容',
    `店舗名　　　　　　　：${salon}`,
    `ご担当者様　　　　　：${name} 様`,
    `ログイン用メールアドレス：${p.email ?? ''}`,
    '',
    '■ ご注意',
    '・このリンクは、ご担当者様専用です。第三者へ転送しないでください。',
    '・リンクには有効期限があります。期限が切れた場合は、運営事務局へご連絡ください。新しいリンクをお送りします。',
    '・このメールにお心当たりがない場合は、お手数ですが破棄してください。',
    '',
    'ご不明な点がございましたら、運営事務局までお気軽にお問い合わせください。',
    '今後とも、どうぞよろしくお願いいたします。',
    '',
    '――――――――――――――――――――',
    SENDER_NAME,
    '――――――――――――――――――――',
  ].join('\n');

  const button = p.invite_link && !p.link_redacted
    ? `<p style="margin:24px 0;text-align:center"><a href="${esc(p.invite_link)}" style="display:inline-block;background:#1f6f5c;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px">パスワードを設定して始める</a></p>
<p style="font-size:12px;color:#767b77;word-break:break-all">ボタンが開けない場合は、次のリンクをブラウザに貼り付けてください：<br>${esc(p.invite_link)}</p>`
    : `<p style="font-size:13px;color:#767b77">${esc(link)}</p>`;

  const html = `<!doctype html><html lang="ja"><body style="margin:0;background:#f5f3ee;font-family:'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif;color:#1a1d1b">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#ffffff;border:1px solid #e6e2d9;border-radius:14px;padding:28px 24px;line-height:1.8;font-size:15px">
<p style="margin:0 0 4px;font-size:13px;color:#767b77">${esc(SERVICE_NAME)}</p>
<h1 style="margin:0 0 20px;font-size:20px">ご利用開始のご案内</h1>
<p>${esc(salon)}<br>${esc(name)} 様</p>
<p>このたびは「${esc(SERVICE_NAME)}」への掲載をお申し込みいただき、誠にありがとうございます。<br>${esc(SERVICE_NAME)} 運営事務局です。</p>
<p>お申し込みの内容を確認し、${esc(salon)} 様の掲載を承認いたしました。本日から、空いてしまった時間を「当日の空き枠」として公開し、今から行きたいお客様へ届けることができます。</p>
<h2 style="font-size:15px;margin:24px 0 8px">ご利用開始の手順（数分で終わります）</h2>
<ol style="padding-left:20px;margin:0">
<li>下のボタンから、ログイン用のパスワードを設定してください。</li>
<li>続けて表示される3つの初期設定（メニューと価格・担当・お店の場所など）を行ってください。</li>
<li>設定が終わったら、営業の合間に「＋ 枠を出す」から空き枠を公開できます。</li>
</ol>
${button}
<h2 style="font-size:15px;margin:24px 0 8px">ご登録内容</h2>
<table style="font-size:14px;border-collapse:collapse">
<tr><td style="padding:2px 16px 2px 0;color:#767b77">店舗名</td><td>${esc(salon)}</td></tr>
<tr><td style="padding:2px 16px 2px 0;color:#767b77">ご担当者様</td><td>${esc(name)} 様</td></tr>
<tr><td style="padding:2px 16px 2px 0;color:#767b77">ログイン用メールアドレス</td><td>${esc(p.email ?? '')}</td></tr>
</table>
<h2 style="font-size:15px;margin:24px 0 8px">ご注意</h2>
<ul style="padding-left:20px;margin:0;font-size:13px;color:#434845">
<li>このリンクは、ご担当者様専用です。第三者へ転送しないでください。</li>
<li>リンクには有効期限があります。期限が切れた場合は、運営事務局へご連絡ください。新しいリンクをお送りします。</li>
<li>このメールにお心当たりがない場合は、お手数ですが破棄してください。</li>
</ul>
<p style="margin-top:24px">ご不明な点がございましたら、運営事務局までお気軽にお問い合わせください。<br>今後とも、どうぞよろしくお願いいたします。</p>
<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e6e2d9;font-size:13px;color:#767b77">${esc(SENDER_NAME)}</p>
</div></div></body></html>`;

  return { channel: 'email', subject, text, html };
}
