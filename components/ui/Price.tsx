// 当日価格の表示（太い数字＋小さな説明）。読み上げでは「当日価格 4,500円」と1つにまとめる

import s from './Price.module.css';

export default function Price({
  value,
  caption = '当日価格',
  size = 'md',
  align = 'end',
}: {
  value: number;
  caption?: string | null;
  size?: 'md' | 'lg';
  align?: 'start' | 'end';
}) {
  const text = value.toLocaleString('ja-JP');
  return (
    <span className={`${s.price} ${size === 'lg' ? s.lg : ''} ${align === 'start' ? s.start : ''}`}>
      <span className="sr-only">{`${caption ?? ''} ${text}円`}</span>
      {caption && (
        <span className={s.caption} aria-hidden>
          {caption}
        </span>
      )}
      <span className={s.value} aria-hidden>
        <span className={s.yen}>¥</span>
        {text}
      </span>
    </span>
  );
}
