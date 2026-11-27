import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

/**
 * 커뮤니티 탭·배우 게시판(SOMA-873) 배선 잠그기. 값·규칙은 tests/community.test.mjs, 그림과 동작은 tests/screens/community-*.test.tsx 가 본다.
 */

test('커뮤니티는 독립 탭(community, users 아이콘)이고 챌린지 탭은 예전 라우트(challenges)에 트로피 아이콘이다(SOMA-1120)', () => {
  const layout = read('app/(tabs)/_layout.tsx');
  assert.match(layout, /name="community"/);
  assert.match(layout, /tabIcon\(\{ feather: 'users' \}, t\('tabs\.community'\)/);
  assert.match(layout, /name="challenges" options=\{\{ \.\.\.tab\('challenge'\).*tabIcon\('trophy-outline', t\('tabs\.challenge'\)\)/);
});

test('커뮤니티 탭은 맨 위 「오디션·입시」 입구 아래 게시판이고, 챌린지 탭에는 게시판 전환이 없다(SOMA-1121)', () => {
  const community = read('app/(tabs)/community.tsx');
  assert.match(community, /<CommunityBoard/);
  assert.match(community, /top=\{<DeadlinePreview \/>\}/);
  const challenges = read('app/(tabs)/challenges.tsx');
  assert.doesNotMatch(challenges, /CommunityTabs|CommunityBoard/);
});

test('게시판 화면들은 서버 /v2/community 를 읽고 아래 시트를 쓰지 않는다', () => {
  const api = read('lib/api.ts');
  for (const route of ['/v2/community/categories', '/v2/community/posts', '/v2/community/comments/', '/v2/community/reports', '/v2/community/blocks', '/v2/community/images']) {
    assert.ok(api.includes(route), `${route} 가 없다`);
  }
  for (const file of ['components/community/community-board.tsx', 'app/community-post.tsx', 'app/community-new.tsx', 'components/community/post-images.tsx']) {
    const src = read(file);
    assert.doesNotMatch(src, /BottomSheet|presentation: 'formSheet'/, `${file} 에 아래 시트가 있다`);
  }
});

test('게시판 공지는 분류 칩(전체) 위에 둔다', () => {
  const board = read('components/community/community-board.tsx');
  assert.ok(board.indexOf('ph-label="community_rules"') < board.indexOf('categoryChips(categories)'));
});

test('목록 행에는 좋아요 수를 두지 않는다(좋아요는 글 상세에만)', () => {
  const board = read('components/community/community-board.tsx');
  assert.doesNotMatch(board, /like_count|heart/);
});

test('게시판 광고는 서버에 이미 있는 community_list_top 칸을 목록 아래 얇은 배너(320×50)로 쓴다', () => {
  const board = read('components/community/community-board.tsx');
  assert.match(board, /<AdSlot slot="community_list_top" anchored style=\{styles\.adBanner\} \/>/);
  // 광고는 FlatList 뒤(목록 아래, 탭바 위)에 둔다
  assert.ok(board.indexOf('<AdSlot slot="community_list_top"') > board.indexOf('<FlatList'));
  assert.match(read('lib/ads.ts'), /community_list_top: \{ size: 'BANNER'/);
});

test('게시판 행동마다 기록 이벤트를 남긴다', () => {
  const src = ['components/community/community-board.tsx', 'app/community-post.tsx', 'app/community-new.tsx', 'hooks/use-community-images.ts', 'components/community/post-images.tsx'].map(read).join('\n');
  for (const name of ['community_board_open', 'community_post_open', 'community_post_create', 'community_comment_create', 'community_report', 'community_block', 'community_image_add', 'community_image_view']) {
    assert.ok(src.includes(`'${name}'`), `${name} 이벤트가 없다`);
  }
});

test('게시판 사진은 포트폴리오 사진과 같은 줄이기 모듈로 긴 변 1600 JPEG 로 줄이고 여러 장 한 번에 고른다', () => {
  const picker = read('lib/community-image-picker.ts');
  assert.match(picker, /require\('react-native-compressor'\)/);
  assert.match(picker, /allowsMultipleSelection: true/);
  assert.match(picker, /requestMediaLibraryPermissionsAsync/);
  assert.match(read('app/community-new.tsx'), /Linking\.openSettings\(\)/);
});
