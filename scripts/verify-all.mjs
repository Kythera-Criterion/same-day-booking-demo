// 実際の Supabase で、一通りの流れを確かめる
//   リセット → 枠の公開 → 予約（写真つき）→ リアルタイム通知 → 通知の送信 → キャンセル → 集計
//   あわせて、ローカルでは確かめられない Storage・Realtime・pg_cron を確認する
// 使い方: npm run verify（アプリを起動していれば、通知の送信も API 経由で確かめる）
// 注意: デモ用のデータ（今日の空き枠など）を作り直します
import { admin, signIn } from './_common.mjs';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const SKIP_CRON = process.argv.includes('--skip-cron');
const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? `（${detail}）` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MENU_A = 'd1111111-1111-4111-8111-111111111111';

// 0. リセット
{
  const { data, error } = await admin.rpc('demo_reset', { p_with_history: true });
  check('デモをリセット（今日の空き枠と過去7日分の架空データ）', !error && data.history_slots > 0, error?.message ?? JSON.stringify(data));
}

const salonA = await signIn('salon-a@demo.test');
const salonB = await signIn('salon-b@demo.test');
const user = await signIn('user5@demo.test');
const other = await signIn('user6@demo.test');
const operator = await signIn('admin@demo.test');
const { data: me } = await user.auth.getUser();

// 1. 枠の公開（サロンAが関数で出す。締切はメニューの締切から決まる）
// メニューの受付締切に合わせて、予約を受けられる時刻にする（サロンが締切を変えても確かめられる）
const { data: menuA } = await admin.from('menus').select('booking_deadline_min').eq('id', MENU_A).single();
const DEADLINE_A = menuA?.booking_deadline_min ?? 10;
const start = (() => {
  const step = 5 * 60 * 1000;
  const t = Math.ceil((Date.now() + (DEADLINE_A + 30) * 60 * 1000) / step) * step;
  const jst = new Date(t + 9 * 3600 * 1000);
  const nine = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), 9, 30) - 9 * 3600 * 1000;
  return new Date(Math.max(t, nine));
})();
const { data: slot, error: slotError } = await salonA.rpc('create_slot', { p_menu_id: MENU_A, p_start_at: start.toISOString() });
check('サロンが今日の枠を出せる', !slotError, slotError?.message);
if (slotError) process.exit(1);
check(`枠の締切がメニューの締切（${DEADLINE_A}分前）になる`, new Date(slot.start_at) - new Date(slot.deadline_at) === DEADLINE_A * 60 * 1000);

// 2. 利用者の検索に出る（締切・性別・エリアを考慮する関数）
{
  const { data } = await user.rpc('search_open_slots', { p_until: new Date(Date.now() + 24 * 3600 * 1000).toISOString() });
  check('公開した枠が利用者の検索に出る', (data ?? []).some((s) => s.slot_id === slot.id));
}

// 3. リアルタイム：サロンの画面に予約が即座に届く
let realtimeAt = null;
const channel = salonA
  .channel('verify-salon')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings' }, (p) => {
    if (p.new.slot_id === slot.id) realtimeAt = Date.now();
  });
await new Promise((resolve) => channel.subscribe((s) => s === 'SUBSCRIBED' && resolve()));

// 4. 写真を非公開バケットに置き、予約に添える
const photoPath = `${me.user.id}/verify-${Date.now()}.png`;
{
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const { error } = await user.storage.from('hair-photos').upload(photoPath, png, { contentType: 'image/png' });
  check('利用者は自分のフォルダに写真を置ける（Storage）', !error, error?.message);
  const { error: e2 } = await user.storage.from('hair-photos').upload(`00000000-0000-4000-8000-000000000000/x.png`, png, { contentType: 'image/png' });
  check('他人のフォルダには置けない', !!e2, e2?.message);
}

// 5. 予約
// 1アカウント1件のため、残っている予約があれば閉じる（デモ用）
{
  const { data: open } = await admin.from('bookings').select('id,slots!inner(end_at)').eq('user_id', me.user.id).eq('status', 'confirmed').gt('slots.end_at', new Date().toISOString());
  if (open?.length) await admin.from('bookings').update({ status: 'completed' }).in('id', open.map((b) => b.id));
}
const t0 = Date.now();
const { data: booking, error: bookError } = await user.rpc('book_slot', {
  p_slot_id: slot.id,
  p_note: '確認用の予約',
  p_photo_path: photoPath,
  p_photo_note: '確認用の写真',
  p_conversation_pref: 'quiet',
});
check('利用者が予約できる（写真・メモ・会話の好みつき）', !bookError, bookError?.message);
if (bookError) process.exit(1);
for (let i = 0; i < 50 && realtimeAt === null; i++) await sleep(200);
check('サロンに予約がリアルタイムで届く（Realtime）', realtimeAt !== null, realtimeAt ? `${realtimeAt - t0}ms` : '10秒以内に届かず');
await salonA.removeChannel(channel);

{
  const { error } = await other.rpc('book_slot', { p_slot_id: slot.id });
  check('同じ枠に別の人は予約できない', !!error && /already_booked|has_active_booking/.test(error.message), error?.message);
}
{
  const { data } = await user.rpc('submit_survey', { p_booking_id: booking.id, p_answers: { effort: '簡単' } });
  check('予約直後のアンケートに答えられる', data === 1);
}

