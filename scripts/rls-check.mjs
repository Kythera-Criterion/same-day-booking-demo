// 権限の分離（行単位のアクセス制御）が効いていることを、実際のログインで確かめる
import { anon, createTestSlot, removeTestSlot, signIn } from './_common.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? `（${detail}）` : ''}`);
}

// 準備：サロンAの枠を作り、利用者1が予約してアンケートに答える
const slot = await createTestSlot();
const user1 = await signIn('user1@demo.test');
const user2 = await signIn('user2@demo.test');
const salonA = await signIn('salon-a@demo.test');
const salonB = await signIn('salon-b@demo.test');
const operator = await signIn('admin@demo.test');

const { data: booking, error: bookError } = await user1.rpc('book_slot', { p_slot_id: slot.id, p_note: '確認用' });
if (bookError) throw bookError;
const { data: me1 } = await user1.auth.getUser();
await user1.rpc('submit_survey', { p_booking_id: booking.id, p_answers: { effort: '簡単' } });

try {
  // 1. サロンAは自店の予約を見られる（第3章8の範囲）
  {
    const { data } = await salonA.from('bookings').select('id,contact_name,contact_phone,contact_email,karte').eq('id', booking.id);
    check('サロンAは自店の予約（名前・電話・メール・カルテ）を見られる', data?.length === 1 && !!data[0].contact_email);
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
    const { error } = await salonB.rpc('salon_update_booking', { p_booking_id: booking.id, p_action: 'cancel_salon' });
    check('サロンBはサロンAの予約をキャンセルできない', !!error && /forbidden|booking_not_found/.test(error.message));
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
  // 9. 年代・職業・アンケートの回答はサロンに渡らない
  {
    const { data, error } = await salonA.from('booking_demographics').select('booking_id').limit(1);
    check('年代・職業はサロンから見えない', !!error || (data?.length ?? 0) === 0, error?.message);
  }
  {
    const { data, error } = await salonA.from('survey_answers').select('booking_id').limit(1);
    check('アンケートの回答はサロンから見えない', !!error || (data?.length ?? 0) === 0, error?.message);
  }
  // 10. 運営だけが全体と集計を見られる
  {
    const { data } = await operator.from('bookings').select('id').eq('id', booking.id);
    check('運営は全サロンの予約を見られる', data?.length === 1);
  }
  {
    const { error } = await salonA.rpc('admin_metrics', { p_from: '2026-01-01', p_to: '2026-01-07' });
    check('サロンは実証の数字を見られない', !!error && error.message.includes('forbidden'));
  }
  // 11. LINE のグループ ID は自店だけ
  {
    const { data } = await salonB.from('salon_private').select('salon_id').eq('salon_id', slot.salon_id);
    check('ほかのサロンの LINE グループ ID は見えない', (data?.length ?? 0) === 0);
  }
  // 12. 掲載を止めたサロンの枠は、検索にも表にも出ず、予約もできない（確かめたら元に戻す）
  {
    const SALON_C = '33333333-3333-4333-8333-333333333333';
    const user5 = await signIn('user5@demo.test');
    const { data: before } = await user5.from('slots').select('id').eq('salon_id', SALON_C).eq('status', 'open');
    await operator.rpc('admin_set_salon_approved', { p_salon_id: SALON_C, p_approved: false });
    try {
      const { data: found } = await user5.rpc('search_open_slots', { p_until: new Date(Date.now() + 86400000).toISOString() });
      const { data: direct } = await user5.from('slots').select('id').eq('salon_id', SALON_C).in('status', ['open', 'closed']).eq('demo_history', false);
      const { data: anonDirect } = await anon().from('slots').select('id').eq('salon_id', SALON_C);
      check(
        '掲載を止めたサロンの枠は、検索にも表にも出ない',
        !(found ?? []).some((s) => s.salon_id === SALON_C) && (direct?.length ?? 0) === 0 && (anonDirect?.length ?? 0) === 0,
      );
      if ((before?.length ?? 0) > 0) {
        const { error } = await user5.rpc('book_slot', { p_slot_id: before[0].id });
        check('掲載を止めたサロンの枠は予約できない', !!error && /slot_not_found|has_active_booking/.test(error.message), error?.message);
      }
    } finally {
      await operator.rpc('admin_set_salon_approved', { p_salon_id: SALON_C, p_approved: true });
    }
  }
  // 13. デモ用の関数は画面側から呼べない
  {
    const { error } = await operator.rpc('demo_reset', { p_with_history: false });
    check('デモのリセットは画面側から呼べない（運営でも）', !!error, error?.message);
  }
  // 14. 登録・外部 ID の連携に使う情報は、サーバー側だけが扱う
  {
    const { data, error } = await user1.from('social_identities').select('provider').limit(1);
    check('外部 ID（Google・Yahoo! JAPAN ID）の連携の表は、画面側から読めない', !!error || (data?.length ?? 0) === 0, error?.message);
  }
  {
    const { error } = await user1.rpc('find_user_id_by_email', { p_email: 'user2@demo.test' });
    check('画面側から、メールアドレスでアカウントを探せない', !!error, error?.message);
  }
  {
    const { error } = await anon().rpc('salon_self_register', {
      p_salon_name: 'x', p_contact_name: 'y', p_phone: '090-0000-0000', p_area_id: '00000000-0000-0000-0000-000000000000', p_address: 'z',
    });
    check('ログインしていない人は、サロンを自己登録できない', !!error, error?.message);
  }
  {
    const { error } = await user1.rpc('admin_list_admins');
    check('利用者は、運営メンバーの一覧を見られない', !!error && error.message.includes('forbidden'), error?.message);
  }
  {
    const { error } = await user1.from('admins').insert({ user_id: me1.user.id });
    check('利用者は、自分を運営に加えられない', !!error, error?.message);
  }
} finally {
  // 後片付け（テスト用の予約と枠を消す）
  await removeTestSlot(slot.id);
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed} / ${results.length} 件の確認に合格しました。`);
process.exitCode = passed === results.length ? 0 : 1;
