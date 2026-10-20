// practice.library — 보관함(/library)과 보관함 영상(/library/<id>)을 실제로 그려, 게스트의 영상 목록·필터·즐겨찾기와
// 상세의 재생·삭제·파일만 파기가 어떤 요청을 보내고 화면을 어떻게 바꾸는지 본다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";
import { navigation, resetNavigation } from "./fixtures/features-next-shims.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import("@testing-library/react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { LibraryPage } = await import("../src/features/library/library-page.tsx");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const h = react.createElement;
const originalFetch = globalThis.fetch;

const video = (overrides = {}) => ({
  id: "v-1",
  duration_ms: 72_000,
  byte_size: 1,
  content_type: "video/mp4",
  favorite: false,
  purged_at: null,
  created_at: "2026-09-21T03:00:00Z",
  usage: { practice_count: 0, entry_count: 0 },
  playback_url: null,
  playback_expires_at: null,
  ...overrides,
});

const playable = (overrides = {}) =>
  video({ playback_url: "https://cdn.example/v-1?sig=1", playback_expires_at: "2099-01-01T00:00:00Z", ...overrides });

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

/** "METHOD /path" 마다 차례로 줄 응답 목록. 온 요청의 경로와 본문을 적어 둔다. */
function serve(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const route = `${init.method ?? "GET"} ${String(url)}`;
    calls.push({ route, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const queue = routes[route];
    if (!queue?.length) throw new Error(`예상하지 못한 요청: ${route}`);
    return queue.length > 1 ? queue.shift()() : queue[0]();
  };
  return calls;
}

const routesOf = (calls) => calls.map(({ route }) => route);

function openAt(pathname) {
  window.history.replaceState(null, "", pathname);
  return render(h(LibraryPage));
}

const startGuest = () => setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });

beforeEach(() => {
  clearTokens();
  resetNavigation("/library");
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  clearTokens();
  window.history.replaceState(null, "", "/");
});

test("practice.library: 프리렌더한 껍데기는 경로를 모르므로 아무것도 그리지 않는다", () => {
  window.history.replaceState(null, "", "/library/v-1");
  const html = renderToStaticMarkup(h(LibraryPage));

  assert.equal(html.replace(/<[^>]+>/g, ""), "");
});

test("practice.library: 게스트가 없으면 서버에 묻지 않고 빈 보관함을 보인다", () => {
  const calls = serve({});
  openAt("/library");

  assert.equal(screen.getByText("아직 보관한 영상이 없어요. 새 연습에서 영상을 올리면 여기에 남아요.").tagName, "P");
  assert.equal(screen.getByRole("link", { name: "연습" }).getAttribute("href"), "/practice/new");
  assert.equal(screen.getByRole("link", { name: "리딩" }).getAttribute("href"), "/reading");
  assert.equal(screen.getByRole("link", { name: "새 연습" }).getAttribute("href"), "/practice/new");
  assert.deepEqual(calls, []);
});

test("practice.library: 게스트의 영상을 최신 저장순 그대로 카드로 보이고 상세로 잇는다", async () => {
  startGuest();
  const calls = serve({
    "GET /v2/videos?filter=all": [
      () =>
        jsonResponse({
          videos: [
            video({ id: "v-1", favorite: true }),
            video({ id: "v 2", duration_ms: 5_400, purged_at: "2026-09-22T00:00:00Z", usage: { practice_count: 2, entry_count: 1 } }),
          ],
          next_cursor: null,
        }),
    ],
  });
  openAt("/library");

  assert.equal(screen.getByText("불러오는 중…").tagName, "P");
  const first = await screen.findByRole("link", { name: /▶ 1:12/ });

  assert.equal(first.getAttribute("href"), "/library/v-1");
  assert.equal(first.textContent, "▶ 1:122026년 9월 21일보관함 저장 · 회차 0개 · 챌린지 참여작 0개");
  const purged = screen.getByRole("link", { name: /재생할 수 없어요 · 회차 2개/ });
  assert.equal(purged.getAttribute("href"), "/library/v%202");
  assert.deepEqual(
    screen.getAllByRole("button", { name: /^[★☆] 즐겨찾기$/ }).map((button) => [button.textContent, button.getAttribute("aria-pressed")]),
    [
      ["★ 즐겨찾기", "true"],
      ["☆ 즐겨찾기", "false"],
    ],
  );
  assert.deepEqual(routesOf(calls), ["GET /v2/videos?filter=all"]);
});

