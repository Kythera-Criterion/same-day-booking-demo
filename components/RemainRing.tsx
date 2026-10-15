import type { ReactNode } from 'react';

// 「今」の目印：残り時間とともに減っていく円。fraction は 0〜1（残りの割合）
export default function RemainRing({
  fraction,
  size = 220,
  stroke = 10,
  children,
  label,
}: {
  fraction: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  label: string;
}) {
  const f = Math.max(0, Math.min(1, fraction));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="ring-value"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - f)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-inner">{children}</div>
    </div>
  );
}

// 細い残り時間のバー（カード用）
export function RemainBar({ fraction, urgent }: { fraction: number; urgent?: boolean }) {
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <span className={`remain-bar ${urgent ? 'is-urgent' : ''}`} aria-hidden>
      <span style={{ width: `${f * 100}%` }} />
    </span>
  );
}
