import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { helpButtonDraft } from '../lib/practice/coach.ts';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('새 연습 준비(P3.1): 상황·인물·목표 칸과 「이전 연습 이어서 하기」가 없고, 도움 갈래 칩과 상세 칸만 있다(SOMA-656)', () => {
  const upload = read('app/upload.tsx');
  assert.doesNotMatch(upload, /upload\.situation|upload\.character|upload\.goal|<Field\b/);
  assert.doesNotMatch(upload, /start\.continueCta|chooseGroup/);
  // 세부 칩은 없다 — 세부는 비워 보내고 서버 기본값(그 외)이 된다
  assert.doesNotMatch(upload, /blockage\.kindLabel|EXPRESSION_DETAILS|ANALYSIS_DETAILS/);
  assert.match(upload, /blockage\.helpLabel\./);
  assert.match(upload, /blockage\.freePh/);
  // 이어서 연습(연습 상세)으로 들어오면 지난 장면은 화면 없이 그대로 보낸다
  assert.match(upload, /buildContinueBody\(\{[^}]*scene,/);
  const ko = read('locales/ko.ts');
  assert.match(ko, /helpLabel: \{\s*분석: '대사 분석',\s*표현: '연기 표현',\s*'그 외': '그 외',/);
});

test('코치 대화(P5.3): 빠른 버튼은 맞아요·아니요(입력칸만 채움)와 그만하기, 아래 「그만하고 정리 만들기」 링크는 없다', () => {
  assert.equal(helpButtonDraft('yes'), '맞아요');
  assert.equal(helpButtonDraft('no'), '아니요');
  const coach = read('app/coach.tsx');
  assert.match(coach, /\['yes', t\('coach\.quickYes'\)\],\s*\['no', t\('coach\.quickNo'\)\],/);
  assert.match(coach, /onPress=\{\(\) => void endConversation\(\)\}[^>]*>\s*<Text style=\{styles\.quickText\}>\{t\('coach\.quickEnd'\)\}/);
  assert.doesNotMatch(coach, /coach\.endHint|styles\.endBtn|quickExplain|quickLater/);
  assert.match(read('locales/ko.ts'), /composerLabel: '답이나 질문을 편하게 적어 주세요'/);
});

test('코치 입력칸은 한 줄로 시작해 글이 늘면 커지고, 일정 높이부터는 칸 안에서 스크롤한다', () => {
  const coach = read('app/coach.tsx');
  const input = coach.slice(coach.indexOf('  input: {'), coach.indexOf('},', coach.indexOf('  input: {')));
  assert.match(input, /minHeight: 48/);
  assert.match(input, /maxHeight: 144/);
  assert.doesNotMatch(input, /minHeight: 112/);
});
