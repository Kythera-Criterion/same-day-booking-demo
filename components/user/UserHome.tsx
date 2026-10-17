'use client';

// 利用者のホーム：今の空きの数と探すボタン → 時間帯 → 候補3件（距離レーダーつき）→ 写真つきのシートで確認してスライドで確定

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import AppHeader from '@/components/AppHeader';
import Sheet from '@/components/Sheet';
import { ErrorState, Loading, NotConfigured } from '@/components/States';
import Button from '@/components/ui/Button';
import { Field, Segmented, Select } from '@/components/ui/Form';
import { Fine, Page, ScreenTitle, Stack } from '@/components/ui/Layout';
import Notice, { NoticeBand } from '@/components/ui/Notice';
import SalonPhoto from '@/components/ui/SalonPhoto';
import {
  ArrowLeft,
  ArrowRight,
  BellRinging,
  CalendarCheck,
  Clock,
  Crosshair,
  Info,
  Lightning,
  ListBullets,
  MapPin,
  Phone,
  Prohibit,
  Storefront,
  Timer,
  Wallet,
} from '@/components/ui/icons';
import { useRoleSession } from '@/lib/supabase';
import { AFTER_LOGOUT } from '@/lib/logout';
import { toMessage } from '@/lib/errors';
import { bearingDeg, distanceKm, fmtDistance, type LatLng } from '@/lib/geo';
import { saveOrigin } from '@/lib/origin';
import { walkMinutes } from '@/lib/walk';
import { pickThree, restByStart, type PickRole } from '@/lib/picks';
import { UI_OPTIONS } from '@/lib/ui-options';
import { WINDOWS, fmtDate, fmtRemaining, fmtTime, jstTodayEnd, minutesUntil, windowEnd, type WindowKey } from '@/lib/time';
import BookingForm from './BookingForm';
import CandidateCard from './CandidateCard';
import FirstSteps from './FirstSteps';
import Radar from './Radar';
import TabBar from './TabBar';
import { needsProfile, useUserState } from './useUserState';
import { genderCondition, stylistLine, useSalonExtras } from './useSalonExtras';
import VoiceSearch from './VoiceSearch';
import st from './UserHome.module.css';

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
const WINDOW_ICON: Record<WindowKey, PhosphorIcon> = { now: Lightning, '1h': Timer, '3h': Clock, today: CalendarCheck };
const WIDER: Record<WindowKey, WindowKey | null> = { now: '1h', '1h': '3h', '3h': 'today', today: null };
const MORE = 3;

