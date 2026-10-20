// account.portfolio — 포트폴리오 공개 페이지(/p/<slug>)를 실제로 그려, 링크를 아는 사람이 로그인 없이 보는 내용과
// 없는 주소·잠깐의 실패에 보이는 말을 본다. 조회 규칙 자체는 public-portfolio.test.mjs 가 본다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";
import "./fixtures/features-next-shims.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { cleanup, render, screen, within } = await import("@testing-library/react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { PublicPortfolioPage } = await import("../src/features/portfolio/public-portfolio-page.tsx");
const { clearTokens } = await import("../src/lib/auth/token-store.ts");

const h = react.createElement;
const originalFetch = globalThis.fetch;

const portfolio = (overrides = {}) => ({
  name: "김배우",
  photo_url: "https://cdn.example/profile.jpg",
  gender: "female",
  age: 25,
  intro: "무대와 카메라 앞에서 모두 연기합니다.",
  credits: [
    { title: "봄밤", role: "지수", year: 2025, kind: "film" },
    { title: "갈매기", role: "니나", year: 2024, kind: "play" },
  ],
  photos: [{ url: "https://cdn.example/1.jpg" }, { url: null }, { url: "https://cdn.example/2.jpg" }],
  ...overrides,
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function serve(respond) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ route: `${init.method ?? "GET"} ${String(url)}`, authorization: new Headers(init.headers).get("Authorization") });
    return respond();
  };
  return calls;
}

function openAt(pathname) {
  window.history.replaceState(null, "", pathname);
  return render(h(PublicPortfolioPage));
}

beforeEach(() => {
  clearTokens();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  window.history.replaceState(null, "", "/");
});

test("account.portfolio: 프리렌더한 껍데기는 slug 를 모르므로 머리글만 두고 묻지 않는다", () => {
  const calls = serve(() => jsonResponse(portfolio()));
  const html = renderToStaticMarkup(h(PublicPortfolioPage));

  assert.match(html, /aria-busy="true"/);
  assert.match(html, /aria-label="Acttub 홈"/);
  assert.equal(html.includes("김배우"), false);
  assert.deepEqual(calls, []);
});

test("account.portfolio: 링크를 켠 주소는 로그인 없이 이름·사진·성별·만 나이·소개글·경력·사진을 그린다", async () => {
  const calls = serve(() => jsonResponse(portfolio()));
  openAt("/p/k3Tq9xZ");

  const name = await screen.findByRole("heading", { level: 1, name: "김배우" });
  assert.equal(name.tagName, "H1");
  assert.deepEqual(calls, [{ route: "GET /v2/public/portfolios/k3Tq9xZ", authorization: null }]);

  const home = screen.getByRole("link", { name: "Acttub 홈" });
  assert.equal(home.getAttribute("href"), "/");
  assert.equal(within(home).getByRole("img", { name: "Acttub" }).tagName, "IMG");

  const profile = screen.getByRole("img", { name: "김배우 프로필 사진" });
  assert.equal(profile.getAttribute("src"), "https://cdn.example/profile.jpg");
  assert.equal(profile.getAttribute("referrerpolicy"), "no-referrer");
  assert.deepEqual(
    [...window.document.querySelectorAll("dl > div")].map((fact) => fact.textContent),
    ["성별여성", "나이만 25세"],
  );
  assert.equal(screen.getByText("무대와 카메라 앞에서 모두 연기합니다.").tagName, "P");

  const credits = within(screen.getByRole("heading", { level: 2, name: "경력" }).closest("section")).getAllByRole("listitem");
  assert.deepEqual(credits.map((credit) => credit.textContent), ["2025봄밤지수 역영화", "2024갈매기니나 역연극"]);

  // 볼 주소가 없는 사진은 빈 칸 없이 빠지고, 번호는 보이는 사진끼리 매긴다.
  const photos = within(screen.getByRole("heading", { level: 2, name: "사진" }).closest("section")).getAllByRole("img");
  assert.deepEqual(
    photos.map((photo) => [photo.getAttribute("alt"), photo.getAttribute("src"), photo.getAttribute("referrerpolicy")]),
    [
      ["김배우 사진 1", "https://cdn.example/1.jpg", "no-referrer"],
      ["김배우 사진 2", "https://cdn.example/2.jpg", "no-referrer"],
    ],
  );
});

test("account.portfolio: 대표 사진·소개글·경력·사진이 없고 성별을 고르지 않았으면 그 자리를 비우지 않고 뺀다", async () => {
  serve(() => jsonResponse(portfolio({ photo_url: null, gender: null, intro: null, credits: [], photos: [{ url: null }] })));
  openAt("/p/k3Tq9xZ");

  await screen.findByRole("heading", { level: 1, name: "김배우" });
  assert.deepEqual(screen.getAllByRole("img").map((image) => image.getAttribute("alt")), ["Acttub"]);
  assert.deepEqual([...window.document.querySelectorAll("dl > div")].map((fact) => fact.textContent), ["나이만 25세"]);
  assert.equal(screen.queryByRole("heading", { level: 2 }), null);
  assert.equal(window.document.querySelector("main").textContent, "김배우나이만 25세");
});

test("account.portfolio: 꺼진 링크·없는 slug 는 그 주소가 있었는지 드러내지 않는 중립 안내다", async () => {
  serve(() => jsonResponse({ detail: "portfolio_not_found" }, 404));
  openAt("/p/gone");

  assert.equal((await screen.findByRole("heading", { level: 1 })).textContent, "페이지를 찾을 수 없어요");
  assert.equal(screen.getByText("주소가 바뀌었거나 공유가 꺼져 있을 수 있어요.").tagName, "P");
});

test("결정 I-8: slug 없이 /p 만 열면 서버에 묻지 않고 같은 중립 안내다", async () => {
  const calls = serve(() => jsonResponse(portfolio()));
  openAt("/p");

  assert.equal((await screen.findByRole("heading", { level: 1 })).textContent, "페이지를 찾을 수 없어요");
  assert.deepEqual(calls, []);
});

test("account.portfolio: 잠깐의 실패는 없는 페이지로 꾸미지 않고 다시 열라고 하며, 429 는 기다리라고 한다", async () => {
  serve(() => jsonResponse({ detail: "internal_error" }, 500));
  const first = openAt("/p/k3Tq9xZ");
  assert.equal((await screen.findByRole("heading", { level: 1 })).textContent, "잠시 뒤 다시 열어 주세요");
  assert.equal(screen.getByText("지금은 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.").tagName, "P");
  first.unmount();

  serve(() => jsonResponse({ detail: "rate limit exceeded" }, 429));
  openAt("/p/k3Tq9xZ");
  assert.equal((await screen.findByRole("heading", { level: 1 })).textContent, "잠시 뒤 다시 열어 주세요");
  assert.equal(screen.getByText("잠시 뒤 다시 시도해 주세요.").tagName, "P");
});
