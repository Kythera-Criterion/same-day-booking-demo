'use client';

// 予期しないエラーのときの画面（真っ白な画面にしない）
import { useEffect } from 'react';
import Link from 'next/link';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="app">
      <section className="card" style={{ marginTop: 32 }}>
        <p className="card-title">うまく表示できませんでした</p>
        <p className="card-sub">
          通信が不安定か、一時的な不具合の可能性があります。もう一度お試しください。ご予約の内容は、そのまま残っています。
        </p>
        <div className="action-pair">
          <Link href="/" className="btn btn-quiet">
            ホームへ
          </Link>
          <button className="btn btn-primary" onClick={reset}>
            もう一度表示する
          </button>
        </div>
        {error.digest && <p className="fine-print">お問い合わせのときは、この番号をお伝えください：{error.digest}</p>}
      </section>
    </main>
  );
}
