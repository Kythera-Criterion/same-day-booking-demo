import AppHeader from '@/components/AppHeader';

// 利用規約・プライバシーポリシーの置き場所（デモ）。
// 本番では NEXT_PUBLIC_TERMS_URL / NEXT_PUBLIC_PRIVACY_URL に公開サイトの URL を設定する
export default function LegalPage() {
  return (
    <main className="app">
      <AppHeader />
      <section className="card">
        <h1 className="card-title">利用規約・プライバシーポリシー</h1>
        <p className="card-sub">
          このデモでは本文を載せていません。公開サイトの利用規約・プライバシーポリシーの URL を設定すると、登録画面からそちらを開きます。
        </p>
      </section>
    </main>
  );
}
