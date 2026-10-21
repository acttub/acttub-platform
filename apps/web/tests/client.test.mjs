// 공용 클라이언트(apiFetch)가 403 의 여러 모양과 스트림 요청을 어떻게 읽는지 본다. 게스트 시작·갱신·
// 동의 시트의 기본 갈래는 v2-guest-session·v2-consent-recovery·v2-guest-transferred 가 본다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { apiFetch } = await import("../src/lib/api/v2/client.ts");
const { registerConsentPrompt } = await import("../src/lib/api/v2/consent-prompt.ts");
const { clearTokens, getAccessToken, setTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;
let unregisterPrompt = () => {};
let prompted;

beforeEach(() => {
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
  prompted = [];
  unregisterPrompt = registerConsentPrompt(async (documents) => {
    prompted.push(documents.map((d) => d.type));
    return "decided";
  });
});

afterEach(() => {
  unregisterPrompt();
  globalThis.fetch = originalFetch;
  clearTokens();
});

function serve(...responses) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(`${options.method} ${String(url)}`);
    return responses[Math.min(calls.length, responses.length) - 1]();
  };
  return calls;
}

const json = (payload, status) => () =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

const termsDocument = {
  id: "terms-document",
  type: "terms",
  version: "2026-10-01",
  title: "서비스 이용약관",
  body: "전문",
  required: true,
  published_at: "2026-10-01T00:00:00.000000Z",
};

test("글자로 온 403 은 그대로 던지고 게스트를 끝내거나 시트를 띄우지 않는다", async () => {
  const calls = serve(() => new Response("Forbidden", { status: 403 }));

  const error = await apiFetch("/v2/videos/intents", { method: "POST", body: {} }).catch((e) => e);

  assert.equal(error.status, 403);
  assert.equal(error.code, "unknown_error");
  assert.equal(getAccessToken(), "guest-access");
  assert.deepEqual(prompted, []);
  assert.deepEqual(calls, ["POST /v2/videos/intents"]);
});

test("detail 이 글자가 아닌 403 도 게스트를 그대로 두고 던진다", async () => {
  serve(json({ detail: [{ loc: ["body"], msg: "x" }] }, 403));

  const error = await apiFetch("/v2/videos/intents", { method: "POST", body: {} }).catch((e) => e);

  assert.equal(error.status, 403);
  assert.equal(error.code, "validation_error");
  assert.equal(getAccessToken(), "guest-access");
});

test("빠진 문서 목록이 비어 있는 consent_required 는 시트를 띄우지 않고 403 을 돌려준다", async () => {
  const calls = serve(json({ detail: "consent_required", pending_consents: [] }, 403));

  const error = await apiFetch("/v2/videos/intents", { method: "POST", body: {} }).catch((e) => e);

  assert.equal(error.code, "consent_required");
  assert.deepEqual(prompted, []);
  assert.equal(calls.length, 1);
});

test("consentPrompt: false 면 빠진 문서가 있어도 시트 없이 403 을 돌려준다", async () => {
  const calls = serve(json({ detail: "consent_required", pending_consents: [termsDocument] }, 403));

  const error = await apiFetch("/v2/practices", { method: "POST", body: {}, consentPrompt: false }).catch((e) => e);

  assert.equal(error.code, "consent_required");
  assert.deepEqual(prompted, []);
  assert.equal(calls.length, 1);

  // 같은 응답이라도 기본값이면 시트를 띄운다.
  serve(json({ detail: "consent_required", pending_consents: [termsDocument] }, 403), json({ ok: true }, 201));
  const { data } = await apiFetch("/v2/practices", { method: "POST", body: {} });
  assert.deepEqual(data, { ok: true });
  assert.deepEqual(prompted, [["terms"]]);
});

test("detail 이 없는 실패 본문(배열·다른 모양의 객체)은 사유 코드 없이 unknown_error 다", async () => {
  for (const payload of [["잘못된", "본문"], { message: "Internal Server Error" }]) {
    serve(json(payload, 500));

    const error = await apiFetch("/v2/practices").catch((e) => e);

    assert.equal(error.status, 500);
    assert.equal(error.code, "unknown_error");
    assert.equal(error.detail, undefined);
  }
});

test("stream 요청에 Content-Type 없는 성공 응답이 오면 본문을 읽어 data 로 준다", async () => {
  serve(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"message":"일반"}'));
            controller.close();
          },
        }),
        { status: 200 },
      ),
  );

  const response = await apiFetch("/v2/coach/reply/stream", { method: "POST", body: {}, stream: true });

  assert.deepEqual(response, { status: 200, data: { message: "일반" } });
});

test("stream 요청에 이벤트 스트림이 오면 본문을 읽지 않고 stream 으로 넘긴다", async () => {
  serve(() => new Response("event: done\ndata: {}\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } }));

  const response = await apiFetch("/v2/coach/reply/stream", { method: "POST", body: {}, stream: true });

  assert.equal(response.status, 200);
  assert.equal(response.data, undefined);
  assert.equal(await new Response(response.stream).text(), "event: done\ndata: {}\n\n");
});
