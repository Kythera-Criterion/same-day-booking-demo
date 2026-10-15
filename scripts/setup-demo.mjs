// デモ用のアカウントを作成する（何度実行しても同じ状態になる）
//   サロン3店のスタッフ、運営、利用者10人（年代・職業はばらけさせる）
import { admin, AREA_STATION, PASSWORD, SALON_A, SALON_B, SALON_C } from './_common.mjs';

// 規約の版（仮置き。公開中の規約の版に合わせて書き換える）
const TERMS_VERSION = process.env.TERMS_VERSION || 'demo-1';

const USERS = [
  ['user1@demo.test', '山田 花子', 'female', '20s', '会社員'],
  ['user2@demo.test', '鈴木 一郎', 'male', '30s', '自営業'],
  ['user3@demo.test', '佐藤 美咲', 'female', '18-19', '学生'],
  ['user4@demo.test', '高橋 健太', 'male', '20s', '学生'],
  ['user5@demo.test', '田中 由美', 'female', '40s', 'パート・アルバイト'],
  ['user6@demo.test', '伊藤 誠', 'male', '50s', '会社員'],
  ['user7@demo.test', '渡辺 さくら', 'female', '30s', '主婦・主夫'],
  ['user8@demo.test', '中村 大輔', 'male', '40s', '公務員'],
  ['user9@demo.test', '小林 優子', 'female', '60+', 'その他'],
  ['user10@demo.test', '加藤 翔', 'male', '20s', 'フリーランス'],
].map(([email, name, gender, age, job], i) => ({
  email,
  meta: { display_name: name },
  profile: {
    display_name: name,
    phone: `090-0000-${String(i + 1).padStart(4, '0')}`,
    gender,
    age_group: age,
    occupation: job,
    area_id: AREA_STATION,
    conversation_pref: ['either', 'quiet', 'talk'][i % 3],
  },
}));

const ACCOUNTS = [
  { email: 'salon-a@demo.test', meta: { display_name: 'HAIR ROOM AOI スタッフ' }, salonId: SALON_A },
  { email: 'salon-b@demo.test', meta: { display_name: 'atelier nagi スタッフ' }, salonId: SALON_B },
  { email: 'salon-c@demo.test', meta: { display_name: 'Salon Komorebi スタッフ' }, salonId: SALON_C },
  { email: 'admin@demo.test', meta: { display_name: '運営（デモ）' }, admin: true },
  ...USERS,
];

const existing = new Map();
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  for (const u of data.users) existing.set(u.email, u.id);
  if (data.users.length < 200) break;
}

for (const account of ACCOUNTS) {
  let userId = existing.get(account.email);
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
  if (account.admin) {
    const { error } = await admin.from('admins').upsert({ user_id: userId });
    if (error) throw error;
  }
  if (account.profile) {
    // 登録画面で入れる内容（18歳以上の確認・規約への同意を含む）をそろえる
    const { error } = await admin
      .from('profiles')
      .update({ ...account.profile, email: account.email, adult_confirmed_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) throw error;
    const { count } = await admin.from('consents').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    if (!count) {
      const { error: consentError } = await admin.from('consents').insert([
        { user_id: userId, kind: 'terms', version: TERMS_VERSION },
        { user_id: userId, kind: 'privacy', version: TERMS_VERSION },
      ]);
      if (consentError) throw consentError;
    }
  }
}

console.log(`\nデモ用アカウントの準備ができました。パスワード: ${PASSWORD}`);
console.log('今日の空き枠は、デモ画面の「デモをリセット」か supabase/demo_slots.sql で用意できます。');
