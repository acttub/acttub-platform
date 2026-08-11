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
  const source = readSource('app/(tabs)/settings.tsx');

  assert.match(source, /router\.push\('\/memory'\)/);
});

test('여섯 칸을 모두 보여준다', () => {
  const source = readSource('app/memory.tsx');

  for (const field of [
    'gender',
    'age',
    'goal',
    'blockage',
    'speech_self',
    'speech_actual',
  ]) {
    assert.match(source, new RegExp(`field: '${field}'`), `${field} 칸이 없다`);
  }
});

test('성별·나이는 배우만 쓰는 칸으로 다룬다', () => {
  // 코치는 영상이나 말투에서 짐작하지 않는다. 데이터베이스가 코치의 쓰기를 막고
  // 있어서, 이 화면이 그 칸을 채우는 유일한 통로다.
  assert.match(readSource('lib/api.ts'), /ACTOR_ONLY_MEMORY_FIELDS/);
  assert.match(readSource('app/memory.tsx'), /내가 적는 칸/);
  assert.match(readSource('app/memory.tsx'), /짐작하지 않아요/);
});

test('칸마다 누가 적었는지 구분해 보여준다', () => {
  // 내가 고친 칸은 코치가 덮지 않는다는 걸 알아야 고치는 의미가 생긴다.
  const source = readSource('app/memory.tsx');

  assert.match(source, /edited_by_me/);
  assert.match(source, /내가 적음/);
  assert.match(source, /코치가 적음/);
});

test('코치가 적은 칸은 근거가 된 연습으로 갈 수 있다', () => {
  // "이게 왜 이렇게 적혔지" 를 볼 수 있어야 고칠지 판단이 선다.
  const source = readSource('app/memory.tsx');

  assert.match(source, /source_practice_session_id/);
  assert.match(source, /practiceSessionId/); // report-detail 이 받는 이름
});

test('고치는 내용이 코치에게 우선한다고 화면에 적혀 있다', () => {
  const source = readSource('app/memory.tsx');

  assert.match(source, /고친 내용은 코치가 다시/);
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
  assert.match(source, /되돌릴 수 없어요/);
});

test('기억이 하나도 없을 때 빈 화면을 설명한다', () => {
  // 대부분의 배우가 처음엔 여기다.
  const source = readSource('app/memory.tsx');

  assert.match(source, /아직 적힌 게 없어요/);
});

test('API client 가 기억 통로 넷을 모두 연다', () => {
  const source = readSource('lib/api.ts');

  assert.match(source, /actorMemory\(\)/);
  assert.match(source, /saveActorMemory\(/);
  assert.match(source, /deleteActorMemory\(/);
  assert.match(source, /deleteAllActorMemory\(/);
});

test('저장 길이 상한이 서버와 같다', () => {
  // 서버가 1000자에서 거부한다. 화면에서 미리 막지 않으면 저장 순간에야 실패한다.
  const source = readSource('app/memory.tsx');

  assert.match(source, /maxLength=\{1000\}/);
});
