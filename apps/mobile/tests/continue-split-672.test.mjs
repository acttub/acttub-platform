import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { groupRowTarget } from '../lib/practice/groups.ts';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/**
 * SOMA-672 — 「대화 이어 가기」와 「다음 테이크 찍기」를 나눈다. 값·규칙은 lib 테스트가 보고, 여기서는
 * 화면이 그 규칙을 쓰는지와 옛 「같은 영상으로 이어하기」 길이 사라졌는지를 원본에서 확인한다.
 */

test('SOMA-672: 묶음 줄은 대화 중이면 그 대화로, 아니면 묶음 상세로 간다', () => {
  assert.deepEqual(groupRowTarget({ root_id: 'root-1', in_progress_practice_id: 'practice-9' }), {
    pathname: '/coach',
    params: { practiceId: 'practice-9' },
  });
  assert.deepEqual(groupRowTarget({ root_id: 'root-1', in_progress_practice_id: null }), {
    pathname: '/practice-group',
    params: { rootId: 'root-1' },
  });
});

test('SOMA-672: 홈 「최근 연습」과 연습 기록 줄에 「대화 중」 배지가 붙고 누르면 대화로 바로 간다', () => {
  // 홈은 새 디자인(pen P1.1)에서 최근 연습 줄을 두지 않는다 — 대화 중인 묶음은 메인 카드가 「대화 이어 가기」로 돌아간다.
  const home = read('app/(tabs)/index.tsx');
  assert.match(home, /continueActionFor\(item\.group\)/);
  assert.match(home, /t\('history\.resumeConversation'\)/);

  const history = read('app/(tabs)/history.tsx');
  assert.match(history, /router\.push\(groupRowTarget\(group\)\)/);
  assert.match(history, /talking: Boolean\(group\.in_progress_practice_id\)/);
  assert.match(history, /row\.talking && [\s\S]{0,200}t\('history\.inConversation'\)/);
  // 길게 눌러 「전체 보기」는 대화 중이어도 묶음 상세로 간다.
  assert.match(history, /label: t\('history\.fullView'\), onPress: \(\) => openGroup\(group\.root_id\)/);

  assert.match(read('locales/ko.ts'), /inConversation: '대화 중'/);
});

test('SOMA-672: 묶음 상세는 대화 중이면 「대화 이어 가기」를 맨 위 주 버튼으로, 아니면 아래에 「다음 테이크 찍기」를 둔다', () => {
  const group = read('app/practice-group.tsx');
  const top = group.indexOf("action.kind === 'resume' && (");
  const rounds = group.indexOf("t('history.roundsTitle')");
  const bottom = group.indexOf("action.kind === 'nextTake' && (");
  assert.ok(top > 0 && rounds > top && bottom > rounds, '대화 이어 가기는 회차 목록 위, 다음 테이크는 아래');
  assert.match(group, /onPress=\{\(\) => resumeConversation\(action\.practiceId\)\}/);
  assert.match(group, /pathname: '\/coach', params: \{ practiceId \}/);

  const ko = read('locales/ko.ts');
  assert.match(ko, /resumeConversation: '대화 이어 가기'/);
  assert.match(ko, /nextTake: '다음 테이크 찍기'/);
});

test('SOMA-672: 지난 노트도 묶음에 열린 테이크가 있으면 「대화 이어 가기」다', () => {
  const detail = read('app/report-detail.tsx');
  assert.match(detail, /\.getPracticeGroup\(rootId\)/);
  assert.match(detail, /pathname: '\/coach', params: \{ practiceId: action\.practiceId \}/);
  assert.match(detail, /continueActionFor\(/);
  assert.match(detail, /continueActionLabel\(action\)/);
  assert.doesNotMatch(detail, /history\.continueCta/);
});

test('SOMA-672: 준비 화면에는 같은 영상 길이 없고 다시 고르기는 늘 보이며 이어하기도 video_id 를 싣는다', () => {
  const upload = read('app/upload.tsx');
  assert.doesNotMatch(upload, /kind === 'same'|kind !== 'same'|start\.sameVideo|continueVideoId|localCopyFor/);
  assert.match(upload, /initialPickedVideo\(Boolean\(plan\.continueFrom\)\)/);
  assert.doesNotMatch(upload, /peekPickedVideo/);
  assert.match(upload, /buildContinueBody\(\{ requestId: 'pending', videoId: resolvedVideoId, scene, blockage \}\)/);
  assert.match(upload, /\{!sample && \(\s*<Pressable style=\{styles\.repick\}/);

  for (const file of ['locales/ko.ts', 'locales/en.ts']) {
    const src = read(file);
    assert.doesNotMatch(src, /sameVideo:|continueNew:|nextPractice:|^\s{4}continueCta: '이어서 연습하기'/m, file);
  }
  assert.doesNotMatch(read('lib/practice/upload-events.ts'), /'same'/);
});

test('SOMA-672: 준비 화면의 촬영 버튼으로 찍으면 그 준비 화면으로 돌아간다 — 이어하기가 새 연습으로 바뀌지 않는다', () => {
  const record = read('app/record-video.tsx');
  const block = record.slice(record.indexOf("if (mode === 'ai') {"), record.indexOf("if (mode === 'plain') {"));
  assert.match(block, /if \(picker\) router\.replace\('\/upload'\);\s*else if \(toUpload\) router\.replace\(\{ pathname: '\/upload'[^;]*;\s*else router\.back\(\);/);
});
