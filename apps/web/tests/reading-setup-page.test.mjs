// reading.cast·reading.session — 배역 정하기 페이지(/reading/setup). 기기에 든 대본으로 화면을 그리고, 배역·방식·가리기를
// 골라 시작하면 서버에 회차를 만들고 실행 화면으로 간다. 목소리를 바꾸면 PATCH 로 남기고 캐시의 대본도 바꾼다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";
globalThis.sessionStorage = window.sessionStorage;

const stubs = new URL("./fixtures/reading-page-stubs.mjs", import.meta.url).href;
const replaced = new Set(["next/navigation", "next/link", "@/features/nav/app-rail", "@/lib/reading/audio/tts", "@/features/reading/voice-setup"]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (replaced.has(specifier)) return { url: stubs, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { nav, spoken, voiceSetup } = await import("./fixtures/reading-page-stubs.mjs");
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { SetupPage } = await import("../src/features/reading/pages/setup-page.tsx");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const script = {
  id: "script-1",
  title: "갈매기",
  roles: ["니나", "트레플레프"],
  lines: [
    { type: "scene", text: "호숫가." },
    { type: "dialogue", role: "니나", text: "나는 갈매기." },
    { type: "dialogue", role: "트레플레프", text: "아니, 너는 배우야." },
    { type: "dialogue", role: "니나", text: "그래, 배우." },
  ],
  characters: [
    { id: "c-nina", name: "니나", voicePreset: null, voice: "F1" },
    { id: "c-kostya", name: "트레플레프", voicePreset: null, voice: "M2" },
  ],
  lineIds: ["l-0", "l-1", "l-2", "l-3"],
  lastSession: null,
};

const originalFetch = globalThis.fetch;
let requests;

function serve(handler) {
  requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const req = { route: `${init.method ?? "GET"} ${String(url)}`, body: init.body ? JSON.parse(init.body) : undefined };
    requests.push(req);
    return handler(req);
  };
}

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

function mount() {
  render(react.createElement(SetupPage));
}

const cached = () => JSON.parse(window.sessionStorage.getItem("reading.script.v2"));
const startButtons = (name) => screen.getAllByRole("button", { name });

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  nav.pushed.length = 0;
  nav.replaced.length = 0;
  spoken.length = 0;
  voiceSetup.ready = true;
  voiceSetup.partnerVoice = "device";
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  clearTokens();
});

test("reading.session: 기기에 대본이 없으면 배역 화면을 그리지 않고 대본 넣기로 돌려보낸다", async () => {
  serve(() => json({}));
  mount();
  await flush();
  assert.deepEqual(nav.replaced, ["/reading"]);
  assert.equal(screen.queryByText("내 배역 고르기"), null);
});

test("reading.session: 배역을 고르고 시작하면 전체 구간으로 회차를 만들고 실행 화면으로 간다", async () => {
  window.sessionStorage.setItem("reading.script.v2", JSON.stringify(script));
  const session = { id: "session-1", script_id: "script-1", my_character_ids: ["c-nina"] };
  serve((req) => (req.route.startsWith("POST") ? json({ ...session }, 201) : json({})));
  mount();
  await flush();

  assert.equal(startButtons("내 배역을 골라 주세요")[0].disabled, true);
  fireEvent.click(screen.getByRole("button", { name: /니나/ }));
  fireEvent.click(screen.getByRole("button", { name: "모든 대사 가리기" }));
  fireEvent.click(screen.getByRole("button", { name: /암기 대조/ }));
  screen.getByText("암기 대조에서는 내 대사가 늘 가려져요.");

  fireEvent.click(startButtons("선택한 1개 배역으로 연습하기")[0]);
  await flush();

  const post = requests.find((r) => r.route === "POST /v2/reading/scripts/script-1/sessions");
  assert.deepEqual({ ...post.body, request_id: typeof post.body.request_id }, {
    request_id: "string",
    my_character_ids: ["c-nina"],
    mode: "quiz",
    start_line_id: "l-1",
    end_line_id: "l-3",
    advance: "manual",
    record: false,
  });
  assert.deepEqual(nav.pushed, ["/reading/run"]);
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem("reading.session")), session);
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem("reading.run_prefs")), { partnerVoice: "device" });
  assert.deepEqual(JSON.parse(window.localStorage.getItem("acttub.reading.mask")), { "script-1": "hide_all" });
});

test("reading.session: 회차 시작이 실패하면 오류 문구를 보이고, 같은 설정으로 다시 누르면 같은 요청 id 로 보낸다", async () => {
  window.sessionStorage.setItem("reading.script.v2", JSON.stringify({ ...script, lastSession: { myCharacterIds: ["c-kostya"] } }));
  serve((req) => (req.route.startsWith("POST") ? json({ code: "internal_error", message: "x" }, 500) : json({})));
  mount();
  await flush();

  fireEvent.click(startButtons("선택한 1개 배역으로 연습하기")[0]);
  await flush();
  assert.equal(screen.getAllByText("회차를 시작하지 못했어요. 다시 시도해 주세요.").length, 2);
  fireEvent.click(startButtons("선택한 1개 배역으로 연습하기")[0]);
  await flush();

  const posts = requests.filter((r) => r.route.startsWith("POST"));
  assert.equal(posts.length, 2);
  assert.equal(new Set(posts.map((p) => p.body.request_id)).size, 1);
  assert.deepEqual(posts[0].body.my_character_ids, ["c-kostya"]);
  assert.deepEqual(nav.pushed, []);
});

