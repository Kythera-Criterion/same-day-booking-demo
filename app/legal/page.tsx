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
        <h2 className={s.sub}>ご利用の記録について</h2>
        <p className={s.text}>
          この試作版では、使い勝手を確かめて改善するため、ページを開いていた時間・見たページ・使った機能（押したボタンなどの名前。入力した内容は含みません）・端末の種類を記録しています。ログインしている場合は、そのアカウントのメールアドレスと、そのアカウントにお送りした通知の件数もあわせて記録します。記録は運営だけが確認し、この目的以外には使いません。
        </p>
      </Panel>
    </Page>
  );
}
