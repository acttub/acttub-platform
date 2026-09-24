// 참여작 공유 링크(challenge.share). 앱이 공유하는 /e/<id> 를 웹 서버가 렌더하며 GET /v2/public/entries/{id}
// 로 작품·대사를 받아 메신저 미리보기(OG)를 그린다. 작성자의 이름·사진은 어디에도 싣지 않는다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";

delete process.env.NEXT_PUBLIC_SITE_URL;

const { getPublicEntry } = await import("../src/lib/api/v2/public-entry.ts");
const { ENTRY_FAILED_COPY, ENTRY_NOT_FOUND_COPY, entryShareMetadata } = await import(
  "../src/features/entry-share/entry-share.ts"
);
const { appEntryUrl, openInAppTarget } = await import(
  "../src/features/entry-share/open-in-app.ts"
);
const { storeHref } = await import("../src/lib/app-download/store-links.ts");
const { default: sitemap } = await import("../src/app/sitemap.ts");

const originalFetch = globalThis.fetch;
const ENTRY_ID = "6f1c2d8e-3b1a-4c55-9a7e-0b2f4d6a8c10";

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const scene = {
  work: "햄릿",
  line: "죽느냐 사느냐, 그것이 문제로다",
  character: "햄릿",
  poster_url: null,
};

test("challenge.share: 웹 서버가 토큰 없이 API 에 직접 묻고 방문자 주소를 넘긴다", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const headers = new Headers(options.headers);
    requests.push({
      url: String(url),
      method: options.method ?? "GET",
      authorization: headers.get("Authorization"),
      client: headers.get("X-Acttub-Client"),
      forwardedFor: headers.get("X-Forwarded-For"),
      cache: options.cache,
    });
    return jsonResponse(scene);
  };

  const result = await getPublicEntry("a/b c", {
    origin: "http://api:8080",
    forwardedFor: "203.0.113.7",
  });

  assert.deepEqual(result, { kind: "found", entry: scene });
  assert.deepEqual(requests, [
    {
      url: "http://api:8080/v2/public/entries/a%2Fb%20c",
      method: "GET",
      authorization: null,
      client: "web/1.0.0",
      forwardedFor: "203.0.113.7",
      cache: "no-store",
    },
  ]);
});

test("challenge.share: 방문자 주소가 없으면 X-Forwarded-For 를 만들지 않는다", async () => {
  let forwarded = "unset";
  globalThis.fetch = async (_url, options) => {
    forwarded = new Headers(options.headers).get("X-Forwarded-For");
    return jsonResponse(scene);
  };
  await getPublicEntry(ENTRY_ID, { origin: "http://api:8080", forwardedFor: null });
  assert.equal(forwarded, null);
});

test("challenge.share: 404 와 모양이 틀린 id(422)는 찾을 수 없음, 그 밖의 실패는 불러오지 못함이다", async () => {
  for (const [status, kind] of [
    [404, "not_found"],
    [422, "not_found"],
    [429, "failed"],
    [500, "failed"],
  ]) {
    globalThis.fetch = async () => jsonResponse({ detail: "x" }, status);
    const result = await getPublicEntry(ENTRY_ID, { origin: "http://api:8080" });
    assert.equal(result.kind, kind, `status ${status}`);
  }

  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  assert.equal((await getPublicEntry(ENTRY_ID, { origin: "http://api:8080" })).kind, "failed");
});

test("challenge.share: 미리보기는 작품·배역을 제목으로, 대사를 설명으로 싣고 noindex 다", () => {
  const metadata = entryShareMetadata(ENTRY_ID, { kind: "found", entry: scene });

  assert.equal(metadata.title, "햄릿 · 햄릿 역");
  assert.match(String(metadata.description), /죽느냐 사느냐, 그것이 문제로다/);
  assert.deepEqual(metadata.robots, { index: false, follow: false });
  assert.equal(metadata.openGraph.url, `https://acttub.com/e/${ENTRY_ID}`);
  assert.equal(metadata.openGraph.title, "햄릿 · 햄릿 역 | Acttub");
  assert.equal(metadata.openGraph.description, metadata.description);
  // 장면 이미지가 없으면 사이트 공통 OG 이미지로 대신한다.
  assert.deepEqual(metadata.openGraph.images, ["/opengraph-image"]);
  assert.deepEqual(metadata.twitter.images, ["/twitter-image"]);
  assert.equal(metadata.twitter.card, "summary_large_image");
});

