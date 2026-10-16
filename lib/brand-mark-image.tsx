import { ImageResponse } from 'next/og';
import { MARK_IMAGE_COLORS, MARK_PATHS, MARK_STROKE, MARK_VIEWBOX, type MarkKind } from '@/lib/brand-mark';

// 「ホーム画面に追加」用のアイコン（PNG）。ヘッダーのブランドの印と同じ形を、役割の色の正方形に大きく描く
// （角の丸めは端末がするため、四角は端まで塗る）
export const APPLE_ICON_SIZE = { width: 180, height: 180 };

export function brandMarkImage(kind: MarkKind) {
  const glyph = 116;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: MARK_IMAGE_COLORS[kind],
        }}
      >
        <svg
          width={glyph}
          height={glyph}
          viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
          fill="none"
          strokeWidth={MARK_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {MARK_PATHS[kind].map((p) => {
            const c = MARK_IMAGE_COLORS[p.tone];
            return <path key={p.d} d={p.d} stroke={c} fill={p.fill ? c : 'none'} />;
          })}
        </svg>
      </div>
    ),
    APPLE_ICON_SIZE,
  );
}
