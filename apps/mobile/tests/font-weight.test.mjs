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

// 안드로이드도 iOS 와 같은 굵기 파일을 쓴다 — 한 단계 가볍게 그리던 것(10/29)은 뺐다.
test('안드로이드도 700 이상은 Bold, 600은 SemiBold', () => {
  assert.equal(fontFamilyForWeight('700', 'android'), PRETENDARD_BOLD);
  assert.equal(fontFamilyForWeight('600', 'android'), PRETENDARD_SEMIBOLD);
  assert.equal(fontFamilyForWeight(undefined, 'android'), PRETENDARD_REGULAR);
});
