// お知らせ（info・success・danger・time・neutral）と、落ち着いた1本の帯

import type { ReactNode } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { CheckCircle, HourglassMedium, Info, WarningCircle } from './icons';
import s from './Notice.module.css';

export type NoticeTone = 'info' | 'success' | 'danger' | 'time' | 'neutral';

const ICON: Record<NoticeTone, PhosphorIcon> = {
  info: Info,
  success: CheckCircle,
  danger: WarningCircle,
  time: HourglassMedium,
  neutral: Info,
};

export default function Notice({
  tone = 'info',
  icon,
  role,
  className,
  children,
}: {
  tone?: NoticeTone;
  icon?: PhosphorIcon | null;
  role?: 'alert' | 'status';
  className?: string;
  children: ReactNode;
}) {
  const Glyph = icon === null ? null : (icon ?? ICON[tone]);
  return (
    <div className={`${s.notice} ${s[tone]} ${Glyph ? '' : s.plain} ${className ?? ''}`} role={role}>
      {Glyph && <Glyph size={20} weight={tone === 'time' ? 'duotone' : 'regular'} aria-hidden focusable="false" />}
      <div className={s.body}>{children}</div>
    </div>
  );
}

export function NoticeBand({ icon: Glyph, children }: { icon?: PhosphorIcon; children: ReactNode }) {
  return (
    <p className={s.band}>
      {Glyph && <Glyph size={20} aria-hidden focusable="false" />}
      <span>{children}</span>
    </p>
  );
}
