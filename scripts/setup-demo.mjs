// デモ用のアカウント（サロン2店のスタッフと利用者2名）を作成する
import { admin, PASSWORD, SALON_A, SALON_B } from './_common.mjs';

const ACCOUNTS = [
  { email: 'salon-a@demo.test', meta: { display_name: 'HAIR ROOM AOI スタッフ' }, salonId: SALON_A },
  { email: 'salon-b@demo.test', meta: { display_name: 'atelier nagi スタッフ' }, salonId: SALON_B },
  { email: 'user1@demo.test', meta: { display_name: '山田 花子', phone: '090-0000-0001', gender: 'female' } },
  { email: 'user2@demo.test', meta: { display_name: '鈴木 一郎', phone: '090-0000-0002', gender: 'male' } },
];

const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
if (listError) throw listError;

for (const account of ACCOUNTS) {
  let userId = list.users.find((u) => u.email === account.email)?.id;
  if (userId) {
    console.log(`作成済み  ${account.email}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: account.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: account.meta,
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`作成      ${account.email}`);
  }

  if (account.salonId) {
    const { error } = await admin.from('salon_members').upsert({ salon_id: account.salonId, user_id: userId });
    if (error) throw error;
  }
}

console.log(`\nデモ用アカウントの準備ができました。パスワード: ${PASSWORD}`);
console.log('続けて Supabase の SQL Editor で supabase/demo_slots.sql を実行し、今日の空き枠を用意してください。');
