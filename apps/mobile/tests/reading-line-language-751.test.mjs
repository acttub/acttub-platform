import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { guessLanguage, isKoreanLine, lineLanguage, speechLocaleFor, speechParts, speechTextOf, voiceLanguage } from '../lib/reading/line-language.ts';
import { createSpeechQueue } from '../lib/reading/tts/prefetch.ts';
import { toSavedScript } from '../lib/reading/store.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('reading.line-language: 서버가 준 말과 소리 낼 글을 쓴다 — 로마자 아랍어 줄은 아랍 문자를 아랍어로(SOMA-751)', () => {
  const line = { text: '3anni ana? 안니 아나?', lang: 'ar', speech: 'عني أنا؟' };
  assert.equal(lineLanguage(line), 'ar');
  assert.equal(speechTextOf(line), 'عني أنا؟');
  assert.equal(voiceLanguage(lineLanguage(line)), 'ar');
  assert.equal(speechLocaleFor('ar'), 'ar-SA');
  assert.equal(isKoreanLine(line), false);
});

test('reading.line-language: 말이 없는 줄은 글자로 짐작하고, 로마자만 있으면 앱 표시 언어다', () => {
  assert.equal(guessLanguage('여기 있을 줄 알았어.'), 'ko');
  assert.equal(guessLanguage('السلام عليكم'), 'ar');
  assert.equal(guessLanguage('ありがとう'), 'ja');
  assert.equal(guessLanguage('Где ты?'), 'ru');
  assert.equal(guessLanguage('Where are you?'), null);
  assert.equal(guessLanguage('알았어 (شكرا)'), 'ko', '괄호 안은 세지 않는다');
  assert.equal(lineLanguage({ text: 'Where are you?' }), null);
  assert.equal(lineLanguage({ text: '안녕', lang: 'zz' }), 'ko', '모르는 말 코드는 버리고 짐작한다');
  assert.equal(speechTextOf({ text: '안녕', speech: '  ' }), '안녕');
  assert.equal(isKoreanLine({ text: '안녕' }), true);
});

test('reading.line-language: 미리 만들기 큐는 줄의 말로 만들고 말이 다르면 다른 저장본이다', async () => {
  const made = [];
  const queue = createSpeechQueue({
    synthesize: async (text, key, preset, lang) => { made.push({ text, preset, lang }); return `file://${key}`; },
    scriptId: 's', locale: 'ko', preset: 'F1', variant: 'int8', steps: 8, speed: 1,
  });
  queue.prime([{ text: 'عني أنا؟', preset: 'M1', lang: 'ar' }, { text: '안녕', preset: 'F1' }]);
  await queue.settled();
  await queue.settled();
  assert.deepEqual(made, [{ text: 'عني أنا؟', preset: 'M1', lang: 'ar' }, { text: '안녕', preset: 'F1', lang: 'ko' }]);
  const ar = await queue.take({ text: 'Hola', preset: 'F1', lang: 'es' });
  assert.equal(ar, null, '다른 말의 같은 글은 아직 만들지 않았다');
});

test('reading.line-language: 서버 상세의 lang·speech 를 대사 줄에 싣는다 — 없는 줄은 모양이 그대로다', () => {
  const saved = toSavedScript({
    id: 's1', title: 'Kiss', source: 'file', created_at: '', updated_at: '', recording_count: 0, open_session_id: null, last_session: null, scenes: [],
    characters: [{ id: 'c1', name: '여자', order: 0, voice_preset: null, voice: 'F1', gender: null, age_band: null, dialogue_count: 2 }],
    lines: [
      { id: 'l1', ordinal: 1, kind: 'dialogue', character_id: 'c1', text: '안녕', dialogue_no: 1, lang: null, speech: null },
      { id: 'l2', ordinal: 2, kind: 'dialogue', character_id: 'c1', text: '3anni ana? 안니 아나?', dialogue_no: 2, lang: 'ar', speech: 'عني أنا؟' },
    ],
  });
  assert.deepEqual(saved.lines[0], { type: 'dialogue', role: '여자', text: '안녕' });
  assert.deepEqual(saved.lines[1], { type: 'dialogue', role: '여자', text: '3anni ana? 안니 아나?', lang: 'ar', speech: 'عني أنا؟' });
});

test('reading.line-language: 한 줄에 다른 말이 이어지면 조각마다 그 말로 읽는다', () => {
  const line = { text: '고맙습니다. minshān ḥēk labse naḍḍarāt.', lang: 'ar', speech: '\u27E6ko\u27E7고맙습니다. \u27E6ar\u27E7منشان هيك لابسة نظارات.' };
  assert.deepEqual(speechParts(line), [{ lang: 'ko', text: '고맙습니다.' }, { lang: 'ar', text: 'منشان هيك لابسة نظارات.' }]);
  assert.equal(speechTextOf(line), '고맙습니다. منشان هيك لابسة نظارات.');
  assert.equal(lineLanguage(line), 'ar', '받아쓰기는 한국어가 아닌 첫 조각의 말');
  assert.deepEqual(speechParts({ text: '3anni ana? 안니 아나?', lang: 'ar', speech: 'عني أنا؟' }), [{ lang: 'ar', text: 'عني أنا؟' }]);
  assert.deepEqual(speechParts({ text: '안녕' }), [{ lang: 'ko', text: '안녕' }]);
});

test('reading.play: 상대 대사·받아쓰기·발음 피드백이 줄의 말을 따른다(SOMA-751)', () => {
  const play = read('../app/reading/play.tsx');
  assert.match(play, /\.flatMap\(\(l\) => speechParts\(l\)\)/);
  assert.match(play, /for \(const \{ text, lang \} of parts\)/);
  assert.match(play, /take\(\{ text, preset, lang \}\)/);
  assert.match(play, /speakWithDevice\(text, preset, \{ locale: speechLocaleFor\(lang\) \}\)/);
  assert.match(play, /\.flatMap\(\(line\) => speechParts\(line\)\.map/);
  assert.match(play, /locale: speechLocaleFor\(lineLanguage\(mine\)\)/);
  assert.match(play, /if \(!isKoreanLine\(line\)\) return;/);
  const hook = read('../hooks/use-reading-stt.ts');
  assert.match(hook, /const lang = options\?\.locale \?\? speechLocale\(\);/);
});
