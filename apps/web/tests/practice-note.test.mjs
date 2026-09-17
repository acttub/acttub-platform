import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './ts-module-loader.mjs';
const { PracticeReportCards } = await import('../src/features/practice/practice-report-cards.tsx');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/practice-note.json', import.meta.url), 'utf8'));

test('note shows summary, one proposed take and encouragement in that order', () => {
  const note = {...fixture, summary: '말끝이 이어지는 구간을 살펴봤어요.'};
  const html = renderToStaticMarkup(createElement(PracticeReportCards, {report:note}));
  assert.ok(html.indexOf(note.summary) < html.indexOf(note.practice.instruction));
  assert.ok(html.indexOf(note.practice.instruction) < html.indexOf('다음 촬영도 응원할게요.'));
  assert.equal(html.split(note.practice.instruction).length - 1, 1);
  assert.ok(!html.includes(note.practice.comparison));
  assert.doesNotMatch(html, /선택한 다음 연습|직접 확인한 시도|함께 살펴볼 방향/);
});

test('early ending keeps an honest empty take and encouragement', () => {
  const note = {...fixture, summary:null,mode:'record_only',direction:null,focus:null,practice:null};
  const html = renderToStaticMarkup(createElement(PracticeReportCards, {report:note}));
  assert.match(html, /이번에는 촬영 아이템을 정하지 않았어요/);
  assert.match(html, /다음 촬영도 응원할게요/);
  assert.ok(!html.includes(fixture.practice.instruction));
});
