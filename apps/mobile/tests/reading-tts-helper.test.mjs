import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// onnxruntime-react-native 만 가짜로 바꾼다. 텐서는 받은 값을 그대로 들고, 세션 생성은 받은 인자를 남긴다.
globalThis.__ttsHelperTest = { created: [] };
const ORT = `const s = globalThis.__ttsHelperTest;
  export class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
  export const InferenceSession = { create: async (path, options) => { s.created.push([path, options]); return { path }; } };`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'onnxruntime-react-native' && context.parentURL?.endsWith('/tts/helper.native.js')) {
      return { url: `data:text/javascript,${encodeURIComponent(ORT)}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const helper = await import('../lib/reading/tts/helper.native.js');
const { Tensor } = await import(`data:text/javascript,${encodeURIComponent(ORT)}`);

const ASCII = Array.from({ length: 128 }, (_, i) => i);
const processor = new helper.UnicodeProcessor(ASCII);
const pre = (text, lang = 'en') => processor.preprocessText(text, lang);

test('지원하는 말만 받는다', () => {
  assert.equal(helper.isValidLang('ko'), true);
  assert.equal(helper.isValidLang('xx'), false);
  assert.throws(() => pre('hi', 'xx'), /Invalid language: xx/);
});

test('글을 모델이 읽을 모양으로 다듬고 말 표시로 감싼다', () => {
  assert.equal(pre('hello'), '<en>hello.</en>');
  assert.equal(pre('  wait ,  what ?  '), '<en>wait, what?</en>');
  assert.equal(pre('a—b – c d_e'), '<en>a-b - c d e.</en>');
  assert.equal(pre('“hi”, ‘yo’, x` [n] a|b c/d #1 x→y←z'), '<en>"hi",\'yo\', x\' n a b c d 1 x y z.</en>');
  assert.equal(pre('love ♥☆♡© \\ me!'), '<en>love me!</en>');
  assert.equal(pre('mail @home e.g., this i.e., that'), '<en>mail at home for example, this that is, that.</en>');
  assert.equal(pre('wow 😀🚀 ok ;'), '<en>wow ok;</en>');
  assert.equal(pre('say """quoted""" and \'\'\'x\'\'\''), '<en>say "quoted" and\'x\'</en>');
  assert.equal(pre('one . two ! three : four \'s'), '<en>one. two! three: four\'s.</en>');
  assert.equal(pre('끝。', 'ko'), '<ko>\u1101\u1173\u11c0。</ko>');
});

test('줄바꿈 없는 하이픈(U+2011)과 양음 부호(´)도 치환표대로 바꾼다', () => {
  assert.equal(pre('c \u2011 d'), '<en>c - d.</en>');
  assert.equal(pre('it\u00b4s'), "<en>it's.</en>");
});

test('여러 글을 같은 길이의 번호 줄과 가림 줄로 만든다', () => {
  const { textIds, textMask } = processor.call(['hi', 'hey'], ['en', 'en']);

  assert.deepEqual(textIds[0].slice(0, 4), [...'<en>'].map((c) => c.codePointAt(0)));
  assert.equal(textIds[0].length, '<en>hey.</en>'.length);
  assert.equal(textIds[0].at(-1), 0);
  assert.deepEqual(textMask.map(([row]) => row.reduce((a, b) => a + b, 0)), ['<en>hi.</en>'.length, '<en>hey.</en>'.length]);
  assert.equal(processor.call(['가'], ['ko']).textIds[0][4], -1);
  assert.deepEqual(processor.lengthToMask([1, 3]), [[[1, 0, 0]], [[1, 1, 1]]]);
});

test('목소리 스타일 객체들을 한 묶음 텐서로 만든다', () => {
  const style = (n) => ({
    style_ttl: { dims: [1, 2, 2], data: [[[n, n + 1], [n + 2, n + 3]]] },
    style_dp: { dims: [1, 1, 2], data: [[[n * 10, n * 10 + 1]]] },
  });
  const loaded = helper.loadVoiceStyleFromObjects([style(1), style(5)]);

  assert.ok(loaded instanceof helper.Style);
  assert.deepEqual(loaded.ttl.dims, [2, 2, 2]);
  assert.deepEqual([...loaded.ttl.data], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(loaded.dp.dims, [2, 1, 2]);
  assert.deepEqual([...loaded.dp.data], [10, 11, 50, 51]);
});

test('모델은 받은 파일 경로와 옵션으로 연다', async () => {
  const session = await helper.loadOnnx('file:///models/vocoder.onnx', { executionProviders: ['cpu'] });

  assert.deepEqual(session, { path: 'file:///models/vocoder.onnx' });
  assert.deepEqual(globalThis.__ttsHelperTest.created.at(-1), ['file:///models/vocoder.onnx', { executionProviders: ['cpu'] }]);
});

test('PCM 을 16비트 WAV 로 쓰고 범위를 넘는 값은 자른다', () => {
  const wav = helper.writeWavFile([0, 0.5, -2, 2], 24000);
  const view = new DataView(wav.buffer);
  const text = (at, n) => String.fromCharCode(...wav.slice(at, at + n));

  assert.equal(wav.length, 44 + 8);
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(view.getUint32(4, true), 36 + 8);
  assert.equal(text(8, 8), 'WAVEfmt ');
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 24000);
  assert.equal(view.getUint32(28, true), 48000);
  assert.equal(text(36, 4), 'data');
  assert.deepEqual([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true)), [0, 16383, -32767, 32767]);
});

