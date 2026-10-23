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

test('practice.start: 이론 선택은 0.1.0에서 뺐다', () => {
  assert.equal(/theory/i.test(read('app/upload.tsx')), false);
  assert.equal(/theory: \{/.test(read('locales/ko.ts')), false);
  assert.equal(/theory: \{/.test(read('locales/en.ts')), false);
});

test('practice.start: 진행 중 회차가 있으면(409) 그 회차로 돌려보낸다', () => {
  const upload = read('app/upload.tsx');
  assert.match(upload, /inProgressPracticeId/);
  assert.match(upload, /listPracticeGroups/);
  assert.match(upload, /pathname: '\/coach', params: \{ practiceId: open \}/);
});

test('practice.resume: 장면 미리 채움은 방금 끝낸 노트에서만 한다', () => {
  assert.match(read('app/report.tsx'), /setContinueOrigin\(\{\s*kind: 'note'/);
  // A12 지난 노트는 장면을 채우지 않고, 같은 영상으로 잇는 출처('history')는 없다(SOMA-672).
  assert.match(read('app/report-detail.tsx'), /kind: 'group'/);
  for (const file of ['app/report-detail.tsx', 'app/practice-group.tsx', 'lib/practice/resume.ts']) {
    assert.equal(/kind: 'history'/.test(read(file)), false, file);
  }
  assert.equal(/kind: 'note'/.test(read('app/report-detail.tsx')), false);
  assert.equal(/kind: 'note'/.test(read('app/(tabs)/history.tsx')), false);
});

// 분석 대기는 따로 된 화면이 아니라 코치 화면 안의 「영상 보는 중」이다(SOMA-778). 조회·푸시·취소·복귀는 components/coach-waiting.tsx 가 한다.
const waiting = () => read('components/coach-waiting.tsx');

test('practice.analyze: 앱은 회차 상태를 4초마다 읽고 완료 푸시도 듣는다', () => {
  assert.match(waiting(), /watchAnalysis/);
  assert.match(waiting(), /api\.getPracticeStatus/);
  assert.match(waiting(), /onPushReceived/);
  assert.match(waiting(), /analysisPushTarget/);
  assert.match(read('lib/practice/analysis-run.ts'), /PRACTICE_POLL_INTERVAL_MS = 4_000/);
  // 코치 화면이 회차 id 를 받으면 대화 전에 이 대기부터 한다.
  assert.match(read('app/coach.tsx'), /<CoachWaiting/);
});

test('practice.analyze: "그만두기"는 취소이고 옛 "분석 포기 = 숨김"은 없앴다', () => {
  assert.match(waiting(), /cancelAnalysis/);
  assert.match(waiting(), /api\.cancelPractice/);
  // 연습을 지우거나 숨기지 않는다.
  assert.equal(/deletePracticeSession|abandonAnalysis/.test(waiting()), false);
});

test('practice.analyze: 화면을 떠나면 조회만 멈추고 돌아오면 다시 읽는다', () => {
  assert.match(waiting(), /useFocusEffect/);
  assert.match(waiting(), /controllerRef\.current\?\.abort\(\)/);
  assert.match(waiting(), /AppState\.addEventListener/);
});

test('practice.analyze: 옛 분석 화면 주소(/analyzing)는 액티 화면으로 넘기기만 한다', () => {
  const analyzing = read('app/analyzing.tsx');
  assert.match(analyzing, /<Redirect href=\{\{ pathname: '\/coach'/);
  assert.equal(/watchAnalysis|api\./.test(analyzing), false);
});

test('practice.note: 방금 끝난 노트와 지난 노트 둘 다 평가를 받고 서버에 저장한다(시트로 보내지 않는다)', () => {
  for (const screen of ['app/report.tsx', 'app/report-detail.tsx']) {
    const source = read(screen);
    assert.match(source, /<ReportRating\s+practiceId=\{[^}]+\}\s+initial=\{note\.my_rating\}/, screen);
  }
  const rating = read('components/report-rating.tsx');
  assert.match(rating, /noteRatings\.send/);
  assert.equal(/submitOneLiner|oneLinerPayload|report_inline/.test(rating), false);
  assert.equal(/report_inline/.test(read('lib/exit-review.ts')), false);
  // 문구는 그대로다 — 유저에게 "평가"라는 말을 쓰지 않는다.
  for (const key of ['rateTitle', 'rateGood', 'rateBad', 'ratePh', 'rateSend', 'rateThanks']) {
    assert.match(rating, new RegExp(`report\\.${key}`));
  }
  assert.equal(/평가|점수/.test(read('locales/ko.ts').match(/rateTitle[\s\S]*?rateThanks[^\n]*/)[0]), false);
  // 밀린 평가는 게이트를 지나면 다시 보낸다.
  assert.match(read('lib/auth.tsx'), /flushNoteRatings\(\)/);
});
