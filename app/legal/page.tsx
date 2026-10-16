import AppHeader from '@/components/AppHeader';
import { Page } from '@/components/ui/Layout';
import { Panel } from '@/components/ui/Surface';
import { ShieldCheck } from '@/components/ui/icons';
import s from './page.module.css';
export const metadata = { title: '利用規約・プライバシーポリシー' };

// 利用規約・プライバシーポリシーの置き場所（デモ）。
// 本番では NEXT_PUBLIC_TERMS_URL / NEXT_PUBLIC_PRIVACY_URL に公開サイトの URL を設定する
export default function LegalPage() {
  return (
    <Page>
      <AppHeader />
      <Panel as="section" className={s.panel}>
        <h1 className={s.title}>
          <ShieldCheck size={24} aria-hidden focusable="false" />
          利用規約・プライバシーポリシー
        </h1>
        <p className={s.text}>
          このデモでは本文を載せていません。公開サイトの利用規約・プライバシーポリシーの URL を設定すると、登録画面からそちらを開きます。
        </p>
      </Panel>
    </Page>
  );
}
