import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatKoreanDate, formatKoreanDateTime } from '../lib/format.ts';

const AT = '2026-07-23T06:45:00Z';

test('날짜를 한국어 형식으로 쓰고, 비었거나 깨진 값은 빈 글자로 둔다', () => {
  assert.equal(formatKoreanDate(AT, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }), '2026년 7월 23일');
  assert.equal(formatKoreanDate(null), '');
  assert.equal(formatKoreanDate('not a date'), '');
  assert.equal(formatKoreanDateTime(undefined), '');
  assert.equal(formatKoreanDateTime('nope'), '');
});

test('날짜와 시각을 함께 쓴다', () => {
  // 오전·오후 표기는 런타임의 ICU 데이터에 따라 'PM' 으로 나오기도 한다.
  assert.match(formatKoreanDateTime(AT), /^2026\. 7\. 23\. (오전|오후|AM|PM) \d{1,2}:45$/);
});

test('기기가 날짜 포맷에 실패하면 ISO 날짜로 대신 쓴다', t => {
  t.mock.method(Date.prototype, 'toLocaleDateString', () => { throw new RangeError('Invalid'); });
  t.mock.method(Date.prototype, 'toLocaleString', () => { throw new RangeError('Invalid'); });
  assert.equal(formatKoreanDate(AT), '2026-07-23');
  assert.equal(formatKoreanDateTime(AT), '2026-07-23 06:45');
});
