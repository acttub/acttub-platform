import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('reading.background: 리딩 중 앱을 내리면 멈춘다(이미 있던 동작을 잠근다, SOMA-670)', () => {
  const play = read('app/reading/play.tsx');
  assert.match(play, /AppState\.addEventListener\('change', \(state\) => \{\s*if \(state !== 'active' && phase\.kind === 'running'\) doPause\(\);/);
});

test('reading.background: 배역 화면 목소리 미리 듣기도 앱을 내리면 멈춘다(SOMA-670)', () => {
  const roles = read('app/reading/roles.tsx');
  assert.match(roles, /AppState\.addEventListener\('change', \(state\) => \{\s*if \(state !== 'active'\) \{\s*previewRun\.current \+= 1;\s*engine\.stop\(\);\s*setPreviewing\(null\);/);
});
