import Link from 'next/link';
import AppHeader from '@/components/AppHeader';

export const metadata = { title: 'ページが見つかりません' };

export default function NotFound() {
  return (
    <main className="app">
      <AppHeader />
      <section className="card" style={{ marginTop: 24 }}>
        <p className="card-title">ページが見つかりません</p>
        <p className="card-sub">URL が変わったか、受付を終えた予約・枠のページかもしれません。</p>
        <Link href="/" className="btn btn-primary btn-block">
          今から行けるお店を探す
        </Link>
      </section>
    </main>
  );
}
