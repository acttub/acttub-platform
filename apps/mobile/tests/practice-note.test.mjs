import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { practiceNoteSections, reportDisplay } from '../lib/report-display.ts';
const fixture = JSON.parse(readFileSync(new URL('../../web/tests/fixtures/practice-note.json', import.meta.url), 'utf8'));

test('note presents summary, one take and encouragement without changing stored provenance', () => {
  const note = {...fixture,summary:'말끝이 이어지는 구간을 살펴봤어요.'};
  const before = structuredClone(note);
  const sections = practiceNoteSections(note);
  assert.equal(reportDisplay(note).title, note.title);
  assert.deepEqual(sections.map(s => s.kind), ['summary','next','encouragement']);
  assert.equal(sections[0].text, note.summary);
  assert.equal(sections[1].text, note.practice.instruction);
  assert.match(sections[2].text, /다음 촬영도 응원할게요/);
  assert.deepEqual(note, before);
});

test('historical attempts are preserved in data without becoming a second task', () => {
  const note = structuredClone(fixture);
  note.attempts = [{attempt_id:'a1',proposal_id:'old',instruction:'이전 연습',execution:'reported_tried',result:{direction:'further',statement:'더 어색했어요.',basis:'actor_report'}}];
  const sections = practiceNoteSections(note);
  assert.equal(sections.length, 3);
  assert.equal(sections[1].text, note.practice.instruction);
  assert.equal(note.attempts[0].result.statement, '더 어색했어요.');
});

test('early ending does not fabricate homework', () => {
  const note = {...fixture,summary:null,mode:'record_only',direction:null,focus:null,practice:null};
  const sections = practiceNoteSections(note);
  assert.equal(sections[1].text, '이번에는 촬영 아이템을 정하지 않았어요.');
  assert.match(sections[2].text, /응원/);
});
