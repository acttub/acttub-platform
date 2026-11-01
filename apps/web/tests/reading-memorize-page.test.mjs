// reading.memorization — 암기 페이지(/reading/memorize). 기기에 든 대본과 진입 정보(MemorizeEntry)로 화면을 열고,
// 암기 상태를 대본 단위로 받아 그린다. 표시는 줄마다 PUT 으로 보내고, 실패한 것은 연결이 돌아오면 다시 보낸다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";
globalThis.sessionStorage = window.sessionStorage;

const pageStubs = new URL("./fixtures/reading-page-stubs.mjs", import.meta.url).href;
const voiceStubs = new URL("./fixtures/reading-memorization-stubs.mjs", import.meta.url).href;
const toPageStubs = new Set(["next/navigation", "next/link", "@/features/nav/app-rail"]);
const toVoiceStubs = new Set(["@/lib/reading/audio/stt", "@/lib/reading/audio/tts"]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (toPageStubs.has(specifier)) return { url: pageStubs, shortCircuit: true };
    if (toVoiceStubs.has(specifier)) return { url: voiceStubs, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { nav } = await import("./fixtures/reading-page-stubs.mjs");
const { resetVoiceStubs } = await import("./fixtures/reading-memorization-stubs.mjs");
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { MemorizePage } = await import("../src/features/reading/pages/memorize-page.tsx");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const script = {
  id: "script-1",
  title: "봄밤",
  roles: ["니나", "트레"],
  characters: [],
  lines: [
    { type: "dialogue", role: "트레", text: "둘." },
    { type: "dialogue", role: "니나", text: "너 힘들면 항상 높은 데로 가잖아." },
    { type: "dialogue", role: "니나", text: "그래 넷." },
  ],
  lineIds: ["l-0", "l-1", "l-2"],
  raw: "",
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

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
const seen = (s) => document.body.textContent.includes(s);
const click = (name) => fireEvent.click(screen.getByRole("button", { name }));

function store({ entry = { scriptId: "script-1", roles: ["니나"], lineIds: null }, withScript = true } = {}) {
  if (withScript) window.sessionStorage.setItem("reading.script.v2", JSON.stringify(script));
  if (entry) window.sessionStorage.setItem("reading.memorize", JSON.stringify(entry));
}

async function mount() {
  render(react.createElement(MemorizePage));
  await flush();
}

const LIST = "GET /v2/reading/scripts/script-1/memorization";
let putOk;

beforeEach(() => {
  window.sessionStorage.clear();
  nav.pushed.length = 0;
  nav.replaced.length = 0;
  resetVoiceStubs();
  putOk = true;
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
  serve((req) => {
    if (req.route === LIST) return json([{ line_id: "l-2", status: "memorized", updated_at: "2026-10-19T00:00:00Z" }]);
    if (req.route.startsWith("PUT")) {
      if (!putOk) return json({ code: "internal_error", message: "x" }, 500);
      return json({ line_id: req.route.split("/")[4], status: req.body.status, updated_at: "2026-10-20T00:00:00Z" });
    }
    return json({});
  });
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  clearTokens();
});

test("reading.memorization: 기기에 대본이나 진입 정보가 없거나 서로 다른 대본이면 암기 상태를 묻지 않고 대본 넣기로 돌려보낸다", async () => {
  for (const setup of [{ withScript: false }, { entry: null }, { entry: { scriptId: "other", roles: ["니나"], lineIds: null } }]) {
    window.sessionStorage.clear();
    store(setup);
    await mount();
    cleanup();
  }

  assert.deepEqual(nav.replaced, ["/reading", "/reading", "/reading"]);
  assert.deepEqual(requests, []);
});

test("reading.memorization: 게스트 세션이 없으면 대본 넣기로 돌려보낸다", async () => {
  clearTokens();
  store();
  await mount();
  assert.deepEqual(nav.replaced, ["/reading"]);
  assert.equal(seen("암기하지 못한 대사"), false);
});

test("reading.memorization: 대본 단위로 받은 암기 상태로 대상을 정하고, 외웠다고 누르면 그 줄을 PUT 으로 보낸다", async () => {
  store();
  await mount();

  assert.deepEqual(requests.map((r) => r.route), [LIST]);
  assert.equal(seen("니나 역 · 암기하지 못한 대사 1개"), true);
  assert.equal(seen("외운 줄 1 / 내 대사 2"), true);

  click("이 대사 외웠어요");
  await flush();

  assert.deepEqual(requests.slice(1), [{ route: "PUT /v2/reading/lines/l-1/memorization", body: { status: "memorized" } }]);
  assert.equal(seen("못 외운 대사가 없어요"), true);
  assert.equal(seen("외운 줄 2 / 내 대사 2"), true);
});

test("reading.memorization: 표시를 보내지 못하면 저장 중으로 남기고, 연결이 돌아오면 다시 보낸다", async () => {
  store();
  await mount();
  putOk = false;

  click("아직 헷갈려요");
  await flush();
  assert.equal(seen("표시 저장 중 1"), true);

  putOk = true;
  await act(async () => {
    window.dispatchEvent(new window.Event("online"));
    await new Promise((r) => setTimeout(r, 0));
  });

  assert.deepEqual(
    requests.filter((r) => r.route.startsWith("PUT")),
    [
      { route: "PUT /v2/reading/lines/l-1/memorization", body: { status: "not_yet" } },
      { route: "PUT /v2/reading/lines/l-1/memorization", body: { status: "not_yet" } },
    ],
  );
});

test("reading.memorization: 배역을 바꾸면 진입 정보에 남기고 화면 대상도 바뀐다", async () => {
  store();
  await mount();

  click("트레");

  assert.deepEqual(JSON.parse(window.sessionStorage.getItem("reading.memorize")), {
    scriptId: "script-1",
    roles: ["니나", "트레"],
    lineIds: null,
  });
  assert.equal(seen("니나, 트레 역 · 암기하지 못한 대사 2개"), true);
});

test("reading.memorization: 뒤로와 리딩하러 가기는 대본 상세로 간다", async () => {
  store({ entry: { scriptId: "script-1", roles: ["니나"], lineIds: ["l-9"] } });
  await mount();

  click("뒤로");
  click("리딩하러 가기");

  assert.deepEqual(nav.pushed, ["/reading/scripts/script-1", "/reading/scripts/script-1"]);
});

test("reading.memorization: 암기 상태를 받지 못하면 그 사실과 대본 상세로 가는 길을 보인다", async () => {
  serve(() => json({ code: "internal_error", message: "x" }, 500));
  store();
  await mount();

  assert.equal(seen("암기 상태를 불러오지 못했어요."), true);
  assert.equal(seen("암기하지 못한 대사"), false);

  click("대본 상세로");
  assert.deepEqual(nav.pushed, ["/reading/scripts/script-1"]);
});
