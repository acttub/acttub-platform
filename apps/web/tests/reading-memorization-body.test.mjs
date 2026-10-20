// reading.memorization — 암기 화면 본문. 실제 암기 상태 동기화(createMemorizationSync)를 붙여 그리고, 모드·보조 버튼을
// 누르고 외워서 말해 본 뒤 보이는 글자와 서버로 보낸 표시를 본다. 음성인식·기기 음성은 대역으로 바꾼다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";

const stubs = new URL("./fixtures/reading-memorization-stubs.mjs", import.meta.url).href;
const replaced = new Set(["@/lib/reading/audio/stt", "@/lib/reading/audio/tts"]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (replaced.has(specifier)) return { url: stubs, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { resetVoiceStubs, stt, tts } = await import("./fixtures/reading-memorization-stubs.mjs");
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { MemorizationBody, NO_SPEECH_NOTE } = await import("../src/features/reading/screens/MemorizationBody.tsx");
const { createMemorizationSync } = await import("../src/lib/reading/memorization/sync.ts");

const LINE = "너 힘들면 항상 높은 데로 가잖아.";
const script = {
  id: "script-1",
  title: "봄밤",
  roles: ["니나", "트레"],
  characters: [],
  lines: [
    { type: "dialogue", role: "트레", text: "둘." },
    { type: "dialogue", role: "니나", text: LINE },
    { type: "dialogue", role: "니나", text: "(웃으며) 그래 넷." },
  ],
  lineIds: ["l-0", "l-1", "l-2"],
  raw: "",
  lastSession: null,
};

let sent;
let calls;
let sendFails;

function mount({ entries = [], lineIds = null, roles = ["니나"] } = {}) {
  const sync = createMemorizationSync({
    initial: entries,
    send: async (lineId, status) => {
      sent.push([lineId, status]);
      if (sendFails) throw new Error("offline");
      return { line_id: lineId, status, updated_at: "2026-10-20T00:00:00Z" };
    },
  });
  return render(
    react.createElement(MemorizationBody, {
      script,
      roles,
      lineIds,
      sync,
      onRolesChange: (r) => calls.roles.push(r),
      onBack: () => calls.back++,
      onReading: () => calls.reading++,
    }),
  );
}

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
const seen = (s) => document.body.textContent.includes(s);
const click = (name) => fireEvent.click(screen.getByRole("button", { name }));
const type = async (value) => {
  fireEvent.change(screen.getByPlaceholderText("대사 입력"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  await flush();
};

beforeEach(() => {
  resetVoiceStubs();
  sent = [];
  sendFails = false;
  calls = { roles: [], back: 0, reading: 0 };
});

afterEach(() => {
  cleanup();
});

test("reading.memorization: 가리고 연습은 어절마다 길이만큼 가리고, 빈칸·첫 글자·힌트·원문 보기가 가린 정도를 바꾼다", () => {
  mount();

  assert.equal(seen("니나 · 2번 대사"), true);
  assert.equal(seen("1 / 2"), true);
  assert.equal(seen("·"+"···"+"··"+"··"+"··"+"····"), true);
  assert.equal(seen("힘들면"), false);

  click("빈칸 연습");
  assert.equal(screen.getByRole("button", { name: "빈칸 연습" }).getAttribute("aria-pressed"), "true");
  assert.equal(seen("너···항상··데로····"), true);

  click("첫 글자 힌트");
  assert.equal(seen("너힘··항상높·데로가···"), true);
  click("첫 글자 힌트");

  click("첫 글자");
  assert.equal(seen("너힘··항상높·데로가···"), true);
  assert.equal(screen.queryByRole("button", { name: "첫 글자 힌트" }), null);

  click("원문 보기");
  assert.equal(seen(LINE), true);
  assert.equal(screen.queryByRole("button", { name: "원문 보기" }), null);
});

test("reading.memorization: 괄호 지문은 가리지 않고 그대로 보인다", () => {
  mount({ entries: [{ line_id: "l-1", status: "memorized", updated_at: "" }] });
  assert.equal(seen("니나 · 3번 대사"), true);
  assert.equal(seen("(웃으며)····"), true);
});

test("reading.memorization: 음성인식이 없으면 입력하기로 말해 보고, 원문과 맞으면 원문을 펼쳐 맞다고 알린다", async () => {
  mount();
  assert.equal(screen.queryByRole("button", { name: "말해보기" }), null);

  click("입력하기");
  await type(LINE);

  assert.equal(seen("원문과 맞아요. 외웠으면 아래에서 표시해요."), true);
  assert.equal(seen(LINE), true);
  assert.equal(seen("원문과 달라요"), false);
});

test("reading.memorization: 원문과 다르면 다시·넘어가기를 주고, 같은 줄에서 두 번 다르면 안내 없이 다음 줄로 간다", async () => {
  mount();
  click("입력하기");

  await type("전혀 상관없는 말을 해 본다");
  assert.equal(seen("원문과 달라요. 다시 말하거나 넘어갈 수 있어요."), true);
  assert.equal(seen("전혀 상관없는 말을 해 본다"), true);

  click("다시");
  assert.equal(seen("원문과 달라요"), false);
  assert.equal(seen("아직 없어요"), true);

  await type("이번에도 엉뚱한 소리를 한다");
  assert.equal(seen("니나 · 3번 대사"), true);
  assert.equal(seen("2 / 2"), true);
  assert.equal(seen("원문과 달라요"), false);
  assert.deepEqual(sent, [], "넘어가도 암기 표시는 바꾸지 않는다");
});

test("reading.memorization: 넘어가기를 누르면 다음 줄로 가고, 말한 게 없으면 못 알아들었다고만 알린다", async () => {
  mount();
  click("입력하기");

  await type("...");
  assert.equal(seen(NO_SPEECH_NOTE), true);
  assert.equal(seen("원문과 달라요"), false);

  await type("엉뚱한 대사를 말했다");
  click("넘어가기");
  assert.equal(seen("니나 · 3번 대사"), true);
  assert.equal(seen("아직 없어요"), true);
});

test("reading.memorization: 말해보기는 인식 중 글자를 보여 주고, 지금 확정을 누를 수 있고, 인식 결과를 원문과 대조한다", async () => {
  stt.available = true;
  mount();
  assert.equal(seen("말소리는 브라우저 음성 서비스로 가요. 말한 것은 맞춰 보는 데만 쓰고 저장하지 않아요."), true);

  click("말해보기");
  const [session] = stt.sessions;
  act(() => session.cb.onListening());
  assert.equal(seen("듣는 중 · 말하는 대로 적혀요"), true);
  assert.equal(seen("듣고 있어요…"), true);
  assert.equal(screen.getByRole("button", { name: "말해보기" }).disabled, true);

  act(() => session.cb.onInterim("너 힘들면"));
  assert.equal(seen("너 힘들면"), true);

  click("지금 확정");
  assert.equal(session.finished, 1);

  act(() => session.cb.onText(LINE));
  assert.equal(seen("외워서 말해보기"), true);
  assert.equal(seen("원문과 맞아요. 외웠으면 아래에서 표시해요."), true);
});

test("reading.memorization: 인식이 막히면 이유를 알리고 입력하기를 열며, 말소리가 없으면 다시 말하라고 한다", () => {
  stt.available = true;
  mount();

  click("말해보기");
  act(() => stt.sessions[0].cb.onError("denied"));
  assert.equal(seen("마이크 권한이 없어요. 입력하기로 진행해요."), true);
  assert.ok(screen.getByPlaceholderText("대사 입력"));

  click("말해보기");
  assert.equal(stt.sessions[0].aborted, 1, "새로 들으면 앞의 인식을 끊는다");
  act(() => stt.sessions[1].cb.onError("unavailable"));
  assert.equal(seen("이 브라우저에선 음성인식이 안 돼요. 입력하기로 진행해요."), true);

  click("말해보기");
  act(() => stt.sessions[2].cb.onError("no-speech"));
  assert.equal(seen(NO_SPEECH_NOTE), true);

  click("입력하기");
  assert.equal(screen.queryByPlaceholderText("대사 입력"), null);
});

test("reading.memorization: 대본에서 들어와 외웠다고 표시하면 서버에 보내고 그 줄이 목록에서 빠진다", async () => {
  mount();
  assert.equal(seen("니나 역 · 암기하지 못한 대사 2개"), true);

  click("이 대사 외웠어요");
  await flush();

  assert.deepEqual(sent, [["l-1", "memorized"]]);
  assert.equal(seen("니나 역 · 암기하지 못한 대사 1개"), true);
  assert.equal(seen("외운 줄 1 / 내 대사 2"), true);
  assert.equal(seen("니나 · 3번 대사"), true);

  click("아직 헷갈려요");
  await flush();
  assert.deepEqual(sent, [["l-1", "memorized"], ["l-2", "not_yet"]]);
  assert.equal(seen("니나 · 3번 대사"), true);
});

test("reading.memorization: 다시 볼 대사로 들어오면 표시한 뒤 다음 줄로 가고, 보내지 못한 표시는 저장 중으로 남는다", async () => {
  sendFails = true;
  mount({ lineIds: ["l-1", "l-2"] });
  assert.equal(screen.queryByRole("button", { name: "니나" }), null);

  click("아직 헷갈려요");
  await flush();

  assert.deepEqual(sent, [["l-1", "not_yet"]]);
  assert.equal(seen("니나 · 3번 대사"), true);
  assert.equal(seen("표시 저장 중 1"), true);
});

test("reading.memorization: 배역 단추로 배역을 넣고 빼며, 외운 대사도 보기를 켜면 외운 줄이 표시와 함께 나온다", async () => {
  mount({ entries: [{ line_id: "l-1", status: "memorized", updated_at: "" }] });

  click("트레");
  click("니나");
  assert.deepEqual(calls.roles, [["니나", "트레"], []]);

  fireEvent.click(screen.getByRole("checkbox", { name: "외운 대사도 보기" }));
  assert.equal(seen("니나 · 2번 대사 · 외웠어요"), true);
  assert.equal(seen("1 / 2"), true);

  click("이 대사 외웠어요");
  await flush();
  assert.equal(seen("니나 · 3번 대사"), true, "외운 줄도 보는 중이면 표시한 뒤 다음 줄로 간다");
});

test("reading.memorization: 이전·다음으로 줄을 옮기고, 끝에서는 그 방향 단추가 꺼진다", () => {
  mount();
  assert.equal(screen.getByRole("button", { name: /이전/ }).disabled, true);

  click(/다음/);
  assert.equal(seen("2 / 2"), true);
  assert.equal(screen.getByRole("button", { name: /다음/ }).disabled, true);

  click(/이전/);
  assert.equal(seen("1 / 2"), true);
});

test("reading.memorization: 대상이 없으면 외운 대사도 보기와 리딩하러 가기를 주고, 뒤로를 누르면 나간다", () => {
  mount({
    entries: [
      { line_id: "l-1", status: "memorized", updated_at: "" },
      { line_id: "l-2", status: "memorized", updated_at: "" },
    ],
  });

  click("리딩하러 가기");
  click("뒤로");
  assert.deepEqual([calls.reading, calls.back], [1, 1]);

  click("외운 대사도 보기");
  assert.equal(seen("니나 · 2번 대사 · 외웠어요"), true);
});

test("reading.memorization: 다시 볼 대사가 모두 지워졌으면 외운 대사도 보기 없이 리딩으로 가는 길만 준다", () => {
  mount({ lineIds: ["l-9"] });
  assert.equal(seen("못 외운 대사가 없어요"), true);
  assert.equal(screen.queryByRole("button", { name: "외운 대사도 보기" }), null);
});

test("reading.memorization: 원문 듣기는 마이크를 열지 않고 기기 음성으로 읽고, 기기 음성이 없으면 알린다", async () => {
  mount();

  click("원문 듣기");
  await flush();
  assert.deepEqual(
    tts.calls.map(({ text, tempo }) => ({ text, tempo })),
    [{ text: LINE, tempo: 1 }],
  );
  assert.equal(tts.unlocked, 1);
  assert.equal(stt.sessions.length, 0);

  tts.result = false;
  click("원문 듣기");
  await flush();
  assert.equal(seen("이 브라우저는 기기 음성을 지원하지 않아요."), true);
});

test("reading.memorization: 듣고 따라 하기는 천천히 0.7× 로 바꿀 수 있고, 재생이 끝난 뒤에만 인식을 연다", async () => {
  mount();
  click("듣고 따라 하기");
  click("1.0×");
  assert.ok(screen.getByRole("button", { name: "천천히 0.7×" }));

  let release;
  tts.gate = new Promise((r) => {
    release = r;
  });
  click("듣고 따라 말하기");
  await flush();

  assert.deepEqual(tts.calls.map((c) => c.tempo), [0.7]);
  assert.equal(stt.sessions.length, 0, "재생 중에는 인식을 열지 않는다");
  assert.equal(screen.getByRole("button", { name: "원문 듣기" }).disabled, true);
  assert.equal(screen.getByRole("button", { name: "듣고 따라 말하기" }).disabled, true);

  release();
  await flush();
  assert.equal(stt.sessions.length, 1);
  assert.equal(screen.getByRole("button", { name: "원문 듣기" }).disabled, false);

  click("천천히 0.7×");
  assert.ok(screen.getByRole("button", { name: "1.0×" }));
});

test("reading.memorization: 기기 음성이 없으면 듣고 따라 말하기가 인식을 열지 않는다", async () => {
  tts.result = false;
  mount();
  click("듣고 따라 하기");

  click("듣고 따라 말하기");
  await flush();

  assert.equal(stt.sessions.length, 0);
  assert.equal(seen("이 브라우저는 기기 음성을 지원하지 않아요."), true);
});

test("reading.memorization: 줄을 옮기거나 화면을 닫으면 듣던 인식과 재생을 끊는다", async () => {
  stt.available = true;
  const view = mount();

  click("말해보기");
  click("원문 듣기");
  await flush();
  const firstSignal = tts.calls[0].signal;

  click(/다음/);
  assert.equal(stt.sessions[0].aborted, 1);

  click("말해보기");
  tts.gate = new Promise(() => {});
  click("원문 듣기");
  view.unmount();

  assert.equal(stt.sessions[1].aborted, 1);
  assert.equal(tts.calls[1].signal.aborted, true);
  assert.equal(firstSignal.aborted, true);
});
