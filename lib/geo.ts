// 現在地はこの端末の中だけで使い、サーバーへは送らない
export type LatLng = { lat: number; lng: number };

// 位置情報を使わない場合の基準地点（デモ用の駅前）
export const DEFAULT_POINT: LatLng = { lat: 34.6664, lng: 133.9178 };

export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function fmtDistance(km: number): string {
  if (km < 1) return `${Math.round((km * 1000) / 10) * 10}m`;
  return `${km.toFixed(1)}km`;
}
