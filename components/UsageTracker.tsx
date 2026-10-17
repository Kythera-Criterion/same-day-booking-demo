'use client';

// デモの利用の記録：訪問ごとの利用時間と見たページを記録する（画面には何も出さない。記録することは /legal に記載）
//   ・訪問：このタブで開いている間（sessionStorage）。30分なにもしないで戻ってきたときは、新しい訪問
//   ・利用時間：ページが前面に出ていた時間だけを数え、15秒ごとと、離れる・隠れるときに送る（sendBeacon）
//   ・ログインしていれば、そのページの役割（お客様・サロン・運営）のログインのトークンを送り、サーバーが確かめてアカウントを結びつける
//   ・記録しないもの：デモの舞台の中の画面（舞台そのものを記録する）・自動のテスト（navigator.webdriver）・記録を見るページ（/usage）
//   送り先は app/api/usage（ログインのトークンはサーバーが確かめてから、アカウントのメールアドレスを記録する）。記録の一覧は /usage

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { getClient, isConfigured, type Role } from '@/lib/supabase';

const BEAT_MS = 15_000;
const IDLE_MS = 30 * 60_000;
const ENDPOINT = '/api/usage';

type Ids = { visitor: string; visit: string };

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16),
  );
}

function deviceOf(): 'phone' | 'tablet' | 'pc' {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(ua)) return 'phone';
  return 'pc';
}

function skipped(path: string): boolean {
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  return navigator.webdriver === true || path.startsWith('/usage');
}

// この訪問の番号（無ければ作る）。保存できない環境では、このページを開いている間だけの番号
function readIds(): Ids {
  const get = (store: Storage, key: string) => {
    try {
      return store.getItem(key);
    } catch {
      return null;
    }
  };
  const set = (store: Storage, key: string, value: string) => {
    try {
      store.setItem(key, value);
    } catch {
      // 保存できなくても動く
    }
  };
  let visitor = get(localStorage, 'usage-visitor');
  if (!visitor) {
    visitor = uuid();
    set(localStorage, 'usage-visitor', visitor);
  }
  let visit = get(sessionStorage, 'usage-visit');
  const last = Number(get(sessionStorage, 'usage-last') ?? 0);
  if (!visit || Date.now() - last > IDLE_MS) {
    visit = uuid();
    set(sessionStorage, 'usage-visit', visit);
  }
  set(sessionStorage, 'usage-last', String(Date.now()));
  return { visitor, visit };
}

// ページの役割（ログインの保存先が役割ごとに分かれているため）
//   デモの舞台は、中の3つの画面がそれぞれログインするので、舞台の訪問にはアカウントを結びつけない
function roleOf(path: string): Role | null {
  if (path.startsWith('/demo')) return null;
  if (path.startsWith('/salon')) return 'salon';
  if (path.startsWith('/admin')) return 'admin';
  return 'user';
}

// そのページの役割でログインしていれば、ログインのトークン（サーバーが確かめてアカウントを結びつける）
async function tokenOf(path: string): Promise<{ token: string; role: Role } | null> {
  const role = roleOf(path);
  if (!isConfigured || !role) return null;
  try {
    const { data } = await getClient(role).auth.getSession();
    return data.session ? { token: data.session.access_token, role } : null;
  } catch {
    return null;
  }
}

function send(ids: Ids, kind: 'start' | 'beat', path: string, seconds = 0, leaving = false, account: { token: string; role: Role } | null = null) {
  const body = JSON.stringify({ visit: ids.visit, visitor: ids.visitor, kind, path, seconds, device: deviceOf(), ...(account ?? {}) });
  try {
    sessionStorage.setItem('usage-last', String(Date.now()));
  } catch {
    // 保存できなくても動く
  }
  if (leaving && navigator.sendBeacon) {
    navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }));
    return;
  }
  fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true }).catch(() => null);
}

export default function UsageTracker() {
  const path = usePathname() ?? '/';
  const ids = useRef<Ids | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  // 訪問の始まりと、時間の数え方（前面に出ている間だけ）
  useEffect(() => {
    if (skipped(window.location.pathname)) return;
    ids.current = readIds();

    let since = document.visibilityState === 'visible' ? Date.now() : null;
    const flush = (leaving: boolean) => {
      if (since === null || !ids.current) return;
      const sec = Math.round((Date.now() - since) / 1000);
      since = document.visibilityState === 'visible' && !leaving ? Date.now() : null;
      if (sec > 0) send(ids.current, 'beat', pathRef.current, sec, leaving);
    };
    const timer = setInterval(() => flush(false), BEAT_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush(true);
      else since = Date.now();
    };
    const onHide = () => flush(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      flush(true);
    };
  }, []);

  // 見たページ（画面の中での移動も数える）。ログインしていれば、そのアカウントも結びつける
  useEffect(() => {
    if (!ids.current || skipped(path)) return;
    const current = ids.current;
    tokenOf(path).then((account) => send(current, 'start', path, 0, false, account));
  }, [path]);

  // 開いている間にログイン・ログアウトしたときも、アカウントを結びつけ直す
  useEffect(() => {
    if (!isConfigured || skipped(window.location.pathname)) return;
    const subs = (['user', 'salon', 'admin'] as Role[]).map((role) =>
      getClient(role).auth.onAuthStateChange((event, session) => {
        if (event !== 'SIGNED_IN' || !session || !ids.current || roleOf(pathRef.current) !== role) return;
        send(ids.current, 'start', pathRef.current, 0, false, { token: session.access_token, role });
      }),
    );
    return () => subs.forEach(({ data }) => data.subscription.unsubscribe());
  }, []);

  return null;
}
