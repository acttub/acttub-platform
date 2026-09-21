import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

/**
 * 화면 배선 잠그기(practice.coach · note · library · feedback). 값·규칙은 lib/practice 의 테스트가
 * 보고, 여기서는 요구사항이 화면에 건 조건만 원본에서 확인한다.
 */

test('practice.coach: 대화는 요청 id 와 revision 을 싣고 충돌이면 입력을 보존한 채 다시 읽는다', () => {
  const coach = read('app/coach.tsx');

  assert.match(coach, /api\.startConversation/);
  assert.match(coach, /api\.replyToCoach/);
  assert.match(coach, /buildReplyBody/);
  assert.match(coach, /newRequestId/);
  assert.match(coach, /failure\.kind === 'conflict'/);
  assert.match(coach, /api\.getConversation/);
  // 충돌 처리에서 입력을 비우지 않는다 — 비우는 것은 성공했을 때뿐이다.
  const conflictBlock = coach.slice(coach.indexOf('} catch (e) {', coach.indexOf('const sendText')));
  assert.doesNotMatch(conflictBlock.slice(0, 600), /setInput\(''\)/);
});

test('practice.coach: 닫힌 대화는 답할 수 없고 새 회차로 이어 간다', () => {
  const coach = read('app/coach.tsx');

  assert.match(coach, /setContinueOrigin\(\{ kind: 'group'/);
  assert.match(coach, /coach\.continueNew/);
  assert.match(coach, /isClosed/);
});

test('practice.coach: 도움 버튼은 입력만 준비한다 — 누르는 것으로 전송되지 않는다', () => {
  const coach = read('app/coach.tsx');
  const block = coach.slice(coach.indexOf('const pressHelp'), coach.indexOf('const latestQuestion'));

  assert.match(block, /helpButtonDraft/);
  assert.match(block, /setInput\(draft\)/);
  assert.doesNotMatch(block, /replyToCoach|sendText/);
});

test('practice.note: 노트 화면은 새 노트 계약을 읽고 확인을 강제하던 옛 카피가 없다', () => {
  const report = read('app/report.tsx');

  assert.match(report, /api\.getPracticeNote/);
  assert.match(report, /noteSections/);
  assert.match(report, /noteKindLabel/);
  assert.match(report, /noteFallbackNotice/);
  // "분석 확정 · 배우님과 맞춘 내용"처럼 확인·비교를 강제하는 카피는 없앴다.
  assert.doesNotMatch(report, /report\.confirmed/);
  assert.doesNotMatch(read('locales/ko.ts'), /분석 확정 · 배우님과 맞춘 내용/);
});

test('practice.note: "다음 연습"은 방금 끝낸 회차의 장면을 미리 채운다', () => {
  const report = read('app/report.tsx');

  assert.match(report, /setContinueOrigin\(\{\s*kind: 'note'/);
  assert.match(report, /scene: practice\.scene/);
});

test('practice.library: 기록은 묶음을 읽고 숨김은 묶음 전체이며 리딩이 섞인다', () => {
  const history = read('app/(tabs)/history.tsx');

  assert.match(history, /api\.listPracticeGroups/);
  assert.match(history, /groupTitle/);
  assert.match(history, /filterGroups/);
  assert.match(history, /patchPracticeGroup\(group\.root_id, \{ hidden: true \}\)/);
  assert.match(history, /hideNotice\(\)/);
  assert.match(history, /mergeHistoryRows/);
  assert.match(history, /readingHistoryRows/);
});

test('practice.library: 홈은 숨기지 않은 묶음 3개와 한국 시간 연속일을 보여 준다', () => {
  const home = read('app/(tabs)/index.tsx');

  assert.match(home, /recentGroups\(groups, PREVIEW_COUNT\)/);
  assert.match(home, /practiceStreak/);
  assert.match(home, /pathname: '\/practice-group'/);
});

test('practice.library: 묶음 상세는 회차 흐름과 이어서 연습하기를 보여 준다', () => {
  const group = read('app/practice-group.tsx');

  assert.match(group, /api\.getPracticeGroup/);
  assert.match(group, /roundSummary/);
  assert.match(group, /history\.continueCta/);
  assert.match(group, /setContinueOrigin/);
  assert.match(group, /kind: 'history'/);
});

test('practice.feedback: 설문은 서버가 선점·접수하고 앱은 시트를 직접 부르지 않는다', () => {
  const hook = read('hooks/use-exit-review.tsx');

  assert.match(hook, /claimFeedbackAsk\(\)/);
  assert.match(hook, /shouldOfferFeedback/);
  assert.match(hook, /practiceFeedback\.send/);
  // 건너뛰기도 본문 없는 행으로 남는다.
  assert.match(hook, /const skip = useCallback/);
  // 옛 Apps Script 직접 전송은 이탈 설문 경로에 없다.
  assert.doesNotMatch(hook, /submitOneLiner|EXIT_REVIEW_ENDPOINT/);
  // 제출을 기다리지 않는다 — 실패해도 나가기를 막지 않는다.
  assert.match(hook, /void practiceFeedback\.send/);
});

test('practice.feedback: 밀린 접수는 게이트를 지난 뒤 다시 보낸다', () => {
  assert.match(read('lib/auth.tsx'), /flushPracticeFeedback/);
});
