// practice.memory — 기억 칸 조회·고치기·지우기 서버 클라이언트. 칸 하나와 통째 지우기는 DELETE 이고 204 다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { deleteAllMemory, deleteMemoryField, getMemory, saveMemoryField } = await import("../src/lib/api/v2/memory.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;

beforeEach(() => {
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
});

function recordFetch(reply) {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({
      route: `${init.method} ${String(url)}`,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      authorization: new Headers(init.headers).get("Authorization"),
    });
    return reply();
  };
  return requests;
}

const noContent = () => new Response(null, { status: 204 });
const json = (payload) => () =>
  new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });

const GOAL = {
  field: "goal",
  value: "오디션 독백을 끝까지 외운다",
  written_by_actor: true,
  source_practice_id: null,
  updated_at: "2026-10-20T03:00:00Z",
};

test("practice.memory: 기억은 게스트 토큰으로 GET /v2/me/memory 에서 읽는다", async () => {
  const requests = recordFetch(json({ items: [GOAL] }));

  assert.deepEqual(await getMemory(), { items: [GOAL] });
  assert.deepEqual(requests, [{ route: "GET /v2/me/memory", body: undefined, authorization: "Bearer guest-access" }]);
});

test("practice.memory: 칸 하나 고치기는 PUT /v2/me/memory/{field} 에 값만 싣고 저장된 칸을 돌려준다", async () => {
  const requests = recordFetch(json(GOAL));

  assert.deepEqual(await saveMemoryField("goal", "오디션 독백을 끝까지 외운다"), GOAL);
  assert.deepEqual(requests, [
    { route: "PUT /v2/me/memory/goal", body: { value: "오디션 독백을 끝까지 외운다" }, authorization: "Bearer guest-access" },
  ]);
});

test("practice.memory: 칸 하나 지우기는 DELETE /v2/me/memory/{field} 이고 204 에 값 없이 끝난다", async () => {
  const requests = recordFetch(noContent);

  assert.equal(await deleteMemoryField("habits"), undefined);
  assert.deepEqual(requests, [{ route: "DELETE /v2/me/memory/habits", body: undefined, authorization: "Bearer guest-access" }]);
});

test("practice.memory: 통째 지우기는 DELETE /v2/me/memory 한 번이다", async () => {
  const requests = recordFetch(noContent);

  assert.equal(await deleteAllMemory(), undefined);
  assert.deepEqual(requests, [{ route: "DELETE /v2/me/memory", body: undefined, authorization: "Bearer guest-access" }]);
});

test("practice.memory: 서버가 칸 이름을 거절하면(422) 지운 것으로 치지 않고 오류를 던진다", async () => {
  recordFetch(() =>
    new Response(JSON.stringify({ detail: "validation_error" }), { status: 422, headers: { "Content-Type": "application/json" } }),
  );

  await assert.rejects(deleteMemoryField("speech_self"), { name: "ApiError", status: 422, code: "validation_error" });
});
