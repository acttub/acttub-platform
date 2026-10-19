// practice.start·record·analyze·coach·note·library·resume — 연습 워크스페이스(WorkspaceApp)를 jsdom 위에 실제로
// 그리고 누른다. 서버는 fetch 대역이 경로별로 답하고, 테스트는 사용자가 보는 글자와 서버로 나간 요청을 본다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const navigationUrl = new URL("./fixtures/workspace-app-navigation.mjs", import.meta.url).href;
const imageUrl = new URL("./fixtures/workspace-app-image.mjs", import.meta.url).href;
const posthogUrl = new URL("./fixtures/posthog-js.mjs", import.meta.url).href;
const pngUrl = `data:text/javascript,${encodeURIComponent('export default { src: "/wordmark.png", width: 120, height: 24 };')}`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/navigation") return { url: navigationUrl, shortCircuit: true };
    if (specifier === "next/image") return { url: imageUrl, shortCircuit: true };
    if (specifier === "posthog-js") return { url: posthogUrl, shortCircuit: true };
    if (specifier.endsWith(".png")) return { url: pngUrl, shortCircuit: true };
    if (specifier === "next/link") return next("next/link.js", context);
    return next(specifier, context);
  },
});
// next/link 의 Node 빌드가 전역 self 를 읽는다.
globalThis.self = window;

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import("@testing-library/react");
const { WorkspaceApp } = await import("../src/features/workspace/workspace-app.tsx");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

// ── 서버 대역 ─────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
/** 나간 요청. `METHOD /path?query` 와 JSON 본문 */
let requests = [];
let routes = {};

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}
const fail = (status, code) => json(status, { detail: code });

/** 조각을 하나씩 흘려보낼 수 있는 SSE 응답. 코치가 쓰는 중인 글을 화면이 어떻게 그리는지 본다. */
function liveStream() {
  const encoder = new TextEncoder();
  let controller;
  const body = new ReadableStream({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    send: (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
    close: () => controller.close(),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * 경로마다 답을 정한다. 값이 배열이면 부를 때마다 앞에서 하나씩 꺼내고 마지막 것은 계속 쓴다.
 * 함수면 본문을 받아 답한다. 답이 Response 가 아니면 200 JSON 으로 보낸다.
 */
function serve(table) {
  routes = { ...table };
}

function sent(key) {
  return requests.filter((request) => request.key === key);
}

beforeEach(() => {
  requests = [];
  routes = {};
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(String(url), "http://localhost");
    const key = `${init.method ?? "GET"} ${target.pathname}${target.search}`;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ key, body });
    let answer = routes[key];
    if (Array.isArray(answer)) answer = answer.length > 1 ? answer.shift() : answer[0];
    if (answer === undefined) return fail(404, "not_found");
    // 실제 fetch 처럼 끊긴 요청은 AbortError 로 끝난다.
    const aborted = new Promise((_, reject) => {
      const abort = () => reject(init.signal.reason ?? new DOMException("aborted", "AbortError"));
      if (init.signal?.aborted) abort();
      else init.signal?.addEventListener("abort", abort, { once: true });
    });
    const out = await Promise.race([typeof answer === "function" ? answer(body) : answer, aborted]);
    return out instanceof Response ? out : json(200, out);
  };
  window.matchMedia = () => ({ matches: false });
  window.HTMLMediaElement.prototype.play = function play() {
    played.push(this.currentTime);
    return Promise.resolve();
  };
  played = [];
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  clearTokens();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

let played = [];

// ── 응답 모양 ─────────────────────────────────────────────────────

const today = new Date();
const iso = (daysAgo, hour = 10) => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour, 5);
  return d.toISOString();
};

function practice(overrides = {}) {
  return {
    id: "p1",
    root_id: "p1",
    ordinal: 1,
    video_id: "v1",
    stage: "closed",
    experience_version: "three_layers_v1",
    situation: "이별 통보 직후 카페",
    character: "담담한 척하는 여자",
    goal: "상대를 다시 앉히기",
    blockage_category: "표현",
    blockage_detail: "화술",
    blockage_note: null,
    created_at: iso(0),
    analysis_status: "ready",
    conversation_id: null,
    conversation_status: null,
    conversation_count: 0,
    note_id: null,
    note_title: null,
    job: { id: "job-1", status: "succeeded", attempt_count: 1 },
    previous_conversations: [],
    ...overrides,
  };
}

function group(overrides = {}, practices = [practice()]) {
  return {
    root_id: practices[0].root_id,
    title: null,
    ordinal_count: practices.length,
    tags: [],
    favorite: false,
    hidden_at: null,
    in_progress_practice_id: null,
    practices,
    ...overrides,
  };
}

function video(overrides = {}) {
  return {
    id: "v1",
    duration_ms: 72_000,
    byte_size: 1000,
    content_type: "video/mp4",
    favorite: false,
    purged_at: null,
    created_at: iso(0),
    usage: { practice_count: 1, entry_count: 0 },
    playback_url: "https://cdn.test/v1.mp4",
    ...overrides,
  };
}

const analysis = {
  id: "a1",
  format: "legacy",
  status: "ready",
  summary: {
    summary_id: "s1",
    observations: [
      { start_ms: 4_000, end_ms: 5_800, label: "말끝", confidence: 0.9 },
      { start_ms: 65_000, end_ms: 66_000, label: "시선", confidence: 0.8 },
    ],
    uncertainties: [],
  },
};

function conversation(overrides = {}) {
  return {
    id: "c1",
    practice_id: "p1",
    status: "open",
    revision: 1,
    coach_reply_count: 1,
    reply_limit: 5,
    messages: [],
    ...overrides,
  };
}

function note(overrides = {}) {
  return {
    id: "n1",
    conversation_id: "c1",
    format: "v2",
    kind: "action",
    title: "말끝의 전달",
    summary_quotes: [{ quote: "가지 마", kind: "actor", source_ref: "t1" }],
    next_take: "말끝을 짧게 끊어 보세요",
    actor_words: [],
    corrections: [],
    tags: [],
    fallback: false,
    source_revision: 2,
    report: null,
    created_at: iso(0),
    ...overrides,
  };
}

const blocked = { report_type: "blocked", reason: "confirmed_expression_handoff_required" };

/** 분석이 끝나 노트까지 있는 회차를 여는 데 필요한 경로들 */
function analyzedWithNote(id = "p1", extra = {}) {
  return {
    [`GET /v2/practices/${id}`]: practice({ id, root_id: id, note_id: "n1", conversation_id: "c1", conversation_status: "closed", ...extra }),
    "GET /v2/videos/v1": video(),
    [`GET /v2/practices/${id}/analysis`]: analysis,
    [`GET /v2/practices/${id}/note`]: note(),
  };
}

const startGuest = () => setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });

