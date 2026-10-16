// 枠の状態：アイコン・クラス（塗り・枠線・模様）・凡例。色だけで見分けないための共通の部品

import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { BellRinging, Clock, Prohibit, SealCheck, User, XCircle } from '@/components/ui/icons';
import s from './SlotState.module.css';

const ICON: Record<string, PhosphorIcon> = {
  open: Clock,
  confirmed: User,
  booked: User,
  completed: SealCheck,
  no_show: Prohibit,
  closed: XCircle,
  expired: XCircle,
  paused: XCircle,
  suspended: XCircle,
};

export function stateClass(state: string): string {
  return (s as Record<string, string>)[state] ?? s.closed;
}

export function StateIcon({ state, size = 20 }: { state: string; size?: 20 | 24 }) {
  const Glyph = ICON[state] ?? XCircle;
  return <Glyph size={size} weight={state === 'confirmed' || state === 'booked' || state === 'completed' ? 'fill' : 'bold'} aria-hidden focusable="false" />;
}

export function FreshMark() {
  return (
    <span className={s.fresh}>
      <BellRinging size={20} weight="fill" aria-hidden focusable="false" />
      新着
    </span>
  );
}

const LEGEND: [string, string][] = [
  ['open', '公開中（予約待ち）'],
  ['confirmed', '予約あり'],
  ['completed', '来店済み'],
  ['closed', '取り下げ・受付終了'],
];

export function StateLegend() {
  return (
    <ul className={s.legend} aria-label="枠の状態の見分け方">
      {LEGEND.map(([state, text]) => (
        <li key={state}>
          <span className={`${s.swatch} ${stateClass(state)}`}>
            <StateIcon state={state} />
          </span>
          {text}
        </li>
      ))}
    </ul>
  );
}
