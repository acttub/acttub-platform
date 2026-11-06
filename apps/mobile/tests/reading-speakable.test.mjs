import { test } from 'node:test';
import assert from 'node:assert/strict';

import { speakableText } from '../lib/reading/tts/speakable.ts';

test('speakableText가 지문(괄호)을 빼서 읽을 문장만 남긴다', () => {
  assert.equal(speakableText('(웃으며) 그런가.'), '그런가.');
  assert.equal(speakableText('말하면 뭐가 달라져.'), '말하면 뭐가 달라져.');
});

test('닫히지 않은 괄호는 괄호 글자만 빼고 나머지를 읽는다 — 어디까지 지문인지 모르니 침묵보다 읽는 쪽이 낫다', () => {
  assert.equal(speakableText('(문을 열며 그래, 들어와'), '문을 열며 그래, 들어와');
  assert.equal(speakableText('(웃으며) 그래 (작게'), '그래 작게');
  assert.equal(speakableText('그만해)'), '그만해');
});
