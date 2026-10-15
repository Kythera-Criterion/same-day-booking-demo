'use client';

import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type Account = { email: string; label: string };

export default function LoginBox({
  client,
  title,
  accounts,
}: {
  client: SupabaseClient;
  title: string;
  accounts: Account[];
}) {
  const [email, setEmail] = useState(accounts[0]?.email ?? '');
  const [password, setPassword] = useState(process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInError) setError('ログインできませんでした。メールアドレスとパスワードをご確認ください。');
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2 className="card-title">{title}</h2>
      <div className="chips">
        {accounts.map((a) => (
          <button
            key={a.email}
            type="button"
            className={`chip ${email === a.email ? 'chip-on' : ''}`}
            onClick={() => setEmail(a.email)}
          >
            {a.label}
          </button>
        ))}
      </div>
      <label className="field">
        <span>メールアドレス</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="field">
        <span>パスワード</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <p className="msg msg-error">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'ログイン中…' : 'ログイン'}
      </button>
    </form>
  );
}
