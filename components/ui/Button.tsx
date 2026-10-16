// ボタンと、ボタンの見た目のリンク
//   variant：primary（主要な操作。1つの画面で強く塗るのはこれだけ）／secondary／quiet／text／danger／dangerSolid／onStrong
//   size：sm（44px）・md（48px）・lg（56px）

import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import type { Icon as PhosphorIcon, IconWeight } from '@phosphor-icons/react';
import Icon from './Icon';
import s from './Button.module.css';

export type ButtonVariant = 'primary' | 'outline' | 'secondary' | 'quiet' | 'text' | 'danger' | 'dangerSolid' | 'onStrong';
export type ButtonSize = 'sm' | 'md' | 'lg';

type Look = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: PhosphorIcon;
  iconWeight?: IconWeight;
  iconEnd?: PhosphorIcon;
};

export function buttonClass({ variant = 'secondary', size = 'sm', block = false }: Look = {}, extra?: string) {
  return [s.button, s[variant], s[size], block ? s.block : '', extra ?? ''].filter(Boolean).join(' ');
}

function Inner({ icon, iconWeight, iconEnd, size, children }: Look & { children?: ReactNode }) {
  const iconSize = size === 'lg' ? 'lg' : 'md';
  return (
    <>
      {icon && <Icon of={icon} size={iconSize} weight={iconWeight} />}
      {children}
      {iconEnd && <Icon of={iconEnd} size={iconSize} />}
    </>
  );
}

export default function Button({
  variant,
  size,
  block,
  icon,
  iconWeight,
  iconEnd,
  className,
  type = 'button',
  children,
  ...rest
}: Look & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={buttonClass({ variant, size, block }, className)} {...rest}>
      <Inner icon={icon} iconWeight={iconWeight} iconEnd={iconEnd} size={size}>
        {children}
      </Inner>
    </button>
  );
}

export function ButtonLink({
  href,
  variant,
  size,
  block,
  icon,
  iconWeight,
  iconEnd,
  className,
  external = false,
  children,
  ...rest
}: Look & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; external?: boolean }) {
  const cls = buttonClass({ variant, size, block }, className);
  const inner = (
    <Inner icon={icon} iconWeight={iconWeight} iconEnd={iconEnd} size={size}>
      {children}
    </Inner>
  );
  if (external || href.startsWith('http') || href.startsWith('tel:') || href.startsWith('mailto:')) {
    return (
      <a href={href} className={cls} {...rest}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {inner}
    </Link>
  );
}
