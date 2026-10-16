'use client';

// 掲載希望の公開フォーム（ログイン不要）

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import AppHeader, { RoleIntro } from '@/components/AppHeader';
import { NotConfigured } from '@/components/States';
import Button from '@/components/ui/Button';
import { Input, LabeledField, Textarea } from '@/components/ui/Form';
import { Page, ScreenTitle } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { CheckCircle, PaperPlaneTilt, Sparkle } from '@/components/ui/icons';
import { useRoleSession } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import s from './ApplyForm.module.css';

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
    <Page>
      <AppHeader role="サロンの方へ" home="/salon" />
      <RoleIntro kind="salon" />
      <ScreenTitle>掲載のお申し込み</ScreenTitle>
      {!done && (
        <Link href="/salon/signup" className={s.recommend}>
          <Sparkle size={24} weight="duotone" aria-hidden focusable="false" />
          <span>
            <strong>すぐに始めたい方は、アカウントを作って登録できます（おすすめ）</strong>
            店名・お名前・メールアドレス・パスワード（または Google・Yahoo! JAPAN ID）で申し込めます。運営が承認すると確認のリンクが届き、開くとすぐに使い始められます。 <span className={s.go}>新規登録へ →</span>
          </span>
        </Link>
      )}
      {!done && <p className={s.lead}>まずは相談したい方は、下のフォームからお送りください。運営で確認のうえ、ご連絡します。</p>}
      {done ? (
        <Panel as="section">
          <SectionHead icon={CheckCircle} title="お申し込みを受け付けました" as="p" />
          <SubText>運営で確認のうえ、ご連絡します。</SubText>
        </Panel>
      ) : (
        <Panel as="form" onSubmit={submit}>
          <LabeledField label="店舗名">
            <Input required maxLength={80} value={form.salon} onChange={(e) => set('salon', e.target.value)} />
          </LabeledField>
          <LabeledField label="担当者名">
            <Input required maxLength={60} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </LabeledField>
          <LabeledField label="メールアドレス">
            <Input type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} />
          </LabeledField>
          <LabeledField label="電話番号（任意）">
            <Input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </LabeledField>
          <LabeledField label="掲載を希望するエリア">
            <Input required maxLength={80} value={form.area} onChange={(e) => set('area', e.target.value)} />
          </LabeledField>
          <LabeledField label="ご質問（任意）">
            <Textarea maxLength={1000} value={form.question} onChange={(e) => set('question', e.target.value)} />
          </LabeledField>
          {error && (
            <Notice tone="danger" className={s.error}>
              {error}
            </Notice>
          )}
          <Button variant="primary" size="lg" block disabled={busy} type="submit" icon={PaperPlaneTilt}>
            {busy ? '送信中…' : '申し込む'}
          </Button>
        </Panel>
      )}
    </Page>
  );
}
