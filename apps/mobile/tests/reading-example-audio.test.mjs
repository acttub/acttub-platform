import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createExampleAudioLoader,
  exampleAudioFileName,
  exampleVoicesMatch,
  normalizeExampleAudio,
} from '../lib/reading/example-audio.ts';

const BODY = {
  example_id: 'rooftop',
  voices: { 윤서: 'F1', 태오: 'M1' },
  lines: [
    { line_id: 'l1', url: 'https://cdn.test/examples/rooftop/a1b2.mp3?X-Sig=1', duration_ms: 1200 },
    { line_id: 'l3', url: 'https://cdn.test/examples/rooftop/c3d4.mp3?X-Sig=2', duration_ms: 900 },
  ],
};

test('서버 답을 예시 음성으로 바꾼다 — 줄 id 로 찾는다', () => {
  const audio = normalizeExampleAudio(BODY);
  assert.equal(audio.exampleId, 'rooftop');
  assert.deepEqual(audio.voices, { 윤서: 'F1', 태오: 'M1' });
  assert.deepEqual(audio.lines.get('l1'), { url: BODY.lines[0].url, durationMs: 1200 });
  assert.equal(audio.lines.get('l2'), undefined);
});

test('독백 예시(lines 빈 배열)도 예시다', () => {
  const audio = normalizeExampleAudio({ example_id: 'minji', voices: {}, lines: [] });
  assert.equal(audio.exampleId, 'minji');
  assert.equal(audio.lines.size, 0);
});

test('모양이 틀리면 예시가 아니다(null), 틀린 줄·목소리만 버린다', () => {
  assert.equal(normalizeExampleAudio(null), null);
  assert.equal(normalizeExampleAudio({ voices: {}, lines: [] }), null);
  assert.equal(normalizeExampleAudio({ example_id: 'x', voices: {}, lines: 'no' }), null);
  const audio = normalizeExampleAudio({
    example_id: 'x',
    voices: { 가: 'F1', 나: 3 },
    lines: [{ line_id: 'l1' }, { line_id: 'l2', url: 'https://a/b.mp3' }, 'bad'],
  });
  assert.deepEqual(audio.voices, { 가: 'F1' });
  assert.deepEqual([...audio.lines.keys()], ['l2']);
  assert.equal(audio.lines.get('l2').durationMs, 0);
});

test('상대역 목소리가 모두 예시 목소리와 같아야 쓴다', () => {
  const audio = normalizeExampleAudio(BODY);
  assert.equal(exampleVoicesMatch(audio, { 태오: 'M1' }), true);
  assert.equal(exampleVoicesMatch(audio, { 윤서: 'F1', 태오: 'M1' }), true);
  assert.equal(exampleVoicesMatch(audio, { 태오: 'M3' }), false);
  // 예시에 없는 배역(이름을 바꿨거나 새로 넣음)은 미리 만든 목소리가 없다.
  assert.equal(exampleVoicesMatch(audio, { 지호: 'M1' }), false);
  assert.equal(exampleVoicesMatch(null, { 태오: 'M1' }), false);
});

test('불러오기는 대본마다 기억하고, 404·오류·옛 서버는 예시가 아닌 것(null)이다', async () => {
  const calls = [];
  const loader = createExampleAudioLoader(async (id) => {
    calls.push(id);
    if (id === 's1') return BODY;
    if (id === 'boom') throw new Error('offline');
    const err = new Error('nope');
    err.status = 404;
    err.code = 'reading_example_audio_not_found';
    throw err;
  });
  assert.equal((await loader.load('s1')).exampleId, 'rooftop');
  assert.equal((await loader.load('s1')).exampleId, 'rooftop');
  assert.deepEqual(calls, ['s1']);
  assert.equal(await loader.load('s2'), null);
  assert.equal(await loader.load('boom'), null);
  assert.equal(loader.cached('s1').exampleId, 'rooftop');
  assert.equal(loader.cached('zzz'), undefined);
});

test('연습을 시작할 때는 새로 받는다(임시 주소가 만료되므로)', async () => {
  let n = 0;
  const loader = createExampleAudioLoader(async () => ({ ...BODY, example_id: `e${++n}` }));
  assert.equal((await loader.load('s1')).exampleId, 'e1');
  assert.equal((await loader.load('s1', { fresh: true })).exampleId, 'e2');
  assert.equal((await loader.load('s1')).exampleId, 'e2');
});

test('오래된 기억은 다시 받는다', async () => {
  let now = 0;
  let n = 0;
  const loader = createExampleAudioLoader(async () => ({ ...BODY, example_id: `e${++n}` }), { maxAgeMs: 1000, now: () => now });
  await loader.load('s1');
  now = 999;
  assert.equal((await loader.load('s1')).exampleId, 'e1');
  now = 1001;
  assert.equal((await loader.load('s1')).exampleId, 'e2');
  assert.equal(loader.cached('s1').exampleId, 'e2');
  now = 5000;
  assert.equal(loader.cached('s1'), undefined);
});

test('같은 대본을 동시에 물으면 한 번만 받는다', async () => {
  let n = 0;
  const loader = createExampleAudioLoader(async () => {
    n += 1;
    return BODY;
  });
  const [a, b] = await Promise.all([loader.load('s1'), loader.load('s1')]);
  assert.equal(a, b);
  assert.equal(n, 1);
});

test('함수 호출 자체가 던져도 null 이다', async () => {
  const loader = createExampleAudioLoader(() => {
    throw new TypeError('not a function');
  });
  assert.equal(await loader.load('s1'), null);
});

test('저장 파일 이름은 예시·줄·주소 경로로 갈리고 확장자를 따른다', () => {
  const a = exampleAudioFileName('rooftop', 'l1', 'https://cdn.test/examples/rooftop/a1b2.mp3?X-Sig=1');
  const b = exampleAudioFileName('rooftop', 'l1', 'https://cdn.test/examples/rooftop/a1b2.mp3?X-Sig=other');
  const c = exampleAudioFileName('rooftop', 'l1', 'https://cdn.test/examples/rooftop/zzzz.mp3?X-Sig=1');
  assert.match(a, /^reading-example-rooftop-l1-[a-z0-9]+\.mp3$/);
  assert.equal(a, b); // 서명만 다르면 같은 파일
  assert.notEqual(a, c); // 서버가 음성을 새로 만들면 다른 파일
  assert.match(exampleAudioFileName('r/../x', 'l 1', 'https://a/b.wav'), /^reading-example-rx-l1-[a-z0-9]+\.wav$/);
  assert.match(exampleAudioFileName('r', 'l', 'https://a/b'), /\.mp3$/);
  assert.match(exampleAudioFileName('r', 'l', 'not a url'), /\.mp3$/);
});
