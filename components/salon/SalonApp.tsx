'use client';

// サロンの画面
//   営業の始めに「通知音をオンにして始める」→ 予約が入ると画面全体を覆う知らせ（点滅なし）と音で知らせ、どこを押しても確認・詳細が開く
//   今日の成果・来店の記録漏れ・「今日はここまで」・担当ごとの列（タブレット横向き）／縦のタイムライン（スマートフォン）
//   空いた時間を伝えると枠に切り分けて出せる。初めてのときは3ステップの初期設定
//   見た目はサロンの画面のデザイン案に合わせる：広い画面（960px〜）は左にお店とメニュー、中央に今日の数字と予定、右に次の予約と「枠を出す」。
//   狭い画面は縦に並べ、下に固定の操作のバー

import { useCallback, useEffect, useState } from 'react';
import AppHeader, { RoleIntro } from '@/components/AppHeader';
import LoginBox from '@/components/LoginBox';
import Sheet from '@/components/Sheet';
import SocialButtons, { AuthErrorNotice, LoggedOutNotice, hasAnyProvider } from '@/components/auth/SocialButtons';
import { logout } from '@/lib/logout';
import AccountSecurity from '@/components/auth/AccountSecurity';
import type { Providers } from '@/lib/oauth-shared';
import { Empty, ErrorState, Loading, NotConfigured } from '@/components/States';
import Button, { ButtonLink } from '@/components/ui/Button';
import { Check, Field, Segmented, Select } from '@/components/ui/Form';
import Label from '@/components/ui/Label';
import { Fine, Page, Pair, ScreenTitle, Stack } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import SalonPhoto from '@/components/ui/SalonPhoto';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import ToastBar from '@/components/ui/Toast';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import {
  ArrowCounterClockwise,
  BellRinging,
  CalendarCheck,
  CaretLeft,
  CaretRight,
  Clock,
  Gear,
  House,
  HourglassMedium,
  Info,
  ListBullets,
  PauseCircle,
  Plus,
  Prohibit,
  Scissors,
  SealCheck,
  SignOut,
  Storefront,
  UserCircle,
  Users,
} from '@/components/ui/icons';
import { one, useRoleSession } from '@/lib/supabase';
import { requestDispatch, useDispatchTicker } from '@/lib/dispatch-client';
import { askNotificationPermission, browserNotify, notificationPermission } from '@/lib/alerts';
import { toMessage } from '@/lib/errors';
import { UI_OPTIONS } from '@/lib/ui-options';
import { fmtTime, fmtYen, jstDateKey, jstTodayStart } from '@/lib/time';
import { keepScreenOn, rekeepOnVisible, wakeLockSupported } from '@/lib/wakelock';
import { AlertGate, NewBookingAlert, type IncomingBooking } from './Alerts';
import Onboarding from './Onboarding';
import PublishSheet, { publishFree, publishOffsets, type PublishResult } from './PublishSheet';
import SalonSettings from './SalonSettings';
import SlotPanel from './SlotPanel';
import SlotList from './SlotList';
import StaffBands, { WeekBands } from './StaffBands';
import SalonSearch from './SalonSearch';
import SalonBell from './SalonBell';
import MarketCard from './MarketCard';
import Timeline from './Timeline';
import { FreshMark, StateLegend } from './SlotStateMark';
import sa from './SalonApp.module.css';
import { activeBooking, fetchSlots, useSalonData, type Preset, type SalonSlot } from './useSalonData';

const DEMO_ACCOUNTS = [
  { email: 'salon-a@demo.test', label: 'HAIR ROOM AOI' },
  { email: 'salon-b@demo.test', label: 'atelier nagi' },
  { email: 'salon-c@demo.test', label: 'Salon Komorebi' },
];
const GATE_KEY = 'salon-alerts-started';

type Toast = { id: number; text: string; accent?: boolean };

function hm(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}時間${m > 0 ? `${m}分` : ''}` : `${m}分`;
}

// 日本時間の時刻に合わせたあいさつ（〜11時：おはようございます／〜17時：こんにちは／それ以降：こんばんは）
function greeting(now: Date) {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }).format(now));
  return h < 11 ? 'おはようございます' : h < 17 ? 'こんにちは' : 'こんばんは';
}

const shortDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' });
const longDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });

const LISTING_LABEL: Record<string, string> = { listed: '掲載中', reviewing: '審査中', rejected: '掲載見送り', suspended: '掲載停止中' };

// 前日比の表示（+2件・−1件・±0件）
function signed(n: number, unit: string) {
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}${unit}`;
}

// 今日の数字のカード（アイコン・名前・数字と単位・補足または前日比）

function Tile({
  icon: Glyph,
  label,
  value,
  unit,
  sub,
  diff,
}: {
  icon: PhosphorIcon;
  label: string;
  value: string | number;
  unit?: string;
  sub: string;
  // 前日比（昨日を読み込めていないときは null）
  diff?: number | null;
}) {
  return (
    <div className={sa.tile}>
      <span className={sa.tileIcon}>
        <Glyph size={24} aria-hidden focusable="false" />
      </span>
      <span className={sa.tileBody}>
        <span className={sa.tileLabel}>{label}</span>
        <span className={sa.tileValue}>
          {value}
          {unit && <small>{unit}</small>}
        </span>
        <span className={sa.tileSub}>
          {diff !== undefined && diff !== null ? (
            <>
              前日比 <span className={`num ${diff > 0 ? sa.up : diff < 0 ? sa.down : ''}`}>{signed(diff, unit ?? '')}</span>
              <span className="sr-only">（{sub}）</span>
            </>
          ) : (
            sub
          )}
        </span>
      </span>
    </div>
  );
}

