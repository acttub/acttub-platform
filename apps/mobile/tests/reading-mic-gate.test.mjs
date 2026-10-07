import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

/**
 * 리딩은 녹음이 필수다(SOMA-626). 범위 화면만 마이크를 막으면 회차 상세 「이어서 연습」·완료 화면 「다시 읽기」가
 * 실행 화면으로 바로 들어가 녹음 없이 진행된다 — 실행 화면이 열릴 때 다시 막는다.
 */
test('reading.session: 실행 화면은 마이크 권한이 없으면 목소리 준비로 가지 않고 마이크 안내를 띄운다', () => {
  const play = read('app/reading/play.tsx');
  assert.match(play, /\{ kind: 'need_mic' \}/);
  assert.match(play, /if \(!micOk\) \{\s*setPhase\(\{ kind: 'need_mic' \}\);\s*return;\s*\}/);
});

test('reading.session: 마이크 안내는 설정 열기와 나가기를 주고, 설정에서 켜고 돌아오면 이어서 준비한다', () => {
  const play = read('app/reading/play.tsx');
  const gate = play.slice(play.indexOf("if (phase.kind === 'need_mic')"));
  assert.ok(gate.length > 0);
  assert.match(gate, /t\('reading\.micNeededTitle'\)/);
  assert.match(gate, /Linking\.openSettings\(\)/);
  assert.match(gate, /t\('reading\.exitLeave'\)/);
  assert.match(play, /phase\.kind !== 'need_mic'/);
  assert.match(play, /micPermissionGranted\(\)/);
});

test('reading.session: 「이어서 연습」·「다시 읽기」는 실행 화면으로 들어간다(실행 화면이 막는다)', () => {
  assert.match(read('app/reading/session.tsx'), /router\.push\('\/reading\/play'\)/);
  assert.match(read('app/reading/play.tsx'), /router\.replace\('\/reading\/play'\)/);
});
