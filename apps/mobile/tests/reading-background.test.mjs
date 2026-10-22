import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// 리딩 실행 화면은 배경에서도 이어 간다(SOMA-802) — tests/screens/reading/play.test.tsx 가 지킨다.

test('reading.background: 배역 화면 목소리 미리 듣기도 앱을 내리면 멈춘다(SOMA-670)', () => {
  const roles = read('app/reading/roles.tsx');
  assert.match(roles, /AppState\.addEventListener\('change', \(state\) => \{\s*if \(state !== 'active'\) \{\s*previewRun\.current \+= 1;\s*engine\.stop\(\);\s*setPreviewing\(null\);/);
});