export default function SalonApp({
  demoMode,
  providers,
  authError,
  linked,
  initialTab = 'today',
  loggedOut = false,
}: {
  demoMode: boolean;
  providers: Providers;
  authError?: string | null;
  linked?: string | null;
  initialTab?: 'today' | 'settings';
  loggedOut?: boolean;
}) {
  const { client, session, ready, signedOut } = useRoleSession('salon');
  const { salon, salons, selectSalon, menus, stylists, presets, lineGroup, onboardingStep, listing, slots, error, loadSalon, loadSlots } = useSalonData(client, session);
  const [tab, setTab] = useState<'today' | 'settings'>(initialTab);
  const [sheet, setSheetState] = useState<{ start: Date | null; stylistId: string | null; openedAt: Date } | null>(null);
  const setSheet = useCallback(
    (v: { start: Date | null; stylistId: string | null } | null) => setSheetState(v ? { ...v, openedAt: new Date() } : null),
    [],
  );
  const [selected, setSelected] = useState<SalonSlot | null>(null);
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const [incoming, setIncoming] = useState<IncomingBooking[]>([]);
  const [started, setStarted] = useState(false);
  const [wake, setWake] = useState<'idle' | 'on' | 'unsupported'>('idle');
  const [confirmPause, setConfirmPause] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [permission, setPermission] = useState<string>('default');
  const [now, setNow] = useState(() => new Date());
  const [view, setView] = useState<'chart' | 'list' | 'week'>('chart');
  // 今日の予定の絞り込み（メニュー・担当。空はすべて、担当の 'none' は担当なし）
  const [menuFilter, setMenuFilter] = useState('');
  const [staffFilter, setStaffFilter] = useState('');
  // 週表示：今週から何週ずらすか・その週の枠
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekSlots, setWeekSlots] = useState<SalonSlot[] | null>(null);
  // 前日比のための、昨日の枠
  const [yesterday, setYesterday] = useState<SalonSlot[] | null>(null);
  // キャンセル待ちのお客様の数（今日・昨日）。0020 を流していないデータベースでは null（「データベースの更新後に使えます」）
  const [waitCount, setWaitCount] = useState<number | null>(null);
  const [waitYesterday, setWaitYesterday] = useState<number | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const [presetBusy, setPresetBusy] = useState<string | null>(null);
  // お店がまだないアカウントの、いちばん新しい掲載の申し込み（運営の確認待ちかどうか）
  const [myApp, setMyApp] = useState<{ status: string; salon_name: string } | null>(null);
  // 左のメニューから開く設定の章（メニュー・美容師・お店の情報）。設定の画面に切り替えてから、その章までスクロールする
  const [jump, setJump] = useState<string | null>(null);
  // 広い画面（960px〜）かどうか。広い画面は左のメニュー、狭い画面は下のバーが「主な操作」（同じボタンを2つ置かない）
  const [wide, setWide] = useState(false);

  useDispatchTicker(client, !!salon);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 960px)');
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (tab !== 'settings' || !jump) return;
    const id = jump;
    const t = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setJump(null);
    }, 50);
    return () => clearTimeout(t);
  }, [tab, jump]);

  // 開いている間にログアウトした（別のタブ・ログインの期限切れ）ときは、前のスタッフの画面の状態を残さない
  useEffect(() => {
    if (!signedOut || session) return;
    setTab('today');
    setSheetState(null);
    setSelected(null);
    setIncoming([]);
    setConfirmPause(false);
  }, [signedOut, session]);

  useEffect(() => {
    setPermission(notificationPermission());
    try {
      if (sessionStorage.getItem(GATE_KEY)) setStarted(true);
    } catch {
      // 何もしない
    }
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // 画面が消えないようにする（開始ボタンを押したあと。タブを戻したら取り直す）
  useEffect(() => {
    if (!started) return;
    if (!wakeLockSupported()) {
      setWake('unsupported');
      return;
    }
    keepScreenOn().then((ok) => setWake(ok ? 'on' : 'unsupported'));
    return rekeepOnVisible();
  }, [started]);

  const showToast = useCallback((text: string, accent = false) => {
    const id = Date.now();
    setToast({ id, text, accent });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 4500);
  }, []);

  // 予約が入った瞬間（Realtime）：画面全体の点滅・繰り返しの音・振動・ブラウザ通知
  const salonId = salon?.id ?? null;
  useEffect(() => {
    if (!client || !salonId) return;
    const channel = client
      .channel(`salon-live-${salonId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings' }, async (payload) => {
        const row = payload.new as { id: string; contact_name: string; slot_id: string; booking_no: number | null; status: string };
        if (row.status !== 'confirmed') return;
        const { data: slotRow } = await client.from('slots').select('salon_id,start_at,menus(name)').eq('id', row.slot_id).maybeSingle();
        if (!slotRow || slotRow.salon_id !== salonId) return;
        setFreshIds((ids) => [...ids, row.id]);
        loadSlots();
        const slot = { start_at: slotRow.start_at as string, menu: one(slotRow.menus as { name: string } | { name: string }[] | null) };
        setIncoming((list) => [
          ...list,
          {
            bookingId: row.id,
            slotId: row.slot_id,
            name: row.contact_name,
            startAt: slot?.start_at ?? null,
            menu: slot?.menu?.name ?? null,
            bookingNo: row.booking_no,
          },
        ]);
        browserNotify('新しい予約が入りました', `${slot ? fmtTime(slot.start_at) : ''} ${row.contact_name} 様`);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings' }, () => loadSlots())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, () => loadSlots())
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [client, salonId, loadSlots]);

  useEffect(() => {
    if (!client || !session || salon !== null) {
      setMyApp(null);
      return;
    }
    client.rpc('my_salon_application').then(({ data }) => setMyApp(((data as { status: string; salon_name: string }[] | null) ?? [])[0] ?? null));
  }, [client, session, salon]);

  // 日付が変わったら（画面を開いたまま0時を過ぎたら）、今日の枠を読み直す
  const today = jstDateKey(now);
  useEffect(() => {
    loadSlots();
  }, [today, loadSlots]);

  // 昨日の枠（前日比）。日付が変わったとき・お店を切り替えたときに読み直す
  useEffect(() => {
    if (!client || !salonId) return;
    let alive = true;
    const start = jstTodayStart();
    setYesterday(null);
    fetchSlots(client, salonId, new Date(start.getTime() - 86_400_000), start).then(({ data, error: e }) => alive && setYesterday(e ? [] : data));
    return () => {
      alive = false;
    };
  }, [client, salonId, today]);

  // キャンセル待ちの件数（今日・昨日）。0020 を流していないデータベースでは読めないので null のまま。
  // 今日の枠が変わったとき・30秒ごと（now）に数え直す
  useEffect(() => {
    if (!client || !salonId) return;
    let alive = true;
    const day = (d: Date) => jstDateKey(d);
    const count = (key: string) =>
      // 件数だけを数える問い合わせ（head）は、表がないときにエラーを返さないため、1件だけ読む形で数える
      client.from('cancel_waits').select('id', { count: 'exact' }).eq('salon_id', salonId).eq('day', key).limit(1);
    Promise.all([count(day(now)), count(day(new Date(now.getTime() - 86_400_000)))]).then(([a, b]) => {
      if (!alive) return;
      setWaitCount(a.error ? null : (a.count ?? 0));
      setWaitYesterday(b.error ? null : (b.count ?? 0));
    });
    return () => {
      alive = false;
    };
  }, [client, salonId, now, slots]);

  // 週表示の枠（月曜日から7日分）。今日の枠が変わったら（予約・公開・取り下げ）、読み直す
  const weekStart = (() => {
    const start = jstTodayStart(now);
    const dow = new Date(start.getTime() + 9 * 3_600_000).getUTCDay();
    return new Date(start.getTime() - ((dow + 6) % 7) * 86_400_000 + weekOffset * 7 * 86_400_000);
  })();
  const weekKey = weekStart.getTime();
  useEffect(() => {
    if (!client || !salonId || view !== 'week') return;
    let alive = true;
    fetchSlots(client, salonId, new Date(weekKey), new Date(weekKey + 7 * 86_400_000)).then(({ data, error: e }) => alive && setWeekSlots(e ? [] : data));
    return () => {
      alive = false;
    };
  }, [client, salonId, view, weekKey, slots]);

  // 開いている枠・予約の内容を最新に保つ
  useEffect(() => {
    if (!selected || !slots) return;
    const latest = slots.find((s) => s.id === selected.id);
    if (latest && latest !== selected) setSelected(latest);
  }, [slots, selected]);

  function start() {
    setStarted(true);
    try {
      sessionStorage.setItem(GATE_KEY, '1');
    } catch {
      // 何もしない
    }
  }

  function acknowledge() {
    const first = incoming[0];
    setIncoming((list) => list.slice(1));
    const slot = slots?.find((s) => s.id === first?.slotId);
    if (slot) setSelected(slot);
  }

  function reportPublish(r: PublishResult) {
    if (r.ok.length > 0) showToast(`${r.ok.join('・')} の枠を公開しました${r.ng.length ? `（${r.ng.length}件は出せませんでした）` : ''}`);
    else if (r.ng.length > 0) showToast(`出せませんでした：${r.ng.join('、')}`);
    loadSlots();
  }

  async function quickPreset(p: Preset) {
    if (!client || presetBusy) return;
    const menu = menus.find((m) => m.id === p.menu_id && m.is_active);
    if (!menu) return;
    setPresetBusy(p.id);
    try {
      reportPublish(
        p.kind === 'free' && p.free_minutes
          ? await publishFree(client, menu, p.stylist_id, p.free_minutes)
          : await publishOffsets(client, menu, p.stylist_id, p.offsets_min),
      );
    } finally {
      setPresetBusy(null);
    }
  }

  async function pauseToday() {
    if (!client || !salon) return;
    setConfirmPause(false);
    const { data, error: e } = await client.rpc('salon_pause_today', { p_salon_id: salon.id });
    if (e) showToast(toMessage(e));
    else showToast(`今日の受付を止めました（${data}枠を取り下げ）。「元に戻す」で、締切前の枠をもう一度公開できます。`);
    loadSlots();
  }

  async function resumeToday() {
    if (!client || !salon) return;
    const { data, error: e } = await client.rpc('salon_resume_today', { p_salon_id: salon.id });
    if (e) showToast(toMessage(e));
    else {
      const r = data as { reopened: number; skipped: number };
      showToast(`${r.reopened}枠をもう一度公開しました${r.skipped ? `（締切を過ぎた・時間が重なる${r.skipped}枠はそのまま）` : ''}`);
    }
    loadSlots();
  }

  async function record(bookingId: string, action: 'complete' | 'no_show') {
    if (!client) return;
    const { error: e } = await client.rpc('salon_update_booking', { p_booking_id: bookingId, p_action: action });
    if (e) showToast(toMessage(e));
    else {
      showToast(action === 'complete' ? '来店済みにしました。' : '無断キャンセルを記録しました。');
      requestDispatch(client);
    }
    loadSlots();
  }

  if (!client) return <NotConfigured />;

  const list = slots ?? [];
  const made = list.filter((s) => {
    const b = activeBooking(s);
    return b && (b.status === 'confirmed' || b.status === 'completed');
  });
  const achievement = {
    count: made.length,
    minutes: made.reduce((sum, s) => sum + (s.menu?.duration_min ?? 0), 0),
    yen: made.filter((s) => activeBooking(s)?.status === 'completed').reduce((sum, s) => sum + s.price, 0),
  };
  const overdue = list.filter((s) => {
    const b = activeBooking(s);
    return b?.status === 'confirmed' && new Date(s.start_at).getTime() + UI_OPTIONS.overdueMinutes * 60_000 < now.getTime();
  });
  const openCount = list.filter((s) => s.status === 'open').length;
  const pausedFuture = list.filter(
    (s) => s.status === 'closed' && s.closed_reason === 'paused' && new Date(s.deadline_at).getTime() > now.getTime(),
  ).length;
  const upcoming = list
    .filter((s) => activeBooking(s)?.status === 'confirmed' && !overdue.includes(s))
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const onboarding = onboardingStep !== null && onboardingStep < 3;

  // 受付を終えた枠（予約のないまま締切を過ぎた・取り下げた・キャンセルだけが残った）は、ふだんは表示しない
  const isEnded = (s: SalonSlot) =>
    !activeBooking(s) &&
    (s.status === 'expired' ||
      (s.status === 'closed' && !(s.closed_reason === 'paused' && new Date(s.deadline_at).getTime() > now.getTime())));
  const endedCount = list.filter(isEnded).length;
  // メニュー・担当の絞り込み（今日の予定・一覧・週表示で共通）
  const matches = (s: SalonSlot) =>
    (!menuFilter || s.menu_id === menuFilter) && (!staffFilter || (staffFilter === 'none' ? !s.stylist_id : s.stylist_id === staffFilter));
  const visibleSlots = (showEnded ? list : list.filter((s) => !isEnded(s))).filter(matches);
  const weekVisible = (weekSlots ?? []).filter((s) => (showEnded || !isEnded(s)) && matches(s));
  const filtered = !!menuFilter || !!staffFilter;

  // 前日比：昨日の1日分と比べる（予約・公開した枠・来店の記録がまだの予約）
  const yMade = (yesterday ?? []).filter((s) => {
    const b = activeBooking(s);
    return b && (b.status === 'confirmed' || b.status === 'completed');
  });
  const compare = yesterday
    ? {
        booked: achievement.count - yMade.length,
        published: list.length - yesterday.length,
        unrecorded: overdue.length - yesterday.filter((s) => activeBooking(s)?.status === 'confirmed').length,
      }
    : null;

  // 掲載中でなければ、枠は出せない（審査中・見送り・運営が掲載を止めている）
  const canPublish = listing === 'listed';
  // いつもの枠は、使えるメニュー・担当のものだけを出す（止めたメニュー・担当のものは押しても出せないため）
  const usablePresets = presets.filter(
    (p) => menus.some((m) => m.id === p.menu_id && m.is_active) && (p.stylist_id === null || stylists.some((x) => x.id === p.stylist_id && x.is_active)),
  );
  const listingBanner =
    listing === 'reviewing' ? (
      <Notice tone="info" role="status" icon={HourglassMedium}>
        <strong>掲載の審査中です。</strong>
        運営が承認すると、掲載が始まり、メールでお知らせします。承認までの間も、メニュー・担当・お店の場所などの設定は進められます（枠の公開は承認のあとにできます）。
      </Notice>
    ) : listing === 'rejected' ? (
      <Notice tone="danger" role="alert">
        <strong>今回は掲載を見送らせていただきました。</strong>
        詳しくは、お送りしたメールをご確認ください。ご不明な点は運営事務局へお問い合わせください。
      </Notice>
    ) : listing === 'suspended' ? (
      <Notice tone="danger" role="alert" icon={Prohibit}>
        <strong>現在、掲載が止められています。</strong>
        公開中だった枠は取り下げられ、利用者の画面には表示されません。入っている予約はそのままです。再開については運営事務局へお問い合わせください。
      </Notice>
    ) : null;

  // 「枠を出す」（広い画面は右の列、狭い画面は下のバー。どちらか一方だけが見える）
  const publishButton = (
    <Button
      variant="primary"
      size="lg"
      icon={canPublish ? Plus : undefined}
      disabled={!canPublish}
      title={canPublish ? undefined : '掲載中になると、枠を出せます'}
      onClick={() => setSheet({ start: null, stylistId: null })}
    >
      {canPublish ? '枠を出す' : listing === 'reviewing' ? '審査中（承認後に枠を出せます）' : '枠は出せません'}
    </Button>
  );
  const presetButtons = canPublish && usablePresets.length > 0 && (
    <div className={sa.presets}>
      {usablePresets.slice(0, 4).map((p) => (
        <button key={p.id} className={sa.preset} disabled={presetBusy !== null} onClick={() => quickPreset(p)}>
          <small>{presetBusy === p.id ? '公開しています…' : p.kind === 'free' ? 'いつもの空き方' : 'いつもの枠'}</small>
          {p.label}
        </button>
      ))}
    </div>
  );

  return (
    // ログイン・登録の案内は、利用者の画面と同じスマートフォンの幅にそろえる（営業中の画面だけ広く使う）
    <Page width={!session || salon === null ? 'phone' : 'wide'} bar={!!salon && !onboarding} className={salon && !onboarding ? sa.dashboard : undefined}>
      <AppHeader role="サロン" home="/salon">
        {session && (
          <button onClick={() => logout('salon')} aria-label="ログアウト">
            <SignOut size={20} aria-hidden focusable="false" />
            ログアウト
          </button>
        )}
      </AppHeader>

      {ready && !session && (
        <>
          <RoleIntro kind="salon" />
          {(loggedOut || signedOut) && <LoggedOutNotice />}
          <AuthErrorNotice code={authError} />
          <LoginBox
            client={client}
            title="サロンのスタッフとしてログイン"
            demoMode={demoMode}
            demoAccounts={DEMO_ACCOUNTS}
            forgotHref="/forgot?role=salon"
            resendRole="salon"
            social={hasAnyProvider(providers) ? <SocialButtons providers={providers} role="salon" mode="login" next="/salon" back="/salon" /> : null}
            footer={
              <div className={sa.signupCta}>
                <p>はじめて掲載するお店</p>
                <ButtonLink variant="secondary" size="md" block href="/salon/signup" icon={Storefront}>
                  新規登録（掲載のお申し込み）
                </ButtonLink>
              </div>
            }
          />
        </>
      )}
      {error && <ErrorState onRetry={loadSalon}>{error}</ErrorState>}
      {session && salon === undefined && !error && <Loading rows={3} />}
      {session && salon === null && myApp?.status === 'pending' && (
        <Panel>
          <SectionHead icon={HourglassMedium} title="運営の確認待ちです" as="p" />
          <SubText>
            「{myApp.salon_name}」のお申し込みを受け付けています。運営が確認したあと、<span className="break">{session.user.email}</span> に確認のリンクをお送りします。リンクを開くと、このサロンの画面でメニュー・担当・お店の場所などを設定できます。
          </SubText>
        </Panel>
      )}
      {session && salon === null && myApp?.status !== 'pending' && (
        <Panel>
          <Stack gap={3}>
            {myApp?.status === 'rejected' && <Notice tone="info">前回のお申し込み（{myApp.salon_name}）は、掲載を見送らせていただきました。</Notice>}
            <SectionHead icon={Storefront} title="お店の情報がまだ登録されていません" as="p" />
            <SubText>
              このアカウント（<span className="break">{session.user.email}</span>）は、まだどのお店にも紐づいていません。新しく掲載する場合は、掲載を申し込んでください（運営が確認したあと、確認のリンクをお送りします）。すでに掲載しているお店のスタッフとして使う場合は、運営事務局へご連絡ください。
            </SubText>
            <ButtonLink variant="primary" size="md" block href="/salon/signup">
              掲載を申し込む
            </ButtonLink>
          </Stack>
        </Panel>
      )}

      {salon && salons.length > 1 && (
        <div className={sa.switch}>
          <Field id="salon-switch" label={`表示中のお店（${salons.length}店舗）`}>
            <Select
              id="salon-switch"
              value={salon.id}
              onChange={(e) => {
                setSelected(null);
                setSheet(null);
                setIncoming([]);
                setFreshIds([]);
                setConfirmPause(false);
                selectSalon(e.target.value);
              }}
            >
              {salons.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.is_approved ? '' : '（審査中・停止中）'}
                </option>
              ))}
            </Select>
          </Field>
          <ButtonLink href="/salon/signup" variant="text" icon={Plus}>
            別のお店を申し込む
          </ButtonLink>
        </div>
      )}
      {salon && onboarding && listingBanner}
      {salon && onboarding && (
        <Onboarding
          key={salon.id}
          client={client}
          salon={salon}
          menus={menus}
          stylists={stylists}
          lineGroup={lineGroup}
          step={onboardingStep ?? 0}
          onSaved={loadSalon}
        />
      )}

      {salon && !onboarding && (
        <div className={sa.shell}>
          {/* 左：お店とメニュー（広い画面だけ。狭い画面は下の操作のバー） */}
          {wide && (
          <aside className={sa.side} aria-label="お店とメニュー">
            <div className={sa.shop}>
              <SalonPhoto salonId={salon.id} salonName={salon.name} variant="thumb" alt="" className={sa.shopPhoto} />
              <span className={sa.shopBody}>
                <span className={sa.shopName}>{salon.name}</span>
                <Label kind={listing === 'listed' ? 'success' : 'state'}>{LISTING_LABEL[listing ?? ''] ?? '確認中'}</Label>
              </span>
            </div>
            <nav aria-label="主な操作">
              <ul className={sa.sideNav}>
                {(
                  [
                    { key: 'chart', label: 'ダッシュボード', icon: House, on: tab === 'today' && view !== 'list', go: () => (setTab('today'), setView('chart')) },
                    { key: 'list', label: '予約の一覧', icon: ListBullets, on: tab === 'today' && view === 'list', go: () => (setTab('today'), setView('list')) },
                    { key: 'menus', label: 'メニュー', icon: Scissors, on: false, go: () => (setTab('settings'), setJump('salon-menus')) },
                    { key: 'staff', label: '美容師', icon: Users, on: false, go: () => (setTab('settings'), setJump('salon-staff')) },
                    { key: 'place', label: 'お店の情報', icon: Storefront, on: false, go: () => (setTab('settings'), setJump('salon-place')) },
                    { key: 'settings', label: '設定', icon: Gear, on: tab === 'settings', go: () => (setTab('settings'), window.scrollTo({ top: 0 })) },
                  ] as { key: string; label: string; icon: PhosphorIcon; on: boolean; go: () => void }[]
                ).map((item) => (
                  <li key={item.key}>
                    <button className={sa.sideItem} aria-current={item.on ? 'page' : undefined} onClick={item.go}>
                      <item.icon size={24} weight={item.on ? 'fill' : 'regular'} aria-hidden focusable="false" />
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <MarketCard
              salonId={salon.id}
              salonName={salon.name}
              slots={list}
              listed={listing === 'listed'}
              presetCount={usablePresets.length}
              now={now}
            />
          </aside>
          )}

          <div className={sa.main}>
          {/* 上の道具：今日の予定の検索・お知らせのベル */}
          <div className={sa.tools}>
            <SalonSearch slots={list} showNo={UI_OPTIONS.showBookingNo} onSelect={setSelected} />
            <SalonBell salonId={salon.id} slots={list} onSelect={setSelected} />
          </div>
          <div className={sa.head} data-salon-head="">
            <div className={sa.greet}>
              <p className={sa.headShop}>
                <Storefront size={20} weight="duotone" aria-hidden focusable="false" />
                {salon.name}
              </p>
              <h1 className={sa.title}>{greeting(now)}</h1>
              <p className={sa.lead}>本日の営業状況を確認できます。</p>
            </div>
            <div className={sa.headAside}>
              <p className={`${sa.date} num`}>{longDate.format(now)}</p>
              {tab === 'today' && canPublish && (openCount > 0 || pausedFuture > 0) && (
                <div className={sa.pause}>
                  {openCount > 0 && (
                    <Button variant="secondary" icon={PauseCircle} onClick={() => setConfirmPause(true)}>
                      今日はここまで
                    </Button>
                  )}
                  {pausedFuture > 0 && (
                    <Button variant="quiet" icon={ArrowCounterClockwise} onClick={resumeToday}>
                      元に戻す（{pausedFuture}枠）
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          <Stack gap={3}>
            {listingBanner}
            {!started && <AlertGate wake={wake} onStart={start} />}
            {started && wake === 'unsupported' && (
              <Notice tone="info">この端末では、画面が自動で消えるのを止められません。端末の設定で、自動ロックを長めにしてください。</Notice>
            )}
          </Stack>

          {tab === 'today' && (
            <>
                {UI_OPTIONS.salonAchievement && (
                  <section className={sa.tiles} aria-label="今日の成果">
                    <Tile icon={CalendarCheck} label="本日の予約" value={achievement.count} unit="件" sub="空き時間から生まれた予約" diff={compare?.booked} />
                    <Tile icon={Clock} label="公開中の空き枠" value={openCount} unit="件" sub="予約を待っている枠（前日比は、今日公開した枠の数）" diff={compare?.published} />
                    <Tile
                      icon={UserCircle}
                      label="キャンセル待ち"
                      value={waitCount ?? '—'}
                      unit={waitCount === null ? undefined : '件'}
                      sub={waitCount === null ? 'データベースの更新後に使えます' : '空きが出たら知らせるお客様'}
                      diff={waitCount === null || waitYesterday === null ? null : waitCount - waitYesterday}
                    />
                    <Tile icon={HourglassMedium} label="未対応の確認" value={overdue.length} unit="件" sub="来店の記録がまだの予約" diff={compare?.unrecorded} />
                  </section>
                )}

                {overdue.length > 0 && (
                  <section className={sa.overdue} role="alert">
                    <p className={sa.overdueTitle}>
                      <HourglassMedium size={24} weight="duotone" aria-hidden focusable="false" />
                      来店の記録がまだです（{overdue.length}件）
                    </p>
                    <p className={sa.overdueSub}>開始から{UI_OPTIONS.overdueMinutes}分以上たっています。記録すると、来店率が正しく数えられます。</p>
                    <ul className={sa.overdueList}>
                      {overdue.map((s) => {
                        const b = activeBooking(s)!;
                        return (
                          <li key={s.id} className={sa.overdueItem}>
                            <span className="num">
                              {fmtTime(s.start_at)} {b.contact_name} 様{UI_OPTIONS.showBookingNo && b.booking_no !== null && `（${b.booking_no}）`}
                            </span>
                            <span className={sa.overdueActions}>
                              <Button variant="primary" icon={SealCheck} onClick={() => record(b.id, 'complete')}>
                                来店済み
                              </Button>
                              <Button variant="danger" icon={Prohibit} onClick={() => record(b.id, 'no_show')}>
                                無断キャンセル
                              </Button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

            <div className={sa.grid}>
              <Panel flush className={sa.plan}>
                <div className={sa.planHead}>
                  <SectionHead icon={Clock} title={view === 'week' ? '1週間の予定' : '今日の予定'} />
                  {view === 'week' ? (
                    <span className={sa.weekNav}>
                      <button type="button" className={sa.weekStep} aria-label="前の週" onClick={() => setWeekOffset((w) => w - 1)}>
                        <CaretLeft size={20} aria-hidden focusable="false" />
                      </button>
                      <span className={`${sa.planDate} num`}>
                        {shortDate.format(weekStart)}〜{shortDate.format(new Date(weekStart.getTime() + 6 * 86_400_000))}
                      </span>
                      <button type="button" className={sa.weekStep} aria-label="次の週" onClick={() => setWeekOffset((w) => w + 1)}>
                        <CaretRight size={20} aria-hidden focusable="false" />
                      </button>
                      {weekOffset !== 0 && (
                        <Button variant="quiet" onClick={() => setWeekOffset(0)}>
                          今週
                        </Button>
                      )}
                    </span>
                  ) : (
                    <span className={`${sa.planDate} num`}>{longDate.format(now).replace(/^\d+年/, '')}</span>
                  )}
                  <Segmented
                    label="表示の切り替え"
                    className={sa.planView}
                    value={view}
                    onChange={setView}
                    options={[
                      {
                        value: 'chart',
                        label: (
                          <>
                            <span className={sa.onlyWide}>日表示</span>
                            <span className={sa.onlyNarrow}>タイムライン</span>
                          </>
                        ),
                      },
                      { value: 'week', label: '週表示' },
                      { value: 'list', label: '時刻の順の一覧' },
                    ]}
                  />
                </div>
                {/* 絞り込み（メニュー・担当）と、受付を終えた枠の表示 */}
                <div className={sa.planSub}>
                  <span className={sa.filters}>
                    <select className={sa.filter} aria-label="メニューで絞り込む" value={menuFilter} onChange={(e) => setMenuFilter(e.target.value)}>
                      <option value="">すべてのメニュー</option>
                      {menus.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.is_active ? '' : '（停止中）'}
                        </option>
                      ))}
                    </select>
                    <select className={sa.filter} aria-label="担当で絞り込む" value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
                      <option value="">すべての担当</option>
                      {stylists.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                          {x.is_active ? '' : '（停止中）'}
                        </option>
                      ))}
                      <option value="none">担当なし</option>
                    </select>
                    {filtered && (
                      <Button
                        variant="text"
                        onClick={() => {
                          setMenuFilter('');
                          setStaffFilter('');
                        }}
                      >
                        絞り込みを外す
                      </Button>
                    )}
                  </span>
                  {endedCount > 0 && (
                    <Check checked={showEnded} onChange={setShowEnded}>
                      受付終了・取り下げの枠も表示（{endedCount}件）
                    </Check>
                  )}
                </div>
                {view === 'week' ? (
                  weekSlots === null ? (
                    <div className={sa.planPad}>
                      <Loading rows={2} />
                    </div>
                  ) : (
                    <>
                      <WeekBands
                        slots={weekVisible}
                        weekStart={weekStart}
                        now={now}
                        freshIds={freshIds}
                        showNo={UI_OPTIONS.showBookingNo}
                        onSelect={setSelected}
                        onEmpty={(startAt) => canPublish && setSheet({ start: startAt, stylistId: null })}
                      />
                      <div className={sa.planPad}>
                        <Fine>
                          枠を押すと詳細が開きます。今日の列の空いているところを押すと、その時刻から枠を出せます（枠を出せるのは今日だけです）。
                          {weekVisible.length === 0 && ' この週に表示する枠はありません。'}
                        </Fine>
                      </div>
                    </>
                  )
                ) : slots === null ? (
                  <div className={sa.planPad}>
                    <Loading rows={2} />
                  </div>
                ) : visibleSlots.length === 0 ? (
                  <Empty icon={Clock}>{slots.length === 0 ? '今日はまだ枠を出していません。「枠を出す」から公開できます。' : filtered ? '絞り込みに合う枠はありません。' : '表示する枠はありません。'}</Empty>
                ) : view === 'list' ? (
                  <SlotList slots={visibleSlots} now={now} freshIds={freshIds} showNo={UI_OPTIONS.showBookingNo} onSelect={setSelected} />
                ) : (
                  <>
                    <div className={sa.onlyWide}>
                      <StaffBands
                        slots={visibleSlots}
                        stylists={stylists}
                        now={now}
                        freshIds={freshIds}
                        showNo={UI_OPTIONS.showBookingNo}
                        onSelect={setSelected}
                        onEmpty={(startAt, stylistId) => {
                          const usable = stylistId && stylists.some((x) => x.id === stylistId && x.is_active) ? stylistId : null;
                          if (canPublish) setSheet({ start: startAt, stylistId: usable });
                        }}
                      />
                      <div className={sa.planPad}>
                        <Fine>枠を押すと詳細が開き、空いているところを押すと、その時刻から枠を出せます。斜線は受付の締切を過ぎた時間です。</Fine>
                      </div>
                    </div>
                    <div className={sa.onlyNarrow}>
                      <Timeline slots={visibleSlots} now={now} freshIds={freshIds} onSelect={setSelected} />
                    </div>
                  </>
                )}
              </Panel>

              <div className={sa.aside}>
                <Panel className={sa.next}>
                  <SectionHead
                    icon={CalendarCheck}
                    title="次の予約"
                    aside={
                      upcoming.length > 0 && (
                        <button className={sa.seeAll} onClick={() => setView('list')}>
                          すべて見る
                          <CaretRight size={20} aria-hidden focusable="false" />
                        </button>
                      )
                    }
                  />
                  {slots === null ? (
                    <Loading rows={1} />
                  ) : upcoming.length === 0 ? (
                    <Empty icon={CalendarCheck}>これからの予約はまだありません。</Empty>
                  ) : (
                    <ul className={sa.upcoming}>
                      {upcoming.map((s) => {
                        const b = activeBooking(s)!;
                        const fresh = freshIds.includes(b.id);
                        return (
                          <li key={s.id}>
                            <button className={sa.upItem} onClick={() => setSelected(s)}>
                              <span className={sa.upTime}>{fmtTime(s.start_at)}</span>
                              <span className={sa.upBody}>
                                <span className={sa.upName}>
                                  {b.contact_name} 様
                                  {UI_OPTIONS.showBookingNo && b.booking_no !== null && <span className={sa.upNo}>{b.booking_no}</span>}
                                </span>
                                <span className={sa.upSub}>
                                  {s.menu?.name}
                                  {s.stylist && ` ・ ${s.stylist.name}`}
                                  {b.photo_path && ' ・ 写真あり'}
                                  {b.note && ' ・ メモあり'}
                                </span>
                              </span>
                              {fresh ? <FreshMark /> : <Label kind="action">予約あり</Label>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Panel>

                {/* 枠を出す・いつもの枠（広い画面だけ。狭い画面は下の操作のバー） */}
                <div className={sa.publish}>
                  {publishButton}
                  {presetButtons}
                </div>

                <Panel className={sa.legendPanel}>
                  <StateLegend />
                </Panel>

                <Panel className={sa.info}>
                  <SectionHead icon={Info} title="今日の営業情報" as="h2" />
                  <dl className={sa.infoList}>
                    <div>
                      <dt>掲載</dt>
                      <dd>{LISTING_LABEL[listing ?? ''] ?? '確認中'}</dd>
                    </div>
                    <div>
                      <dt>美容師</dt>
                      <dd className="num">{stylists.filter((x) => x.is_active).length}名</dd>
                    </div>
                    <div>
                      <dt>メニュー</dt>
                      <dd className="num">{menus.filter((m) => m.is_active).length}件</dd>
                    </div>
                    <div>
                      <dt>埋まった時間</dt>
                      <dd className="num">{hm(achievement.minutes)}</dd>
                    </div>
                    <div>
                      <dt>来店済みの合計</dt>
                      <dd className="num">{fmtYen(achievement.yen)}</dd>
                    </div>
                  </dl>
                  <button className={sa.seeAll} onClick={() => setTab('settings')}>
                    詳しく見る
                    <CaretRight size={20} aria-hidden focusable="false" />
                  </button>
                </Panel>

                {started && permission === 'default' && (
                  <Button variant="quiet" size="md" block icon={BellRinging} onClick={async () => setPermission(await askNotificationPermission())}>
                    ほかのタブを見ているときも、ブラウザの通知で知らせる
                  </Button>
                )}
              </div>
            </div>
            </>
          )}

          {tab === 'settings' && (
            <Stack gap={4}>
              <SalonSettings key={salon.id} client={client} salon={salon} menus={menus} stylists={stylists} lineGroup={lineGroup} onSaved={loadSalon} />
              <ScreenTitle as="h2" tight>
                スタッフのアカウント
              </ScreenTitle>
              <AccountSecurity
                client={client}
                role="salon"
                providers={providers}
                returnPath="/salon?tab=settings"
                linked={linked}
                authError={session ? authError : null}
              />
              <Panel>
                <SectionHead icon={Storefront} title="別のお店（系列店・2店舗目）" as="p" />
                <SubText>このアカウントのまま、別のお店の掲載を申し込めます。運営の審査のあと、画面の上でお店を切り替えて使えます。</SubText>
                <ButtonLink href="/salon/signup" variant="secondary" size="md" block icon={Plus}>
                  別のお店を申し込む
                </ButtonLink>
              </Panel>
              <Button
                variant="text"
                icon={ArrowCounterClockwise}
                onClick={async () => {
                  await client.rpc('salon_set_onboarding', { p_salon_id: salon.id, p_step: 0 });
                  setTab('today');
                  loadSalon();
                }}
              >
                初期設定の3ステップをもう一度表示する
              </Button>
            </Stack>
          )}
          </div>

          {/* 下に固定の操作のバー。狭い画面は「主な操作」（今日・枠を出す・設定）、960〜1279px は「枠を出す」といつもの枠だけ、1280px〜は使わない */}
          <nav className={sa.bar} aria-label={wide ? "画面下の操作" : "主な操作"}>
            <div className={sa.barInner}>
              {tab === 'today' && presetButtons}
              <div className={sa.barMain}>
                {!wide && (
                  <button className={sa.tab} aria-current={tab === 'today' ? 'page' : undefined} onClick={() => setTab('today')}>
                    <CalendarCheck size={24} weight={tab === 'today' ? 'fill' : 'regular'} aria-hidden focusable="false" />
                    今日
                  </button>
                )}
                {publishButton}
                {!wide && (
                  <button className={sa.tab} aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => setTab('settings')}>
                    <Gear size={24} weight={tab === 'settings' ? 'fill' : 'regular'} aria-hidden focusable="false" />
                    設定
                  </button>
                )}
              </div>
            </div>
          </nav>

          {sheet && (
            <PublishSheet
              client={client}
              salonId={salon.id}
              menus={menus}
              stylists={stylists}
              presets={presets}
              now={sheet.openedAt}
              initialStart={sheet.start}
              initialStylistId={sheet.stylistId}
              onPublished={reportPublish}
              onPresetsChanged={loadSalon}
              onClose={() => setSheet(null)}
            />
          )}
          {selected && (
            <SlotPanel
              client={client}
              slot={selected}
              now={now}
              onChanged={(text) => {
                showToast(text);
                loadSlots();
              }}
              onClose={() => setSelected(null)}
            />
          )}
          {confirmPause && (
            <Sheet label="今日の受付をここまでにしますか" role="alertdialog" narrow onClose={() => setConfirmPause(false)}>
              <SectionHead icon={PauseCircle} title="今日の受付をここまでにしますか？" as="p" />
              <SubText>公開中の{openCount}枠をすべて取り下げます。入っている予約はそのままです。取り下げた枠は一覧に残り、「元に戻す」で締切前のものだけ再び公開できます。</SubText>
              <Pair>
                <Button variant="quiet" size="md" onClick={() => setConfirmPause(false)}>
                  やめる
                </Button>
                <Button variant="dangerSolid" size="md" onClick={pauseToday}>
                  {openCount}枠を取り下げる
                </Button>
              </Pair>
            </Sheet>
          )}
          <NewBookingAlert items={incoming} soundOn={started} showNo={UI_OPTIONS.showBookingNo} onAcknowledge={acknowledge} />
        </div>
      )}

      {toast && (
        <ToastBar key={toast.id} tone={toast.accent ? 'action' : 'neutral'} position="top">
          {toast.text}
        </ToastBar>
      )}
    </Page>
  );
}