test("practice.library: 필터를 바꾸면 그 필터로 다시 묻고, 비었으면 필터에 맞는 빈 문구를 보인다", async () => {
  startGuest();
  const calls = serve({
    "GET /v2/videos?filter=all": [() => jsonResponse({ videos: [video()], next_cursor: null })],
    "GET /v2/videos?filter=recent7": [() => jsonResponse({ videos: [], next_cursor: null })],
    "GET /v2/videos?filter=favorite": [() => jsonResponse({ videos: [], next_cursor: null })],
  });
  openAt("/library");
  await screen.findByRole("link", { name: /▶ 1:12/ });
  assert.equal(screen.getByRole("button", { name: "전체" }).getAttribute("aria-pressed"), "true");

  fireEvent.click(screen.getByRole("button", { name: "최근 7일" }));
  assert.equal((await screen.findByText("최근 7일에 저장한 영상이 없어요.")).tagName, "P");
  assert.equal(screen.getByRole("button", { name: "최근 7일" }).getAttribute("aria-pressed"), "true");

  fireEvent.click(screen.getByRole("button", { name: "즐겨찾기" }));
  assert.equal((await screen.findByText("즐겨찾기한 영상이 없어요.")).tagName, "P");
  assert.deepEqual(routesOf(calls), ["GET /v2/videos?filter=all", "GET /v2/videos?filter=recent7", "GET /v2/videos?filter=favorite"]);
});

test("practice.library: 목록에서 즐겨찾기를 켜면 PATCH 하고 카드에 바로 반영한다", async () => {
  startGuest();
  const calls = serve({
    "GET /v2/videos?filter=all": [() => jsonResponse({ videos: [video()], next_cursor: null })],
    "PATCH /v2/videos/v-1": [() => jsonResponse(video({ favorite: true }))],
  });
  openAt("/library");
  fireEvent.click(await screen.findByRole("button", { name: "☆ 즐겨찾기" }));

  const on = await screen.findByRole("button", { name: "★ 즐겨찾기" });
  assert.equal(on.getAttribute("aria-pressed"), "true");
  assert.deepEqual(calls.at(-1), { route: "PATCH /v2/videos/v-1", body: { favorite: true } });
  assert.deepEqual(routesOf(calls), ["GET /v2/videos?filter=all", "PATCH /v2/videos/v-1"]);
});

test("practice.library: 즐겨찾기 목록에서 해제하면 목록을 다시 받아 빠진 영상을 거둔다", async () => {
  startGuest();
  const calls = serve({
    "GET /v2/videos?filter=all": [() => jsonResponse({ videos: [video({ favorite: true })], next_cursor: null })],
    "GET /v2/videos?filter=favorite": [
      () => jsonResponse({ videos: [video({ favorite: true })], next_cursor: null }),
      () => jsonResponse({ videos: [], next_cursor: null }),
    ],
    "PATCH /v2/videos/v-1": [() => jsonResponse(video({ favorite: false }))],
  });
  openAt("/library");
  await screen.findByRole("button", { name: "★ 즐겨찾기" });
  fireEvent.click(screen.getByRole("button", { name: "즐겨찾기" }));
  fireEvent.click(await screen.findByRole("button", { name: "★ 즐겨찾기" }));

  assert.equal((await screen.findByText("즐겨찾기한 영상이 없어요.")).tagName, "P");
  assert.deepEqual(routesOf(calls), [
    "GET /v2/videos?filter=all",
    "GET /v2/videos?filter=favorite",
    "PATCH /v2/videos/v-1",
    "GET /v2/videos?filter=favorite",
  ]);
  assert.deepEqual(calls[2].body, { favorite: false });
});

test("practice.library: 목록 즐겨찾기에 실패하면 카드를 그대로 두고 알린다", async () => {
  startGuest();
  serve({
    "GET /v2/videos?filter=all": [() => jsonResponse({ videos: [video()], next_cursor: null })],
    "PATCH /v2/videos/v-1": [() => jsonResponse({ detail: "internal_error" }, 500)],
  });
  openAt("/library");
  fireEvent.click(await screen.findByRole("button", { name: "☆ 즐겨찾기" }));

  assert.equal((await screen.findByRole("alert")).textContent, "잠시 뒤 다시 시도해 주세요.");
  assert.equal(screen.getByRole("button", { name: "☆ 즐겨찾기" }).getAttribute("aria-pressed"), "false");
});

