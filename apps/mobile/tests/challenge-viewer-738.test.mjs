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
  assert.match(play, /challenges\.playFail/);
  assert.match(play, /statusChange/);
});

test('SOMA-738: 프로필 챌린지 수는 참여한 서로 다른 챌린지 수다(비공개 포함, 중복 1)', () => {
  assert.equal(participatedChallengeCount([]), 0);
  assert.equal(participatedChallengeCount([{ challenge: { id: 'a' } }]), 1);
  assert.equal(participatedChallengeCount([{ challenge: { id: 'a' } }, { challenge: { id: 'a' } }, { challenge: { id: 'b' } }]), 2);
  assert.match(read('app/(tabs)/profile.tsx'), /participatedChallengeCount\(all\)/);
});
