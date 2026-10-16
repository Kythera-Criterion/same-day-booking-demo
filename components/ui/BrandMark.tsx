// ブランドの印（ロゴ）：役割の色の角の丸い四角に、ページの使い方に合わせた形（lib/brand-mark.ts）
// 飾りなので読み上げない（名前「当日予約デモ」は、となりの文字で伝える）

import { MARK_PATHS, MARK_STROKE, MARK_VIEWBOX, type MarkKind } from '@/lib/brand-mark';
import s from './BrandMark.module.css';

export default function BrandMark({ kind, className }: { kind?: MarkKind | null; className?: string }) {
  const paths = MARK_PATHS[kind ?? 'user'];
  return (
    <span className={className ? `${s.tile} ${className}` : s.tile} aria-hidden>
      <svg
        className={s.glyph}
        viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
        width={20}
        height={20}
        fill="none"
        stroke="currentColor"
        strokeWidth={MARK_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        {paths.map((p) => (
          <path
            key={p.d}
            d={p.d}
            className={p.tone === 'accent' ? (p.fill ? s.accentFill : s.accent) : p.fill ? s.inkFill : undefined}
          />
        ))}
      </svg>
    </span>
  );
}
