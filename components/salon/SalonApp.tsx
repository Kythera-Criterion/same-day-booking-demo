'use client';

// サロンの画面
//   営業の始めに「通知音をオンにして始める」→ 予約が入ると画面全体の点滅と音で知らせ、どこを押しても確認・詳細が開く
//   今日の成果・来店の記録漏れ・「今日はここまで」・担当ごとの帯（タブレット横向き）／縦のタイムライン（スマートフォン）
//   空いた時間を伝えると枠に切り分けて出せる。初めてのときは3ステップの初期設定

import { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/AppHeader';
import LoginBox from '@/components/LoginBox';
import { Empty, ErrorState, Loading, NotConfigured } from '@/components/States';
import { one, useRoleSession } from '@/lib/supabase';
import { requestDispatch, useDispatchTicker } from '@/lib/dispatch-client';
import { askNotificationPermission, browserNotify, notificationPermission } from '@/lib/alerts';
import { toMessage } from '@/lib/errors';
import { UI_OPTIONS } from '@/lib/ui-options';
import { fmtTime, fmtYen } from '@/lib/time';
import { keepScreenOn, rekeepOnVisible, wakeLockSupported } from '@/lib/wakelock';
import { AlertGate, NewBookingAlert, type IncomingBooking } from './Alerts';
import Onboarding from './Onboarding';
import PublishSheet, { publishFree, publishOffsets, type PublishResult } from './PublishSheet';
import SalonSettings from './SalonSettings';
import SlotPanel from './SlotPanel';
import SlotList from './SlotList';
import StaffBands from './StaffBands';
import Timeline from './Timeline';
import { activeBooking, useSalonData, type Preset, type SalonSlot } from './useSalonData';

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

export default function SalonApp({ demoMode }: { demoMode: boolean }) {
  const { client, session, ready } = useRoleSession('salon');
  const { salon, menus, stylists, presets, lineGroup, onboardingStep, slots, error, loadSalon, loadSlots } = useSalonData(client, session);
  const [tab, setTab] = useState<'today' | 'settings'>('today');
  const [sheet, setSheet] = useState<{ start: Date | null; stylistId: string | null } | null>(null);
  const [selected, setSelected] = useState<SalonSlot | null>(null);
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const [incoming, setIncoming] = useState<IncomingBooking[]>([]);
  const [started, setStarted] = useState(false);
  const [wake, setWake] = useState<'idle' | 'on' | 'unsupported'>('idle');
  const [confirmPause, setConfirmPause] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [permission, setPermission] = useState<string>('default');
  const [now, setNow] = useState(() => new Date());
  const [view, setView] = useState<'chart' | 'list'>('chart');
  const [showEnded, setShowEnded] = useState(false);

  useDispatchTicker(client, !!salon);

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
  useEffect(() => {
    if (!client || !salon) return;
    const channel = client
      .channel(`salon-live-${salon.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings' }, async (payload) => {
        const row = payload.new as { id: string; contact_name: string; slot_id: string; booking_no: number | null; status: string };
        if (row.status !== 'confirmed') return;
        setFreshIds((ids) => [...ids, row.id]);
        loadSlots();
        const { data: slotRow } = await client.from('slots').select('start_at,menus(name)').eq('id', row.slot_id).maybeSingle();
        const slot = slotRow ? { start_at: slotRow.start_at as string, menu: one(slotRow.menus as { name: string } | { name: string }[] | null) } : null;
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
  }, [client, salon, loadSlots]);

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
    if (!client) return;
    const menu = menus.find((m) => m.id === p.menu_id);
    if (!menu) return;
    reportPublish(
      p.kind === 'free' && p.free_minutes
        ? await publishFree(client, menu, p.stylist_id, p.free_minutes)
        : await publishOffsets(client, menu, p.stylist_id, p.offsets_min),
    );
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
  const visibleSlots = showEnded ? list : list.filter((s) => !isEnded(s));

  return (
    <main className="app app-salon">
      <AppHeader role="サロン" home="/salon">
        {session && (
          <button onClick={() => client.auth.signOut()} aria-label="ログアウト">
            ログアウト
          </button>
        )}
      </AppHeader>

      {ready && !session && (
        <LoginBox client={client} title="サロンのスタッフとしてログイン" demoMode={demoMode} demoAccounts={DEMO_ACCOUNTS} />
      )}
      {error && <ErrorState onRetry={loadSalon}>{error}</ErrorState>}
      {session && salon === undefined && !error && <Loading rows={3} />}
      {session && salon === null && (
        <div className="card">
          <p className="card-title">このアカウントは、どのサロンにも所属していません</p>
          <p className="card-sub">運営に、掲載の承認とスタッフの登録をご依頼ください。</p>
        </div>
      )}

      {salon && onboarding && (
        <Onboarding
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
        <>
          <div className="salon-head">
            <h1 className="screen-title salon-title">{salon.name}</h1>
            {tab === 'today' && (openCount > 0 || pausedFuture > 0) && (
              <div className="pause-ctl">
                {openCount > 0 && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setConfirmPause(true)}>
                    今日はここまで
                  </button>
                )}
                {pausedFuture > 0 && (
                  <button className="btn btn-quiet btn-sm" onClick={resumeToday}>
                    元に戻す（{pausedFuture}枠）
                  </button>
                )}
              </div>
            )}
          </div>

          {!started && <AlertGate wake={wake} onStart={start} />}
          {started && wake === 'unsupported' && (
            <p className="notice notice-info">この端末では、画面が自動で消えるのを止められません。端末の設定で、自動ロックを長めにしてください。</p>
          )}

          {tab === 'today' && (
            <div className="salon-grid">
              <div className="stack">
                {UI_OPTIONS.salonAchievement && (
                  <section className="achieve" aria-label="今日の成果">
                    <p className="achieve-label">今日、空き時間から生まれた予約</p>
                    <p className="achieve-main num">
                      <strong>{achievement.count}</strong>件
                      <span className="achieve-sep">・</span>
                      <strong>{hm(achievement.minutes)}</strong>
                      <span className="achieve-sep">・</span>
                      <strong>{fmtYen(achievement.yen)}</strong>
                      <small>（来店済みの合計）</small>
                    </p>
                  </section>
                )}

                {overdue.length > 0 && (
                  <section className="overdue" role="alert">
                    <p className="overdue-title">来店の記録がまだです（{overdue.length}件）</p>
                    <p className="overdue-sub">開始から{UI_OPTIONS.overdueMinutes}分以上たっています。記録すると、来店率が正しく数えられます。</p>
                    <ul>
                      {overdue.map((s) => {
                        const b = activeBooking(s)!;
                        return (
                          <li key={s.id}>
                            <span className="num">
                              {fmtTime(s.start_at)} {b.contact_name} 様{UI_OPTIONS.showBookingNo && b.booking_no !== null && `（${b.booking_no}）`}
                            </span>
                            <span className="overdue-actions">
                              <button className="btn btn-primary btn-sm" onClick={() => record(b.id, 'complete')}>
                                来店済み
                              </button>
                              <button className="btn btn-danger btn-sm" onClick={() => record(b.id, 'no_show')}>
                                無断キャンセル
                              </button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {started && permission === 'default' && (
                  <button className="btn btn-quiet btn-block" onClick={async () => setPermission(await askNotificationPermission())}>
                    ほかのタブを見ているときも、ブラウザの通知で知らせる
                  </button>
                )}

                <section className="card">
                  <h2 className="card-title">これからの予約</h2>
                  {slots === null ? (
                    <Loading rows={1} />
                  ) : upcoming.length === 0 ? (
                    <Empty>これからの予約はまだありません。</Empty>
                  ) : (
                    <ul className="upcoming">
                      {upcoming.map((s) => {
                        const b = activeBooking(s)!;
                        const fresh = freshIds.includes(b.id);
                        return (
                          <li key={s.id}>
                            <button className={fresh ? 'is-fresh' : ''} onClick={() => setSelected(s)}>
                              <span className="upcoming-time num">{fmtTime(s.start_at)}</span>
                              <span className="upcoming-body">
                                <strong>
                                  {b.contact_name} 様
                                  {UI_OPTIONS.showBookingNo && b.booking_no !== null && <span className="no-tag num">{b.booking_no}</span>}
                                </strong>
                                <small>
                                  {s.menu?.name}
                                  {s.stylist && ` ・ ${s.stylist.name}`}
                                  {b.photo_path && ' ・ 写真あり'}
                                  {b.note && ' ・ メモあり'}
                                </small>
                              </span>
                              <span className="pill pill-confirmed">{fresh ? '新しい予約' : '予約あり'}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </div>

              <section className="card card-flush timeline-card">
                <div className="plan-head card-pad">
                  <h2 className="card-title">今日の予定</h2>
                  <div className="segmented plan-view" role="group" aria-label="表示の切り替え">
                    <button aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
                      <span className="only-wide">担当ごとの帯</span>
                      <span className="only-narrow">タイムライン</span>
                    </button>
                    <button aria-pressed={view === 'list'} onClick={() => setView('list')}>
                      時刻の順の一覧
                    </button>
                  </div>
                </div>
                <div className="plan-sub card-pad">
                  <span className="legend">
                    <i className="lg-open" />公開中 <i className="lg-confirmed" />予約あり <i className="lg-completed" />来店済み <i className="lg-closed" />取り下げ・受付終了
                  </span>
                  {endedCount > 0 && (
                    <label className="check plan-toggle">
                      <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} />
                      <span>受付終了・取り下げの枠も表示（{endedCount}件）</span>
                    </label>
                  )}
                </div>
                {slots === null ? (
                  <div className="card-pad">
                    <Loading rows={2} />
                  </div>
                ) : visibleSlots.length === 0 ? (
                  <Empty>{slots.length === 0 ? '今日はまだ枠を出していません。下の「枠を出す」から公開できます。' : '表示する枠はありません。'}</Empty>
                ) : view === 'list' ? (
                  <SlotList slots={visibleSlots} now={now} freshIds={freshIds} showNo={UI_OPTIONS.showBookingNo} onSelect={setSelected} />
                ) : (
                  <>
                    <div className="only-wide">
                      <StaffBands
                        slots={visibleSlots}
                        stylists={stylists}
                        now={now}
                        freshIds={freshIds}
                        showNo={UI_OPTIONS.showBookingNo}
                        onSelect={setSelected}
                        onEmpty={(startAt, stylistId) => setSheet({ start: startAt, stylistId })}
                      />
                      <p className="fine-print card-pad">
                        横にスクロールできます。枠を押すと詳細が開き、空いているところを押すと、その時刻から枠を出せます。斜線は受付の締切を過ぎた時間です。
                      </p>
                    </div>
                    <div className="only-narrow">
                      <Timeline slots={visibleSlots} now={now} freshIds={freshIds} onSelect={setSelected} />
                    </div>
                  </>
                )}
              </section>
            </div>
          )}

          {tab === 'settings' && (
            <>
              <SalonSettings client={client} salon={salon} menus={menus} stylists={stylists} lineGroup={lineGroup} onSaved={loadSalon} />
              <button
                className="btn btn-text"
                onClick={async () => {
                  await client.rpc('salon_set_onboarding', { p_salon_id: salon.id, p_step: 0 });
                  setTab('today');
                  loadSalon();
                }}
              >
                初期設定の3ステップをもう一度表示する
              </button>
            </>
          )}

          <nav className="bottom-bar" aria-label="主な操作">
            {tab === 'today' && presets.length > 0 && (
              <div className="preset-row">
                {presets.slice(0, 4).map((p) => (
                  <button key={p.id} className="preset" onClick={() => quickPreset(p)}>
                    <small>{p.kind === 'free' ? 'いつもの空き方' : 'いつもの枠'}</small>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <div className="bottom-main">
              <button className={`bottom-tab ${tab === 'today' ? 'is-on' : ''}`} onClick={() => setTab('today')}>
                今日
              </button>
              <button className="btn btn-primary btn-lg bottom-cta" onClick={() => setSheet({ start: null, stylistId: null })}>
                ＋ 枠を出す
              </button>
              <button className={`bottom-tab ${tab === 'settings' ? 'is-on' : ''}`} onClick={() => setTab('settings')}>
                設定
              </button>
            </div>
          </nav>

          {sheet && (
            <PublishSheet
              client={client}
              salonId={salon.id}
              menus={menus}
              stylists={stylists}
              presets={presets}
              now={new Date()}
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
            <div className="sheet-backdrop" onClick={() => setConfirmPause(false)}>
              <section className="sheet sheet-narrow" role="alertdialog" aria-label="今日はここまで" onClick={(e) => e.stopPropagation()}>
                <div className="sheet-grip" aria-hidden />
                <p className="card-title">今日の受付をここまでにしますか？</p>
                <p className="card-sub">公開中の{openCount}枠をすべて取り下げます。入っている予約はそのままです。取り下げた枠は一覧に残り、「元に戻す」で締切前のものだけ再び公開できます。</p>
                <div className="action-pair">
                  <button className="btn btn-quiet" onClick={() => setConfirmPause(false)}>
                    やめる
                  </button>
                  <button className="btn btn-danger" onClick={pauseToday}>
                    {openCount}枠を取り下げる
                  </button>
                </div>
              </section>
            </div>
          )}
          <NewBookingAlert items={incoming} soundOn={started} showNo={UI_OPTIONS.showBookingNo} onAcknowledge={acknowledge} />
        </>
      )}

      {toast && (
        <div key={toast.id} className={`toast toast-top ${toast.accent ? 'toast-accent' : ''}`} role="status">
          {toast.text}
        </div>
      )}
    </main>
  );
}
