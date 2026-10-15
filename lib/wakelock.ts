'use client';

// 画面が消えないようにする（Screen Wake Lock API）。対応していない端末では false を返す
type Sentinel = { release: () => Promise<void>; released: boolean };
let sentinel: Sentinel | null = null;

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export async function keepScreenOn(): Promise<boolean> {
  if (!wakeLockSupported()) return false;
  try {
    const wl = (navigator as unknown as { wakeLock: { request: (t: 'screen') => Promise<Sentinel> } }).wakeLock;
    sentinel = await wl.request('screen');
    return true;
  } catch {
    return false;
  }
}

// タブを切り替えると解除されるので、戻ってきたら取り直す
export function rekeepOnVisible(): () => void {
  const onVis = () => {
    if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) keepScreenOn();
  };
  document.addEventListener('visibilitychange', onVis);
  return () => document.removeEventListener('visibilitychange', onVis);
}
