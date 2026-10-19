'use client';

// 運営の「概要」（運営の画面のデザイン案）：今の数字4つ（前日比つき）・予約数の推移・人気のメニューの種類・要対応・最近の運営の動き・システム状況。
// すべてデータベースの今の値から数える（見本の数字は出さない）

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { ErrorState, Loading } from '@/components/States';
import Button from '@/components/ui/Button';
import Label, { type LabelKind } from '@/components/ui/Label';
import { Panel, SectionHead } from '@/components/ui/Surface';
import {
  Bell,
  CalendarCheck,
  CaretRight,
  ChartBar,
  ChatCircle,
  ClipboardText,
  Clock,
  HourglassMedium,
  ListBullets,
  ShieldCheck,
  Storefront,
  WarningCircle,
} from '@/components/ui/icons';
import { one } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import { jstDateKey, jstTodayStart } from '@/lib/time';
import { UI_OPTIONS } from '@/lib/ui-options';
import { ColumnChart } from './Charts';
import { ACTION_LABEL } from './Logs';
import SystemStatus from './SystemStatus';
import s from './AdminHome.module.css';

export type AdminTab = 'home' | 'dashboard' | 'overview' | 'salons' | 'applications' | 'users' | 'inquiries' | 'system' | 'logs' | 'members' | 'trial';

type Salon = { id: string; name: string; is_approved: boolean; created_at: string };
type App = { id: string; salon_name: string; area_text: string; status: string; created_at: string };
type SlotRow = {
  id: string;
  start_at: string;
  salons: { name: string } | { name: string }[] | null;
  menus: { name: string } | { name: string }[] | null;
  bookings: { id: string; status: string; created_at: string }[] | null;
};
type Note = { id: number; kind: string; status: string; created_at: string; recipient: string | null; last_error: string | null };
type Audit = { id: number; action: string; target_id: string | null; at: string };
type Inquiry = { id: string; no: number; subject: string; from_role: string; status: string; created_at: string };

// メニューの種類（メニュー名に含まれる言葉。上から順に当てはめ、どれにも当たらなければ「その他」）
const CATEGORY: [string, RegExp][] = [
  ['カラー', /カラー/],
  ['パーマ', /パーマ/],
  ['トリートメント', /トリートメント/],
  ['ネイル', /ネイル/],
  ['スパ・ケア', /スパ|ケア/],
  ['カット', /カット/],
];

const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const dt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const live = (status: string) => !status.startsWith('cancelled');

function signed(n: number) {
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;
}

