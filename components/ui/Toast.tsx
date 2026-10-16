// 短い知らせ（画面の上か下に浮かべる）。tone：neutral（インク）・action（役割の色）・success（来店などの完了）

import type { ReactNode } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import s from './Toast.module.css';

export default function Toast({
  tone = 'neutral',
  position = 'top',
  icon: Glyph,
  action,
  className,
  children,
}: {
  tone?: 'neutral' | 'action' | 'success';
  position?: 'top' | 'bottom';
  icon?: PhosphorIcon;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={[s.toast, s[position], tone === 'neutral' ? '' : s[tone], className ?? ''].join(' ')} role="status">
      {Glyph && <Glyph size={24} weight="duotone" aria-hidden focusable="false" />}
      <span className={s.body}>{children}</span>
      {action}
    </div>
  );
}
