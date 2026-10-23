import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { helpButtonDraft } from '../lib/practice/coach.ts';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('새 연습 준비(P3.1): 장면 정보 단계(상황·인물·원하는 것)는 없고(SOMA-778) 「이전 연습 이어서 하기」도 없다', () => {
  const upload = read('app/upload.tsx');
  // SOMA-748 이 되살렸던 장면 칸을 SOMA-778 에서 다시 뺐다 — 목적 → 영상 두 단계이고 장면 없이 시작한다.
  assert.doesNotMatch(upload, /\['situation', 'character', 'goal'\] as const|upload\.scene\.|setScene\(|<TextInput/);
  const ko = read('locales/ko.ts');
  assert.doesNotMatch(ko, /situationLabel: '상황'|goalLabel: '원하는 것'/);
  // 노트·리딩에서 넘겨받은 장면만 화면 없이 그대로 보낸다 — 넘친 값은 화면이 먼저 막는다.
  assert.match(upload, /const scene = plan\.scene;/);
  assert.match(upload, /sceneOverflow\(scene\)/);
  assert.doesNotMatch(upload, /start\.continueCta|chooseGroup/);
  // 세부 칩은 없다 — 세부는 비워 보내고 서버 기본값(그 외)이 된다
  assert.doesNotMatch(upload, /blockage\.kindLabel|EXPRESSION_DETAILS|ANALYSIS_DETAILS/);
  // 큰 갈래는 세션 목적 단계의 세 줄로 고른다(SOMA-748) — 평가 받기·막힌 곳 풀기·인물 이해하기가 기존 갈래로 간다.
  assert.match(upload, /upload\.purpose\./);
  assert.match(upload, /blockageCategoryFor\(next\)/);
  // 이어서 연습(연습 상세)으로 들어오면 지난 장면은 화면 없이 그대로 보낸다
  assert.match(upload, /buildContinueBody\(\{[^}]*scene,/);
  assert.match(ko, /helpLabel: \{\s*분석: '대사 분석',\s*표현: '연기 표현',\s*'그 외': '그 외',/);
});

test('액티 대화(P5.3): 빠른 버튼은 맞아요·아니요(입력칸만 채움)와 그만하기, 아래 「그만하고 정리 만들기」 링크는 없다', () => {
  assert.equal(helpButtonDraft('yes'), '맞아요');
  assert.equal(helpButtonDraft('no'), '아니요');
  const coach = read('app/coach.tsx');
  assert.match(coach, /\['yes', t\('coach\.quickYes'\)\],\s*\['no', t\('coach\.quickNo'\)\],/);
  // 그만하기는 오른쪽 위 머리 버튼이다(pen 질문 대화, SOMA-748) — 확인을 받고 대화를 마친다.
  // 대화를 열지 못했으면(이미 닫힌 대화 등) 마칠 대화가 없으니 화면을 나간다.
  assert.match(coach, /right=\{[\s\S]{0,300}onPress=\{\(\) => \(conversation \? void endConversation\(\) : router\.back\(\)\)\}[^>]*>\s*<Text style=\{styles\.endText\}>\{t\('coach\.quickEnd'\)\}/);
  // iOS 기본 머리의 headerRight 누름이 씹혀 화면 안 머리(NavHeader)로 그린다(10/23 iOS 제보).
  assert.match(coach, /<Stack\.Screen options=\{\{ headerShown: false \}\} \/>\s*<NavHeader/);
  assert.match(coach, /disabled=\{waiting \|\| connecting \|\| \(!conversation && !openFailed\)\}/);
  assert.doesNotMatch(coach, /coach\.endHint|styles\.endBtn|quickExplain|quickLater/);
  assert.match(read('locales/ko.ts'), /composerLabel: '답이나 질문을 편하게 적어 주세요'/);
});

test('액티 입력칸은 한 줄로 시작해 글이 늘면 커지고, 일정 높이부터는 칸 안에서 스크롤한다', () => {
  const coach = read('app/coach.tsx');
  const input = coach.slice(coach.indexOf('  input: {'), coach.indexOf('},', coach.indexOf('  input: {')));
  // pen 09 「Input」 높이 44.
  assert.match(input, /minHeight: 44/);
  assert.match(input, /maxHeight: 144/);
  assert.doesNotMatch(input, /minHeight: 112/);
  // 한 줄일 때 글자가 가운데 오게 — 줄 간격을 따로 주지 않고 위아래 여백을 같게
  assert.doesNotMatch(input, /lineHeight/);
  assert.match(input, /paddingTop: Platform\.OS === 'ios' \? 8 : 11,\s*paddingBottom: 11,/);
});

test('새 연습 준비: 고른 영상의 「영상 다시 선택」을 누르면 그 자리 메뉴에서 촬영·갤러리를 고른다(상자 안 버튼 없음)', () => {
  const upload = read('app/upload.tsx');
  assert.doesNotMatch(upload, /styles\.pickActions|styles\.recordBtn|styles\.galleryLink/);
  // 처음 고르기는 영상 단계의 세 줄이 하고(빈 영상 상자는 없다, SOMA-778), 바꾸기는 시트가 한다.
  assert.doesNotMatch(upload, /styles\.dropzone/);
  assert.match(upload, /<Pressable style=\{styles\.repick\} onPress=\{\(e\) => \{ setSourceAnchor\(pt\(e\)\); setSourceSheet\(true\); \}\}/);
  assert.match(upload, /<VideoSourceSheet/);
  // 두 갈래는 시트의 줄로 간다 — 문구 키는 그대로 쓴다
  for (const key of ['upload.recordCta', 'upload.pickGallery']) assert.match(upload, new RegExp(key.replace('.', '\\.')));
  const sheet = read('components/video-source-sheet.tsx');
  // 아래 시트 대신 누른 자리 옆 메뉴(10/24 하단 시트 금지)
  assert.match(sheet, /<AnchoredMenu anchor=\{anchor\}/);
  assert.match(sheet, /onClose=\{onClose\}/);
});

test('액티 질문은 회색 말풍선 16pt 다(pen 질문 대화 「액티 말」, SOMA-748 — 예전 21pt 맨글자 대신)', () => {
  const coach = read('app/coach.tsx');
  assert.match(coach, /question: \{ fontSize: 16,/);
  // 회색 말풍선은 코치 머리줄 공통 부품(components/coach-message)이 그린다(pen 09).
  assert.match(coach, /<CoachMessage>/);
  assert.match(read('components/coach-message.tsx'), /<View style=\{styles\.bubble\}>/);
});

test('보관함 목록에서 고른 영상은 재생 주소가 없어 상세로 받아 미리보기를 채운다(목록은 playback_url 이 null)', () => {
  const upload = read('app/upload.tsx');
  assert.match(upload, /api\s*\.getVideo\(picked\.videoId\)/);
  // 주소를 받기 전에도 고른 상태로 그린다 — 빈 상자로 돌아가지 않는다
  assert.match(upload, /\{picked \? \(/);
});

test('액티 화면 위에 「액티 답변 N번 남음」은 보이지 않는다 — 마무리 직전 안내만 남긴다', () => {
  const coach = read('app/coach.tsx');
  assert.doesNotMatch(coach, /coach\.remaining/);
  assert.match(coach, /\{wrapping && <Text style=\{styles\.progressText\}>\{t\('coach\.wrapNext'\)\}<\/Text>\}/);
});
