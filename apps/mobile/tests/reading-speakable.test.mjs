import { test } from 'node:test';
import assert from 'node:assert/strict';

import { speakableText } from '../lib/reading/tts/speakable.ts';

test('speakableText가 지문(괄호)을 빼서 읽을 문장만 남긴다', () => {
  assert.equal(speakableText('(웃으며) 그런가.'), '그런가.');
  assert.equal(speakableText('말하면 뭐가 달라져.'), '말하면 뭐가 달라져.');
});
