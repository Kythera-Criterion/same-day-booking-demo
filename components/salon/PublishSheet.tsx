'use client';

// 枠を出す
//   空いた時間から：「今から90分空いた」「14:00〜15:30が空いた」を選ぶと、メニューの所要時間に合わせて枠を並べた案を出す
//   時刻を選ぶ    ：「○分後」の時刻を選んで出す（以前からのやり方）
// どちらも、締切や担当の重なりは DB で判定し、作れなかった枠は理由を表示する

import { useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toMessage } from '@/lib/errors';
import { SPLIT_PROBLEM_LABEL, splitFreeTime } from '@/lib/split';
import { fmtTime, fmtYen, jstTodayEnd, slotStartProblem, startAfter } from '@/lib/time';
import type { Menu, Preset, Stylist } from './useSalonData';

export const OFFSETS = [15, 30, 45, 60, 90, 120, 180];
const FREE_LENGTHS = [30, 60, 90, 120];

export type PublishResult = { ok: string[]; ng: string[] };

const REASON: Record<string, string> = {
  overlap: '担当の時間が重なります',
  too_late: '受付の締切を過ぎます',
  outside_hours: '9時より前です',
  today_only: '今日中に収まりません',
  stylist_not_found: '担当が見つかりません',
};

// 複数の枠をまとめて作る（DB の create_slots。作れなかった枠は理由つきで返る）
export async function createMany(client: SupabaseClient, menuId: string, starts: Date[], stylistId: string | null): Promise<PublishResult> {
  if (starts.length === 0) return { ok: [], ng: [] };
  const { data, error } = await client.rpc('create_slots', {
    p_menu_id: menuId,
    p_starts: starts.map((s) => s.toISOString()),
    p_stylist_id: stylistId,
  });
  if (error) return { ok: [], ng: [toMessage(error)] };
  const r = data as { created: { start_at: string }[]; failed: { start_at: string; reason: string }[] };
  return {
    ok: r.created.map((c) => fmtTime(c.start_at)),
    ng: r.failed.map((f) => `${fmtTime(f.start_at)}（${REASON[f.reason] ?? f.reason}）`),
  };
}

// 「○分後」の枠をまとめて出す（いつもの枠）
export async function publishOffsets(client: SupabaseClient, menu: Menu, stylistId: string | null, offsets: number[], now = new Date()) {
  const starts = [...offsets].sort((a, b) => a - b).map((off) => startAfter(off, now));
  const ok = starts.filter((s) => !slotStartProblem(s, menu.booking_deadline_min, now));
  const skipped = starts.filter((s) => !ok.includes(s)).map((s) => `${fmtTime(s)}（${slotStartProblem(s, menu.booking_deadline_min, now)}）`);
  const r = await createMany(client, menu.id, ok, stylistId);
  return { ok: r.ok, ng: [...skipped, ...r.ng] };
}

// 「今からN分空いた」を枠に切り分けて出す（いつもの空き方）
export async function publishFree(client: SupabaseClient, menu: Menu, stylistId: string | null, minutes: number, now = new Date()) {
  const freeStart = startAfter(0, now);
  const plan = splitFreeTime({
    freeStart,
    freeEnd: new Date(freeStart.getTime() + minutes * 60_000),
    durationMin: menu.duration_min,
    deadlineMin: menu.booking_deadline_min,
    now,
  });
  const ok = plan.filter((p) => !p.problem).map((p) => p.start);
  const skipped = plan.filter((p) => p.problem).map((p) => `${fmtTime(p.start)}（${SPLIT_PROBLEM_LABEL[p.problem!]}）`);
  if (plan.length === 0) return { ok: [], ng: [`空き${minutes}分に${menu.name}は入りません`] };
  const r = await createMany(client, menu.id, ok, stylistId);
  return { ok: r.ok, ng: [...skipped, ...r.ng] };
}

// 今から今日の終わりまでの、15分ごとの時刻
function quarterTimes(now: Date): Date[] {
  const out: Date[] = [];
  const end = jstTodayEnd(now).getTime();
  for (let t = startAfter(0, now).getTime(); t <= end; t += 15 * 60_000) {
    const d = new Date(t);
    if (new Date(t + 9 * 3600_000).getUTCHours() >= 9) out.push(d);
  }
  return out;
}

