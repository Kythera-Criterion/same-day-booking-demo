'use client';

// 予約の確認：メニュー・時刻・価格（店頭払い）を確かめ、任意で写真・メモ・会話の好みを添えて1タップで確定する

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { ErrorState, Loading, NotConfigured } from '@/components/States';
import { one, useRoleSession } from '@/lib/supabase';
import { errorCode, toMessage } from '@/lib/errors';
import { requestDispatch } from '@/lib/dispatch-client';
import { shrinkImage } from '@/lib/image';
import { CONVERSATION_PREFS } from '@/lib/profile-options';
import { fmtDate, fmtRemaining, fmtTime, fmtYen, minutesUntil } from '@/lib/time';
import { useUserState } from './useUserState';

type SlotDetail = {
  id: string;
  start_at: string;
  end_at: string;
  deadline_at: string;
  price: number;
  status: string;
  menu: { name: string; duration_min: number } | null;
  salon: { name: string; address: string } | null;
};

type RawSlot = Omit<SlotDetail, 'menu' | 'salon'> & {
  menus: SlotDetail['menu'] | NonNullable<SlotDetail['menu']>[];
  salons: SlotDetail['salon'] | NonNullable<SlotDetail['salon']>[];
};

export default function BookConfirm({ slotId }: { slotId: string }) {
  const router = useRouter();
  const { client, session, ready } = useRoleSession('user');
  const { profile, active, suspendedUntil } = useUserState(client, session);
  const [slot, setSlot] = useState<SlotDetail | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [pref, setPref] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [photoNote, setPhotoNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string | null; text: string } | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (ready && !session) router.replace(`/login?next=${encodeURIComponent(`/book/${slotId}`)}`);
  }, [ready, session, router, slotId]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!client) return;
    setLoadError(null);
    const { data, error: e } = await client
      .from('slots')
      .select('id,start_at,end_at,deadline_at,price,status,menus(name,duration_min),salons(name,address)')
      .eq('id', slotId)
      .maybeSingle();
    if (e) {
      setLoadError(toMessage(e));
      return;
    }
    const raw = data as RawSlot | null;
    setSlot(raw ? { ...raw, menu: one(raw.menus), salon: one(raw.salons) } : null);
  }, [client, slotId]);

  useEffect(() => {
    load();
  }, [load]);

  const conversation = pref ?? profile?.conversation_pref ?? 'either';

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
    if (!client || !session || !slot) return;
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
      setBusy(false);
      setError({ code: errorCode(bookError), text: toMessage(bookError) });
      if (errorCode(bookError) === 'already_booked' || errorCode(bookError) === 'too_late') load();
      return;
    }
    requestDispatch(client);
    router.replace(`/booking/${(data as { id: string }).id}?new=1`);
  }

  if (!client) return <NotConfigured />;

  const closed = slot && (slot.status !== 'open' || new Date(slot.deadline_at).getTime() <= now.getTime());

  return (
    <main className="app">
      <AppHeader role="利用者">
        <Link href="/">戻る</Link>
      </AppHeader>

      <h1 className="screen-title">予約の確認</h1>

      {loadError && <ErrorState onRetry={load}>{loadError}</ErrorState>}
      {slot === undefined && !loadError && <Loading rows={2} />}
      {slot === null && (
        <div className="card">
          <p className="card-title">この枠は見つかりませんでした</p>
          <p className="card-sub">ほかの方の予約が入ったか、受付が終わった可能性があります。</p>
          <Link href="/" className="btn btn-secondary btn-block">
            ほかの枠を探す
          </Link>
        </div>
      )}

      {slot && (
        <div className="stack fade-in">
          <section className="ticket">
            <p className="ticket-date">{fmtDate(slot.start_at)}（今日）</p>
            <p className="ticket-time num">
              {fmtTime(slot.start_at)}
              <span>〜{fmtTime(slot.end_at)}</span>
            </p>
            <p className="ticket-left">開始まで {fmtRemaining(minutesUntil(slot.start_at, now))}</p>
            <dl className="ticket-dl">
              <dt>お店</dt>
              <dd>
                {slot.salon?.name}
                <small>{slot.salon?.address}</small>
              </dd>
              <dt>メニュー</dt>
              <dd>
                {slot.menu?.name}
                <small>所要 {slot.menu?.duration_min}分</small>
              </dd>
              <dt>当日価格</dt>
              <dd className="ticket-price num">
                {fmtYen(slot.price)}
                <small>お支払いは店頭で</small>
              </dd>
            </dl>
          </section>

          {closed ? (
            <div className="card">
              <p className="card-title">この枠の受付は終わりました</p>
              <Link href="/" className="btn btn-secondary btn-block">
                ほかの枠を探す
              </Link>
            </div>
          ) : (
            <>
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
                      <button className="btn btn-quiet btn-sm" onClick={() => setPhoto(null)}>
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
                    <input className="input" maxLength={200} value={photoNote} onChange={(e) => setPhotoNote(e.target.value)} placeholder="例：前髪だけこの長さに" />
                  </label>
                )}

                <label className="field">
                  <span className="field-label">ご予約のメモ</span>
                  <textarea className="textarea" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：前髪は短めにしたい" />
                </label>

                <div className="field">
                  <span className="field-label">施術中の会話</span>
                  <div className="segmented" role="group" aria-label="施術中の会話">
                    {CONVERSATION_PREFS.map((c) => (
                      <button key={c.value} aria-pressed={conversation === c.value} onClick={() => setPref(c.value)}>
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
                  {error.code === 'has_active_booking' && active && (
                    <>
                      {' '}
                      <Link href={`/booking/${active.id}`}>ご予約中の内容を見る</Link>
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

              <div className="sticky-cta">
                <button className="btn btn-primary btn-lg btn-block" disabled={busy || !session || !!suspendedUntil} onClick={confirm}>
                  {busy ? '予約しています…' : 'この内容で予約する'}
                </button>
                <p className="sticky-cta-note">変更・キャンセルはお店へ直接お電話ください。</p>
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}
