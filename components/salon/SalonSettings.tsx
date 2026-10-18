'use client';

// 店舗の設定：メニュー（名前・所要時間・当日価格・受付締切）、美容師、受け付ける性別、電話番号、LINE の連絡用グループ
// 書き込みはすべてデータベースの関数経由

import { useState, type ChangeEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import NotificationLog from '@/components/NotificationLog';
import Sheet from '@/components/Sheet';
import Button from '@/components/ui/Button';
import { Check, FieldRow, formClass, Input, LabeledField } from '@/components/ui/Form';
import { Pair } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { Bell, Camera, Check as CheckMark, PauseCircle, PencilSimple, Phone, Scissors, Trash, UserPlus, Users } from '@/components/ui/icons';
import PlaceSettings from './PlaceSettings';
import { StylistAvatar } from './StaffBands';
import { avatarDataUrl } from '@/lib/image';
import { toMessage } from '@/lib/errors';
import { fmtYen } from '@/lib/time';
import type { Menu, SalonInfo, Stylist } from './useSalonData';
import ss from './SalonSettings.module.css';

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
  deletable = false,
}: {
  client: SupabaseClient;
  salon: SalonInfo;
  menus: Menu[];
  stylists: Stylist[];
  lineGroup: string | null;
  onSaved: () => void;
  only?: 'menus' | 'stylists' | 'contact' | 'log';
  // 美容師・メニューを削除できるか（0021 を流したデータベースだけ）
  deletable?: boolean;
}) {
  const [menuDraft, setMenuDraft] = useState<MenuDraft | null>(null);
  const [stylistName, setStylistName] = useState('');
  const [genders, setGenders] = useState<string[]>(salon.accepts_genders);
  const [phone, setPhone] = useState(salon.phone ?? '');
  const [group, setGroup] = useState(lineGroup ?? '');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // 削除の確認（美容師・メニュー）
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'menu' | 'stylist'; id: string; name: string } | null>(null);

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

  // 担当の写真：端末で正方形の小さな画像に縮めてから保存する（外すときは null）
  async function savePhoto(id: string, photo: string | null) {
    setBusy(true);
    const { error } = await client.rpc('salon_set_stylist_photo', { p_salon_id: salon.id, p_id: id, p_photo: photo });
    done(error, photo ? '写真を保存しました。' : '写真を外しました。');
  }

  async function pickPhoto(id: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await savePhoto(id, await avatarDataUrl(file));
    } catch {
      setBusy(false);
      setMessage({ kind: 'error', text: 'この写真は読み込めませんでした。JPEG・PNG の写真を選んでください。' });
    }
  }

  // 削除：メニューは、過去の枠に使っていれば「削除済み」にして記録を残す（データベースが決める）
  async function remove() {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    setBusy(true);
    const { data, error } = await client.rpc(target.kind === 'menu' ? 'salon_delete_menu' : 'salon_delete_stylist', {
      p_salon_id: salon.id,
      p_id: target.id,
    });
    if (target.kind === 'menu' && menuDraft?.id === target.id) setMenuDraft(null);
    done(
      error,
      data === 'archived' ? `「${target.name}」を削除しました（過去の予約の記録は残ります）。` : `「${target.name}」を削除しました。`,
    );
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
    <div className={ss.stack}>
      {message && <Notice tone={message.kind === 'ok' ? 'success' : 'danger'}>{message.text}</Notice>}

      <div className={only ? ss.stack : ss.grid}>
        {(!only || only === 'contact') && (
          <div className={ss.place}>
            <PlaceSettings client={client} salon={salon} onSaved={onSaved} />
          </div>
        )}

        {(!only || only === 'menus') && (
          <Panel className={ss.side}>
            <SectionHead
              icon={Scissors}
              title="メニュー"
              aside={
                <Button
                  variant="text"
                  onClick={() => setMenuDraft({ id: null, name: '', duration: '60', price: '', deadline: '10', active: true })}
                >
                  ＋ 追加
                </Button>
              }
            />
            <ul className={ss.list} data-setting-list="">
              {menus.map((m) => (
                <li key={m.id} className={ss.item} data-off={m.is_active ? undefined : ''}>
                  <span className={ss.itemBody}>
                    <strong className={ss.itemName}>
                      {!m.is_active && <PauseCircle size={20} aria-hidden focusable="false" />}
                      {m.name}
                    </strong>
                    <small className={ss.itemSub}>
                      {m.duration_min}分 ・ 当日価格 {fmtYen(m.price)} ・ 開始{m.booking_deadline_min}分前に受付終了
                      {!m.is_active && ' ・ 停止中'}
                    </small>
                  </span>
                  <Button
                    variant="secondary"
                    icon={PencilSimple}
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
                  </Button>
                  {deletable && (
                    <Button variant="quiet" icon={Trash} disabled={busy} aria-label={`${m.name}を削除`} onClick={() => setConfirmDelete({ kind: 'menu', id: m.id, name: m.name })}>
                      削除
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {menuDraft && (
              <div className={ss.editor} data-confirm="">
                <LabeledField label="メニュー名">
                  <Input maxLength={60} value={menuDraft.name} onChange={(e) => setMenuDraft({ ...menuDraft, name: e.target.value })} />
                </LabeledField>
                <FieldRow>
                  <LabeledField label="所要時間（分）">
                    <Input
                      className="num"
                      type="number"
                      min={10}
                      max={300}
                      step={5}
                      value={menuDraft.duration}
                      onChange={(e) => setMenuDraft({ ...menuDraft, duration: e.target.value })}
                    />
                  </LabeledField>
                  <LabeledField label="当日価格（円）">
                    <Input className="num" type="number" min={0} step={100} value={menuDraft.price} onChange={(e) => setMenuDraft({ ...menuDraft, price: e.target.value })} />
                  </LabeledField>
                </FieldRow>
                <div className={formClass.field}>
                  <span className={formClass.label}>受付の締切（開始の何分前まで予約を受けるか）</span>
                  <div className={formClass.choices} role="group" aria-label="受付の締切">
                    {DEADLINES.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        className={formClass.choice}
                        aria-pressed={menuDraft.deadline === String(d.value)}
                        onClick={() => setMenuDraft({ ...menuDraft, deadline: String(d.value) })}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Check checked={menuDraft.active} onChange={(v) => setMenuDraft({ ...menuDraft, active: v })}>
                  このメニューで枠を出す
                </Check>
                <Pair className={ss.editorActions}>
                  <Button variant="quiet" size="md" onClick={() => setMenuDraft(null)}>
                    やめる
                  </Button>
                  <Button variant="outline" size="md" icon={CheckMark} disabled={busy} onClick={saveMenu}>
                    保存
                  </Button>
                </Pair>
              </div>
            )}
          </Panel>
        )}

        {(!only || only === 'stylists') && (
          <Panel className={ss.side}>
            <SectionHead icon={Users} title="美容師" />
            <ul className={ss.list} data-setting-list="">
              {stylists.map((s) => (
                <li key={s.id} className={ss.item} data-off={s.is_active ? undefined : ''}>
                  <StylistAvatar name={s.name} photo={s.photo} />
                  <span className={ss.itemBody}>
                    <strong className={ss.itemName}>
                      {!s.is_active && <PauseCircle size={20} aria-hidden focusable="false" />}
                      {s.name}
                    </strong>
                    {!s.is_active && <small className={ss.itemSub}>お休み中（枠の担当に出ません）</small>}
                    {/* 写真（0020 を流したデータベースだけ。読み込んだ担当に photo の項目があるかで見分ける） */}
                    {'photo' in s && (
                      <span className={ss.photoActions}>
                        <label className={ss.photoPick}>
                          <Camera size={20} aria-hidden focusable="false" />
                          {s.photo ? '写真を変える' : '写真を入れる'}
                          <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => pickPhoto(s.id, e)} />
                        </label>
                        {s.photo && (
                          <Button variant="text" disabled={busy} onClick={() => savePhoto(s.id, null)}>
                            写真を外す
                          </Button>
                        )}
                      </span>
                    )}
                  </span>
                  <Button variant="secondary" disabled={busy} onClick={() => saveStylist(s.id, s.name, !s.is_active)}>
                    {s.is_active ? 'お休みにする' : '戻す'}
                  </Button>
                  {deletable && (
                    <Button variant="quiet" icon={Trash} disabled={busy} aria-label={`${s.name}を削除`} onClick={() => setConfirmDelete({ kind: 'stylist', id: s.id, name: s.name })}>
                      削除
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {stylists.some((s) => 'photo' in s) && <SubText>写真は、今日の予定の担当の列に出ます。お客様の画面には出しません。</SubText>}
            <div className={ss.inlineForm}>
              <Input placeholder="名前" aria-label="美容師の名前" maxLength={40} value={stylistName} onChange={(e) => setStylistName(e.target.value)} />
              <Button variant="secondary" size="md" icon={UserPlus} disabled={busy || !stylistName.trim()} onClick={() => saveStylist(null, stylistName, true)}>
                追加
              </Button>
            </div>
          </Panel>
        )}

        {(!only || only === 'contact') && (
          <Panel className={ss.side}>
            <SectionHead icon={Phone} title="受付と連絡" />
            <div className={formClass.field}>
              <span className={formClass.label}>受け付ける性別</span>
              <div className={formClass.choices} role="group" aria-label="受け付ける性別">
                {[
                  { value: 'female', label: '女性' },
                  { value: 'male', label: '男性' },
                ].map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    className={formClass.choice}
                    aria-pressed={genders.includes(g.value)}
                    onClick={() =>
                      setGenders((list) => (list.includes(g.value) ? list.filter((x) => x !== g.value) : [...list, g.value]))
                    }
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              <span className={formClass.hint}>条件に合わない方には、枠が表示されません。お客様の性別そのものは、サロンには伝わりません。</span>
            </div>
            <LabeledField label="お店の電話番号" hint="予約確定画面の「電話する」に使います。">
              <Input className="num" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </LabeledField>
            <LabeledField label="LINE の連絡用グループ ID" hint="予約・キャンセルを、店舗名・日時・メニュー・金額・お名前だけでお知らせします。">
              <Input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="例：C1234…（デモでは未設定のままで動きます）" />
            </LabeledField>
            <Button variant="outline" size="md" block className={ss.save} disabled={busy || genders.length === 0} onClick={saveSettings}>
              設定を保存
            </Button>
          </Panel>
        )}

        {(!only || only === 'log') && (
          <Panel className={ss.full}>
            <SectionHead icon={Bell} title="通知ログ" />
            <SubText>LINE のキーがないときは「シミュレーション送信」として記録し、中身をここで確認できます。</SubText>
            <NotificationLog client={client} salonId={salon.id} limit={15} />
          </Panel>
        )}
      </div>

      {confirmDelete && (
        <Sheet label={`${confirmDelete.name}を削除しますか`} role="alertdialog" narrow onClose={() => setConfirmDelete(null)}>
          <SectionHead icon={Trash} title={`「${confirmDelete.name}」を削除しますか？`} as="p" />
          <SubText>
            {confirmDelete.kind === 'menu'
              ? '削除すると、枠を出すときに選べなくなり、このメニューのいつもの枠も消えます。過去の予約の記録は残ります。今日、このメニューの公開中の枠や予約があるあいだは削除できません。'
              : '削除すると、枠の担当に選べなくなり、いつもの枠の担当も外れます。過去の枠は「担当なし」になります。今日、この美容師の公開中の枠や予約があるあいだは削除できません。'}
            {confirmDelete.kind === 'stylist' && ' しばらく休むだけなら「お休みにする」をお使いください。'}
          </SubText>
          <Pair>
            <Button variant="quiet" size="md" onClick={() => setConfirmDelete(null)}>
              やめる
            </Button>
            <Button variant="dangerSolid" size="md" icon={Trash} onClick={remove}>
              削除する
            </Button>
          </Pair>
        </Sheet>
      )}
    </div>
  );
}
