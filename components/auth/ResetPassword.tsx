'use client';

// 再設定のリンクから開く画面：新しいパスワードを決める。
// リンクのログイン情報は利用者の保存先で受け取り、変更が終わったらすぐにログアウトする（サロン・運営のアカウントも同じ手順）

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import AppHeader from '@/components/AppHeader';
import { Loading, NotConfigured } from '@/components/States';
import { useRoleSession } from '@/lib/supabase';

const LOGIN: Record<string, { href: string; label: string }> = {
  user: { href: '/login', label: 'ログインへ' },
  salon: { href: '/salon', label: 'サロンのログインへ' },
  admin: { href: '/admin', label: '運営のログインへ' },
};

export default function ResetPassword({ role }: { role: string }) {
  const { client, session, ready } = useRoleSession('user');
  const [waited, setWaited] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const login = LOGIN[role] ?? LOGIN.user;

  // リンクのログイン情報を読み取るまで、少し待つ
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 2500);
    return () => clearTimeout(t);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!client) return;
    if (pw.length < 8) return setError('パスワードは8文字以上で入力してください。');
    if (pw !== pw2) return setError('確認のため、同じパスワードをもう一度入力してください。');
    setBusy(true);
    setError(null);
    const { error: e2 } = await client.auth.updateUser({ password: pw });
    setBusy(false);
    if (e2) {
      setError(e2.message.includes('different') ? '今までと違うパスワードにしてください。' : `変更できませんでした（${e2.message}）`);
      return;
    }
    if (role !== 'user') await client.auth.signOut({ scope: 'local' });
    setDone(true);
  }

  if (!client) return <NotConfigured />;

  return (
    <main className="app">
      <AppHeader />
      <h1 className="screen-title">新しいパスワード</h1>
      {done ? (
        <section className="card fade-in">
          <p className="card-title">パスワードを変更しました</p>
          <p className="card-sub">新しいパスワードでログインできます。</p>
          <Link href={role === 'user' ? '/' : login.href} className="btn btn-primary btn-block">
            {role === 'user' ? 'ホームへ' : login.label}
          </Link>
        </section>
      ) : !ready || (!session && !waited) ? (
        <Loading rows={2} />
      ) : !session ? (
        <section className="card">
          <p className="card-title">リンクの有効期限が切れています</p>
          <p className="card-sub">お手数ですが、もう一度再設定のメールを送ってください。</p>
          <Link href={`/forgot?role=${role}`} className="btn btn-secondary btn-block">
            再設定のメールを送る
          </Link>
        </section>
      ) : (
        <form className="card" onSubmit={submit} noValidate>
          <div className={`field ${error ? 'has-error' : ''}`}>
            <label className="field-label" htmlFor="pw">
              新しいパスワード<span className="req">必須</span>
            </label>
            <input id="pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <span className="field-hint">8文字以上</span>
          </div>
          <div className={`field ${error ? 'has-error' : ''}`}>
            <label className="field-label" htmlFor="pw2">
              もう一度<span className="req">必須</span>
            </label>
            <input id="pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            {error && (
              <span className="field-error" role="alert">
                {error}
              </span>
            )}
          </div>
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
            {busy ? '変更中…' : 'パスワードを変更する'}
          </button>
        </form>
      )}
    </main>
  );
}
