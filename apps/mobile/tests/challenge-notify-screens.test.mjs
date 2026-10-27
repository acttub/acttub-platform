import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

/**
 * 화면 배선 잠그기(challenge.notification). 값·규칙은 lib/challenge 의
 * 테스트가 보고, 여기서는 요구사항이 화면에 건 조건만 원본에서 확인한다.
 */

test('SOMA-820: AI 리포트 화면과 진입이 앱에 없다', () => {
  assert.equal(existsSync(path.join(appRoot, 'app/ai-report.tsx')), false);
  for (const file of ['app/challenge-upload.tsx', 'app/challenge-entries.tsx', 'app/notifications.tsx', 'app/(tabs)/profile.tsx', 'app/challenge-result.tsx']) {
    assert.doesNotMatch(read(file), /\/ai-report|pathname: '\/ai-report'/);
  }
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
  assert.match(screen, /pathname: '\/challenge-play'/);
  assert.match(screen, /pathname: '\/challenge-detail'/);
});

test('challenge.notification: 토글을 꺼도 알림함에 쌓인다고 알린다', () => {
  assert.match(read('app/notifications.tsx'), /toggleOffNotice/);
  assert.match(read('locales/ko.ts'), /여기에는 계속 쌓여요/);
  assert.match(read('locales/ko.ts'), /90일 동안 보관/);
});

test('challenge.notification: 탭 배지는 읽지 않은 묶음 수이고 푸시를 누르면 알림함이 열린다', () => {
  assert.match(read('hooks/use-unread-notifications.ts'), /unreadNotificationCount\(\)/);
  assert.match(read('hooks/use-unread-notifications.ts'), /badgeText/);
  const root = read('app/_layout.tsx');
  assert.match(root, /onPushTapped/);
  assert.match(root, /challengePushTarget/);
  assert.match(root, /'\/notifications'/);
});

test('account.notification: 연습 알림을 누르면 알림이 말한 화면으로, 못 정하면 홈 탭으로 가고 누른 것을 남긴다', () => {
  const root = read('app/_layout.tsx');
  assert.match(root, /reminderOpenEvent\(data\)/);
  assert.match(root, /logEvent\('reminder_open'/);
  assert.match(root, /reminderTarget\(data\)/);
  assert.match(root, /router\.replace\(reminder/);
  const target = read('lib/reminder-target.ts');
  assert.match(target, /evening_reminder/);
  assert.match(target, /return '\/\(tabs\)';/);
});
