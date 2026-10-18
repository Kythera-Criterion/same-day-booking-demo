'use client';

// 予約の確認と確定（ボトムシートと単独のページで共通）。
// 1回のスクロールで読める「詳細シート」：①写真（シートの上・呼び出し側）②お店・住所・徒歩 ③今日の空き（時刻のチップ）
// ④メニューと当日価格 ⑤担当 ⑥お店のルール（店頭払い・キャンセルはお店に電話・受付締切）を見せてから、スライドで確定する

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import Button, { ButtonLink } from '@/components/ui/Button';
import { Field, formClass, Input, LabeledField, Textarea } from '@/components/ui/Form';
import Label from '@/components/ui/Label';
import { Fine, Stack } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import Price from '@/components/ui/Price';
import {
  Camera,
  Clock,
  Hourglass,
  MapPin,
  NavigationArrow,
  NotePencil,
  PersonSimpleWalk,
  Phone,
  Scissors,
  ShieldCheck,
  Storefront,
  Timer,
  User,
  Wallet,
} from '@/components/ui/icons';
import { errorCode, toMessage } from '@/lib/errors';
import { requestDispatch } from '@/lib/dispatch-client';
import { shrinkImage } from '@/lib/image';
import { CONVERSATION_PREFS } from '@/lib/profile-options';
import { fmtDate, fmtRemaining, fmtTime, minutesUntil } from '@/lib/time';
import SlideToConfirm from './SlideToConfirm';
import s from './BookingForm.module.css';

export type BookTarget = {
  id: string;
  start_at: string;
  end_at: string;
  deadline_at: string;
  price: number;
  menu_name: string;
  duration_min: number;
  salon_name: string;
  salon_address: string;
  lat?: number;
  lng?: number;
};

export type Alternative = { id: string; start_at: string; menu_name: string };

// 受付締切までこの分数を切ったら、時間の色で知らせる
const URGENT_MIN = 15;

