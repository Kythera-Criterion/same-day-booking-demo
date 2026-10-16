'use client';

// デモ用の認証画面（Google・Yahoo! JAPAN ID のキーが未設定のデモで、外部の ID での登録・ログインの流れを試すためのもの）。
// 各社の画面には似せず、デモであることをはっきり示す。使えるのは例示用のメールアドレス（@example.com など）だけ

import { useEffect, useState } from 'react';
import AppHeader from '@/components/AppHeader';
import Button from '@/components/ui/Button';
import { Input, LabeledField, formClass } from '@/components/ui/Form';
import Label from '@/components/ui/Label';
import { Page, Pair } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import { Panel } from '@/components/ui/Surface';
import { Flag } from '@/components/ui/icons';
import { PROVIDER_LABEL, isDemoEmail, type ProviderId } from '@/lib/oauth-shared';
// 一覧の中で s（保存したアカウント）を使うため、別名で読み込む
import ds from './DemoProvider.module.css';

type Saved = { subject: string; name: string; email: string };

const SAMPLE_NAMES = ['青木 葵', '石田 蓮', '上野 結衣', '岡本 陽向', '川口 美月', '菊池 湊', '小松 さくら', '高橋 悠真'];

function key(provider: ProviderId) {
  return `demo-provider-accounts-${provider}`;
}
function readSaved(provider: ProviderId): Saved[] {
  try {
    return JSON.parse(localStorage.getItem(key(provider)) ?? '[]') as Saved[];
  } catch {
    return [];
  }
}
function writeSaved(provider: ProviderId, list: Saved[]) {
  try {
    localStorage.setItem(key(provider), JSON.stringify(list.slice(0, 5)));
  } catch {
    // 保存できなくても続けられる
  }
}
function randomId(): string {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default function DemoProvider({ provider }: { provider: ProviderId }) {
  const label = PROVIDER_LABEL[provider];
  const [saved, setSaved] = useState<Saved[]>([]);
  const [fresh, setFresh] = useState<Saved | null>(null);
  const [chosen, setChosen] = useState<Saved | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const list = readSaved(provider);
    setSaved(list);
    const n = Math.floor(Math.random() * 9000) + 1000;
    setFresh({ subject: randomId(), name: SAMPLE_NAMES[n % SAMPLE_NAMES.length], email: `${provider}.demo${n}@example.com` });
    if (list.length > 0) setChosen(list[0]);
  }, [provider]);

  function submitWith(account: Saved, form: HTMLFormElement) {
    if (!isDemoEmail(account.email)) {
      setError('デモでは、@example.com などの例示用のメールアドレスだけ使えます。');
      return;
    }
    writeSaved(provider, [account, ...saved.filter((s) => s.subject !== account.subject)]);
    form.submit();
  }

  const current = chosen ?? fresh;

  return (
    <Page>
      <AppHeader role="デモ" />
      <Panel as="section" className={ds.box}>
        <div className={ds.body}>
          <p>
            <Label kind="strong" icon={Flag}>
              デモ用の認証画面
            </Label>
          </p>
          <h1 className={ds.title}>{label}との連携（デモ）</h1>
          <Notice tone="info">
            これは実際の {label} の画面ではありません。連携のキーが未設定のため、登録・ログインの流れを試せるようにした画面です。キーを設定すると、本物の認証画面に切り替わります。
          </Notice>
          <p className={ds.request}>「当日予約デモ」が、次の情報の提供を求めています：お名前・メールアドレス</p>

          <form method="post" action="/api/auth/oauth/demo" onSubmit={(e) => e.preventDefault()} id="demo-provider-form">
            <input type="hidden" name="decision" value="allow" />
            <input type="hidden" name="subject" value={current?.subject ?? ''} />
            <input type="hidden" name="name" value={current?.name ?? ''} />
            <input type="hidden" name="email" value={current?.email ?? ''} />

            {saved.length > 0 && (
              <fieldset className={ds.accounts}>
                <legend className={formClass.label}>前に使ったデモのアカウント（同じ人として、もう一度ログインできます）</legend>
                {saved.map((s) => (
                  <label key={s.subject} className={formClass.check}>
                    <input type="radio" name="pick" checked={chosen?.subject === s.subject} onChange={() => setChosen(s)} />
                    <span>
                      {s.name}
                      <small className={ds.email}> {s.email}</small>
                    </span>
                  </label>
                ))}
                <label className={formClass.check}>
                  <input type="radio" name="pick" checked={chosen === null} onChange={() => setChosen(null)} />
                  <span>別のアカウント（新しい人として試す）</span>
                </label>
              </fieldset>
            )}

            {chosen === null && fresh && (
              <div className={ds.row}>
                <LabeledField label="お名前">
                  <Input value={fresh.name} maxLength={60} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} />
                </LabeledField>
                <LabeledField label="メールアドレス" hint="例示用のアドレス（@example.com・.test）だけ使えます。">
                  <Input type="email" value={fresh.email} onChange={(e) => setFresh({ ...fresh, email: e.target.value.trim() })} />
                </LabeledField>
              </div>
            )}

            {error && (
              <Notice tone="danger" role="alert" className={ds.error}>
                {error}
              </Notice>
            )}
            <Pair>
              <Button
                variant="quiet"
                size="md"
                onClick={() => {
                  const f = document.getElementById('demo-provider-form') as HTMLFormElement;
                  (f.elements.namedItem('decision') as HTMLInputElement).value = 'deny';
                  f.submit();
                }}
              >
                キャンセル
              </Button>
              <Button
                variant="primary"
                size="md"
                disabled={!current}
                onClick={() => current && submitWith(current, document.getElementById('demo-provider-form') as HTMLFormElement)}
              >
                許可して続ける
              </Button>
            </Pair>
          </form>
        </div>
      </Panel>
    </Page>
  );
}
