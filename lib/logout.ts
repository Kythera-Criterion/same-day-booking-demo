import { getClient, type Role } from './supabase';

// ログアウト（どの画面でも同じ手順）
//   1. この端末のログイン情報を消す（ほかの端末のログインはそのまま）
//   2. 通信に失敗しても、この端末に残らないよう保存先から直接消す
//   3. その役割のログインの画面を、読み込み直して開く（開いていたシート・通知・タブなどの状態を残さない）
export const AFTER_LOGOUT: Record<Role, string> = {
  user: '/login?logged_out=1',
  salon: '/salon?logged_out=1',
  admin: '/admin?logged_out=1',
};

export async function logout(role: Role): Promise<void> {
  const client = getClient(role);
  try {
    await client.auth.signOut({ scope: 'local' });
  } catch {
    // 下で保存先から直接消す
  }
  try {
    const key = `demo-${role}-auth`;
    for (const k of Object.keys(window.localStorage)) {
      if (k === key || k.startsWith(`${key}-`)) window.localStorage.removeItem(k);
    }
  } catch {
    // 保存先を使えない環境では、何もしない
  }
  window.location.replace(AFTER_LOGOUT[role]);
}
