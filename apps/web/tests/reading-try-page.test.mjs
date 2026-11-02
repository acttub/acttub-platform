// 리딩 빠른 시작(/reading/try, SOMA-834 3차): 예시 대본을 서버가 나눠 저장하게 하고, 윤서(기본)·태오로 회차를 만들어 실행 화면으로 보낸다.
// 입력·배역 단계는 거치지 않고, 들어온 길(from)과 함께 trial_start 가 남는다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";
globalThis.sessionStorage = window.sessionStorage;

const stubs = new URL("./fixtures/reading-page-stubs.mjs", import.meta.url).href;
const replaced = new Set(["next/navigation", "next/link", "@/features/nav/app-rail"]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (replaced.has(specifier)) return { url: stubs, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { nav } = await import("./fixtures/reading-page-stubs.mjs");
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { TryPage } = await import("../src/features/reading/pages/try-page.tsx");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const detail = {
  id: "script-sample",
  title: "옥상, 밤",
  characters: [
    { id: "c-yoon", name: "윤서", order: 0, voice_preset: null, voice: "F1" },
    { id: "c-teo", name: "태오", order: 1, voice_preset: null, voice: "M1" },
  ],
  lines: [
    { id: "l-0", ordinal: 0, kind: "dialogue", character_id: "c-yoon", text: "여기 있을 줄 알았어." },
    { id: "l-1", ordinal: 1, kind: "dialogue", character_id: "c-teo", text: "어떻게 알았어." },
  ],
  last_session: null,
};
const created = { id: "session-1", script_id: "script-sample", my_character_ids: ["c-yoon"], mode: "read" };

const originalFetch = globalThis.fetch;
let requests;
function serve(overrides = {}) {
  requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const route = `${init.method ?? "GET"} ${String(url)}`;
    const req = { route, body: init.body ? JSON.parse(init.body) : undefined };
    requests.push(req);
    if (overrides[route]) return overrides[route](req);
    if (route === "POST /v2/reading/imports") return json({ import_id: "import-1", duplicate_script_id: null }, 202);
    if (route === "GET /v2/reading/imports/import-1")
      return json({ id: "import-1", status: "succeeded", progress: { done_lines: 0, total_lines: 0 }, script_id: "script-sample", failure: null });
    if (route === "GET /v2/reading/scripts/script-sample") return json(detail);
    if (route === "POST /v2/reading/scripts/script-sample/sessions") return json({ ...created, my_character_ids: req.body.my_character_ids }, 201);
    return json({});
  };
}
const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

const events = [];
beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  nav.pushed.length = 0;
  nav.replaced.length = 0;
  events.length = 0;
  window.history.replaceState(null, "", "/reading/try");
  window.gtag = (...args) => events.push(args);
  globalThis.window.gtag = window.gtag;
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  delete window.gtag;
  clearTokens();
});

test("빠른 시작: 예시 글을 나누게 맡기고, 윤서로 읽어주기 회차를 만들어 실행 화면으로 바로 간다", async () => {
  window.history.replaceState(null, "", "/reading/try?utm_source=meta&utm_campaign=trial_a");
  serve();
  render(react.createElement(TryPage));
  assert.ok(screen.getByText("예시 대본을 준비하고 있어요"));
  await flush();

  const imported = requests.find((r) => r.route === "POST /v2/reading/imports");
  assert.ok(imported.body.raw_text.includes("윤서: 여기 있을 줄 알았어."));
  assert.equal(imported.body.source, "sample");
  const post = requests.find((r) => r.route === "POST /v2/reading/scripts/script-sample/sessions");
  assert.equal(post.body.mode, "read");
  assert.deepEqual(post.body.my_character_ids, ["c-yoon"]);
  assert.equal(post.body.start_line_id, "l-0");
  assert.equal(post.body.end_line_id, "l-1");
  // 입력·배역 화면을 거치지 않고 실행 화면으로 바꿔 들어간다(뒤로 가기에 중간 화면이 남지 않는다).
  assert.deepEqual(nav.replaced, ["/reading/run"]);
  assert.deepEqual(nav.pushed, []);
  assert.equal(JSON.parse(window.sessionStorage.getItem("reading.script.v2")).id, "script-sample");
  assert.equal(JSON.parse(window.sessionStorage.getItem("reading.session")).id, "session-1");
  assert.equal(window.localStorage.getItem("acttub.reading.sample_script_id"), "script-sample");
  // 광고 링크에는 from 이 없으니 곧장 들어온 길(quick_start)로 센다.
  assert.deepEqual(
    events.map(([, name, p]) => [name, p.feature, p.entry]),
    [["trial_start", "reading", "quick_start"]],
  );
});

test("빠른 시작: ?role=taeo 면 태오로 시작하고, 사이트 안에서 온 길(from)이 이벤트에 실린다", async () => {
  window.history.replaceState(null, "", "/reading/try?role=taeo&from=home_card");
  serve();
  render(react.createElement(TryPage));
  await flush();
  const post = requests.find((r) => r.route === "POST /v2/reading/scripts/script-sample/sessions");
  assert.deepEqual(post.body.my_character_ids, ["c-teo"]);
  assert.deepEqual(events.map(([, name, p]) => [name, p.entry]), [["trial_start", "home_card"]]);
});

test("빠른 시작: 두 번째부터는 기억해 둔 예시 대본을 다시 받아 쓰고 새로 나누지 않는다", async () => {
  window.localStorage.setItem("acttub.reading.sample_script_id", "script-sample");
  serve();
  render(react.createElement(TryPage));
  await flush();
  assert.equal(requests.some((r) => r.route === "POST /v2/reading/imports"), false);
  assert.deepEqual(nav.replaced, ["/reading/run"]);
});

test("빠른 시작: 준비하지 못하면 알리고, 다시 시도하거나 내 대본으로 갈 수 있다", async () => {
  serve({ "POST /v2/reading/imports": () => json({ code: "internal_error", message: "x" }, 500) });
  render(react.createElement(TryPage));
  await flush();
  assert.ok(screen.getByText("예시 대본을 준비하지 못했어요. 다시 시도해 주세요."));
  assert.equal(screen.getByRole("link", { name: "내 대본으로 하기" }).getAttribute("href"), "/reading");
  assert.deepEqual(nav.replaced, []);

  serve();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await flush();
  assert.deepEqual(nav.replaced, ["/reading/run"]);
});
