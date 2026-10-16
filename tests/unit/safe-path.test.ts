import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safePath } from '../../lib/oauth-shared.ts';

// ログインや登録のあとに戻る先：同じサイトの中だけを通し、外のサイトへ飛ばない
test('同じサイトの中の行き先は、そのまま通す', () => {
  assert.equal(safePath('/'), '/');
  assert.equal(safePath('/book/abc?x=1#top'), '/book/abc?x=1#top');
  assert.equal(safePath('/salon/signup'), '/salon/signup');
});

test('外のサイトへの行き先は、既定の行き先にする', () => {
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'evil.example', '', 'javascript:alert(1)']) {
    assert.equal(safePath(bad, '/home'), '/home', bad);
  }
});

test('タブ・改行などをはさんで「//」に化けさせる手口も防ぐ', () => {
  for (const bad of ['/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/%09/evil.example'.replace('%09', '\t'), '/\u0000/x']) {
    assert.equal(safePath(bad, '/'), '/', JSON.stringify(bad));
  }
});

test('文字列でないもの・長すぎるものは使わない', () => {
  assert.equal(safePath(undefined, '/x'), '/x');
  assert.equal(safePath(123 as unknown, '/x'), '/x');
  assert.equal(safePath('/' + 'a'.repeat(400), '/x'), '/x');
});
