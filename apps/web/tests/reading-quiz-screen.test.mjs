// reading.session·reading.memorization 웹 암기 대조(quiz) 화면. 내 대사는 가려지고, 말한 것을 기기 STT 로 원문과 맞춰
// 통과면 다음 줄로, 미달이면 "다시"·"넘어가기"를 주고 같은 줄에 머문다. 같은 줄 2회 미달이면 안내 없이 넘어간다.
// 상대 재생기·녹음기·STT·진행 저장 API 는 대역(fixtures/reading-quiz-screen-probe.mjs)이고 진행 상태와 줄 결과 장부는 진짜다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, mock, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";

// jsdom 에는 스크롤이 없다. 옆 대본 목록이 지금 줄로 스크롤하는 것은 이 화면이 보는 결과가 아니다.
window.HTMLElement.prototype.scrollIntoView = () => {};

const probeUrl = new URL("./fixtures/reading-quiz-screen-probe.mjs", import.meta.url).href;
const replaced = new Set([
  "@/features/reading/hooks/useRehearsalRunner",
  "@/features/reading/hooks/useLineRecorder",
  "@/lib/reading/audio/stt",
  "@/lib/reading/audio/tts",
  "@/lib/api/v2/reading-sessions",
  "@/features/reading/voice-setup",
  "@/features/nav/app-rail",
]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (replaced.has(specifier)) return { url: probeUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { quiz, resetQuiz } = await import("./fixtures/reading-quiz-screen-probe.mjs");
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { QuizScreen } = await import("../src/features/reading/screens/QuizScreen.tsx");
const { NO_SPEECH_NOTICE } = await import("../src/features/reading/session-copy.ts");

const script = {
  id: "script-1",
  title: "카페",
  roles: ["지수", "민준"],
  characters: [
    { id: "c-j", name: "지수", voicePreset: null, voice: "F1" },
    { id: "c-m", name: "민준", voicePreset: null, voice: "M1" },
  ],
  lines: [
    { type: "direction", text: "카페. 저녁." },
    { type: "dialogue", role: "민준", text: "오래 기다렸어?" },
    { type: "dialogue", role: "지수", text: "아니, 나도 방금 왔어." },
    { type: "dialogue", role: "민준", text: "다행이다." },
    { type: "dialogue", role: "지수", text: "(웃으며) 고마워." },
  ],
  lineIds: ["l-0", "l-1", "l-2", "l-3", "l-4"],
  lastSession: null,
};

function sessionOf(overrides = {}) {
  return {
    id: "session-1",
    ordinal: 1,
    status: "in_progress",
    my_character_ids: ["c-j"],
    my_character_names: ["지수"],
    range: "full",
    range_name: "full",
    progress: null,
    my_dialogue_count: 2,
    recorded_line_count: 0,
    elapsed_seconds: 0,
    started_at: "2026-10-20T00:00:00Z",
    ended_at: null,
    script_id: "script-1",
    mode: "quiz",
    advance: "silence",
    record: false,
    start_line_id: "l-1",
    end_line_id: "l-4",
    current_line_id: null,
    progress_seq: 0,
    line_results: [],
    recordings: [],
    different_lines: [],
    ...overrides,
  };
}

let finished;
let exits;

function show({ session = sessionOf(), partnerVoice = "device", lines } = {}) {
  finished = [];
  exits = 0;
  const s = lines ? { ...script, lines, lineIds: lines.map((_, i) => `l-${i}`) } : script;
  render(
    react.createElement(QuizScreen, {
      script: s,
      session,
      partnerVoice,
      onFinish: (stats) => finished.push(stats),
      onExit: () => exits++,
    }),
  );
}

const button = (name) => screen.getByRole("button", { name });
const click = (name) => act(() => fireEvent.click(button(name)));
// 옆 대본 목록(aside)에도 같은 대사가 있으므로 무대와 목록을 나눠 본다.
const matches = (text) => screen.queryAllByText(text, { exact: false });
const has = (text) => matches(text).some((el) => !el.closest("aside"));
const listed = (text) => matches(text).some((el) => el.closest("aside"));
const tick = (ms) => act(() => mock.timers.tick(ms));
const flush = () => act(async () => {});
const listening = () => quiz.stt.sessions.at(-1);
const savedResults = () => quiz.saved.at(-1)?.body.line_results;

async function toMyFirstLine() {
  show();
  click("시작");
  click("다음");
  await flush();
}

beforeEach(() => {
  resetQuiz();
  window.localStorage.clear();
  window.localStorage.setItem("acttub.reading.guide_seen", "1");
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
});

afterEach(() => {
  cleanup();
  mock.timers.reset();
});

test("reading.quiz: 시작 전에는 시작 버튼만 있고, 누르면 첫 상대 대사를 그대로 보여 준다", async () => {
  show();
  assert.equal(has("내 차례엔 대사가 가려지고 마이크가 켜져요."), true);
  assert.deepEqual(quiz.runner.cfg, { lines: script.lines, myRoles: ["지수"], start: 1, end: 4, from: undefined });
  assert.equal(quiz.runner.opts.myTurn, "wait");
  click("시작");
  await flush();
  assert.deepEqual(quiz.runner.calls, ["start"]);
  assert.equal(has("오래 기다렸어?"), true);
  assert.equal(has("상대가 읽는 중 · 끝나면 내 차례"), true);
  assert.equal(has("0 / 4 · 00:00"), true);
  assert.deepEqual(quiz.stt.sessions, []);
});

test("reading.quiz: 내 차례가 되면 대사를 가리고 첫 글자 힌트를 주며 알아서 듣기 시작한다", async () => {
  await toMyFirstLine();
  assert.equal(has("지수 · 내 대사"), true);
  assert.equal(has("아니, 나도 방금 왔어."), false);
  assert.equal(has("첫 글자 힌트: 아"), true);
  assert.equal(quiz.stt.sessions.length, 1);
  assert.equal(button("지금 확정").disabled, true);
  assert.equal(has("말소리는 브라우저 음성 서비스로 가요."), true);

  act(() => listening().cb.onListening());
  assert.equal(has("듣는 중 · 말하는 대로 적혀요"), true);
  assert.equal(has("듣고 있어요…"), true);
  act(() => listening().cb.onInterim("아니 나도"));
  assert.equal(has("아니 나도"), true);
  click("지금 확정");
  assert.deepEqual(listening().calls, ["finish"]);
});

test("reading.quiz: 괄호 지문으로 시작하는 내 대사의 첫 글자 힌트는 지문 뒤의 첫 글자다", async () => {
  await toMyFirstLine();
  act(() => listening().cb.onText("아니 나도 방금 왔어"));
  tick(700);
  click("다음");
  await flush();
  assert.equal(has("첫 글자 힌트: 고"), true);
});

test("reading.quiz: 원문과 맞게 말하면 대사를 드러내고 통과로 남긴 뒤 0.7초 뒤 다음 줄로 간다", async () => {
  await toMyFirstLine();
  act(() => listening().cb.onListening());
  act(() => listening().cb.onText("아니 나도 방금 왔어"));
  assert.equal(has("아니, 나도 방금 왔어."), true);
  assert.equal(has("이렇게 들었어요"), true);
  assert.deepEqual(quiz.rec.notes, [["l-2", "아니 나도 방금 왔어", true, "stt"]]);
  assert.deepEqual(listening().calls, ["abort"]);
  tick(699);
  assert.deepEqual(quiz.runner.calls, ["start", "next"]);
  tick(1);
  await flush();
  assert.deepEqual(quiz.runner.calls, ["start", "next", "next"]);
  assert.equal(has("다행이다."), true);
  assert.deepEqual(savedResults(), [{ line_id: "l-2", outcome: "passed", misses: 0 }]);
  assert.equal(quiz.saved.at(-1).body.current_line_id, "l-3");
});

test("reading.quiz: 다르게 말하면 같은 줄에 머물며 말한 것을 그대로 보이고 다시 말할 수 있게 한다", async () => {
  await toMyFirstLine();
  act(() => listening().cb.onText("전혀 다른 말"));
  assert.equal(has("대본과 달라요. 다시 말하거나 넘어갈 수 있어요."), true);
  assert.equal(has("전혀 다른 말"), true);
  assert.deepEqual(quiz.rec.notes, [["l-2", "전혀 다른 말", false, "stt"]]);
  tick(5000);
  assert.deepEqual(quiz.runner.calls, ["start", "next"]);
  assert.equal(quiz.stt.sessions.length, 1);

  click("다시");
  assert.deepEqual(quiz.rec.calls, ["restart"]);
  assert.equal(has("대본과 달라요."), false);
  assert.equal(has("아직 없어요"), true);
  assert.equal(quiz.stt.sessions.length, 2);
});

test("reading.quiz: 같은 줄에서 두 번째로 다르게 말하면 안내 없이 0.3초 뒤 넘어가고 unmatched 로 남긴다", async () => {
  await toMyFirstLine();
  act(() => listening().cb.onText("전혀 다른 말"));
  click("다시");
  act(() => listening().cb.onText("또 다른 말"));
  assert.equal(has("대본과 달라요."), false);
  tick(300);
  await flush();
  assert.deepEqual(quiz.runner.calls, ["start", "next", "next"]);
  assert.deepEqual(savedResults(), [{ line_id: "l-2", outcome: "unmatched", misses: 2 }]);
});

test("reading.quiz: 넘어가기는 그 줄을 skipped 로 남기고 다음 줄로 간다", async () => {
  await toMyFirstLine();
  click("넘어가기");
  await flush();
  assert.equal(has("다행이다."), true);
  assert.deepEqual(savedResults(), [{ line_id: "l-2", outcome: "skipped", misses: 0 }]);
});

test("reading.quiz: 인식기를 쓸 수 없거나 마이크 권한이 없으면 안내하고 입력하기 칸을 연다", async () => {
  const cases = [
    ["unavailable", "이 브라우저에선 음성인식이 안 돼요. 입력하기로 진행해요."],
    ["denied", "마이크 권한이 없어요. 입력하기로 진행해요."],
  ];
  for (const [reason, notice] of cases) {
    resetQuiz();
    await toMyFirstLine();
    act(() => listening().cb.onError(reason));
    assert.equal(has(notice), true, reason);
    assert.equal(screen.getByPlaceholderText("내 대사 입력").tagName, "INPUT", reason);
    assert.deepEqual(listening().calls, ["abort"], reason);
    cleanup();
  }
});

test("reading.quiz: 무발화·인식 실패는 안내만 하고 미달로 세지 않는다", async () => {
  await toMyFirstLine();
  act(() => listening().cb.onListening());
  act(() => listening().cb.onError("no-speech"));
  assert.equal(has(NO_SPEECH_NOTICE), true);
  assert.equal(has("말하면 알아서 맞춰봐요"), true);
  assert.equal(screen.queryByPlaceholderText("내 대사 입력"), null);
  act(() => listening().cb.onError("failed"));
  assert.equal(has("다시 말해 주세요."), true);
  click("넘어가기");
  await flush();
  assert.deepEqual(savedResults(), [{ line_id: "l-2", outcome: "skipped", misses: 0 }]);
  assert.deepEqual(quiz.rec.notes, []);
});

test("reading.quiz: 브라우저에 STT 가 없으면 마이크를 열지 않고 입력하기로 친 글을 대조한다", async () => {
  quiz.stt.available = false;
  await toMyFirstLine();
  assert.deepEqual(quiz.stt.sessions, []);
  assert.equal(has("말소리는 브라우저 음성 서비스로 가요."), false);
  click("입력하기");
  const input = screen.getByPlaceholderText("내 대사 입력");
  act(() => fireEvent.submit(input.form));
  assert.deepEqual(quiz.rec.notes, []);
  act(() => fireEvent.change(input, { target: { value: "  아니 나도 방금 왔어  " } }));
  click("확인");
  assert.deepEqual(quiz.rec.notes, [["l-2", "아니 나도 방금 왔어", true, "typed"]]);
  assert.equal(has("아니, 나도 방금 왔어."), true);
  click("입력하기");
  assert.equal(screen.queryByPlaceholderText("내 대사 입력"), null);
});

test("reading.quiz: 1,000자를 넘는 발화는 대조하지 않고 넘어가기를 안내하며 결과를 남기지 않는다", async () => {
  await toMyFirstLine();
  act(() => listening().cb.onText("아".repeat(1001)));
  assert.equal(has("대사가 길어 대조하지 않아요. 넘어가기로 진행해 주세요."), true);
  assert.deepEqual(quiz.rec.notes, []);
  tick(5000);
  assert.deepEqual(quiz.runner.calls, ["start", "next"]);
});

test("reading.quiz: 원문이 1,000자를 넘는 줄도 대조하지 않는다", async () => {
  const lines = [
    { type: "dialogue", role: "지수", text: "가".repeat(1001) },
    { type: "dialogue", role: "민준", text: "응." },
  ];
  show({ lines, session: sessionOf({ start_line_id: "l-0", end_line_id: "l-1" }) });
  click("시작");
  act(() => listening().cb.onText("가가가"));
  assert.equal(has("대사가 길어 대조하지 않아요."), true);
  assert.deepEqual(quiz.rec.notes, []);
});

test("reading.quiz: 원문 보기는 지금 줄의 내 대사만 잠깐 풀고 다음 줄에서는 다시 가린다", async () => {
  await toMyFirstLine();
  assert.equal(listed("아니, 나도 방금 왔어."), false);
  assert.equal(listed("오래 기다렸어?"), true);
  click("원문 보기");
  assert.equal(has("아니, 나도 방금 왔어."), true);
  assert.equal(listed("아니, 나도 방금 왔어."), true);
  assert.equal(screen.queryByRole("button", { name: "원문 보기" }), null);
  click("넘어가기");
  click("다음");
  await flush();
  assert.equal(has("(웃으며) 고마워."), false);
  assert.equal(button("원문 보기").tagName, "BUTTON");
});

test("reading.quiz: 지난 줄의 내 대사는 가린 채로 한 줄만 보인다", async () => {
  await toMyFirstLine();
  click("넘어가기");
  await flush();
  assert.equal(matches("· · ·").filter((el) => !el.closest("aside")).length, 1);
  assert.equal(has("아니, 나도 방금 왔어."), false);
  assert.equal(has("오래 기다렸어?"), false);
});

test("reading.quiz: 모두 가리기면 상대 대사도 가리고 원문 보기로 그 줄만 푼다", async () => {
  window.localStorage.setItem("acttub.reading.mask", JSON.stringify({ "script-1": "hide_all" }));
  show();
  click("시작");
  assert.equal(has("오래 기다렸어?"), false);
  click("원문 보기");
  assert.equal(has("오래 기다렸어?"), true);
});

test("reading.quiz: 가리기 버튼은 누를 때마다 다음 가리기로 바꾸고 대본마다 기억한다", () => {
  show();
  act(() => fireEvent.click(button("가리기: 모든 대사 보기")));
  act(() => fireEvent.click(button("가리기: 내 대사만 가리기")));
  assert.equal(button("가리기: 모든 대사 가리기").tagName, "BUTTON");
  assert.deepEqual(JSON.parse(window.localStorage.getItem("acttub.reading.mask")), { "script-1": "hide_all" });
  act(() => fireEvent.click(button("가리기: 모든 대사 가리기")));
  assert.deepEqual(JSON.parse(window.localStorage.getItem("acttub.reading.mask")), { "script-1": "show_all" });
});

test("reading.quiz: 상대 목소리를 내지 못하면 글로 읽고 다음을 누르라고 안내한다", async () => {
  quiz.runner.voiceFailed = true;
  show();
  click("시작");
  assert.equal(has("상대 목소리를 내지 못했어요. 글로 읽고 다음을 눌러요."), true);
  cleanup();

  show({ partnerVoice: "text" });
  click("시작");
  assert.equal(has("상대 대사는 글로 보여요. 읽었으면 다음을 눌러요."), true);
});

test("reading.quiz: 상대 차례의 일시정지 버튼은 멈추면 이어가기로 바뀐다", async () => {
  show();
  click("시작");
  click("일시정지");
  assert.equal(button("이어가기").tagName, "BUTTON");
  click("이어가기");
  assert.deepEqual(quiz.runner.calls, ["start", "togglePause", "togglePause"]);
  assert.equal(button("일시정지").tagName, "BUTTON");
});

test("reading.quiz: Supertonic 목소리를 아직 받지 않았으면 준비를 끝내야 시작할 수 있다", () => {
  quiz.engine = "device";
  show({ partnerVoice: "supertonic" });
  assert.equal(button("상대 목소리 준비 중…").disabled, true);
  click("기기 음성으로 하기");
  assert.equal(button("시작").disabled, false);
});

test("reading.quiz: 재생기가 목소리를 준비하는 동안에는 시작할 수 없다", () => {
  quiz.runner.preparing = true;
  show();
  assert.equal(button("상대 목소리 준비 중…").disabled, true);
});

test("reading.quiz: 녹음을 켠 회차는 녹음기를 켜고, 녹음 중·저장 대기·버린 녹음 안내를 보여 준다", async () => {
  quiz.rec.recording = true;
  quiz.rec.pending = 2;
  quiz.rec.notice = "이 줄 녹음을 저장하지 못했어요.";
  show({ session: sessionOf({ record: true }) });
  assert.equal(quiz.rec.enabled, true);
  assert.equal(has("녹음 저장 중 2"), true);
  click("시작");
  click("다음");
  assert.equal(has("이 줄은 녹음돼 내 계정에 저장돼요."), true);
  assert.equal(has("이 줄 녹음을 저장하지 못했어요."), true);
});

test("reading.quiz: 처음 하는 리딩이면 안내 카드를 보이고 알겠어요를 누르면 다시 보이지 않는다", () => {
  window.localStorage.clear();
  show();
  assert.equal(has("처음 하는 리딩이에요"), true);
  click("알겠어요");
  assert.equal(has("처음 하는 리딩이에요"), false);
  cleanup();
  show();
  assert.equal(has("처음 하는 리딩이에요"), false);
});

test("reading.quiz: 시작 전에 나가면 확인 없이 녹음기와 재생기를 멈추고 나간다", () => {
  show();
  click("나가기");
  assert.equal(exits, 1);
  assert.deepEqual(quiz.runner.calls, ["stop"]);
  assert.deepEqual(quiz.rec.calls, ["finish"]);
  assert.deepEqual(quiz.saved, []);
});

test("reading.quiz: 진행 중에 나가면 확인을 묻고, 계속하기면 머물고 나가기면 지금 줄을 저장하고 나간다", async () => {
  await toMyFirstLine();
  click("나가기");
  assert.equal(screen.getByRole("dialog").textContent.includes("리딩을 나갈까요?"), true);
  click("계속하기");
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(exits, 0);

  click("나가기");
  const dialog = screen.getByRole("dialog");
  const leave = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "나가기");
  act(() => fireEvent.click(leave));
  await flush();
  assert.equal(exits, 1);
  assert.deepEqual(listening().calls, ["abort"]);
  assert.deepEqual(quiz.rec.calls, ["finish"]);
  assert.equal(quiz.saved.at(-1).body.current_line_id, "l-2");
});

test("reading.quiz: 마지막 줄을 지나면 완료를 저장하고 quiz 줄 결과와 대사 수를 넘긴다", async () => {
  await toMyFirstLine();
  act(() => listening().cb.onText("아니 나도 방금 왔어"));
  tick(700);
  click("다음");
  await flush();
  click("넘어가기");
  await flush();
  await flush();
  const last = quiz.saved.at(-1).body;
  assert.equal(last.complete, true);
  assert.equal(last.current_line_id, null);
  assert.deepEqual(finished.map((s) => ({ mode: s.mode, lineCount: s.lineCount, names: s.myCharacterNames, results: s.lineResults })), [
    {
      mode: "quiz",
      lineCount: 4,
      names: ["지수"],
      results: [
        { line_id: "l-2", outcome: "passed", misses: 0 },
        { line_id: "l-4", outcome: "skipped", misses: 0 },
      ],
    },
  ]);
});

test("reading.quiz: 구간에 대사가 없으면 시작을 기다리지 않고 바로 완료를 저장해 넘긴다", async () => {
  show({ session: sessionOf({ start_line_id: "l-0", end_line_id: "l-0" }) });
  await flush();
  assert.equal(quiz.saved.at(-1).body.complete, true);
  assert.deepEqual(finished.map((s) => [s.mode, s.lineCount, s.lineResults]), [["quiz", 0, []]]);
  assert.equal(has("0 / 0 · 00:00"), true);
});