test("challenge.share: 배역이 없으면 작품만, 장면 이미지가 있으면 그 이미지를 싣는다", () => {
  const metadata = entryShareMetadata(ENTRY_ID, {
    kind: "found",
    entry: { ...scene, character: null, poster_url: "https://cdn.test/poster.jpg" },
  });
  assert.equal(metadata.title, "햄릿");
  assert.deepEqual(metadata.openGraph.images, ["https://cdn.test/poster.jpg"]);
  assert.deepEqual(metadata.twitter.images, ["https://cdn.test/poster.jpg"]);
});

test("challenge.share: 긴 대사는 설명에서 줄인다", () => {
  const line = "가".repeat(200);
  const metadata = entryShareMetadata(ENTRY_ID, {
    kind: "found",
    entry: { ...scene, line },
  });
  assert.ok(String(metadata.description).length < 140);
  assert.match(String(metadata.description), /…/);
});

test("challenge.share: 찾을 수 없거나 불러오지 못하면 참여작 정보 없이 공통 미리보기다", () => {
  for (const [lookup, copy] of [
    [{ kind: "not_found" }, ENTRY_NOT_FOUND_COPY],
    [{ kind: "failed" }, ENTRY_FAILED_COPY],
  ]) {
    const metadata = entryShareMetadata(ENTRY_ID, lookup);
    assert.equal(metadata.title, copy.title);
    assert.deepEqual(metadata.robots, { index: false, follow: false });
    assert.deepEqual(metadata.openGraph.images, ["/opengraph-image"]);
  }
});

test("challenge.share: 앱 주소는 actingapp://entry/<id> 다", () => {
  assert.equal(appEntryUrl(ENTRY_ID), `actingapp://entry/${ENTRY_ID}`);
  assert.equal(appEntryUrl("a/b"), "actingapp://entry/a%2Fb");
});

test("challenge.share: 앱에서 보기 — iOS 는 앱 주소를 열고 안 열리면 /go 를 거쳐 스토어로 간다", () => {
  assert.deepEqual(openInAppTarget("ios", ENTRY_ID, "https://acttub.com"), {
    href: `actingapp://entry/${ENTRY_ID}`,
    fallback: "/go/ios/entry_share",
  });
});

test("challenge.share: 앱에서 보기 — 안드로이드는 intent 주소로 열고 없으면 브라우저가 /go 로 간다", () => {
  const target = openInAppTarget("android", ENTRY_ID, "https://acttub.com");
  assert.equal(target.fallback, null);
  assert.equal(
    target.href,
    `intent://entry/${ENTRY_ID}#Intent;scheme=actingapp;package=com.acttub.app;` +
      `S.browser_fallback_url=${encodeURIComponent("https://acttub.com/go/android/entry_share")};end`,
  );
});

test("challenge.share: 앱에서 보기 — 기기를 못 가리면 두 스토어를 다 보여 주는 /app 이다", () => {
  assert.deepEqual(openInAppTarget(null, ENTRY_ID, "https://acttub.com"), {
    href: "/app",
    fallback: null,
  });
});

test("challenge.share: 스토어 주소는 기존 정본에서 표면 이름만 더해 만든다", () => {
  assert.equal(
    storeHref("google_play", "entry_share"),
    "https://play.google.com/store/apps/details?id=com.acttub.app&referrer=" +
      encodeURIComponent("utm_source=acttub_web&utm_medium=entry_share"),
  );
});

test("challenge.share: sitemap 에 공유 주소(/e)가 없다", () => {
  const paths = sitemap().map(({ url }) => new URL(url).pathname);
  assert.deepEqual(paths.filter((path) => path === "/e" || path.startsWith("/e/")), []);
});
