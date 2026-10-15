'use client';

// お客様の画面の下部のタブ（ホーム／予約／マイページ）。親指が届く位置に置き、iPhone の下部の余白も空ける

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './TabBar.module.css';

type Tab = { href: string; label: string; icon: 'home' | 'ticket' | 'person'; match: (p: string) => boolean };

const TABS: Tab[] = [
  { href: '/', label: 'ホーム', icon: 'home', match: (p) => p === '/' },
  { href: '/bookings', label: '予約', icon: 'ticket', match: (p) => p.startsWith('/bookings') || p.startsWith('/booking/') },
  { href: '/mypage', label: 'マイページ', icon: 'person', match: (p) => p.startsWith('/mypage') },
];

function Icon({ name }: { name: Tab['icon'] }) {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {name === 'home' && <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />}
      {name === 'ticket' && (
        <>
          <path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z" />
          <path d="M10 7v10" strokeDasharray="2 2" />
        </>
      )}
      {name === 'person' && (
        <>
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" />
        </>
      )}
    </svg>
  );
}

export default function TabBar({ hasActive = false }: { hasActive?: boolean }) {
  const path = usePathname() ?? '/';
  return (
    <nav className={styles.bar} aria-label="お客様のメニュー" data-tabbar>
      <ul className={styles.list}>
        {TABS.map((t) => {
          const on = t.match(path);
          return (
            <li key={t.href}>
              <Link href={t.href} className={styles.tab} aria-current={on ? 'page' : undefined}>
                <span className={styles.iconWrap}>
                  <Icon name={t.icon} />
                  {t.icon === 'ticket' && hasActive && <span className={styles.dot} aria-hidden />}
                </span>
                <span className={styles.label}>{t.label}</span>
                {t.icon === 'ticket' && hasActive && <span className="sr-only">（ご予約中）</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
