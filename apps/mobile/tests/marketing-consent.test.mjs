import assert from 'node:assert/strict';
import test from 'node:test';

import {
  entryMarketingDecisions,
  isMarketingConsent,
  marketingDecisionNotice,
  shouldNoticeEntryDecisions,
} from '../lib/marketing-consent.ts';

const AT = new Date(2026, 9, 9, 14, 0); // 2026.10.09 (기기 시간대)

test('account.consent: 광고성 정보 수신 동의는 이메일과 앱 푸시 두 종류다', () => {
  assert.equal(isMarketingConsent('marketing_email'), true);
  assert.equal(isMarketingConsent('marketing_push'), true);
  assert.equal(isMarketingConsent('retention'), false);
  assert.equal(isMarketingConsent(undefined), false);
});

test('account.consent: 처리 결과에는 보내는 곳·날짜·매체별 결과가 담긴다(정보통신망법 제50조 제7항)', () => {
  const notice = marketingDecisionNotice(
    [
      { type: 'marketing_push', decision: 'declined' },
      { type: 'marketing_email', decision: 'granted' },
    ],
    AT,
  );
  assert.equal(notice.title, '광고성 정보 수신 설정을 바꿨어요');
  assert.equal(notice.sender, 'Acttub');
  assert.equal(notice.date, '2026.10.09');
  // 순서는 이메일 → 앱 푸시로 고정한다.
  assert.deepEqual(notice.rows, [
    { channel: '이메일', result: '수신 동의', granted: true },
    { channel: '앱 푸시', result: '수신 거부', granted: false },
  ]);
  assert.equal(notice.message, 'Acttub · 2026.10.09 처리\n이메일: 수신 동의\n앱 푸시: 수신 거부');
});

test('account.consent: 제목은 모두 동의면 「동의했어요」, 모두 거부면 「거부했어요」다(S5.13)', () => {
  const both = (decision) => [
    { type: 'marketing_email', decision },
    { type: 'marketing_push', decision },
  ];
  assert.equal(marketingDecisionNotice(both('granted'), AT).title, '광고성 정보 수신에 동의했어요');
  assert.equal(marketingDecisionNotice(both('declined'), AT).title, '광고성 정보 수신을 거부했어요');
});

test('account.consent: 광고성 문서가 아니면 처리 결과를 띄우지 않는다', () => {
  assert.equal(marketingDecisionNotice([{ type: 'retention', decision: 'granted' }], AT), null);
  assert.equal(marketingDecisionNotice([], AT), null);
});

test('account.consent: 가입·재동의에서 고르지 않은 광고성 문서는 거절로 보고, 하나라도 동의했을 때만 알린다', () => {
  const documents = [
    { id: 'terms-1', type: 'terms' },
    { id: 'email-1', type: 'marketing_email' },
    { id: 'push-1', type: 'marketing_push' },
  ];
  const none = entryMarketingDecisions(documents, new Map([['terms-1', 'granted']]));
  assert.deepEqual(none, [
    { type: 'marketing_email', decision: 'declined' },
    { type: 'marketing_push', decision: 'declined' },
  ]);
  assert.equal(shouldNoticeEntryDecisions(none), false);

  const push = entryMarketingDecisions(documents, new Map([['terms-1', 'granted'], ['push-1', 'granted']]));
  assert.deepEqual(push, [
    { type: 'marketing_email', decision: 'declined' },
    { type: 'marketing_push', decision: 'granted' },
  ]);
  assert.equal(shouldNoticeEntryDecisions(push), true);
});
