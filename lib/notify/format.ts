// 通知の中身を組み立てる（送信処理と、画面の通知ログのプレビューで共通に使う）
// LINE：店舗名・日時・メニュー・金額・お名前のみ（電話番号とメールアドレスは載せない）
// メール：サロン都合のキャンセルのお知らせ（カルテ・写真・位置情報は載せない）
//       承認したサロンへの「ご利用開始のご案内」（ご利用開始のリンクつき）

export type NotificationKind =
  | 'booking_created'
  | 'booking_cancelled'
  | 'salon_cancel_mail'
  | 'salon_welcome_mail'
  | 'signup_confirm_mail'
  | 'account_exists_mail'
  | 'salon_approved_mail'
  | 'salon_rejected_mail'
  | 'admin_invite_mail'
  | 'password_reset_mail'
  | 'cancel_wait_mail';

// ログイン用のリンク（第三者に渡ると困るもの）を含むメール。実際に送ったあとは、記録からリンクを消す
export const SECRET_LINK_KINDS: NotificationKind[] = ['salon_welcome_mail', 'signup_confirm_mail', 'admin_invite_mail', 'password_reset_mail'];

export const KIND_LABEL: Record<NotificationKind, string> = {
  booking_created: '新しい予約（LINE）',
  booking_cancelled: '予約のキャンセル（LINE）',
  salon_cancel_mail: 'サロン都合のキャンセルのお知らせ',
  salon_welcome_mail: 'ご利用開始のご案内',
  signup_confirm_mail: 'メールアドレスの確認のお願い',
  account_exists_mail: '登録済みのお知らせ',
  salon_approved_mail: '掲載開始のお知らせ',
  salon_rejected_mail: '掲載の見送りのご連絡',
  admin_invite_mail: '運営メンバーへの招待',
  password_reset_mail: 'パスワードの再設定',
  cancel_wait_mail: 'キャンセル待ちのお知らせ（空きが出ました）',
};
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
  // 登録・招待のメール
  role?: 'user' | 'salon' | 'admin';
  display_name?: string;
  login_link?: string;
  reset_link?: string;
  existing?: boolean;
  inviter?: string;
  // ご利用開始のご案内：新規登録でパスワードを決めてある（リンクは「登録の確認」になる）
  password_set?: boolean;
  // キャンセル待ちのお知らせ：空いた枠
  slot_id?: string;
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
  if (kind === 'signup_confirm_mail') return renderSignupConfirm(p);
  if (kind === 'account_exists_mail') return renderAccountExists(p);
  if (kind === 'salon_approved_mail') return renderSalonApproved(p);
  if (kind === 'salon_rejected_mail') return renderSalonRejected(p);
  if (kind === 'admin_invite_mail') return renderAdminInvite(p);
  if (kind === 'password_reset_mail') return renderPasswordReset(p);
  if (kind === 'cancel_wait_mail') return renderCancelWait(p);
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

