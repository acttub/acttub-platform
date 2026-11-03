import assert from 'node:assert/strict';
import { test } from 'node:test';

// 영어 기기의 대본 같이 만들기(SOMA-1033) — 칩·요약 줄이 한국어로 남지 않는다. 이 파일은 기기 언어를 영어로 두고 모듈을 읽는다.
globalThis.require = (name) => {
  if (name === 'expo-secure-store') return { getItem: () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} };
  if (name === 'expo-localization') return { getLocales: () => [{ languageCode: 'en' }] };
  throw new Error(`unexpected ${name}`);
};
const config = await import('../lib/app-config.ts');
const cocreate = await import('../lib/script-cocreate.ts');

test('영어 기기: 받기 전 기본값(한국어 칩)이면 영어 기본 칩을 쓴다', () => {
  assert.deepEqual(config.cocreateChips(), config.COCREATE_EN);
});

test('영어 기기: 서버가 준 영어 칩은 그대로 쓴다', () => {
  const server = { ...config.DEFAULT_APP_CONFIG, cocreate: { emotions: ['Hurt', 'Calm'], situations: ['Breakup'] } };
  assert.deepEqual(config.cocreateChips(server), server.cocreate);
});

test('영어 기기: 「잘 모르겠어요」·「아무거나 좋아요」·요약 줄이 영어다', () => {
  assert.equal(cocreate.anyEmotion(), 'Not sure');
  assert.equal(cocreate.anySituation(), 'Anything works');
  assert.equal(cocreate.durationLabel(57), 'About 1 min');
  assert.equal(cocreate.durationLabel(44), 'About 40 sec');
  assert.equal(cocreate.durationLabel(95), 'About 1 min 30 sec');
  const script = { characters: [{ name: 'Mia', mine: true }, { name: 'Jake', mine: false }], estimated_seconds: 60 };
  assert.equal(cocreate.summaryLine(script), 'Mia · Jake · 2-person scene · About 1 min');
  assert.equal(cocreate.summaryLine({ ...script, characters: [script.characters[0]] }), 'Mia · Monologue · About 1 min');
});
