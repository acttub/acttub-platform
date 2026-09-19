import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../lib/api-request.ts';
import {
  CREDIT_KINDS,
  CREDIT_MAX,
  CREDIT_TEXT_MAX,
  INTRO_MAX,
  PHOTO_MAX,
  canAddCredit,
  canAddPhoto,
  creditPatch,
  emptyCreditDraft,
  creditDraftFrom,
  isIntroValid,
  moveItem,
  normalizeIntro,
  orderPayload,
  portfolioFailure,
  validateCreditDraft,
} from '../lib/portfolio.ts';

const now = new Date('2026-09-19T12:00:00+09:00');
const credit = (id, extra = {}) => ({ id, title: `작품 ${id}`, role: '주연', year: 2025, kind: 'film', ...extra });
const portfolio = (extra = {}) => ({
  intro: null,
  credits: [],
  photos: [],
  share: { enabled: false, slug: null, url: null },
  ...extra,
});

test('account.portfolio: 경력 종류의 저장 값은 여섯이고 상한은 계약과 같다', () => {
  assert.deepEqual(CREDIT_KINDS, ['film', 'drama', 'play', 'musical', 'ad', 'other']);
  assert.equal(INTRO_MAX, 2000);
  assert.equal(CREDIT_TEXT_MAX, 100);
  assert.equal(CREDIT_MAX, 50);
  assert.equal(PHOTO_MAX, 10);
});

test('account.portfolio: 소개글은 2,000자까지이고 비우면 null로 지운다', () => {
  assert.equal(isIntroValid('가'.repeat(2000)), true);
  assert.equal(isIntroValid('가'.repeat(2001)), false);
  assert.equal(normalizeIntro('   '), null);
  assert.equal(normalizeIntro(null), null);
  // 여러 줄 글이다. 줄바꿈은 그대로 두고 앞뒤 공백만 뗀다.
  assert.equal(normalizeIntro('  첫 줄\n둘째 줄  '), '첫 줄\n둘째 줄');
});

test('account.portfolio: 경력은 작품명·역할·연도·종류를 모두 채워야 저장된다', () => {
  const draft = { title: ' 작품명 ', role: ' 역할 ', year: '2025', kind: 'drama' };

  assert.deepEqual(validateCreditDraft(draft, now), {
    ok: true,
    payload: { title: '작품명', role: '역할', year: 2025, kind: 'drama' },
  });
  assert.deepEqual(validateCreditDraft(emptyCreditDraft(), now), {
    ok: false,
    errors: { title: 'required', role: 'required', year: 'required', kind: 'required' },
  });
});

test('account.portfolio: 작품명과 역할은 각 100자까지, 연도는 1900년부터 내년까지다', () => {
  const base = { title: '작품', role: '역할', year: '2025', kind: 'film' };
  const errorsOf = (patch) => {
    const result = validateCreditDraft({ ...base, ...patch }, now);
    return result.ok ? {} : result.errors;
  };

  assert.deepEqual(errorsOf({ title: '가'.repeat(100) }), {});
  assert.deepEqual(errorsOf({ title: '가'.repeat(101) }), { title: 'too_long' });
  assert.deepEqual(errorsOf({ role: '가'.repeat(101) }), { role: 'too_long' });
  assert.deepEqual(errorsOf({ year: '1900' }), {});
  assert.deepEqual(errorsOf({ year: '1899' }), { year: 'out_of_range' });
  assert.deepEqual(errorsOf({ year: '2027' }), {}); // 내년
  assert.deepEqual(errorsOf({ year: '2028' }), { year: 'out_of_range' });
  assert.deepEqual(errorsOf({ year: '20x5' }), { year: 'out_of_range' });
  assert.deepEqual(errorsOf({ kind: 'webtoon' }), { kind: 'required' });
});

test('account.portfolio: 경력을 고칠 때는 바뀐 항목만 보낸다', () => {
  const original = credit('a');

  assert.deepEqual(creditDraftFrom(original), {
    title: '작품 a',
    role: '주연',
    year: '2025',
    kind: 'film',
  });
  assert.deepEqual(
    creditPatch(original, { title: '작품 a', role: '조연', year: 2025, kind: 'film' }),
    { role: '조연' },
  );
  assert.deepEqual(
    creditPatch(original, { title: '새 제목', role: '주연', year: 2024, kind: 'play' }),
    { title: '새 제목', year: 2024, kind: 'play' },
  );
  // 바뀐 것이 없으면 요청을 보내지 않는다.
  assert.equal(creditPatch(original, { title: '작품 a', role: '주연', year: 2025, kind: 'film' }), null);
});

test('account.portfolio: 쉰한 번째 경력과 열한 번째 사진은 추가 버튼부터 막는다', () => {
  const credits = Array.from({ length: 50 }, (_, i) => credit(`c${i}`));
  const photos = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, url: `https://cdn.test/${i}.jpg` }));

  assert.equal(canAddCredit(portfolio({ credits: credits.slice(0, 49) })), true);
  assert.equal(canAddCredit(portfolio({ credits })), false);
  assert.equal(canAddPhoto(portfolio({ photos: photos.slice(0, 9) })), true);
  assert.equal(canAddPhoto(portfolio({ photos })), false);
});

