// 同じ枠に、10人の利用者から同時に予約を送る。成立するのは1件だけであることを確かめる
import { admin, createTestSlot, DEMO_USERS, jstTime, signIn } from './_common.mjs';

const slot = await createTestSlot();
const clients = await Promise.all(DEMO_USERS.map((email) => signIn(email)));

console.log(`今日 ${jstTime(slot.start_at)} の枠に、10人が同時に予約を送ります…\n`);

const results = await Promise.all(
  clients.map((client, i) =>
    client.rpc('book_slot', { p_slot_id: slot.id }).then(({ error }) => ({ who: `利用者${i + 1}`, error })),
  ),
);

results.forEach((r, i) => {
  const label = `#${String(i + 1).padStart(2, '0')} ${r.who.padEnd(5, '　')}`;
  if (!r.error) console.log(`${label}  予約成立`);
  else if (r.error.message.includes('already_booked')) console.log(`${label}  すでに埋まっています（already_booked）`);
  else console.log(`${label}  エラー: ${r.error.message}`);
});

const { count, error } = await admin
  .from('bookings')
  .select('id', { count: 'exact', head: true })
  .eq('slot_id', slot.id)
  .eq('status', 'confirmed');
if (error) throw error;

const success = results.filter((r) => !r.error).length;
const alreadyBooked = results.filter((r) => r.error?.message.includes('already_booked')).length;
console.log(`\n成立した予約: ${success} 件 ／ すでに埋まっています: ${alreadyBooked} 件 ／ データベース上の有効な予約: ${count} 件`);
const ok = success === 1 && count === 1 && alreadyBooked === 9;
console.log(ok ? '→ 同時に予約が来ても、1つの枠に予約は1件だけです。' : '→ 想定と異なる結果です。');
process.exitCode = ok ? 0 : 1;
