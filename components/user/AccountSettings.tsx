'use client';

// マイページの「アカウント」：パスワードの変更と、アカウントの削除

import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Sheet from '@/components/Sheet';

const DELETE_ERROR: Record<string, string> = {
  has_active_booking: 'ご予約中は削除できません。来店のあと、またはお店へキャンセルのご連絡をしたあとに、お手続きください。',
  demo_account: 'デモ用のアカウントは削除できません。',
  staff_account: 'サロンのスタッフ・運営のアカウントは、ここでは削除できません。運営へご連絡ください。',
  not_authenticated: 'ログインし直してから、もう一度お試しください。',
};

export default function AccountSettings({ client, hasActiveBooking, onDeleted }: { client: SupabaseClient; hasActiveBooking: boolean; onDeleted: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [agree, setAgree] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setPwMsg({ kind: 'error', text: 'パスワードは8文字以上で入力してください。' });
    if (pw !== pw2) return setPwMsg({ kind: 'error', text: '確認のため、同じパスワードをもう一度入力してください。' });
    setPwBusy(true);
    const { error } = await client.auth.updateUser({ password: pw });
    setPwBusy(false);
    if (error) {
      setPwMsg({ kind: 'error', text: error.message.includes('different') ? '今までと違うパスワードにしてください。' : `変更できませんでした（${error.message}）` });
      return;
    }
    setPw('');
    setPw2('');
    setPwMsg({ kind: 'ok', text: 'パスワードを変更しました。' });
  }

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
    await client.auth.signOut({ scope: 'local' });
    onDeleted();
  }

  return (
    <>
      <h2 className="section-title">アカウント</h2>
      <form className="card" onSubmit={changePassword} noValidate>
        <p className="card-title">パスワードの変更</p>
        <div className="field-row">
          <label className="field">
            <span className="field-label">新しいパスワード</span>
            <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <span className="field-hint">8文字以上</span>
          </label>
          <label className="field">
            <span className="field-label">もう一度</span>
            <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </label>
        </div>
        {pwMsg && <p className={`notice ${pwMsg.kind === 'ok' ? 'notice-ok' : 'notice-error'}`}>{pwMsg.text}</p>}
        <button className="btn btn-secondary btn-block" type="submit" disabled={pwBusy || !pw}>
          {pwBusy ? '変更中…' : 'パスワードを変更'}
        </button>
      </form>

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
