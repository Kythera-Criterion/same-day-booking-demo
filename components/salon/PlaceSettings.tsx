'use client';

// お店の情報と場所：店名・住所・利用エリア・位置（緯度・経度）。
// 位置は、利用者の画面の距離・徒歩の目安・距離レーダーに使う。掲載の承認時は仮の位置のため、ここで直す

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Button, { ButtonLink, buttonClass } from '@/components/ui/Button';
import { FieldRow, Input, LabeledField, Select } from '@/components/ui/Form';
import Notice from '@/components/ui/Notice';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { ArrowSquareOut, Crosshair, MapPin } from '@/components/ui/icons';
import { toMessage } from '@/lib/errors';
import type { SalonInfo } from './useSalonData';
import pl from './PlaceSettings.module.css';

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
    // エリアのないお店は、利用者の検索に出ないため必須
    if (!areaId) return setMessage({ kind: 'error', text: 'エリアを選んでください（利用者は、エリアごとにお店を探します）。' });
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
    <Panel>
      <SectionHead icon={MapPin} title="お店の情報と場所" />
      <SubText>利用者の画面の距離・徒歩の目安・「地図を開く」に使います。</SubText>
      <LabeledField label="店名">
        <Input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </LabeledField>
      <LabeledField label="住所・行き方">
        <Input maxLength={120} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="例：駅の東口から徒歩5分" />
      </LabeledField>
      <LabeledField label="利用エリア" hint="このエリアを選んだ利用者の検索に表示されます。">
        <Select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          <option value="" disabled>
            選択してください
          </option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </LabeledField>
      <FieldRow>
        <LabeledField label="緯度">
          <Input className="num" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
        </LabeledField>
        <LabeledField label="経度">
          <Input className="num" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
        </LabeledField>
      </FieldRow>
      <div className={pl.tools}>
        <Button variant="quiet" size="md" icon={Crosshair} disabled={locating} onClick={fillHere}>
          {locating ? '取得中…' : 'この端末の現在地を使う'}
        </Button>
        {mapUrl ? (
          <ButtonLink variant="quiet" size="md" icon={ArrowSquareOut} href={mapUrl} target="_blank" rel="noopener noreferrer">
            地図で確かめる
          </ButtonLink>
        ) : (
          <span className={buttonClass({ variant: 'quiet', size: 'md' })} aria-disabled>
            地図で確かめる
          </span>
        )}
      </div>
      {message && (
        <Notice tone={message.kind === 'ok' ? 'success' : message.kind === 'error' ? 'danger' : 'info'} className={pl.message}>
          {message.text}
        </Notice>
      )}
      <Button variant="outline" size="md" block disabled={busy} onClick={save}>
        {busy ? '保存中…' : 'お店の情報と場所を保存'}
      </Button>
    </Panel>
  );
}
