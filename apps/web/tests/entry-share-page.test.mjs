// 참여작 공유 페이지 /e/<id>(challenge.share)를 서버 렌더 경로 그대로 부른다. 방문자 주소를 API 에 넘기고,
// 찾은 참여작은 작품·배역·대사와 "앱에서 보기"를, 없거나 못 불러오면 각자의 안내를 보여 준다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";
import "./fixtures/features-next-shims.mjs";

const requestHeaders = { "x-forwarded-for": "203.0.113.7" };
globalThis.__entryShareRequestHeaders = requestHeaders;
const headersModule = `data:text/javascript,${encodeURIComponent(
  "export async function headers() { return new Headers(globalThis.__entryShareRequestHeaders); }",
)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: headersModule, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

delete process.env.ACTTUB_SERVER_API_ORIGIN;
delete process.env.NEXT_PUBLIC_SITE_URL;

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const route = await import("../src/app/e/[id]/page.tsx");
const layout = await import("../src/app/e/[id]/layout.tsx");

const ENTRY_ID = "6f1c2d8e-3b1a-4c55-9a7e-0b2f4d6a8c10";
const originalFetch = globalThis.fetch;
let requests;

function serve(status, body) {
  requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({
      url: String(url),
      forwardedFor: new Headers(options.headers).get("X-Forwarded-For"),
      aborts: options.signal instanceof AbortSignal,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

async function renderRoute(id = ENTRY_ID) {
  const element = await route.default({ params: Promise.resolve({ id }) });
  return render(element);
}

beforeEach(() => {
  requests = [];
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test("찾은 참여작은 작품·배역·대사를 보여 주고, 방문자 주소를 실어 API 에 묻는다", async () => {
  serve(200, { work: "햄릿", character: "햄릿", line: "죽느냐 사느냐", poster_url: null });

  await renderRoute();

  assert.deepEqual(requests, [
    {
      url: `http://127.0.0.1:8080/v2/public/entries/${ENTRY_ID}`,
      forwardedFor: "203.0.113.7",
      aborts: true,
    },
  ]);
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "햄릿햄릿 역");
  assert.equal(screen.getByText("“죽느냐 사느냐”").textContent, "“죽느냐 사느냐”");
  assert.equal(screen.getByRole("link", { name: "앱에서 보기" }).getAttribute("href"), "/app");
  assert.equal(screen.getByText("앱이 없으면 스토어로 이동해요").textContent, "앱이 없으면 스토어로 이동해요");
  assert.equal(screen.getByRole("link", { name: "Acttub 홈" }).getAttribute("href"), "/");
});

test("배역이 없는 챌린지의 참여작은 작품 이름만 제목이다", async () => {
  serve(200, { work: "갈매기", character: null, line: "나는 갈매기", poster_url: null });

  await renderRoute();

  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "갈매기");
});

test("없는 참여작은 찾을 수 없다고 하고 앱 받기로 보낸다", async () => {
  serve(404, { code: "NOT_FOUND" });

  await renderRoute();

  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "영상을 찾을 수 없어요");
  assert.equal(screen.getByRole("link", { name: "액터브 앱 받기" }).getAttribute("href"), "/app");
  assert.equal(screen.queryByRole("link", { name: "앱에서 보기" }), null);
});

test("API 가 실패하면 다시 열어 달라고 하고, 앱에서 보기는 남겨 둔다", async () => {
  serve(500, { code: "INTERNAL" });

  await renderRoute();

  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "잠시 뒤 다시 열어 주세요");
  assert.equal(screen.getByRole("link", { name: "앱에서 보기" }).getAttribute("href"), "/app");
});

test("미리보기 메타데이터는 같은 조회로 작품을 제목에 싣고 색인하지 않는다", async () => {
  serve(200, { work: "햄릿", character: "햄릿", line: "죽느냐 사느냐", poster_url: null });

  const metadata = await route.generateMetadata({ params: Promise.resolve({ id: ENTRY_ID }) });

  assert.equal(metadata.title, "햄릿 · 햄릿 역");
  assert.deepEqual(metadata.robots, { index: false, follow: false });
  assert.equal(route.dynamic, "force-dynamic");
  assert.equal(layout.metadata.title, "공유된 연기");
  assert.deepEqual(layout.metadata.robots, { index: false, follow: false });
});

test("레이아웃은 자식 화면을 그대로 그린다", () => {
  render(layout.default({ children: react.createElement("p", null, "참여작 본문") }));

  assert.equal(screen.getByText("참여작 본문").textContent, "참여작 본문");
});

test("앱에서 보기를 누르면 /app 으로 가는 기본 이동을 막고 앱을 연다", async () => {
  serve(200, { work: "햄릿", character: null, line: "죽느냐 사느냐", poster_url: null });
  await renderRoute();

  // 결과로 나오는 window.location.href 대입은 jsdom 이 막으므로, 기본 이동이 취소됐는지만 본다.
  const notCancelled = fireEvent.click(screen.getByRole("link", { name: "앱에서 보기" }));

  assert.equal(notCancelled, false);
});
