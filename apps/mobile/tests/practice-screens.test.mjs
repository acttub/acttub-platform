import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

/**
 * 화면 배선 잠그기(practice.start · practice.resume · practice.analyze). 화면은 네이티브라 node 로
 * 못 돌리므로, 요구사항이 화면에 건 조건만 원본에서 확인한다. 값·규칙은 lib/practice 의 테스트가 본다.
 */

test('practice.start: 새 연습은 보관함의 영상으로 시작하고 준비 화면은 올리지 않는다', () => {
  const upload = read('app/upload.tsx');
  assert.match(upload, /api\.createPractice/);
  assert.match(upload, /api\.continuePractice/);
  // 올리기는 보관함 큐가 한다 — 옛 업로드 자리 받기·마무리는 없다.
  assert.equal(/\/v2\/uploads\/intents|createUploadIntent|completeUpload/.test(upload), false);
});

test('practice.start: 이론 선택은 1.0.0에서 뺐다', () => {
  assert.equal(/theory/i.test(read('app/upload.tsx')), false);
  assert.equal(/theory: \{/.test(read('locales/ko.ts')), false);
  assert.equal(/theory: \{/.test(read('locales/en.ts')), false);
});

test('practice.start: 진행 중 회차가 있으면(409) 그 회차로 돌려보낸다', () => {
  const upload = read('app/upload.tsx');
  assert.match(upload, /inProgressPracticeId/);
  assert.match(upload, /listPracticeGroups/);
  assert.match(upload, /pathname: '\/analyzing', params: \{ practiceId: open \}/);
});

test('practice.resume: 장면 미리 채움은 방금 끝낸 노트에서만 한다', () => {
  assert.match(read('app/report.tsx'), /setContinueOrigin\(\{\s*kind: 'note'/);
  // A1.2 지난 기록은 같은 영상으로 이어가고 장면은 채우지 않는다.
  assert.match(read('app/report-detail.tsx'), /kind: 'history'/);
  assert.equal(/kind: 'note'/.test(read('app/report-detail.tsx')), false);
  assert.equal(/kind: 'note'/.test(read('app/(tabs)/history.tsx')), false);
});

test('practice.analyze: 앱은 회차 상태를 4초마다 읽고 완료 푸시도 듣는다', () => {
  const analyzing = read('app/analyzing.tsx');
  assert.match(analyzing, /watchAnalysis/);
  assert.match(analyzing, /api\.getPracticeStatus/);
  assert.match(analyzing, /onPushReceived/);
  assert.match(analyzing, /analysisPushTarget/);
  assert.match(read('lib/practice/analysis-run.ts'), /PRACTICE_POLL_INTERVAL_MS = 4_000/);
});

test('practice.analyze: "그만두기"는 취소이고 옛 "분석 포기 = 숨김"은 없앴다', () => {
  const analyzing = read('app/analyzing.tsx');
  assert.match(analyzing, /cancelAnalysis/);
  assert.match(analyzing, /api\.cancelPractice/);
  // 연습을 지우거나 숨기지 않는다.
  assert.equal(/deletePracticeSession|abandonAnalysis/.test(analyzing), false);
});

test('practice.analyze: 화면을 떠나면 조회만 멈추고 돌아오면 다시 읽는다', () => {
  const analyzing = read('app/analyzing.tsx');
  assert.match(analyzing, /useFocusEffect/);
  assert.match(analyzing, /controllerRef\.current\?\.abort\(\)/);
  assert.match(analyzing, /AppState\.addEventListener/);
});
