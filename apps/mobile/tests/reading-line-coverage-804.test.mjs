import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ADVANCE_COVERAGE, saidEnough, spokenCoverage } from '../lib/reading/line-coverage.ts';

test('SOMA-804: 글자 수는 띄어쓰기·문장부호·괄호 안 지시·낱자모를 빼고 센다', () => {
  assert.equal(ADVANCE_COVERAGE, 0.9);
  // 원문 10자(괄호 지시 빼고), 말한 글 10자
  assert.equal(spokenCoverage('(웃으며) 나는 정말 몰랐어, 진짜야!', '나는정말 몰랐어 진짜야'), 1);
  assert.equal(spokenCoverage('나는 정말 몰랐어', 'ㅋㅋ 나는'), 2 / 7);
});

test('SOMA-804: 대본 글자 수의 90% 이상 말했을 때만 넘길 만하다', () => {
  // 원문 10자: 9자 말하면 넘기고 8자면 기다린다
  assert.equal(saidEnough('가나다라마바사아자차', '가나다라마바사아자'), true);
  assert.equal(saidEnough('가나다라마바사아자차', '가나다라마바사아'), false);
  assert.equal(saidEnough('가나다라마바사아자차', ''), false);
  // 더 말한 것도 넘긴다
  assert.equal(saidEnough('안녕', '안녕하세요 반가워요'), true);
  // 셀 글자가 없는 줄(괄호 지시뿐)은 막지 않는다
  assert.equal(saidEnough('(한숨)', ''), true);
});

test('SOMA-804: 받아쓰기가 켜진 내 차례는 충분히 말했을 때만 침묵으로 넘긴다', () => {
  const src = readFileSync(new URL('../app/reading/play.tsx', import.meta.url), 'utf8');
  assert.match(src, /if \(sttActive\.current && !sttGaveUp\(\) && !saidEnough\(turnText, saidRef\.current\)\) return;/);
  assert.match(src, /const sttGaveUp = \(\) => sttStopped \|\| stt\.failed\(\) \|\| !saidRef\.current\.trim\(\);/);
});