async function mount(search = "") {
  window.history.replaceState(null, "", search ? `/practice/new?${search}` : "/practice/new");
  await act(async () => {
    render(react.createElement(WorkspaceApp));
  });
}

/** 없어야 할 요소. assert.equal 로 요소를 견주면 실패할 때 jsdom 객체를 통째로 펼치다 멈춘다. */
function none(element, message = "보이지 않아야 한다") {
  assert.ok(element === null, message);
}
const button = (name) => screen.getByRole("button", { name });
const alertText = () => screen.queryByRole("alert")?.textContent ?? null;
const location = () => `${window.location.pathname}${window.location.search}`;

// ── 첫 화면과 왼쪽 목록 ───────────────────────────────────────────

test("게스트가 없으면 목록을 묻지 않고 빈 목록과 오늘 남은 분석 횟수를 보인다", async () => {
  await mount();
  assert.deepEqual(requests, []);
  assert.ok(screen.getAllByText("첫 영상을 올리면 여기에 쌓여요.").length > 0);
  assert.ok(screen.getByText("게스트는 하루 3번까지 분석할 수 있어요. 오늘 3번 남았어요."));
  assert.equal(button("질문 받기").disabled, true);
  assert.ok(screen.getByText("영상을 올리면 시작할 수 있어요"));
  none(screen.queryByRole("link", { name: "앱으로 옮기기" }));
});

test("목록은 진행 중 묶음과 달마다 나눈 지난 묶음으로 보이고, 여러 회차 묶음은 펼쳐야 회차가 보인다", async () => {
  startGuest();
  const lastYear = new Date(today.getFullYear() - 1, 2, 3, 9, 0).toISOString();
  serve({
    "GET /v2/practices?filter=all": {
      groups: [
        group({ in_progress_practice_id: "run-1" }, [practice({ id: "run-1", root_id: "run-1", stage: "analyzing", situation: "오디션 독백" })]),
        group({}, [practice({ id: "one", root_id: "one", note_id: "n1", note_title: "말끝의 전달", created_at: iso(0) })]),
        group({ favorite: true }, [
          practice({ id: "multi-1", root_id: "multi-1", ordinal: 1, situation: "첫 장면", created_at: iso(1) }),
          practice({ id: "multi-2", root_id: "multi-1", ordinal: 2, situation: "", note_id: "n2", note_title: null, created_at: iso(1, 11) }),
        ]),
        group({}, [practice({ id: "old", root_id: "old", situation: "", created_at: lastYear })]),
      ],
    },
  });
  await mount();
  const rail = within(screen.getAllByRole("complementary")[0]);
  await rail.findByText("오디션 독백");
  assert.ok(rail.getByText("진행 중"));
  assert.match(rail.getByText(/같이 볼 장면을 찾고 있어요/).textContent, /^같이 볼 장면을 찾고 있어요 · 오늘 \d\d:\d\d$/);
  assert.match(rail.getByText(/^오늘 .* · 문장 남김$/).textContent, /^오늘 \d\d:\d\d · 문장 남김$/);
  assert.ok(rail.getByText("★ 첫 장면"));
  assert.match(rail.getByText(/회차 2개$/).textContent, /^어제 \d\d:\d\d · 회차 2개$/);
  assert.ok(rail.getByText(`${today.getFullYear() - 1}년 3월`));
  assert.ok(rail.getByText("제목 없는 연습"));
  assert.match(rail.getByText(/^\d{4}년 3월 3일 /).textContent, new RegExp(`^${today.getFullYear() - 1}년 3월 3일 09:00$`));

  none(rail.queryByText(/^2차 · /));
  fireEvent.click(rail.getByRole("button", { name: "회차 2개 펼치기" }));
  assert.match(rail.getByText(/^2차 · /).textContent, /^2차 · 어제 \d\d:\d\d · 문장 남김$/);
  assert.match(rail.getByText(/^1차 · /).textContent, /^1차 · 어제 \d\d:\d\d$/);
  fireEvent.click(rail.getByRole("button", { name: "회차 접기" }));
  none(rail.queryByText(/^2차 · /));
  // 묶음 줄을 눌러도 펼쳐진다
  fireEvent.click(rail.getByText("★ 첫 장면"));
  assert.ok(rail.getByText(/^2차 · /));
  assert.ok(rail.getByRole("link", { name: "앱으로 옮기기" }));
});

test("최근 30일로 좁히면 오래된 묶음이 빠지고, 남은 것이 없으면 그렇게 말한다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": { groups: [group({}, [practice({ id: "old", root_id: "old", situation: "작년 장면", created_at: iso(60) })])] },
  });
  await mount();
  const rail = within(screen.getAllByRole("complementary")[0]);
  await rail.findByText("작년 장면");
  const filter = rail.getByRole("button", { name: "전체" });
  assert.equal(filter.getAttribute("aria-pressed"), "false");
  fireEvent.click(filter);
  assert.equal(rail.getByRole("button", { name: "최근 30일" }).getAttribute("aria-pressed"), "true");
  none(rail.queryByText("작년 장면"));
  assert.ok(rail.getByText("최근 30일에 한 연습이 없어요."));
  fireEvent.click(rail.getByRole("button", { name: "최근 30일" }));
  assert.ok(rail.getByText("작년 장면"));
});

test("목록을 못 불러오면 새 연습은 바로 시작할 수 있다고 알린다", async () => {
  startGuest();
  serve({ "GET /v2/practices?filter=all": fail(500, "internal_server_error") });
  await mount();
  const rail = within(screen.getAllByRole("complementary")[0]);
  await rail.findByText("목록을 잠시 불러오지 못했어요. 새 연습은 바로 시작할 수 있어요.");
});

test("목록을 접으면 묶음이 첫 글자 단추로 줄고, 다시 펼칠 수 있다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": {
      groups: [
        group({}, [practice({ id: "a", root_id: "a", situation: "카페 장면" })]),
        group({}, [practice({ id: "b", root_id: "b", situation: "", created_at: iso(2) })]),
      ],
    },
  });
  await mount();
  const rail = within(screen.getAllByRole("complementary")[0]);
  await rail.findByText("카페 장면");
  fireEvent.click(rail.getByRole("button", { name: "목록 접기" }));
  assert.equal(rail.getByTitle("카페 장면").textContent, "카");
  assert.equal(rail.getByTitle("제목 없는 연습").textContent, "연");
  none(rail.queryByText(GUEST_NOTICE));
  fireEvent.click(rail.getByRole("button", { name: "목록 펼치기" }));
  assert.ok(rail.getByText("카페 장면"));
});