test("reading.cast: 상대역 목소리를 바꾸면 PATCH 로 남기고 서버가 다시 정한 목소리를 캐시 대본에 넣는다", async () => {
  window.sessionStorage.setItem("reading.script.v2", JSON.stringify(script));
  const saved = {
    id: "script-1",
    title: "갈매기",
    characters: [
      { id: "c-nina", name: "니나", order: 0, voice_preset: null, voice: "F3" },
      { id: "c-kostya", name: "트레플레프", order: 1, voice_preset: "M4", voice: "M4" },
    ],
    lines: [],
    last_session: null,
  };
  serve((req) => (req.route.startsWith("PATCH") ? json(saved) : json({})));
  mount();
  await flush();

  fireEvent.change(screen.getByRole("combobox", { name: "트레플레프 목소리" }), { target: { value: "M4" } });
  assert.equal(cached().characters[1].voicePreset, "M4");
  await flush();

  const patch = requests.find((r) => r.route === "PATCH /v2/reading/scripts/script-1");
  assert.deepEqual(patch.body, { characters: [{ id: "c-kostya", voice_preset: "M4" }] });
  assert.deepEqual(cached().characters, [
    { id: "c-nina", name: "니나", voicePreset: null, voice: "F3" },
    { id: "c-kostya", name: "트레플레프", voicePreset: "M4", voice: "M4" },
  ]);
  assert.equal(screen.queryByText(/목소리를 저장하지 못했어요/), null);
});

test("reading.cast: 목소리 저장이 실패하면 안내를 보이고, 자동으로 되돌리면 고정값을 지운다", async () => {
  window.sessionStorage.setItem("reading.script.v2", JSON.stringify({ ...script, characters: [script.characters[0], { ...script.characters[1], voicePreset: "M4", voice: "M4" }] }));
  serve((req) => (req.route.startsWith("PATCH") ? json({ code: "internal_error", message: "x" }, 500) : json({})));
  mount();
  await flush();

  fireEvent.change(screen.getByRole("combobox", { name: "트레플레프 목소리" }), { target: { value: "auto" } });
  await flush();

  assert.deepEqual(cached().characters[1], { id: "c-kostya", name: "트레플레프", voicePreset: null, voice: "M4" });
  screen.getByText("목소리를 저장하지 못했어요. 이번 회차는 고른 목소리로 읽고 다음에 다시 저장해요.");
  assert.deepEqual(JSON.parse(window.localStorage.getItem("acttub.reading.pending_voices")), { "script-1": { "c-kostya": null } });
});

test("reading.cast: 미리 듣기는 상대역 이름을 그 배역의 목소리로 읽는다", async () => {
  window.sessionStorage.setItem("reading.script.v2", JSON.stringify(script));
  serve(() => json({}));
  mount();
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /니나/ }));
  fireEvent.click(screen.getByRole("button", { name: "미리 듣기" }));

  assert.deepEqual(spoken, [{ text: "트레플레프 역이에요.", voice: { device: { pitch: 0 }, preset: "M2" } }]);
});

test("reading.session: 상대 목소리가 준비되지 않았으면 시작할 수 없고, 상대 대사가 없으면 목소리 없이 시작할 수 있다", async () => {
  voiceSetup.ready = false;
  window.sessionStorage.setItem("reading.script.v2", JSON.stringify(script));
  serve(() => json({}));
  mount();
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /니나/ }));
  assert.equal(startButtons("상대 목소리 준비 중…")[0].disabled, true);

  fireEvent.click(screen.getByRole("button", { name: /트레플레프/ }));
  assert.equal(screen.queryByText("상대 목소리 설정"), null);
  assert.equal(startButtons("선택한 2개 배역으로 연습하기")[0].disabled, false);
});

test("reading.session: 마이크가 있으면 침묵 감지·녹음이 기본으로 켜지고 바꾸기로 끌 수 있다", async () => {
  Object.defineProperty(globalThis.navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({}) } });
  try {
    window.sessionStorage.setItem("reading.script.v2", JSON.stringify(script));
    serve(() => json({}));
    mount();
    await flush();

    const advance = screen.getByRole("button", { name: /내 차례 넘기는 방식/ });
    const record = screen.getByRole("button", { name: /내 차례 녹음/ });
    assert.match(advance.textContent, /침묵 감지 · 말이 끝나고 1\.8초/);
    assert.match(record.textContent, /^내 차례 녹음켬 · /);

    fireEvent.click(advance);
    fireEvent.click(record);

    assert.match(advance.textContent, /버튼으로 직접 넘기기/);
    assert.equal(record.textContent, "내 차례 녹음끔바꾸기");
  } finally {
    delete globalThis.navigator.mediaDevices;
  }
});

test("reading.session: 뒤로는 대본 상세로, 다른 대본은 대본 넣기로 간다", async () => {
  window.sessionStorage.setItem("reading.script.v2", JSON.stringify(script));
  serve(() => json({}));
  mount();
  await flush();

  fireEvent.click(screen.getAllByRole("button", { name: "뒤로" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "다른 대본" }));

  assert.deepEqual(nav.pushed, ["/reading/scripts/script-1", "/reading"]);
});

test("reading.cast: 배역이 하나인 대본은 그 배역으로 고정되고 눌러도 풀리지 않는다", async () => {
  window.sessionStorage.setItem(
    "reading.script.v2",
    JSON.stringify({ ...script, roles: ["니나"], characters: [script.characters[0]], lines: [script.lines[1]], lineIds: ["l-1"] }),
  );
  serve(() => json({}));
  mount();
  await flush();

  screen.getByText("배역이 하나라 이 배역으로 연습해요.");
  fireEvent.click(screen.getByRole("button", { name: /니나/ }));
  assert.equal(startButtons("선택한 1개 배역으로 연습하기")[0].disabled, false);
});