// キャンセル待ちのお知らせ：登録したお店に、今日の空きが出た（先着順のため、予約は画面から）。
// 予約のページのリンクは、送るとき（サーバー）は APP_URL を前に付ける。画面の通知ログのプレビューでは、パスだけ
function renderCancelWait(p: NotificationPayload): Rendered {
  const when = fmtWhen(p.start_at ?? '', p.end_at ?? '');
  const base = (process.env.APP_URL ?? '').replace(/\/$/, '');
  return {
    channel: 'email',
    subject: `【${p.salon_name}】キャンセル待ちのお店に空きが出ました`,
    text: [
      `${p.display_name ?? ''} 様`,
      '',
      `キャンセル待ちに登録いただいた ${p.salon_name} に、今日の空きが出ました。`,
      '',
      `日時：${when}`,
      `メニュー：${p.menu_name ?? ''}`,
      `当日価格：¥${Number(p.price ?? 0).toLocaleString('ja-JP')}（店頭払い）`,
      '',
      '先着順のため、ほかの方が先に予約されることがあります。ご予約は次のページからどうぞ。',
      p.slot_id ? `${base}/book/${p.slot_id}` : `${base}/`,
      '',
      'このお知らせは1回だけお送りします。もう一度待つときは、画面からキャンセル待ちに登録してください。',
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
    p.password_set
      ? '1. 下記のリンクを開くと、ご登録の確認が済み、サロンの画面にログインします（パスワードは、お申し込みのときに決めたものです）。'
      : '1. 下記のリンクを開き、ログイン用のパスワードを設定してください。',
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
    ? `<p style="margin:24px 0;text-align:center"><a href="${esc(p.invite_link)}" style="display:inline-block;background:#1f6f5c;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px">${p.password_set ? '登録を完了して始める' : 'パスワードを設定して始める'}</a></p>
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
<li>${p.password_set ? '下のボタンから、ご登録を完了してください（そのままサロンの画面にログインします）。' : '下のボタンから、ログイン用のパスワードを設定してください。'}</li>
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

// ---------------------------------------------------------
// 登録・審査・招待のメール（ビジネスメールの形：件名・宛名・挨拶・本文・ボタン・内容・注意・署名）
// ---------------------------------------------------------
type MailSpec = {
  subject: string;
  heading: string;
  to: string[]; // 宛名（1行ずつ）
  intro: string[]; // 本文の段落
  steps?: string[];
  button?: { label: string; href: string | null | undefined; redactedNote?: string };
  table?: [string, string][];
  notes?: string[];
  outro?: string[];
};

function buildMail(spec: MailSpec, redacted = false): RenderedEmail {
  const href = spec.button?.href && !redacted ? spec.button.href : null;
  const linkText = spec.button
    ? href ?? (redacted ? '（送信済みのため、この記録ではリンクを表示しません）' : spec.button.redactedNote ?? '（リンクを作れませんでした。運営事務局へご連絡ください）')
    : null;

  const text = [
    ...spec.to,
    '',
    ...spec.intro.flatMap((p) => [p, '']),
    ...(spec.steps ? ['■ 手順', ...spec.steps.map((s, i) => `${i + 1}. ${s}`), ''] : []),
    ...(spec.button ? [`■ ${spec.button.label}`, `   ${linkText}`, ''] : []),
    ...(spec.table ? ['■ ご登録内容', ...spec.table.map(([k, v]) => `${k}：${v}`), ''] : []),
    ...(spec.notes ? ['■ ご注意', ...spec.notes.map((n) => `・${n}`), ''] : []),
    ...(spec.outro ?? ['ご不明な点がございましたら、運営事務局までお問い合わせください。', '今後とも、どうぞよろしくお願いいたします。']),
    '',
    '――――――――――――――――――――',
    SENDER_NAME,
    '――――――――――――――――――――',
  ].join('\n');

  const button = spec.button
    ? href
      ? `<p style="margin:24px 0;text-align:center"><a href="${esc(href)}" style="display:inline-block;background:#1f6f5c;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px">${esc(spec.button.label)}</a></p>
<p style="font-size:12px;color:#767b77;word-break:break-all">ボタンが開けない場合は、次のリンクをブラウザに貼り付けてください：<br>${esc(href)}</p>`
      : `<p style="font-size:13px;color:#767b77">${esc(linkText ?? '')}</p>`
    : '';

  const html = `<!doctype html><html lang="ja"><body style="margin:0;background:#f5f3ee;font-family:'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif;color:#1a1d1b">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#ffffff;border:1px solid #e6e2d9;border-radius:14px;padding:28px 24px;line-height:1.8;font-size:15px">
<p style="margin:0 0 4px;font-size:13px;color:#767b77">${esc(SERVICE_NAME)}</p>
<h1 style="margin:0 0 20px;font-size:20px">${esc(spec.heading)}</h1>
<p>${spec.to.map(esc).join('<br>')}</p>
${spec.intro.map((p) => `<p>${esc(p)}</p>`).join('\n')}
${spec.steps ? `<h2 style="font-size:15px;margin:24px 0 8px">手順</h2><ol style="padding-left:20px;margin:0">${spec.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
${button}
${spec.table ? `<h2 style="font-size:15px;margin:24px 0 8px">ご登録内容</h2><table style="font-size:14px;border-collapse:collapse">${spec.table.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#767b77">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
${spec.notes ? `<h2 style="font-size:15px;margin:24px 0 8px">ご注意</h2><ul style="padding-left:20px;margin:0;font-size:13px;color:#434845">${spec.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
<p style="margin-top:24px">${(spec.outro ?? ['ご不明な点がございましたら、運営事務局までお問い合わせください。', '今後とも、どうぞよろしくお願いいたします。']).map(esc).join('<br>')}</p>
<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e6e2d9;font-size:13px;color:#767b77">${esc(SENDER_NAME)}</p>
</div></div></body></html>`;

  return { channel: 'email', subject: spec.subject, text, html };
}

function honorific(name: string | undefined): string {
  return name && name.trim() ? `${name.trim()} 様` : 'お客様';
}

function renderSignupConfirm(p: NotificationPayload): RenderedEmail {
  const salon = p.role === 'salon';
  return buildMail(
    {
      subject: `【${SERVICE_NAME}】メールアドレスの確認のお願い${p.resend ? '［再送］' : ''}`,
      heading: 'メールアドレスの確認のお願い',
      to: [honorific(p.display_name)],
      intro: [
        `このたびは「${SERVICE_NAME}」${salon ? 'への掲載のご登録' : 'にご登録いただき'}、誠にありがとうございます。`,
        '登録を完了するため、下のボタンからメールアドレスの確認をお願いいたします。確認が済むと、そのままログインした状態になります。',
        ...(salon ? ['続けて、お店の情報（店名・住所・電話番号など）をご入力ください。運営の審査ののち、掲載を開始します。'] : []),
      ],
      button: { label: 'メールアドレスを確認して登録を完了する', href: p.invite_link },
      table: [['ログイン用メールアドレス', p.email ?? '']],
      notes: [
        'リンクには有効期限があります。期限が切れた場合は、登録の画面から確認メールをもう一度お送りください。',
        'このリンクは、ご本人専用です。第三者へ転送しないでください。',
        'このメールにお心当たりがない場合は、どなたかが誤ってアドレスを入力した可能性があります。お手数ですが破棄してください（確認しない限り、登録は完了しません）。',
      ],
    },
    !!p.link_redacted,
  );
}

function renderAccountExists(p: NotificationPayload): RenderedEmail {
  return buildMail({
    subject: `【${SERVICE_NAME}】このメールアドレスは登録済みです`,
    heading: 'このメールアドレスは登録済みです',
    to: [honorific(p.display_name)],
    intro: [
      `「${SERVICE_NAME}」で、このメールアドレスでの新規登録のお手続きがありました。`,
      'このメールアドレスは、すでに登録されています。新しく登録する必要はありません。次のどちらかの方法でログインしてください。',
    ],
    steps: [
      `ログインの画面から、メールアドレスとパスワードでログインする：${p.login_link ?? ''}`,
      `パスワードをお忘れの場合は、再設定する：${p.reset_link ?? ''}`,
      'Google・Yahoo! JAPAN ID で登録した場合は、ログインの画面で同じ方法を選んでください。',
    ],
    notes: ['このお手続きにお心当たりがない場合は、このメールを破棄してください。アカウントに変更はありません。'],
  });
}

function renderSalonApproved(p: NotificationPayload): RenderedEmail {
  const name = p.contact_name ?? '';
  return buildMail({
    subject: `【${SERVICE_NAME}】掲載を承認しました（掲載開始のお知らせ）`,
    heading: '掲載開始のお知らせ',
    to: [p.salon_name, `${name} 様`],
    intro: [
      `このたびは「${SERVICE_NAME}」への掲載をお申し込みいただき、誠にありがとうございます。`,
      `お申し込みの内容を確認し、${p.salon_name} 様の掲載を承認いたしました。本日から、空いてしまった時間を「当日の空き枠」として公開し、今から行きたいお客様へ届けることができます。`,
    ],
    steps: [
      'サロンの画面にログインしてください（ご登録のメールアドレス、または登録に使った Google・Yahoo! JAPAN ID）。',
      '初期設定（メニューと価格・担当・お店の場所など）が終わっていない場合は、続けて設定してください。',
      '営業の合間に「＋ 枠を出す」から空き枠を公開できます。',
    ],
    button: { label: 'サロンの画面を開く', href: p.login_link },
    table: [
      ['店舗名', p.salon_name],
      ['ご担当者様', `${name} 様`],
      ['ログイン用メールアドレス', p.email ?? ''],
    ],
  });
}

function renderSalonRejected(p: NotificationPayload): RenderedEmail {
  const name = p.contact_name ?? '';
  return buildMail({
    subject: `【${SERVICE_NAME}】掲載のお申し込みについて`,
    heading: '掲載のお申し込みについて',
    to: [p.salon_name, `${name} 様`],
    intro: [
      `このたびは「${SERVICE_NAME}」への掲載をお申し込みいただき、誠にありがとうございます。`,
      'お申し込みの内容を慎重に確認いたしましたが、誠に恐れ入りますが、現時点では掲載を見送らせていただくこととなりました。',
      '実証の対象エリアや受け入れの枠など、運営上の理由によるものです。状況が変わりましたら、改めてご案内することがございます。',
    ],
    outro: ['ご期待に沿えず申し訳ございません。ご不明な点がございましたら、運営事務局までお問い合わせください。'],
  });
}

function renderAdminInvite(p: NotificationPayload): RenderedEmail {
  const existing = !!p.existing;
  return buildMail(
    {
      subject: `【${SERVICE_NAME}】運営メンバーへのご招待${p.resend ? '［再送］' : ''}`,
      heading: '運営メンバーへのご招待',
      to: [honorific(p.display_name)],
      intro: [
        `${p.inviter ? `${p.inviter} さんから、` : ''}「${SERVICE_NAME}」の運営メンバーに招待されました。`,
        existing
          ? '運営の権限をお使いのアカウントに追加しました。いつものメールアドレスとパスワード（または連携した Google・Yahoo! JAPAN ID）で、運営の画面にログインしてください。'
          : '下のボタンから、ログイン用のパスワードを決めてください。設定が済むと、運営の画面を使えるようになります。',
      ],
      button: existing ? { label: '運営の画面を開く', href: p.login_link } : { label: 'パスワードを設定して始める', href: p.invite_link },
      table: [['ログイン用メールアドレス', p.email ?? '']],
      notes: [
        '運営の画面では、サロンとお客様の情報を扱います。端末の画面ロックと、パスワードの管理にご注意ください。',
        ...(existing ? [] : ['リンクには有効期限があります。期限が切れた場合は、招待した運営メンバーに再送を依頼してください。']),
        'このメールにお心当たりがない場合は、お手数ですが破棄してください。',
      ],
    },
    !!p.link_redacted,
  );
}

function renderPasswordReset(p: NotificationPayload): RenderedEmail {
  const where = p.role === 'salon' ? 'サロンの画面' : p.role === 'admin' ? '運営の画面' : 'ログイン';
  return buildMail(
    {
      subject: `【${SERVICE_NAME}】パスワードの再設定`,
      heading: 'パスワードの再設定',
      to: [honorific(p.display_name)],
      intro: [
        `「${SERVICE_NAME}」で、パスワードの再設定のお手続きがありました。`,
        `下のボタンから、新しいパスワードを決めてください。設定が済むと、そのまま${where}を使えます。`,
      ],
      button: { label: '新しいパスワードを決める', href: p.invite_link },
      table: [['ログイン用メールアドレス', p.email ?? '']],
      notes: [
        'リンクには有効期限があり、一度だけ使えます。期限が切れた場合は、もう一度お手続きください。',
        'このメールにお心当たりがない場合は、破棄してください。パスワードは変わりません。',
      ],
    },
    !!p.link_redacted,
  );
}