const GUEST_NOTICE = "앱으로 옮기기 전에는 이 브라우저에서만 볼 수 있어요";

test("폰의 목록 드로어는 보관함·앱 다운로드 길을 함께 주고, 바깥이나 ✕ 를 누르면 닫힌다", async () => {
  await mount();
  fireEvent.click(button("지난 연습 목록 열기"));
  const drawer = within(screen.getAllByRole("complementary")[1]);
  assert.equal(drawer.getByRole("link", { name: "영상 보관함" }).getAttribute("href"), "/library");
  assert.equal(drawer.getByRole("link", { name: /앱 다운로드/ }).getAttribute("href"), "/app");
  fireEvent.click(drawer.getByRole("button", { name: "목록 접기" }));
  assert.equal(screen.getAllByRole("complementary").length, 1);

  fireEvent.click(button("지난 연습 목록 열기"));
  const backdrop = screen.getAllByRole("complementary")[1].parentElement.parentElement;
  fireEvent.click(screen.getAllByRole("complementary")[1]);
  assert.equal(screen.getAllByRole("complementary").length, 2, "드로어 안을 누르면 닫히지 않는다");
  fireEvent.click(backdrop);
  assert.equal(screen.getAllByRole("complementary").length, 1);
});

// ── 지난 연습 열기 ────────────────────────────────────────────────

test("목록에서 노트가 있는 회차를 열면 주소가 그 회차를 가리키고 노트와 장면이 보인다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": { groups: [group({}, [practice({ note_id: "n1", note_title: "말끝의 전달" })])] },
    ...analyzedWithNote(),
  });
  await mount();
  const rail = within(screen.getAllByRole("complementary")[0]);
  fireEvent.click(await rail.findByText("말끝의 전달"));
  await screen.findByText("연습 노트");
  assert.equal(location(), "/practice/new?session=p1");
  assert.deepEqual(
    requests.map((request) => request.key),
    [
      "GET /v2/practices?filter=all",
      "GET /v2/practices/p1",
      "GET /v2/videos/v1",
      "GET /v2/practices/p1/analysis",
      "GET /v2/practices/p1/note",
    ],
  );
  // 헤더 제목은 상황 문장이고, 장면 패널은 적은 것과 막힌 곳을 보인다.
  assert.ok(screen.getAllByText("이별 통보 직후 카페").length >= 2);
  assert.ok(screen.getByText("담담한 척하는 여자"));
  assert.ok(button("같은 영상으로 이어하기"));
  assert.ok(button("새 영상으로 이어하기"));
  assert.ok(screen.getByText("가지 마"));
  assert.equal(alertText(), null);
});

test("주소의 ?session= 으로 들어오면 그 회차를 열고, 못 찾으면 그렇게 말한다", async () => {
  startGuest();
  serve({ "GET /v2/practices?filter=all": { groups: [] }, ...analyzedWithNote() });
  await mount("session=p1");
  await screen.findByText("연습 노트");
  assert.ok(screen.getByText("가지 마"));
  cleanup();

  serve({ "GET /v2/practices?filter=all": { groups: [] }, "GET /v2/practices/gone": fail(404, "not_found") });
  await mount("session=gone");
  await waitFor(() => assert.equal(alertText(), "연습을 찾을 수 없어요."));
});

test("목록에서 연 회차를 못 불러오면 다시 시도하라고 말한다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": { groups: [group({}, [practice({ situation: "깨진 회차" })])] },
    "GET /v2/practices/p1": fail(500, "internal_server_error"),
  });
  await mount();
  fireEvent.click(await within(screen.getAllByRole("complementary")[0]).findByText("깨진 회차"));
  await waitFor(() => assert.equal(alertText(), "연습을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."));
});

test("노트에서 같은 영상으로 이어하면 준비 화면이 그 영상과 이어받기 안내를 들고 서고, 이어받지 않을 수 있다", async () => {
  startGuest();
  serve({ "GET /v2/practices?filter=all": { groups: [] }, ...analyzedWithNote() });
  await mount("session=p1");
  fireEvent.click(await screen.findByRole("button", { name: "같은 영상으로 이어하기" }));
  assert.equal(location(), "/practice/new");
  assert.ok(screen.getByText("「이별 통보 직후 카페」 연습의 대화를 이어받아요"));
  assert.ok(screen.getByText("지난 회차와 같은 영상"));
  assert.equal(button("질문 받기").disabled, false);
  assert.ok(screen.getByRole("button", { name: "← 다시 선택" }), "준비 화면에서는 다른 영상으로 바꿀 수 있다");
  fireEvent.click(button("이어받지 않기"));
  none(screen.queryByText(/연습의 대화를 이어받아요/));
});

test("새 영상으로 이어하면 빈 준비 화면에 이어받기 안내만 남고, 장면을 건너뛴 회차는 이름 없이 안내한다", async () => {
  startGuest();
  serve({ "GET /v2/practices?filter=all": { groups: [] }, ...analyzedWithNote("p1", { situation: "." }) });
  await mount("session=p1");
  fireEvent.click(await screen.findByRole("button", { name: "새 영상으로 이어하기" }));
  assert.ok(screen.getByText("지난 연습의 대화를 이어받아요"));
  assert.ok(screen.getByRole("button", { name: /오늘의 연기 영상을 올려 주세요/ }));
  assert.equal(button("질문 받기").disabled, true);
});

test("영상이 파기된 회차의 노트는 같은 영상으로 이어하기를 주지 않는다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": { groups: [] },
    ...analyzedWithNote(),
    "GET /v2/videos/v1": video({ purged_at: iso(0), playback_url: null }),
  });
  await mount("session=p1");
  await screen.findByRole("button", { name: "새 영상으로 이어하기" });
  none(screen.queryByRole("button", { name: "같은 영상으로 이어하기" }));
});

