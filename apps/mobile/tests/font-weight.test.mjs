import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRETENDARD_BOLD,
  PRETENDARD_REGULAR,
  PRETENDARD_SEMIBOLD,
  fontFamilyForWeight,
} from '../lib/font-weight.ts';

test('F3: 굵기를 지정하지 않으면 Regular', () => {
  assert.equal(fontFamilyForWeight(undefined), PRETENDARD_REGULAR);
  assert.equal(fontFamilyForWeight(null), PRETENDARD_REGULAR);
  assert.equal(fontFamilyForWeight('normal'), PRETENDARD_REGULAR);
  assert.equal(fontFamilyForWeight('400'), PRETENDARD_REGULAR);
  assert.equal(fontFamilyForWeight(500), PRETENDARD_REGULAR);
});

test('F3: 600은 SemiBold, 700 이상은 Bold', () => {
  assert.equal(fontFamilyForWeight('600'), PRETENDARD_SEMIBOLD);
  assert.equal(fontFamilyForWeight(600), PRETENDARD_SEMIBOLD);
  assert.equal(fontFamilyForWeight('700'), PRETENDARD_BOLD);
  assert.equal(fontFamilyForWeight('800'), PRETENDARD_BOLD);
  assert.equal(fontFamilyForWeight('900'), PRETENDARD_BOLD);
  assert.equal(fontFamilyForWeight('bold'), PRETENDARD_BOLD);
});

test('F3: 해석할 수 없는 값은 Regular로 떨어진다', () => {
  assert.equal(fontFamilyForWeight('semibold'), PRETENDARD_REGULAR);
  assert.equal(fontFamilyForWeight({}), PRETENDARD_REGULAR);
});

// 안드로이드는 같은 파일도 더 두껍게 그려져, 굵기를 한 단계 가볍게 고른다(10/29). iOS 는 그대로다.
test('안드로이드: 700 이상은 SemiBold, 600은 Medium, 그 아래는 Regular', async () => {
  const { PRETENDARD_MEDIUM } = await import('../lib/font-weight.ts');
  assert.equal(fontFamilyForWeight('700', 'android'), PRETENDARD_SEMIBOLD);
  assert.equal(fontFamilyForWeight('900', 'android'), PRETENDARD_SEMIBOLD);
  assert.equal(fontFamilyForWeight('bold', 'android'), PRETENDARD_SEMIBOLD);
  assert.equal(fontFamilyForWeight('600', 'android'), PRETENDARD_MEDIUM);
  assert.equal(fontFamilyForWeight(undefined, 'android'), PRETENDARD_REGULAR);
  assert.equal(fontFamilyForWeight('700', 'ios'), PRETENDARD_BOLD);
});

test('안드로이드: 화면이 Pretendard 굵기를 이름으로 직접 고른 것도 한 단계 가볍게 바꾼다', async () => {
  const { androidLighterFamily, PRETENDARD_MEDIUM } = await import('../lib/font-weight.ts');
  assert.equal(androidLighterFamily(PRETENDARD_BOLD), PRETENDARD_SEMIBOLD);
  assert.equal(androidLighterFamily(PRETENDARD_SEMIBOLD), PRETENDARD_MEDIUM);
  assert.equal(androidLighterFamily(PRETENDARD_REGULAR), PRETENDARD_REGULAR);
  assert.equal(androidLighterFamily('Feather'), 'Feather');
});

test('Medium 서브셋을 싣고, 전역 폰트가 안드로이드에서 가볍게 고른다', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  assert.ok(existsSync(new URL('../assets/fonts/Pretendard-Medium.subset.ttf', import.meta.url)));
  assert.match(read('app/_layout.tsx'), /'Pretendard-Medium': require\('@\/assets\/fonts\/Pretendard-Medium\.subset\.ttf'\)/);
  assert.match(read('lib/global-font.ts'), /fontFamilyForWeight\(flattened\.fontWeight, Platform\.OS\)/);
  assert.match(read('lib/global-font.ts'), /androidLighterFamily\(flattened\.fontFamily\)/);
});
