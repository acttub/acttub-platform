// 포트폴리오 공개 페이지(account.portfolio, 결정 I-8). 주소는 /p/<slug> 이고, 프리렌더한 껍데기
// 하나가 브라우저에서 경로의 slug 를 읽어 GET /v2/public/portfolios/{slug} 를 부른다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { getPublicPortfolio } = await import(
  "../src/lib/api/v2/public-portfolio.ts"
);
const {
  PORTFOLIO_NOT_FOUND_COPY,
  creditKindLabel,
  loadPortfolioPage,
  portfolioFacts,
  slugFromPath,
} = await import("../src/features/portfolio/public-portfolio.ts");
const { clearTokens, hasGuestSession, setTokens } = await import(
  "../src/lib/auth/token-store.ts"
);

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function portfolio(overrides = {}) {
  return {
    name: "김배우",
    photo_url: "https://cdn.example/profile.jpg",
    gender: "female",
    age: 25,
    intro: "무대와 카메라 앞에서 모두 연기합니다.",
    credits: [{ title: "봄밤", role: "지수", year: 2025, kind: "film" }],
    photos: [{ url: "https://cdn.example/1.jpg" }],
    ...overrides,
  };
}

beforeEach(() => {
  clearTokens();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
});

test("결정 I-8: 경로 /p/<slug> 에서 slug 하나만 읽는다", () => {
  assert.equal(slugFromPath("/p/k3Tq9xZ"), "k3Tq9xZ");
  assert.equal(slugFromPath("/p/k3Tq9xZ/"), "k3Tq9xZ");
  assert.equal(slugFromPath("/p/%EA%B9%80"), "김");
  // 껍데기만 연 경우와 한 단계를 넘는 경로는 slug 가 없다.
  assert.equal(slugFromPath("/p"), null);
  assert.equal(slugFromPath("/p/"), null);
  assert.equal(slugFromPath("/p/a/b"), null);
  assert.equal(slugFromPath("/practice/new"), null);
  // 깨진 퍼센트 인코딩은 던지지 않고 없는 것으로 본다.
  assert.equal(slugFromPath("/p/%E0%A4%A"), null);
});

test("account.portfolio: 공개 조회는 로그인 없이 부르고 게스트를 만들지 않으며 slug 를 인코딩해 싣는다", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const headers = new Headers(options.headers);
    requests.push({
      route: `${options.method ?? "GET"} ${String(url)}`,
      authorization: headers.get("Authorization"),
      client: headers.get("X-Acttub-Client"),
    });
    return jsonResponse(portfolio());
  };

  const found = await getPublicPortfolio("a/b?c#d 김");

  assert.deepEqual(requests, [
    {
      route: `GET /v2/public/portfolios/${encodeURIComponent("a/b?c#d 김")}`,
      authorization: null,
      client: "web/1.0.0",
    },
  ]);
  assert.equal(found.name, "김배우");
  assert.equal(hasGuestSession(), false);
});

test("account.portfolio: 게스트 토큰이 있어도 공개 조회에는 싣지 않는다", async () => {
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
  let authorization = "unset";
  globalThis.fetch = async (_url, options) => {
    authorization = new Headers(options.headers).get("Authorization");
    return jsonResponse(portfolio());
  };

  await getPublicPortfolio("k3Tq9xZ");

  assert.equal(authorization, null);
});

test("account.portfolio: 성별이 '선택 안 함'(null)이면 성별 칸이 없다", () => {
  assert.deepEqual(portfolioFacts(portfolio({ gender: "female", age: 25 })), [
    { label: "성별", value: "여성" },
    { label: "나이", value: "만 25세" },
  ]);
  assert.deepEqual(portfolioFacts(portfolio({ gender: "male", age: 31 })), [
    { label: "성별", value: "남성" },
    { label: "나이", value: "만 31세" },
  ]);
  assert.deepEqual(portfolioFacts(portfolio({ gender: null, age: 25 })), [
    { label: "나이", value: "만 25세" },
  ]);
  // 서버가 저장 값을 그대로 흘려도(unspecified) 칸을 만들지 않는다.
  assert.deepEqual(portfolioFacts(portfolio({ gender: "unspecified", age: 25 })), [
    { label: "나이", value: "만 25세" },
  ]);
});

test("account.portfolio: 경력 종류 여섯은 한국어 이름으로 보인다", () => {
  assert.deepEqual(
    ["film", "drama", "play", "musical", "ad", "other"].map(creditKindLabel),
    ["영화", "드라마", "연극", "뮤지컬", "광고", "기타"],
  );
  assert.equal(creditKindLabel("hologram"), "기타");
});

test("account.portfolio: 링크를 켠 주소는 이름·사진·성별·만 나이·소개글·경력·사진을 그린다", async () => {
  globalThis.fetch = async () => jsonResponse(portfolio());

  const page = await loadPortfolioPage("/p/k3Tq9xZ");

  assert.equal(page.kind, "found");
  assert.equal(page.portfolio.name, "김배우");
  assert.equal(page.portfolio.credits.length, 1);
  assert.equal(page.portfolio.photos.length, 1);
});

test("account.portfolio: 꺼진 링크·없는 slug·탈퇴한 사람의 slug 는 모두 같은 중립 안내다", async () => {
  globalThis.fetch = async () => jsonResponse({ detail: "portfolio_not_found" }, 404);

  const page = await loadPortfolioPage("/p/turned-off");

  assert.deepEqual(page, { kind: "notFound" });
  assert.equal(PORTFOLIO_NOT_FOUND_COPY.title, "페이지를 찾을 수 없어요");
});

test("결정 I-8: slug 없이 /p 만 열어도 서버에 묻지 않고 같은 중립 안내다", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return jsonResponse(portfolio());
  };

  assert.deepEqual(await loadPortfolioPage("/p"), { kind: "notFound" });
  assert.deepEqual(await loadPortfolioPage("/p/a/b"), { kind: "notFound" });
  assert.equal(fetchCount, 0);
});

test("account.portfolio: 한 IP 에서 1분에 61번째 공개 조회(429)와 서버 오류는 없는 페이지로 꾸미지 않고 다시 시도하게 한다", async () => {
  globalThis.fetch = async () => jsonResponse({ detail: "rate limit exceeded" }, 429);
  assert.deepEqual(await loadPortfolioPage("/p/k3Tq9xZ"), {
    kind: "failed",
    message: "잠시 뒤 다시 시도해 주세요.",
  });

  globalThis.fetch = async () => jsonResponse({ detail: "internal_server_error" }, 500);
  const failed = await loadPortfolioPage("/p/k3Tq9xZ");
  assert.equal(failed.kind, "failed");
});

// 주소(/p/<slug>)는 프리렌더한 껍데기 하나를 rewrites 로 서빙한다. 설정이 빠지면 /p/<slug> 가
// 통째로 404 가 되는데, 빌드도 타입 검사도 그것을 잡지 못한다.
test("결정 I-8: next.config 의 rewrites 가 /p/:slug 한 단계만 껍데기(/p)로 보낸다", async () => {
  const { default: nextConfig } = await import("../next.config.ts");
  const rewrites = await nextConfig.rewrites();
  const rules = Array.isArray(rewrites)
    ? rewrites
    : [...(rewrites.beforeFiles ?? []), ...(rewrites.afterFiles ?? []), ...(rewrites.fallback ?? [])];

  assert.deepEqual(
    rules.filter((rule) => rule.source.startsWith("/p")),
    [{ source: "/p/:slug", destination: "/p" }],
  );
});