test("폰의 장면 보기는 관찰 시점을 누르면 그 구간부터 재생하고 Esc·접기로 닫힌다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": { groups: [] },
    ...analyzedWithNote("p1", { blockage_note: "말끝이 자꾸 흐려져요", analysis_status: "partial" }),
    "GET /v2/practices/p1/analysis": { ...analysis, status: "partial" },
  });
  await mount("session=p1");
  fireEvent.click(await screen.findByRole("button", { name: /영상과 장면 보기/ }));
  const sheet = within(screen.getByRole("dialog", { name: "영상과 장면 보기" }));
  assert.ok(sheet.getByText("말끝이 자꾸 흐려져요"));
  assert.ok(sheet.getByText("표현 › 화술"));
  assert.ok(sheet.getByText("일부 구간은 보지 못했어요"));
  fireEvent.click(sheet.getByRole("button", { name: "01:05" }));
  assert.deepEqual(played, [65]);
  fireEvent.keyDown(window.document, { key: "Enter" });
  assert.ok(screen.getByRole("dialog", { name: "영상과 장면 보기" }));
  fireEvent.keyDown(window.document, { key: "Escape" });
  none(screen.queryByRole("dialog", { name: "영상과 장면 보기" }));

  fireEvent.click(screen.getByRole("button", { name: /영상과 장면 보기/ }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "영상과 장면 보기" })).getByRole("button", { name: "접기" }));
  none(screen.queryByRole("dialog", { name: "영상과 장면 보기" }));
});

test("데스크톱 장면 패널은 접었다 펼 수 있다", async () => {
  startGuest();
  serve({ "GET /v2/practices?filter=all": { groups: [] }, ...analyzedWithNote() });
  await mount("session=p1");
  fireEvent.click(await screen.findByRole("button", { name: "« 장면 접기" }));
  none(screen.queryByText("이 장면에서 연기한 것"));
  fireEvent.click(button("장면 펼치기"));
  assert.ok(screen.getByText("이 장면에서 연기한 것"));
});

// ── 훑어보기와 코치 대화 ──────────────────────────────────────────

const analyzingPractice = (id = "p1") =>
  practice({ id, root_id: id, stage: "analyzing", analysis_status: null, job: { id: "job-1", status: "running", attempt_count: 1 } });
const settledStatus = { stage: "closed", analysis_status: "ready", job: { id: "job-1", status: "succeeded", attempt_count: 1 } };
const firstTurn = (overrides = {}) => ({ conversation: conversation(), message: "이 장면에서 무엇을 원했나요?", note: null, ...overrides });
const composer = () => screen.getByRole("textbox", { name: "코치에게 보낼 말" });
const question = () => screen.getByRole("heading", { level: 2 }).textContent;

function typeAnswer(text) {
  fireEvent.change(composer(), { target: { value: text } });
}

/** 분석이 끝나 노트 없이 열린 대화로 들어가는 회차. 코치 시작은 일반 JSON 응답이다. */
function analyzedNoNote(extra = {}) {
  return {
    "GET /v2/practices?filter=all": { groups: [] },
    "GET /v2/practices/p1": practice({ conversation_id: "c1", conversation_status: "open" }),
    "GET /v2/videos/v1": video(),
    "GET /v2/practices/p1/analysis": analysis,
    "POST /v2/coach/start/stream": firstTurn(),
    ...extra,
  };
}

test("훑어보는 중인 회차는 진행 막대와 그만두기를 보이고, 끝나면 코치가 쓰는 첫 질문이 그대로 자라 대화가 열린다", async () => {
  startGuest();
  const status = deferred();
  const coach = liveStream();
  serve({
    "GET /v2/practices?filter=all": { groups: [] },
    "GET /v2/practices/p1": [analyzingPractice(), practice()],
    "GET /v2/videos/v1": video(),
    "GET /v2/practices/p1/status": () => status.promise,
    "GET /v2/practices/p1/analysis": analysis,
    "POST /v2/coach/start/stream": coach.response,
  });
  await mount("session=p1");
  await screen.findByText("영상 길이 확인 · 장면을 훑어보고 있어요…");
  assert.ok(screen.getByText("질문 준비"));
  assert.ok(button("그만두기"));
  assert.match(screen.getByRole("progressbar").getAttribute("aria-label"), /% 영상 길이 확인 · 장면을 훑어보고 있어요…$/);

  await act(async () => status.resolve(settledStatus));
  await waitFor(() => assert.equal(sent("POST /v2/coach/start/stream").length, 1));
  assert.equal(sent("POST /v2/coach/start/stream")[0].body.practice_id, "p1");
  await act(async () => coach.send("delta", { text: "이 장면에서 " }));
  await waitFor(() => assert.equal(question(), "이 장면에서 "));
  await act(async () => {
    coach.send("done", firstTurn());
    coach.close();
  });
  await waitFor(() => assert.equal(question(), "이 장면에서 무엇을 원했나요?"));
  assert.ok(screen.getByText("질문 대화 중"));
  assert.ok(screen.getAllByText("첫 번째 질문").length > 0);
  assert.equal(composer().disabled, false);
});

test("답을 보내면 다음 질문이 오고 지난 문답을 펼쳐 볼 수 있으며, 그만이라고 쓰면 노트로 넘어간다", async () => {
  startGuest();
  serve(analyzedNoNote({
    "POST /v2/coach/reply/stream": [
      { conversation: conversation({ revision: 2, coach_reply_count: 2 }), message: "그때 상대는 어디를 보고 있었나요?", note: null },
      { conversation: conversation({ status: "closed", revision: 3 }), message: "", note: note() },
    ],
  }));
  await mount("session=p1");
  await waitFor(() => assert.equal(question(), "이 장면에서 무엇을 원했나요?"));
  assert.equal(button("보내기 →").disabled, true);
  typeAnswer("  다시 앉히고 싶었어요  ");
  fireEvent.click(button("보내기 →"));
  await waitFor(() => assert.equal(question(), "그때 상대는 어디를 보고 있었나요?"));
  const reply = sent("POST /v2/coach/reply/stream")[0].body;
  assert.deepEqual(
    { conversation_id: reply.conversation_id, text: reply.text, revision: reply.revision },
    { conversation_id: "c1", text: "다시 앉히고 싶었어요", revision: 1 },
  );
  assert.equal(composer().value, "");
  assert.ok(screen.getAllByText("두 번째 질문").length > 0);

  const history = button("지난 문답 1 ▾");
  assert.equal(history.getAttribute("aria-expanded"), "false");
  fireEvent.click(history);
  assert.equal(history.getAttribute("aria-expanded"), "true");
  const log = within(screen.getByRole("log", { name: "질문과 답변" }));
  assert.ok(log.getByText("이 장면에서 무엇을 원했나요?"));
  assert.ok(log.getByText("다시 앉히고 싶었어요"));

  typeAnswer("그만");
  fireEvent.click(button("보내기 →"));
  await screen.findByText("연습 노트");
  assert.equal(sent("POST /v2/coach/reply/stream")[1].body.revision, 2);
  assert.ok(screen.getByText("가지 마"));
  // 노트가 왔으면 목록을 다시 받아 문장 남김을 보인다.
  assert.equal(sent("GET /v2/practices?filter=all").length, 2);
});

