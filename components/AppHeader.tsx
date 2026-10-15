import Link from 'next/link';
import type { ReactNode } from 'react';

// 画面上部の帯（ブランド・役割・主な移動先）
export default function AppHeader({ role, home = '/', children }: { role?: string; home?: string; children?: ReactNode }) {
  return (
    <header className="topbar">
      <Link href={home} className="brand" aria-label="ホームへ">
        <span className="brand-mark" aria-hidden>
          今
        </span>
        <span>当日予約デモ</span>
        {role && <span className="role-pill">{role}</span>}
      </Link>
      <nav className="topnav">{children}</nav>
    </header>
  );
}
