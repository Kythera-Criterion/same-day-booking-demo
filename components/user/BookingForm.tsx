'use client';

// 予約の確認と確定（ボトムシートと単独のページで共通）。
// 内容・受付の締切・「変更・キャンセルはお店へ直接お電話ください」「お支払いは店頭で」を見せてから、スライドで確定する

import { useState } from 'react';
import Link from 'next/link';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { errorCode, toMessage } from '@/lib/errors';
import { requestDispatch } from '@/lib/dispatch-client';
import { shrinkImage } from '@/lib/image';
import { CONVERSATION_PREFS } from '@/lib/profile-options';
import { fmtDate, fmtRemaining, fmtTime, fmtYen, minutesUntil } from '@/lib/time';
import SlideToConfirm from './SlideToConfirm';

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
};

export default function BookingForm({
  client,
  session,
  slot,
  defaultPref,
  activeBookingId,
  suspendedUntil,
  now,
  onBooked,
  onUnavailable,
}: {
  client: SupabaseClient;
  session: Session;
  slot: BookTarget;
  defaultPref: string | null;
  activeBookingId: string | null;
  suspendedUntil: string | null;
  now: Date;
  onBooked: (bookingId: string) => void;
  onUnavailable?: () => void;
}) {
  const [note, setNote] = useState('');
  const [pref, setPref] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [photoNote, setPhotoNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string | null; text: string } | null>(null);

  const conversation = pref ?? defaultPref ?? 'either';
  const deadlineLeft = minutesUntil(slot.deadline_at, now);

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
      if (code === 'already_booked' || code === 'too_late') onUnavailable?.();
      return;
    }
    requestDispatch(client);
    onBooked((data as { id: string }).id);
  }

  return (
    <div className="stack">
      <section className="ticket">
        <p className="ticket-date">{fmtDate(slot.start_at)}（今日）</p>
        <p className="ticket-time num">
          {fmtTime(slot.start_at)}
          <span>〜{fmtTime(slot.end_at)}</span>
        </p>
        <p className="ticket-left num">開始まで {fmtRemaining(minutesUntil(slot.start_at, now))}</p>
        <dl className="ticket-dl">
          <dt>お店</dt>
          <dd>
            {slot.salon_name}
            <small>{slot.salon_address}</small>
          </dd>
          <dt>メニュー</dt>
          <dd>
            {slot.menu_name}
            <small>所要 {slot.duration_min}分</small>
          </dd>
          <dt>当日価格</dt>
          <dd className="ticket-price num">{fmtYen(slot.price)}</dd>
        </dl>
      </section>

      <ul className="promise">
        <li>
          <strong>お支払いは店頭で</strong>
          <span>アプリでのお支払いはありません。</span>
        </li>
        <li>
          <strong>変更・キャンセルはお店へ直接お電話ください</strong>
          <span>アプリからはキャンセルできません。</span>
        </li>
        <li className={deadlineLeft <= 5 ? 'is-urgent' : ''}>
          <strong className="num">受付の締切 {fmtTime(slot.deadline_at)}</strong>
          <span className="num">{deadlineLeft > 0 ? `あと${deadlineLeft}分で受付が終わります。` : 'まもなく受付が終わります。'}</span>
        </li>
      </ul>

      <details className="card optional">
        <summary>
          <span>お店に伝えること（任意）</span>
          <small>写真1枚・メモ・会話の好み</small>
        </summary>
        <div className="field">
          <span className="field-label">なりたい髪型の写真（1枚）</span>
          {photo ? (
            <div className="photo-pick">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="添える写真" />
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPhoto(null)}>
                外す
              </button>
            </div>
          ) : (
            <label className="btn btn-quiet btn-block">
              写真を選ぶ
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => pickPhoto(e.target.files?.[0])} />
            </label>
          )}
          <span className="field-hint">この予約のお店だけが見られます（表示のたびに60秒で切れるリンクを使います）。</span>
        </div>
        {photo && (
          <label className="field">
            <span className="field-label">写真へのメモ</span>
            <input className="input" maxLength={200} value={photoNote} onChange={(e) => setPhotoNote(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span className="field-label">ご予約のメモ</span>
          <textarea className="textarea" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          <span className="field-hint">例：前髪は短めにしたい</span>
        </label>
        <div className="field">
          <span className="field-label">施術中の会話</span>
          <div className="choice-row" role="group" aria-label="施術中の会話">
            {CONVERSATION_PREFS.map((c) => (
              <button type="button" key={c.value} className="choice" aria-pressed={conversation === c.value} onClick={() => setPref(c.value)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </details>

      <p className="fine-print">
        お店には、お名前・電話番号・メールアドレス・カルテ・会話の好み・上の内容をお伝えします。性別・年代・職業・現在地はお伝えしません。
      </p>

      {error && (
        <div className="notice notice-error" role="alert">
          {error.text}
          {error.code === 'has_active_booking' && activeBookingId && (
            <>
              {' '}
              <Link href={`/booking/${activeBookingId}`}>ご予約中の内容を見る</Link>
            </>
          )}
          {error.code === 'phone_required' && (
            <>
              {' '}
              <Link href="/mypage">マイページへ</Link>
            </>
          )}
        </div>
      )}
      {suspendedUntil && <p className="notice notice-error">{fmtDate(suspendedUntil)}から予約できます。</p>}

      <SlideToConfirm label="スライドして予約を確定" busy={busy} disabled={!!suspendedUntil || deadlineLeft < 0} onConfirm={confirm} />
    </div>
  );
}