test("다른 곳에서 대화가 먼저 저장됐으면 쓴 답을 돌려주고 최신 대화를 다시 읽는다", async () => {
  startGuest();
  serve(analyzedNoNote({
    "POST /v2/coach/reply/stream": fail(409, "conversation_conflict"),
    "GET /v2/coach/conversations/c1": conversation({
      revision: 3,
      messages: [
        { turn_index: 0, role: "coach", text: "이 장면에서 무엇을 원했나요?" },
        { turn_index: 1, role: "actor", text: "다른 기기에서 쓴 답" },
        { turn_index: 2, role: "coach", text: "다른 기기에서 받은 질문" },
      ],
    }),
  }));
  await mount("session=p1");
  await waitFor(() => assert.equal(question(), "이 장면에서 무엇을 원했나요?"));
  typeAnswer("내 답");
  fireEvent.click(button("보내기 →"));
  await waitFor(() => assert.equal(question(), "다른 기기에서 받은 질문"));
  assert.equal(alertText(), "방금 대화가 바뀌었어요. 최신 내용을 불러왔어요. 다시 보내 주세요.");
  assert.equal(composer().value, "내 답");
  assert.ok(button("지난 문답 1 ▾"));
});

test("최신 대화를 다시 읽었더니 닫혀 있으면 정리를 기다리는 끝 화면이 된다", async () => {
  startGuest();
  serve(analyzedNoNote({
    "POST /v2/coach/reply/stream": fail(409, "conversation_conflict"),
    "GET /v2/coach/conversations/c1": conversation({ status: "closed", revision: 2, messages: [{ turn_index: 0, role: "coach", text: "마지막 질문" }] }),
  }));
  await mount("session=p1");
  await waitFor(() => assert.equal(question(), "이 장면에서 무엇을 원했나요?"));
  typeAnswer("내 답");
  fireEvent.click(button("보내기 →"));
  await screen.findByText("이번 대화는 여기까지예요");
  assert.ok(screen.getByText("아직 정리 없음 · 오늘 나눈 대화는 남아 있어요."));
  assert.equal(button("정리보기").disabled, true);
  assert.ok(screen.getByText("대화 마침"));
});

test("답을 처리하지 못하면 쓴 답을 그대로 두고 다시 보내라고 말한다", async () => {
  startGuest();
  serve(analyzedNoNote({ "POST /v2/coach/reply/stream": fail(500, "internal_server_error") }));
  await mount("session=p1");
  await waitFor(() => assert.equal(question(), "이 장면에서 무엇을 원했나요?"));
  typeAnswer("내 답");
  fireEvent.click(button("보내기 →"));
  await waitFor(() => assert.equal(alertText(), "답변을 처리하지 못했어요. 잠시 후 다시 시도해 주세요."));
  assert.equal(composer().value, "내 답");
  none(within(screen.getByRole("log", { name: "질문과 답변" })).queryByText("내 답"), "보내지 못한 답은 대화에 남지 않는다");
});

test("이미 닫힌 대화에 답하면 대화를 잠그고 노트를 받아 정리보기로 넘어갈 수 있게 한다", async () => {
  startGuest();
  serve(analyzedNoNote({
    "POST /v2/coach/reply/stream": fail(409, "conversation_closed"),
    "GET /v2/practices/p1/note": [fail(404, "not_found"), note()],
  }));
  await mount("session=p1");
  await waitFor(() => assert.equal(question(), "이 장면에서 무엇을 원했나요?"));
  typeAnswer("내 답");
  fireEvent.click(button("보내기 →"));
  await screen.findByText("지금까지 이야기한 걸 정리해 뒀어요.");
  assert.equal(alertText(), "이미 마친 대화예요. 이어서 연습하려면 새 회차를 시작해 주세요.");
  fireEvent.click(button("정리보기"));
  await screen.findByText("연습 노트");
  assert.ok(screen.getByText("가지 마"));
  // 노트에서 대화로 돌아가면 끝난 대화가 그대로 있다.
  fireEvent.click(button("대화 다시 보기"));
  assert.ok(screen.getByText("이번 대화는 여기까지예요"));
});

test("닫힌 대화의 노트를 못 받으면 지난 연습에서 다시 열라고 말한다", async () => {
  startGuest();
  serve(analyzedNoNote({
    "POST /v2/coach/reply/stream": fail(409, "conversation_closed"),
    "GET /v2/practices/p1/note": [fail(404, "not_found"), fail(500, "internal_server_error")],
  }));
  await mount("session=p1");
  await waitFor(() => assert.equal(question(), "이 장면에서 무엇을 원했나요?"));
  typeAnswer("내 답");
  fireEvent.click(button("보내기 →"));
  await waitFor(() => assert.equal(alertText(), "대화는 마쳤지만 노트를 불러오지 못했어요. 지난 연습에서 다시 열어 주세요."));
});

test("코치를 못 부르면 다시 시도하라고 말한다", async () => {
  startGuest();
  serve(analyzedNoNote({ "POST /v2/coach/start/stream": fail(500, "internal_server_error") }));
  await mount("session=p1");
  await waitFor(() => assert.equal(alertText(), "코치 연결에 실패했어요. 잠시 후 다시 시도해 주세요."));
});

test("이미 오간 대화를 다시 열면 지난 턴을 읽어 그 자리부터 잇는다", async () => {
  startGuest();
  serve(analyzedNoNote({
    "POST /v2/coach/start/stream": firstTurn({ conversation: conversation({ revision: 3 }), message: "세 번째로 묻는 말" }),
    "GET /v2/coach/conversations/c1": conversation({
      revision: 3,
      messages: [
        { turn_index: 2, role: "coach", text: "세 번째로 묻는 말" },
        { turn_index: 0, role: "coach", text: "처음 물은 말" },
        { turn_index: 1, role: "actor", text: "처음 한 답" },
      ],
    }),
  }));
  await mount("session=p1");
  await waitFor(() => assert.equal(question(), "세 번째로 묻는 말"));
  fireEvent.click(button("지난 문답 1 ▾"));
  assert.ok(screen.getByText("처음 한 답"));
});

test("노트 없이 닫힌 대화를 열면 지난 대화와 함께 끝 화면이 선다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": { groups: [] },
    "GET /v2/practices/p1": practice({ conversation_id: "c1", conversation_status: "closed" }),
    "GET /v2/videos/v1": video(),
    "GET /v2/practices/p1/analysis": analysis,
    "GET /v2/coach/conversations/c1": conversation({
      status: "closed",
      messages: [
        { turn_index: 0, role: "coach", text: "처음 물은 말" },
        { turn_index: 1, role: "actor", text: "처음 한 답" },
        { turn_index: 2, role: "coach", text: "마지막 질문" },
      ],
    }),
  });
  await mount("session=p1");
  await screen.findByText("이번 대화는 여기까지예요");
  assert.equal(question(), "마지막 질문");
  assert.equal(sent("POST /v2/coach/start/stream").length, 0);
});

