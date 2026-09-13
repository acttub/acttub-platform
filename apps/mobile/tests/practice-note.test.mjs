import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { practiceNoteSections, reportDisplay } from '../lib/report-display.ts';
const fixture = JSON.parse(readFileSync(new URL('../../web/tests/fixtures/practice-note.json', import.meta.url), 'utf8'));

test('new note preserves proposed direction, instruction and comparison without inventing a completed attempt', () => {
  const sections = practiceNoteSections(fixture);
  assert.equal(reportDisplay(fixture).title, fixture.title);
  assert.ok(sections.some(s => s.label === '함께 살펴볼 방향'));
  assert.ok(sections.some(s => s.text === fixture.practice.comparison));
  assert.ok(sections.some(s => s.label === '다음 연습 제안'));
  assert.ok(!sections.some(s => /해봤|달라진|성공/.test(s.label)));
});

test('reported worsening stays actor reported and belongs to its own attempt', () => {
  const note = structuredClone(fixture);
  note.attempts = [{attempt_id:'a1',proposal_id:'old',instruction:'이전 연습',execution:'reported_tried',result:{direction:'further',statement:'더 어색했어요.',basis:'actor_report'}}];
  const sections = practiceNoteSections(note);
  assert.ok(sections.some(s => s.label === '배우가 전한 변화' && s.text === '더 어색했어요.'));
  assert.equal(note.practice.proposal_id, 'p1');
});

test('early ending displays a record without a fabricated exercise', () => {
  const note = {...fixture, mode:'record_only',direction:null,focus:null,practice:null};
  const sections = practiceNoteSections(note);
  assert.ok(sections.some(s => s.label === '이번 대화 기록'));
  assert.ok(!sections.some(s => s.label.includes('다음 연습')));
});