test("practice.library: 목록을 못 불러오면 빈 보관함 대신 알린다", async () => {
  startGuest();
  serve({ "GET /v2/videos?filter=all": [() => jsonResponse({ detail: "internal_error" }, 500)] });
  openAt("/library");

  assert.equal((await screen.findByRole("alert")).textContent, "보관함을 불러오지 못했어요.");
  assert.equal(screen.queryByText("불러오는 중…"), null);
  assert.equal(screen.queryByText(/아직 보관한 영상이 없어요/), null);
});

test("practice.library: 경로의 id 가 깨졌으면 상세 대신 목록을 연다", async () => {
  startGuest();
  const calls = serve({ "GET /v2/videos?filter=all": [() => jsonResponse({ videos: [], next_cursor: null })] });
  openAt("/library/%E0%A4%A");

  await screen.findByText(/아직 보관한 영상이 없어요/);
  assert.deepEqual(routesOf(calls), ["GET /v2/videos?filter=all"]);
});

test("practice.library: 상세는 서명 주소로 재생하고 날짜·길이·저장 상태·사용처와 코칭으로 보내는 길을 보인다", async () => {
  startGuest();
  const calls = serve({ "GET /v2/videos/v-1": [() => jsonResponse(playable())] });
  openAt("/library/v-1");

  assert.equal(screen.getByText("불러오는 중…").tagName, "P");
  await screen.findByText("사용처 · 회차 0개 · 챌린지 참여작 0개");

  assert.equal(window.document.querySelector("video").getAttribute("src"), "https://cdn.example/v-1?sig=1");
  assert.equal(screen.getByText("2026년 9월 21일").tagName, "P");
  assert.equal(screen.getByText("1:12 · 보관함 저장").tagName, "P");
  assert.equal(screen.getByRole("link", { name: "← 보관함" }).getAttribute("href"), "/library");
  assert.equal(screen.getByRole("link", { name: "질문 코칭으로 보내기" }).getAttribute("href"), "/practice/new?video=v-1");
  assert.equal(screen.getByRole("button", { name: "보관함에서 삭제" }).disabled, false);
  assert.deepEqual(routesOf(calls), ["GET /v2/videos/v-1"]);
});

test("practice.library: 재생 주소가 만료돼 재생이 실패하면 다시 조회해 새 주소로 바꾼다", async () => {
  startGuest();
  const calls = serve({
    "GET /v2/videos/v-1": [
      () => jsonResponse(playable()),
      () => jsonResponse(playable({ playback_url: "https://cdn.example/v-1?sig=2" })),
    ],
  });
  openAt("/library/v-1");
  await screen.findByText("사용처 · 회차 0개 · 챌린지 참여작 0개");

  fireEvent.error(window.document.querySelector("video"));

  await waitFor(() => assert.equal(window.document.querySelector("video")?.getAttribute("src"), "https://cdn.example/v-1?sig=2"));
  assert.deepEqual(routesOf(calls), ["GET /v2/videos/v-1", "GET /v2/videos/v-1"]);
});

test("practice.library: 받은 재생 주소가 이미 만료됐으면 재생기 대신 주소를 받는 중이라고 보인다", async () => {
  startGuest();
  serve({ "GET /v2/videos/v-1": [() => jsonResponse(video({ playback_url: "https://cdn.example/old", playback_expires_at: "2000-01-01T00:00:00Z" }))] });
  openAt("/library/v-1");

  assert.equal((await screen.findByText("재생 주소를 받는 중…")).tagName, "DIV");
  assert.equal(window.document.querySelector("video"), null);
});

test("practice.library: 상세에서 즐겨찾기를 켜고 끈다", async () => {
  startGuest();
  const calls = serve({
    "GET /v2/videos/v-1": [() => jsonResponse(playable())],
    "PATCH /v2/videos/v-1": [() => jsonResponse(playable({ favorite: true })), () => jsonResponse(playable({ favorite: false }))],
  });
  openAt("/library/v-1");
  fireEvent.click(await screen.findByRole("button", { name: "☆ 즐겨찾기" }));
  fireEvent.click(await screen.findByRole("button", { name: "★ 즐겨찾기 해제" }));

  await screen.findByRole("button", { name: "☆ 즐겨찾기" });
  assert.deepEqual(
    calls.filter(({ route }) => route.startsWith("PATCH")).map(({ body }) => body),
    [{ favorite: true }, { favorite: false }],
  );
});