/** 단계마다 받은 입력을 남기고, 소음 잠재값 대신 (단계+1) 을 돌려주는 가짜 모델들. */
function fakeModels(durations) {
  const seen = { dp: [], vector: [], vocoder: [] };
  const run = (name, fn) => ({ run: async (inputs) => { seen[name].push(inputs); return fn(inputs); } });
  return {
    seen,
    dp: run('dp', () => ({ duration: { data: durations } })),
    textEnc: { run: async () => ({ text_emb: 'emb' }) },
    vector: run('vector', (inputs) => ({ denoised_latent: { data: Array.from(inputs.noisy_latent.data, () => inputs.current_step.data[0] + 1) } })),
    vocoder: run('vocoder', () => ({ wav_tts: { data: [0.1, 0.2] } })),
  };
}
const CFGS = { ae: { sample_rate: 8, base_chunk_size: 2 }, ttl: { chunk_compress_factor: 1, latent_dim: 2 } };
const STYLE = new helper.Style(new Tensor('float32', new Float32Array(4), [1, 2, 2]), new Tensor('float32', new Float32Array(2), [1, 1, 2]));

test('한 줄을 합성하며 단계마다 진행을 알리고, 마지막 잠재값을 보코더에 넘긴다', async () => {
  const m = fakeModels([1]);
  const tts = new helper.TextToSpeech(CFGS, processor, m.dp, m.textEnc, m.vector, m.vocoder);
  const steps = [];

  const out = await tts.call('hi', 'en', STYLE, 3, 2, 0.3, (step, total) => steps.push([step, total]));

  assert.deepEqual(out, { wav: [0.1, 0.2], duration: [0.5] });
  assert.deepEqual(steps, [[1, 3], [2, 3], [3, 3]]);
  assert.deepEqual(m.seen.vector.map((i) => [...i.current_step.data]), [[0], [1], [2]]);
  assert.deepEqual(m.seen.vector[0].noisy_latent.dims, [1, 2, 2]);
  assert.deepEqual([...m.seen.vocoder[0].latent.data], [3, 3, 3, 3]);
  assert.equal(m.seen.dp[0].text_ids.type, 'int64');
});

test('긴 글은 문장 단위로 나눠 합성하고 사이에 쉼을 넣는다', async () => {
  const m = fakeModels([0.5]);
  const tts = new helper.TextToSpeech(CFGS, processor, m.dp, m.textEnc, m.vector, m.vocoder);
  const sentence = '가'.repeat(70) + '.';

  const out = await tts.call(`${sentence} ${sentence}\n\n${'나'.repeat(10)}`, 'ko', STYLE, 1, 1);

  assert.equal(m.seen.vocoder.length, 3);
  assert.deepEqual(out.wav, [0.1, 0.2, 0, 0, 0.1, 0.2, 0, 0, 0.1, 0.2]);
  assert.equal(out.duration[0].toFixed(2), '2.10');
});

test('여러 화자 스타일로는 한 줄 합성을 하지 않는다', async () => {
  const m = fakeModels([1]);
  const tts = new helper.TextToSpeech(CFGS, processor, m.dp, m.textEnc, m.vector, m.vocoder);
  const pair = new helper.Style(new Tensor('float32', new Float32Array(8), [2, 2, 2]), STYLE.dp);

  await assert.rejects(tts.call('hi', 'en', pair, 1), /Single speaker/);
  await assert.rejects(tts.call(42, 'en', STYLE, 1), /chunkText expects a string, got number/);
});

test('묶음 합성은 줄마다 길이에 맞춰 남는 잠재값을 0 으로 가린다', async () => {
  const m = fakeModels([0.5, 0.25]);
  const tts = new helper.TextToSpeech(CFGS, processor, m.dp, m.textEnc, m.vector, m.vocoder);

  const out = await tts.batch(['hi', 'yo'], ['en', 'en'], STYLE, 1);

  assert.deepEqual(out.duration, [0.5 / 1.05, 0.25 / 1.05]);
  const { noisy_latent: latent, latent_mask: mask } = m.seen.vector[0];
  assert.deepEqual(latent.dims, [2, 2, 2]);
  assert.deepEqual([...mask.data], [1, 1, 1, 0]);
  assert.deepEqual([latent.data[5], latent.data[7]].map(Math.abs), [0, 0]);
});
