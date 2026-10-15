'use client';

// 利用者のホーム：大きなボタン → 時間帯 → 候補3件（距離レーダーつき）→ ボトムシートで確認してスライドで確定

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { RemainBar } from '@/components/RemainRing';
import { ErrorState, Loading, NotConfigured } from '@/components/States';
import { useRoleSession } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import { bearingDeg, distanceKm, fmtDistance, type LatLng } from '@/lib/geo';
import { saveOrigin } from '@/lib/origin';
import { walkMinutes } from '@/lib/walk';
import Sheet from '@/components/Sheet';
import { ROLE_LABEL, pickThree, restByStart, type PickRole } from '@/lib/picks';
import { UI_OPTIONS } from '@/lib/ui-options';
import { WINDOWS, fmtDate, fmtRemaining, fmtTime, fmtYen, jstTodayEnd, minutesUntil, windowEnd, type WindowKey } from '@/lib/time';
import BookingForm from './BookingForm';
import Radar from './Radar';
import { useUserState } from './useUserState';
import VoiceSearch from './VoiceSearch';

type FoundSlot = {
  slot_id: string;
  start_at: string;
  end_at: string;
  deadline_at: string;
  price: number;
  menu_name: string;
  duration_min: number;
  salon_id: string;
  salon_name: string;
  salon_address: string;
  lat: number;
  lng: number;
  stylist_name: string | null;
};
type Shown = FoundSlot & { id: string; startMs: number; km: number | null; bearing: number | null; role: PickRole | null };

const WINDOW_SUB: Record<WindowKey, string> = {
  now: '30分以内に始まる',
  '1h': '60分以内に始まる',
  '3h': '3時間以内に始まる',
  today: '今日の最後まで',
};
const WIDER: Record<WindowKey, WindowKey | null> = { now: '1h', '1h': '3h', '3h': 'today', today: null };
const MORE = 3;

