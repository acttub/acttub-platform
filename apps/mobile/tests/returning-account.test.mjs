import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RETURNING_MIN_PRACTICES,
  skipsChallengeFirstPick,
  skipsFirstReadingGuide,
  skipsHomeGuide,
  skipsReadingTabGuide,
} from '../lib/returning-account.ts';

test('홈 — 첫 연습 직후에는 안내를 띄우고, 연습이 쌓인 계정은 건너뛴다', () => {
  assert.equal(skipsHomeGuide(0), false);
  assert.equal(skipsHomeGuide(1), false);
  assert.equal(skipsHomeGuide(RETURNING_MIN_PRACTICES - 1), false);
  assert.equal(skipsHomeGuide(RETURNING_MIN_PRACTICES), true);
  assert.equal(skipsHomeGuide(62), true);
});

test('리딩 탭 — 올린 대본이 있으면 「대본을 넣어 보세요」를 건너뛴다', () => {
  assert.equal(skipsReadingTabGuide(0), false);
  assert.equal(skipsReadingTabGuide(1), true);
  assert.equal(skipsReadingTabGuide(16), true);
});

test('리딩 버튼 안내 — 이어 읽는 회차나 다른 대본을 읽어 본 계정은 첫 리딩이 아니다', () => {
  const fresh = { id: 's1', last_practiced_at: '2026-10-26T02:00:00Z' };
  assert.equal(skipsFirstReadingGuide({ resumed: true, scriptId: 's1', scripts: null }), true);
  // 지금 대본만 회차가 있다(방금 시작) — 첫 리딩이다.
  assert.equal(skipsFirstReadingGuide({ resumed: false, scriptId: 's1', scripts: [fresh] }), false);
  assert.equal(
    skipsFirstReadingGuide({ resumed: false, scriptId: 's1', scripts: [fresh, { id: 's2', last_practiced_at: null }] }),
    false,
  );
  assert.equal(
    skipsFirstReadingGuide({ resumed: false, scriptId: 's1', scripts: [fresh, { id: 's2', last_practiced_at: '2026-10-16T02:00:00Z' }] }),
    true,
  );
  // 목록을 못 읽으면 회차만 본다.
  assert.equal(skipsFirstReadingGuide({ resumed: false, scriptId: 's1', scripts: null }), false);
});

test('챌린지 첫 고르기 — 참여작이 있거나 연습이 쌓인 계정은 건너뛴다', () => {
  assert.equal(skipsChallengeFirstPick({ entryCount: 0, countedPracticeCount: 0 }), false);
  assert.equal(skipsChallengeFirstPick({ entryCount: 0, countedPracticeCount: RETURNING_MIN_PRACTICES - 1 }), false);
  assert.equal(skipsChallengeFirstPick({ entryCount: 1, countedPracticeCount: 0 }), true);
  assert.equal(skipsChallengeFirstPick({ entryCount: 0, countedPracticeCount: RETURNING_MIN_PRACTICES }), true);
});
