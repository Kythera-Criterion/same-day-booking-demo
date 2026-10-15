'use client';

// お店の情報と場所：店名・住所・利用エリア・位置（緯度・経度）。
// 位置は、利用者の画面の距離・徒歩の目安・距離レーダーに使う。掲載の承認時は仮の位置のため、ここで直す

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toMessage } from '@/lib/errors';
import type { SalonInfo } from './useSalonData';

type Area = { id: string; name: string };

export default function PlaceSettings({ client, salon, onSaved }: { client: SupabaseClient; salon: SalonInfo; onSaved: () => void }) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [name, setName] = useState(salon.name);
  const [address, setAddress] = useState(salon.address);
  const [areaId, setAreaId] = useState<string>(salon.area_id ?? '');
  const [lat, setLat] = useState(String(salon.lat ?? ''));
  const [lng, setLng] = useState(String(salon.lng ?? ''));
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    client
      .from('areas')
      .select('id,name')
      .order('sort_order')
      .then(({ data }) => setAreas((data ?? []) as Area[]));
  }, [client]);

  function fillHere() {
    if (!navigator.geolocation) {
      setMessage({ kind: 'error', text: 'この端末では位置を取得できません。緯度・経度を入力してください。' });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setMessage({ kind: 'info', text: 'この端末の現在地を入れました。お店の中で取得した場合は、そのまま保存してください。' });
      },
      () => {
        setLocating(false);
        setMessage({ kind: 'error', text: '位置を取得できませんでした。緯度・経度を入力してください。' });
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function save() {
    const la = Number(lat);
    const ln = Number(lng);
    if (!name.trim() || !address.trim()) return setMessage({ kind: 'error', text: '店名と住所を入力してください。' });
    if (!Number.isFinite(la) || !Number.isFinite(ln) || la < 20 || la > 46 || ln < 122 || ln > 154) {
      return setMessage({ kind: 'error', text: '緯度・経度は、日本国内の数値で入力してください（例：緯度 34.6655、経度 133.9235）。' });
    }
    setBusy(true);
    const { error } = await client.rpc('salon_update_profile', {
      p_salon_id: salon.id,
      p_name: name,
      p_address: address,
      p_area_id: areaId || null,
      p_lat: la,
      p_lng: ln,
    });
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: toMessage(error) });
      return;
    }
    setMessage({ kind: 'ok', text: 'お店の情報と場所を保存しました。利用者の画面の距離に、すぐ反映されます。' });
    onSaved();
  }

  const mapUrl = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null;

  return (
    <section className="card">
      <h2 className="card-title">お店の情報と場所</h2>
      <p className="card-sub">利用者の画面の距離・徒歩の目安・「地図を開く」に使います。</p>
      <label className="field">
        <span className="field-label">店名</span>
        <input className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">住所・行き方</span>
        <input className="input" maxLength={120} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="例：駅の東口から徒歩5分" />
      </label>
      <label className="field">
        <span className="field-label">利用エリア</span>
        <select className="select" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          <option value="">未設定</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="field-hint">このエリアを選んだ利用者の検索に表示されます。</span>
      </label>
      <div className="field-row">
        <label className="field">
          <span className="field-label">緯度</span>
          <input className="input num" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">経度</span>
          <input className="input num" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
        </label>
      </div>
      <div className="action-pair" style={{ marginBottom: 12 }}>
        <button className="btn btn-quiet" type="button" disabled={locating} onClick={fillHere}>
          {locating ? '取得中…' : 'この端末の現在地を使う'}
        </button>
        {mapUrl ? (
          <a className="btn btn-quiet" href={mapUrl} target="_blank" rel="noopener noreferrer">
            地図で確かめる
          </a>
        ) : (
          <span className="btn btn-quiet" aria-disabled>
            地図で確かめる
          </span>
        )}
      </div>
      {message && <p className={`notice notice-${message.kind}`}>{message.text}</p>}
      <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
        {busy ? '保存中…' : 'お店の情報と場所を保存'}
      </button>
    </section>
  );
}
