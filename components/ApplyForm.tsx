'use client';

// 掲載希望の公開フォーム（ログイン不要）

import { useState, type FormEvent } from 'react';
import AppHeader from '@/components/AppHeader';
import { NotConfigured } from '@/components/States';
import { useRoleSession } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';

export default function ApplyForm() {
  const { client } = useRoleSession('user');
  const [form, setForm] = useState({ salon: '', name: '', email: '', phone: '', area: '', question: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!client) return;
    setBusy(true);
    setError(null);
    const { error: e2 } = await client.rpc('submit_salon_application', {
      p_salon_name: form.salon,
      p_contact_name: form.name,
      p_email: form.email,
      p_phone: form.phone || null,
      p_area_text: form.area,
      p_question: form.question || null,
    });
    setBusy(false);
    if (e2) setError(toMessage(e2));
    else setDone(true);
  }

  if (!client) return <NotConfigured />;

  return (
    <main className="app">
      <AppHeader role="サロンの方へ" />
      <h1 className="screen-title">掲載のお申し込み</h1>
      {done ? (
        <section className="card fade-in">
          <p className="card-title">お申し込みを受け付けました</p>
          <p className="card-sub">運営で確認のうえ、ご連絡します。</p>
        </section>
      ) : (
        <form className="card" onSubmit={submit}>
          <label className="field">
            <span className="field-label">店舗名</span>
            <input className="input" required maxLength={80} value={form.salon} onChange={(e) => set('salon', e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">担当者名</span>
            <input className="input" required maxLength={60} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">メールアドレス</span>
            <input className="input" type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">電話番号（任意）</span>
            <input className="input" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">掲載を希望するエリア</span>
            <input className="input" required maxLength={80} value={form.area} onChange={(e) => set('area', e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">ご質問（任意）</span>
            <textarea className="textarea" maxLength={1000} value={form.question} onChange={(e) => set('question', e.target.value)} />
          </label>
          {error && <p className="notice notice-error">{error}</p>}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy} type="submit">
            {busy ? '送信中…' : '申し込む'}
          </button>
        </form>
      )}
    </main>
  );
}
