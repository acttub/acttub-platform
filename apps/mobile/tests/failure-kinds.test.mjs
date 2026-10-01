import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CLASSIFIERS, classifyAll } from './helpers/failure-inputs.mjs';

// 챌린지·코치·연습 시작의 실패 분류와 그 화면 문구를 오류 모양마다 글자 그대로 고정한다.
// 파일마다 따로 있던 code·status·오프라인 판정을 공용 요청 계층으로 모을 때 결과가 하나도 바뀌지 않았음을 이 표가 증명한다.
const expected = JSON.parse(readFileSync(new URL('./fixtures/failure-kinds.json', import.meta.url), 'utf8'));

test('실패 분류표는 모든 분류 함수를 덮는다', () => {
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(CLASSIFIERS).sort());
});

const actual = classifyAll();
for (const name of Object.keys(expected)) {
  test(`${name}: 오류 모양마다 분류·문구가 고정표와 같다`, () => {
    assert.deepEqual(actual[name], expected[name]);
  });
}
