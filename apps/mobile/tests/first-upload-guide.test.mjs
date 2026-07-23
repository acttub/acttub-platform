import assert from 'node:assert/strict';
import test from 'node:test';

import {
  firstUploadGuideSeenKey,
  markFirstUploadGuideSeen,
  shouldShowFirstUploadGuide,
} from '../lib/first-upload-guide-state.ts';

test('W6: first upload guide seen key는 계정별로 구분된다', () => {
  const first = firstUploadGuideSeenKey('user-1');
  const second = firstUploadGuideSeenKey('user-2');

  assert.notEqual(first, second);
  assert.match(first, /user-1/);
  assert.match(second, /user-2/);
});

test('W6: AsyncStorage getItem rejection은 unhandled 없이 guide 표시로 결정된다', async () => {
  const storage = {
    getItem: async () => {
      throw new Error('storage unavailable');
    },
    setItem: async () => {},
  };

  assert.equal(await shouldShowFirstUploadGuide(storage, 'user-1'), true);
});

test('W6: AsyncStorage setItem rejection은 unhandled 없이 false 결과로 관찰된다', async () => {
  const storage = {
    getItem: async () => null,
    setItem: async () => {
      throw new Error('disk full');
    },
  };

  assert.equal(await markFirstUploadGuideSeen(storage, 'user-1'), false);
});
