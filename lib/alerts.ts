'use client';

// 予約が入った瞬間の知らせ：音・振動（対応端末のみ）・ブラウザ通知（許可した場合）

let audioCtx: AudioContext | null = null;

// 音は、利用者が一度画面を操作したあとでないと鳴らせない（ブラウザの制限）
export function unlockSound() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

export function chime() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const ctx = audioCtx;
    const t0 = ctx.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + i * 0.18);
      osc.stop(t0 + i * 0.18 + 0.55);
    });
  } catch {
    // 音が出せない環境では何もしない
  }
}

export function vibrate() {
  try {
    navigator.vibrate?.([180, 80, 180]);
  } catch {
    // 対応していない端末では何もしない
  }
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function askNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}

export function browserNotify(title: string, body: string) {
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      new Notification(title, { body, tag: 'new-booking' });
    }
  } catch {
    // 何もしない
  }
}
