import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { stubModules } from './helpers/stub-modules.mjs';

// 기기 종류는 시험마다 바꾼다 — fontStyleFor 는 부를 때마다 Platform.OS 를 읽는다.
globalThis.__platform = { OS: 'ios' };
stubModules({ 'react-native': 'export const Platform = globalThis.__platform;' });
await import('../lib/global-font.ts');
const fontStyleFor = globalThis.__fontStyleFor;

test('글자 굵기에 맞는 Pretendard 파일을 고르고 가짜 볼드는 끈다', () => {
  globalThis.__platform.OS = 'ios';
  assert.deepEqual(fontStyleFor({ fontSize: 14, fontWeight: '700' }), { fontFamily: 'Pretendard-Bold', fontWeight: 'normal' });
  assert.equal(fontStyleFor({ fontWeight: '600' }).fontFamily, 'Pretendard-SemiBold');
  assert.equal(fontStyleFor(undefined).fontFamily, 'Pretendard');
});

test('아이콘 글꼴처럼 패밀리를 직접 정한 글자는 건드리지 않는다', () => {
  globalThis.__platform.OS = 'ios';
  assert.equal(fontStyleFor({ fontFamily: 'Feather' }), null);
  assert.equal(fontStyleFor({ fontFamily: 'Pretendard-Bold' }), null);
});

test('안드로이드도 iOS 와 같은 굵기 파일을 고르고, 이름으로 고른 폰트는 그대로 둔다', () => {
  globalThis.__platform.OS = 'android';
  assert.equal(fontStyleFor({ fontWeight: '700' }).fontFamily, 'Pretendard-Bold');
  assert.deepEqual(fontStyleFor({ fontFamily: 'Pretendard-Bold' }), { includeFontPadding: false });
  assert.equal(fontStyleFor({ fontFamily: 'Feather' }), null);
});

test('안드로이드 Pretendard 글자는 폰트 여백을 빼고, 화면이 정한 값과 아이콘은 그대로 둔다', () => {
  globalThis.__platform.OS = 'android';
  assert.equal(fontStyleFor({ fontSize: 14 }).includeFontPadding, false);
  assert.equal(fontStyleFor({ fontFamily: 'Pretendard' }).includeFontPadding, false);
  assert.equal(fontStyleFor({ includeFontPadding: true }).includeFontPadding, undefined);
  globalThis.__platform.OS = 'ios';
  assert.equal(fontStyleFor({ fontSize: 14 }).includeFontPadding, undefined);
});

// 예전 패치는 RN 0.81 에서 아무 일도 안 했는데 시험은 가짜 Text 로 통과했다. 설치된 RN 이 실제로 이 함수를 부르는지 본다.
test('설치된 RN 의 Text·TextInput 이 등록한 함수를 부른다', () => {
  for (const file of ['Libraries/Text/Text.js', 'Libraries/Components/TextInput/TextInput.js']) {
    const source = readFileSync(new URL(`../node_modules/react-native/${file}`, import.meta.url), 'utf8');
    assert.match(source, /__fontStyleFor/, `${file} 에 patches/react-native+*.patch 가 적용되지 않았다`);
  }
});
