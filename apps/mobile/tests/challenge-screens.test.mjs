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
  // pen C4.x: 세 단계(대사 → 작품·인물·메모 → 기간), 서버 필드 work·character·scene_note.
  assert.match(create, /lineNew\.workLabel/);
  assert.match(create, /lineNew\.noteLabel/);
  assert.match(create, /KeyboardLift/);
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

  // 지울 수 있는지는 ⋯ 메뉴 항목을 정하는 detailHeader 가 canDelete 로 가른다(SOMA-887, lib/challenge/menu).
  assert.match(detail, /detailHeader\(challenge\)/);
  assert.match(detail, /api\.deleteChallenge/);
  assert.match(detail, /challenges\.deleteHasEntries/);
});

test('challenge.browse: 챌린지 탭은 앱 언어와 상관없이 회원에게 열리고 게스트는 안내를 본다', async () => {
  const layout = read('app/(tabs)/_layout.tsx');
  assert.doesNotMatch(layout, /isKorean/);
  // 탭 제목·읽어 줄 이름은 tab() 묶음이 t(`tabs.<키>`)로 채운다(SOMA-770).
  assert.match(layout, /name="challenges"\s*options=\{\{\s*\.\.\.tab\('challenge'\)/);
  assert.match(layout, /title: t\(`tabs\.\$\{key\}`\)/);
  assert.match(read('app/(tabs)/challenges.tsx'), /browseFailureMessage/);
  const { default: ko } = await import('../locales/ko.ts');
  const { default: en } = await import('../locales/en.ts');
  assert.equal(ko.challenges.memberOnly, '챌린지는 회원만 이용할 수 있어요.');
  assert.equal(en.challenges.memberOnly, 'Challenges are for members only.');
});
