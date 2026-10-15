'use client';

// デモ用の舞台：利用者（スマホ）・サロン（タブレット）・運営の3画面を1画面に並べる。
// ログイン状態は役割ごとに保存先を分ける仕組み（lib/supabase.ts）で、同じタブの中で別々に保つ

import { useCallback, useEffect, useRef, useState } from 'react';
import { getClient, type Role } from '@/lib/supabase';
import { demoLogin } from '@/lib/demo-login';

const LOGINS: Record<Role, string> = {
  user: 'user1@demo.test',
  salon: 'salon-a@demo.test',
  admin: 'admin@demo.test',
};

const USER_CHOICES = [
  { email: 'user1@demo.test', label: '山田 花子（女性）' },
  { email: 'user2@demo.test', label: '鈴木 一郎（男性）' },
  { email: 'user3@demo.test', label: '佐藤 美咲（女性）' },
];

type RaceResult = { no: number; name: string; ok: boolean; code: string | null; ms: number };
type Step = { key: string; label: string };

const SCENARIO: Step[] = [
  { key: 'publish', label: 'サロンが枠を出す' },
  { key: 'book', label: '利用者が予約する' },
  { key: 'notify', label: 'サロンに通知が届く' },
  { key: 'visit', label: '来店済みにする' },
  { key: 'metrics', label: '運営の数字が増える' },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post<T>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export default function DemoStage() {
  const [ready, setReady] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<Role, number>>({ user: 0, salon: 0, admin: 0 });
  const [userSrc, setUserSrc] = useState('/');
  const [userEmail, setUserEmail] = useState(LOGINS.user);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [withHistory, setWithHistory] = useState(true);
  const [race, setRace] = useState<{ state: 'idle' | 'running' | 'done'; results: RaceResult[]; confirmed?: number; time?: string } | null>(null);
  const [scenario, setScenario] = useState<{ step: number; error?: string } | null>(null);
  const scenarioRun = useRef(0);

  const reload = useCallback((...roles: Role[]) => {
    setKeys((k) => {
      const next = { ...k };
      for (const r of roles) next[r] += 1;
      return next;
    });
  }, []);

  // 3つの役割で、サーバー側のワンタップログインを済ませてから画面を並べる
  useEffect(() => {
    (async () => {
      const problems: string[] = [];
      for (const role of Object.keys(LOGINS) as Role[]) {
        const client = getClient(role);
        const { data } = await client.auth.getSession();
        if (!data.session) {
          const err = await demoLogin(client, LOGINS[role]);
          if (err) problems.push(`${LOGINS[role]}：${err}`);
        }
        // 自動更新は各画面（iframe）側に任せる（同じ更新用トークンを二重に使わないため）
        client.auth.stopAutoRefresh();
      }
      if (problems.length) setLoginError(problems.join(' / '));
      setReady(true);
    })();
  }, []);

  async function switchUser(email: string) {
    setBusy('switch');
    const client = getClient('user');
    await client.auth.signOut({ scope: 'local' });
    const err = await demoLogin(client, email);
    client.auth.stopAutoRefresh();
    setBusy(null);
    if (err) {
      setMessage(err);
      return;
    }
    setUserEmail(email);
    setUserSrc('/');
    reload('user');
  }

  async function reset() {
    setBusy('reset');
    setMessage(null);
    try {
      const r = await post<{ open_slots: number; history_slots: number; history_bookings: number }>('/api/demo/reset', {
        history: withHistory,
      });
      setMessage(
        `今日の空き枠を ${r.open_slots} 件作り直しました${withHistory ? `（過去7日分の架空データ：枠 ${r.history_slots} 件・予約 ${r.history_bookings} 件）` : ''}。`,
      );
      setUserSrc('/');
      reload('user', 'salon', 'admin');
    } catch (e) {
      setMessage(`リセットできませんでした：${(e as Error).message}`);
    }
    setBusy(null);
  }

  async function runRace() {
    setBusy('race');
    setRace({ state: 'running', results: [] });
    try {
      const r = await post<{ results: RaceResult[]; confirmedInDb: number; slot: { start_at: string } }>('/api/demo/race');
      setRace({
        state: 'done',
        results: r.results,
        confirmed: r.confirmedInDb,
        time: new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(r.slot.start_at)),
      });
      setUserSrc('/');
      reload('user');
    } catch (e) {
      setRace(null);
      setMessage(`チャレンジを実行できませんでした：${(e as Error).message}`);
    }
    setBusy(null);
  }

  async function playScenario() {
    const run = ++scenarioRun.current;
    setBusy('scenario');
    setMessage(null);
    setUserSrc('/');
    reload('user');
    try {
      setScenario({ step: 0 });
      const { slot } = await post<{ slot: { id: string } }>('/api/demo/scenario', { step: 'publish' });
      await sleep(3500);
      if (run !== scenarioRun.current) return;

      setScenario({ step: 1 });
      const { booking } = await post<{ booking: { id: string } }>('/api/demo/scenario', { step: 'book', slotId: slot.id, user: userEmail });
      setUserSrc(`/booking/${booking.id}`);
      reload('user');
      await sleep(3500);

      setScenario({ step: 2 });
      await post('/api/demo/scenario', { step: 'notify' });
      await sleep(3500);

      setScenario({ step: 3 });
      await post('/api/demo/scenario', { step: 'visit', bookingId: booking.id });
      await sleep(3000);

      setScenario({ step: 4 });
      await sleep(3500);
      setScenario(null);
    } catch (e) {
      setScenario((s) => ({ step: s?.step ?? 0, error: (e as Error).message }));
    }
    setBusy(null);
  }

  return (
    <main className="stage">
      <header className="stage-bar">
        <div className="stage-title">
          <span className="brand-mark" aria-hidden>
            今
          </span>
          <strong>デモ用の舞台</strong>
          <span className="pill pill-pending">デモ用の架空データ</span>
        </div>
        <div className="stage-controls">
          <label className="stage-select">
            <span className="sr-only">利用者</span>
            <select className="select" value={userEmail} disabled={busy !== null} onChange={(e) => switchUser(e.target.value)}>
              {USER_CHOICES.map((u) => (
                <option key={u.email} value={u.email}>
                  利用者：{u.label}
                </option>
              ))}
            </select>
          </label>
          <label className="check stage-check">
            <input type="checkbox" checked={withHistory} onChange={(e) => setWithHistory(e.target.checked)} />
            <span>過去7日分も作る</span>
          </label>
          <button className="btn btn-secondary" disabled={busy !== null} onClick={reset}>
            {busy === 'reset' ? 'リセット中…' : 'デモをリセット'}
          </button>
          <button className="btn btn-secondary" disabled={busy !== null} onClick={runRace}>
            同時予約チャレンジ
          </button>
          <button className="btn btn-primary" disabled={busy !== null} onClick={playScenario}>
            {busy === 'scenario' ? '再生中…' : 'シナリオ再生'}
          </button>
        </div>
      </header>

      {message && <p className="notice notice-info stage-message">{message}</p>}
      {loginError && <p className="notice notice-error stage-message">{loginError}</p>}

      {scenario && (
        <ol className="scenario" aria-live="polite">
          {SCENARIO.map((s, i) => (
            <li key={s.key} className={i < scenario.step ? 'is-done' : i === scenario.step ? 'is-now' : ''}>
              <span className="scenario-no">{i + 1}</span>
              {s.label}
            </li>
          ))}
          {scenario.error && <li className="scenario-error">止まりました：{scenario.error}</li>}
        </ol>
      )}

      {!ready ? (
        <p className="state">3つの画面にログインしています…</p>
      ) : (
        <div className="stage-grid">
          <figure className={`device device-phone ${scenario?.step === 1 ? 'is-focus' : ''}`}>
            <figcaption>利用者（スマートフォン）</figcaption>
            <iframe key={`u${keys.user}`} src={userSrc} title="利用者の画面" />
          </figure>
          <figure className={`device device-tablet ${scenario && [0, 2, 3].includes(scenario.step) ? 'is-focus' : ''}`}>
            <figcaption>サロン（タブレット）</figcaption>
            <iframe key={`s${keys.salon}`} src="/salon" title="サロンの画面" />
          </figure>
          <figure className={`device device-desk ${scenario?.step === 4 ? 'is-focus' : ''}`}>
            <figcaption>運営</figcaption>
            <iframe key={`a${keys.admin}`} src="/admin" title="運営の画面" />
          </figure>
        </div>
      )}

      {race && (
        <div className="sheet-backdrop race-backdrop" onClick={() => race.state === 'done' && setRace(null)}>
          <section className="race" onClick={(e) => e.stopPropagation()} aria-live="polite">
            <p className="race-title">同時予約チャレンジ</p>
            <p className="race-sub">
              {race.state === 'running'
                ? '10人が同じ枠に、同時に予約を送っています…'
                : `今日 ${race.time} の枠に10人が同時に予約 → 成立 ${race.results.filter((r) => r.ok).length} 件・データベース上の有効な予約 ${race.confirmed} 件`}
            </p>
            <ul className="race-grid">
              {(race.state === 'running'
                ? Array.from({ length: 10 }, (_, i) => ({ no: i + 1, name: `利用者${i + 1}`, ok: false, code: null, ms: 0 }))
                : race.results
              ).map((r) => (
                <li key={r.no} className={race.state === 'running' ? 'is-wait' : r.ok ? 'is-win' : 'is-lose'}>
                  <span className="race-avatar" aria-hidden>
                    {r.name.slice(0, 1)}
                  </span>
                  <span className="race-name">{r.name}</span>
                  <span className="race-result">
                    {race.state === 'running' ? '送信中' : r.ok ? '予約成立' : r.code === 'already_booked' ? 'すでに埋まっています' : r.code}
                  </span>
                </li>
              ))}
            </ul>
            {race.state === 'done' && (
              <>
                <p className="race-why">行ロックと一意制約の二重の防止で、1つの枠に成立する予約は必ず1件だけです。</p>
                <button className="btn btn-primary btn-block" onClick={() => setRace(null)}>
                  閉じる
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