export default function UserHome() {
  const router = useRouter();
  const { client, session, ready } = useRoleSession('user');
  const { areas, profile, active, suspendedUntil, error: stateError, reload } = useUserState(client, session);

  const [step, setStep] = useState<'start' | 'pick' | 'results'>('start');
  const [win, setWin] = useState<WindowKey>('1h');
  const [menuWord, setMenuWord] = useState<string | null>(null);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [gps, setGps] = useState<LatLng | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [all, setAll] = useState<FoundSlot[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [moreCount, setMoreCount] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Shown | null>(null);
  const [frozen, setFrozen] = useState<{ list: Shown[]; gone: string[] } | null>(null);
  const [arrival, setArrival] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const lastShown = useRef<Shown[]>([]);
  const lastWinCount = useRef<number | null>(null);
  const cardRefs = useRef(new Map<string, HTMLLIElement>());

  const currentAreaId = areaId ?? profile?.area_id ?? areas[0]?.id ?? null;
  const currentArea = areas.find((a) => a.id === currentAreaId) ?? null;
  const origin = useMemo<(LatLng & { label: string }) | null>(
    () => (gps ? { ...gps, label: '現在地' } : currentArea ? { lat: currentArea.lat, lng: currentArea.lng, label: '基準地点' } : null),
    [gps, currentArea],
  );

  useEffect(() => {
    if (origin) saveOrigin(origin);
  }, [origin]);

  // 今日の空き（締切・性別・エリアは DB の関数で絞る）。時間帯ごとの件数も、ここから数える
  const search = useCallback(async () => {
    if (!client) return;
    const { data, error } = await client.rpc('search_open_slots', {
      p_until: jstTodayEnd().toISOString(),
      p_area_id: currentAreaId,
    });
    if (error) {
      setSearchError(toMessage(error));
      return;
    }
    setSearchError(null);
    setAll((data ?? []) as FoundSlot[]);
    setLoadedAt(new Date());
  }, [client, currentAreaId]);

  useEffect(() => {
    search();
  }, [search]);

  // サロンが枠を出す・ほかの人が予約する、の両方に追いつく（Realtime と定期的な読み直し）
  useEffect(() => {
    if (!client) return;
    const channel = client
      .channel('user-home-slots')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, () => search())
      // サロンの掲載が止まった・削除されたときも、すぐに読み直す（取り下げた枠の変更は利用者に届かないため）
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'listing_events' }, () => search())
      .subscribe();
    const timer = setInterval(search, 20_000);
    return () => {
      client.removeChannel(channel);
      clearInterval(timer);
    };
  }, [client, search]);

  const valid = useMemo(
    () =>
      (all ?? []).filter(
        (s) => new Date(s.deadline_at).getTime() > now.getTime() && (!menuWord || s.menu_name.includes(menuWord)),
      ),
    [all, now, menuWord],
  );
  const counts = useMemo(() => {
    const out = {} as Record<WindowKey, number>;
    for (const w of WINDOWS) out[w.key] = valid.filter((s) => new Date(s.start_at) < windowEnd(w.key, now)).length;
    return out;
  }, [valid, now]);

  const inWindow = useMemo<Shown[]>(
    () =>
      valid
        .filter((s) => new Date(s.start_at) < windowEnd(win, now))
        .map((s) => ({
          ...s,
          id: s.slot_id,
          startMs: new Date(s.start_at).getTime(),
          km: origin ? distanceKm(origin, { lat: s.lat, lng: s.lng }) : null,
          bearing: origin ? bearingDeg(origin, { lat: s.lat, lng: s.lng }) : null,
          role: null,
        })),
    [valid, win, now, origin],
  );
  const picks = useMemo(() => pickThree(inWindow, UI_OPTIONS.pickMode) as Shown[], [inWindow]);
  const rest = useMemo(() => restByStart(inWindow, picks), [inWindow, picks]);
  // 確認のシートを開いている間に、その枠が埋まった・締切を過ぎた
  const sheetGone = !!sheet && all !== null && !valid.some((s) => s.slot_id === sheet.slot_id);

  // 表示中の候補が、ほかの人の予約で消えたら「埋まりました」を見せてから、次の候補を差し込む
  useEffect(() => {
    if (step !== 'results' || frozen) return;
    const ids = new Set(valid.map((s) => s.slot_id));
    const gone = lastShown.current.filter(
      (s) => !ids.has(s.id) && new Date(s.deadline_at).getTime() > Date.now(),
    );
    if (gone.length > 0) {
      const before = lastShown.current;
      lastShown.current = picks;
      setFrozen({ list: before, gone: gone.map((g) => g.id) });
      setTimeout(() => setFrozen(null), 2600);
      return;
    }
    lastShown.current = picks;
  }, [valid, picks, step, frozen]);

  // 空きがない時間帯を開いている間に、空きが出たら知らせる
  useEffect(() => {
    if (step !== 'results') {
      lastWinCount.current = null;
      return;
    }
    const c = counts[win];
    if (UI_OPTIONS.emptyWatch && lastWinCount.current === 0 && c > 0) {
      setArrival('新しい空きが出ました');
      setTimeout(() => setArrival(null), 6000);
    }
    lastWinCount.current = c;
  }, [counts, win, step]);

  // 表示は分ごとに更新。受付の締切が5分を切った候補があれば、10秒ごとに
  const urgent = picks.some((p) => minutesUntil(p.deadline_at, now) <= 5);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), urgent ? 10_000 : 60_000);
    return () => clearInterval(t);
  }, [urgent]);

  function choose(key: WindowKey, word: string | null = null) {
    setWin(key);
    setMenuWord(word);
    setMoreCount(0);
    setSelected(null);
    setFrozen(null);
    lastShown.current = [];
    setStep('results');
  }

  function applyLocation() {
    setGpsError(null);
    if (!navigator.geolocation) {
      setGpsError('この端末では現在地を使えません。');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setGpsError('現在地を取得できませんでした。利用エリアの基準地点から距離を出します。'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }

  function openSheet(s: Shown) {
    if (!session) {
      router.push(`/login?next=${encodeURIComponent(`/book/${s.id}`)}`);
      return;
    }
    setSheet(s);
  }

  function focusCard(id: string) {
    setSelected(id);
    cardRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (!client) return <NotConfigured />;

  const shown = frozen?.list ?? picks;
  const extra = rest.slice(0, moreCount);
  const total = counts.today;

  return (
    <main className="app">
      <AppHeader role="利用者">
        {ready && session ? <Link href="/mypage">マイページ</Link> : <Link href="/login">ログイン</Link>}
      </AppHeader>

      {arrival && (
        <p className="arrival" role="status">
          {arrival}
        </p>
      )}
      {stateError && <ErrorState onRetry={reload}>{stateError}</ErrorState>}
      {suspendedUntil && (
        <div className="notice notice-error fade-in">
          無断キャンセルが続いたため、新しいご予約をお受けできません。
          <strong> {fmtDate(suspendedUntil)}から予約できます。</strong>
        </div>
      )}

      {active && active.slot ? (
        <Link href={`/booking/${active.id}`} className="active-card fade-in">
          <span className="active-label">ご予約中</span>
          <span className="active-time num">
            今日 {fmtTime(active.slot.start_at)}
            <em>{fmtRemaining(minutesUntil(active.slot.start_at, now))}</em>
          </span>
          <span className="active-sub">
            {active.slot.salon?.name} ・ {active.slot.menu?.name}
          </span>
          <span className="active-go">予約内容を見る →</span>
        </Link>
      ) : (
        <>
          {step === 'start' && (
            <section className="hero fade-in">
              <p className="hero-lead">空いた時間だけが、今から届く。</p>
              <button className="hero-button" onClick={() => setStep('pick')}>
                <span className="hero-count num" aria-live="polite">
                  {all === null ? '空きを確かめています' : total > 0 ? `今、近くで${total}件の空き` : '今は空きがありません'}
                </span>
                <span className="hero-button-main">
                  今から行ける
                  <br />
                  お店を探す
                </span>
                <span className="hero-button-sub">電話不要・店頭払い</span>
              </button>
              <p className="hero-note">今日の空き枠だけを、近い順にお届けします。</p>
              <VoiceSearch onResult={(key, word) => choose(key, word)} />
            </section>
          )}

          {step === 'pick' && (
            <section className="fade-in">
              <h1 className="screen-title">いつ行けますか？</h1>
              <div className="window-grid">
                {WINDOWS.map((w) => (
                  <button
                    key={w.key}
                    className={`window-option ${counts[w.key] === 0 ? 'is-empty' : ''}`}
                    aria-disabled={counts[w.key] === 0}
                    onClick={() => choose(w.key)}
                  >
                    <span className="window-count num">{all === null ? '…' : counts[w.key]}</span>
                    <span className="window-main">{w.label}</span>
                    <span className="window-sub">{counts[w.key] === 0 ? 'いまは空きなし' : WINDOW_SUB[w.key]}</span>
                  </button>
                ))}
              </div>
              <button className="btn btn-text" onClick={() => setStep('start')}>
                ← 戻る
              </button>
            </section>
          )}

          {step === 'results' && (
            <section className="fade-in">
              <div className="segmented" role="group" aria-label="時間帯">
                {WINDOWS.map((w) => (
                  <button key={w.key} aria-pressed={win === w.key} className={counts[w.key] === 0 ? 'is-empty' : ''} onClick={() => choose(w.key, menuWord)}>
                    {w.label}
                    <span className="seg-count num">{counts[w.key]}</span>
                  </button>
                ))}
              </div>

              <div className="origin">
                <span>
                  {gps ? '現在地から見た位置' : `${currentArea?.name ?? 'エリア'}の基準地点から見た位置`}
                  {menuWord && ` ・「${menuWord}」`}
                </span>
                <button className="btn btn-text btn-sm" onClick={gps ? () => setGps(null) : applyLocation}>
                  {gps ? '現在地を使わない' : '現在地を使う'}
                </button>
              </div>
              {!session && areas.length > 1 && (
                <label className="field">
                  <span className="sr-only">エリア</span>
                  <select className="select" value={currentAreaId ?? ''} onChange={(e) => setAreaId(e.target.value)}>
                    {areas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {gpsError && <p className="notice notice-info">{gpsError}</p>}

              {searchError && <ErrorState onRetry={search}>{searchError}</ErrorState>}
              {!searchError && all === null && <Loading rows={3} />}

              {all !== null && shown.length === 0 && (
                <div className="empty-watch card">
                  <p className="empty-title">この時間帯に行ける枠は、いまはありません</p>
                  {UI_OPTIONS.emptyWatch && (
                    <p className="empty-sub">
                      <span className="watch-dot" aria-hidden />
                      この画面を開いている間に空きが出たら、お知らせします。
                    </p>
                  )}
                  {WIDER[win] && (
                    <button className="btn btn-secondary btn-block" onClick={() => choose(WIDER[win]!, menuWord)}>
                      時間帯を広げる（{WINDOWS.find((w) => w.key === WIDER[win])?.label}・{counts[WIDER[win]!]}件）
                    </button>
                  )}
                </div>
              )}

              {all !== null && loadedAt && shown.length > 0 && (
                <p className="live-note num" aria-live="off">
                  <span className="watch-dot" aria-hidden />
                  空きの状況は自動で更新しています（{fmtTime(loadedAt)}時点）
                </p>
              )}

              {shown.length > 0 && origin && (
                <Radar
                  originLabel={origin.label}
                  selected={selected}
                  onSelect={focusCard}
                  points={shown
                    .filter((s) => s.km !== null && s.bearing !== null && !frozen?.gone.includes(s.id))
                    .map((s, i) => ({ id: s.id, no: i + 1, label: fmtTime(s.start_at), km: s.km!, bearing: s.bearing! }))}
                />
              )}

              {shown.length > 0 && (
                <ul className="slot-list">
                  {shown.map((s, i) => (
                    <SlotCard
                      key={s.id}
                      slot={s}
                      no={i + 1}
                      now={now}
                      gone={!!frozen?.gone.includes(s.id)}
                      selected={selected === s.id}
                      disabled={!!suspendedUntil}
                      onSelect={() => setSelected(s.id)}
                      onBook={() => openSheet(s)}
                      refFn={(el) => (el ? cardRefs.current.set(s.id, el) : cardRefs.current.delete(s.id))}
                    />
                  ))}
                </ul>
              )}

              {extra.length > 0 && (
                <>
                  <h2 className="section-title">ほかの枠（開始が早い順）</h2>
                  <ul className="slot-list">
                    {extra.map((s) => (
                      <SlotCard
                        key={s.id}
                        slot={s}
                        now={now}
                        gone={false}
                        selected={false}
                        disabled={!!suspendedUntil}
                        onSelect={() => undefined}
                        onBook={() => openSheet(s)}
                      />
                    ))}
                  </ul>
                </>
              )}
              {rest.length > moreCount && !frozen && (
                <button className="btn btn-secondary btn-block" onClick={() => setMoreCount((n) => n + MORE)}>
                  もっと見る（あと{rest.length - moreCount}件）
                </button>
              )}
              <p className="fine-print">
                現在地は使うと選んだときだけ、この端末の中で距離と方位の計算に使います。サーバーや地図サービスには送りません。受付の締切を過ぎた枠は表示されません。
              </p>
            </section>
          )}
        </>
      )}

      {sheet && session && (
        <Sheet label="予約の確認" title="予約の確認" narrow onClose={() => setSheet(null)}>
          <BookingForm
            client={client}
            session={session}
            slot={{ ...sheet, id: sheet.slot_id }}
            defaultPref={profile?.conversation_pref ?? null}
            activeBookingId={active?.id ?? null}
            suspendedUntil={suspendedUntil}
            now={now}
            unavailable={sheetGone ? 'この枠は予約できなくなりました（ほかの方の予約・受付の締切・お店の受付終了など）。' : null}
            onChooseOther={() => setSheet(null)}
            onBooked={(id) => router.push(`/booking/${id}?new=1`)}
            onUnavailable={search}
          />
        </Sheet>
      )}
    </main>
  );
}

function SlotCard({
  slot,
  no,
  now,
  gone,
  selected,
  disabled,
  onSelect,
  onBook,
  refFn,
}: {
  slot: Shown;
  no?: number;
  now: Date;
  gone: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onBook: () => void;
  refFn?: (el: HTMLLIElement | null) => void;
}) {
  const left = minutesUntil(slot.deadline_at, now);
  return (
    <li
      ref={refFn}
      className={`slot-card ${selected ? 'is-selected' : ''} ${gone ? 'is-gone' : ''}`}
      onClick={onSelect}
    >
      {(slot.role || no !== undefined) && (
        <div className="slot-top">
          {no !== undefined && <span className="slot-no num">{no}</span>}
          {slot.role && <span className={`role-tag role-${slot.role}`}>{ROLE_LABEL[slot.role]}</span>}
        </div>
      )}
      <div className="slot-row">
        <span className="slot-start num">{fmtTime(slot.start_at)}</span>
        <span className="slot-left num">開始まで{fmtRemaining(minutesUntil(slot.start_at, now)).replace('あと', '')}</span>
        <span className="slot-price">
          <span className="price-label">当日価格</span>
          <span className="num">{fmtYen(slot.price)}</span>
        </span>
      </div>
      <p className="slot-salon">
        {slot.salon_name}
        {slot.km !== null && (
          <span className="slot-walk num">
            徒歩約{walkMinutes(slot.km)}分・{fmtDistance(slot.km)}
          </span>
        )}
      </p>
      <p className="slot-meta">
        {slot.menu_name}・{slot.duration_min}分{slot.stylist_name && `・担当 ${slot.stylist_name}`}
      </p>
      <div className="slot-foot">
        <div className={`slot-deadline ${left <= 5 ? 'is-urgent' : ''}`}>
          <span className="num">予約受付 残り{Math.max(0, left)}分</span>
          <RemainBar fraction={left / 60} urgent={left <= 5} />
        </div>
        <button
          className="btn btn-primary slot-cta"
          disabled={disabled || gone}
          onClick={(e) => {
            e.stopPropagation();
            onBook();
          }}
          aria-label={`${fmtTime(slot.start_at)} ${slot.salon_name} を予約する`}
        >
          予約する
        </button>
      </div>
      {gone && (
        <div className="gone-veil" role="status">
          埋まりました
        </div>
      )}
    </li>
  );
}