// 外部の ID（Google・Yahoo! JAPAN ID）での登録・ログインで、画面とサーバーの両方が使う定義

export type ProviderId = 'google' | 'yahoo';
export type FlowRole = 'user' | 'salon' | 'admin';
export type FlowMode = 'login' | 'signup' | 'link';

// live：本物の認証画面へ進む（キーを設定済み）／simulated：デモ用の認証画面で試せる（DEMO_MODE でキーが未設定）／off：使えない
export type ProviderState = 'live' | 'simulated' | 'off';
export type Providers = Record<ProviderId, ProviderState>;

export const PROVIDER_IDS: ProviderId[] = ['google', 'yahoo'];

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  google: 'Google',
  yahoo: 'Yahoo! JAPAN ID',
};

// 画面に出すエラーの言葉（?auth_error= で受け取る）
export const AUTH_ERROR: Record<string, string> = {
  denied: '連携がキャンセルされました。もう一度お試しいただくか、メールアドレスで続けてください。',
  expired: '手続きの有効期限が切れました。もう一度お試しください。',
  state_mismatch: '手続きを確認できませんでした。お手数ですが、もう一度最初からお試しください。',
  provider_error: '連携先との通信に失敗しました。少し時間をおいてお試しください。',
  provider_off: 'この方法は、いまは使えません。メールアドレスで続けてください。',
  email_required: 'メールアドレスを取得できませんでした。連携の画面で、メールアドレスの提供を許可してください。',
  email_unverified: '連携先でメールアドレスの確認が済んでいません。確認を済ませてから、もう一度お試しください。',
  not_admin: 'このアカウントは運営メンバーとして登録されていません。運営メンバーの登録は、既存の運営からの招待で行います。',
  account_exists: 'このメールアドレスはすでに登録されています。メールアドレスとパスワードでログインしてから、マイページで連携してください。',
  already_linked_other: 'この外部のアカウントは、別のアカウントに連携済みです。',
  link_session: 'ログインし直してから、もう一度お試しください。',
  rate_limited: '短い時間に何度も試されたため、しばらくお待ちください。',
  session_failed: 'ログインを完了できませんでした。もう一度お試しください。',
};

// 画面の中の移動先として使ってよいパス（外部のサイトへの転送を防ぐ）
export function safePath(path: unknown, fallback = '/'): string {
  if (typeof path !== 'string') return fallback;
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\') || path.length > 300) return fallback;
  return path;
}

// デモ用の認証画面で使えるメールアドレス（実在しない、例示用のドメインだけ）
export function isDemoEmail(email: string): boolean {
  return /^[^@\s]+@([a-z0-9-]+\.)*(example\.(com|jp|net|org)|[a-z0-9-]+\.test)$/i.test(email.trim());
}
