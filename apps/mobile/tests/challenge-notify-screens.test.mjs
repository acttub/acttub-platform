import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

/**
 * 화면 배선 잠그기(challenge.ai-report · challenge.notification). 값·규칙은 lib/challenge 의
 * 테스트가 보고, 여기서는 요구사항이 화면에 건 조건만 원본에서 확인한다.
 */

test('challenge.ai-report: 리포트 화면은 요청·상태·관찰·견주기·한계·제안을 보여 준다', () => {
  const screen = read('app/ai-report.tsx');

  assert.match(screen, /api\.requestAiReport/);
  assert.match(screen, /api\.getAiReport/);
  assert.match(screen, /reportSections/);
  assert.match(screen, /statusMessage/);
  assert.match(screen, /canRequest\(report\)/);
  assert.match(screen, /requestNotice\(report\)/);
});

test('challenge.ai-report: 점수·순위를 매기지 않는다고 화면이 말한다', () => {
  assert.match(read('app/ai-report.tsx'), /aiReport\.notRanking/);

  // 리포트 문구 어디에도 점수·등급·백분위·재능 같은 말이 없다(ADR-005 개정).
  const ko = read('locales/ko.ts');
  const block = ko.slice(ko.indexOf('  aiReport: {'), ko.indexOf('  notifications: {'));
  assert.match(block, /점수나 순위를 매기지 않아요/);
  for (const banned of ['백분위', '등급', '재능', '잘했']) {
    assert.equal(block.includes(banned), false, `${banned} 문구가 들어갔다`);
  }
});

test('challenge.ai-report: 근거 구간은 그 자리부터 다시 볼 수 있다', () => {
  const screen = read('app/ai-report.tsx');

  assert.match(screen, /evidenceStartSeconds/);
  assert.match(screen, /player\.currentTime = /);
  assert.match(screen, /aiReport\.evidencePlay/);
});

test('challenge.ai-report: 같은 요청 id 로 다시 부탁하면 기존 작업이다', () => {
  const screen = read('app/ai-report.tsx');

  assert.match(screen, /requestIdRef\.current = requestIdRef\.current \?\? newRequestId\(\)/);
  // 만드는 중이면 준비될 때까지 다시 읽는다.
  assert.match(screen, /report\?\.status !== 'pending'/);
});

test('challenge.ai-report: 완료 화면과 프로필 기록에서 리포트로 간다', () => {
  assert.match(read('app/challenge-upload.tsx'), /pathname: '\/ai-report'/);
  assert.match(read('app/challenge-entries.tsx'), /pathname: '\/ai-report'/);
});

test('challenge.notification: 알림함은 묶음 목록과 읽음 처리를 한다', () => {
  const screen = read('app/notifications.tsx');

  assert.match(screen, /api\.listNotifications/);
  assert.match(screen, /api\.readNotifications/);
  assert.match(screen, /group_keys: \[group\.group_key\]/);
  assert.match(screen, /all_before/);
  assert.match(screen, /groupLabel/);
  assert.match(screen, /sortGroups/);
});

test('challenge.notification: 묶음을 누르면 대상으로 가고 볼 수 없으면 안내만 한다', () => {
  const screen = read('app/notifications.tsx');

  assert.match(screen, /targetOf\(group\)/);
  assert.match(screen, /unavailableMessage\(\)/);
  assert.match(screen, /pathname: '\/ai-report'/);
  assert.match(screen, /pathname: '\/challenge-play'/);
  assert.match(screen, /pathname: '\/challenge-detail'/);
});

test('challenge.notification: 토글을 꺼도 알림함에 쌓인다고 알린다', () => {
  assert.match(read('app/notifications.tsx'), /toggleOffNotice/);
  assert.match(read('locales/ko.ts'), /여기에는 계속 쌓여요/);
  assert.match(read('locales/ko.ts'), /90일 동안 보관/);
});

test('challenge.notification: 탭 배지는 읽지 않은 묶음 수이고 푸시를 누르면 알림함이 열린다', () => {
  assert.match(read('app/(tabs)/_layout.tsx'), /tabBarBadge: unread\.badge/);
  assert.match(read('hooks/use-unread-notifications.ts'), /unreadNotificationCount\(\)/);
  assert.match(read('hooks/use-unread-notifications.ts'), /badgeText/);
  const root = read('app/_layout.tsx');
  assert.match(root, /onPushTapped/);
  assert.match(root, /challengePushTarget/);
  assert.match(root, /'\/notifications'/);
});
