import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => readFileSync(path.join(appRoot, relativePath), 'utf8');

// SOMA-822 홈·계정 — pen 「갈아엎기 복사본」 efbe836 기준으로 맞춘 자리를 못박는다.

test('프로필 탭 그리드는 세 칸 줄이고 모자란 칸은 빈 회색 칸, 사진이 없으면 기본 얼굴(S14)', () => {
  const profile = read('app/(tabs)/profile.tsx');
  assert.match(profile, /const PER_ROW = 3;/);
  assert.match(profile, /styles\.cellEmpty/);
  assert.match(profile, /<DefaultAvatar size=\{84\}/);
  assert.match(profile, /name="heart"/);
});

test('프로필 편집은 기본 얼굴을 쓴다(S6.3)', () => {
  assert.match(read('app/profile-edit.tsx'), /<DefaultAvatar size=\{84\}/);
});

test('공용 오류 문구는 pen 표기대로 「다시 시도해 주세요」로 띄어 쓴다', () => {
  const ko = read('locales/ko.ts');
  assert.match(ko, /network: '네트워크 연결을 확인하고 다시 시도해 주세요\.'/);
  const errors = ko.slice(ko.indexOf('  errors: {\n    requestChanged'));
  assert.doesNotMatch(errors.slice(0, errors.indexOf('\n  },')), /다시 시도해주세요/);
});
