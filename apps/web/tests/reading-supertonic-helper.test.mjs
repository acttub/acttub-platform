// Supertonic 브라우저 런타임(helper.js)을 onnxruntime 대역 위에서 실제로 돌린다.
// 세션 대역이 받은 텐서 모양과, 세션이 돌려준 값으로 만든 결과(이어 붙인 소리, wav 바이트)를 본다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "onnxruntime-web") {
      return { url: new URL("./fixtures/reading-supertonic-ort.mjs", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const ort = await import("./fixtures/reading-supertonic-ort.mjs");
const {
  isValidLang,
  loadTextToSpeech,
  loadVoiceStyle,
  Style,
  TextToSpeech,
  UnicodeProcessor,
  writeWavFile,
} = await import("../src/lib/reading/audio/supertonic/helper.js");

// 표본율 100, 잠재 조각 4칸(2×2), 잠재 채널 6개(3×2).
const CFGS = { ae: { sample_rate: 100, base_chunk_size: 2 }, ttl: { chunk_compress_factor: 2, latent_dim: 3 } };
const identityIndexer = Array.from({ length: 0x3000 }, (_, cp) => cp);

const decode = (tensor) => {
  const [rows, cols] = tensor.dims;
  return Array.from({ length: rows }, (_, r) =>
    Array.from(tensor.data.slice(r * cols, (r + 1) * cols))
      .filter((x) => x > 0n)
      .map((x) => String.fromCodePoint(Number(x)))
      .join("")
      .normalize("NFC"),
  );
};

const singleStyle = () =>
  new Style(new ort.Tensor("float32", new Float32Array(2), [1, 1, 2]), new ort.Tensor("float32", new Float32Array(2), [1, 1, 2]));

/** 대사 조각마다 길이 예측값과 vocoder 출력을 차례로 돌려주는 세션 넷 */
function fakeModels({ durations, wavs }) {
  const runs = { dp: [], textEnc: [], vectorEst: [], vocoder: [] };
  const dp = {
    async run(inputs) {
      runs.dp.push(inputs);
      return { duration: { data: durations[runs.dp.length - 1] } };
    },
  };
  const textEnc = {
    async run(inputs) {
      runs.textEnc.push(inputs);
      return { text_emb: { name: "text_emb" } };
    },
  };
  const vectorEst = {
    async run(inputs) {
      runs.vectorEst.push(inputs);
      return { denoised_latent: { data: inputs.noisy_latent.data.map((v) => v * 2) } };
    },
  };
  const vocoder = {
    async run(inputs) {
      runs.vocoder.push(inputs);
      return { wav_tts: { data: wavs[runs.vocoder.length - 1] } };
    },
  };
  return { runs, sessions: [dp, textEnc, vectorEst, vocoder] };
}

const realRandom = Math.random;
const realFetch = globalThis.fetch;
const realLog = console.log;
let logged;

beforeEach(() => {
  // Box-Muller 의 u1=e^-0.5, u2=0 이면 잡음이 정확히 1 이 된다.
  let n = 0;
  Math.random = () => (n++ % 2 === 0 ? Math.exp(-0.5) : 0);
  logged = [];
  console.log = (...args) => logged.push(args.join(" "));
});

afterEach(() => {
  Math.random = realRandom;
  globalThis.fetch = realFetch;
  console.log = realLog;
});

function serveJson(table) {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    if (!(url in table)) return new Response("없음", { status: 404 });
    return Response.json(table[url]);
  };
  return asked;
}

test("reading.supertonic: 지원하는 언어인지 목록으로 가린다", () => {
  assert.equal(isValidLang("ko"), true);
  assert.equal(isValidLang("xx"), false);
});

test("reading.supertonic: 글자를 인덱서 번호로 바꾸고, 인덱서 밖 글자는 -1 로 둔다", () => {
  const processor = new UnicodeProcessor(Array.from({ length: 128 }, (_, cp) => cp * 2));
  const { textIds, textMask } = processor.call(["가"], ["ko"]);

  // "<ko>" + NFKD 로 풀린 자모 둘 + 붙인 마침표 + "</ko>"
  assert.deepEqual(textIds, [[120, 214, 222, 124, -1, -1, 92, 120, 94, 214, 222, 124]]);
  assert.deepEqual(textMask, [[[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]]]);
});

test("reading.supertonic: 길이가 다른 대사를 함께 넣으면 짧은 쪽을 0 으로 채우고 마스크로 가린다", () => {
  const processor = new UnicodeProcessor(identityIndexer);
  const { textIds, textMask } = processor.call(["Hi", "Hey"], ["en", "en"]);

  assert.deepEqual(
    textIds.map((row) => row.map((cp) => (cp ? String.fromCodePoint(cp) : "_")).join("")),
    ["<en>Hi.</en>_", "<en>Hey.</en>"],
  );
  assert.deepEqual(textMask, [[[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]], [[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]]]);
});

test("reading.supertonic: 읽지 못할 기호를 걷고 띄어쓰기·따옴표를 고르고, 문장부호가 없으면 마침표를 붙인다", () => {
  const processor = new UnicodeProcessor(identityIndexer);

  assert.equal(processor.preprocessText("Hello 😀 world", "en"), "<en>Hello world.</en>");
  assert.equal(
    processor.preprocessText("Say “hi” — e.g., me@home , ok ?", "en"),
    '<en>Say "hi" - for example, me at home, ok?</en>',
  );
  assert.equal(processor.preprocessText("©♥ ''a'' [b] x\\y", "en"), "<en>'a' b xy.</en>");
  assert.equal(processor.preprocessText("i.e., one_two #3 / a|b", "en"), "<en>that is, one two 3 a b.</en>");
});

test("reading.supertonic: 모르는 언어 태그면 지원 목록을 담아 오류를 던진다", () => {
  const processor = new UnicodeProcessor(identityIndexer);
  assert.throws(() => processor.call(["hi"], ["xx"]), /^Error: Invalid language: xx\. Available: en, ko, ja, ar, /);
});

test("reading.supertonic: 묶음 추론은 속도로 나눈 길이만큼 잠재 공간을 잡고, 되돌리기 단계마다 결과를 다음 단계에 넘긴다", async () => {
  const { runs, sessions } = fakeModels({ durations: [[0.5, 0.25]], wavs: [[0.1, -0.2, 0.3]] });
  const tts = new TextToSpeech(CFGS, new UnicodeProcessor(identityIndexer), ...sessions);
  const style = singleStyle();
  const progress = [];

  const out = await tts.batch(["Hi", "Yo!"], ["en", "en"], style, 2, 2, (step, total) => progress.push([step, total]));

  assert.deepEqual(out, { wav: [0.1, -0.2, 0.3], duration: [0.25, 0.125] });
  assert.deepEqual(progress, [
    [1, 2],
    [2, 2],
  ]);

  const [dpIn] = runs.dp;
  assert.equal(dpIn.text_ids.type, "int64");
  assert.deepEqual(dpIn.text_ids.dims, [2, 12]);
  assert.deepEqual(decode(dpIn.text_ids), ["<en>Hi.</en>", "<en>Yo!</en>"]);
  assert.deepEqual(dpIn.text_mask.dims, [2, 1, 12]);
  assert.equal(dpIn.style_dp, style.dp);
  assert.equal(runs.textEnc[0].style_ttl, style.ttl);
  assert.equal(runs.textEnc[0].text_ids, dpIn.text_ids);

  // 길이 0.25초·0.125초 → 25·12 표본 → 4칸 조각으로 7칸·3칸. 짧은 쪽 뒤 4칸은 잡음 없이 0.
  const unmasked = [1, 1, 1, 1, 1, 1, 1];
  const shortRow = [1, 1, 1, 0, 0, 0, 0];
  const [first, second] = runs.vectorEst;
  assert.deepEqual(first.noisy_latent.dims, [2, 6, 7]);
  assert.deepEqual(Array.from(first.noisy_latent.data), [
    ...Array(6).fill(unmasked).flat(),
    ...Array(6).fill(shortRow).flat(),
  ]);
  assert.deepEqual(first.latent_mask.dims, [2, 1, 7]);
  assert.deepEqual(Array.from(first.latent_mask.data), [...unmasked, ...shortRow]);
  assert.deepEqual(Array.from(first.current_step.data), [0, 0]);
  assert.deepEqual(Array.from(first.total_step.data), [2, 2]);
  assert.equal(first.text_emb.name, "text_emb");
  assert.deepEqual(Array.from(second.current_step.data), [1, 1]);
  assert.deepEqual(Array.from(second.noisy_latent.data).slice(0, 7), [2, 2, 2, 2, 2, 2, 2]);

  const [vocIn] = runs.vocoder;
  assert.deepEqual(vocIn.latent.dims, [2, 6, 7]);
  assert.deepEqual(Array.from(vocIn.latent.data).slice(42, 49), [4, 4, 4, 0, 0, 0, 0]);
});

test("reading.supertonic: 한국어 대사가 120자를 넘으면 문장으로 나눠 합성하고 사이에 무음을 넣어 잇는다", async () => {
  const s1 = `${"가".repeat(69)}.`;
  const s2 = `${"나".repeat(69)}!`;
  const { runs, sessions } = fakeModels({ durations: [[0.5], [0.25]], wavs: [[0.1, 0.2], [0.3]] });
  const tts = new TextToSpeech(CFGS, new UnicodeProcessor(identityIndexer), ...sessions);

  const out = await tts.call(`${s1} ${s2}`, "ko", singleStyle(), 1, 1, 0.05);

  assert.deepEqual(
    runs.dp.map((r) => decode(r.text_ids)[0]),
    [`<ko>${s1}</ko>`, `<ko>${s2}</ko>`],
  );
  assert.deepEqual(out, { wav: [0.1, 0.2, 0, 0, 0, 0, 0, 0.3], duration: [0.8] });
});

test("reading.supertonic: 빈 줄로 나뉜 문단은 짧아도 따로 합성하고, 한도를 넘는 한 문장은 자르지 않는다", async () => {
  const long = `${"다".repeat(130)}.`;
  const { runs, sessions } = fakeModels({
    durations: [[0.01], [0.01], [0.01], [0.01]],
    wavs: [[0.5], [0.5], [0.5], [0.5]],
  });
  const tts = new TextToSpeech(CFGS, new UnicodeProcessor(identityIndexer), ...sessions);

  await tts.call("첫 줄\n\n  \n둘째 줄", "ko", singleStyle(), 1, 1, 0);
  await tts.call(`${long} 끝.`, "ko", singleStyle(), 1, 1, 0);

  assert.deepEqual(
    runs.dp.map((r) => decode(r.text_ids)[0]),
    ["<ko>첫 줄.</ko>", "<ko>둘째 줄.</ko>", `<ko>${long}</ko>`, "<ko>끝.</ko>"],
  );
});

test("reading.supertonic: 영어 대사는 300자까지 한 조각으로 합성하고 Mr. 같은 줄임말에서 끊지 않는다", async () => {
  const s1 = `Mr. Kim ${"a".repeat(200)}.`;
  const s2 = `${"b".repeat(150)}?`;
  const { runs, sessions } = fakeModels({ durations: [[0.01], [0.01]], wavs: [[0], [0]] });
  const tts = new TextToSpeech(CFGS, new UnicodeProcessor(identityIndexer), ...sessions);

  await tts.call(`${s1} ${s2}`, "en", singleStyle(), 1);

  assert.deepEqual(
    runs.dp.map((r) => decode(r.text_ids)[0]),
    [`<en>${s1}</en>`, `<en>${s2}</en>`],
  );
});

test("reading.supertonic: 여러 화자 스타일이나 글이 아닌 대사는 합성 전에 거절한다", async () => {
  const { runs, sessions } = fakeModels({ durations: [], wavs: [] });
  const tts = new TextToSpeech(CFGS, new UnicodeProcessor(identityIndexer), ...sessions);
  const two = new Style(new ort.Tensor("float32", new Float32Array(4), [2, 1, 2]), null);

  await assert.rejects(tts.call("안녕", "ko", two, 1), { message: "Single speaker text to speech only supports single style" });
  await assert.rejects(tts.call(42, "ko", singleStyle(), 1), { message: "chunkText expects a string, got number" });
  assert.equal(runs.dp.length, 0);
});

test("reading.supertonic: 길이를 따로 주지 않으면 가장 긴 길이로 마스크를 만든다", () => {
  const tts = new TextToSpeech(CFGS, null, null, null, null, null);
  assert.deepEqual(tts.lengthToMask([2, 1]), [[[1, 1]], [[1, 0]]]);
  assert.deepEqual(new UnicodeProcessor([]).lengthToMask([1, 3]), [[[1, 0, 0]], [[1, 1, 1]]]);
});

test("reading.supertonic: 목소리 파일 여러 개를 한 텐서로 이어 붙인다", async () => {
  const asked = serveJson({
    "/v/A.json": { style_ttl: { dims: [1, 2, 2], data: [[[1, 2], [3, 4]]] }, style_dp: { dims: [1, 1, 2], data: [[[5, 6]]] } },
    "/v/B.json": { style_ttl: { dims: [1, 2, 2], data: [[[10, 20], [30, 40]]] }, style_dp: { dims: [1, 1, 2], data: [[[50, 60]]] } },
  });

  const style = await loadVoiceStyle(["/v/A.json", "/v/B.json"], true);

  assert.ok(style instanceof Style);
  assert.deepEqual(style.ttl.dims, [2, 2, 2]);
  assert.deepEqual(Array.from(style.ttl.data), [1, 2, 3, 4, 10, 20, 30, 40]);
  assert.deepEqual(style.dp.dims, [2, 1, 2]);
  assert.deepEqual(Array.from(style.dp.data), [5, 6, 50, 60]);
  assert.deepEqual(asked, ["/v/A.json", "/v/A.json", "/v/B.json"]);
  assert.deepEqual(logged, ["Loaded 2 voice styles"]);
});

test("reading.supertonic: 모델 폴더에서 설정·인덱서·세션 넷을 불러와 바로 쓸 수 있는 엔진을 만든다", async () => {
  ort.created.length = 0;
  ort.sessions.factory = (source) => ({ source });
  serveJson({
    "/m/tts.json": { ...CFGS, ae: { ...CFGS.ae, sample_rate: 24000 } },
    "/m/unicode_indexer.json": Array.from({ length: 128 }, (_, cp) => cp + 1000),
  });
  const steps = [];

  const { textToSpeech, cfgs } = await loadTextToSpeech("/m", { executionProviders: ["wasm"] }, (...a) => steps.push(a));

  assert.equal(cfgs.ae.sample_rate, 24000);
  assert.equal(textToSpeech.sampleRate, 24000);
  assert.deepEqual(ort.created, [
    { source: "/m/duration_predictor.onnx", options: { executionProviders: ["wasm"] } },
    { source: "/m/text_encoder.onnx", options: { executionProviders: ["wasm"] } },
    { source: "/m/vector_estimator.onnx", options: { executionProviders: ["wasm"] } },
    { source: "/m/vocoder.onnx", options: { executionProviders: ["wasm"] } },
  ]);
  assert.deepEqual(
    [textToSpeech.dpOrt, textToSpeech.textEncOrt, textToSpeech.vectorEstOrt, textToSpeech.vocoderOrt].map((s) => s.source),
    ["/m/duration_predictor.onnx", "/m/text_encoder.onnx", "/m/vector_estimator.onnx", "/m/vocoder.onnx"],
  );
  assert.deepEqual(steps, [
    ["Duration Predictor", 1, 4],
    ["Text Encoder", 2, 4],
    ["Vector Estimator", 3, 4],
    ["Vocoder", 4, 4],
  ]);
  assert.deepEqual(textToSpeech.textProcessor.call(["a"], ["en"]).textIds, [
    [1060, 1101, 1110, 1062, 1097, 1046, 1060, 1047, 1101, 1110, 1062],
  ]);

  const again = await loadTextToSpeech("/m");
  assert.equal(again.textToSpeech.sampleRate, 24000);
  assert.deepEqual(ort.created.slice(4).map((c) => c.options), [{}, {}, {}, {}]);
});

test("reading.supertonic: 표본을 16비트 모노 wav 로 쓰고 -1~1 밖은 잘라 낸다", () => {
  const buffer = writeWavFile([0, 0.5, -1, 2, -3], 24000);
  const view = new DataView(buffer);
  const ascii = (at, n) => String.fromCharCode(...new Uint8Array(buffer, at, n));

  assert.equal(buffer.byteLength, 54);
  assert.equal(ascii(0, 4), "RIFF");
  assert.equal(view.getUint32(4, true), 46);
  assert.equal(ascii(8, 8), "WAVEfmt ");
  assert.equal(view.getUint32(16, true), 16);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 24000);
  assert.equal(view.getUint32(28, true), 48000);
  assert.equal(view.getUint16(32, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(ascii(36, 4), "data");
  assert.equal(view.getUint32(40, true), 10);
  assert.deepEqual(Array.from(new Int16Array(buffer, 44)), [0, 16383, -32767, 32767, -32767]);
});
