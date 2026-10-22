import assert from 'node:assert/strict';
import test from 'node:test';

import { showMarketingNotice, subscribeMarketingNotice } from '../lib/marketing-notice.ts';

const notice = { title: 't', sender: 'Acttub', date: '2026.10.21', rows: [], message: 'm' };

test('account.consent: 처리 결과는 듣고 있는 자리에만 가고, 그만 들으면 받지 않는다', () => {
  const got = [];
  const stop = subscribeMarketingNotice((n) => got.push(n));
  showMarketingNotice(notice);
  stop();
  showMarketingNotice(notice);
  assert.deepEqual(got, [notice]);
});
