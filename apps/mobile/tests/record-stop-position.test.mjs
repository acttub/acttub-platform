import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../app/record-video.tsx', import.meta.url), 'utf8');

test('record: 녹화를 시작해도 정지 버튼이 내려가지 않게 안내 글과 용도 줄 자리를 비워 두지 않는다(SOMA-737)', () => {
  assert.doesNotMatch(src, /\{!recording && <Text style=\{styles\.hint\}>/);
  assert.match(src, /styles\.hint, recording && !recordScript && styles\.hiddenKeepSpace/);
  assert.doesNotMatch(src, /const showPicker = picker && !recording/);
  assert.match(src, /const slider = picker \?/);
  assert.match(src, /hiddenKeepSpace: \{ opacity: 0 \}/);
});
