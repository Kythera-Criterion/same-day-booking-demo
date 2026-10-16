'use client';

// 枠・予約の詳細：予約者の情報（第3章8の範囲）と、共有された写真。来店済み・無断キャンセル・キャンセル（理由を選ぶ）

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Sheet from '@/components/Sheet';
import Button, { ButtonLink } from '@/components/ui/Button';
import { Pair } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import {
  CalendarX,
  ChatCircle,
  Clock,
  ImageIcon,
  Info,
  NotePencil,
  Phone,
  Prohibit,
  SealCheck,
  Storefront,
  Ticket,
  User,
  WarningCircle,
  XCircle,
} from '@/components/ui/icons';
import { toMessage } from '@/lib/errors';
import { requestDispatch } from '@/lib/dispatch-client';
import { CONVERSATION_PREFS, label } from '@/lib/profile-options';
import { fmtTime, fmtYen } from '@/lib/time';
import { UI_OPTIONS } from '@/lib/ui-options';
import { activeBooking, type SalonSlot } from './useSalonData';
import { STATE_LABEL, slotState } from './Timeline';
import { StateIcon, stateClass } from './SlotStateMark';
import s from './SlotPanel.module.css';

type Action = 'complete' | 'no_show' | 'cancel_customer' | 'cancel_salon';

