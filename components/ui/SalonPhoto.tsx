// お店の写真（next/image で表示する大きさに合わせて読み込む）。写真のないお店は、お店の印を出す
//   variant：thumb（一覧の小さな正方形）・square（正方形・幅いっぱい）・hero（16:9・上部）
//   caption：写真の上に重ねる文字（下に向かって暗くなるグラデーションを敷く）

import Image from 'next/image';
import type { ReactNode } from 'react';
import { salonPhotos } from '@/lib/salon-photos';
import { Storefront } from './icons';
import s from './SalonPhoto.module.css';

const SIZES = {
  thumb: '76px',
  square: '(min-width: 720px) 240px, 33vw',
  hero: '(min-width: 720px) 720px, 100vw',
} as const;

function initials(name: string) {
  const words = name.replace(/[（(].*$/, '').trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words.slice(0, 2).map((w) => w[0]) : [...(words[0] ?? '店')].slice(0, 2);
  return letters.join('').toUpperCase();
}

export default function SalonPhoto({
  salonId,
  salonName,
  variant = 'thumb',
  src,
  alt,
  rounded = false,
  priority = false,
  caption,
  className,
}: {
  salonId?: string | null;
  salonName: string;
  variant?: 'thumb' | 'square' | 'hero';
  src?: string;
  alt?: string;
  rounded?: boolean;
  priority?: boolean;
  caption?: ReactNode;
  className?: string;
}) {
  const set = salonPhotos(salonId);
  const file = src ?? (set ? (variant === 'hero' ? set.hero : set.card) : null);
  const text = alt ?? (set ? `${salonName}：${set.alt}` : '');
  const cls = [s.frame, s[variant], rounded ? s.rounded : '', caption ? s.shade : '', className ?? ''].join(' ');
  if (!file) {
    return (
      <div className={`${cls} ${s.fallback}`} aria-hidden={caption ? undefined : true}>
        <Storefront size={24} weight="duotone" aria-hidden focusable="false" />
        <span className={s.initial}>{initials(salonName)}</span>
        {caption && <div className={s.caption}>{caption}</div>}
      </div>
    );
  }
  return (
    <div className={cls}>
      <Image
        src={file}
        alt={text}
        fill
        sizes={SIZES[variant]}
        priority={priority}
      />
      {caption && <div className={s.caption}>{caption}</div>}
    </div>
  );
}
