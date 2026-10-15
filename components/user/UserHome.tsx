'use client';

// 利用者のホーム：大きなボタン1つ → 時間帯を選ぶ → 今行ける枠が近い順に最大3件（「もっと見る」で続き）

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { Empty, ErrorState, Loading, NotConfigured } from '@/components/States';
import { useRoleSession } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import { distanceKm, fmtDistance, type LatLng } from '@/lib/geo';
import { WINDOWS, fmtDate, fmtRemaining, fmtTime, fmtYen, minutesUntil, windowEnd, type WindowKey } from '@/lib/time';
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
};

const WINDOW_SUB: Record<WindowKey, string> = {
  now: '30分以内',
  '1h': '60分以内に始まる枠',
  '3h': '3時間以内に始まる枠',
  today: '今日の最後まで',
};

const PAGE = 3;

export default function UserHome() {
  const router = useRouter();
  const { client, session, ready } = useRoleSession('user');
  const { areas, profile, active, suspendedUntil, loaded, error: stateError, reload } = useUserState(client, session);

  const [step, setStep] = useState<'start' | 'pick' | 'results'>('start');
  const [win, setWin] = useState<WindowKey>('1h');
  const [menuWord, setMenuWord] = useState<string | null>(null);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [gps, setGps] = useState<LatLng | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [slots, setSlots] = useState<FoundSlot[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const [now, setNow] = useState(() => new Date());

  // 利用エリア：ログイン中はプロフィールのエリア、そうでなければ最初のエリア
  const currentAreaId = areaId ?? profile?.area_id ?? areas[0]?.id ?? null;
  const currentArea = areas.find((a) => a.id === currentAreaId) ?? null;

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const search = useCallback(async () => {
    if (!client || step !== 'results') return;
    setSearchError(null);
    const { data, error } = await client.rpc('search_open_slots', {
      p_until: windowEnd(win, new Date()).toISOString(),
      p_area_id: currentAreaId,
    });
    if (error) {
      setSearchError(toMessage(error));
      return;
    }
    setSlots((prev) => {
      const next = (data ?? []) as FoundSlot[];
      if (prev) {
        const known = new Set(prev.map((s) => s.slot_id));
        const added = next.filter((s) => !known.has(s.slot_id)).map((s) => s.slot_id);
        if (added.length > 0) setFreshIds(added);
      }
      return next;
    });
  }, [client, step, win, currentAreaId]);

  useEffect(() => {
    search();
  }, [search]);

  // サロンが枠を出した瞬間に一覧へ反映する。締切や他の人の予約に備えて、20秒ごとにも読み直す
  useEffect(() => {
    if (!client || step !== 'results') return;
    const channel = client
      .channel('user-home-slots')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, () => search())
      .subscribe();
    const timer = setInterval(search, 20_000);
    return () => {
      client.removeChannel(channel);
      clearInterval(timer);
    };
  }, [client, step, search]);

  const origin = useMemo<LatLng | null>(
    () => gps ?? (currentArea ? { lat: currentArea.lat, lng: currentArea.lng } : null),
    [gps, currentArea],
  );

  const sorted = useMemo(() => {
    if (!slots) return null;
    const word = menuWord;
    return slots
      .filter((s) => new Date(s.deadline_at).getTime() > now.getTime())
      .filter((s) => !word || s.menu_name.includes(word))
      .map((s) => ({ ...s, km: origin ? distanceKm(origin, { lat: s.lat, lng: s.lng }) : null }))
      .sort((a, b) => (a.km ?? 999) - (b.km ?? 999) || a.start_at.localeCompare(b.start_at));
  }, [slots, origin, now, menuWord]);

  function choose(key: WindowKey, word: string | null = null) {
    setWin(key);
    setMenuWord(word);
    setShown(PAGE);
    setSlots(null);
    setFreshIds([]);
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
      () => setGpsError('現在地を取得できませんでした。エリアの基準地点から距離を出します。'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }

  function openSlot(id: string) {
    const target = `/book/${id}`;
    router.push(session ? target : `/login?next=${encodeURIComponent(target)}`);
  }

  if (!client) return <NotConfigured />;

  return (
    <main className="app">
      <AppHeader role="利用者">
        {ready && session ? (
          <Link href="/mypage">マイページ</Link>
        ) : (
          <Link href="/login">ログイン</Link>
        )}
      </AppHeader>

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
                <span className="hero-button-main">今から行ける<br />お店を探す</span>
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
                  <button key={w.key} className="window-option" onClick={() => choose(w.key)}>
                    <span className="window-main">{w.label}</span>
                    <span className="window-sub">{WINDOW_SUB[w.key]}</span>
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
                  <button key={w.key} aria-pressed={win === w.key} onClick={() => choose(w.key, menuWord)}>
                    {w.label}
                  </button>
                ))}
              </div>

              <div className="origin">
                <span>
                  {gps ? '現在地から近い順' : `${currentArea?.name ?? 'エリア'}の基準地点から近い順`}
                  {menuWord && ` ・「${menuWord}」`}
                </span>
                {gps ? (
                  <button className="btn btn-text btn-sm" onClick={() => setGps(null)}>
                    現在地を使わない
                  </button>
                ) : (
                  <button className="btn btn-text btn-sm" onClick={applyLocation}>
                    現在地を使う
                  </button>
                )}
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
              {!searchError && (sorted === null || !loaded) && <Loading rows={3} />}
              {!searchError && sorted !== null && sorted.length === 0 && (
                <Empty>
                  この時間帯に行ける枠は、いまはありません。
                  <br />
                  サロンが枠を出すと、ここにすぐ表示されます。
                </Empty>
              )}

              {sorted && sorted.length > 0 && (
                <ul className="slot-list">
                  {sorted.slice(0, shown).map((s) => {
                    const min = minutesUntil(s.start_at, now);
                    return (
                      <li key={s.slot_id} className={`slot-card fade-in ${freshIds.includes(s.slot_id) ? 'is-fresh' : ''}`}>
                        <div className="slot-when">
                          <span className="slot-start num">{fmtTime(s.start_at)}</span>
                          <span className="slot-left">{fmtRemaining(min)}</span>
                        </div>
                        <div className="slot-body">
                          <p className="slot-menu">{s.menu_name}</p>
                          <p className="slot-meta">
                            {s.duration_min}分 ・ {s.salon_name}
                            {s.km !== null && <> ・ {fmtDistance(s.km)}</>}
                          </p>
                          <p className="slot-price">
                            <span className="price-label">当日価格</span>
                            <span className="num">{fmtYen(s.price)}</span>
                          </p>
                        </div>
                        <button
                          className="btn btn-primary slot-cta"
                          disabled={!!suspendedUntil}
                          onClick={() => openSlot(s.slot_id)}
                        >
                          予約
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {sorted && sorted.length > shown && (
                <button className="btn btn-secondary btn-block" onClick={() => setShown((n) => n + PAGE)}>
                  もっと見る（あと{sorted.length - shown}件）
                </button>
              )}
              <p className="fine-print">
                現在地は使うと選んだときだけ、この端末の中で距離の計算に使います。サーバーには送りません。受付の締切を過ぎた枠は表示されません。
              </p>
            </section>
          )}
        </>
      )}
    </main>
  );
}
