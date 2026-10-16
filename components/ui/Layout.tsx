// 画面の骨組み：Page（幅と下の余白）・Stack（縦）・Row（横）・Pair（同じ幅で2つ）・ScreenTitle・Lead・Fine

import type { ElementType, ReactNode } from 'react';
import s from './Layout.module.css';

type Width = 'phone' | 'wide';

export function Page({
  width = 'phone',
  tabs = false,
  bar = false,
  className,
  children,
}: {
  width?: Width;
  tabs?: boolean;
  bar?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return <main className={[s.page, width === 'wide' ? s.wide : '', tabs ? s.withTabs : '', bar ? s.withBar : '', className ?? ''].join(' ')}>{children}</main>;
}

const GAP = { 1: s.gap1, 2: s.gap2, 3: '', 4: s.gap4, 6: s.gap6, 8: s.gap8 } as const;

export function Stack({
  gap = 3,
  as: Tag = 'div',
  className,
  children,
  ...rest
}: {
  gap?: keyof typeof GAP;
  as?: ElementType;
  className?: string;
  children: ReactNode;
  [key: string]: unknown;
}) {
  return (
    <Tag className={`${s.stack} ${GAP[gap]} ${className ?? ''}`} {...rest}>
      {children}
    </Tag>
  );
}

export function Row({
  between = false,
  wrap = false,
  end = false,
  className,
  children,
}: {
  between?: boolean;
  wrap?: boolean;
  end?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return <div className={[s.row, between ? s.between : '', wrap ? s.wrap : '', end ? s.end : '', className ?? ''].join(' ')}>{children}</div>;
}

export function Pair({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`${s.pair} ${className ?? ''}`}>{children}</div>;
}

export function ScreenTitle({ children, tight = false, as: Tag = 'h1', id }: { children: ReactNode; tight?: boolean; as?: 'h1' | 'h2'; id?: string }) {
  return (
    <Tag id={id} className={`${s.title} ${tight ? s.titleTight : ''}`}>
      {children}
    </Tag>
  );
}

export function Lead({ children, center = false }: { children: ReactNode; center?: boolean }) {
  return <p className={`${s.lead} ${center ? s.center : ''}`}>{children}</p>;
}

export function Fine({ children, center = false, id }: { children: ReactNode; center?: boolean; id?: string }) {
  return (
    <p id={id} className={`${s.fine} ${center ? s.center : ''}`}>
      {children}
    </p>
  );
}
