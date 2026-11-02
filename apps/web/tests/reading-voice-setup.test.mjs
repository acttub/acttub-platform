// reading.cast — 상대역 목소리 준비(VoiceSetup). 들어오면 묻지 않고 모델을 받으며 진행률을 보이고, 받지 못하면 자동으로
// 바꾸지 않고 다시 시도·글로 보기(기본)·기기 음성 셋을 준다. 부모에게는 시작해도 되는지와 상대 대사를 낼 방법을 알린다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";

const fake = new URL("./fixtures/reading-voice-setup-tts.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/reading/audio/tts") return { url: fake, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { tts } = await import("./fixtures/reading-voice-setup-tts.mjs");
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { VoiceSetup } = await import("../src/features/reading/voice-setup.tsx");

const tick = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

let told;
function mount() {
  told = [];
  return render(react.createElement(VoiceSetup, { onChange: (s) => told.push(s) }));
}

beforeEach(() => {
  tts.engine = "device";
  tts.supported = true;
  tts.voices = [{ lang: "ko-KR" }];
  tts.loads.length = 0;
});

afterEach(cleanup);

test("reading.cast: 들어오면 모델을 받기 시작해 시작을 잠그고, 다 받으면 자연스러운 음성으로 시작할 수 있다", async () => {
  mount();
  screen.getByText(/상대 목소리를 준비하고 있어요\. 처음 한 번만 받아요/);
  await tick();
  assert.deepEqual(told, [{ ready: false, partnerVoice: "supertonic" }]);
  assert.equal(tts.loads.length, 1);

  await act(async () => {
    tts.loads[0].onProgress({ ratio: 0.42, loaded: 42, total: 100, cached: false });
    tts.loads[0].resolve();
  });

  screen.getByText("자연스러운 음성으로 읽어요. 대사는 기기 밖으로 나가지 않아요.");
  assert.deepEqual(told.at(-1), { ready: true, partnerVoice: "supertonic" });
});

test("reading.cast: 같은 탭에서 이미 켜 두었으면 받지 않고 바로 시작할 수 있다", async () => {
  tts.engine = "supertonic";
  mount();
  screen.getByText("자연스러운 음성으로 읽어요. 대사는 기기 밖으로 나가지 않아요.");
  await tick();
  assert.deepEqual(told, [{ ready: true, partnerVoice: "supertonic" }]);
  assert.equal(tts.loads.length, 0);
});

test("reading.cast: 받지 못하면 자동으로 바꾸지 않고 글로 보기를 기본으로 시작할 수 있게 하며, 기기 음성을 고를 수 있다", async () => {
  mount();
  await tick();
  await act(async () => tts.loads[0].reject(new Error("quota")));

  screen.getByText("상대 목소리를 준비하지 못했어요. 어떻게 할지 골라 주세요.");
  assert.deepEqual(told.at(-1), { ready: true, partnerVoice: "text" });
  assert.equal(screen.getByRole("button", { name: "글로 보기" }).getAttribute("aria-pressed"), "true");
  screen.getByText("글로 보기는 상대 대사를 소리 없이 보여 주고 다음을 눌러 넘겨요.");

  fireEvent.click(screen.getByRole("button", { name: "기기 음성으로 읽기" }));
  assert.deepEqual(told.at(-1), { ready: true, partnerVoice: "device" });
  assert.equal(screen.getByRole("button", { name: "기기 음성으로 읽기" }).getAttribute("aria-pressed"), "true");

  fireEvent.click(screen.getByRole("button", { name: "글로 보기" }));
  assert.deepEqual(told.at(-1), { ready: true, partnerVoice: "text" });
});

test("reading.cast: 다시 시도하면 시작을 잠그고 다시 받아, 성공하면 자연스러운 음성으로 바뀐다", async () => {
  mount();
  await tick();
  await act(async () => tts.loads[0].reject(new Error("offline")));

  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  assert.deepEqual(told.at(-1), { ready: false, partnerVoice: "supertonic" });
  screen.getByText(/상대 목소리를 준비하고 있어요/);

  await act(async () => tts.loads[1].resolve());
  assert.deepEqual(told.at(-1), { ready: true, partnerVoice: "supertonic" });
});

test("reading.cast: 기기 음성이 없으면 고를 수 없고, 한국어 음성이 없으면 그 사실을 함께 알린다", async () => {
  tts.supported = false;
  mount();
  await tick();
  await act(async () => tts.loads[0].reject(new Error("x")));
  assert.equal(screen.getByRole("button", { name: "기기 음성으로 읽기" }).disabled, true);
  cleanup();

  tts.supported = true;
  tts.voices = [];
  tts.loads.length = 0;
  mount();
  await tick();
  await act(async () => tts.loads[0].reject(new Error("x")));
  screen.getByText("글로 보기는 상대 대사를 소리 없이 보여 주고 다음을 눌러 넘겨요. 기기에 한국어 음성이 없어요.");
});

test("reading.cast: 받는 중에 화면을 떠나면 받기가 끝나거나 실패해도 부모에게 알리지 않는다", async () => {
  for (const settle of ["resolve", "reject"]) {
    tts.loads.length = 0;
    const view = mount();
    await tick();
    view.unmount();

    await act(async () => tts.loads[0][settle](new Error("x")));
    assert.deepEqual(told, [{ ready: false, partnerVoice: "supertonic" }], settle);
  }
});

test("reading.cast: 그리기 직후 바로 떠나면 받기를 시작하지 않는다", async () => {
  const view = mount();
  view.unmount();
  await tick();
  assert.equal(tts.loads.length, 0);
  assert.deepEqual(told, []);
});
