import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

/**
 * 화면 배선 잠그기(challenge.react · challenge.block · challenge.report). 값·규칙은
 * lib/challenge 의 테스트가 보고, 여기서는 요구사항이 화면에 건 조건만 원본에서 확인한다.
 */

test('challenge.react: 좋아요는 먼저 표시를 바꾸고 실패하면 되돌려 알린다', () => {
  const feed = read('app/challenge-play.tsx');

  assert.match(feed, /optimisticLike/);
  assert.match(feed, /api\.likeEntry/);
  // 실패하면 누르기 전 값으로 되돌린다.
  assert.match(feed, /patchEntry\(entry\.id, \{ liked: before\.liked, like_count: before\.likeCount \}\)/);
  assert.match(feed, /reactFailureMessage/);
});

test('challenge.react: 자기 참여작에는 좋아요·저장 버튼이 눌리지 않는다', () => {
  const feed = read('app/challenge-play.tsx');

  assert.match(feed, /canReact\(item\)/);
  assert.match(feed, /disabled=\{!canTouch\}/);
  assert.match(feed, /api\.saveEntry/);
});

test('challenge.react: 댓글은 서버에서 읽고 500자·본인 삭제·확인 중 표시를 지킨다', () => {
  const sheet = read('components/challenge-comments-sheet.tsx');

  assert.match(sheet, /api\.listComments/);
  assert.match(sheet, /api\.createComment/);
  assert.match(sheet, /api\.deleteComment/);
  assert.match(sheet, /maxLength=\{COMMENT_MAX\}/);
  assert.match(sheet, /canDeleteComment/);
  assert.match(sheet, /commentText\(item\)/);
  assert.match(sheet, /commentAuthorName/);
  // 같은 댓글의 재전송은 같은 요청 id 다.
  assert.match(sheet, /commentAttemptFor/);
  // 댓글 좋아요·답글은 1.0.0에 없다 — 하트 토글이 목록에 없다.
  assert.doesNotMatch(sheet, /name="heart"/);
});

test('challenge.report: 신고 시트는 사유 다섯과 기타 메모를 받는다', () => {
  const sheet = read('components/challenge-report-sheet.tsx');

  assert.match(sheet, /REPORT_REASONS\.map/);
  assert.match(sheet, /needsNote\(reason\)/);
  assert.match(sheet, /maxLength=\{REPORT_NOTE_MAX\}/);
  assert.match(read('locales/ko.ts'), /중복 업로드/);
  // 사유는 요구사항의 다섯이다.
  assert.doesNotMatch(read('lib/challenge/types.ts'), /'sexual'|'violence'/);
});

test('challenge.report: 참여작·댓글·챌린지를 각각 신고할 수 있다', () => {
  const feed = read('app/challenge-play.tsx');

  assert.match(feed, /type: 'entry'/);
  assert.match(feed, /type: 'comment'/);
  assert.match(feed, /type: 'challenge'/);
  assert.match(feed, /api\.createReport/);
  // 대사 상세에도 챌린지 신고가 있다.
  assert.match(read('app/challenge-detail.tsx'), /target="challenge"/);
});

test('challenge.block: 차단하면 그 사람의 참여작이 화면에서 바로 사라진다', () => {
  const feed = read('app/challenge-play.tsx');

  assert.match(feed, /api\.blockUser/);
  assert.match(feed, /removeAuthored/);
  assert.match(feed, /canBlock/);
  assert.match(feed, /react\.blockBody/);
  // 상대에게 알리지 않는다는 것을 문구가 말한다.
  assert.match(read('locales/ko.ts'), /상대에게는 알리지 않아요/);
});

test('challenge.block: 설정에서 차단 목록을 보고 풀 수 있다', () => {
  const screen = read('app/blocked-users.tsx');

  assert.match(screen, /api\.listBlocks/);
  assert.match(screen, /api\.blockUser\(user\.user_id, false\)/);
  assert.match(screen, /avatarLetter/);
  assert.match(read('app/settings.tsx'), /'\/blocked-users'/);
});

test('challenge.react: 저장한 영상에서 저장을 풀 수 있다', () => {
  const screen = read('app/saved-videos.tsx');

  assert.match(screen, /api\.saveEntry\(entry\.id, false\)/);
  assert.match(screen, /api\.listSavedEntries/);
});

test('challenge.react: 공유는 참여작 딥링크이고 볼 수 없으면 안내만 한다', () => {
  assert.match(read('app/challenge-play.tsx'), /entryShareUrl\(entry\.id\)/);
  const link = read('app/entry/[id].tsx');
  assert.match(link, /\.getEntry\(id\)/);
  assert.match(link, /react\.linkGone/);
  assert.match(link, /pathname: '\/challenge-play'/);
});
