import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { NOTE_CHEER_KEYS, pickNoteCheer } from '../lib/note-cheer.ts';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('응원 한마디는 다섯 개이고 무작위로 하나를 고른다(SOMA-662)', () => {
  assert.equal(NOTE_CHEER_KEYS.length, 5);
  assert.equal(pickNoteCheer(() => 0), NOTE_CHEER_KEYS[0]);
  assert.equal(pickNoteCheer(() => 0.999), NOTE_CHEER_KEYS[4]);
  const ko = read('locales/ko.ts');
  for (const key of NOTE_CHEER_KEYS) assert.match(ko, new RegExp(`${key.split('.').pop()}: '`));
});

test('방금 끝난 연습 노트에서 다음 할 일 아래·평가 위에 마스코트 응원 말풍선이 있다', () => {
  const report = read('app/report.tsx');
  const cheer = report.indexOf('<NoteCheer');
  assert.ok(cheer > report.indexOf('<NoteSections note={note} />'));
  assert.ok(cheer < report.indexOf('<ReportRating'));
  assert.match(read('components/note-cheer.tsx'), /require\('@\/assets\/images\/mascot-cheer\.png'\)/);
});
