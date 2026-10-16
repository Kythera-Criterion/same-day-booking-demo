import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import BrandMark from '@/components/ui/BrandMark';
import { Scissors, ShieldCheck, User } from '@/components/ui/icons';
import type { MarkKind } from '@/lib/brand-mark';
import s from './AppHeader.module.css';

// 画面上部の帯（ブランド・役割・主な移動先）。
// お客様・サロン・運営のどのページかが一目で分かるよう、役割ごとに色（テーマ）・アイコン・呼び名を変える。
// テーマの色は、この帯の data-role をもとに app/styles/tokens.css でページ全体に効かせる

export type RoleKind = MarkKind;

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

const ROLE_ICON: Record<RoleKind, PhosphorIcon> = { user: User, salon: Scissors, admin: ShieldCheck };

export function roleKind(label?: string | null): RoleKind | null {
  return label ? (KIND_BY_LABEL[label] ?? null) : null;
}

// 役割のアイコン（お客様：人、サロン：はさみ、運営：盾）
export function RoleIcon({ kind, size = 20 }: { kind: RoleKind; size?: 20 | 24 }) {
  const Glyph = ROLE_ICON[kind];
  return <Glyph size={size} weight="bold" aria-hidden focusable="false" />;
}

// 入口の画面（ログイン・新規登録など）の上に置く「どのページか」の帯。
// compact：1画面に収めたい新規登録の画面では、見出しの上の1行にする
export function RoleIntro({ kind, compact = false }: { kind: RoleKind; compact?: boolean }) {
  const info = ROLE_INFO[kind];
  if (compact) {
    return (
      <p className={s.eyebrow}>
        <RoleIcon kind={kind} />
        {info.title}
      </p>
    );
  }
  return (
    <div className={s.intro}>
      <span className={s.introIcon}>
        <RoleIcon kind={kind} size={24} />
      </span>
      <span className={s.introBody}>
        <strong>{info.title}</strong>
        <small>{info.desc}</small>
      </span>
    </div>
  );
}

export default function AppHeader({ role, home = '/', children }: { role?: string; home?: string; children?: ReactNode }) {
  const kind = roleKind(role);
  return (
    <header className={s.bar} data-role={kind ?? undefined}>
      <Link href={home} className={s.brand}>
        <BrandMark kind={kind} />
        <span className={s.name}>当日予約デモ</span>
        {kind ? (
          <span className={s.role}>
            <RoleIcon kind={kind} />
            {ROLE_INFO[kind].pill}
          </span>
        ) : (
          role && <span className={s.role}>{role}</span>
        )}
        <span className="sr-only">（ホームへ）</span>
      </Link>
      <nav className={s.nav} aria-label="主な移動先">
        {children}
      </nav>
    </header>
  );
}
