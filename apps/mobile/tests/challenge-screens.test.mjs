import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

/**
 * 화면 배선 잠그기(challenge.create · challenge.browse). 값·규칙은 lib/challenge 의 테스트가 보고,
 * 여기서는 요구사항이 화면에 건 조건만 원본에서 확인한다.
 */

test('challenge.browse: 목업과 예시 데이터를 걷어내고 서버에서 읽는다', () => {
  assert.equal(existsSync(path.join(appRoot, 'lib/challenge-mock.ts')), false);
  for (const screen of [
    'app/(tabs)/challenges.tsx',
    'app/challenge-detail.tsx',
    'app/line-search.tsx',
    'app/challenge-play.tsx',
    'app/saved-videos.tsx',
  ]) {
    assert.doesNotMatch(read(screen), /challenge-mock/, `${screen} 가 아직 목업을 읽는다`);
  }
  assert.match(read('app/(tabs)/challenges.tsx'), /api\.listChallenges/);
  assert.match(read('app/challenge-detail.tsx'), /api\.listChallengeEntries/);
});

test('challenge.browse: 대사 목록은 네 탭이고 오늘의 챌린지는 인기·최신에만 고정한다', () => {
  const list = read('app/(tabs)/challenges.tsx');

  for (const tab of ['popular', 'latest', 'ended', 'mine']) {
    assert.match(list, new RegExp(`'${tab}'`), `${tab} 탭이 없다`);
  }
  assert.match(list, /pinsFeatured\(next\) \? result\.featured : null/);
  assert.match(list, /challenges\.featuredLabel/);
});

test('challenge.browse: 카드에 참여작 수·좋아요 합·참여자 셋과 첫 글자 아바타가 있다', () => {
  const list = read('app/(tabs)/challenges.tsx');

  assert.match(list, /challenges\.entryCount/);
  assert.match(list, /challenges\.likeSum/);
  assert.match(list, /participantsLabel/);
  assert.match(list, /avatarLetter/);
  // 사진은 쓰지 않는다 — 챌린지에는 이름만 보인다.
  assert.doesNotMatch(list, /photo/);
});

test('challenge.browse: 시작 안내는 기기당 한 번이고 좋아요 랭킹이 점수가 아님을 말한다', () => {
  assert.match(read('app/(tabs)/challenges.tsx'), /hasSeenChallengeIntro/);
  assert.match(read('app/(tabs)/challenges.tsx'), /markChallengeIntroSeen/);
  assert.match(read('lib/challenge/intro-state.ts'), /acttub\.challenge\.introSeen/);
  assert.match(read('locales/ko.ts'), /점수를 매기지 않아요/);
  // 넘기는 방향은 위아래다.
  assert.match(read('locales/ko.ts'), /위아래로/);
});

test('challenge.browse: 검색은 두 글자 이상이고 결과가 없으면 직접 등록으로 잇는다', () => {
  const search = read('app/line-search.tsx');

  assert.match(search, /searchable\(query\)/);
  assert.match(search, /lineSearch\.registerCta/);
  assert.match(search, /pathname: '\/line-new', params: \{ line: query\.trim\(\) \}/);
});

test('challenge.create: 등록은 세 단계이고 기간은 7·14일, 요청 id 로 멱등하다', () => {
  const create = read('app/line-new.tsx');

  assert.match(create, /CHALLENGE_DURATIONS/);
  assert.match(create, /attemptFor/);
  assert.match(create, /api\.createChallenge/);
  assert.match(create, /newRequestId/);
  // 세 단계: 대사 → 작품·인물·메모 → 기간
  assert.match(create, /step === 0/);
  assert.match(create, /step === 1/);
  assert.match(create, /step === 2/);
  assert.match(create, /lineNew\.noteLabel/);
});

test('challenge.create: 중복·기간·하루 한도 오류를 각각 문구로 알린다', () => {
  assert.match(read('app/line-new.tsx'), /createFailureMessage/);
  for (const key of ['errDuplicate', 'errDuration', 'errDailyLimit']) {
    assert.match(read('locales/ko.ts'), new RegExp(key));
    assert.match(read('locales/en.ts'), new RegExp(key));
  }
});

test('challenge.browse: 상세는 좋아요순·최신순을 고르고 종료·검토 상태를 알린다', () => {
  const detail = read('app/challenge-detail.tsx');

  assert.match(detail, /rankEntries/);
  assert.match(detail, /ranksHidden/);
  assert.match(detail, /rankingNotice/);
  assert.match(detail, /moderationNotice/);
  assert.match(detail, /firstBadgeLabel/);
  assert.match(detail, /hostLabel/);
  assert.match(detail, /challenges\.newBadge/);
});

test('challenge.create: 참여작이 없는 자기 챌린지만 상세에서 지울 수 있다', () => {
  const detail = read('app/challenge-detail.tsx');

  assert.match(detail, /canDelete\(challenge\)/);
  assert.match(detail, /api\.deleteChallenge/);
  assert.match(detail, /challenges\.deleteHasEntries/);
});

test('challenge.browse: 챌린지 탭은 한국어 회원에게만 열리고 게스트는 안내를 본다', () => {
  assert.match(read('app/(tabs)/_layout.tsx'), /isKorean\(\)/);
  assert.match(read('app/(tabs)/challenges.tsx'), /browseFailureMessage/);
  assert.match(read('locales/ko.ts'), /한국어로 쓰는 회원만/);
});
