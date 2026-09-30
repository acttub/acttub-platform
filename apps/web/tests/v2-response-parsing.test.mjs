// 공용 클라이언트와 토큰 요청(갱신·게스트 만들기)이 응답 본문을 읽고 오류로 바꾸는 결과.
// 두 쪽이 같은 파서를 쓰더라도 화면·Sentry에 닿는 문구와 오류 필드가 글자 그대로 같아야 한다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { apiFetch } = await import("../src/lib/api/v2/client.ts");
const { ApiError, NetworkError } = await import("../src/lib/api/v2/errors.ts");
const { ensureGuestSession } = await import("../src/lib/auth/guest-session.ts");
const { refreshAccessToken } = await import("../src/lib/auth/refresh.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;

/** 헤더는 받았는데 본문을 읽다 연결이 끊긴 응답. */
function brokenBody(status = 200) {
  const response = new Response("", { status });
  response.text = () => Promise.reject(new TypeError("network lost"));
  return response;
}

function respond(body, status, headers = {}) {
  return new Response(body, { status, headers });
}

function errorFields(error) {
  return {
    name: error.name,
    message: error.message,
    status: error.status,
    code: error.code,
    detail: error.detail,
    requestId: error.requestId,
  };
}

beforeEach(() => {
  clearTokens();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
});

function signedIn() {
  setTokens({ access_token: "access-1", refresh_token: "refresh-1" }, { id: "guest-1" });
}

test("본문을 읽다 끊기면 요청마다 정해진 문구의 NetworkError가 난다", async () => {
  signedIn();
  globalThis.fetch = async () => brokenBody();
  await assert.rejects(apiFetch("/v2/me"), (error) => {
    assert.ok(error instanceof NetworkError);
    assert.equal(error.message, "API 응답을 읽는 중 네트워크 연결이 끊어졌습니다.");
    assert.equal(error.cause.message, "network lost");
    return true;
  });

  signedIn();
  await assert.rejects(refreshAccessToken(), (error) => {
    assert.ok(error instanceof NetworkError);
    assert.equal(error.message, "토큰 갱신 응답을 읽는 중 네트워크 연결이 끊어졌습니다.");
    return true;
  });

  clearTokens();
  await assert.rejects(ensureGuestSession(), (error) => {
    assert.ok(error instanceof NetworkError);
    assert.equal(error.message, "게스트 시작 응답을 읽는 중 네트워크 연결이 끊어졌습니다.");
    return true;
  });
});

test("요청 자체가 실패하면 요청마다 정해진 문구의 NetworkError가 난다", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("offline");
  };
  signedIn();
  await assert.rejects(apiFetch("/v2/me"), { name: "NetworkError", message: "네트워크 요청에 실패했습니다." });
  signedIn();
  await assert.rejects(refreshAccessToken(), { name: "NetworkError", message: "토큰 갱신 요청에 실패했습니다." });
  clearTokens();
  await assert.rejects(ensureGuestSession(), { name: "NetworkError", message: "게스트 시작 요청에 실패했습니다." });
});

test("성공 본문은 JSON이면 값으로, 아니면 글자로, 비었으면 undefined로 읽는다", async () => {
  signedIn();
  for (const [response, data] of [
    [respond('{"a":1}', 200), { a: 1 }],
    [respond("plain", 200), "plain"],
    [respond("", 200), undefined],
    [respond(null, 204), undefined],
  ]) {
    globalThis.fetch = async () => response;
    assert.deepEqual(await apiFetch("/v2/me"), { status: response.status, data });
  }
});

test("실패 응답은 세 요청 모두 같은 필드의 ApiError가 된다", async () => {
  const headers = { "X-Request-Id": "rid-9" };
  const expected = {
    name: "ApiError",
    message: "boom",
    status: 500,
    code: "boom",
    detail: "boom",
    requestId: "rid-9",
  };
  globalThis.fetch = async () => respond('{"detail":"boom"}', 500, headers);

  signedIn();
  await assert.rejects(apiFetch("/v2/me"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.deepEqual(errorFields(error), expected);
    return true;
  });
  signedIn();
  await assert.rejects(refreshAccessToken(), (error) => {
    assert.deepEqual(errorFields(error), expected);
    return true;
  });
  clearTokens();
  await assert.rejects(ensureGuestSession(), (error) => {
    assert.deepEqual(errorFields(error), expected);
    return true;
  });

  // JSON이 아닌 본문과 검증 오류 배열도 같은 규칙으로 코드가 된다.
  signedIn();
  globalThis.fetch = async () => respond("<html>bad gateway</html>", 502);
  await assert.rejects(apiFetch("/v2/me"), (error) => {
    assert.deepEqual(errorFields(error), {
      name: "ApiError",
      message: "unknown_error",
      status: 502,
      code: "unknown_error",
      detail: undefined,
      requestId: undefined,
    });
    return true;
  });
  globalThis.fetch = async () => respond('{"detail":[{"msg":"x"}]}', 422, headers);
  clearTokens();
  await assert.rejects(ensureGuestSession(), (error) => {
    assert.deepEqual(errorFields(error), {
      name: "ApiError",
      message: "validation_error",
      status: 422,
      code: "validation_error",
      detail: [{ msg: "x" }],
      requestId: "rid-9",
    });
    return true;
  });
});

test("앱으로 옮겨진 게스트의 갱신 거절은 401 오류 그대로 던진다", async () => {
  signedIn();
  globalThis.fetch = async () =>
    respond('{"detail":"guest_transferred"}', 401, { "X-Request-Id": "rid-t" });
  await assert.rejects(refreshAccessToken(), (error) => {
    assert.deepEqual(errorFields(error), {
      name: "UnauthorizedError",
      message: "guest_transferred",
      status: 401,
      code: "guest_transferred",
      detail: "guest_transferred",
      requestId: "rid-t",
    });
    return true;
  });
});
