'use client';

// 実証の数字：期間を指定して、DB の関数 admin_metrics で集計した数字だけを表示する（画面に固定の数字は置かない）

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ErrorState, Loading } from '@/components/States';
import { toMessage } from '@/lib/errors';
import { downloadCsv } from '@/lib/csv';
import { AGE_GROUPS, label } from '@/lib/profile-options';
import { BarList, ColumnChart, SERIES_COLORS } from './Charts';

type Metrics = {
  from: string;
  to: string;
  published_slots: number;
  bookings: number;
  booked_slots: number;
  completed: number;
  no_show: number;
  cancelled: number;
  conversion_rate: number | null;
  visit_rate: number | null;
  avg_minutes_to_booking: number | null;
  continuing: { min_days: number; window_from: string; window_to: string; salons: number; approved_salons: number; rate: number | null };
  daily: { date: string; published: number; bookings: number; completed: number }[];
  by_hour: { hour: number; bookings: number }[];
  by_salon: { salon_id: string; salon_name: string; published: number; bookings: number; completed: number; no_show: number }[];
  by_age_group: { label: string; bookings: number }[];
  by_occupation: { label: string; bookings: number }[];
  survey: { question_id: string; question: string; responses: number; answers: { answer: string; count: number }[] }[];
};

function jstDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 1000) / 10}%`);
const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const ageLabel = (v: string) => (v === 'unknown' ? '不明' : label(AGE_GROUPS, v) || v);
const jobLabel = (v: string) => (v === 'unknown' ? '不明' : v);

export default function Dashboard({ client, demoMode }: { client: SupabaseClient; demoMode: boolean }) {
  const [from, setFrom] = useState(() => jstDate(-6));
  const [to, setTo] = useState(() => jstDate(0));
  const [minDays, setMinDays] = useState(3);
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [pulse, setPulse] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: e } = await client.rpc('admin_metrics', { p_from: from, p_to: to, p_min_days: minDays });
    if (e) {
      setError(toMessage(e));
      return;
    }
    setM(data as Metrics);
    setUpdatedAt(new Date());
  }, [client, from, to, minDays]);

  useEffect(() => {
    load();
  }, [load]);

  // 予約や枠が変わったら、少し待ってから数字を読み直す（リアルタイム更新）
  useEffect(() => {
    const channel = client
      .channel('admin-metrics')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => schedule())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, () => schedule())
      .subscribe();
    function schedule() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        await load();
        setPulse(true);
        setTimeout(() => setPulse(false), 2400);
      }, 1200);
    }
    return () => {
      client.removeChannel(channel);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [client, load]);

  function exportCsv() {
    if (!m) return;
    const rows: (string | number | null)[][] = [
      ['区分', '項目', '値'],
      ['期間', '開始', m.from],
      ['期間', '終了', m.to],
      ['全体', '公開された枠の数', m.published_slots],
      ['全体', '予約数', m.bookings],
      ['全体', '予約された枠の数', m.booked_slots],
      ['全体', '成約率', m.conversion_rate],
      ['全体', '来店済み', m.completed],
      ['全体', '無断キャンセル数', m.no_show],
      ['全体', 'キャンセル数', m.cancelled],
      ['全体', '来店率', m.visit_rate],
      ['全体', '枠の公開から予約までの平均（分）', m.avg_minutes_to_booking],
      ['継続', `直近7日で${m.continuing.min_days}日以上枠を出したサロン`, m.continuing.salons],
      ['継続', '承認済みサロン', m.continuing.approved_salons],
      ['継続', '割合', m.continuing.rate],
      ...m.daily.flatMap((d) => [
        ['日別', `${d.date} 公開された枠`, d.published],
        ['日別', `${d.date} 予約`, d.bookings],
        ['日別', `${d.date} 来店`, d.completed],
      ]),
      ...m.by_hour.map((h) => ['時間帯別（予約）', `${h.hour}時台`, h.bookings]),
      ...m.by_salon.flatMap((s) => [
        ['サロン別', `${s.salon_name} 公開された枠`, s.published],
        ['サロン別', `${s.salon_name} 予約`, s.bookings],
        ['サロン別', `${s.salon_name} 来店`, s.completed],
        ['サロン別', `${s.salon_name} 無断キャンセル`, s.no_show],
      ]),
      ...m.by_age_group.map((a) => ['年代別（予約）', ageLabel(a.label), a.bookings]),
      ...m.by_occupation.map((o) => ['職業別（予約）', jobLabel(o.label), o.bookings]),
      ...m.survey.flatMap((q) => [
        ['アンケート', `${q.question}（回答数）`, q.responses],
        ...q.answers.map((a) => ['アンケート', `${q.question}：${a.answer}`, a.count]),
      ]),
    ];
    downloadCsv(`実証の数字_${m.from}_${m.to}.csv`, rows);
  }

  return (
    <div className="stack">
      {demoMode && <p className="notice notice-info">デモ用の架空データを含みます（「デモをリセット」で作り直せます）。</p>}

      <section className="card filter-row" aria-label="期間">
        <label>
          <span className="field-label">開始</span>
          <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span className="field-label">終了</span>
          <input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          <span className="field-label">継続の基準（直近7日で）</span>
          <select className="select" value={minDays} onChange={(e) => setMinDays(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <option key={d} value={d}>
                {d}日以上
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-secondary" disabled={!m} onClick={exportCsv}>
          CSV で書き出す
        </button>
      </section>
      <p className="fine-print" style={{ marginTop: 0 }}>
        枠の開始日で数えています。{updatedAt && `最終更新 ${updatedAt.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' })}（予約や枠が変わると自動で更新）`}
        「継続の基準」の日数は仮の値です。
      </p>

      {error && <ErrorState onRetry={load}>{error}</ErrorState>}
      {!m && !error && <Loading rows={4} />}

      {m && (
        <>
          <section className={`kpi-grid ${pulse ? 'is-fresh' : ''}`}>
            <Kpi label="公開された枠" value={m.published_slots} />
            <Kpi label="予約数" value={m.bookings} />
            <Kpi label="成約率" value={pct(m.conversion_rate)} sub={`予約された枠 ${m.booked_slots} ÷ 公開 ${m.published_slots}`} />
            <Kpi label="来店率" value={pct(m.visit_rate)} sub={`来店 ${m.completed} ÷（来店＋無断 ${m.no_show}）`} />
            <Kpi label="無断キャンセル" value={m.no_show} />
            <Kpi label="公開から予約まで" value={m.avg_minutes_to_booking === null ? '—' : `${m.avg_minutes_to_booking}分`} sub="平均" />
            <Kpi
              label="継続して枠を出すサロン"
              value={pct(m.continuing.rate)}
              sub={`${m.continuing.salons} ÷ 承認済み ${m.continuing.approved_salons}（${shortDate(m.continuing.window_from)}〜${shortDate(m.continuing.window_to)}に${m.continuing.min_days}日以上）`}
            />
          </section>

          <section className="card">
            <ColumnChart
              title="日別の公開された枠と予約"
              labelHeader="日付"
              series={[
                { key: 'published', name: '公開された枠', color: SERIES_COLORS.secondary },
                { key: 'bookings', name: '予約', color: SERIES_COLORS.primary },
              ]}
              rows={m.daily.map((d) => ({ label: shortDate(d.date), values: { published: d.published, bookings: d.bookings } }))}
            />
          </section>

          <section className="card">
            <ColumnChart
              title="時間帯別の予約数（枠の開始時刻）"
              labelHeader="時間帯"
              series={[{ key: 'bookings', name: '予約', color: SERIES_COLORS.primary }]}
              rows={Array.from({ length: 15 }, (_, i) => i + 9).map((h) => ({
                label: `${h}時`,
                values: { bookings: m.by_hour.find((x) => x.hour === h)?.bookings ?? 0 },
              }))}
            />
          </section>

          <div className="two-col">
            <section className="card">
              <BarList
                title="サロン別の予約数"
                rows={m.by_salon.map((s) => ({
                  label: s.salon_name,
                  value: s.bookings,
                  sub: `公開 ${s.published} ・ 来店 ${s.completed} ・ 無断 ${s.no_show}`,
                }))}
              />
            </section>
            <section className="card">
              <BarList title="年代別の予約数" rows={m.by_age_group.map((a) => ({ label: ageLabel(a.label), value: a.bookings }))} />
            </section>
            <section className="card">
              <BarList title="職業別の予約数" rows={m.by_occupation.map((o) => ({ label: jobLabel(o.label), value: o.bookings }))} />
            </section>
            {m.survey.map((q) => (
              <section className="card" key={q.question_id}>
                <BarList
                  title={`アンケート：${q.question}（回答 ${q.responses}件）`}
                  rows={q.answers.map((a) => ({ label: a.answer, value: a.count }))}
                />
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label: name, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{name}</span>
      <span className="kpi-num num">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}
