import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { memoryStorage } from './helpers/stub-modules.mjs';

const storage = memoryStorage();
globalThis.require = () => ({ default: storage });
const { readAuditionMarks, writeAuditionMarks } = await import('../lib/audition-marks.ts');

beforeEach(() => storage.values.clear());

test('찜과 봤음을 따로 기기에 적고 읽는다', async () => {
  await writeAuditionMarks('starred', new Set(['a1', 'a2']));
  await writeAuditionMarks('seen', new Set(['a3']));
  assert.deepEqual([...await readAuditionMarks('starred')], ['a1', 'a2']);
  assert.deepEqual([...await readAuditionMarks('seen')], ['a3']);
  assert.equal(storage.values.get('acttub.auditions.starred'), '["a1","a2"]');
});

test('봤음은 최근 500개만 남기고 찜은 다 남긴다', async () => {
  const ids = Array.from({ length: 502 }, (_, i) => `id-${i}`);
  await writeAuditionMarks('seen', new Set(ids));
  await writeAuditionMarks('starred', new Set(ids));
  const seen = [...await readAuditionMarks('seen')];
  assert.equal(seen.length, 500);
  assert.equal(seen[0], 'id-2');
  assert.equal((await readAuditionMarks('starred')).size, 502);
});

test('기록이 없거나 깨졌거나 글자가 아닌 값은 빼고 읽는다', async () => {
  assert.deepEqual([...await readAuditionMarks('starred')], []);
  storage.values.set('acttub.auditions.starred', '{"a":1}');
  assert.deepEqual([...await readAuditionMarks('starred')], []);
  storage.values.set('acttub.auditions.starred', '["a1", 3, null]');
  assert.deepEqual([...await readAuditionMarks('starred')], ['a1']);
  storage.values.set('acttub.auditions.starred', '{broken');
  assert.deepEqual([...await readAuditionMarks('starred')], []);
});

test('저장이 실패해도 던지지 않는다', async () => {
  const original = storage.setItem;
  storage.setItem = async () => { throw new Error('disk full'); };
  try {
    await writeAuditionMarks('starred', new Set(['a1']));
  } finally {
    storage.setItem = original;
  }
  assert.deepEqual([...await readAuditionMarks('starred')], []);
});
