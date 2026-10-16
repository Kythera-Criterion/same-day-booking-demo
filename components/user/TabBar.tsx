'use client';

// お客様の下部のタブ：ホーム（House）・予約（CalendarCheck）・マイページ（UserCircle）
//   予約：ご予約中なら、その予約の画面へ。なければマイページの「予約」の欄へ
//   選んでいるタブは、アイコンを塗り（fill）にして、文字を太くする（色だけに頼らない）

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { CalendarCheck, House, UserCircle } from '@/components/ui/icons';
import s from './TabBar.module.css';

export default function TabBar({ activeBookingId = null, signedIn = true }: { activeBookingId?: string | null; signedIn?: boolean }) {
  const path = usePathname() ?? '/';
  const bookingHref = activeBookingId ? `/booking/${activeBookingId}` : signedIn ? '/mypage#bookings' : `/login?next=${encodeURIComponent('/mypage')}`;
  const tabs: { href: string; label: string; icon: PhosphorIcon; on: boolean; dot?: boolean }[] = [
    { href: '/', label: 'ホーム', icon: House, on: path === '/' },
    { href: bookingHref, label: '予約', icon: CalendarCheck, on: path.startsWith('/booking'), dot: !!activeBookingId },
    // ログインしていないときは「ログイン」（ログイン中の画面に見えないように）
    { href: signedIn ? '/mypage' : '/login', label: signedIn ? 'マイページ' : 'ログイン', icon: UserCircle, on: path.startsWith('/mypage') || path.startsWith('/login') },
  ];
  return (
    <nav className={s.bar} aria-label="お客様のメニュー">
      <ul className={s.list}>
        {tabs.map((t) => (
          <li key={t.label}>
            <Link href={t.href} className={s.tab} aria-current={t.on ? 'page' : undefined}>
              <span className={t.dot ? s.dot : undefined}>
                <t.icon size={24} weight={t.on ? 'fill' : 'regular'} aria-hidden focusable="false" />
              </span>
              {t.label}
              {t.dot && <span className="sr-only">（ご予約中）</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
