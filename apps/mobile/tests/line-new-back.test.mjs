import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../app/line-new.tsx', import.meta.url), 'utf8');

test('새 대사 등록: 안드로이드 뒤로 키가 2·3단계에서는 앞 단계로 가고 첫 단계에서만 화면을 닫는다', () => {
  assert.match(src, /BackHandler\.addEventListener\('hardwareBackPress'/);
  assert.match(src, /if \(step === 0\) return false;/);
});