export default function BookingForm({
  client,
  session,
  slot,
  defaultPref,
  activeBookingId,
  suspendedUntil,
  now,
  unavailable = null,
  unavailableExtra = null,
  profileMissing = false,
  walk = null,
  stylist = null,
  condition = null,
  alternatives = [],
  stickyConfirm = false,
  onSwitch,
  onChooseOther,
  onBooked,
  onUnavailable,
}: {
  profileMissing?: boolean;
  client: SupabaseClient;
  session: Session;
  slot: BookTarget;
  defaultPref: string | null;
  activeBookingId: string | null;
  suspendedUntil: string | null;
  now: Date;
  unavailable?: string | null;
  // 予約できなくなったときに、お知らせの下に添えるもの（キャンセル待ちのボタン）
  unavailableExtra?: ReactNode;
  walk?: { min: number; label: string } | null;
  stylist?: string | null;
  condition?: string | null;
  alternatives?: Alternative[];
  stickyConfirm?: boolean;
  onSwitch?: (slotId: string) => void;
  onChooseOther?: () => void;
  onBooked: (bookingId: string) => void;
  onUnavailable?: () => void;
}) {
  const [note, setNote] = useState('');
  const [pref, setPref] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [photoNote, setPhotoNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState(false);
  const [error, setError] = useState<{ code: string | null; text: string } | null>(null);

  const conversation = pref ?? defaultPref ?? 'either';
  const deadlineLeft = minutesUntil(slot.deadline_at, now);
  const urgent = deadlineLeft <= URGENT_MIN;
  const chips = alternatives.some((a) => a.id === slot.id) ? alternatives : [{ id: slot.id, start_at: slot.start_at, menu_name: slot.menu_name }, ...alternatives];

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await shrinkImage(file);
      if (photo) URL.revokeObjectURL(photo.url);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setError({ code: null, text: 'この写真は読み込めませんでした。別の写真をお選びください。' });
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    let photoPath: string | null = null;
    if (photo) {
      photoPath = `${session.user.id}/${crypto.randomUUID()}.jpg`;
      const { error: upError } = await client.storage
        .from('hair-photos')
        .upload(photoPath, photo.blob, { contentType: 'image/jpeg', upsert: false });
      if (upError) {
        setBusy(false);
        setError({ code: null, text: '写真を送れませんでした。写真を外すか、もう一度お試しください。' });
        return;
      }
    }
    const { data, error: bookError } = await client.rpc('book_slot', {
      p_slot_id: slot.id,
      p_note: note.trim() || null,
      p_photo_path: photoPath,
      p_photo_note: photoPath ? photoNote.trim() || null : null,
      p_conversation_pref: conversation,
    });
    if (bookError) {
      if (photoPath) await client.storage.from('hair-photos').remove([photoPath]);
      const code = errorCode(bookError);
      setBusy(false);
      setError({ code, text: toMessage(bookError) });
      if (code === 'already_booked' || code === 'too_late' || code === 'slot_not_found' || code === 'slot_closed') onUnavailable?.();
      return;
    }
    setBooked(true);
    requestDispatch(client);
    onBooked((data as { id: string }).id);
  }

  const mapUrl = slot.lat !== undefined && slot.lng !== undefined ? `https://www.google.com/maps/search/?api=1&query=${slot.lat},${slot.lng}` : null;

  return (
    <Stack gap={3}>
      {unavailable && !busy && !booked && (
        <div className={s.alert}>
          <Notice tone="danger" role="alert">
            {unavailable}
          </Notice>
          {unavailableExtra}
        </div>
      )}

      <div className={s.when}>
        <span className={s.start}>{fmtTime(slot.start_at)}</span>
        <span className={`${s.end} num`}>〜{fmtTime(slot.end_at)}</span>
        <span className={`${s.until} num`}>
          <Timer size={20} aria-hidden focusable="false" />
          {fmtDate(slot.start_at)}（今日）・開始まで {fmtRemaining(minutesUntil(slot.start_at, now))}
        </span>
      </div>

      <ul className={s.sections}>
        {/* ② お店・住所・徒歩 */}
        <li className={s.section}>
          <Storefront size={20} aria-hidden focusable="false" />
          <h3 className={s.sectionTitle}>お店</h3>
          <div className={`${s.sectionBody} ${s.placeRow}`}>
            <div className={s.textStack}>
              <span className={s.strong}>{slot.salon_name}</span>
              <span className={s.sub}>
                <span>
                  <MapPin size={20} aria-hidden focusable="false" />
                  {slot.salon_address}
                </span>
                {walk && (
                  <span className="num">
                    <PersonSimpleWalk size={20} aria-hidden focusable="false" />
                    徒歩約{walk.min}分・{walk.label}
                  </span>
                )}
              </span>
              {condition && (
                <span>
                  <Label kind="condition">{condition}</Label>
                </span>
              )}
            </div>
            {mapUrl && (
              <ButtonLink href={mapUrl} variant="secondary" icon={NavigationArrow} target="_blank" rel="noopener noreferrer" aria-label="お店の場所を地図で見る">
                地図
              </ButtonLink>
            )}
          </div>
        </li>

        {/* ③ 今日の空き（このお店） */}
        <li className={s.section}>
          <Clock size={20} aria-hidden focusable="false" />
          <h3 className={s.sectionTitle}>今日の空き（このお店）</h3>
          <div className={s.sectionBody}>
            <ul className={s.chips} aria-label="このお店の今日の空き枠">
              {chips.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={s.chip}
                    aria-pressed={c.id === slot.id}
                    disabled={busy || booked || !onSwitch}
                    onClick={() => c.id !== slot.id && onSwitch?.(c.id)}
                    aria-label={`${fmtTime(c.start_at)} ${c.menu_name}${c.id === slot.id ? '（選んでいる枠）' : 'に切り替える'}`}
                  >
                    <span className={s.chipTime}>{fmtTime(c.start_at)}</span>
                    <span className={s.chipMenu}>{c.menu_name.replace(/（.*?）/g, '')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </li>

        {/* ④ メニューと当日価格 */}
        <li className={s.section}>
          <Scissors size={20} aria-hidden focusable="false" />
          <h3 className={s.sectionTitle}>メニュー</h3>
          <div className={`${s.sectionBody} ${s.menuRow}`}>
            <div className={s.textStack}>
              <span className={s.strong}>{slot.menu_name}</span>
              <span className={`${s.sub} num`}>所要 {slot.duration_min}分</span>
            </div>
            <Price value={slot.price} size="lg" />
          </div>
        </li>

        {/* ⑤ 担当 */}
        <li className={s.section}>
          <User size={20} aria-hidden focusable="false" />
          <h3 className={s.sectionTitle}>担当</h3>
          <div className={s.sectionBody}>
            <span className={s.sub}>{stylist ?? '指定なし（お店にお任せ）'}</span>
          </div>
        </li>

        {/* ⑥ お店のルール */}
        <li className={s.section}>
          <ShieldCheck size={20} aria-hidden focusable="false" />
          <h3 className={s.sectionTitle}>お店のルール</h3>
          <ul className={`${s.sectionBody} ${s.rules}`}>
            <li className={s.rule}>
              <Wallet size={20} aria-hidden focusable="false" />
              <span>
                <strong>お支払いは店頭で</strong>（アプリでのお支払いはありません）
              </span>
            </li>
            <li className={s.rule}>
              <Phone size={20} aria-hidden focusable="false" />
              <span>
                <strong>変更・キャンセルはお店へ直接お電話ください</strong>（アプリからはキャンセルできません）
              </span>
            </li>
            <li className={s.rule} data-urgent={urgent ? 'true' : undefined}>
              <Hourglass size={20} weight={urgent ? 'duotone' : 'regular'} aria-hidden focusable="false" />
              <span className="num">
                <strong>受付の締切 {fmtTime(slot.deadline_at)}</strong>
                {deadlineLeft > 0 ? `（あと${deadlineLeft}分で受付が終わります）` : '（まもなく受付が終わります）'}
              </span>
            </li>
          </ul>
        </li>
      </ul>

      <details className={s.optional}>
        <summary>
          <NotePencil size={20} aria-hidden focusable="false" />
          お店に伝えること（任意）
          <small>写真1枚・メモ・会話の好み</small>
        </summary>
        <div className={s.optionalBody}>
          <Field label="なりたい髪型の写真（1枚）" hint="この予約のお店だけが見られます（表示のたびに60秒で切れるリンクを使います）。">
            {photo ? (
              <div className={s.photoPick}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="添える写真" />
                <Button variant="quiet" onClick={() => setPhoto(null)}>
                  外す
                </Button>
              </div>
            ) : (
              <label className={`${formClass.choice} ${s.pickButton}`}>
                <Camera size={20} aria-hidden focusable="false" />
                写真を選ぶ
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => pickPhoto(e.target.files?.[0])} />
              </label>
            )}
          </Field>
          {photo && (
            <LabeledField label="写真へのメモ">
              <Input maxLength={200} value={photoNote} onChange={(e) => setPhotoNote(e.target.value)} />
            </LabeledField>
          )}
          <LabeledField label="ご予約のメモ" hint="例：前髪は短めにしたい">
            <Textarea maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </LabeledField>
          <Field label="施術中の会話">
            <div className={formClass.choices} role="group" aria-label="施術中の会話">
              {CONVERSATION_PREFS.map((c) => (
                <button type="button" key={c.value} className={formClass.choice} aria-pressed={conversation === c.value} onClick={() => setPref(c.value)}>
                  {c.label}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </details>

      <Fine>お店には、お名前・電話番号・メールアドレス・カルテ・会話の好み・上の内容をお伝えします。性別・年代・職業・現在地はお伝えしません。</Fine>

      {error && (
        <Notice tone="danger" role="alert">
          {error.text}
          {error.code === 'has_active_booking' && activeBookingId && (
            <>
              {' '}
              <Link href={`/booking/${activeBookingId}`}>ご予約中の内容を見る</Link>
            </>
          )}
          {(error.code === 'phone_required' || error.code === 'adult_required') && (
            <>
              {' '}
              <Link href={`/signup/complete?next=${encodeURIComponent(`/book/${slot.id}`)}`}>登録を仕上げる</Link>
            </>
          )}
        </Notice>
      )}
      {suspendedUntil && (
        <Notice tone="danger">
          {fmtDate(suspendedUntil)} {fmtTime(suspendedUntil)}から予約できます。
        </Notice>
      )}

      <div className={stickyConfirm ? s.confirm : undefined}>
        {profileMissing && !unavailable ? (
          <Stack gap={2}>
            <Notice tone="info">ご予約の前に、電話番号・18歳以上の確認など、登録の仕上げが必要です（1分ほどで終わります）。</Notice>
            <ButtonLink variant="primary" size="lg" block href={`/signup/complete?next=${encodeURIComponent(`/book/${slot.id}`)}`}>
              登録を仕上げて予約へ進む
            </ButtonLink>
          </Stack>
        ) : unavailable && !busy && !booked && onChooseOther ? (
          <Button variant="primary" size="lg" block onClick={onChooseOther}>
            ほかの枠を選ぶ
          </Button>
        ) : (
          <SlideToConfirm
            label="スライドして予約を確定"
            busy={busy || booked}
            disabled={!!suspendedUntil || deadlineLeft < 0 || (!!unavailable && !busy && !booked)}
            onConfirm={confirm}
          />
        )}
      </div>
    </Stack>
  );
}
