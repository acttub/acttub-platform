// challenge.share — 공유 미리보기를 그리는 웹 서버의 참여작 조회. 주소를 따로 주지 않으면 빌드 때 굳힌
// 서버 API 주소로 가고, 본문을 읽지 못한 성공 응답은 찾을 수 없음이 아니라 불러오지 못함이다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";

delete process.env.ACTTUB_SERVER_API_ORIGIN;

const { getPublicEntry } = await import("../src/lib/api/v2/public-entry.ts");

const originalFetch = globalThis.fetch;
const ENTRY_ID = "6f1c2d8e-3b1a-4c55-9a7e-0b2f4d6a8c10";

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("challenge.share: 주소를 주지 않으면 API_ORIGIN 기본값(127.0.0.1:8080)으로 묻는다", async () => {
  const urls = [];
  const entry = { work: "갈매기", line: "나는 갈매기", character: "니나", poster_url: null };
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify(entry), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  assert.deepEqual(await getPublicEntry(ENTRY_ID), { kind: "found", entry });
  assert.deepEqual(urls, [`http://127.0.0.1:8080/v2/public/entries/${ENTRY_ID}`]);
});

test("challenge.share: 200 이어도 본문이 JSON 이 아니면 불러오지 못함이다", async () => {
  globalThis.fetch = async () => new Response("<html>gateway</html>", { status: 200, headers: { "Content-Type": "text/html" } });

  assert.deepEqual(await getPublicEntry(ENTRY_ID, { origin: "http://api:8080" }), { kind: "failed" });
});
