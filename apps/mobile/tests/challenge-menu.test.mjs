import assert from 'node:assert/strict';
import test from 'node:test';

import { detailHeader, playMenuItems } from '../lib/challenge/menu.ts';

test('챌린지 상세 머리: 남의 챌린지는 ⋯ 메뉴에 공유·신고하기', () => {
  assert.deepEqual(detailHeader({ is_host: false, entry_count: 3 }), { kind: 'menu', items: ['share', 'report'] });
});

test('챌린지 상세 머리: 내가 열고 참여작이 없으면 공유·챌린지 지우기', () => {
  assert.deepEqual(detailHeader({ is_host: true, entry_count: 0 }), { kind: 'menu', items: ['share', 'delete'] });
});

test('챌린지 상세 머리: 내가 열고 참여작이 있으면 공유 아이콘 하나', () => {
  assert.deepEqual(detailHeader({ is_host: true, entry_count: 2 }), { kind: 'share' });
});

test('챌린지 상세 머리: 불러오기 전이면 비운다', () => {
  assert.deepEqual(detailHeader(null), { kind: 'none' });
});

const other = { is_mine: false, author: { user_id: 'u2' } };

test('재생 ⋯: 남의 참여작·남의 대사면 영상 신고·대사 신고·차단', () => {
  assert.deepEqual(playMenuItems({ entry: other, challenge: { is_host: false }, myId: 'u1' }), [
    'report_entry',
    'report_challenge',
    'block',
  ]);
});

test('재생 ⋯: 내가 연 대사면 대사 신고를 빼고, 내 참여작이면 신고·차단이 없다', () => {
  assert.deepEqual(playMenuItems({ entry: other, challenge: { is_host: true }, myId: 'u1' }), ['report_entry', 'block']);
  assert.deepEqual(
    playMenuItems({ entry: { is_mine: true, author: { user_id: 'u1' } }, challenge: { is_host: false }, myId: 'u1' }),
    ['report_challenge'],
  );
  assert.deepEqual(
    playMenuItems({ entry: { is_mine: true, author: { user_id: 'u1' } }, challenge: { is_host: true }, myId: 'u1' }),
    [],
  );
});

test('재생 ⋯: 작성자 id 가 없으면(탈퇴) 차단을 두지 않는다', () => {
  assert.deepEqual(playMenuItems({ entry: { author: { user_id: null } }, challenge: null, myId: 'u1' }), ['report_entry']);
});
