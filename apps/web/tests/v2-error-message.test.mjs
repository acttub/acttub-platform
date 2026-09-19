// 화면 오류 문구는 errorMessage 하나로 만든다(apps/web/CLAUDE.md). 그 문구는 배우가 읽는
// 말이다 — 한국어 "~해요"체이고(UI_GUIDE 카피), 개발자가 읽는 "~습니다" 문장이나 서버의 코드
// 원문이 그대로 닿지 않는다. 오류를 실제 이음매(공용 클라이언트·토큰 요청·멱등 계층)에서
// 만들어 errorMessage 에 넣어 본다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { apiFetch } = await import("../src/lib/api/v2/client.ts");
const { GUEST_TRANSFERRED_MESSAGE, errorMessage, toApiError } = await import(
  "../src/lib/api/v2/errors.ts"
);
const { requestTransferCode } = await import("../src/lib/api/v2/guest-transfer.ts");
const { postIdempotent } = await import("../src/lib/api/v2/idempotency.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");
const { describeStartFailure } = await import(
  "../src/features/workspace/practice-start.ts"
);

const FALLBACK = "코드를 받지 못했어요. 다시 시도해 주세요.";
const CONNECTION_COPY = "응답을 받지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.";

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 헤더까지는 왔는데 본문을 읽다가 연결이 끊긴 응답. */
function brokenBodyResponse(status = 200) {
  const response = new Response(null, { status });
  response.text = async () => {
    throw new TypeError("terminated");
  };
  return response;
}

function startGuest() {
  setTokens(
    { access_token: "guest-access", refresh_token: "guest-refresh" },
    { id: "guest-1", email: null, status: "active" },
  );
}

async function caught(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("실패해야 하는 요청이 성공했다");
}

/** 배우가 읽는 말인가 — 한글이 있고, "~습니다"로 끝나지 않고, 코드 원문(snake_case)이 없다. */
function assertScreenCopy(message) {
  assert.match(message, /[가-힣]/);
  assert.doesNotMatch(message, /니다[.!]?$/);
  assert.doesNotMatch(message, /[a-z]+_[a-z]+/);
}

beforeEach(() => {
  clearTokens();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
});

test("account.guest: 게스트 시작이 연결에서 끊기면 연습 화면은 '~해요' 문구를 본다 — '~습니다'가 닿지 않는다", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };

  const failure = await caught(
    apiFetch("/v2/uploads/intents", { method: "POST", body: {} }),
  );

  assert.equal(failure.name, "NetworkError");
  // 연습 화면은 이 실패를 describeStartFailure 의 message 로 그린다.
  const shown = describeStartFailure("intent", failure).message;
  assert.equal(shown, CONNECTION_COPY);
  assertScreenCopy(shown);
});

test("account.guest: 게스트 시작의 응답을 읽다가 끊겨도 같은 '~해요' 문구다", async () => {
  globalThis.fetch = async () => brokenBodyResponse(201);

  const failure = await caught(
    apiFetch("/v2/uploads/intents", { method: "POST", body: {} }),
  );

  assert.equal(failure.name, "NetworkError");
  assert.equal(errorMessage(failure, FALLBACK), CONNECTION_COPY);
});

test("account.guest: 토큰 갱신이 연결에서 끊겨도 같은 '~해요' 문구다", async () => {
  startGuest();
  globalThis.fetch = async (url) => {
    if (String(url) === "/v2/auth/refresh") throw new TypeError("fetch failed");
    return jsonResponse({ detail: "invalid or missing access token" }, 401);
  };

  const failure = await caught(apiFetch("/v2/practice-sessions"));

  assert.equal(failure.name, "NetworkError");
  assert.equal(errorMessage(failure, FALLBACK), CONNECTION_COPY);
});

test("공용 클라이언트의 요청이 연결에서 끊기면 '~해요' 문구다 — 요청 단계와 응답을 읽는 단계 모두", async () => {
  startGuest();
  for (const fail of [
    async () => {
      throw new TypeError("fetch failed");
    },
    async () => brokenBodyResponse(200),
  ]) {
    globalThis.fetch = fail;

    const failure = await caught(apiFetch("/v2/practice-sessions"));

    assert.equal(failure.name, "NetworkError");
    const shown = errorMessage(failure, FALLBACK);
    assert.equal(shown, CONNECTION_COPY);
    assertScreenCopy(shown);
  }
});

test("멱등 요청이 기한을 넘기면 화면은 부르는 자리의 문구를 본다 — '멱등…초과했습니다'가 닿지 않는다", async () => {
  startGuest();
  // 답하지 않는 서버. 기한이 끊을 때까지 끝나지 않는다.
  globalThis.fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(options.signal.reason),
        { once: true },
      );
    });

  const failure = await caught(
    postIdempotent("/v2/example", { scene: "hanging" }, { deadlineMs: 20 }),
  );

  assert.equal(failure.name, "TimeoutError");
  const shown = errorMessage(failure, FALLBACK);
  assert.equal(shown, FALLBACK);
  assertScreenCopy(shown);
});

