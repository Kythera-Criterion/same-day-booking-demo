'use client';

// ご利用開始のご案内メールのリンクから開く画面（サロンのスタッフ向け）。
//   1. リンクを確かめて、サロンの画面のログイン状態にする
//   2. ログイン用のパスワードを決める（招待のとき）
//   3. サロンの画面へ進む（初めてなら3つの初期設定から）

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import AppHeader from '@/components/AppHeader';
import { Loading, NotConfigured } from '@/components/States';
import { isConfigured, getClient } from '@/lib/supabase';

type Phase = 'checking' | 'password' | 'ready' | 'invalid';

export default function Welcome({ tokenHash, type }: { tokenHash: string | null; type: string | null }) {
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
      const client = getClient('salon');
      if (!tokenHash || (type !== 'invite' && type !== 'magiclink')) {
        setPhase('invalid');
        return;
      }
      const { data, error: e } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
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
      const { data: member } = await client
        .from('salon_members')
        .select('salons(name)')
        .eq('user_id', data.session.user.id)
        .limit(1)
        .maybeSingle();
      const salon = member?.salons as { name: string } | { name: string }[] | null | undefined;
      setSalonName(Array.isArray(salon) ? (salon[0]?.name ?? null) : (salon?.name ?? null));
      setPhase(type === 'invite' ? 'password' : 'ready');
      // リンクの情報を URL に残さない
      window.history.replaceState(null, '', '/welcome');
    })();
  }, [tokenHash, type]);

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setError('パスワードは8文字以上で入力してください。');
    if (pw !== pw2) return setError('確認のため、同じパスワードをもう一度入力してください。');
    setBusy(true);
    setError(null);
    const { error: e2 } = await getClient('salon').auth.updateUser({ password: pw });
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
      <AppHeader role="サロン" home="/salon" />
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
            有効期限が切れたか、すでに使われたリンクです。お手数ですが、運営事務局へご連絡ください。新しいリンクをお送りします。パスワードを設定済みの方は、サロンの画面からログインできます。
          </p>
          <Link href="/salon" className="btn btn-secondary btn-block">
            サロンのログインへ
          </Link>
        </section>
      )}

      {phase === 'password' && (
        <form className="card fade-in" onSubmit={savePassword} noValidate>
          <p className="welcome-kicker">ようこそ</p>
          <h1 className="screen-title" style={{ margin: '0 0 6px' }}>
            {salonName ? `${salonName} 様` : 'ご利用開始の手続き'}
          </h1>
          <p className="card-sub">
            掲載が承認されました。はじめに、ログイン用のパスワードを決めてください。ログイン用メールアドレスは <strong>{email}</strong> です。
          </p>
          <div className={`field ${error ? 'has-error' : ''}`}>
            <label className="field-label" htmlFor="pw">
              パスワード<span className="req">必須</span>
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
            {busy ? '設定中…' : 'パスワードを設定して次へ'}
          </button>
        </form>
      )}

      {phase === 'ready' && (
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
