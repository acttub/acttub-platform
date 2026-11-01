import assert from 'node:assert/strict';
import test from 'node:test';

import { isWordless } from '../lib/reading/line-coverage.ts';

test('SOMA-962: 말줄임표·줄표·괄호 지문뿐인 줄은 소리 낼 글자가 없는 쉬는 줄이다', () => {
  for (const text of ['...', '……', '…', '—', '- -', '(한숨) ...', '(고개를 돌린다)', '', '  ', '?!']) {
    assert.equal(isWordless(text), true, text);
  }
});

test('SOMA-962: 글자·숫자·낱자모가 하나라도 있으면 대사다', () => {
  for (const text of ['네...', '...응', '(웃으며) 그래.', 'ㅋㅋㅋ', '3...', 'Hi...']) {
    assert.equal(isWordless(text), false, text);
  }
});
