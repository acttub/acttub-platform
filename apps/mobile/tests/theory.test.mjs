import assert from 'node:assert/strict';
import test from 'node:test';

import { THEORY_IDS, toggleTheoryChoice } from '../lib/theory.ts';

test('이론 id는 웹과 같은 여섯 가지다', () => {
  assert.deepEqual([...THEORY_IDS], [
    'stanislavski',
    'hagen',
    'meisner',
    'chubbuck',
    'chekhov',
    'none',
  ]);
});

test('같은 칩을 다시 누르면 선택이 풀린다(무응답)', () => {
  assert.equal(toggleTheoryChoice(null, 'meisner'), 'meisner');
  assert.equal(toggleTheoryChoice('meisner', 'meisner'), null);
  assert.equal(toggleTheoryChoice('meisner', 'hagen'), 'hagen');
});

test('모든 이론 id에 두 언어 라벨이 있다', async () => {
  const { default: ko } = await import('../locales/ko.ts');
  const { default: en } = await import('../locales/en.ts');
  for (const id of THEORY_IDS) {
    assert.ok(ko.theory.label[id], `ko 라벨 없음: ${id}`);
    assert.ok(en.theory.label[id], `en 라벨 없음: ${id}`);
  }
});