test("막힌 대화의 노트는 나눈 이야기를 보이고, 처음부터 다시 대화하면 새로 연 대화로 간다", async () => {
  startGuest();
  serve(analyzedNoNote({
    "POST /v2/coach/start/stream": [firstTurn(), firstTurn({ message: "처음부터 다시 물을게요" })],
    "POST /v2/coach/reply/stream": { conversation: conversation({ status: "closed", revision: 2 }), message: "여기서 멈출게요", note: blocked },
  }));
  await mount("session=p1");
  await waitFor(() => assert.equal(question(), "이 장면에서 무엇을 원했나요?"));
  typeAnswer("모르겠어요");
  fireEvent.click(button("보내기 →"));
  await screen.findByText("대화에서 찾은 내용을 먼저 모아 뒀어요");
  assert.ok(screen.getByText("모르겠어요"));
  assert.ok(screen.getByText("여기서 멈출게요"));
  fireEvent.click(button("처음부터 다시 대화하기"));
  await waitFor(() => assert.equal(question(), "처음부터 다시 물을게요"));
  assert.equal(sent("POST /v2/coach/start/stream").length, 2);
});

test("닫힌 대화는 처음부터 다시 열 수 없어 새 회차로 가라고 말한다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": { groups: [] },
    ...analyzedWithNote(),
    "GET /v2/practices/p1/note": blocked,
    "POST /v2/coach/start/stream": fail(409, "conversation_closed"),
  });
  await mount("session=p1");
  fireEvent.click(await screen.findByRole("button", { name: "처음부터 다시 대화하기" }));
  await waitFor(() => assert.equal(alertText(), "이미 마친 대화예요. 이어서 연습하려면 새 회차를 시작해 주세요."));
});

function cancellableAnalysis() {
  return {
    "GET /v2/practices?filter=all": { groups: [] },
    "GET /v2/practices/p1": analyzingPractice(),
    "GET /v2/videos/v1": video(),
    "GET /v2/practices/p1/status": () => new Promise(() => {}),
    "POST /v2/practices/p1/cancel": { stage: "closed", close_reason: "cancelled", job: { id: "job-1", status: "failed", attempt_count: 1 } },
    "POST /v2/practices/p1/analyze": analyzingPractice(),
  };
}

test("그만두기를 누르면 분석을 끝내고 다시 분석할 수 있으며, 다시 분석하면 진행 막대로 돌아간다", async () => {
  startGuest();
  serve(cancellableAnalysis());
  await mount("session=p1");
  fireEvent.click(await screen.findByRole("button", { name: "그만두기" }));
  await screen.findByText("영상 분석을 완료하지 못했어요");
  assert.ok(screen.getByText("영상을 분석해야 대화를 시작할 수 있어요. 다시 분석해 주세요."));
  fireEvent.click(button("영상 다시 분석"));
  await screen.findByRole("button", { name: "그만두기" });
  assert.equal(sent("POST /v2/practices/p1/cancel").length, 1);
  assert.equal(sent("POST /v2/practices/p1/analyze").length, 1);
  assert.equal(alertText(), null);
});

test("그만두기는 배우가 고른 끝이라 상태 확인 실패 문구를 띄우지 않는다", { todo: "버그: 그만두기가 끊은 상태 조회가 실패 문구를 띄운다" }, async () => {
  startGuest();
  serve(cancellableAnalysis());
  await mount("session=p1");
  fireEvent.click(await screen.findByRole("button", { name: "그만두기" }));
  await screen.findByText("영상 분석을 완료하지 못했어요");
  assert.equal(alertText(), null);
});

test("그만두지 못했거나 다시 분석을 요청하지 못하면 그렇게 말한다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": { groups: [] },
    "GET /v2/practices/p1": analyzingPractice(),
    "GET /v2/videos/v1": video(),
    "GET /v2/practices/p1/status": () => new Promise(() => {}),
    "POST /v2/practices/p1/cancel": fail(500, "internal_server_error"),
  });
  await mount("session=p1");
  fireEvent.click(await screen.findByRole("button", { name: "그만두기" }));
  await waitFor(() => assert.equal(alertText(), "분석을 그만두지 못했어요. 잠시 후 다시 시도해 주세요."));
  cleanup();

  serve({
    "GET /v2/practices?filter=all": { groups: [] },
    "GET /v2/practices/p1": practice({ stage: "closed", analysis_status: null, job: { id: "job-1", status: "failed", failure_reason: "timeout", attempt_count: 3 } }),
    "GET /v2/videos/v1": video(),
    "POST /v2/practices/p1/analyze": fail(500, "internal_server_error"),
  });
  await mount("session=p1");
  fireEvent.click(await screen.findByRole("button", { name: "영상 다시 분석" }));
  await waitFor(() => assert.equal(alertText(), "영상 분석을 다시 요청하지 못했어요. 잠시 후 다시 시도해 주세요."));
});

// ── 새 연습 시작 ─────────────────────────────────────────────────

const libraryVideo = () => video({ id: "v9", playback_url: "https://cdn.test/v9.mp4" });
const createdPractice = (id = "p2") => practice({ id, root_id: id, video_id: "v9", ...analyzingPractice(id), video_id: "v9" });
const fileInput = () => window.document.querySelector('input[type="file"]');
const field = (name) => screen.getByRole("textbox", { name });

test("보관함 영상을 들고 장면을 적어 시작하면 그 영상으로 회차를 만들고 훑어보기로 넘어간다", async () => {
  startGuest();
  const status = deferred();
  serve({
    "GET /v2/practices?filter=all": { groups: [] },
    "GET /v2/videos/v9": libraryVideo(),
    "POST /v2/practices": json(201, createdPractice()),
    "GET /v2/practices/p2/status": () => status.promise,
  });
  await mount("video=v9");
  await screen.findByText("보관함 영상");
  assert.equal(button("질문 받기").disabled, false);
  assert.ok(screen.getByText("누르면 장면을 보고 질문을 만들어요"));
  fireEvent.change(field("상황"), { target: { value: " 카페에서 이별 통보 " } });
  fireEvent.change(field("인물"), { target: { value: "담담한 척하는 여자" } });
  fireEvent.change(field("목표"), { target: { value: "다시 앉히기" } });
  fireEvent.click(button("연기 표현"));
  fireEvent.click(button("질문 받기"));
  await screen.findByText("1분 12초 영상 · 장면을 훑어보고 있어요…");
  const created = sent("POST /v2/practices")[0].body;
  assert.deepEqual(
    { video_id: created.video_id, scene: created.scene, blockage: created.blockage },
    {
      video_id: "v9",
      scene: { situation: "카페에서 이별 통보", character: "담담한 척하는 여자", goal: "다시 앉히기" },
      blockage: { category: "표현", detail: "그 외", note: null },
    },
  );
  assert.equal(location(), "/practice/new?session=p2");
  assert.equal(sent("GET /v2/practices?filter=all").length, 1 + 1, "회차를 만들면 목록을 다시 받는다");
  // 시작한 회차는 게스트의 오늘 분석으로 센다.
  assert.equal(JSON.parse(window.localStorage.getItem("acttub.practice.guest_daily")).count, 1);
});

