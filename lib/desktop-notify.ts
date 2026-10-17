// パソコンに出す通知（ブラウザの通知。Windows・macOS の通知センターに出る）：登録した本人と、/usage を開いている運営
//   ・許可を求めるのは、登録のボタンを押したとき（ブラウザは、押す操作の中でしか許可を求められない）
//   ・許可されなかった・通知に対応していない端末では、何もしない（画面の表示はそのまま）
//   使う場所：お客様・サロンの新規登録の送信（仮登録・申し込みの受付）と、確認のリンクを開いて登録が完了したとき
//             /usage（運営のパソコンに、新規登録があったことを通知する。許可は「パソコンへの通知をオンにする」で求める）

export function canNotify(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

// 登録のボタンを押したときに呼ぶ（まだ決めていない人にだけ、ブラウザが「通知を許可しますか」と聞く）
export function askNotifyPermission(): void {
  if (!canNotify() || Notification.permission !== 'default') return;
  try {
    Notification.requestPermission().catch(() => null);
  } catch {
    // 古いブラウザ（Promise を返さない版）でも止まらないように
  }
}

export type NotifyState = 'granted' | 'denied' | 'default' | 'unsupported';

export function notifyState(): NotifyState {
  return canNotify() ? Notification.permission : 'unsupported';
}

// ボタンを押したときに許可を求め、その結果を返す
export async function requestNotify(): Promise<NotifyState> {
  if (!canNotify()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

// 許可されていれば、パソコンに通知を出す。tag が同じ通知は、新しいもので置き換わる
export function notifyDesktop(title: string, body: string, tag: string): void {
  if (!canNotify() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag, icon: '/icon.svg', lang: 'ja' });
    // 通知を押したら、この画面を前に出す
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // スマートフォンの一部のブラウザは、この形の通知を出せない（画面の表示だけにする）
  }
}
