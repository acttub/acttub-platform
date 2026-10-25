import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { groupPoster, practiceGroupFromResponse } from '../lib/practice/groups.ts';
import {
  PRACTICE_TITLE_MAX,
  buildContinueBody,
  buildStartBody,
  emptyBlockageDraft,
  emptySceneDraft,
  fingerprintOf,
  titleOverflow,
} from '../lib/practice/start.ts';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// SOMA-671: 장면을 안 적으면 기록이 모두 「장면 메모 없이 연습」이라 구분이 안 됐다.

test('practice.title: 새 연습은 다듬은 제목을 싣고, 비우면 title 을 아예 싣지 않는다', () => {
  const base = { requestId: 'r', videoId: 'v', scene: emptySceneDraft, blockage: emptyBlockageDraft };
  assert.equal(buildStartBody({ ...base, title: '  카페 이별 장면 ' }).title, '카페 이별 장면');
  assert.equal('title' in buildStartBody({ ...base, title: '   ' }), false);
  assert.equal('title' in buildStartBody(base), false);
});

test('practice.title: 제목이 바뀌면 다른 요청이다(같은 요청 id 로 다른 본문을 보내지 않는다)', () => {
  const base = { requestId: 'r', videoId: 'v', scene: emptySceneDraft, blockage: emptyBlockageDraft };
  assert.notEqual(fingerprintOf(buildStartBody({ ...base, title: 'A' })), fingerprintOf(buildStartBody({ ...base, title: 'B' })));
  // 이어하기는 묶음 제목을 바꾸지 않는다 — 본문에 제목 칸이 없다.
  assert.equal('title' in buildContinueBody({ requestId: 'r', videoId: 'v', scene: emptySceneDraft, blockage: emptyBlockageDraft }), false);
});

test('practice.title: 200자까지 보내고 201자는 화면이 먼저 막는다', () => {
  assert.equal(PRACTICE_TITLE_MAX, 200);
  assert.equal(titleOverflow('가'.repeat(200)), false);
  assert.equal(titleOverflow('가'.repeat(201)), true);
  assert.equal(titleOverflow(`  ${'가'.repeat(200)}  `), false);
});

const practice = (ordinal, poster_url) => ({
  id: `p${ordinal}`, root_id: 'root', ordinal, video_id: `v${ordinal}`, stage: 'closed', close_reason: null,
  experience_version: 'three_layers_v1', situation: '', character: '', goal: '', blockage_category: '그 외',
  blockage_detail: '그 외', blockage_note: null, created_at: `2026-10-1${ordinal}T00:00:00Z`, conversation_id: null,
  conversation_status: null, conversation_count: 0, note_id: null, note_title: null, note_kind: null,
  previous_conversations: [], poster_url,
});
const groupOf = (practices) => ({
  root_id: 'root', title: null, ordinal_count: practices.length, last_conversation_at: null, tags: [], favorite: false,
  hidden_at: null, in_progress_practice_id: null, practices,
});

test('practice.poster: 묶음 썸네일은 가장 최근 회차 중 사진이 있는 것이고, 캐시 키는 서명을 뗀 주소다', () => {
  const g = practiceGroupFromResponse(groupOf([practice(1, 'https://s3/a.jpg?sig=1'), practice(2, null)]));
  assert.deepEqual(groupPoster(g), { uri: 'https://s3/a.jpg?sig=1', cacheKey: 'https://s3/a.jpg' });
  const latest = practiceGroupFromResponse(groupOf([practice(1, 'https://s3/a.jpg?x'), practice(2, 'https://s3/b.jpg?y')]));
  assert.equal(groupPoster(latest)?.cacheKey, 'https://s3/b.jpg');
  assert.equal(groupPoster(practiceGroupFromResponse(groupOf([practice(1, null)]))), null);
  // 옛 서버(poster_url 없음)도 그대로 읽는다.
  assert.equal(groupPoster(practiceGroupFromResponse(groupOf([practice(1, undefined)]))), null);
});

test('practice.list: 연습 기록 목록은 썸네일이 있으면 사진을, 없으면 원래 아이콘을 보인다(홈 최근 연습 줄은 pen P1.1에서 뺐다)', () => {
  for (const file of ['app/(tabs)/history.tsx']) {
    const src = read(file);
    assert.match(src, /groupPoster\(/, file);
    assert.match(src, /<Image\s+source=\{\{ uri: [a-zA-Z.]+\.uri, cacheKey: [a-zA-Z.]+\.cacheKey \}\}/, file);
  }
});

test('practice.upload: 장면·연습 제목 칸 없음·업로드 중 버튼·처리 중 잠금', () => {
  const src = read('app/upload.tsx');
  // 연습 제목 칸은 없앴다(SOMA-771) — 제목은 연습 기록에서 바꾼다.
  assert.doesNotMatch(src, /t\('upload\.titleLabel'\)/);
  assert.doesNotMatch(src, /buildStartBody\(\{[^}]*title/);
  // 올리는 중이면 버튼 글자가 「업로드 중」이다.
  assert.match(src, /uploading \? t\('upload\.submitUploading'\)/);
  // 시작을 누른 뒤에는 영상 다시 선택·권리 체크가 잠긴다(적을 칸은 SOMA-778 에서 없앴다).
  assert.match(src, /const locked = starting;/);
  assert.doesNotMatch(src, /<TextInput/);
  assert.match(src, /setSourceSheet\(true\); \}\} disabled=\{locked\}/);
  assert.match(src, /accessibilityState=\{\{ checked: agreedRights, disabled: locked \}\}/);
  const ko = read('locales/ko.ts');
  assert.match(ko, /submitUploading: '업로드 중…'/);
});

test('practice.upload: 올리는 중이면 안내도 「올리는 중」이다 — 「영상을 채워주세요」와 겹쳐 말하지 않는다', () => {
  const src = read('app/upload.tsx');
  assert.match(src, /: !sample && uploading\s*\? uploadFailed\s*\? t\('start\.uploadFailed'\)\s*: t\('start\.stillUploading'\)\s*: !sample && !canStart\(videoId\)/);
});

test('practice.history: 연습 기록은 영상 목록처럼 왼쪽에 큰 16:9 사진, 두 줄 제목, 사진 위 회차 배지다', () => {
  const src = read('app/(tabs)/history.tsx');
  assert.match(src, /aspectRatio: 16 \/ 9/);
  assert.match(src, /styles\.rowTitle\} numberOfLines=\{2\}/);
  assert.match(src, /<Text style=\{styles\.thumbBadgeText\}>\{row\.count\}<\/Text>/);
});

test('practice.upload: 질문 받기를 누르면 「보내는 중」 띠가 뜨고 권리 체크가 잠긴다', () => {
  const src = read('app/upload.tsx');
  assert.match(src, /\{locked && \(\s*<View style=\{styles\.sendingBar\}/);
  assert.match(src, /t\('upload\.sending'\)/);
  assert.match(src, /onPress=\{toggleRights\}\s*disabled=\{locked\}/);
  assert.match(read('locales/ko.ts'), /sending: '보내는 중이에요/);
});
