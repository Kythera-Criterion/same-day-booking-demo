'use client';

// サロンの画面：今日のまとめ・タイムライン・枠を出す（下部の操作で片手で）・予約の操作・店舗の設定

import { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/AppHeader';
import LoginBox from '@/components/LoginBox';
import { Empty, ErrorState, Loading, NotConfigured } from '@/components/States';
import { useRoleSession } from '@/lib/supabase';
import { useDispatchTicker } from '@/lib/dispatch-client';
import {
  askNotificationPermission,
  browserNotify,
  chime,
  notificationPermission,
  unlockSound,
  vibrate,
} from '@/lib/alerts';
import { fmtTime } from '@/lib/time';
import PublishSheet, { publishSlots, type PublishResult } from './PublishSheet';
import SalonSettings from './SalonSettings';
import SlotPanel from './SlotPanel';
import Timeline from './Timeline';
import { activeBooking, useSalonData, type Preset, type SalonSlot } from './useSalonData';

const DEMO_ACCOUNTS = [
  { email: 'salon-a@demo.test', label: 'HAIR ROOM AOI' },
  { email: 'salon-b@demo.test', label: 'atelier nagi' },
  { email: 'salon-c@demo.test', label: 'Salon Komorebi' },
];

type Toast = { id: number; text: string; accent?: boolean };

export default function SalonApp({ demoMode }: { demoMode: boolean }) {
  const { client, session, ready } = useRoleSession('salon');
  const { salon, menus, stylists, presets, lineGroup, slots, error, loadSalon, loadSlots } = useSalonData(client, session);
  const [tab, setTab] = useState<'today' | 'settings'>('today');
  const [sheet, setSheet] = useState(false);
  const [selected, setSelected] = useState<SalonSlot | null>(null);
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [permission, setPermission] = useState<string>('default');
  const [now, setNow] = useState(() => new Date());

  useDispatchTicker(client, !!salon);

  useEffect(() => {
    setPermission(notificationPermission());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const showToast = useCallback((text: string, accent = false) => {
    const id = Date.now();
    setToast({ id, text, accent });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 4500);
  }, []);

  // 予約が入った瞬間：画面のお知らせ・音・振動・ブラウザ通知
  useEffect(() => {
    if (!client || !salon) return;
    const channel = client
      .channel(`salon-live-${salon.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings' }, (payload) => {
        const row = payload.new as { id: string; contact_name: string; slot_id: string };
        setFreshIds((ids) => [...ids, row.id]);
        showToast(`新しい予約が入りました　${row.contact_name} 様`, true);
        chime();
        vibrate();
        browserNotify('新しい予約が入りました', `${row.contact_name} 様`);
        loadSlots();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings' }, () => loadSlots())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, () => loadSlots())
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [client, salon, loadSlots, showToast]);

  // 開いている枠・予約の内容を最新に保つ
  useEffect(() => {
    if (!selected || !slots) return;
    const latest = slots.find((s) => s.id === selected.id);
    if (latest && latest !== selected) setSelected(latest);
  }, [slots, selected]);

  function reportPublish(r: PublishResult) {
    if (r.ok.length > 0) showToast(`${r.ok.join('・')} の枠を公開しました`);
    else if (r.ng.length > 0) showToast(`出せませんでした：${r.ng.join('、')}`);
    loadSlots();
  }

  async function quickPreset(p: Preset) {
    if (!client) return;
    const menu = menus.find((m) => m.id === p.menu_id);
    if (!menu) return;
    reportPublish(await publishSlots(client, menu, p.stylist_id, p.offsets_min));
  }

  if (!client) return <NotConfigured />;

  const summary = {
    published: (slots ?? []).length,
    booked: (slots ?? []).filter((s) => activeBooking(s)).length,
    visited: (slots ?? []).filter((s) => activeBooking(s)?.status === 'completed').length,
    waiting: (slots ?? []).filter((s) => s.status === 'open').length,
  };
  const upcoming = (slots ?? [])
    .filter((s) => activeBooking(s)?.status === 'confirmed')
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <main className="app app-salon" onPointerDown={unlockSound}>
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

      {salon && (
        <>
          <h1 className="screen-title salon-title">{salon.name}</h1>

          {tab === 'today' && (
            <div className="stack">
              <section className="kpis" aria-label="今日のまとめ">
                <div className="kpi">
                  <span className="kpi-num num">{summary.published}</span>
                  <span className="kpi-label">公開した枠</span>
                </div>
                <div className="kpi">
                  <span className="kpi-num num">{summary.booked}</span>
                  <span className="kpi-label">予約</span>
                </div>
                <div className="kpi">
                  <span className="kpi-num num">{summary.visited}</span>
                  <span className="kpi-label">来店</span>
                </div>
              </section>

              {permission === 'default' && (
                <button
                  className="btn btn-quiet btn-block"
                  onClick={async () => setPermission(await askNotificationPermission())}
                >
                  予約が入ったらブラウザでも知らせる
                </button>
              )}

              {upcoming.length > 0 && (
                <section className="card">
                  <h2 className="card-title">これからの予約</h2>
                  <ul className="upcoming">
                    {upcoming.map((s) => {
                      const b = activeBooking(s)!;
                      return (
                        <li key={s.id}>
                          <button className={freshIds.includes(b.id) ? 'is-fresh' : ''} onClick={() => setSelected(s)}>
                            <span className="upcoming-time num">{fmtTime(s.start_at)}</span>
                            <span className="upcoming-body">
                              <strong>{b.contact_name} 様</strong>
                              <small>
                                {s.menu?.name}
                                {b.photo_path && ' ・ 写真あり'}
                                {b.note && ' ・ メモあり'}
                              </small>
                            </span>
                            <span className="pill pill-confirmed">{freshIds.includes(b.id) ? '新しい予約' : '予約あり'}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              <section className="card card-flush">
                <div className="row-between card-pad">
                  <h2 className="card-title">今日のタイムライン</h2>
                  <span className="legend">
                    <i className="lg-open" />予約待ち <i className="lg-confirmed" />予約 <i className="lg-completed" />来店
                  </span>
                </div>
                {slots === null ? (
                  <div className="card-pad">
                    <Loading rows={2} />
                  </div>
                ) : slots.length === 0 ? (
                  <Empty>今日はまだ枠を出していません。下の「枠を出す」から公開できます。</Empty>
                ) : (
                  <Timeline slots={slots} now={now} freshIds={freshIds} onSelect={setSelected} />
                )}
              </section>
            </div>
          )}

          {tab === 'settings' && (
            <SalonSettings
              client={client}
              salon={salon}
              menus={menus}
              stylists={stylists}
              lineGroup={lineGroup}
              onSaved={loadSalon}
            />
          )}

          <nav className="bottom-bar" aria-label="主な操作">
            {tab === 'today' && presets.length > 0 && (
              <div className="preset-row">
                {presets.slice(0, 3).map((p) => (
                  <button key={p.id} className="preset" onClick={() => quickPreset(p)}>
                    <small>いつもの枠</small>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <div className="bottom-main">
              <button className={`bottom-tab ${tab === 'today' ? 'is-on' : ''}`} onClick={() => setTab('today')}>
                今日
              </button>
              <button className="btn btn-primary btn-lg bottom-cta" onClick={() => setSheet(true)}>
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
              onPublished={reportPublish}
              onPresetsChanged={loadSalon}
              onClose={() => setSheet(false)}
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
