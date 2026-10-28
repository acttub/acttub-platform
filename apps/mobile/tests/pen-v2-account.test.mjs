import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => readFileSync(path.join(appRoot, relativePath), 'utf8');

// SOMA-822 홈·계정 — pen 「갈아엎기 복사본」 efbe836 기준으로 맞춘 자리를 못박는다.

test('동의 제목 24, 모두 동의 상자는 흰 바탕·1px 테두리(SOMA-923)', () => {
  const consent = read('app/consent.tsx');
  assert.match(consent, /title: \{ marginTop: 8, fontSize: 24,/);
  assert.match(consent, /borderWidth: 1,\n    borderColor: palette\.border,\n    backgroundColor: palette\.bg,/);
});

test('회원 탈퇴 묶음은 윗선 · 위 16 안쪽, 제목 21/900(S17.1)', () => {
  const del = read('app/delete-account.tsx');
  assert.match(del, /title: \{ fontSize: 21, fontWeight: '900'/);
  assert.match(del, /borderTopColor: palette\.borderSoft/);
});

test('웹 연습 가져오기 완료는 가운데 96 동그라미와 아래 버튼(S7.7)', () => {
  const transfer = read('app/guest-transfer.tsx');
  assert.match(transfer, /width: 96,\n    height: 96,/);
  assert.match(transfer, /<TextButton size="large" label=\{t\('guestTransfer\.another'\)\}/);
});

test('공용 오류 문구는 pen 표기대로 「다시 시도해 주세요」로 띄어 쓴다', () => {
  const ko = read('locales/ko.ts');
  assert.match(ko, /network: '네트워크 연결을 확인하고 다시 시도해 주세요\.'/);
  const errors = ko.slice(ko.indexOf('  errors: {\n    requestChanged'));
  assert.doesNotMatch(errors.slice(0, errors.indexOf('\n  },')), /다시 시도해주세요/);
});