test("practice.library: 참조 없는 영상은 확인을 받고 지운 뒤 보관함으로 돌아간다", async () => {
  startGuest();
  const calls = serve({
    "GET /v2/videos/v-1": [() => jsonResponse(playable())],
    "DELETE /v2/videos/v-1": [() => new Response(null, { status: 204 })],
  });
  openAt("/library/v-1");
  fireEvent.click(await screen.findByRole("button", { name: "보관함에서 삭제" }));

  assert.equal(screen.getByText("이 영상을 보관함에서 지워요. 되돌릴 수 없어요.").tagName, "P");
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  assert.equal(screen.queryByText("이 영상을 보관함에서 지워요. 되돌릴 수 없어요."), null);

  fireEvent.click(screen.getByRole("button", { name: "보관함에서 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "지우기" }));

  await waitFor(() => assert.deepEqual(navigation.pushed, ["/library"]));
  assert.deepEqual(routesOf(calls), ["GET /v2/videos/v-1", "DELETE /v2/videos/v-1"]);
});

test("practice.library: 그사이 회차가 쓰기 시작한 영상을 지우려 하면 422 video_in_use 를 화면 문구로 알린다", async () => {
  startGuest();
  serve({
    "GET /v2/videos/v-1": [() => jsonResponse(playable())],
    "DELETE /v2/videos/v-1": [() => jsonResponse({ detail: "video_in_use" }, 422)],
  });
  openAt("/library/v-1");
  fireEvent.click(await screen.findByRole("button", { name: "보관함에서 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "지우기" }));

  assert.equal((await screen.findByRole("alert")).textContent, "회차나 챌린지에 쓰인 영상이라 지울 수 없어요. 파일만 파기할 수 있어요.");
  assert.deepEqual(navigation.pushed, []);
  assert.equal(screen.getByRole("button", { name: "보관함에서 삭제" }).disabled, false);
});

test("practice.library: 두 회차가 쓰는 영상은 삭제 대신 파일만 파기하고, 파기 뒤에는 재생할 수 없다고 보인다", async () => {
  startGuest();
  const referenced = { usage: { practice_count: 2, entry_count: 0 } };
  const calls = serve({
    "GET /v2/videos/v-1": [() => jsonResponse(playable(referenced))],
    "POST /v2/videos/v-1/purge-file": [() => jsonResponse(video({ ...referenced, purged_at: "2026-09-22T00:00:00Z" }))],
  });
  openAt("/library/v-1");
  await screen.findByText("사용처 · 회차 2개 · 챌린지 참여작 0개");
  assert.equal(screen.queryByRole("button", { name: "보관함에서 삭제" }), null);
  assert.equal(screen.getByText("회차나 챌린지에 쓰인 영상이라 지울 수 없어요. 파일만 파기할 수 있어요.").tagName, "P");

  fireEvent.click(screen.getByRole("button", { name: "파일만 파기" }));
  const prompt = screen.getByText("영상 파일만 파기해요. 회차·챌린지 기록은 남지만 이 영상은 다시 재생할 수 없어요.").parentElement;
  fireEvent.click(within(prompt).getByRole("button", { name: "파일만 파기" }));

  await screen.findByText("1:12 · 재생할 수 없어요");
  assert.equal(screen.getByText("재생할 수 없어요", { selector: "div" }).tagName, "DIV");
  assert.equal(window.document.querySelector("video"), null);
  assert.equal(screen.queryByRole("link", { name: "질문 코칭으로 보내기" }), null);
  assert.equal(screen.queryByRole("button", { name: "파일만 파기" }), null);
  assert.deepEqual(calls.at(-1), { route: "POST /v2/videos/v-1/purge-file", body: {} });
});

test("practice.library: 상세를 못 불러오면 알린다", async () => {
  startGuest();
  serve({ "GET /v2/videos/v-1": [() => jsonResponse({ detail: "internal_error" }, 500)] });
  openAt("/library/v-1");

  assert.equal((await screen.findByRole("alert")).textContent, "영상을 불러오지 못했어요.");
});

test("practice.library: 게스트가 없으면 상세도 서버에 묻지 않는다", async () => {
  const calls = serve({});
  openAt("/library/v-1");
  await act(async () => {});

  assert.equal(screen.getByText("불러오는 중…").tagName, "P");
  assert.deepEqual(calls, []);
});