export default function UserHome() {
  const router = useRouter();
  const { client, session, ready, signedOut } = useRoleSession('user');
  const { areas, profile, active, suspendedUntil, loaded: stateLoaded, error: stateError, reload } = useUserState(client, session);

  // 開いている間にログアウトした（別のタブ・ログインの期限切れ）ときは、ログインの画面へ
  useEffect(() => {
    if (signedOut && !session) router.replace(AFTER_LOGOUT.user);
  }, [signedOut, session, router]);

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
  const searchSeq = useRef(0);
  const cardRefs = useRef(new Map<string, HTMLLIElement>());
  // 開いている間に新しく届いた枠（見た目だけ：カードに時間の色の輪を出す）。最初の読み込みとエリアの切り替えでは出さない
  const seenSlots = useRef<{ area: string | null | undefined; ids: Set<string> } | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());

  const currentAreaId = areaId ?? profile?.area_id ?? areas[0]?.id ?? null;
  // 検索のエリア：ログインしている人は登録のエリア（未設定なら、すべてのエリア）。ログインしていない人は、選んだエリア
  // undefined は「まだ決まっていない（プロフィールの読み込み中）」
  const searchAreaId: string | null | undefined = areaId ?? (session ? (stateLoaded ? (profile?.area_id ?? null) : undefined) : (areas[0]?.id ?? null));
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
    if (!client || searchAreaId === undefined) return;
    const seq = ++searchSeq.current;
    const { data, error } = await client.rpc('search_open_slots', {
      p_until: jstTodayEnd().toISOString(),
      p_area_id: searchAreaId,
    });
    if (seq !== searchSeq.current) return;
    if (error) {
      setSearchError(toMessage(error));
      return;
    }
    setSearchError(null);
    setAll((data ?? []) as FoundSlot[]);
    setLoadedAt(new Date());
  }, [client, searchAreaId]);

  useEffect(() => {
    search();
  }, [search]);

  // サロンが枠を出す・ほかの人が予約する、の両方に追いつく（Realtime と定期的な読み直し）
  useEffect(() => {
    if (!client) return;
    const channel = client
      .channel(`user-home-slots-${Math.random().toString(36).slice(2, 8)}`)
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

  useEffect(() => {
    if (!all) return;
    const ids = all.map((s) => s.slot_id);
    const seen = seenSlots.current;
    if (!seen || seen.area !== searchAreaId) {
      seenSlots.current = { area: searchAreaId, ids: new Set(ids) };
      setFreshIds(new Set());
      return;
    }
    const arrived = ids.filter((id) => !seen.ids.has(id));
    for (const id of arrived) seen.ids.add(id);
    setFreshIds(new Set(arrived));
  }, [all, searchAreaId]);

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
    lastWinCount.current = null;
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

  // 今日、空きのあるお店（写真を主役に横に並べる）。いちばん早い枠の時刻と件数
  const shops = useMemo(() => {
    const map = new Map<string, { salon_id: string; salon_name: string; first: string; firstId: string; count: number }>();
    for (const s of valid) {
      const cur = map.get(s.salon_id);
      if (!cur) map.set(s.salon_id, { salon_id: s.salon_id, salon_name: s.salon_name, first: s.start_at, firstId: s.slot_id, count: 1 });
      else {
        cur.count += 1;
        if (s.start_at < cur.first) {
          cur.first = s.start_at;
          cur.firstId = s.slot_id;
        }
      }
    }
    return [...map.values()].sort((a, b) => a.first.localeCompare(b.first)).slice(0, 6);
  }, [valid]);

  const extras = useSalonExtras(client, [...picks, ...rest].map((p) => p.salon_id));

  if (!client) return <NotConfigured />;

  const shown = frozen?.list ?? picks;
  const extra = rest.slice(0, moreCount);
  const total = counts.today;

  return (
    <Page tabs>
      <AppHeader role="利用者">
        {ready && session ? <Link href="/mypage">マイページ</Link> : <Link href="/login">ログイン</Link>}
      </AppHeader>

      {arrival && (
        <div className={st.arrival}>
          <Notice tone="success" role="status" icon={BellRinging}>
            {arrival}
          </Notice>
        </div>
      )}
      <Stack gap={3}>
        {stateError && <ErrorState onRetry={reload}>{stateError}</ErrorState>}
        {session && needsProfile(profile) && (
          <Link href="/signup/complete?next=/" className={st.finish}>
            <Notice tone="info">
              <strong>あと少しで登録が完了します</strong>
              <br />
              ご予約の前に、電話番号・18歳以上の確認などを入力してください。 <span>入力する →</span>
            </Notice>
          </Link>
        )}
        {suspendedUntil && (
          <Notice tone="danger" icon={Prohibit}>
            無断キャンセルが続いたため、新しいご予約をお受けできません。
            <strong>
              {' '}
              {fmtDate(suspendedUntil)} {fmtTime(suspendedUntil)}から予約できます。
            </strong>
          </Notice>
        )}
      </Stack>

      {active && active.slot ? (
        <Link href={`/booking/${active.id}`} className={st.active}>
          <span className={st.activeLabel}>
            <CalendarCheck size={20} weight="fill" aria-hidden focusable="false" />
            ご予約中
          </span>
          <span className={st.activeTime}>今日 {fmtTime(active.slot.start_at)}</span>
          <span className={`${st.activeLeft} num`}>{fmtRemaining(minutesUntil(active.slot.start_at, now))}</span>
          <span className={st.activeSub}>
            {active.slot.salon?.name} ・ {active.slot.menu?.name}
          </span>
          <span className={st.activeGo}>
            予約内容を見る
            <ArrowRight size={20} aria-hidden focusable="false" />
          </span>
        </Link>
      ) : (
        <>
          {step === 'start' && (
            <section className={st.hero}>
              <p className={st.kicker}>
                <Lightning size={20} weight="duotone" aria-hidden focusable="false" />
                今日だけ・今から行ける空き枠
              </p>
              <h1 className={st.headline}>
                <span>空いた時間だけが、</span>
                <span>今から届く。</span>
              </h1>
              <div className={st.live} aria-live="polite">
                <span className={st.liveNum}>{all === null ? '…' : total}</span>
                <span className={st.liveText}>
                  <strong>
                    {all === null
                      ? searchError
                        ? '空きを確かめられませんでした'
                        : '空きを確かめています'
                      : total > 0
                        ? `件の空き枠が、今日このあと`
                        : '今は空きがありません'}
                  </strong>
                  <small className="num">
                    {currentArea?.name ?? 'すべてのエリア'}
                    {loadedAt ? `・${fmtTime(loadedAt)}時点（自動で更新）` : ''}
                  </small>
                </span>
              </div>
              <div className={st.cta}>
                <Button variant="primary" size="lg" block icon={Lightning} iconWeight="duotone" onClick={() => setStep('pick')}>
                  今から行けるお店を探す
                </Button>
                <p className={st.ctaSub}>
                  <span>
                    <Phone size={20} aria-hidden focusable="false" />
                    電話不要
                  </span>
                  <span>
                    <Wallet size={20} aria-hidden focusable="false" />
                    お支払いは店頭で
                  </span>
                </p>
              </div>
              {searchError && <ErrorState onRetry={search}>{searchError}</ErrorState>}
              <VoiceSearch onResult={(key, word) => choose(key, word)} />
              <NoticeBand icon={Info}>
                <strong>実証実験中</strong>：手数料・キャンセル料はかかりません
              </NoticeBand>
              <FirstSteps />

              {shops.length > 0 && (
                <section className={st.shops} aria-labelledby="today-shops">
                  <h2 className={st.shopsTitle} id="today-shops">
                    <Storefront size={20} aria-hidden focusable="false" />
                    今日、空きのあるお店
                  </h2>
                  <ul className={st.shopRow}>
                    {shops.map((sh) => (
                      <li key={sh.salon_id}>
                        <button
                          type="button"
                          className={st.shop}
                          onClick={() => {
                            choose('today');
                            setSelected(sh.firstId);
                          }}
                        >
                          <SalonPhoto salonId={sh.salon_id} salonName={sh.salon_name} variant="square" alt="" />
                          <span className={st.shopName}>{sh.salon_name}</span>
                          <span className={`${st.shopTime} num`}>
                            <Clock size={20} aria-hidden focusable="false" />
                            {fmtTime(sh.first)}から・{sh.count}枠
                          </span>
                          <span className="sr-only">（今日の候補を見る）</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </section>
          )}

          {step === 'pick' && (
            <section>
              <ScreenTitle>いつ行けますか？</ScreenTitle>
              <ul className={st.windows}>
                {WINDOWS.map((w) => {
                  const Glyph = WINDOW_ICON[w.key];
                  const n = counts[w.key];
                  return (
                    <li key={w.key}>
                      <button className={st.window} aria-disabled={n === 0} onClick={() => choose(w.key)}>
                        <span className={st.windowIcon}>
                          <Glyph size={24} weight={w.key === 'now' ? 'duotone' : 'regular'} aria-hidden focusable="false" />
                        </span>
                        <span className={st.windowText}>
                          <span className={st.windowMain}>{w.label}</span>
                          <span className={st.windowSub}>{n === 0 ? 'いまは空きなし' : WINDOW_SUB[w.key]}</span>
                        </span>
                        <span className={st.windowCount}>
                          {all === null ? '…' : n}
                          <small>件</small>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <Button variant="text" icon={ArrowLeft} onClick={() => setStep('start')}>
                戻る
              </Button>
            </section>
          )}

          {step === 'results' && (
            <section>
              <ScreenTitle tight as="h1">
                今から行ける候補
              </ScreenTitle>
              <Segmented
                label="時間帯"
                value={win}
                onChange={(k) => choose(k, menuWord)}
                options={WINDOWS.map((w) => ({ value: w.key, label: w.label, count: counts[w.key], empty: counts[w.key] === 0 }))}
              />

              <div className={st.origin}>
                <span className={st.originText}>
                  <MapPin size={20} aria-hidden focusable="false" />
                  {gps ? '現在地から見た位置' : `${currentArea?.name ?? 'エリア'}の基準地点から見た位置`}
                  {menuWord && ` ・「${menuWord}」`}
                </span>
                {menuWord && (
                  <Button variant="text" onClick={() => choose(win, null)}>
                    「{menuWord}」の絞り込みを外す
                  </Button>
                )}
                <Button variant="text" icon={Crosshair} onClick={gps ? () => setGps(null) : applyLocation}>
                  {gps ? '現在地を使わない' : '現在地を使う'}
                </Button>
              </div>
              {!session && areas.length > 1 && (
                <Field id="home-area" label="エリア">
                  <Select
                    id="home-area"
                    value={currentAreaId ?? ''}
                    onChange={(e) => {
                      lastShown.current = [];
                      lastWinCount.current = null;
                      setFrozen(null);
                      setAreaId(e.target.value);
                    }}
                  >
                    {areas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Stack gap={3}>
                {gpsError && <Notice tone="info">{gpsError}</Notice>}
                {searchError && <ErrorState onRetry={search}>{searchError}</ErrorState>}
                {!searchError && all === null && <Loading rows={3} />}

                {all !== null && shown.length === 0 && (
                  <div className={st.empty}>
                    <p className={st.emptyTitle}>この時間帯に行ける枠は、いまはありません</p>
                    {UI_OPTIONS.emptyWatch && (
                      <p className={st.emptySub}>
                        <span className={st.pulse} aria-hidden />
                        この画面を開いている間に空きが出たら、お知らせします。
                      </p>
                    )}
                    {WIDER[win] && (
                      <Button variant="secondary" size="md" block onClick={() => choose(WIDER[win]!, menuWord)}>
                        時間帯を広げる（{WINDOWS.find((w) => w.key === WIDER[win])?.label}・{counts[WIDER[win]!]}件）
                      </Button>
                    )}
                  </div>
                )}

                {all !== null && loadedAt && shown.length > 0 && (
                  <p className={`${st.liveNote} num`} aria-live="off">
                    <span className={st.pulse} aria-hidden />
                    空きの状況は自動で更新しています（{fmtTime(loadedAt)}時点）
                  </p>
                )}

                {shown.length > 0 && origin && (
                  <Radar
                    originLabel={origin.label}
                    selected={selected}
                    onSelect={focusCard}
                    points={shown
                      .map((s, i) => ({ s, no: i + 1 }))
                      .filter(({ s }) => s.km !== null && s.bearing !== null && !frozen?.gone.includes(s.id))
                      .map(({ s, no }) => ({ id: s.id, no, label: fmtTime(s.start_at), km: s.km!, bearing: s.bearing! }))}
                  />
                )}

                {shown.length > 0 && (
                  <ul className={st.list}>
                    {shown.map((s, i) => (
                      <CandidateCard
                        key={s.id}
                        slot={s}
                        no={i + 1}
                        now={now}
                        gone={!!frozen?.gone.includes(s.id)}
                        selected={selected === s.id}
                        disabled={!!suspendedUntil}
                        fresh={freshIds.has(s.id)}
                        extra={extras[s.salon_id]}
                        onSelect={() => setSelected(s.id)}
                        onBook={() => openSheet(s)}
                        refFn={(el) => (el ? cardRefs.current.set(s.id, el) : cardRefs.current.delete(s.id))}
                      />
                    ))}
                  </ul>
                )}
              </Stack>

              {extra.length > 0 && (
                <>
                  <h2 className={st.sectionTitle}>
                    <ListBullets size={20} aria-hidden focusable="false" />
                    ほかの枠（開始が早い順）
                  </h2>
                  <ul className={st.list}>
                    {extra.map((s) => (
                      <CandidateCard
                        key={s.id}
                        slot={s}
                        now={now}
                        gone={false}
                        selected={false}
                        disabled={!!suspendedUntil}
                        fresh={freshIds.has(s.id)}
                        extra={extras[s.salon_id]}
                        onSelect={() => undefined}
                        onBook={() => openSheet(s)}
                      />
                    ))}
                  </ul>
                </>
              )}
              <Stack gap={3} className={st.after}>
                {rest.length > moreCount && !frozen && (
                  <Button variant="secondary" size="md" block onClick={() => setMoreCount((n) => n + MORE)}>
                    もっと見る（あと{rest.length - moreCount}件）
                  </Button>
                )}
                <Fine>
                  現在地は使うと選んだときだけ、この端末の中で距離と方位の計算に使います。サーバーや地図サービスには送りません。受付の締切を過ぎた枠は表示されません。
                </Fine>
              </Stack>
            </section>
          )}
        </>
      )}

      {sheet && session && (
        <Sheet
          label="予約の確認"
          title="予約の確認"
          narrow
          onClose={() => setSheet(null)}
          media={
            <SalonPhoto
              salonId={sheet.salon_id}
              salonName={sheet.salon_name}
              variant="hero"
              priority
              caption={<SheetCaption name={sheet.salon_name} start={sheet.start_at} />}
            />
          }
        >
          <BookingForm
            client={client}
            session={session}
            slot={{ ...sheet, id: sheet.slot_id }}
            stickyConfirm
            walk={sheet.km !== null ? { min: walkMinutes(sheet.km), label: fmtDistance(sheet.km) } : null}
            stylist={stylistLine(sheet.stylist_name, extras[sheet.salon_id])}
            condition={genderCondition(extras[sheet.salon_id])}
            alternatives={valid
              .filter((v) => v.salon_id === sheet.salon_id)
              .map((v) => ({ id: v.slot_id, start_at: v.start_at, menu_name: v.menu_name }))}
            onSwitch={(id) => {
              const next = inWindow.find((x) => x.id === id) ?? valid.map(toShown(origin)).find((x) => x.id === id);
              if (next) setSheet(next);
            }}
            defaultPref={profile?.conversation_pref ?? null}
            activeBookingId={active?.id ?? null}
            suspendedUntil={suspendedUntil}
            now={now}
            profileMissing={needsProfile(profile)}
            unavailable={sheetGone ? 'この枠は予約できなくなりました（ほかの方の予約・受付の締切・お店の受付終了など）。' : null}
            onChooseOther={() => setSheet(null)}
            onBooked={(id) => router.push(`/booking/${id}?new=1`)}
            onUnavailable={search}
          />
        </Sheet>
      )}

      <TabBar activeBookingId={active?.id ?? null} signedIn={!!session} />
    </Page>
  );
}

// 検索結果の1件を、候補カード・シートで使う形にする
function toShown(origin: LatLng | null) {
  return (s: FoundSlot): Shown => ({
    ...s,
    id: s.slot_id,
    startMs: new Date(s.start_at).getTime(),
    km: origin ? distanceKm(origin, { lat: s.lat, lng: s.lng }) : null,
    bearing: origin ? bearingDeg(origin, { lat: s.lat, lng: s.lng }) : null,
    role: null,
  });
}

// シートの上の写真に重ねる文字（店名と開始時刻）
function SheetCaption({ name, start }: { name: string; start: string }) {
  return (
    <span className={st.caption}>
      <span className={`${st.captionTime} num`}>今日 {fmtTime(start)}〜</span>
      <span className={st.captionName}>{name}</span>
    </span>
  );
}