function Tile({ icon: Glyph, label, value, unit, sub, diff }: { icon: PhosphorIcon; label: string; value: number; unit: string; sub: string; diff?: number | null }) {
  return (
    <div className={s.tile}>
      <span className={s.tileIcon}>
        <Glyph size={24} aria-hidden focusable="false" />
      </span>
      <span className={s.tileBody}>
        <span className={s.tileLabel}>{label}</span>
        <span className={`${s.tileValue} num`}>
          {value}
          <small>{unit}</small>
        </span>
        <span className={s.tileSub}>
          {diff !== undefined && diff !== null ? (
            <>
              前日比 <span className={`num ${diff > 0 ? s.up : diff < 0 ? s.down : ''}`}>{signed(diff)}{unit}</span>
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

export default function AdminHome({ client, onOpen }: { client: SupabaseClient; onOpen: (tab: AdminTab) => void }) {
  const [data, setData] = useState<{
    salons: Salon[];
    apps: App[];
    slots: SlotRow[];
    failed: Note[];
    stuck: number;
    audit: Audit[];
    inquiries: Inquiry[] | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const todayStart = jstTodayStart();
    const from = new Date(todayStart.getTime() - 29 * 86_400_000);
    const to = new Date(todayStart.getTime() + 86_400_000);
    const [sl, ap, sv, fl, st, au, iq] = await Promise.all([
      client.from('salons').select('id,name,is_approved,created_at'),
      client.from('salon_applications').select('id,salon_name,area_text,status,created_at').order('created_at', { ascending: false }).limit(30),
      client
        .from('slots')
        .select('id,start_at,salons(name),menus(name),bookings(id,status,created_at)')
        .gte('start_at', from.toISOString())
        .lt('start_at', to.toISOString()),
      client
        .from('notification_outbox')
        .select('id,kind,status,created_at,recipient,last_error')
        .eq('status', 'failed')
        .gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
        .order('created_at', { ascending: false })
        .limit(10),
      client
        .from('notification_outbox')
        .select('id', { count: 'exact' })
        .in('status', ['pending', 'sending'])
        .lt('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
        .limit(1),
      client.from('audit_logs').select('id,action,target_id,at').order('id', { ascending: false }).limit(12),
      // 問い合わせ（0022）を流していないデータベースでは読めないので、出さない
      client.from('inquiries').select('id,no,subject,from_role,status,created_at').neq('status', 'resolved').order('created_at', { ascending: false }).limit(20),
    ]);
    const err = sl.error ?? ap.error ?? sv.error ?? fl.error ?? au.error;
    if (err) {
      setError(toMessage(err));
      return;
    }
    setError(null);
    setData({
      salons: (sl.data ?? []) as Salon[],
      apps: (ap.data ?? []) as App[],
      slots: (sv.data ?? []) as unknown as SlotRow[],
      failed: (fl.data ?? []) as Note[],
      stuck: st.count ?? 0,
      audit: (au.data ?? []) as Audit[],
      inquiries: iq.error ? null : ((iq.data ?? []) as Inquiry[]),
    });
  }, [client]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <ErrorState onRetry={load}>{error}</ErrorState>;
  if (!data) return <Loading rows={4} />;

  const now = new Date();
  const todayStart = jstTodayStart(now);
  const todayKey = jstDateKey(now);
  const yesterdayKey = jstDateKey(new Date(todayStart.getTime() - 3_600_000));
  const dayOf = (iso: string) => jstDateKey(new Date(iso));

  // 予約（キャンセル以外）を、枠の日ごとに数える
  const booked = data.slots.flatMap((sl) => (sl.bookings ?? []).filter((b) => live(b.status)).map((b) => ({ slot: sl, b })));
  const perDay = new Map<string, number>();
  for (const x of booked) perDay.set(dayOf(x.slot.start_at), (perDay.get(dayOf(x.slot.start_at)) ?? 0) + 1);
  const listed = data.salons.filter((x) => x.is_approved);
  const pending = data.apps.filter((a) => a.status === 'pending');
  const appsToday = pending.filter((a) => a.created_at >= todayStart.toISOString()).length;
  const unrecorded = data.slots.filter(
    (sl) =>
      dayOf(sl.start_at) === todayKey &&
      (sl.bookings ?? []).some((b) => b.status === 'confirmed') &&
      new Date(sl.start_at).getTime() + UI_OPTIONS.overdueMinutes * 60_000 < now.getTime(),
  );
  const openInquiries = data.inquiries?.filter((q) => q.status === 'open') ?? [];
  const actionCount = pending.length + data.failed.length + (data.stuck > 0 ? 1 : 0) + unrecorded.length + openInquiries.length;

  // 予約数の推移（直近8日）と、その日の終わりに掲載していた店舗の数（掲載を止めた日までは分からないため、今掲載中のお店の掲載開始の日で数える）
  const days = Array.from({ length: 8 }, (_, i) => new Date(todayStart.getTime() - (7 - i) * 86_400_000));
  const trend = days.map((d) => {
    const key = jstDateKey(d);
    const jst = new Date(d.getTime() + 9 * 3_600_000);
    const end = new Date(d.getTime() + 86_400_000).toISOString();
    return {
      // 目盛りの文字が重ならないよう、日と曜日だけ（月は表題の「直近8日」と、表で分かる）
      label: `${jst.getUTCDate()}(${DOW[jst.getUTCDay()]})`,
      values: { bookings: perDay.get(key) ?? 0, salons: listed.filter((x) => x.created_at < end).length },
    };
  });

  // 人気のメニューの種類（直近30日の予約）
  const cats = new Map<string, number>();
  for (const x of booked) {
    const name = one(x.slot.menus)?.name ?? '';
    const cat = CATEGORY.find(([, re]) => re.test(name))?.[0] ?? 'その他';
    cats.set(cat, (cats.get(cat) ?? 0) + 1);
  }
  const catRows = [...cats.entries()].sort((a, b) => b[1] - a[1]);
  const catTotal = Math.max(1, booked.length);

  // 要対応（新しい順に、種類をまぜて最大5件）
  type Todo = { key: string; icon: PhosphorIcon; title: string; sub: string; at: string; action: string; tab: AdminTab; kind: LabelKind };
  const todos: Todo[] = [
    ...pending.map((a) => ({ key: `ap-${a.id}`, icon: Storefront, title: '掲載希望の承認待ち', sub: a.salon_name, at: a.created_at, action: '確認する', tab: 'applications' as AdminTab, kind: 'action' as LabelKind })),
    ...openInquiries.map((q) => ({ key: `iq-${q.id}`, icon: ChatCircle, title: q.from_role === 'salon' ? 'サロンからの問い合わせ' : 'お客様からの問い合わせ', sub: `受付番号 Q-${q.no}・${q.subject}`, at: q.created_at, action: '対応する', tab: 'inquiries' as AdminTab, kind: 'action' as LabelKind })),
    ...data.failed.map((n) => ({ key: `nt-${n.id}`, icon: WarningCircle, title: '通知の送信に失敗', sub: n.last_error ? n.last_error.slice(0, 40) : (n.recipient ?? ''), at: n.created_at, action: '詳細を確認', tab: 'logs' as AdminTab, kind: 'danger' as LabelKind })),
    ...unrecorded.map((sl) => ({ key: `ur-${sl.id}`, icon: HourglassMedium, title: '来店の記録がまだ', sub: one(sl.salons)?.name ?? '', at: sl.start_at, action: '確認する', tab: 'overview' as AdminTab, kind: 'time' as LabelKind })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);
  if (data.stuck > 0) todos.unshift({ key: 'stuck', icon: Clock, title: '送信待ちの通知が滞っています', sub: `10分以上前からの送信待ち ${data.stuck}件`, at: new Date().toISOString(), action: '詳細を確認', tab: 'logs', kind: 'danger' });

  // 最近の運営の動き（掲載希望・操作の記録・送れなかった通知を、新しい順に）
  type Act = { key: string; at: string; kind: string; text: string; ref: string; status: string; tone: LabelKind; tab?: AdminTab; action?: string };
  const APP_STATUS: Record<string, [string, LabelKind]> = { pending: ['確認待ち', 'time'], approved: ['承認済み', 'success'], rejected: ['見送り', 'state'] };
  const acts: Act[] = [
    ...data.apps.slice(0, 8).map((a) => ({
      key: `ap-${a.id}`,
      at: a.created_at,
      kind: '店舗登録',
      text: `掲載の申し込み（${a.salon_name}）`,
      ref: `AP-${a.id.slice(0, 6).toUpperCase()}`,
      status: APP_STATUS[a.status]?.[0] ?? a.status,
      tone: APP_STATUS[a.status]?.[1] ?? 'state',
      ...(a.status === 'pending' ? { tab: 'applications' as AdminTab, action: '確認' } : {}),
    })),
    ...data.audit.map((l) => ({
      key: `lg-${l.id}`,
      at: l.at,
      kind: /booking/.test(l.action) ? '予約' : /slot|today/.test(l.action) ? '枠' : /salon|menu|stylist|application/.test(l.action) ? '店舗管理' : '運営',
      text: ACTION_LABEL[l.action] ?? l.action,
      ref: `LG-${l.id}`,
      status: '記録済み',
      tone: 'state' as LabelKind,
    })),
    ...data.failed.map((n) => ({
      key: `nt-${n.id}`,
      at: n.created_at,
      kind: 'システム',
      text: '通知の送信に失敗',
      ref: `NT-${n.id}`,
      status: '要確認',
      tone: 'danger' as LabelKind,
      tab: 'logs' as AdminTab,
      action: '詳細',
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);

  return (
    <div className={s.home}>
      <section className={s.tiles} aria-label="今の数字">
        <Tile icon={Storefront} label="掲載中の店舗" value={listed.length} unit="店" sub="掲載中のお店の数" diff={listed.filter((x) => x.created_at >= todayStart.toISOString()).length} />
        <Tile
          icon={CalendarCheck}
          label="本日の予約"
          value={perDay.get(todayKey) ?? 0}
          unit="件"
          sub="今日の枠の予約（キャンセルを除く）"
          diff={(perDay.get(todayKey) ?? 0) - (perDay.get(yesterdayKey) ?? 0)}
        />
        <Tile icon={ClipboardText} label="承認待ちの店舗" value={pending.length} unit="件" sub={`今日届いた申し込み ${appsToday}件`} />
        <Tile icon={WarningCircle} label="対応が必要な案件" value={actionCount} unit="件" sub="下の「要対応」の合計" />
      </section>

      <div className={s.row}>
        <Panel className={s.trend}>
          <ColumnChart
            title="予約数の推移（直近8日）"
            labelHeader="日付"
            height={220}
            rows={trend}
            series={[{ key: 'bookings', name: '予約数', tone: 'primary' }]}
            line={{ key: 'salons', name: '掲載中の店舗数', tone: 'secondary' }}
            footnote="予約数は、その日の枠の予約（キャンセルを除く）。店舗数は、今掲載中のお店を、掲載を始めた日から数えています。"
          />
        </Panel>
        <Panel className={s.cats}>
          <SectionHead icon={ListBullets} title="人気のメニューの種類" as="h2" />
          {catRows.length === 0 ? (
            <p className={s.none}>直近30日の予約はありません。</p>
          ) : (
            <ul className={s.catList}>
              {catRows.map(([name, n]) => (
                <li key={name} title={`${name}：${n}件`}>
                  <span className={s.catName}>{name}</span>
                  <span className={s.catTrack}>
                    <span className={s.catBar} style={{ inlineSize: `${(n / catTotal) * 100}%` }} />
                  </span>
                  <span className={`${s.catValue} num`}>{Math.round((n / catTotal) * 100)}%</span>
                </li>
              ))}
            </ul>
          )}
          <p className={s.none}>直近30日の予約 {booked.length}件の内訳（メニュー名から分類）</p>
        </Panel>
        <Panel className={s.todo}>
          <SectionHead
            icon={Bell}
            title="要対応"
            as="h2"
            aside={
              <button type="button" className={s.more} onClick={() => onOpen(pending.length > 0 ? 'applications' : 'logs')}>
                すべて見る
                <CaretRight size={20} aria-hidden focusable="false" />
              </button>
            }
          />
          {todos.length === 0 ? (
            <p className={s.none}>今、対応が必要なものはありません。</p>
          ) : (
            <ul className={s.todoList}>
              {todos.map((t) => (
                <li key={t.key}>
                  <button type="button" className={s.todoItem} onClick={() => onOpen(t.tab)}>
                    <span className={s.todoIcon}>
                      <t.icon size={20} aria-hidden focusable="false" />
                    </span>
                    <span className={s.todoBody}>
                      <strong>{t.title}</strong>
                      <span>{t.sub}</span>
                      <small className="num">{dt.format(new Date(t.at))}</small>
                    </span>
                    <Label kind={t.kind}>{t.action}</Label>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className={s.row2}>
        <Panel className={s.acts}>
          <SectionHead
            icon={ChartBar}
            title="最近の運営の動き"
            as="h2"
            aside={
              <button type="button" className={s.more} onClick={() => onOpen('logs')}>
                すべて見る
                <CaretRight size={20} aria-hidden focusable="false" />
              </button>
            }
          />
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>種別</th>
                  <th>内容</th>
                  <th>参照ID</th>
                  <th>ステータス</th>
                  <th>対応</th>
                </tr>
              </thead>
              <tbody>
                {acts.map((a) => (
                  <tr key={a.key}>
                    <td className="num">{dt.format(new Date(a.at))}</td>
                    <td>{a.kind}</td>
                    <td>{a.text}</td>
                    <td className="num">{a.ref}</td>
                    <td>
                      <Label kind={a.tone}>{a.status}</Label>
                    </td>
                    <td>
                      {a.tab ? (
                        <Button variant="secondary" size="sm" onClick={() => onOpen(a.tab!)}>
                          {a.action}
                        </Button>
                      ) : (
                        <span aria-label="なし">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel className={s.system}>
          <SectionHead icon={ShieldCheck} title="システム状況" as="h2" />
          <SystemStatus client={client} compact />
          <button type="button" className={s.more} onClick={() => onOpen('system')}>
            詳しく見る
            <CaretRight size={20} aria-hidden focusable="false" />
          </button>
        </Panel>
      </div>
    </div>
  );
}
