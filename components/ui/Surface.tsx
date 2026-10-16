// 面：Panel（白い面）・SectionHead（アイコンつきの見出し）・Divider・DataList・Lines（線で区切ったリスト）

import type { ElementType, ReactNode } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import s from './Surface.module.css';

export function Panel({
  as: Tag = 'section',
  flush = false,
  sunken = false,
  roomy = false,
  className,
  children,
  ...rest
}: {
  as?: ElementType;
  flush?: boolean;
  sunken?: boolean;
  roomy?: boolean;
  className?: string;
  children: ReactNode;
  [key: string]: unknown;
}) {
  return (
    <Tag className={[s.panel, flush ? s.flush : '', sunken ? s.sunken : '', roomy ? s.roomy : '', className ?? ''].join(' ')} {...rest}>
      {children}
    </Tag>
  );
}

export function SectionHead({
  icon: Glyph,
  title,
  as: Tag = 'h2',
  aside,
  id,
}: {
  icon?: PhosphorIcon;
  title: ReactNode;
  as?: 'h2' | 'h3' | 'p';
  aside?: ReactNode;
  id?: string;
}) {
  return (
    <div className={s.head}>
      {Glyph && <Glyph size={20} aria-hidden focusable="false" />}
      <Tag className={s.headTitle} id={id}>
        {title}
      </Tag>
      {aside !== undefined && <span className={s.headAside}>{aside}</span>}
    </div>
  );
}

export function SubText({ children }: { children: ReactNode }) {
  return <p className={s.sub}>{children}</p>;
}

export function Divider() {
  return <hr className={s.divider} />;
}

export function DataList({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={`${s.dl} ${className ?? ''}`}>
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Lines({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={`${s.list} ${className ?? ''}`}>{children}</ul>;
}
