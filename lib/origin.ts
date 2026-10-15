'use client';

import type { LatLng } from './geo';

// 距離の基準地点（現在地または利用エリアの基準地点）を、この端末のこのタブの中だけに覚えておく。
// 予約確定画面の「歩いて約○分」に使う。サーバーには送らない
export type Origin = LatLng & { label: string };
const KEY = 'demo-origin';

export function saveOrigin(o: Origin) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    // 保存できなくても動く
  }
}

export function loadOrigin(): Origin | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Origin) : null;
  } catch {
    return null;
  }
}
