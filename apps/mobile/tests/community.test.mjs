import assert from 'node:assert/strict';
import test from 'node:test';

import { authorName, bodyPreview, categoryChips, relativeTime } from '../lib/community.ts';

// 익명 번호는 서버가 글 단위로 매겨 alias로 내려준다. 앱이 세면 페이지마다 달라진다.
test('익명 글은 서버가 준 alias를 그대로 쓴다', () => {
  assert.equal(authorName({ nickname: '지윤', alias: '익명3' }, true), '익명3');
  assert.equal(authorName({ nickname: '지윤', alias: '익명3' }, false), '지윤');
});

test('alias가 비면 익명으로 떨어뜨린다', () => {
  assert.equal(authorName({ alias: null }, true), '익명');
  assert.equal(authorName({ alias: '  ' }, true), '익명');
});

// 닉네임을 아직 안 정한 사람도 이름 없이 뜨면 안 된다.
test('닉네임이 없으면 배우로 보여준다', () => {
  assert.equal(authorName({ nickname: null }, false), '배우');
  assert.equal(authorName({}, false), '배우');
});

test('본문 미리보기는 줄바꿈을 눕히고 길면 자른다', () => {
  assert.equal(bodyPreview('첫 줄\n\n둘째 줄'), '첫 줄 둘째 줄');
  assert.equal(bodyPreview('가'.repeat(100), 10), `${'가'.repeat(10)}…`);
  assert.equal(bodyPreview('짧은 글', 10), '짧은 글');
});

// now가 없으면 빈 문자열 — 서버·기기 시각이 어긋나 목록이 흔들리는 걸 막는다.
test('now를 모르면 시간을 그리지 않는다', () => {
  assert.equal(relativeTime('2026-08-01T00:00:00Z', null), '');
});

test('상대 시각을 분·시간·일로 끊어 보여준다', () => {
  const base = Date.parse('2026-08-01T12:00:00Z');
  assert.equal(relativeTime('2026-08-01T11:59:30Z', base), '방금');
  assert.equal(relativeTime('2026-08-01T11:30:00Z', base), '30분 전');
  assert.equal(relativeTime('2026-08-01T09:00:00Z', base), '3시간 전');
  assert.equal(relativeTime('2026-07-30T12:00:00Z', base), '2일 전');
  assert.equal(relativeTime('2026-07-01T12:00:00Z', base), '2026-07-01');
});

// 서버·기기 시계가 어긋나 미래 시각이 와도 음수 분을 보여주면 안 된다.
test('미래 시각은 방금으로 눕힌다', () => {
  const base = Date.parse('2026-08-01T12:00:00Z');
  assert.equal(relativeTime('2026-08-01T12:05:00Z', base), '방금');
});

test('카테고리 칩 맨 앞에는 전체가 온다', () => {
  const chips = categoryChips([
    { slug: 'free', name: '자유' },
    { slug: 'qna', name: '입시 Q&A' },
  ]);
  assert.deepEqual(
    chips.map((c) => c.name),
    ['전체', '자유', '입시 Q&A'],
  );
  assert.equal(chips[0].slug, '');
});
