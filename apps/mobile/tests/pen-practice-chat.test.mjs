import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// pen 「acttub 앱 파이프라인 반영버전」 ③ 코칭 준비(03-practice)·⑨ 코칭 대화(09-chat)·⑪ 챌린지 완료(10-11) 수치를 잠근다.
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('C9.12·C19 챌린지 완료: 올리기 완료는 ChallengeDone 이고 코칭은 기존 올리기로 잇는다', () => {
  const upload = read('app/challenge-upload.tsx');
  assert.match(upload, /<ChallengeDone/);
  assert.match(upload, /router\.push\('\/upload'\)/);
  assert.doesNotMatch(upload, /reportHint|\/ai-report/);
});
