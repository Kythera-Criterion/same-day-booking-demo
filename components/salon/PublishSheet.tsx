'use client';

// 枠を出す：メニュー → 「○分後」の時刻（複数可）→ 担当（任意）→ 公開。片手で30秒以内に出せることを目指す

import { useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toMessage } from '@/lib/errors';
import { fmtTime, fmtYen, slotStartProblem, startAfter } from '@/lib/time';
import type { Menu, Preset, Stylist } from './useSalonData';

export const OFFSETS = [15, 30, 45, 60, 90, 120, 180];

export type PublishResult = { ok: string[]; ng: string[] };

// 「○分後」の枠をまとめて出す（1件ずつ関数で作り、出せなかったものは理由を返す）
export async function publishSlots(
  client: SupabaseClient,
  menu: Menu,
  stylistId: string | null,
  offsets: number[],
  now = new Date(),
): Promise<PublishResult> {
  const result: PublishResult = { ok: [], ng: [] };
  for (const off of [...offsets].sort((a, b) => a - b)) {
    const start = startAfter(off, now);
    const problem = slotStartProblem(start, menu.booking_deadline_min, now);
    if (problem) {
      result.ng.push(`${fmtTime(start)}（${problem}）`);
      continue;
    }
    const { error } = await client.rpc('create_slot', {
      p_menu_id: menu.id,
      p_start_at: start.toISOString(),
      p_stylist_id: stylistId,
    });
    if (error) result.ng.push(`${fmtTime(start)}（${toMessage(error)}）`);
    else result.ok.push(fmtTime(start));
  }
  return result;
}

export default function PublishSheet({
  client,
  salonId,
  menus,
  stylists,
  presets,
  now,
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
  onPublished: (r: PublishResult) => void;
  onPresetsChanged: () => void;
  onClose: () => void;
}) {
  const active = menus.filter((m) => m.is_active);
  const [menuId, setMenuId] = useState<string | null>(active[0]?.id ?? null);
  const [offsets, setOffsets] = useState<number[]>([]);
  const [stylistId, setStylistId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const menu = active.find((m) => m.id === menuId) ?? null;

  const options = useMemo(
    () =>
      OFFSETS.map((off) => {
        const start = startAfter(off, now);
        return { off, start, problem: menu ? slotStartProblem(start, menu.booking_deadline_min, now) : null };
      }),
    [now, menu],
  );

  function toggle(off: number) {
    setOffsets((list) => (list.includes(off) ? list.filter((o) => o !== off) : [...list, off]));
  }

  async function publish() {
    if (!menu || offsets.length === 0) return;
    setBusy(true);
    setMessage(null);
    const r = await publishSlots(client, menu, stylistId, offsets, new Date());
    setBusy(false);
    onPublished(r);
    if (r.ng.length === 0) onClose();
    else setMessage(`出せなかった枠：${r.ng.join('、')}`);
  }

  async function saveAsPreset() {
    if (!menu || offsets.length === 0) return;
    const stylist = stylists.find((s) => s.id === stylistId);
    const sorted = [...offsets].sort((a, b) => a - b);
    const label = `${menu.name.replace(/（.*?）/g, '')} ${sorted.join('・')}分後${stylist ? `（${stylist.name}）` : ''}`;
    const { error } = await client.rpc('salon_save_preset', {
      p_salon_id: salonId,
      p_label: label,
      p_menu_id: menu.id,
      p_stylist_id: stylistId,
      p_offsets_min: sorted,
    });
    setMessage(error ? toMessage(error) : '「いつもの枠」に保存しました。');
    if (!error) onPresetsChanged();
  }

  async function removePreset(id: string) {
    const { error } = await client.rpc('salon_delete_preset', { p_preset_id: id });
    if (error) setMessage(toMessage(error));
    else onPresetsChanged();
  }

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

        {presets.length > 0 && (
          <div className="preset-edit">
            <p className="step-label">いつもの枠（下の画面からも1タップで出せます）</p>
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
          </div>
        )}

        <p className="step-label">
          <span className="step-no">1</span>メニュー
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

        <p className="step-label">
          <span className="step-no">2</span>開始（複数選べます）
        </p>
        <div className="offset-grid">
          {options.map((o) => (
            <button
              key={o.off}
              className={`offset ${offsets.includes(o.off) ? 'offset-on' : ''}`}
              disabled={!!o.problem}
              title={o.problem ?? undefined}
              onClick={() => toggle(o.off)}
            >
              <span className="offset-main">{o.off < 60 ? `${o.off}分後` : `${o.off / 60}時間後`}</span>
              <span className="offset-sub num">{o.problem ? o.problem : fmtTime(o.start)}</span>
            </button>
          ))}
        </div>

        {stylists.filter((s) => s.is_active).length > 0 && (
          <>
            <p className="step-label">
              <span className="step-no">3</span>担当（任意）
            </p>
            <div className="chips">
              <button className={`chip ${stylistId === null ? 'chip-on' : ''}`} onClick={() => setStylistId(null)}>
                指定しない
              </button>
              {stylists
                .filter((s) => s.is_active)
                .map((s) => (
                  <button key={s.id} className={`chip ${stylistId === s.id ? 'chip-on' : ''}`} onClick={() => setStylistId(s.id)}>
                    {s.name}
                  </button>
                ))}
            </div>
          </>
        )}

        {message && <p className="notice notice-info">{message}</p>}

        <div className="sheet-actions">
          <button className="btn btn-quiet" disabled={!menu || offsets.length === 0} onClick={saveAsPreset}>
            いつもの枠に保存
          </button>
          <button className="btn btn-primary btn-lg" disabled={!menu || offsets.length === 0 || busy} onClick={publish}>
            {busy ? '公開中…' : offsets.length > 1 ? `${offsets.length}件の枠を公開` : 'この枠を公開'}
          </button>
        </div>
        <p className="fine-print">公開した枠は、すぐに利用者の画面に表示されます。</p>
      </section>
    </div>
  );
}
