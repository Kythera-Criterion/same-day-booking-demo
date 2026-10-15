import Link from 'next/link';
import type { ReactNode } from 'react';

// 画面上部の帯（ブランド・役割・主な移動先）。
// お客様・サロン・運営のどのページかが一目で分かるよう、役割ごとに色（テーマ）・アイコン・呼び名を変える。
// テーマの色は、この帯の data-role をもとに globals.css でページ全体に効かせる

export type RoleKind = 'user' | 'salon' | 'admin';

const KIND_BY_LABEL: Record<string, RoleKind> = {
  利用者: 'user',
  お客様: 'user',
  サロン: 'salon',
  サロンの方へ: 'salon',
  運営: 'admin',
};

export const ROLE_INFO: Record<RoleKind, { pill: string; title: string; desc: string }> = {
  user: { pill: 'お客様', title: 'お客様向けのページ', desc: '今日の空き枠を探して、すぐに予約できます' },
  salon: { pill: 'サロン', title: 'サロン（お店）向けのページ', desc: '空き時間の公開と、入った予約の確認' },
  admin: { pill: '運営', title: '運営事務局向けのページ', desc: '審査・サロンの管理・実証の数字（関係者のみ）' },
};

export function roleKind(label?: string | null): RoleKind | null {
  return label ? (KIND_BY_LABEL[label] ?? null) : null;
}

// 役割のアイコン（お客様：人、サロン：はさみ、運営：盾）
export function RoleIcon({ kind, size = 16 }: { kind: RoleKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {kind === 'user' && (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.2 3.6-6.5 8-6.5s8 2.3 8 6.5" />
        </>
      )}
      {kind === 'salon' && (
        <>
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M8.6 7.6 20 19M8.6 16.4 20 5" />
        </>
      )}
      {kind === 'admin' && (
        <>
          <path d="M12 3 5 6v5.2c0 4.3 2.9 8.2 7 9.8 4.1-1.6 7-5.5 7-9.8V6z" />
          <path d="m9 12 2.2 2.2L15.5 10" />
        </>
      )}
    </svg>
  );
}

// 入口の画面（ログイン・新規登録など）の上に置く「どのページか」の帯。
// compact：1画面に収めたい新規登録の画面では、見出しの上の1行にする
export function RoleIntro({ kind, compact = false }: { kind: RoleKind; compact?: boolean }) {
  const info = ROLE_INFO[kind];
  if (compact) {
    return (
      <p className={`role-eyebrow role-eyebrow-${kind}`}>
        <RoleIcon kind={kind} size={15} />
        {info.title}
      </p>
    );
  }
  return (
    <div className={`role-intro role-intro-${kind}`}>
      <span className="role-intro-icon">
        <RoleIcon kind={kind} size={22} />
      </span>
      <span className="role-intro-body">
        <strong>{info.title}</strong>
        <small>{info.desc}</small>
      </span>
    </div>
  );
}

export default function AppHeader({ role, home = '/', children }: { role?: string; home?: string; children?: ReactNode }) {
  const kind = roleKind(role);
  return (
    <header className="topbar" data-role={kind ?? undefined}>
      <Link href={home} className="brand" aria-label={kind ? `${ROLE_INFO[kind].title}のホームへ` : 'ホームへ'}>
        <span className="brand-mark" aria-hidden>
          今
        </span>
        <span>当日予約デモ</span>
        {kind ? (
          <span className={`role-pill role-pill-${kind}`}>
            <RoleIcon kind={kind} size={13} />
            {ROLE_INFO[kind].pill}
          </span>
        ) : (
          role && <span className="role-pill">{role}</span>
        )}
      </Link>
      <nav className="topnav">{children}</nav>
    </header>
  );
}
