// 同じ枠に、2人の利用者から合わせて10件の予約を同時に送る。成立するのは1件だけであることを確かめる
import { admin, createTestSlot, jstTime, signIn } from './_common.mjs';

const slot = await createTestSlot();
const user1 = await signIn('user1@demo.test');
const user2 = await signIn('user2@demo.test');

console.log(`今日 ${jstTime(slot.start_at)} の枠に、10件の予約を同時に送ります…\n`);

const requests = Array.from({ length: 10 }, (_, i) => {
  const who = i % 2 === 0 ? '利用者1' : '利用者2';
  const client = i % 2 === 0 ? user1 : user2;
  return client.rpc('book_slot', { p_slot_id: slot.id }).then(({ error }) => ({ who, error }));
});

const results = await Promise.all(requests);
results.forEach((r, i) => {
  const label = `#${String(i + 1).padStart(2, '0')} ${r.who}`;
  if (!r.error) console.log(`${label}  予約成立`);
  else if (r.error.message.includes('already_booked')) console.log(`${label}  すでに埋まっています（already_booked）`);
  else console.log(`${label}  エラー: ${r.error.message}`);
});

const { count, error } = await admin
  .from('bookings')
  .select('id', { count: 'exact', head: true })
  .eq('slot_id', slot.id)
  .neq('status', 'cancelled_by_salon');
if (error) throw error;

const success = results.filter((r) => !r.error).length;
console.log(`\n成立した予約: ${success} 件 ／ データベース上の有効な予約: ${count} 件`);
console.log(success === 1 && count === 1 ? '→ 同時に予約が来ても、1つの枠に予約は1件だけです。' : '→ 想定と異なる結果です。');