test("장면을 적지 않고 시작하면 빈 장면과 중립 막힘으로 회차를 만든다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": { groups: [] },
    "GET /v2/videos/v9": libraryVideo(),
    "POST /v2/practices": json(201, createdPractice()),
    "GET /v2/practices/p2/status": () => new Promise(() => {}),
  });
  await mount("video=v9");
  await screen.findByText("보관함 영상");
  fireEvent.click(button("질문 받기"));
  await screen.findByRole("button", { name: "그만두기" });
  const created = sent("POST /v2/practices")[0].body;
  assert.deepEqual(
    { scene: created.scene, blockage: created.blockage },
    { scene: { situation: "", character: "", goal: "" }, blockage: { category: "그 외", detail: "그 외", note: null } },
  );
});

test("장면 칸이 300자를 넘으면 시작하지 않고 한도를 알린다", async () => {
  startGuest();
  serve({ "GET /v2/practices?filter=all": { groups: [] }, "GET /v2/videos/v9": libraryVideo() });
  await mount("video=v9");
  await screen.findByText("보관함 영상");
  fireEvent.change(field("목표"), { target: { value: "가".repeat(301) } });
  fireEvent.click(button("질문 받기"));
  assert.equal(alertText(), "상황·인물·목표는 각 300자까지 적을 수 있어요.");
  assert.equal(sent("POST /v2/practices").length, 0);
});

test("파일만 파기한 보관함 영상은 들지 않고, 보관함 영상을 못 받으면 그렇게 말한다", async () => {
  startGuest();
  serve({ "GET /v2/practices?filter=all": { groups: [] }, "GET /v2/videos/v9": video({ id: "v9", purged_at: iso(0), playback_url: null }) });
  await mount("video=v9");
  await waitFor(() => assert.equal(sent("GET /v2/videos/v9").length, 1));
  assert.ok(screen.getByRole("button", { name: /오늘의 연기 영상을 올려 주세요/ }));
  none(screen.queryByText("보관함 영상"));
  cleanup();

  serve({ "GET /v2/practices?filter=all": { groups: [] }, "GET /v2/videos/v9": fail(500, "internal_server_error") });
  await mount("video=v9");
  await waitFor(() => assert.equal(alertText(), "보관함 영상을 불러오지 못했어요."));
});

test("회차를 만들지 못하면 준비 화면으로 돌아가고, 같은 본문으로 다시 누르면 같은 요청 id 로 다시 보낸다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": { groups: [] },
    "GET /v2/videos/v9": libraryVideo(),
    "POST /v2/practices": [fail(500, "internal_server_error"), json(201, createdPractice())],
    "GET /v2/practices/p2/status": () => new Promise(() => {}),
  });
  await mount("video=v9");
  await screen.findByText("보관함 영상");
  fireEvent.click(button("질문 받기"));
  await waitFor(() => assert.equal(alertText(), "문제가 생겼어요. 다시 시도해 주세요."));
  assert.equal(button("질문 받기").disabled, false);
  assert.equal(window.localStorage.getItem("acttub.practice.guest_daily"), null, "실패한 시작은 세지 않는다");
  fireEvent.click(button("질문 받기"));
  await screen.findByRole("button", { name: "그만두기" });
  const [first, second] = sent("POST /v2/practices");
  assert.equal(second.body.request_id, first.body.request_id);
});

test("묶음에 진행 중 회차가 있다는 답을 받으면 목록에서 그 회차를 찾아 연다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": [
      { groups: [] },
      { groups: [group({ in_progress_practice_id: "p5" }, [practice({ id: "p5", root_id: "p5", stage: "analyzing" })])] },
    ],
    "GET /v2/videos/v9": libraryVideo(),
    "POST /v2/practices": fail(409, "practice_in_progress"),
    "GET /v2/practices/p5": analyzingPractice("p5"),
    "GET /v2/videos/v1": video(),
    "GET /v2/practices/p5/status": () => new Promise(() => {}),
  });
  await mount("video=v9");
  await screen.findByText("보관함 영상");
  fireEvent.click(button("질문 받기"));
  await waitFor(() => assert.equal(location(), "/practice/new?session=p5"));
  await screen.findByRole("button", { name: "그만두기" });
  assert.equal(sent("GET /v2/practices/p5").length, 1);
});

test("같은 영상으로 이어하면 이전 회차에서 다음 회차를 만들고 영상 id 는 싣지 않는다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": { groups: [] },
    ...analyzedWithNote(),
    "POST /v2/practices/p1/continue": json(201, practice({ ...analyzingPractice("p3"), root_id: "p1", ordinal: 2 })),
    "GET /v2/practices/p3/status": () => new Promise(() => {}),
  });
  await mount("session=p1");
  fireEvent.click(await screen.findByRole("button", { name: "같은 영상으로 이어하기" }));
  fireEvent.click(button("질문 받기"));
  await screen.findByRole("button", { name: "그만두기" });
  const body = sent("POST /v2/practices/p1/continue")[0].body;
  assert.equal("video_id" in body, false);
  assert.deepEqual(body.scene, { situation: "", character: "", goal: "" });
  assert.equal(location(), "/practice/new?session=p3");
});

test("MP4·MOV 가 아닌 파일을 골라 시작하면 올리지 않고 준비 화면에서 알린다", async () => {
  startGuest();
  serve({ "GET /v2/practices?filter=all": { groups: [] } });
  await mount();
  const file = new File(["hello"], "memo.txt", { type: "text/plain" });
  fireEvent.change(fileInput(), { target: { files: [file] } });
  assert.ok(screen.getByText("memo.txt"));
  assert.ok(button("← 다시 선택"));
  fireEvent.click(button("질문 받기"));
  await waitFor(() => assert.equal(alertText(), "MP4 또는 MOV 영상만 업로드할 수 있어요."));
  assert.ok(screen.getByText("memo.txt"), "고른 영상은 그대로 들고 있다");
  assert.equal(sent("POST /v2/videos/intents").length, 0);
});