test("취소된 요청이 걸러지지 않고 여기까지 와도 브라우저의 영어 문장을 그리지 않는다", async () => {
  startGuest();
  const controller = new AbortController();
  controller.abort();

  const failure = await caught(
    postIdempotent("/v2/example", {}, { signal: controller.signal }),
  );

  assert.equal(failure.name, "AbortError");
  assert.equal(errorMessage(failure, FALLBACK), FALLBACK);
});

// --- 서버의 코드 원문 ---
//
// 서버의 detail 은 사람이 읽는 말이 아니라 코드다(apps/api 의 ApiException). 문구를 따로 정해 둔
// 코드는 그 문구로, 나머지는 부르는 자리가 준 문구로 그린다. 한글이 든 detail 만 그대로 보인다.

test("account.guest: 게스트가 끝난 브라우저에서 이관 코드를 받으려 하면(guest_session_required) 코드 원문이 아니라 화면 문구다", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return jsonResponse({}, 201);
  };

  const failure = await caught(requestTransferCode());

  assert.equal(failure.code, "guest_session_required");
  assert.equal(fetchCount, 0);
  const shown = errorMessage(failure, FALLBACK);
  assert.equal(shown, FALLBACK);
  assertScreenCopy(shown);
});

test("account.guest: 회원 토큰으로 이관 코드를 받으려 하면(403 guest_only) 코드 원문이 아니라 화면 문구다", async () => {
  startGuest();
  globalThis.fetch = async () => jsonResponse({ detail: "guest_only" }, 403);

  const failure = await caught(requestTransferCode());

  assert.equal(failure.code, "guest_only");
  const shown = errorMessage(failure, FALLBACK);
  assert.equal(shown, FALLBACK);
  assertScreenCopy(shown);
});

test("문구를 정해 두지 않은 서버 코드는 snake_case 든 영어 문장이든 부르는 자리의 문구로 그린다", () => {
  for (const [status, detail] of [
    [500, "internal_server_error"],
    [409, "upload_intent_expired"],
    [409, "session is closed"],
    [401, "invalid or missing access token"],
    [422, "invalid X-Request-Id"],
    // 422 검증 오류는 detail 이 배열이고 코드는 validation_error 다.
    [422, [{ type: "missing", loc: ["body", "code"], msg: "Field required" }]],
    // 본문이 아예 없는 오류.
    [502, undefined],
  ]) {
    const shown = errorMessage(toApiError(status, { detail }), FALLBACK);
    assert.equal(shown, FALLBACK, `${status} ${JSON.stringify(detail)}`);
  }
});

test("404 는 코드 원문으로 무엇이 없는지 드러내지 않고 부르는 자리의 중립 카피 그대로다", () => {
  const neutral = "연습을 찾을 수 없어요.";
  for (const detail of ["practice_session_not_found", "report_not_found", "session not found"]) {
    assert.equal(errorMessage(toApiError(404, { detail }), neutral), neutral);
  }
});

test("문구를 정해 둔 코드는 그 문구 그대로다", () => {
  for (const [status, detail, copy] of [
    [409, "client_contract_required", "새로고침하면 이 연습 노트를 열 수 있어요."],
    [403, "guest_transferred", GUEST_TRANSFERRED_MESSAGE],
    [401, "guest_transferred", GUEST_TRANSFERRED_MESSAGE],
    [
      403,
      "consent_required",
      "동의해야 계속할 수 있어요. 다시 시도하면 동의 문서를 볼 수 있어요.",
    ],
    [429, "rate limit exceeded", "잠시 뒤 다시 시도해 주세요."],
    [
      429,
      "guest_daily_analysis_limit",
      "오늘은 세 번까지 분석할 수 있어요. 앱으로 옮기면 계속할 수 있어요.",
    ],
  ]) {
    assert.equal(errorMessage(toApiError(status, { detail }), FALLBACK), copy);
  }
});

test("서버가 일부러 한국어 안내 문장으로 주는 detail(426 강제 업데이트)은 그대로 보인다", async () => {
  startGuest();
  const notice = "새 버전이 나왔어요. 스토어에서 업데이트해 주세요.";
  globalThis.fetch = async () => jsonResponse({ detail: notice }, 426);

  const failure = await caught(apiFetch("/v2/practice-sessions"));

  assert.equal(failure.status, 426);
  assert.equal(errorMessage(failure, FALLBACK), notice);
});

test("서버 오류가 아닌 것은 한글 문구면 그대로, 아니면 부르는 자리의 문구다", () => {
  assert.equal(
    errorMessage(new Error("영상 길이를 읽지 못했어요."), FALLBACK),
    "영상 길이를 읽지 못했어요.",
  );
  assert.equal(errorMessage(new Error(""), FALLBACK), FALLBACK);
  assert.equal(errorMessage("웬 문자열", FALLBACK), FALLBACK);
  assert.equal(
    errorMessage(new TypeError("Cannot read properties of undefined"), FALLBACK),
    FALLBACK,
  );
});
