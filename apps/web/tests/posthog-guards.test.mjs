// PostHog 래퍼의 나머지 갈래(ANALYTICS.md §1). 켜기 전에는 아무것도 보내지 않고, 개발자 PC
// 호스트에서는 켜지 않으며, 오류는 메시지 원문 대신 정해 둔 이유 코드로만 싣는다.
// 초기화 옵션과 20개 이벤트의 속성 목록은 analytics-posthog.test.mjs 가 본다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import "./ts-module-loader.mjs";

import { sdk } from "./fixtures/posthog-js.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "posthog-js") {
      return { url: new URL("./fixtures/posthog-js.mjs", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const {
  isPostHogHost,
  startPostHog,
  toAgeDaysBucket,
  toLengthBucket,
  toPctBucket,
  trackPracticeAnalysisSettled,
  trackPracticeHistoryOpened,
  trackPracticeUploadFailed,
  trackScreenViewed,
} = await import("../src/lib/analytics/posthog.ts");

function withHost(hostname, run) {
  globalThis.window = { location: { hostname } };
  try {
    return run();
  } finally {
    delete globalThis.window;
  }
}

/** 이 함수 안에서 SDK 밖으로 나간 이벤트. */
function deliveredDuring(run) {
  const before = sdk.delivered.length;
  run();
  return sdk.delivered.slice(before).map(({ event, properties }) => ({ event, properties }));
}

// 이 파일의 테스트는 차례로 이어진다. 모듈의 "켜졌다" 상태는 프로세스에 하나다.

test("켜기 전에는 우리가 직접 쏘는 이벤트를 SDK 에 넘기지 않는다", () => {
  trackScreenViewed("/home");
  trackPracticeHistoryOpened("analyzed", true, 3);

  assert.deepEqual(sdk.calls, []);
});

test("정적 프리렌더(window 없음)에서는 키가 있어도 켜지 않는다", () => {
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "test-key";
  delete globalThis.window;

  startPostHog("guest-1");

  assert.deepEqual(sdk.calls, []);
});

test("배포 호스트에서 키가 비어 있으면 켜지 않고 그 사실을 경고로 남긴다", (t) => {
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "";
  const warn = t.mock.method(console, "warn", () => undefined);

  withHost("acttub.com", () => startPostHog("guest-1"));

  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [
    ["PostHog key missing — analytics disabled"],
  ]);
  assert.deepEqual(sdk.calls, []);
});

test("개발자 PC 로 보이는 호스트(루프백·사설·링크 로컬·.local·IPv6 루프백)는 막고 나머지는 연다", () => {
  const blocked = [
    "",
    "LOCALHOST",
    "app.localhost",
    "studio.local",
    "[::1]",
    "::1",
    "0.0.0.0",
    "127.0.0.1",
    "10.1.2.3",
    "192.168.1.20",
    "172.16.0.1",
    "172.31.255.255",
    "169.254.10.10",
  ];
  const allowed = [
    "acttub.com",
    "dev.acttub.com",
    "172.15.0.1",
    "172.32.0.1",
    "192.169.0.1",
    "169.253.0.1",
    "8.8.8.8",
    "1.2.3",
  ];

  assert.deepEqual(blocked.filter((host) => isPostHogHost(host)), []);
  assert.deepEqual(allowed.filter((host) => !isPostHogHost(host)), []);
  assert.equal(isPostHogHost("127.0.0.1", "1"), true);
});

test("이미 같은 게스트로 식별된 SDK 를 켤 때는 신원을 다시 보내지 않고, opt-out 이 없으면 opt-in 도 하지 않는다", () => {
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "test-key";
  sdk.distinctId = "guest-1";
  sdk.optedOut = false;

  withHost("acttub.com", () => startPostHog("guest-1"));

  assert.deepEqual(
    sdk.calls.map(([method]) => method),
    ["init", "startSessionRecording"],
  );
});

test("업로드 실패는 오류 원문 대신 HTTP 상태·network·aborted·unknown 만 싣는다", () => {
  const secret = "배우가 올린 비밀 파일명.mov";
  const reasons = [
    [{ name: "AbortError", message: secret }, "aborted"],
    [{ name: "NetworkError", message: secret }, "network"],
    [{ status: 413, message: secret }, 413],
    [{ status: 413.5 }, "unknown"],
    [
      {
        name: "UploadError",
        message: "업로드 URL이 만료되었을 수 있어요. 업로드를 처음부터 다시 시도해 주세요.",
      },
      403,
    ],
    [{ name: "UploadError", message: "영상을 올리지 못했어요. (HTTP 502)" }, 502],
    [{ name: "UploadError", message: `${secret} (HTTP 999)` }, "unknown"],
    [{ name: "UploadError", message: 42 }, "unknown"],
    [{ name: "UploadError", message: "실패", cause: { name: "AbortError" } }, "aborted"],
    [{ message: secret, cause: { cause: { status: 409 } } }, 409],
    // 원인을 따라가는 깊이는 셋까지다. 그보다 깊은 상태 코드는 읽지 않는다.
    [{ cause: { cause: { cause: { cause: { status: 409 } } } } }, "unknown"],
    [new Error(secret), "unknown"],
    [secret, "unknown"],
    [null, "unknown"],
  ];

  const delivered = deliveredDuring(() => {
    for (const [reason] of reasons) trackPracticeUploadFailed("put", reason);
  });

  assert.deepEqual(
    delivered.map(({ properties }) => properties.reason_code),
    reasons.map(([, code]) => code),
  );
  assert.equal(JSON.stringify(delivered).includes(secret), false);
  assert.deepEqual(new Set(delivered.map(({ properties }) => properties.stage)), new Set(["put"]));
});

test("분석이 성공했거나 실패 코드가 없으면 error_code 를 만들지 않는다", () => {
  const delivered = deliveredDuring(() => {
    trackPracticeAnalysisSettled("analyzed", null, 45_000);
    trackPracticeAnalysisSettled("failed", undefined, Number.NaN);
  });

  assert.deepEqual(delivered, [
    { event: "practice_analysis_settled", properties: { result: "analyzed", wait_bucket: "30-60s" } },
    { event: "practice_analysis_settled", properties: { result: "failed", wait_bucket: "unknown" } },
  ]);
});

test("숫자가 아니거나 음수인 원본은 가장 낮은 구간으로 눌러 담는다", () => {
  assert.deepEqual(
    [Number.NaN, Number.POSITIVE_INFINITY, -5].map(toLengthBucket),
    ["<20", "<20", "<20"],
  );
  assert.deepEqual(
    [Number.NaN, Number.NEGATIVE_INFINITY, -2.5].map(toAgeDaysBucket),
    ["0", "0", "0"],
  );
  assert.deepEqual([Number.NaN, -10].map(toPctBucket), ["0-25", "0-25"]);
});
