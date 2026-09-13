import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './ts-module-loader.mjs';
const { PracticeReportCards } = await import('../src/features/practice/practice-report-cards.tsx');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/practice-note.json', import.meta.url), 'utf8'));

test('practice note renders direction provenance and comparison without treating unknown execution as untried', () => {
  const html = renderToStaticMarkup(createElement(PracticeReportCards, {report:fixture}));
  assert.match(html, /함께 살펴볼 방향/);
  assert.match(html, /다음 연습 제안/);
  assert.ok(html.includes(fixture.practice.comparison));
  assert.doesNotMatch(html, /아직 해보지 않은 제안|직접 확인한 시도|해보며 달라진 점/);
});

test('new note renders an early ending and actor reported worsening without creating homework', () => {
  const note = {...fixture,mode:'record_only',direction:null,focus:null,practice:null};
  const html = renderToStaticMarkup(createElement(PracticeReportCards, {report:note}));
  assert.match(html, /이번 대화 기록/);
  assert.doesNotMatch(html, /다음 연습 제안|연습 방법/);
});
