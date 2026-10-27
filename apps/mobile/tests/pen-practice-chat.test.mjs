import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// pen 「acttub 앱 파이프라인 반영버전」 ③ 코칭 준비(03-practice)·⑨ 코칭 대화(09-chat)·⑪ 챌린지 완료(10-11) 수치를 잠근다.
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('③ 단계 표시: 동그라미 20 · 번호 13/700 · 이름 14/700 · 사이 줄 18, 간격 10', () => {
  const chrome = read('components/practice-chrome.tsx');
  assert.match(chrome, /stepper: \{ flexDirection: 'row', alignItems: 'center', gap: 10 \}/);
  assert.match(chrome, /stepperLine: \{ width: 18, height: 1, backgroundColor: palette\.border \}/);
  assert.match(chrome, /width: 20,\s*height: 20,\s*borderRadius: 10,/);
  assert.match(chrome, /circleText: \{ fontSize: 13, fontWeight: '700'/);
  assert.match(chrome, /stepperLabel: \{ fontSize: 14, fontWeight: '700', color: palette\.textMeta \}/);
  assert.doesNotMatch(chrome, /stepperLabelOn: \{ fontWeight: '900'/);
});

test('C9.12·C19 챌린지 완료: 올리기 완료는 ChallengeDone 이고 코칭은 기존 올리기로 잇는다', () => {
  const upload = read('app/challenge-upload.tsx');
  assert.match(upload, /<ChallengeDone/);
  assert.match(upload, /router\.push\('\/upload'\)/);
  assert.doesNotMatch(upload, /reportHint|\/ai-report/);
});
