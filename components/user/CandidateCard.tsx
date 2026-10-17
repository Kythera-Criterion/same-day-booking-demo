'use client';

// 候補カード（ホームの候補3件と「ほかの枠」で共通）
//   開始時刻が主役。ラベルは2つまで：
//     時間のラベル（塗り・時間の色・時計のアイコン）：受付締切まで15分以内／いちばん早く始まる
//     条件のラベル（枠線）：女性限定・男性限定／いちばん近い
//   価格はラベルにせず、太い数字と「当日価格」で見せる。右上にお店の正方形の写真

import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import Button from '@/components/ui/Button';
import Label, { type LabelKind } from '@/components/ui/Label';
import Price from '@/components/ui/Price';
import SalonPhoto from '@/components/ui/SalonPhoto';
import { ArrowRight, Hourglass, HourglassMedium, Lightning, MapPin, PersonSimpleWalk, Scissors, Timer, User, XCircle } from '@/components/ui/icons';
import { fmtDistance } from '@/lib/geo';
import { ROLE_LABEL, type PickRole } from '@/lib/picks';
import { fmtRemaining, fmtTime, minutesUntil } from '@/lib/time';
import { walkMinutes } from '@/lib/walk';
import { genderCondition, stylistLine, type SalonExtra } from './useSalonExtras';
import s from './CandidateCard.module.css';

export type CardSlot = {
  id: string;
  start_at: string;
  deadline_at: string;
  price: number;
  menu_name: string;
  duration_min: number;
  salon_id: string;
  salon_name: string;
  stylist_name: string | null;
  km: number | null;
  role: PickRole | null;
};

// 受付締切までこの分数を切ったら、時間のラベルを出す
const URGENT_MIN = 15;

export default function CandidateCard({
  slot,
  no,
  now,
  gone,
  selected,
  disabled,
  fresh,
  extra,
  onSelect,
  onBook,
  refFn,
}: {
  slot: CardSlot;
  no?: number;
  now: Date;
  gone: boolean;
  selected: boolean;
  disabled: boolean;
  // 開いている間に新しく届いた枠（見た目だけ：時間の色の輪が1回広がる）
  fresh?: boolean;
  extra?: SalonExtra;
  onSelect: () => void;
  onBook: () => void;
  refFn?: (el: HTMLLIElement | null) => void;
}) {
  const left = minutesUntil(slot.deadline_at, now);
  const urgent = left <= URGENT_MIN;

  const labels: { kind: LabelKind; icon?: PhosphorIcon; text: string }[] = [];
  if (urgent) labels.push({ kind: 'time', icon: HourglassMedium, text: `受付あと${Math.max(0, left)}分` });
  if (slot.role === 'earliest') labels.push({ kind: 'time', icon: Lightning, text: ROLE_LABEL.earliest });
  const cond = genderCondition(extra);
  if (cond) labels.push({ kind: 'condition', text: cond });
  if (slot.role === 'nearest') labels.push({ kind: 'condition', icon: MapPin, text: ROLE_LABEL.nearest });
  const shownLabels = labels.slice(0, 2);
  const staff = stylistLine(slot.stylist_name, extra);

  return (
    <li ref={refFn} className={`${s.card} ${gone ? s.gone : ''}`} data-selected={selected ? 'true' : undefined} data-fresh={fresh ? 'true' : undefined} onClick={onSelect}>
      <div className={s.head}>
        {no !== undefined && <span className={s.no}>{no}</span>}
        <span className={s.start}>{fmtTime(slot.start_at)}</span>
        <span className={`${s.until} num`}>
          <Timer size={20} aria-hidden focusable="false" />
          開始まで{fmtRemaining(minutesUntil(slot.start_at, now)).replace('あと', '')}
        </span>
      </div>

      <SalonPhoto salonId={slot.salon_id} salonName={slot.salon_name} variant="thumb" className={s.photo} />

      <div className={s.body}>
        {shownLabels.length > 0 && (
          <div className={s.labels}>
            {shownLabels.map((l) => (
              <Label key={l.text} kind={l.kind} icon={l.icon}>
                {l.text}
              </Label>
            ))}
          </div>
        )}
        <p className={s.salon}>{slot.salon_name}</p>
        {slot.km !== null && (
          <p className={`${s.meta} num`}>
            <PersonSimpleWalk size={20} aria-hidden focusable="false" />
            <span className={s.metaText}>
              徒歩約{walkMinutes(slot.km)}分・{fmtDistance(slot.km)}
            </span>
          </p>
        )}
        <p className={s.meta}>
          <Scissors size={20} aria-hidden focusable="false" />
          <span className={s.metaText}>
            {slot.menu_name}・{slot.duration_min}分
          </span>
        </p>
        {staff && (
          <p className={s.meta}>
            <User size={20} aria-hidden focusable="false" />
            <span className={s.metaText}>担当 {staff}</span>
          </p>
        )}
      </div>

      <div className={s.foot}>
        <Price value={slot.price} align="start" />
        <span className={`${s.deadline} num`} data-urgent={urgent ? 'true' : undefined}>
          <Hourglass size={20} aria-hidden focusable="false" />
          {urgent ? 'まもなく受付終了' : `受付 ${fmtTime(slot.deadline_at)}まで`}
        </span>
        <Button
          variant="outline"
          iconEnd={ArrowRight}
          disabled={disabled || gone}
          onClick={(e) => {
            e.stopPropagation();
            onBook();
          }}
          aria-label={`${fmtTime(slot.start_at)} ${slot.salon_name} を予約する`}
        >
          予約する
        </Button>
      </div>

      {gone && (
        <div className={s.veil} role="status">
          <XCircle size={24} weight="duotone" aria-hidden focusable="false" />
          埋まりました
        </div>
      )}
    </li>
  );
}
