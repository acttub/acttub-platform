import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => readFileSync(path.join(appRoot, relativePath), 'utf8');

// SOMA-822 홈·계정 — pen 「갈아엎기 복사본」 efbe836 기준으로 맞춘 자리를 못박는다.

test('공용 오류 문구는 pen 표기대로 「다시 시도해 주세요」로 띄어 쓴다', () => {
  const ko = read('locales/ko.ts');
  assert.match(ko, /network: '네트워크 연결을 확인하고 다시 시도해 주세요\.'/);
  const errors = ko.slice(ko.indexOf('  errors: {\n    requestChanged'));
  assert.doesNotMatch(errors.slice(0, errors.indexOf('\n  },')), /다시 시도해주세요/);
});
