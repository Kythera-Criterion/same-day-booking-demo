// ラベル：時間（塗り）・条件（枠線）・状態（面）。アイコンは飾り（読み上げない）

import type { ReactNode } from 'react';
import type { Icon as PhosphorIcon, IconWeight } from '@phosphor-icons/react';
import s from './Label.module.css';

export type LabelKind = 'time' | 'timeSoft' | 'condition' | 'state' | 'action' | 'success' | 'danger' | 'strong';

export default function Label({
  kind,
  icon: Glyph,
  weight,
  className,
  children,
}: {
  kind: LabelKind;
  icon?: PhosphorIcon;
  weight?: IconWeight;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`${s.label} ${s[kind]} ${className ?? ''}`}>
      {Glyph && <Glyph size={20} weight={weight ?? (kind === 'time' || kind === 'timeSoft' ? 'duotone' : 'regular')} aria-hidden focusable="false" />}
      {children}
    </span>
  );
}
