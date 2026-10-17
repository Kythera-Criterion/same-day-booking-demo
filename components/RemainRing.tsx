import type { CSSProperties, ReactNode } from 'react';
import s from './RemainRing.module.css';

// 「今」の目印：残り時間とともに減っていく円。fraction は 0〜1（残りの割合）
//   表示したときは、空の輪から今の残りまで満ちていく。soon のときは輪を時間の色にする（見た目だけ）
export default function RemainRing({
  fraction,
  size = 208,
  stroke = 8,
  children,
  label,
  soon,
}: {
  fraction: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  label: string;
  soon?: boolean;
}) {
  const f = Math.max(0, Math.min(1, fraction));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      className={s.ring}
      style={{ width: size, height: size, '--ring-c': c } as CSSProperties}
      data-soon={soon ? 'true' : undefined}
      role="img"
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className={s.track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className={s.value}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - f)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className={s.inner}>{children}</div>
    </div>
  );
}
