import assert from 'node:assert/strict';
import test from 'node:test';

import { storeUrlFor } from '../lib/update-required.ts';

test('공통 규칙: 업데이트 안내의 스토어 주소는 안드로이드면 패키지 이름으로, iOS면 설정된 App Store 주소로 연다', () => {
  assert.equal(
    storeUrlFor({ platform: 'android', androidPackage: 'com.acttub.app', iosAppStoreUrl: '' }),
    'https://play.google.com/store/apps/details?id=com.acttub.app',
  );
  assert.equal(
    storeUrlFor({
      platform: 'ios',
      androidPackage: 'com.acttub.app',
      iosAppStoreUrl: 'https://apps.apple.com/app/id0000000000',
    }),
    'https://apps.apple.com/app/id0000000000',
  );
});

test('공통 규칙: 열 주소를 모르면 버튼 없이 안내 문장만 보인다', () => {
  assert.equal(
    storeUrlFor({ platform: 'ios', androidPackage: 'com.acttub.app', iosAppStoreUrl: '' }),
    null,
  );
  assert.equal(
    storeUrlFor({ platform: 'android', androidPackage: undefined, iosAppStoreUrl: '' }),
    null,
  );
  assert.equal(
    storeUrlFor({ platform: 'web', androidPackage: 'com.acttub.app', iosAppStoreUrl: 'x' }),
    null,
  );
});