export default function PublishSheet({
  client,
  salonId,
  menus,
  stylists,
  presets,
  now,
  initialStart,
  initialStylistId,
  onPublished,
  onPresetsChanged,
  onClose,
}: {
  client: SupabaseClient;
  salonId: string;
  menus: Menu[];
  stylists: Stylist[];
  presets: Preset[];
  now: Date;
  initialStart?: Date | null;
  initialStylistId?: string | null;
  onPublished: (r: PublishResult) => void;
  onPresetsChanged: () => void;
  onClose: () => void;
}) {
  const active = menus.filter((m) => m.is_active);
  const activeStylists = stylists.filter((s) => s.is_active);
  const [mode, setMode] = useState<'free' | 'offsets'>('free');
  const [menuId, setMenuId] = useState<string | null>(active[0]?.id ?? null);
  const [stylistId, setStylistId] = useState<string | null>(initialStylistId ?? null);
  const [length, setLength] = useState<number | 'custom'>(initialStart ? 'custom' : 90);
  const times = useMemo(() => quarterTimes(now), [now]);
  const [customStart, setCustomStart] = useState<string>(() => (initialStart ?? times[0] ?? now).toISOString());
  const [customEnd, setCustomEnd] = useState<string>(() =>
    new Date((initialStart ?? times[0] ?? now).getTime() + 60 * 60_000).toISOString(),
  );
  const [unchecked, setUnchecked] = useState<string[]>([]);
  const [offsets, setOffsets] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const menu = active.find((m) => m.id === menuId) ?? null;

  const freeStart = length === 'custom' ? new Date(customStart) : startAfter(0, now);
  const freeEnd = length === 'custom' ? new Date(customEnd) : new Date(freeStart.getTime() + length * 60_000);
  const plan = useMemo(
    () =>
      menu
        ? splitFreeTime({ freeStart, freeEnd, durationMin: menu.duration_min, deadlineMin: menu.booking_deadline_min, now })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menu, freeStart.getTime(), freeEnd.getTime(), now],
  );
  const chosen = plan.filter((p) => !p.problem && !unchecked.includes(p.start.toISOString()));

  const offsetOptions = useMemo(
    () =>
      OFFSETS.map((off) => {
        const start = startAfter(off, now);
        return { off, start, problem: menu ? slotStartProblem(start, menu.booking_deadline_min, now) : null };
      }),
    [now, menu],
  );

  async function publish() {
    if (!menu) return;
    setBusy(true);
    setMessage(null);
    const r =
      mode === 'free'
        ? await createMany(client, menu.id, chosen.map((p) => p.start), stylistId)
        : await publishOffsets(client, menu, stylistId, offsets, new Date());
    setBusy(false);
    onPublished(r);
    if (r.ng.length === 0) onClose();
    else setMessage(`${r.ok.length}件を公開しました。出せなかった枠：${r.ng.join('、')}`);
  }

  async function savePreset() {
    if (!menu) return;
    const stylist = activeStylists.find((s) => s.id === stylistId);
    const short = menu.name.replace(/（.*?）/g, '');
    let error;
    if (mode === 'free') {
      const minutes = Math.round((freeEnd.getTime() - freeStart.getTime()) / 60_000);
      ({ error } = await client.rpc('salon_save_free_preset', {
        p_salon_id: salonId,
        p_label: `空き${minutes}分・${short}${stylist ? `（${stylist.name}）` : ''}`,
        p_menu_id: menu.id,
        p_stylist_id: stylistId,
        p_free_minutes: minutes,
      }));
    } else {
      const sorted = [...offsets].sort((a, b) => a - b);
      ({ error } = await client.rpc('salon_save_preset', {
        p_salon_id: salonId,
        p_label: `${short} ${sorted.join('・')}分後${stylist ? `（${stylist.name}）` : ''}`,
        p_menu_id: menu.id,
        p_stylist_id: stylistId,
        p_offsets_min: sorted,
      }));
    }
    setMessage(error ? toMessage(error) : mode === 'free' ? '「いつもの空き方」に保存しました。' : '「いつもの枠」に保存しました。');
    if (!error) onPresetsChanged();
  }

  async function removePreset(id: string) {
    const { error } = await client.rpc('salon_delete_preset', { p_preset_id: id });
    if (error) setMessage(toMessage(error));
    else onPresetsChanged();
  }

  const canPublish = !!menu && (mode === 'free' ? chosen.length > 0 : offsets.length > 0);
  const count = mode === 'free' ? chosen.length : offsets.length;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-label="枠を出す" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden />
        <div className="row-between">
          <h2 className="card-title">今日の空き枠を出す</h2>
          <button className="btn btn-text" onClick={onClose}>
            閉じる
          </button>
        </div>

        <div className="segmented" role="group" aria-label="出し方">
          <button aria-pressed={mode === 'free'} onClick={() => setMode('free')}>
            空いた時間から
          </button>
          <button aria-pressed={mode === 'offsets'} onClick={() => setMode('offsets')}>
            時刻を選ぶ
          </button>
        </div>

        {mode === 'free' && (
          <>
            <p className="step-label">
              <span className="step-no">1</span>空いた時間
            </p>
            <div className="chips">
              {FREE_LENGTHS.map((m) => (
                <button key={m} className={`chip ${length === m ? 'chip-on' : ''}`} onClick={() => setLength(m)}>
                  今から{m}分
                </button>
              ))}
              <button className={`chip ${length === 'custom' ? 'chip-on' : ''}`} onClick={() => setLength('custom')}>
                時刻を指定
              </button>
            </div>
            {length === 'custom' && (
              <div className="field-row" style={{ marginTop: 10 }}>
                <label className="field">
                  <span className="field-label">から</span>
                  <select className="select" value={customStart} onChange={(e) => setCustomStart(e.target.value)}>
                    {(initialStart && !times.some((t) => t.getTime() === initialStart.getTime()) ? [initialStart, ...times] : times).map((t) => (
                      <option key={t.toISOString()} value={t.toISOString()}>
                        {fmtTime(t)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">まで</span>
                  <select className="select" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}>
                    {times
                      .filter((t) => t.getTime() > new Date(customStart).getTime())
                      .concat([jstTodayEnd(now)])
                      .map((t) => (
                        <option key={t.toISOString()} value={t.toISOString()}>
                          {fmtTime(t) === '00:00' ? '24:00' : fmtTime(t)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            )}
          </>
        )}

        <p className="step-label">
          <span className="step-no">{mode === 'free' ? 2 : 1}</span>メニュー
        </p>
        <div className="chips">
          {active.map((m) => (
            <button key={m.id} className={`chip ${menuId === m.id ? 'chip-on' : ''}`} onClick={() => setMenuId(m.id)}>
              {m.name}
              <small>
                {m.duration_min}分・{fmtYen(m.price)}・{m.booking_deadline_min >= 60 ? `${m.booking_deadline_min / 60}時間` : `${m.booking_deadline_min}分`}前締切
              </small>
            </button>
          ))}
        </div>

        {activeStylists.length > 0 && (
          <>
            <p className="step-label">
              <span className="step-no">{mode === 'free' ? 3 : 2}</span>担当（任意）
            </p>
            <div className="chips">
              <button className={`chip ${stylistId === null ? 'chip-on' : ''}`} onClick={() => setStylistId(null)}>
                指定しない
              </button>
              {activeStylists.map((s) => (
                <button key={s.id} className={`chip ${stylistId === s.id ? 'chip-on' : ''}`} onClick={() => setStylistId(s.id)}>
                  {s.name}
                </button>
              ))}
            </div>
          </>
        )}

        {mode === 'free' ? (
          <>
            <p className="step-label">
              <span className="step-no">{activeStylists.length > 0 ? 4 : 3}</span>切り分けた案（{fmtTime(freeStart)}〜{fmtTime(freeEnd) === '00:00' ? '24:00' : fmtTime(freeEnd)}）
            </p>
            {plan.length === 0 ? (
              <p className="notice notice-info">この空き時間には、{menu?.name ?? 'メニュー'}（{menu?.duration_min}分）が入りません。</p>
            ) : (
              <ul className="plan">
                {plan.map((p) => {
                  const key = p.start.toISOString();
                  const on = !p.problem && !unchecked.includes(key);
                  return (
                    <li key={key} className={p.problem ? 'is-off' : ''}>
                      <label className="plan-row">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!!p.problem}
                          onChange={() => setUnchecked((u) => (u.includes(key) ? u.filter((x) => x !== key) : [...u, key]))}
                        />
                        <span className="plan-time num">
                          {fmtTime(p.start)}〜{fmtTime(p.end)}
                        </span>
                        <span className="plan-note">{p.problem ? SPLIT_PROBLEM_LABEL[p.problem] : `受付は${fmtTime(new Date(p.start.getTime() - (menu?.booking_deadline_min ?? 0) * 60_000))}まで`}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <>
            <p className="step-label">
              <span className="step-no">{activeStylists.length > 0 ? 3 : 2}</span>開始（複数選べます）
            </p>
            <div className="offset-grid">
              {offsetOptions.map((o) => (
                <button
                  key={o.off}
                  className={`offset ${offsets.includes(o.off) ? 'offset-on' : ''}`}
                  disabled={!!o.problem}
                  onClick={() => setOffsets((l) => (l.includes(o.off) ? l.filter((x) => x !== o.off) : [...l, o.off]))}
                >
                  <span className="offset-main">{o.off < 60 ? `${o.off}分後` : `${o.off / 60}時間後`}</span>
                  <span className="offset-sub num">{o.problem ? o.problem : fmtTime(o.start)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {presets.length > 0 && (
          <details className="preset-edit">
            <summary>保存したもの（いつもの空き方・いつもの枠）</summary>
            <ul className="preset-list">
              {presets.map((p) => (
                <li key={p.id}>
                  <span>{p.label}</span>
                  <button className="btn btn-text btn-sm" onClick={() => removePreset(p.id)}>
                    削除
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}

        {message && <p className="notice notice-info">{message}</p>}

        <div className="sheet-actions">
          <button className="btn btn-quiet" disabled={!canPublish} onClick={savePreset}>
            {mode === 'free' ? 'いつもの空き方に保存' : 'いつもの枠に保存'}
          </button>
          <button className="btn btn-primary btn-lg" disabled={!canPublish || busy} onClick={publish}>
            {busy ? '公開中…' : count > 1 ? `${count}件の枠を公開` : 'この枠を公開'}
          </button>
        </div>
        <p className="fine-print">公開した枠は、すぐに利用者の画面に表示されます。担当の時間の重なりや受付の締切は、公開するときにもう一度確かめます。</p>
      </section>
    </div>
  );
}