// 6. 写真の見え方（署名付きURL・60秒）
{
  const { data: a, error: ea } = await salonA.storage.from('hair-photos').createSignedUrl(photoPath, 60);
  const ok = !ea && a?.signedUrl ? (await fetch(a.signedUrl)).ok : false;
  check('予約のサロンは写真を見られる（60秒の署名付きURL）', ok, ea?.message);
  const { error: eb } = await salonB.storage.from('hair-photos').createSignedUrl(photoPath, 60);
  check('ほかのサロンは写真を見られない', !!eb, eb?.message);
  const { error: eo } = await other.storage.from('hair-photos').createSignedUrl(photoPath, 60);
  check('ほかの利用者は写真を見られない', !!eo, eo?.message);
}

// 7. 通知（予約の成立 → サロンの LINE）
async function dispatch() {
  try {
    const res = await fetch(`${APP_URL}/api/notifications/dispatch`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    return res.ok ? await res.json() : { error: res.status };
  } catch {
    return null;
  }
}
{
  const { data: q } = await admin.from('notification_outbox').select('id,kind,status').eq('booking_id', booking.id);
  check('予約の成立が通知の送信待ちに積まれる', (q ?? []).some((r) => r.kind === 'booking_created'));
  const r = await dispatch();
  if (r === null) console.log(`- 通知の送信は確認していません（${APP_URL} でアプリが起動していません）`);
  else {
    const { data: after } = await admin.from('notification_outbox').select('status,response').eq('booking_id', booking.id).eq('kind', 'booking_created').single();
    check('通知が送信される（キーがなければシミュレーション送信）', ['sent', 'simulated'].includes(after?.status), after?.status);
    await dispatch();
    const { data: once } = await admin.from('notification_outbox').select('attempts,status').eq('booking_id', booking.id).eq('kind', 'booking_created').single();
    check('同じ通知は二度送らない（もう一度送信しても、送信は1回のまま）', once?.attempts === 1 && once?.status === after?.status, `attempts=${once?.attempts}`);
  }
}

// 8. キャンセル（サロンの都合 → 利用者へメール。無断キャンセルには数えない。枠は公開に戻る）
{
  const { error } = await salonA.rpc('salon_update_booking', { p_booking_id: booking.id, p_action: 'cancel_salon' });
  check('サロンの都合でキャンセルできる', !error, error?.message);
  const { data: s } = await admin.from('slots').select('status').eq('id', slot.id).single();
  check('締切まで時間があれば、枠が公開に戻る', s?.status === 'open');
  const { data: mail } = await admin.from('notification_outbox').select('channel,recipient').eq('booking_id', booking.id).eq('kind', 'salon_cancel_mail');
  check('利用者へのメールが積まれる', mail?.length === 1 && mail[0].recipient === 'user5@demo.test');
  if ((await dispatch()) !== null) {
    const { data: m2 } = await admin.from('notification_outbox').select('status').eq('booking_id', booking.id).eq('kind', 'salon_cancel_mail').single();
    check('キャンセルのメールが送信される（キーがなければシミュレーション送信）', ['sent', 'simulated'].includes(m2?.status), m2?.status);
  }
}

// 9. 集計（運営だけ）
{
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const week = new Date(Date.now() + 9 * 3600 * 1000 - 6 * 86400 * 1000).toISOString().slice(0, 10);
  const { data: m, error } = await operator.rpc('admin_metrics', { p_from: week, p_to: today, p_min_days: 3 });
  check('運営は実証の数字を見られる', !error && m.published_slots > 0 && m.bookings > 0, error?.message ?? `公開 ${m?.published_slots}・予約 ${m?.bookings}・成約率 ${m?.conversion_rate}・来店率 ${m?.visit_rate}`);
  check('アンケートの回答が集計に入る', !error && m.survey.some((q) => q.responses > 0));
  const { error: e2 } = await salonA.rpc('admin_metrics', { p_from: week, p_to: today });
  check('サロンは実証の数字を見られない', !!e2);
  const { data: dry } = await operator.rpc('admin_trial_end_dry_run');
  check('終了処理の試し実行で対象件数が出る', Array.isArray(dry?.items) && dry.items.length >= 8);
}

// 10. 時間切れの枠の自動処理（pg_cron で1分ごと）
if (SKIP_CRON) {
  console.log('- pg_cron の確認は省きました（--skip-cron）');
} else {
  const deadline = new Date(Date.now() + 5000);
  // 開始は1つ目の枠と同じ時刻にする（今日の9時以降に収まる。担当なしの枠どうしは重なってもよい）。夜遅くでも0時を越えない
  const startAt = new Date(start.getTime());
  const { data: s2, error } = await admin
    .from('slots')
    .insert({ salon_id: slot.salon_id, menu_id: MENU_A, start_at: startAt.toISOString(), end_at: new Date(startAt.getTime() + 3600 * 1000).toISOString(), price: 4500, deadline_at: deadline.toISOString() })
    .select()
    .single();
  if (error) check('時間切れの確認用の枠を作れる', false, error.message);
  else {
    console.log('- pg_cron の動きを待っています（最大75秒）…');
    let status = 'open';
    for (let i = 0; i < 25 && status === 'open'; i++) {
      await sleep(3000);
      status = (await admin.from('slots').select('status').eq('id', s2.id).single()).data?.status;
    }
    check('締切を過ぎた枠が、自動で受付終了になる（pg_cron）', status === 'expired', status);
    await admin.from('slots').delete().eq('id', s2.id);
  }
}

// 後片付け（確認用の写真を消す）
await user.storage.from('hair-photos').remove([photoPath]);

const passed = results.filter(Boolean).length;
console.log(`\n${passed} / ${results.length} 件の確認に合格しました。`);
process.exitCode = passed === results.length ? 0 : 1;
process.exit();
