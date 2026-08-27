import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXIT_REVIEW_MAX_LENGTH,
  anonymousUserHash,
  buildOneLinerPayload,
  exitReviewCopy,
  sendableOneLiner,
  shouldOfferExitReview,
} from '../lib/exit-review-policy.ts';

test('SOMA-433: 한 번 물어본 사람에겐 다시 띄우지 않는다', () => {
  assert.equal(shouldOfferExitReview(false), true);
  assert.equal(shouldOfferExitReview(true), false);
});

test('SOMA-433: 문구는 불쌍하게, 버튼만 나가기/마치기로 갈린다', () => {
  const leave = exitReviewCopy('leave');
  const finish = exitReviewCopy('finish');
  assert.equal(leave.title, '잠깐만요… 한 줄만 부탁드려요 🥲');
  assert.match(leave.subtitle, /개발에 정말 큰 도움이 돼요 ㅠㅠ/);
  assert.equal(leave.submit, '한 줄 남기고 나가기');
  assert.equal(finish.submit, '한 줄 남기고 마치기');
  assert.equal(leave.skip, '다음에 할게요');
  assert.equal(finish.title, leave.title);
  // 1회 = 제출 1회(2026-08-27 정정) — 보낸 뒤에만 다시 안 묻는다고 안내한다.
  assert.match(leave.notice, /보내주시면 다시 안 여쭤봐요/);
});

test('SOMA-433: 빈 칸·공백은 보낼 수 없고, 앞뒤 공백은 잘라 보낸다', () => {
  assert.equal(sendableOneLiner(''), null);
  assert.equal(sendableOneLiner('   '), null);
  assert.equal(sendableOneLiner('  질문이 날카로웠어요  '), '질문이 날카로웠어요');
});

test('SOMA-433: 최대 길이를 넘기면 잘라 보낸다', () => {
  const long = '가'.repeat(EXIT_REVIEW_MAX_LENGTH + 20);
  assert.equal(sendableOneLiner(long)?.length, EXIT_REVIEW_MAX_LENGTH);
});

test('SOMA-433: 사용자 해시는 안정적이고 원문(UUID·이메일)이 드러나지 않는다', () => {
  const a = anonymousUserHash('1fb9c834-ab53-4a5b-9113-3227e54d72e7');
  assert.equal(a, anonymousUserHash('1fb9c834-ab53-4a5b-9113-3227e54d72e7'));
  assert.notEqual(a, anonymousUserHash('c2432808-e2fc-4ab0-9073-d06a0608048b'));
  assert.ok(!a.includes('1fb9c834'));
  assert.match(a, /^[0-9a-f]{8,16}$/);
  assert.equal(anonymousUserHash(null), '');
});

test('SOMA-433: 시트로 보내는 페이로드는 계약 키만 담고 개인정보는 없다', () => {
  const payload = buildOneLinerPayload({
    text: ' 답을 어디까지 써야 할지 몰랐어요 ',
    platform: 'ios',
    appVersion: '0.0.5 (22)',
    screen: 'coach',
    sessionId: 'session-1',
    userId: 'user-uuid',
  });
  assert.deepEqual(Object.keys(payload).sort(), [
    'app_version', 'contact_email', 'contact_phone', 'kind', 'platform', 'screen', 'session_id', 'text', 'user_hash',
  ]);
  assert.equal(payload.kind, 'app_oneliner');
  assert.equal(payload.text, '답을 어디까지 써야 할지 몰랐어요');
  assert.equal(payload.user_hash, anonymousUserHash('user-uuid'));
  assert.equal(JSON.stringify(payload).includes('user-uuid'), false);
});

test('SOMA-433: 빈 한줄평으로는 페이로드를 만들지 않는다', () => {
  assert.equal(
    buildOneLinerPayload({ text: '  ', platform: 'ios', appVersion: '', screen: 'report', sessionId: null, userId: null }),
    null,
  );
});

test('연락처: 비워도 한줄평은 전송된다 — contact 는 null 로 실린다', async () => {
  const { buildOneLinerPayload } = await import('../lib/exit-review-policy.ts');
  const p = buildOneLinerPayload({
    text: '좋았어요',
    platform: 'ios',
    appVersion: '0.0.5',
    screen: 'coach',
    sessionId: 's1',
    userId: 'u1',
  });
  assert.equal(p.contact_email, null);
  assert.equal(p.contact_phone, null);
  assert.equal(p.text, '좋았어요');
});

test('연락처: 적으면 다듬어서 싣고, 공백뿐이면 null', async () => {
  const { buildOneLinerPayload, sendableContact, CONTACT_MAX_LENGTH } = await import(
    '../lib/exit-review-policy.ts'
  );
  const p = buildOneLinerPayload({
    text: '좋았어요',
    platform: 'ios',
    appVersion: '0.0.5',
    screen: 'coach',
    sessionId: 's1',
    userId: 'u1',
    contactEmail: '  a@b.com  ',
    contactPhone: '   ',
  });
  assert.equal(p.contact_email, 'a@b.com');
  assert.equal(p.contact_phone, null);
  assert.equal(sendableContact('x'.repeat(200))?.length, CONTACT_MAX_LENGTH);
  assert.equal(sendableContact(undefined), null);
});
