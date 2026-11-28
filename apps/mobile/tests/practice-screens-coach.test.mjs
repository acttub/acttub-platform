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

  assert.match(coach, /loadCoachSession/);
  assert.match(coach, /api\.replyToCoach/);
  assert.match(coach, /buildReplyBody/);
  assert.match(coach, /newRequestId/);
  assert.match(coach, /failure\.kind === 'conflict'/);
  assert.match(coach, /reloadConversation/);
  // 충돌 처리에서 입력을 비우지 않는다 — 비우는 것은 성공했을 때뿐이다.
  const conflictBlock = coach.slice(coach.indexOf('} catch (e) {', coach.indexOf('const sendText')));
  assert.doesNotMatch(conflictBlock.slice(0, 600), /setInput\(''\)/);
});

test('practice.coach: 닫힌 대화는 답할 수 없고 「다음 테이크 찍기」로 새 회차를 연다', () => {
  const coach = read('app/coach.tsx');

  assert.match(coach, /setContinueOrigin\(\{ kind: 'group'/);
  assert.match(coach, /history\.nextTake/);
  assert.doesNotMatch(coach, /coach\.continueNew/);
  assert.match(coach, /isClosed/);
});

test('practice.coach: 예시 답 버튼은 입력만 준비한다 — 누르는 것으로 전송되지 않는다', () => {
  const coach = read('app/coach.tsx');
  const block = coach.slice(coach.indexOf('const pressChoice'), coach.indexOf('const latestCoachIndex'));

  assert.match(block, /setInput\(label\)/);
  assert.doesNotMatch(block, /replyToCoach|sendText/);
});

test('practice.note: 지난 노트는 새 노트 계약을 읽고 확인을 강제하던 옛 카피가 없다', () => {
  const detail = read('app/report-detail.tsx');

  assert.match(detail, /readOptionalPracticeNote\(api\.getPracticeNote/);
  // 본문 칸은 공용 컴포넌트가 noteSections 로 그린다.
  assert.match(detail, /<NoteSections note=\{note\} \/>/);
  assert.match(read('components/note-sections.tsx'), /noteSections\(note\)/);
  // "분석 확정 · 배우님과 맞춘 내용"처럼 확인·비교를 강제하는 카피는 없앴다.
  assert.doesNotMatch(read('locales/ko.ts'), /분석 확정 · 배우님과 맞춘 내용/);
});

test('practice.library: 기록은 묶음을 읽고 숨김은 묶음 전체이며 대본 리딩은 섞지 않는다', () => {
  const history = read('app/(tabs)/history.tsx');

  assert.match(history, /api\.listPracticeGroups/);
  assert.match(history, /groupTitle/);
  assert.match(history, /filterGroups/);
  assert.match(history, /patchPracticeGroup\(group\.root_id, \{ hidden: true \}\)/);
  assert.match(history, /t\('history\.hideNotice'\)/);
  // 기록은 AI 코치와 한 연습만이다 — 리딩 기록은 대본 탭에서 본다(SOMA-494).
  assert.doesNotMatch(history, /readingHistoryRows|listSessions/);
});

test('practice.library: 홈은 한국 시간 연속일과 이번 주 요일 점을 보여 준다(최근 연습 줄은 pen P1.1에서 뺐다)', () => {
  const home = read('app/(tabs)/index.tsx');

  assert.match(home, /practiceStreak/);
  assert.match(home, /buildRecentActivity/);
  assert.doesNotMatch(home, /recentGroups\(/);
});

test('practice.library: 묶음 상세는 회차 흐름과 「대화 이어 가기」·「다음 테이크 찍기」 중 하나를 보여 준다', () => {
  const group = read('app/practice-group.tsx');

  assert.match(group, /api\.getPracticeGroup/);
  assert.match(group, /roundSummary/);
  assert.match(group, /continueActionFor\(group\)/);
  assert.match(group, /continueActionLabel\(/);
  assert.match(group, /setContinueOrigin\(\{ kind: 'group'/);
  assert.doesNotMatch(group, /history\.continueCta|kind: 'history'/);
});

// 한줄평·이탈 설문은 SOMA-494에서 걷고 앱 평가 요청으로 바꿨다 — 코치 화면은 나갈 때 붙잡지 않는다.
test('액티는 나갈 때 설문을 띄우지 않고, 일지를 마치면 앱 평가를 묻는다', () => {
  assert.doesNotMatch(read('app/coach.tsx'), /useExitReview|exitReview/);
  assert.match(read('app/journal.tsx'), /rating\.after\(\{ kind: 'coach', practiceId \}/);
  assert.match(read('app/reading/play.tsx'), /askRating\(\{ kind: 'reading' \}\)/);
  assert.doesNotMatch(read('app/(tabs)/index.tsx'), /feedbackNudge|useFeedbackSheet/);
  assert.match(read('app/settings.tsx'), /openStoreReviewPage/);
});

test('practice.feedback: 밀린 접수는 게이트를 지난 뒤 다시 보낸다', () => {
  assert.match(read('lib/auth.tsx'), /flushPracticeFeedback/);
});
