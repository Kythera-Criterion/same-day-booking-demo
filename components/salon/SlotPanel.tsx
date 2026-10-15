'use client';

// 枠・予約の詳細：予約者の情報（第3章8の範囲）と、共有された写真。来店済み・無断キャンセル・キャンセル（理由を選ぶ）

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Sheet from '@/components/Sheet';
import { toMessage } from '@/lib/errors';
import { requestDispatch } from '@/lib/dispatch-client';
import { CONVERSATION_PREFS, label } from '@/lib/profile-options';
import { fmtTime, fmtYen } from '@/lib/time';
import { UI_OPTIONS } from '@/lib/ui-options';
import { activeBooking, type SalonSlot } from './useSalonData';
import { STATE_LABEL, slotState } from './Timeline';

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

  return (
    <Sheet label={`${fmtTime(slot.start_at)}の枠の詳細`} onClose={onClose}>
        <div className="row-between">
          <div>
            <p className="panel-time num">
              {fmtTime(slot.start_at)}〜{fmtTime(slot.end_at)}
            </p>
            <p className="card-sub" style={{ margin: 0 }}>
              {slot.menu?.name} ・ {fmtYen(slot.price)}
              {slot.stylist && ` ・ 担当 ${slot.stylist.name}`}
            </p>
          </div>
          <div className="panel-side">
            <span className={`pill pill-${state}`}>{STATE_LABEL[state] ?? state}</span>
            <button type="button" className="btn btn-text btn-sm" onClick={onClose}>
              閉じる
            </button>
          </div>
        </div>

        {b ? (
          <div className="guest">
            <p className="guest-name">
              {b.contact_name} 様
              {UI_OPTIONS.showBookingNo && b.booking_no !== null && <span className="no-tag num">予約番号 {b.booking_no}</span>}
            </p>
            <dl className="detail-dl">
              <dt>電話</dt>
              <dd>{b.contact_phone ? <a href={`tel:${b.contact_phone}`}>{b.contact_phone}</a> : '—'}</dd>
              <dt>メール</dt>
              <dd className="break">{b.contact_email ?? '—'}</dd>
              <dt>会話</dt>
              <dd>{label(CONVERSATION_PREFS, b.conversation_pref) || '—'}</dd>
              <dt>髪質</dt>
              <dd>{karte.hair_type || '—'}</dd>
              <dt>カラー</dt>
              <dd>{karte.color_history || '—'}</dd>
              <dt>パーマ</dt>
              <dd>{karte.perm_history || '—'}</dd>
              {b.note && (
                <>
                  <dt>メモ</dt>
                  <dd>{b.note}</dd>
                </>
              )}
            </dl>
            {b.photo_path && (
              <figure className="guest-photo">
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrl} alt="お客様が共有した写真" />
                ) : (
                  <div className="skeleton" style={{ height: 160 }} />
                )}
                {photoError && <figcaption className="notice notice-error">写真を表示できませんでした。</figcaption>}
                {b.photo_note && <figcaption>{b.photo_note}</figcaption>}
              </figure>
            )}
          </div>
        ) : (
          <p className="card-sub" style={{ marginTop: 12 }}>
            {slot.status === 'open' ? 'まだ予約は入っていません。' : 'この枠は受付を終えています。'}
          </p>
        )}

        {error && <p className="notice notice-error">{error}</p>}

        {b?.status === 'confirmed' && mode === 'view' && (
          <div className="sheet-actions sheet-actions-3">
            <button className="btn btn-primary" disabled={busy} onClick={() => act('complete')}>
              来店済み
            </button>
            <button className="btn btn-secondary" disabled={busy || !started} onClick={() => setMode('no_show')} title={started ? undefined : '予約時刻を過ぎてから記録できます'}>
              無断キャンセル
            </button>
            <button className="btn btn-danger" disabled={busy} onClick={() => setMode('cancel')}>
              キャンセル
            </button>
          </div>
        )}
        {b?.status === 'confirmed' && mode === 'view' && !started && (
          <p className="fine-print">無断キャンセルは、予約時刻を過ぎてから記録できます。</p>
        )}

        {mode === 'cancel' && (
          <div className="confirm-box">
            <p className="card-title">キャンセルの理由を選んでください</p>
            <p className="card-sub">どちらも無断キャンセルとしては記録しません。締切まで時間があれば、枠を公開に戻します。</p>
            <div className="stack">
              <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => act('cancel_customer')}>
                お客様から連絡があった
              </button>
              <button className="btn btn-danger btn-block" disabled={busy} onClick={() => act('cancel_salon')}>
                サロンの都合（お客様へメールでお知らせ）
              </button>
              <button className="btn btn-text" onClick={() => setMode('view')}>
                やめる
              </button>
            </div>
          </div>
        )}

        {mode === 'no_show' && (
          <div className="confirm-box">
            <p className="card-title">無断キャンセルとして記録しますか？</p>
            <p className="card-sub">電話番号に紐づけて記録します。直近90日で2回になると、その方は新しい予約ができなくなります。</p>
            <div className="action-pair">
              <button className="btn btn-quiet" onClick={() => setMode('view')}>
                やめる
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => act('no_show')}>
                記録する
              </button>
            </div>
          </div>
        )}

        {!b && slot.status === 'open' && (
          <div className="sheet-actions">
            <button className="btn btn-secondary btn-block" disabled={busy} onClick={withdraw}>
              この枠を取り下げる
            </button>
          </div>
        )}
    </Sheet>
  );
}
