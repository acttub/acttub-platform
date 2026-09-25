import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const readSource = (relativePath) => readFileSync(path.join(appRoot, relativePath), 'utf8');

/**
 * 코치의 기억 화면 (SOMA-360).
 *
 * 이 화면은 **틀린 기억을 되돌릴 수 있는 유일한 자리**다. 코치가 연습마다 여기에
 * 쌓고 다음 연습에서 그걸 읽으므로, 화면이 없거나 고칠 수 없으면 잘못 적힌 내용이
 * 이후 모든 대화의 전제로 굳는다.
 *
 * 그래서 "볼 수 있다 · 근거를 안다 · 고칠 수 있다 · 지울 수 있다" 네 가지를
 * 소스 수준에서 못박는다.
 */

test('설정에서 기억 화면으로 들어가는 길이 있다', () => {
  const source = readSource('app/settings.tsx');

  assert.match(source, /router\.push\('\/memory'\)/);
});

test('practice.memory: 연습에서 나온 네 칸만 보여주고 성별·나이는 없다', () => {
  const source = readSource('app/memory.tsx');

  assert.match(source, /MEMORY_FIELDS/);
  for (const field of ['gender', 'age']) {
    assert.doesNotMatch(source, new RegExp(`'${field}'`), `${field} 칸이 남아 있다`);
  }
  assert.doesNotMatch(readSource('lib/api.ts'), /ACTOR_ONLY_MEMORY_FIELDS/);
});

test('practice.memory: 성별·나이 자리에는 프로필 안내와 링크가 있다', () => {
  const source = readSource('app/memory.tsx');

  assert.match(source, /profileNotice\(\)/);
  assert.match(source, /memory\.openProfile/);
  assert.match(source, /'\/profile-edit'/);
  assert.match(readSource('locales/ko.ts'), /성별·나이는 프로필에서 적어요/);
});

test('practice.memory: 내가 적은 값은 그렇게 표시하고 코치가 덮지 않는다', () => {
  const source = readSource('app/memory.tsx');

  assert.match(source, /isWrittenByActor/);
  assert.match(source, /memory\.writtenByMe/);
  assert.match(source, /memory\.tagCoach/);
  assert.match(readSource('locales/ko.ts'), /내가 적은 값/);
  assert.match(readSource('locales/ko.ts'), /코치가 적음/);
});

test('practice.memory: 코치가 적은 칸은 근거가 된 회차로 갈 수 있다(숨겨졌으면 링크 없음)', () => {
  const source = readSource('app/memory.tsx');

  assert.match(source, /source_practice_id/);
  assert.match(source, /practiceId/); // 노트 화면이 받는 이름
});

test('고치는 내용이 코치에게 우선한다고 화면에 적혀 있다', () => {
  const source = readSource('app/memory.tsx');

  assert.match(source, /memory\.introBold/);
  assert.match(readSource('locales/ko.ts'), /고친 내용은 코치가 다시/);
});

test('칸 하나씩도, 전부도 지울 수 있다', () => {
  const source = readSource('app/memory.tsx');

  assert.match(source, /deleteActorMemory/);
  assert.match(source, /deleteAllActorMemory/);
});

test('지우기는 되돌릴 수 없다고 알리고 확인을 받는다', () => {
  const source = readSource('app/memory.tsx');

  assert.match(source, /confirm\(/);
  assert.match(source, /destructive: true/);
  assert.match(source, /memory\.deleteAllMsg/);
  assert.match(readSource('locales/ko.ts'), /되돌릴 수 없어요/);
});

test('기억이 하나도 없을 때 빈 화면을 설명한다', () => {
  // 대부분의 배우가 처음엔 여기다.
  const source = readSource('app/memory.tsx');

  assert.match(source, /memory\.emptyTitle/);
  assert.match(readSource('locales/ko.ts'), /아직 적힌 게 없어요/);
});

test('API client 가 기억 통로 넷을 모두 연다', () => {
  const source = readSource('lib/api.ts');

  assert.match(source, /actorMemory\(\)/);
  assert.match(source, /saveActorMemory\(/);
  assert.match(source, /deleteActorMemory\(/);
  assert.match(source, /deleteAllActorMemory\(/);
});

test('practice.memory: 저장 길이 상한이 서버와 같다(1,000자)', () => {
  // 서버가 1,000자에서 거부한다. 화면에서 미리 막지 않으면 저장 순간에야 실패한다.
  const source = readSource('app/memory.tsx');

  assert.match(source, /maxLength=\{MEMORY_VALUE_MAX\}/);
  assert.match(source, /memoryValueTooLong/);
  assert.match(readSource('lib/practice/memory.ts'), /MEMORY_VALUE_MAX = 1_000/);
});
