// アイコン（Phosphor Icons、MIT）
// 決まり：
//   ・大きさは 20px（md）と 24px（lg）の2種類。色は currentColor（文字の色に合わせる）
//   ・太さで状態を表す：ふだんは regular、選択中は fill、「今」・時間の強調は duotone
//   ・飾りのアイコンは読み上げない（aria-hidden）。意味を持たせるときだけ label を渡す
//   ・大事な操作は、アイコンだけにせず、必ず文字と並べる

import type { Icon as PhosphorIcon, IconWeight } from '@phosphor-icons/react';

export type IconSize = 'md' | 'lg';

const PX: Record<IconSize, number> = { md: 20, lg: 24 };

export default function Icon({
  of: Glyph,
  size = 'md',
  weight = 'regular',
  label,
  className,
}: {
  of: PhosphorIcon;
  size?: IconSize;
  weight?: IconWeight;
  label?: string;
  className?: string;
}) {
  return (
    <Glyph
      size={PX[size]}
      weight={weight}
      color="currentColor"
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
      style={{ flex: 'none' }}
    />
  );
}
