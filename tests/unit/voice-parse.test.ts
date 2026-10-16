import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVoice } from '../../lib/voice-parse.ts';

// 「話しかけて探す」の読み取り：具体的な長さを先に読む
test('長さを言ったときは、その長さに合う時間帯にする', () => {
  assert.equal(parseVoice('30分以内にカット').window, 'now');
  assert.equal(parseVoice('45分で前髪').window, '1h');
  assert.equal(parseVoice('1時間以内').window, '1h');
  assert.equal(parseVoice('1時間30分以内にカット').window, '3h');
  assert.equal(parseVoice('2時間半くらい').window, '3h');
  assert.equal(parseVoice('三時間以内').window, '3h');
  assert.equal(parseVoice('5時間後でもいい').window, 'today');
});

test('言葉で言ったときは、その言葉の時間帯にする', () => {
  assert.equal(parseVoice('今すぐカット').window, 'now');
  assert.equal(parseVoice('夕方に前髪').window, '3h');
  assert.equal(parseVoice('今日中にカラー').window, 'today');
  assert.equal(parseVoice('カット').window, '1h');
});

test('「駅のすぐ近く」の「すぐ」を、今すぐと読み違えない', () => {
  assert.equal(parseVoice('駅のすぐ近くでカット').window, '1h');
  assert.ok(!parseVoice('駅のすぐ近くでカット').matched.includes('駅の近く'));
});

test('メニューを読み取る', () => {
  assert.equal(parseVoice('前髪だけ切りたい').menu, '前髪');
  assert.equal(parseVoice('カラーしたい').menu, 'カラー');
  assert.equal(parseVoice('散髪').menu, 'カット');
  assert.equal(parseVoice('今日中').menu, null);
});