test("영상의 길이를 읽으면 훑어보기 막대가 그 길이를 말한다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": { groups: [] },
    "GET /v2/practices/p1": analyzingPractice(),
    "GET /v2/videos/v1": video(),
    "GET /v2/practices/p1/status": () => new Promise(() => {}),
  });
  await mount("session=p1");
  await screen.findByText("영상 길이 확인 · 장면을 훑어보고 있어요…");
  const player = window.document.querySelector("video");
  Object.defineProperty(player, "duration", { value: 45.4, configurable: true });
  fireEvent.loadedMetadata(player);
  assert.ok(screen.getByText("45초 영상 · 장면을 훑어보고 있어요…"));
});

// ── 숨기기·마치기 ────────────────────────────────────────────────

test("숨기기를 확인하면 묶음을 숨기고 새 연습 준비 화면으로 돌아간다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": { groups: [group({}, [practice({ note_id: "n1", note_title: "말끝의 전달" })])] },
    ...analyzedWithNote(),
    "PATCH /v2/practices/p1/group": group({ hidden_at: iso(0) }),
  });
  await mount("session=p1");
  await screen.findByText("연습 노트");
  fireEvent.click(button("숨기기"));
  assert.ok(screen.getByText("기록에서 숨겨요. 영상은 보관함에 남아요"));
  fireEvent.click(button("취소"));
  none(screen.queryByText("기록에서 숨겨요. 영상은 보관함에 남아요"));
  fireEvent.click(button("숨기기"));
  fireEvent.click(screen.getAllByRole("button", { name: "숨기기" })[1]);
  await waitFor(() => assert.equal(location(), "/practice/new"));
  assert.deepEqual(sent("PATCH /v2/practices/p1/group")[0].body, { hidden: true });
  assert.ok(screen.getByRole("button", { name: /오늘의 연기 영상을 올려 주세요/ }));
});

test("숨기지 못하면 그 화면에 남아 다시 시도하라고 말한다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": { groups: [] },
    ...analyzedWithNote(),
    "PATCH /v2/practices/p1/group": fail(500, "internal_server_error"),
  });
  await mount("session=p1");
  await screen.findByText("연습 노트");
  fireEvent.click(button("숨기기"));
  fireEvent.click(screen.getAllByRole("button", { name: "숨기기" })[1]);
  await waitFor(() => assert.equal(alertText(), "연습을 숨기지 못했어요. 잠시 후 다시 시도해 주세요."));
  assert.ok(screen.getByText("연습 노트"));
});

test("노트에서 연습 마치기를 누르면 후기 창이 뜨고, 건너뛰면 접수만 하고 새 연습 준비 화면으로 간다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": { groups: [] },
    ...analyzedWithNote(),
    "POST /v2/practice-feedback": json(201, { id: "f1" }),
  });
  await mount("session=p1");
  await screen.findByText("연습 노트");
  fireEvent.click(screen.getAllByRole("button", { name: "연습 마치기" }).at(-1));
  const dialog = within(screen.getByRole("dialog", { name: "연습 후기" }));
  fireEvent.click(dialog.getByRole("button", { name: "건너뛰기" }));
  await waitFor(() => assert.equal(location(), "/practice/new"));
  const feedback = sent("POST /v2/practice-feedback")[0].body;
  assert.deepEqual(
    { practice_id: feedback.practice_id, screen: feedback.screen, trigger: feedback.trigger, body: feedback.body },
    { practice_id: "p1", screen: "report", trigger: "x", body: undefined },
  );
  none(screen.queryByRole("dialog", { name: "연습 후기" }));
});

test("대화 중 뒤로 가기를 하면 한 번만 후기 창을 띄우고, 닫아도 보던 대화에 남는다", async () => {
  startGuest();
  serve(analyzedNoNote({
    "POST /v2/me/practice-feedback/claim": { asked: true, asked_now: true },
    "POST /v2/practice-feedback": json(201, { id: "f1" }),
  }));
  await mount("session=p1");
  await waitFor(() => assert.equal(question(), "이 장면에서 무엇을 원했나요?"));
  await act(async () => window.dispatchEvent(new window.PopStateEvent("popstate")));
  const dialog = within(await screen.findByRole("dialog", { name: "연습 후기" }));
  fireEvent.change(dialog.getByRole("textbox", { name: "한 줄 소감" }), { target: { value: "질문이 좋았어요" } });
  fireEvent.click(dialog.getByRole("button", { name: "보내기" }));
  await waitFor(() => none(screen.queryByRole("dialog", { name: "연습 후기" })));
  const feedback = sent("POST /v2/practice-feedback")[0].body;
  assert.deepEqual(
    { screen: feedback.screen, trigger: feedback.trigger, body: feedback.body },
    { screen: "coach", trigger: "back", body: "질문이 좋았어요" },
  );
  assert.equal(question(), "이 장면에서 무엇을 원했나요?");
  assert.equal(location(), "/practice/new?session=p1");
  await act(async () => window.dispatchEvent(new window.PopStateEvent("popstate")));
  assert.equal(sent("POST /v2/me/practice-feedback/claim").length, 1);
});

test("폰 드로어에서 지난 연습을 열면 드로어가 닫히고 그 연습이 열린다", async () => {
  startGuest();
  serve({
    "GET /v2/practices?filter=all": { groups: [group({}, [practice({ note_id: "n1", note_title: "말끝의 전달" })])] },
    ...analyzedWithNote(),
  });
  await mount();
  fireEvent.click(button("지난 연습 목록 열기"));
  const drawer = within(screen.getAllByRole("complementary")[1]);
  fireEvent.click(await drawer.findByText("말끝의 전달"));
  await screen.findByText("연습 노트");
  assert.equal(screen.getAllByRole("complementary").length, 1);
});

test("새 연습을 누르면 열어 둔 연습을 놓고 빈 준비 화면으로 간다", async () => {
  startGuest();
  serve({ "GET /v2/practices?filter=all": { groups: [] }, ...analyzedWithNote() });
  await mount("session=p1");
  await screen.findByText("연습 노트");
  fireEvent.click(within(screen.getAllByRole("complementary")[0]).getByRole("button", { name: "새 연습" }));
  assert.equal(location(), "/practice/new");
  assert.ok(screen.getByRole("button", { name: /오늘의 연기 영상을 올려 주세요/ }));
  none(screen.queryByText("연습 노트"));
});
