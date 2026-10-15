import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFreeTime } from '../../lib/split.ts';

// 日本時間の 2026-10-15 hh:mm
const jst = (hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 15, hh - 9, mm));
const fmt = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(11, 16);

test('90分の空きに60分のカットなら1枠', () => {
  const r = splitFreeTime({ freeStart: jst(14), freeEnd: jst(15, 30), durationMin: 60, deadlineMin: 10, now: jst(12) });
  assert.deepEqual(r.map((s) => [fmt(s.start), fmt(s.end), s.problem]), [['14:00', '15:00', null]]);
});

test('90分の空きに15分の前髪カットなら連続した6枠', () => {
  const r = splitFreeTime({ freeStart: jst(14), freeEnd: jst(15, 30), durationMin: 15, deadlineMin: 10, now: jst(12) });
  assert.deepEqual(r.map((s) => fmt(s.start)), ['14:00', '14:15', '14:30', '14:45', '15:00', '15:15']);
});

test('開始は5分単位に切り上げる', () => {
  const r = splitFreeTime({ freeStart: jst(14, 2), freeEnd: jst(15, 30), durationMin: 60, deadlineMin: 10, now: jst(12) });
  assert.equal(fmt(r[0].start), '14:05');
});

test('受付の締切を過ぎる枠は、理由を付けて返す', () => {
  // 今 11:50、3時間前締切のカラー → 13:00 開始は締切（10:00）切れ、15:00 開始は締切 12:00 で間に合う
  const r = splitFreeTime({ freeStart: jst(13), freeEnd: jst(17), durationMin: 120, deadlineMin: 180, now: jst(11, 50), fromBookable: false });
  assert.deepEqual(r.map((s) => [fmt(s.start), s.problem]), [
    ['13:00', 'too_late'],
    ['15:00', null],
  ]);
});

test('9時より前・今日を超える枠は出せない', () => {
  const early = splitFreeTime({ freeStart: jst(8), freeEnd: jst(9), durationMin: 30, deadlineMin: 10, now: jst(6), fromBookable: false });
  assert.deepEqual(early.map((s) => s.problem), ['outside_hours', 'outside_hours']);
  const late = splitFreeTime({ freeStart: jst(23, 30), freeEnd: jst(25), durationMin: 30, deadlineMin: 10, now: jst(20), fromBookable: false });
  assert.deepEqual(late.map((s) => s.problem), [null, 'today_only', 'today_only']);
});

test('空きより長いメニュー・空きがない場合は0件', () => {
  assert.equal(splitFreeTime({ freeStart: jst(14), freeEnd: jst(14, 30), durationMin: 60, deadlineMin: 10, now: jst(12) }).length, 0);
  assert.equal(splitFreeTime({ freeStart: jst(14), freeEnd: jst(14), durationMin: 15, deadlineMin: 10, now: jst(12) }).length, 0);
});

test('多すぎる枠は上限で止める', () => {
  const r = splitFreeTime({ freeStart: jst(10), freeEnd: jst(23), durationMin: 15, deadlineMin: 10, now: jst(9), maxSlots: 24 });
  assert.equal(r.length, 24);
});

test('既定では、受付の締切に間に合う最初の時刻から並べる', () => {
  // 今 12:22、締切10分前 → 12:33 以降に始まる枠だけ。5分単位で 12:35 から
  const r = splitFreeTime({ freeStart: jst(12, 22), freeEnd: jst(13, 52), durationMin: 15, deadlineMin: 10, now: jst(12, 22) });
  assert.equal(fmt(r[0].start), '12:35');
  assert.ok(r.every((s) => s.problem === null));
  assert.equal(fmt(r[r.length - 1].end), '13:50');
});

test('既定では、締切の長いメニューは空きの後ろのほうから入る', () => {
  // 今 11:50、3時間前締切のカラー（120分）、13:00〜17:00 の空き → 14:51 以降に始まる枠だけ。5分単位で 14:55〜16:55 の1枠
  const r = splitFreeTime({ freeStart: jst(13), freeEnd: jst(17), durationMin: 120, deadlineMin: 180, now: jst(11, 50) });
  assert.deepEqual(r.map((s) => [fmt(s.start), fmt(s.end), s.problem]), [['14:55', '16:55', null]]);
});