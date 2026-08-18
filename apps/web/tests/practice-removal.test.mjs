import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { removePractice } = await import(
  "../src/features/workspace/practice-removal.ts"
);

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * 지우기 요청을 받아 적는 fetch. 무엇을 몇 번 불렀는지가 결과만큼이나 중요하다 —
 * 자리를 뺏긴 요청도 지우기 자체는 이미 서버에 갔다.
 */
function deleteStub({ ok = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ path: String(url), method: init?.method });
    if (!ok) return new Response("", { status: 500 });
    return new Response(null, { status: 204 });
  };
  return calls;
}

function removeInput(overrides = {}) {
  return {
    sessionId: "practice-1",
    isCurrent: () => true,
    ...overrides,
  };
}

test("지우고 나서도 그 연습이 지금 화면이면 되돌릴 자리가 있다", async () => {
  const calls = deleteStub();

  const result = await removePractice(removeInput());

  assert.deepEqual(result, { kind: "removed" });
  assert.deepEqual(calls, [
    { path: "/v2/practice-sessions/practice-1", method: "DELETE" },
  ]);
});

test("못 지웠고 아직 그 화면이면 문구를 띄울 자리가 있다", async () => {
  const calls = deleteStub({ ok: false });

  const result = await removePractice(removeInput());

  assert.deepEqual(result, { kind: "failed" });
  assert.equal(calls.length, 1);
});

test("못 지운 것도 남의 화면에는 띄우지 않는다", async () => {
  deleteStub({ ok: false });

  const result = await removePractice(removeInput({ isCurrent: () => false }));

  assert.deepEqual(result, { kind: "failedSuperseded" });
});

test("자리를 묻는 것은 지우기가 끝난 뒤다 — 그 사이에 화면이 넘어간다", async () => {
  const order = [];
  globalThis.fetch = async () => {
    order.push("delete");
    return new Response(null, { status: 204 });
  };

  const result = await removePractice(
    removeInput({
      isCurrent: () => {
        order.push("isCurrent");
        return true;
      },
    }),
  );

  assert.deepEqual(order, ["delete", "isCurrent"]);
  assert.deepEqual(result, { kind: "removed" });
});

test("자리를 뺏긴 뒤에 답이 와도 지우기는 이미 나갔다", async () => {
  let current = true;
  const calls = deleteStub();

  const pending = removePractice(
    removeInput({ isCurrent: () => current }),
  );
  // 답을 기다리는 사이 목록에서 다른 연습을 열었다.
  current = false;

  // 지워지긴 했다 — 목록은 갱신해야 하고, 화면은 건드리면 안 된다.
  assert.deepEqual(await pending, { kind: "removedSuperseded" });
  assert.equal(calls.length, 1);
});
