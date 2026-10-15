import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickThree, restByStart, type Candidate } from '../../lib/picks.ts';

const MIN = 60_000;
const c = (id: string, startMin: number, km: number | null): Candidate => ({ id, startMs: startMin * MIN, km });

test('役割の違う3件：いちばん早い・いちばん近い・バランス', () => {
  const list = [c('early-far', 10, 2.0), c('late-near', 120, 0.1), c('mid-mid', 40, 0.5), c('late-far', 150, 3.0)];
  const picked = pickThree(list);
  assert.deepEqual(
    picked.map((p) => [p.id, p.role]),
    [
      ['early-far', 'earliest'],
      ['late-near', 'nearest'],
      ['mid-mid', 'balanced'],
    ],
  );
});

test('同じ枠が「早い」と「近い」の両方に当たるときは、次に近い枠で埋める', () => {
  const list = [c('best', 10, 0.1), c('second-near', 90, 0.3), c('third', 60, 1.5)];
  const picked = pickThree(list);
  assert.deepEqual(picked.map((p) => p.id), ['best', 'second-near', 'third']);
  assert.equal(new Set(picked.map((p) => p.id)).size, 3);
});

test('候補が3件より少なければ、あるだけ返す', () => {
  assert.equal(pickThree([c('a', 10, 1)]).length, 1);
  assert.equal(pickThree([]).length, 0);
});

test('距離が分からないとき（null）も、時間で選べる', () => {
  const picked = pickThree([c('a', 30, null), c('b', 10, null), c('c', 20, null)]);
  assert.equal(picked[0].id, 'b');
  assert.equal(picked.length, 3);
});

test('近い順の3件（設定で切り替え）', () => {
  const picked = pickThree([c('a', 10, 2), c('b', 20, 0.5), c('c', 30, 1), c('d', 40, 0.2)], 'nearest');
  assert.deepEqual(picked.map((p) => [p.id, p.role]), [
    ['d', null],
    ['b', null],
    ['c', null],
  ]);
});

test('「もっと見る」は残りを開始時刻の早い順に', () => {
  const list = [c('a', 50, 1), c('b', 10, 1), c('c', 30, 0.1), c('d', 20, 5), c('e', 5, 9)];
  const picked = pickThree(list);
  const rest = restByStart(list, picked);
  assert.ok(rest.every((r) => !picked.some((p) => p.id === r.id)));
  assert.deepEqual(rest.map((r) => r.startMs), [...rest.map((r) => r.startMs)].sort((x, y) => x - y));
  assert.equal(rest.length + picked.length, list.length);
});
