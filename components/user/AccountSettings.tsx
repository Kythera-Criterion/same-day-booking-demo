'use client';

// マイページの「アカウント」：ログインの方法（パスワード・Google・Yahoo! JAPAN ID の連携）と、アカウントの削除

import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Sheet from '@/components/Sheet';
import AccountSecurity from '@/components/auth/AccountSecurity';
import Button from '@/components/ui/Button';
import { Check } from '@/components/ui/Form';
import { Pair } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { ShieldCheck, Trash, WarningCircle } from '@/components/ui/icons';
import type { Providers } from '@/lib/oauth-shared';
import s from './AccountSettings.module.css';

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
    <section className={s.section}>
      <SectionHead icon={ShieldCheck} title="アカウント" id="account" />
      <div className={s.panels}>
        <AccountSecurity client={client} role="user" providers={providers} returnPath="/mypage" linked={linked} authError={authError} />

        <Panel as="section">
          <div className={s.body}>
            <SectionHead icon={Trash} title="アカウントの削除" as="p" />
            <SubText>{hasActiveBooking ? 'ご予約中は削除できません。来店のあとに、お手続きください。' : '削除すると、元に戻せません。'}</SubText>
            <Button variant="danger" size="md" block icon={Trash} disabled={hasActiveBooking} onClick={() => setConfirming(true)}>
              アカウントを削除する
            </Button>
          </div>
        </Panel>
      </div>

      {confirming && (
        <Sheet label="アカウントを削除しますか" role="alertdialog" narrow onClose={() => setConfirming(false)}>
          <div className={s.sheet}>
            <SectionHead icon={WarningCircle} title="アカウントを削除しますか？" as="p" />
            <ul className={s.list}>
              <li>プロフィール・カルテ・会話の好み・ヘア写真を削除します。</li>
              <li>Google・Yahoo! JAPAN ID との連携も解除されます。</li>
              <li>ご予約のときにお店へお伝えした内容は、お店の記録として残ります。</li>
              <li>無断キャンセルの記録は、規約に基づき電話番号に紐づけて90日間残ります。</li>
              <li>同じメールアドレスで、もう一度登録できます。</li>
            </ul>
            <Check checked={agree} onChange={setAgree}>
              上の内容を確認しました
            </Check>
            {delError && (
              <Notice tone="danger" role="alert">
                {delError}
              </Notice>
            )}
            <Pair>
              <Button variant="quiet" size="md" onClick={() => setConfirming(false)}>
                やめる
              </Button>
              <Button variant="dangerSolid" size="md" disabled={!agree || delBusy} onClick={deleteAccount}>
                {delBusy ? '削除中…' : '削除する'}
              </Button>
            </Pair>
          </div>
        </Sheet>
      )}
    </section>
  );
}
