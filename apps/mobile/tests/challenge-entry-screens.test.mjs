import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

/**
 * 화면 배선 잠그기(challenge.entry · challenge.browse 피드·조회수). 값·규칙은 lib/challenge 의
 * 테스트가 보고, 여기서는 요구사항이 화면에 건 조건만 원본에서 확인한다.
 */

test('challenge.entry: 올리기는 서버로 참여작을 만들고 공개 범위를 미리 고르지 않는다', () => {
  const upload = read('app/challenge-upload.tsx');

  assert.match(upload, /api\.createEntry/);
  assert.match(upload, /entryAttemptFor/);
  // 공개 범위는 고르기 전까지 비어 있다 — 버튼도 꺼져 있다.
  assert.match(upload, /useState<EntryVisibility \| null>\(null\)/);
  assert.match(upload, /canSubmitEntry/);
  assert.match(upload, /challengeUpload\.pickVisibility/);
});

test('challenge.entry: 공개를 고르면 표본 활용을 한 줄 알린다', () => {
  const upload = read('app/challenge-upload.tsx');

  assert.match(upload, /visibility === 'public' && \(/);
  assert.match(upload, /challengeUpload\.note/);
  assert.match(read('locales/ko.ts'), /AI 리포트 비교에 쓰일 수 있어요/);
});

test('challenge.entry: 캡션은 300자까지이고 완료 문구는 공개·비공개가 다르다', () => {
  const upload = read('app/challenge-upload.tsx');

  assert.match(upload, /maxLength=\{CAPTION_MAX\}/);
  assert.match(upload, /doneCopy\(done\)/);
  assert.match(read('locales/ko.ts'), /무대에 올렸어요/);
  assert.match(read('locales/ko.ts'), /비공개로 저장했어요/);
});

test('challenge.entry: 찍은 영상은 보관함을 거쳐 확정된 뒤 올라간다', () => {
  const upload = read('app/challenge-upload.tsx');

  assert.match(upload, /saveRecordingToLibrary/);
  assert.match(upload, /confirmedVideoFor/);
  assert.match(upload, /challengeUpload\.waitingVideo/);
  // 촬영 화면은 60초 상한과 대사를 띄우고 챌린지 id 를 넘긴다(A18).
  const record = read('app/record-video.tsx');
  assert.match(record, /CHALLENGE_MAX_SEC = 60/);
  assert.match(record, /challengeId: challengeId \?\? ''/);
});

test('challenge.entry: 보관함의 "챌린지에 올리기"는 올릴 대사를 먼저 고른다', () => {
  assert.match(read('app/archive-detail.tsx'), /pickVideoId: state\.video\.id/);
  assert.match(read('app/(tabs)/challenges.tsx'), /pickVideoId/);
  assert.match(read('app/(tabs)/challenges.tsx'), /pathname: '\/challenge-upload'/);
});

test('challenge.browse: 피드는 3초 재생 사건을 보내고 실패해도 재생을 막지 않는다', () => {
  const feed = read('app/challenge-play.tsx');

  assert.match(feed, /createViewTracker/);
  assert.match(feed, /api\.recordEntryView/);
  assert.match(feed, /isOwn: Boolean\(entry\.is_mine\)/);
  assert.match(feed, /VIEW_THRESHOLD_MS/);
  // 보내기를 기다리지 않는다.
  assert.match(feed, /void viewTracker\.onProgress/);
});

test('challenge.browse: 피드는 20개씩 이어 받고 끝에서 안내를 보인다', () => {
  const feed = read('app/challenge-play.tsx');

  assert.match(feed, /next_cursor/);
  assert.match(feed, /loadMore/);
  assert.match(feed, /cursor_expired/);
  assert.match(feed, /challenges\.feedEnd/);
});

test('challenge.browse: P03 은 네 분류로 세고 카드에서 고치거나 지울 수 있다', () => {
  const p03 = read('app/challenge-entries.tsx');

  assert.match(p03, /entryCounts/);
  assert.match(p03, /bucketOf/);
  assert.match(p03, /entryStatusLabel/);
  assert.match(p03, /api\.updateEntry/);
  assert.match(p03, /api\.deleteEntry/);
  assert.match(p03, /canGoPublic/);
  // 지워도 영상은 보관함에 남는다고 말한다.
  assert.match(p03, /deleteNotice\(\)/);
  assert.match(read('locales/ko.ts'), /영상은 보관함에 남아요/);
  // 프로필에서 들어가는 길이 있다.
  assert.match(read('app/(tabs)/profile.tsx'), /'\/challenge-entries'/);
});
