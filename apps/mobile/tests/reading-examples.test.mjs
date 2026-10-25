import assert from 'node:assert/strict';
import test from 'node:test';

import { loadExamples, localExamples, normalizeExamples } from '../lib/reading/examples.ts';
import { SAMPLE_SCRIPTS, dialogueCount } from '../lib/reading/sample.ts';

const SERVER = {
  examples: [
    {
      id: 'rooftop',
      title: '옥상, 밤',
      summary: '윤서 · 태오 · 2인 대화',
      dialogue_count: 18,
      characters: ['윤서', '태오'],
      preview: [
        { speaker: '윤서', text: '여기 있을 줄 알았어.' },
        { speaker: null, text: '(옥상 난간)' },
      ],
    },
    {
      id: 'minji',
      title: '민지의 독백',
      summary: '혼자 읽는 독백',
      dialogue_count: 0,
      characters: ['민지'],
      preview: [{ speaker: null, text: '오늘도 괜찮다고 말했다.' }],
    },
  ],
};

test('서버 목록을 화면 모양으로 바꾼다', () => {
  assert.deepEqual(normalizeExamples(SERVER), [
    {
      id: 'rooftop',
      title: '옥상, 밤',
      summary: '윤서 · 태오 · 2인 대화',
      dialogueCount: 18,
      characters: ['윤서', '태오'],
      preview: [
        { speaker: '윤서', text: '여기 있을 줄 알았어.' },
        { speaker: null, text: '(옥상 난간)' },
      ],
    },
    {
      id: 'minji',
      title: '민지의 독백',
      summary: '혼자 읽는 독백',
      dialogueCount: 0,
      characters: ['민지'],
      preview: [{ speaker: null, text: '오늘도 괜찮다고 말했다.' }],
    },
  ]);
});

test('id·제목 없는 항목은 버리고, 빠진 칸은 비운다', () => {
  const out = normalizeExamples({
    examples: [
      { id: '', title: '빈 id' },
      { id: 'x', title: '' },
      null,
      'nope',
      {
        id: 'cafe',
        title: '카페',
        dialogue_count: -3,
        characters: ['서연', 7],
        preview: [{ speaker: 3, text: '안녕' }, { text: '' }, { speaker: '준호' }, ...Array.from({ length: 8 }, (_, i) => ({ speaker: null, text: `줄${i}` }))],
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'cafe');
  assert.equal(out[0].summary, '');
  assert.equal(out[0].dialogueCount, 0);
  assert.deepEqual(out[0].characters, ['서연']);
  assert.equal(out[0].preview.length, 5);
  assert.deepEqual(out[0].preview[0], { speaker: null, text: '안녕' });
});

test('모양이 틀린 응답은 빈 목록이다', () => {
  assert.deepEqual(normalizeExamples(null), []);
  assert.deepEqual(normalizeExamples({}), []);
  assert.deepEqual(normalizeExamples({ examples: 'x' }), []);
});

test('내장 목록은 앱에 박힌 세 예시다', () => {
  const local = localExamples();
  assert.equal(local.source, 'local');
  assert.deepEqual(local.examples.map((e) => e.id), SAMPLE_SCRIPTS.map((s) => s.id));
  assert.equal(local.examples[1].dialogueCount, dialogueCount(SAMPLE_SCRIPTS[1]));
  assert.ok(local.examples[0].preview.length > 0);
});

test('서버에서 받으면 server, 실패·빈 목록이면 내장 목록(local)', async () => {
  const ok = await loadExamples(async () => SERVER);
  assert.equal(ok.source, 'server');
  assert.deepEqual(ok.examples.map((e) => e.id), ['rooftop', 'minji']);

  const failed = await loadExamples(async () => {
    throw new Error('404');
  });
  assert.equal(failed.source, 'local');
  assert.equal(failed.examples.length, SAMPLE_SCRIPTS.length);

  const empty = await loadExamples(async () => ({ examples: [] }));
  assert.equal(empty.source, 'local');
});
