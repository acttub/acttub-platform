import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { commentCountAfter, participatedChallengeCount, videoTooShort } from '../lib/challenge/entry.ts';

const read = (rel) => readFileSync(path.join(path.resolve(import.meta.dirname, '..'), rel), 'utf8');

test('SOMA-738: 3초 미만 영상은 참여 업로드 전에 막는다', () => {
  assert.equal(videoTooShort(200), true);
  assert.equal(videoTooShort(2999), true);
  assert.equal(videoTooShort(3000), false);
  assert.match(read('locales/ko.ts'), /3초 이상 촬영해 주세요/);
  assert.match(read('locales/en.ts'), /at least 3 seconds/);
  assert.equal(videoTooShort(null), false);
  assert.match(read('app/challenge-upload.tsx'), /videoTooShort\(recorded\.durationMs\)/);
});

test('SOMA-738: 댓글 수는 쓰면 늘고 지우면 줄며 0 아래로 가지 않는다', () => {
  assert.equal(commentCountAfter(0, 1), 1);
  assert.equal(commentCountAfter(1, -1), 0);
  assert.equal(commentCountAfter(0, -1), 0);
  assert.match(read('components/challenge-comments-sheet.tsx'), /onCountChange\?\.\(1\)/);
  assert.match(read('app/challenge-play.tsx'), /onCountChange=/);
});

test('SOMA-738: 뷰어는 챌린지 id 없이도 열리고, 불러오는 중·실패에도 닫기 버튼이 있다', () => {
  const play = read('app/challenge-play.tsx');
  assert.match(play, /if \(!id && !entryId\) return;/);
  assert.match(play, /api\.getEntry\(entryId\)/);
  assert.match(play, /\(entries === null \|\| !!error\)/);
  assert.match(play, /challenges\.playFailTitle/);
  assert.match(play, /statusChange/);
});

test('SOMA-738: 프로필 챌린지 수는 참여한 서로 다른 챌린지 수다(비공개 포함, 중복 1)', () => {
  assert.equal(participatedChallengeCount([]), 0);
  assert.equal(participatedChallengeCount([{ challenge: { id: 'a' } }]), 1);
  assert.equal(participatedChallengeCount([{ challenge: { id: 'a' } }, { challenge: { id: 'a' } }, { challenge: { id: 'b' } }]), 2);
  // 프로필 탭은 「이번 달 연습」의 챌린지 칸으로 바뀌었다(SOMA-748). 이번 달 연습은 「연습 1회」 기준 하나로 세며
  // 챌린지는 올린 참여작마다 1회다(SOMA-773, tests/practice-counted-773.test.mjs). 위 participatedChallengeCount 는 그대로다.
  assert.match(read('app/(tabs)/profile.tsx'), /monthPracticeCounts\(/);
  assert.match(read('lib/profile-month-stats.ts'), /countedPractices\(input\)/);
});