test('account.portfolio: 순서를 바꾸면 지금 있는 id를 원하는 순서로 전부 보낸다', () => {
  const items = [credit('a'), credit('b'), credit('c')];

  const movedUp = moveItem(items, 'b', 'up');
  assert.deepEqual(movedUp.map((item) => item.id), ['b', 'a', 'c']);
  assert.deepEqual(orderPayload(movedUp), { ids: ['b', 'a', 'c'] });

  const movedDown = moveItem(items, 'b', 'down');
  assert.deepEqual(orderPayload(movedDown), { ids: ['a', 'c', 'b'] });
  // 원본은 그대로다(서버가 거절하면 되돌릴 수 있게).
  assert.deepEqual(items.map((item) => item.id), ['a', 'b', 'c']);
});

test('account.portfolio: 맨 위를 위로, 맨 아래를 아래로, 없는 id를 옮기면 순서가 그대로라 요청을 보내지 않는다', () => {
  const items = [credit('a'), credit('b'), credit('c')];

  assert.equal(moveItem(items, 'a', 'up'), null);
  assert.equal(moveItem(items, 'c', 'down'), null);
  assert.equal(moveItem(items, 'zzz', 'up'), null);
  assert.equal(moveItem([credit('only')], 'only', 'down'), null);
});

test('account.portfolio: 순서 페이로드에는 빠짐도 중복도 없다', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, url: `u${i}` }));
  let current = items;
  for (const [id, direction] of [['p9', 'up'], ['p0', 'down'], ['p5', 'up'], ['p5', 'up']]) {
    current = moveItem(current, id, direction) ?? current;
  }
  const { ids } = orderPayload(current);

  assert.equal(ids.length, 10);
  assert.deepEqual([...ids].sort(), items.map((item) => item.id).sort());
});

const failure = (status, code, detail = code) => new ApiError(status, 'x', code, detail);

test('account.portfolio: 열한 번째 사진 422와 쉰한 번째 경력 422는 각각 상한 안내다', () => {
  assert.deepEqual(portfolioFailure(failure(422, 'portfolio_photo_limit_exceeded')), {
    kind: 'photo_limit',
    reload: true,
  });
  assert.deepEqual(portfolioFailure(failure(422, 'portfolio_credit_limit_exceeded')), {
    kind: 'credit_limit',
    reload: true,
  });
});

test('account.portfolio: 순서 바꾸기 422 order_mismatch면 목록을 다시 받아 순서를 다시 고르게 한다', () => {
  assert.deepEqual(portfolioFailure(failure(422, 'order_mismatch')), {
    kind: 'order_mismatch',
    reload: true,
  });
});

test('account.portfolio: 이미 지운 경력·사진을 다시 지워 404를 받으면 목록을 다시 받는다', () => {
  assert.deepEqual(portfolioFailure(failure(404, 'portfolio_credit_not_found')), {
    kind: 'gone',
    reload: true,
  });
  assert.deepEqual(portfolioFailure(failure(404, 'portfolio_photo_not_found')), {
    kind: 'gone',
    reload: true,
  });
});

test('account.portfolio: 사진 크기 413과 형식 415는 안전망 오류로 따로 안내하고, 올리기 끝 409는 다시 올리게 한다', () => {
  assert.deepEqual(portfolioFailure(failure(413, 'upload_too_large')), { kind: 'photo_too_large', reload: false });
  assert.deepEqual(portfolioFailure(failure(415, 'unsupported_media_type')), { kind: 'photo_not_image', reload: false });
  for (const code of ['upload_not_found', 'upload_intent_expired', 'upload_size_mismatch']) {
    assert.deepEqual(portfolioFailure(failure(409, code)), { kind: 'upload_again', reload: true }, code);
  }
});

test('account.portfolio: 본문 모양 422(배열)는 앱 버그이고 그 밖의 실패는 다시 시도하게 한다', () => {
  assert.deepEqual(portfolioFailure(failure(422, 'validation_error', [{ loc: ['body', 'year'] }])), {
    kind: 'client_bug',
    reload: false,
  });
  assert.deepEqual(portfolioFailure(failure(500, 'internal_server_error')), { kind: 'retry', reload: false });
  assert.deepEqual(portfolioFailure(new Error('network')), { kind: 'retry', reload: false });
});

test('account.portfolio: 실패 종류와 입력 오류마다 화면에 보일 안내 문구가 두 언어에 있다', async () => {
  const { default: ko } = await import('../locales/ko.ts');
  const { default: en } = await import('../locales/en.ts');
  const kinds = [
    'photo_limit', 'credit_limit', 'order_mismatch', 'gone', 'photo_too_large',
    'photo_not_image', 'upload_again', 'client_bug', 'retry',
  ];

  for (const table of [ko, en]) {
    for (const kind of kinds) assert.ok(table.portfolio.fail[kind]?.length > 0, kind);
    for (const field of ['required', 'too_long', 'out_of_range']) {
      assert.ok(table.portfolio.fieldError[field]?.length > 0, field);
    }
    assert.equal(table.portfolio.kindOptions.length, CREDIT_KINDS.length);
  }
  assert.equal(ko.portfolio.fail.photo_limit, '사진은 10장까지 넣을 수 있어요.');
  assert.equal(ko.portfolio.fail.credit_limit, '경력은 50개까지 넣을 수 있어요.');
});