export default function SlotPanel({
  client,
  slot,
  now,
  onChanged,
  onClose,
}: {
  client: SupabaseClient;
  slot: SalonSlot;
  now: Date;
  onChanged: (text: string) => void;
  onClose: () => void;
}) {
  const b = activeBooking(slot);
  const state = slotState(slot);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const [mode, setMode] = useState<'view' | 'cancel' | 'no_show'>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 写真は60秒で切れる署名付きURLで表示する（切れたら開き直す）
  useEffect(() => {
    setPhotoUrl(null);
    setPhotoError(false);
    if (!b?.photo_path) return;
    let alive = true;
    const path = b.photo_path;
    const refresh = async () => {
      const { data, error: e } = await client.storage.from('hair-photos').createSignedUrl(path, 60);
      if (!alive) return;
      if (e || !data) setPhotoError(true);
      else setPhotoUrl(data.signedUrl);
    };
    refresh();
    const timer = setInterval(refresh, 55_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [client, b?.photo_path]);

  async function act(action: Action) {
    if (!b) return;
    setBusy(true);
    setError(null);
    const { error: e } = await client.rpc('salon_update_booking', { p_booking_id: b.id, p_action: action });
    setBusy(false);
    if (e) {
      setError(toMessage(e));
      return;
    }
    requestDispatch(client);
    onChanged(
      {
        complete: `${b.contact_name} 様を来店済みにしました。`,
        no_show: `${b.contact_name} 様の無断キャンセルを記録しました。`,
        cancel_customer: 'お客様からのご連絡によるキャンセルとして記録しました。',
        cancel_salon: 'サロン都合でキャンセルしました。お客様へメールでお知らせします。',
      }[action],
    );
    onClose();
  }

  async function withdraw() {
    setBusy(true);
    setError(null);
    const { error: e } = await client.rpc('close_slot', { p_slot_id: slot.id });
    setBusy(false);
    if (e) {
      setError(toMessage(e));
      return;
    }
    onChanged(`${fmtTime(slot.start_at)} の枠を取り下げました。`);
    onClose();
  }

  const started = new Date(slot.start_at).getTime() <= now.getTime();
  const karte = b?.karte ?? {};

  const startTime = fmtTime(slot.start_at);

  return (
    <Sheet label={`${startTime}の枠の詳細`} onClose={onClose}>
      <div className={s.head}>
        <div className={s.when}>
          <p className={`${s.time} num`}>
            <span className={s.start}>{startTime}</span>
            <span className={s.end}>〜{fmtTime(slot.end_at)}</span>
          </p>
          <p className={s.meta}>
            {slot.menu?.name} ・ <span className="num">{fmtYen(slot.price)}</span>
            {slot.stylist && ` ・ 担当 ${slot.stylist.name}`}
          </p>
          <span className={`${s.state} ${stateClass(state)}`}>
            <StateIcon state={state} />
            {STATE_LABEL[state] ?? state}
          </span>
        </div>
        <Button variant="text" onClick={onClose}>
          閉じる
        </Button>
      </div>

      {b ? (
        <section className={`${s.guest} ${b.photo_path ? s.guestWithPhoto : ''}`} data-guest="" aria-label="予約したお客様">
          <div className={s.guestInfo}>
            <p className={s.guestName}>
              <User size={24} weight="fill" aria-hidden focusable="false" />
              {b.contact_name} 様
              {UI_OPTIONS.showBookingNo && b.booking_no !== null && (
                <span className={`${s.bookingNo} num`}>
                  <Ticket size={20} aria-hidden focusable="false" />
                  予約番号 {b.booking_no}
                </span>
              )}
            </p>
            <dl className={s.care}>
              <div className={s.careItem}>
                <dt>
                  <ChatCircle size={20} aria-hidden focusable="false" />
                  会話
                </dt>
                <dd>{label(CONVERSATION_PREFS, b.conversation_pref) || '—'}</dd>
              </div>
              {b.note && (
                <div className={s.careItem}>
                  <dt>
                    <NotePencil size={20} aria-hidden focusable="false" />
                    メモ
                  </dt>
                  <dd>{b.note}</dd>
                </div>
              )}
            </dl>
            <dl className={s.details}>
              <dt>電話</dt>
              <dd>
                {b.contact_phone ? (
                  <ButtonLink href={`tel:${b.contact_phone}`} variant="text" icon={Phone} className={s.tel}>
                    {b.contact_phone}
                  </ButtonLink>
                ) : (
                  '—'
                )}
              </dd>
              <dt>メール</dt>
              <dd className="break">{b.contact_email ?? '—'}</dd>
              <dt>髪質</dt>
              <dd>{karte.hair_type || '—'}</dd>
              <dt>カラー</dt>
              <dd>{karte.color_history || '—'}</dd>
              <dt>パーマ</dt>
              <dd>{karte.perm_history || '—'}</dd>
            </dl>
          </div>
          {b.photo_path && (
            <figure className={s.photo} data-guest-photo="">
              <span className={s.photoLabel}>
                <ImageIcon size={20} aria-hidden focusable="false" />
                写真
              </span>
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="お客様が共有した写真" />
              ) : (
                <div className={s.photoWait} aria-hidden />
              )}
              {photoError && (
                <Notice tone="danger" icon={WarningCircle}>
                  写真を表示できませんでした。
                </Notice>
              )}
              {b.photo_note && <figcaption>{b.photo_note}</figcaption>}
            </figure>
          )}
        </section>
      ) : (
        <p className={s.empty}>
          {slot.status === 'open' ? <Clock size={24} aria-hidden focusable="false" /> : <CalendarX size={24} aria-hidden focusable="false" />}
          {slot.status === 'open' ? 'まだ予約は入っていません。' : 'この枠は受付を終えています。'}
        </p>
      )}

      {error && (
        <Notice tone="danger" className={s.error}>
          {error}
        </Notice>
      )}

      {b?.status === 'confirmed' && mode === 'view' && (
        <div className={s.actions}>
          <Button variant="primary" size="lg" icon={SealCheck} disabled={busy} onClick={() => act('complete')}>
            来店済み
          </Button>
          <Button
            variant="danger"
            size="md"
            icon={Prohibit}
            disabled={busy || !started}
            onClick={() => setMode('no_show')}
            title={started ? undefined : '予約時刻を過ぎてから記録できます'}
          >
            無断キャンセル
          </Button>
          <Button variant="danger" size="md" icon={XCircle} disabled={busy} onClick={() => setMode('cancel')}>
            キャンセル
          </Button>
        </div>
      )}
      {b?.status === 'confirmed' && mode === 'view' && !started && (
        <p className={s.hint}>
          <Info size={20} aria-hidden focusable="false" />
          無断キャンセルは、予約時刻を過ぎてから記録できます。
        </p>
      )}

      {mode === 'cancel' && (
        <div className={s.confirm} data-confirm="">
          <p className={s.confirmHead}>
            <XCircle size={24} aria-hidden focusable="false" />
            キャンセルの理由を選んでください
          </p>
          <p className={s.confirmText}>どちらも無断キャンセルとしては記録しません。締切まで時間があれば、枠を公開に戻します。</p>
          <div className={s.choices}>
            <Button variant="secondary" size="md" block icon={Phone} disabled={busy} onClick={() => act('cancel_customer')}>
              お客様から連絡があった
            </Button>
            <Button variant="dangerSolid" size="md" block icon={Storefront} disabled={busy} onClick={() => act('cancel_salon')}>
              サロンの都合（お客様へメールでお知らせ）
            </Button>
            <Button variant="text" onClick={() => setMode('view')}>
              やめる
            </Button>
          </div>
        </div>
      )}

      {mode === 'no_show' && (
        <div className={s.confirm} data-confirm="">
          <p className={s.confirmHead}>
            <Prohibit size={24} aria-hidden focusable="false" />
            無断キャンセルとして記録しますか？
          </p>
          <p className={s.confirmText}>電話番号に紐づけて記録します。直近90日で2回になると、その方は新しい予約ができなくなります。</p>
          <Pair>
            <Button variant="secondary" size="md" onClick={() => setMode('view')}>
              やめる
            </Button>
            <Button variant="dangerSolid" size="md" disabled={busy} onClick={() => act('no_show')}>
              記録する
            </Button>
          </Pair>
        </div>
      )}

      {!b && slot.status === 'open' && (
        <div className={s.single}>
          <Button variant="danger" size="md" block icon={XCircle} disabled={busy} onClick={withdraw}>
            この枠を取り下げる
          </Button>
        </div>
      )}
    </Sheet>
  );
}
