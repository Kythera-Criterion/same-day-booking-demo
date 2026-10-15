'use client';

// マイページの「アカウント」：ログインの方法（パスワード・Google・Yahoo! JAPAN ID の連携）と、アカウントの削除

import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Sheet from '@/components/Sheet';
import AccountSecurity from '@/components/auth/AccountSecurity';
import type { Providers } from '@/lib/oauth-shared';

const DELETE_ERROR: Record<string, string> = {
  has_active_booking: 'ご予約中は削除できません。来店のあと、またはお店へキャンセルのご連絡をしたあとに、お手続きください。',
  demo_account: 'デモ用のアカウントは削除できません。',
  staff_account: 'サロンのスタッフ・運営のアカウントは、ここでは削除できません。運営へご連絡ください。',
  not_authenticated: 'ログインし直してから、もう一度お試しください。',
};

export default function AccountSettings({
  client,
  hasActiveBooking,
  onDeleted,
  providers,
  linked,
  authError,
}: {
  client: SupabaseClient;
  hasActiveBooking: boolean;
  onDeleted: () => void;
  providers: Providers;
  linked?: string | null;
  authError?: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [agree, setAgree] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  async function deleteAccount() {
    setDelBusy(true);
    setDelError(null);
    const token = (await client.auth.getSession()).data.session?.access_token;
    const res = await fetch('/api/account/delete', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setDelBusy(false);
    if (!res.ok) {
      setDelError(DELETE_ERROR[body.error ?? ''] ?? `削除できませんでした（${body.error ?? res.status}）`);
      return;
    }
    // 先に「削除しました」の表示に切り替えてから、この端末のログイン情報を消す（ログインの画面へ飛ばさない）
    onDeleted();
    await client.auth.signOut({ scope: 'local' });
  }

  return (
    <>
      <h2 className="section-title" id="account">
        アカウント
      </h2>
      <AccountSecurity client={client} role="user" providers={providers} returnPath="/mypage" linked={linked} authError={authError} />

      <section className="card danger-zone">
        <p className="card-title">アカウントの削除</p>
        <p className="card-sub">
          {hasActiveBooking ? 'ご予約中は削除できません。来店のあとに、お手続きください。' : '削除すると、元に戻せません。'}
        </p>
        <button className="btn btn-danger btn-block" disabled={hasActiveBooking} onClick={() => setConfirming(true)}>
          アカウントを削除する
        </button>
      </section>

      {confirming && (
        <Sheet label="アカウントを削除しますか" role="alertdialog" narrow onClose={() => setConfirming(false)}>
          <p className="card-title">アカウントを削除しますか？</p>
          <ul className="delete-list">
            <li>プロフィール・カルテ・会話の好み・ヘア写真を削除します。</li>
            <li>Google・Yahoo! JAPAN ID との連携も解除されます。</li>
            <li>ご予約のときにお店へお伝えした内容は、お店の記録として残ります。</li>
            <li>無断キャンセルの記録は、規約に基づき電話番号に紐づけて90日間残ります。</li>
            <li>同じメールアドレスで、もう一度登録できます。</li>
          </ul>
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>上の内容を確認しました</span>
          </label>
          {delError && (
            <p className="notice notice-error" role="alert">
              {delError}
            </p>
          )}
          <div className="action-pair">
            <button className="btn btn-quiet" onClick={() => setConfirming(false)}>
              やめる
            </button>
            <button className="btn btn-danger" disabled={!agree || delBusy} onClick={deleteAccount}>
              {delBusy ? '削除中…' : '削除する'}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
