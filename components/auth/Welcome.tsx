'use client';

// 招待・ご利用開始のメールのリンクから開く画面
//   サロンのスタッフ（承認した掲載希望の「ご利用開始のご案内」）と、運営メンバー（「運営メンバーへのご招待」、role=admin）
//   1. リンクを確かめて、その役割の画面のログイン状態にする
//   2. ログイン用のパスワードを決める（招待のとき）
//   3. 画面へ進む（サロンは、初めてなら3つの初期設定から）

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import AppHeader from '@/components/AppHeader';
import { Loading, NotConfigured } from '@/components/States';
import PasswordInput from '@/components/auth/PasswordInput';
import { isConfigured, getClient } from '@/lib/supabase';

type Phase = 'checking' | 'password' | 'ready' | 'invalid';

export default function Welcome({ tokenHash, type, role: roleParam }: { tokenHash: string | null; type: string | null; role?: string | null }) {
  const role = roleParam === 'admin' ? 'admin' : 'salon';
  const isAdmin = role === 'admin';
  const home = isAdmin ? '/admin' : '/salon';
  const [phase, setPhase] = useState<Phase>('checking');
  const [salonName, setSalonName] = useState<string | null>(null);
  const [email, setEmail] = useState<string>('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!isConfigured || started.current) return;
    started.current = true;
    (async () => {
      const client = getClient(role);
      if (!tokenHash || (type !== 'invite' && type !== 'magiclink')) {
        setPhase('invalid');
        return;
      }
      const { data, error: e } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
      // リンクの情報を URL に残さない
      window.history.replaceState(null, '', isAdmin ? '/welcome?role=admin' : '/welcome');
      if (e || !data.session) {
        // すでに使ったリンクでも、ログインできていれば、そのまま進める
        const { data: s } = await client.auth.getSession();
        if (s.session) {
          setEmail(s.session.user.email ?? '');
          setPhase('ready');
        } else {
          setPhase('invalid');
        }
        return;
      }
      setEmail(data.session.user.email ?? '');
      if (!isAdmin) {
        const { data: member } = await client
          .from('salon_members')
          .select('salons(name)')
          .eq('user_id', data.session.user.id)
          .limit(1)
          .maybeSingle();
        const salon = member?.salons as { name: string } | { name: string }[] | null | undefined;
        setSalonName(Array.isArray(salon) ? (salon[0]?.name ?? null) : (salon?.name ?? null));
      }
      setPhase(type === 'invite' ? 'password' : 'ready');
    })();
  }, [tokenHash, type, role, isAdmin]);

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setError('パスワードは8文字以上で入力してください。');
    if (pw !== pw2) return setError('確認のため、同じパスワードをもう一度入力してください。');
    setBusy(true);
    setError(null);
    const { error: e2 } = await getClient(role).auth.updateUser({ password: pw });
    setBusy(false);
    if (e2) {
      setError(`パスワードを設定できませんでした（${e2.message}）`);
      return;
    }
    setPhase('ready');
  }

  if (!isConfigured) return <NotConfigured />;

  return (
    <main className="app">
      <AppHeader role={isAdmin ? '運営' : 'サロン'} home={home} />
      {phase === 'checking' && (
        <>
          <p className="card-sub" style={{ textAlign: 'center' }}>
            リンクを確かめています…
          </p>
          <Loading rows={2} />
        </>
      )}

      {phase === 'invalid' && (
        <section className="card">
          <p className="card-title">このリンクは使えません</p>
          <p className="card-sub">
            {isAdmin
              ? '有効期限が切れたか、すでに使われたリンクです。招待した運営メンバーに、招待の再送を依頼してください。パスワードを設定済みの方は、運営の画面からログインできます。'
              : '有効期限が切れたか、すでに使われたリンクです。お手数ですが、運営事務局へご連絡ください。新しいリンクをお送りします。パスワードを設定済みの方は、サロンの画面からログインできます。'}
          </p>
          <Link href={home} className="btn btn-secondary btn-block">
            {isAdmin ? '運営のログインへ' : 'サロンのログインへ'}
          </Link>
        </section>
      )}

      {phase === 'password' && (
        <form className="card fade-in" onSubmit={savePassword} noValidate>
          <p className="welcome-kicker">ようこそ</p>
          <h1 className="screen-title" style={{ margin: '0 0 6px' }}>
            {isAdmin ? '運営メンバーへのご招待' : salonName ? `${salonName} 様` : 'ご利用開始の手続き'}
          </h1>
          <p className="card-sub">
            {isAdmin ? '運営メンバーに招待されました。' : '掲載が承認されました。'}はじめに、ログイン用のパスワードを決めてください。ログイン用メールアドレスは <strong className="break">{email}</strong> です。
          </p>
          <div className={`field ${error ? 'has-error' : ''}`}>
            <label className="field-label" htmlFor="pw">
              パスワード<span className="req">必須</span>
            </label>
            <PasswordInput id="pw" isNew value={pw} onChange={setPw} />
            <span className="field-hint">8文字以上</span>
          </div>
          <div className={`field ${error ? 'has-error' : ''}`}>
            <label className="field-label" htmlFor="pw2">
              もう一度<span className="req">必須</span>
            </label>
            <PasswordInput id="pw2" autoComplete="new-password" value={pw2} onChange={setPw2} />
            {error && (
              <span className="field-error" role="alert">
                {error}
              </span>
            )}
          </div>
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
            {busy ? '設定中…' : 'パスワードを設定して次へ'}
          </button>
        </form>
      )}

      {phase === 'ready' && isAdmin && (
        <section className="card fade-in">
          <p className="welcome-kicker">準備ができました</p>
          <h1 className="screen-title" style={{ margin: '0 0 6px' }}>
            運営の画面を使えます
          </h1>
          <p className="card-sub">
            次回からは、運営の画面でメールアドレスとパスワードでログインしてください。「運営メンバー」のタブで、Google・Yahoo! JAPAN ID との連携もできます。
          </p>
          <Link href="/admin" className="btn btn-primary btn-lg btn-block">
            運営の画面へ進む
          </Link>
        </section>
      )}

      {phase === 'ready' && !isAdmin && (
        <section className="card fade-in">
          <p className="welcome-kicker">準備ができました</p>
          <h1 className="screen-title" style={{ margin: '0 0 6px' }}>
            {salonName ? `${salonName} 様` : 'ようこそ'}
          </h1>
          <p className="card-sub">
            続けて、3つの初期設定（メニューと価格・担当・お店の場所など）を行ってください。数分で終わります。設定が終わると、空いた時間を枠として公開できます。
          </p>
          <ol className="welcome-steps">
            <li>メニューと価格・受付の締切</li>
            <li>担当</li>
            <li>お店の場所・受け付ける性別・LINE の連絡先</li>
          </ol>
          <Link href="/salon" className="btn btn-primary btn-lg btn-block">
            サロンの画面へ進む
          </Link>
        </section>
      )}
    </main>
  );
}
