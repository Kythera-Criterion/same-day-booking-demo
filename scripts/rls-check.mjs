// 権限の分離（行単位のアクセス制御）が効いていることを、実際のログインで確かめる
import { admin, anon, createTestSlot, signIn } from './_common.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? `（${detail}）` : ''}`);
}

// 準備：サロンAの枠を作り、利用者1が予約する
const slot = await createTestSlot();
const user1 = await signIn('user1@demo.test');
const user2 = await signIn('user2@demo.test');
const salonA = await signIn('salon-a@demo.test');
const salonB = await signIn('salon-b@demo.test');

const { data: booking, error: bookError } = await user1.rpc('book_slot', { p_slot_id: slot.id });
if (bookError) throw bookError;
const { data: me1 } = await user1.auth.getUser();

// 1. サロンAは自店の予約を見られる
{
  const { data } = await salonA.from('bookings').select('id,contact_name').eq('id', booking.id);
  check('サロンAは自店の予約（名前・電話）を見られる', data?.length === 1);
}
// 2. サロンBからは見えない
{
  const { data } = await salonB.from('bookings').select('id').eq('id', booking.id);
  check('サロンBからサロンAの予約は見えない', (data?.length ?? 0) === 0);
}
// 3. 利用者2から利用者1の予約は見えない
{
  const { data } = await user2.from('bookings').select('id').eq('user_id', me1.user.id);
  check('利用者2から利用者1の予約は見えない', (data?.length ?? 0) === 0);
}
// 4. ログインしていない人は予約を一切見られない
{
  const { data, error } = await anon().from('bookings').select('id').limit(1);
  check('ログインしていない人は予約を見られない', !!error || (data?.length ?? 0) === 0, error?.message);
}
// 5. 画面側からテーブルに直接書き込めない
{
  const { error } = await user1.from('slots').insert({
    salon_id: slot.salon_id, menu_id: slot.menu_id, start_at: slot.start_at, end_at: slot.end_at, price: 1,
  });
  check('利用者は枠を直接作れない', !!error, error?.message);
}
{
  const { error } = await user1.from('bookings').update({ status: 'completed' }).eq('id', booking.id);
  check('利用者は予約の状態を直接書き換えられない', !!error, error?.message);
}
// 6. サロンBはサロンAの予約を操作できない
{
  const { error } = await salonB.rpc('salon_update_booking', { p_booking_id: booking.id, p_action: 'cancel' });
  check('サロンBはサロンAの予約をキャンセルできない', !!error && error.message.includes('forbidden'));
}
// 7. サロンは利用者のプロフィール（性別・年代など）を見られない
{
  const { data } = await salonA.from('profiles').select('id').neq('id', (await salonA.auth.getUser()).data.user.id);
  check('サロンから利用者のプロフィールは見えない', (data?.length ?? 0) === 0);
}
// 8. 無断キャンセルの記録は画面側から見えない
{
  const { data, error } = await salonA.from('no_show_records').select('id').limit(1);
  check('無断キャンセルの記録は画面側から見えない', !!error || (data?.length ?? 0) === 0, error?.message);
}

// 後片付け（テスト用の予約は、サロン都合のキャンセルとして閉じる）
await salonA.rpc('salon_update_booking', { p_booking_id: booking.id, p_action: 'cancel' });
await admin.from('slots').update({ status: 'closed' }).eq('id', slot.id);

const passed = results.filter(Boolean).length;
console.log(`\n${passed} / ${results.length} 件の確認に合格しました。`);
