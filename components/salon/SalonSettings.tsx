'use client';

// 店舗の設定：メニュー（名前・所要時間・当日価格・受付締切）、美容師、受け付ける性別、電話番号、LINE の連絡用グループ
// 書き込みはすべてデータベースの関数経由

import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import NotificationLog from '@/components/NotificationLog';
import { toMessage } from '@/lib/errors';
import { fmtYen } from '@/lib/time';
import type { Menu, SalonInfo, Stylist } from './useSalonData';

type MenuDraft = { id: string | null; name: string; duration: string; price: string; deadline: string; active: boolean };

const DEADLINES = [
  { value: 10, label: '10分前' },
  { value: 30, label: '30分前' },
  { value: 60, label: '1時間前' },
  { value: 120, label: '2時間前' },
  { value: 180, label: '3時間前' },
];

export default function SalonSettings({
  client,
  salon,
  menus,
  stylists,
  lineGroup,
  onSaved,
  only,
}: {
  client: SupabaseClient;
  salon: SalonInfo;
  menus: Menu[];
  stylists: Stylist[];
  lineGroup: string | null;
  onSaved: () => void;
  only?: 'menus' | 'stylists' | 'contact';
}) {
  const [menuDraft, setMenuDraft] = useState<MenuDraft | null>(null);
  const [stylistName, setStylistName] = useState('');
  const [genders, setGenders] = useState<string[]>(salon.accepts_genders);
  const [phone, setPhone] = useState(salon.phone ?? '');
  const [group, setGroup] = useState(lineGroup ?? '');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function done(error: unknown, okText: string) {
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: toMessage(error) });
      return false;
    }
    setMessage({ kind: 'ok', text: okText });
    onSaved();
    return true;
  }

  async function saveMenu() {
    if (!menuDraft) return;
    setBusy(true);
    const { error } = await client.rpc('salon_upsert_menu', {
      p_salon_id: salon.id,
      p_id: menuDraft.id,
      p_name: menuDraft.name,
      p_duration_min: Number(menuDraft.duration),
      p_price: Number(menuDraft.price),
      p_deadline_min: Number(menuDraft.deadline),
      p_is_active: menuDraft.active,
    });
    if (done(error, 'メニューを保存しました。')) setMenuDraft(null);
  }

  async function saveStylist(id: string | null, name: string, active: boolean) {
    setBusy(true);
    const { error } = await client.rpc('salon_upsert_stylist', {
      p_salon_id: salon.id,
      p_id: id,
      p_name: name,
      p_is_active: active,
    });
    if (done(error, '美容師を保存しました。') && id === null) setStylistName('');
  }

  async function saveSettings() {
    setBusy(true);
    const { error } = await client.rpc('salon_update_settings', {
      p_salon_id: salon.id,
      p_accepts_genders: genders,
      p_phone: phone,
      p_line_group_id: group,
    });
    done(error, '店舗の設定を保存しました。');
  }

  return (
    <div className="stack">
      {message && <p className={`notice ${message.kind === 'ok' ? 'notice-ok' : 'notice-error'}`}>{message.text}</p>}

      {(!only || only === 'menus') && (
      <section className="card">
        <div className="row-between">
          <h2 className="card-title">メニュー</h2>
          <button
            className="btn btn-text btn-sm"
            onClick={() => setMenuDraft({ id: null, name: '', duration: '60', price: '', deadline: '10', active: true })}
          >
            ＋ 追加
          </button>
        </div>
        <ul className="setting-list">
          {menus.map((m) => (
            <li key={m.id} className={m.is_active ? '' : 'is-off'}>
              <span>
                <strong>{m.name}</strong>
                <small>
                  {m.duration_min}分 ・ 当日価格 {fmtYen(m.price)} ・ 開始{m.booking_deadline_min}分前に受付終了
                  {!m.is_active && ' ・ 停止中'}
                </small>
              </span>
              <button
                className="btn btn-text btn-sm"
                onClick={() =>
                  setMenuDraft({
                    id: m.id,
                    name: m.name,
                    duration: String(m.duration_min),
                    price: String(m.price),
                    deadline: String(m.booking_deadline_min),
                    active: m.is_active,
                  })
                }
              >
                編集
              </button>
            </li>
          ))}
        </ul>
        {menuDraft && (
          <div className="confirm-box">
            <label className="field">
              <span className="field-label">メニュー名</span>
              <input className="input" maxLength={60} value={menuDraft.name} onChange={(e) => setMenuDraft({ ...menuDraft, name: e.target.value })} />
            </label>
            <div className="field-row">
              <label className="field">
                <span className="field-label">所要時間（分）</span>
                <input className="input" type="number" min={10} max={300} step={5} value={menuDraft.duration} onChange={(e) => setMenuDraft({ ...menuDraft, duration: e.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">当日価格（円）</span>
                <input className="input" type="number" min={0} step={100} value={menuDraft.price} onChange={(e) => setMenuDraft({ ...menuDraft, price: e.target.value })} />
              </label>
            </div>
            <div className="field">
              <span className="field-label">受付の締切（開始の何分前まで予約を受けるか）</span>
              <div className="chips">
                {DEADLINES.map((d) => (
                  <button
                    key={d.value}
                    className={`chip ${menuDraft.deadline === String(d.value) ? 'chip-on' : ''}`}
                    onClick={() => setMenuDraft({ ...menuDraft, deadline: String(d.value) })}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={menuDraft.active} onChange={(e) => setMenuDraft({ ...menuDraft, active: e.target.checked })} />
              <span>このメニューで枠を出す</span>
            </label>
            <div className="action-pair">
              <button className="btn btn-quiet" onClick={() => setMenuDraft(null)}>
                やめる
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={saveMenu}>
                保存
              </button>
            </div>
          </div>
        )}
      </section>
      )}

      {(!only || only === 'stylists') && (
      <section className="card">
        <h2 className="card-title">美容師</h2>
        <ul className="setting-list">
          {stylists.map((s) => (
            <li key={s.id} className={s.is_active ? '' : 'is-off'}>
              <span>
                <strong>{s.name}</strong>
                {!s.is_active && <small>お休み中（枠の担当に出ません）</small>}
              </span>
              <button className="btn btn-text btn-sm" disabled={busy} onClick={() => saveStylist(s.id, s.name, !s.is_active)}>
                {s.is_active ? 'お休みにする' : '戻す'}
              </button>
            </li>
          ))}
        </ul>
        <div className="inline-form">
          <input className="input" placeholder="名前" maxLength={40} value={stylistName} onChange={(e) => setStylistName(e.target.value)} />
          <button className="btn btn-secondary" disabled={busy || !stylistName.trim()} onClick={() => saveStylist(null, stylistName, true)}>
            追加
          </button>
        </div>
      </section>
      )}

      {(!only || only === 'contact') && (
      <section className="card">
        <h2 className="card-title">受付と連絡</h2>
        <div className="field">
          <span className="field-label">受け付ける性別</span>
          <div className="chips">
            {[
              { value: 'female', label: '女性' },
              { value: 'male', label: '男性' },
            ].map((g) => (
              <button
                key={g.value}
                className={`chip ${genders.includes(g.value) ? 'chip-on' : ''}`}
                aria-pressed={genders.includes(g.value)}
                onClick={() =>
                  setGenders((list) => (list.includes(g.value) ? list.filter((x) => x !== g.value) : [...list, g.value]))
                }
              >
                {g.label}
              </button>
            ))}
          </div>
          <span className="field-hint">条件に合わない方には、枠が表示されません。お客様の性別そのものは、サロンには伝わりません。</span>
        </div>
        <label className="field">
          <span className="field-label">お店の電話番号</span>
          <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <span className="field-hint">予約確定画面の「電話する」に使います。</span>
        </label>
        <label className="field">
          <span className="field-label">LINE の連絡用グループ ID</span>
          <input className="input" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="例：C1234…（デモでは未設定のままで動きます）" />
          <span className="field-hint">予約・キャンセルを、店舗名・日時・メニュー・金額・お名前だけでお知らせします。</span>
        </label>
        <button className="btn btn-primary btn-block" disabled={busy || genders.length === 0} onClick={saveSettings}>
          設定を保存
        </button>
      </section>
      )}

      {!only && (
      <section className="card">
        <h2 className="card-title">通知ログ</h2>
        <p className="card-sub">LINE のキーがないときは「シミュレーション送信」として記録し、中身をここで確認できます。</p>
        <NotificationLog client={client} salonId={salon.id} limit={15} />
      </section>
      )}
    </div>
  );
}
