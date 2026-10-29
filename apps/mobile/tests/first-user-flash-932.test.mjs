import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// SOMA-932 — 첫 사용자가 대본·챌린지 탭에 들어가면 기존 사용자 화면이 먼저 보였다가 첫 화면으로 바뀌었다.
// 무엇을 보일지 정하기 전에는 뼈대만 보인다.
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('대본 탭 — 목록을 받기 전에는 「내 대본」 머리·고품질 목소리 띠·목록 대신 뼈대만 보인다', () => {
  const src = read('app/(tabs)/reading.tsx');
  assert.match(src, /const listPending = list === null && !error;/);
  // 제목·「새 대본」 버튼·목소리 띠는 받은 뒤 대본이 있을 때만.
  assert.match(src, /title=\{empty \|\| listPending \? '' : t\('reading\.listTitle'\)\}/);
  assert.match(src, /\{!empty && !listPending && \(\s*<View ref=\{newTarget\.ref\}/);
  assert.match(src, /\{!empty && !listPending && voiceBar\}/);
  // 몸통은 받기 전 → 뼈대, 비었으면 입구, 아니면 목록 순서로 고른다.
  const pending = src.indexOf('{listPending ? (');
  const entry = src.indexOf(') : empty ? (');
  assert.ok(pending > 0 && entry > pending, '받기 전 뼈대 분기가 빈 입구 분기보다 앞에 있어야 한다');
  // 목록 안쪽의 옛 받는 중 뼈대는 없앤다(이제 위에서 한 번만 그린다).
  assert.doesNotMatch(src, /loading && !list && \(/);
});

test('챌린지 탭 — 첫 고르기를 띄울지 정하고 첫 목록을 받기 전에는 기본 챌린지 홈 대신 뼈대만 보인다', () => {
  const src = read('app/(tabs)/challenges.tsx');
  assert.match(src, /const \[pickDecided, setPickDecided\] = useState\(false\);/);
  assert.match(src, /const \[firstLoadDone, setFirstLoadDone\] = useState\(false\);/);
  assert.match(src, /const deciding = !pickDecided \|\| !firstLoadDone;/);
  // 다시 들어올 때 기록을 새로 따져도(firstPickChecked 가 잠깐 false) 이미 정한 화면을 유지한다.
  assert.match(src, /const selectMode = pickDecided && showGuide/);
  assert.match(src, /\{!selectMode && !deciding && \(/);
  const deciding = src.indexOf('{deciding ? (');
  const select = src.indexOf(') : selectMode && featured ? (');
  assert.ok(deciding > 0 && select > deciding, '정하기 전 뼈대 분기가 첫 고르기 분기보다 앞에 있어야 한다');
});
