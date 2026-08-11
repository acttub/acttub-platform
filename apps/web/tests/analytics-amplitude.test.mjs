import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import "./ts-module-loader.mjs";

// SDK 자체의 네트워크·저장 동작이 아니라 우리 초기화 옵션과 payload만 본다. 모듈 경계에서
// 최소 API를 바꿔 끼우면 실제 코드가 init/track을 불렀는지를 그대로 관찰할 수 있다.
const amplitudeMockUrl = `data:text/javascript,${encodeURIComponent(`
const calls = globalThis.__amplitudeCalls;
export const init = (...args) => calls.push(["init", ...args]);
export const track = (...args) => calls.push(["track", ...args]);
export const setUserId = (...args) => calls.push(["setUserId", ...args]);
export const reset = (...args) => calls.push(["reset", ...args]);
`)}`;

globalThis.__amplitudeCalls = [];
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@amplitude/analytics-browser") {
      return { url: amplitudeMockUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const analytics = await import("../src/lib/analytics/amplitude.ts");
const {
  startAmplitude,
  toAgeDaysBucket,
  toDurationBucket,
  toLengthBucket,
  toPctBucket,
  toSizeBucket,
  toWaitBucket,
  trackConsentSubmitted,
  trackExitReviewOpened,
  trackExitReviewSubmitted,
  trackLoginCompleted,
  trackLoginFailed,
  trackPracticeAbandoned,
  trackPracticeAnalysisSettled,
  trackPracticeBlockageStarted,
  trackPracticeBlockageSubmitted,
  trackPracticeDialogueCompleted,
  trackPracticeDialogueStartFailed,
  trackPracticeDialogueStarted,
  trackPracticeDialogueTurnFailed,
  trackPracticeDialogueTurnSent,
  trackPracticeHistoryOpened,
  trackPracticePrepOpened,
  trackPracticeResultViewed,
  trackPracticeSessionCreated,
  trackPracticeUploadFailed,
  trackPracticeVideoSelected,
  trackScreenViewed,
} = analytics;

function withFakeWindow(hostname, run) {
  globalThis.window = { location: { hostname } };
  try {
    return run();
  } finally {
    delete globalThis.window;
  }
}

function callsOf(name) {
  return globalThis.__amplitudeCalls.filter(([method]) => method === name);
}

// API 키 하나가 운영 스위치다. 비어 있을 때 SDK가 이벤트를 내부 큐에 쌓는 것조차 막는다.
test("API 키가 없으면 init도 track도 하지 않는다", () => {
  delete process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;
  withFakeWindow("acttub.com", () => {
    startAmplitude();
    trackPracticePrepOpened("new");
  });

  assert.equal(callsOf("init").length, 0);
  assert.equal(callsOf("track").length, 0);
});

test("실서비스가 아닌 호스트에서는 init도 track도 하지 않는다", () => {
  process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY = "test-key";
  withFakeWindow("localhost", () => {
    startAmplitude();
    trackPracticePrepOpened("new");
  });

  assert.equal(callsOf("init").length, 0);
  assert.equal(callsOf("track").length, 0);
});

test("autocapture를 통째로 끄고 여러 번 불러도 한 번만 초기화한다", () => {
  withFakeWindow("acttub.com", () => {
    startAmplitude();
    startAmplitude();
  });

  const initCalls = callsOf("init");
  assert.equal(initCalls.length, 1);
  assert.deepEqual(initCalls[0].slice(1), [
    "test-key",
    undefined,
    {
      autocapture: false,
      identityStorage: "localStorage",
      serverZone: "US",
    },
  ]);
});

// 원본 숫자가 경계에서 한 구간씩 밀리면 퍼널 분포가 조용히 틀어지므로 양쪽 값을 못박는다.
test("버킷 함수 6개의 경계값을 계약대로 뭉갠다", () => {
  assert.deepEqual(
    [-1, 0, 29_999, 30_000, 59_999, 60_000, 179_999, 180_000].map(toDurationBucket),
    ["unknown", "<30s", "<30s", "30-60s", "30-60s", "60-180s", "60-180s", "180s+"],
  );

  const mb = 1024 * 1024;
  assert.deepEqual(
    [-1, 0, 10 * mb - 1, 10 * mb, 30 * mb - 1, 30 * mb, 60 * mb - 1, 60 * mb]
      .map(toSizeBucket),
    ["unknown", "<10MB", "<10MB", "10-30MB", "10-30MB", "30-60MB", "30-60MB", "60MB+"],
  );

  assert.deepEqual(
    [-1, 0, 29_999, 30_000, 59_999, 60_000, 119_999, 120_000].map(toWaitBucket),
    ["unknown", "<30s", "<30s", "30-60s", "30-60s", "60-120s", "60-120s", "120s+"],
  );
  assert.deepEqual(
    [0, 19, 20, 59, 60, 149, 150].map(toLengthBucket),
    ["<20", "<20", "20-60", "20-60", "60-150", "60-150", "150+"],
  );
  assert.deepEqual(
    [0, 0.9, 1, 3, 4, 7, 8, 29, 30].map(toAgeDaysBucket),
    ["0", "0", "1-3", "1-3", "4-7", "4-7", "8-30", "8-30", "30+"],
  );
  assert.deepEqual(
    [0, 24.9, 25, 49.9, 50, 74.9, 75, 99, 100].map(toPctBucket),
    ["0-25", "0-25", "25-50", "25-50", "50-75", "50-75", "75-99", "75-99", "75-99"],
  );
});

test("screen_viewed는 쿼리·해시를 버리고 경로 UUID를 가린다", () => {
  const before = callsOf("track").length;
  trackScreenViewed(
    "/practice/1b4e28ba-2fa1-11d2-883f-0016d3cca427?session=secret#note",
  );
  const screen = callsOf("track").slice(before).find(([, event]) => event === "screen_viewed");

  assert.ok(screen);
  assert.deepEqual(screen[2], { path: "/practice/<id>" });
});

// 원문을 받는 래퍼에도 일부러 민감한 값을 넣는다. payload에는 분류·버킷만 남아야 한다.
test("21개 이벤트 래퍼가 계약 속성만 보내고 금지 키를 만들지 않는다", () => {
  globalThis.__amplitudeCalls.length = 0;
  const sensitiveText = "배우가 직접 쓴 비밀 장면과 답변";

  trackPracticePrepOpened("new");
  trackPracticeVideoSelected(12 * 1024 * 1024, true);
  trackPracticeBlockageStarted();
  trackPracticeBlockageSubmitted("분석", "대사 분석", sensitiveText);
  trackPracticeUploadFailed("put", { status: 503, message: sensitiveText });
  trackPracticeSessionCreated(61_000, "분석", "대사 분석");
  trackPracticeAnalysisSettled("failed", "gemini_timeout", 61_000);
  trackPracticeDialogueStarted(true, "분석", "대사 분석");
  trackPracticeDialogueStartFailed(false);
  trackPracticeDialogueTurnSent(1, sensitiveText);
  trackPracticeDialogueTurnFailed(1);
  trackPracticeDialogueCompleted(3, "analysis", "coach");
  trackPracticeResultViewed("analysis", 3, "current");
  trackPracticeAbandoned("chat", 3, 82);
  trackPracticeHistoryOpened("analyzed", true, 5);
  trackExitReviewOpened("x", "chat");
  trackExitReviewSubmitted("x");
  trackLoginCompleted("google");
  trackLoginFailed("google", {
    status: 401,
    code: "invalid_provider_token",
    message: sensitiveText,
  });
  trackConsentSubmitted("ok");
  trackScreenViewed("/practice/1b4e28ba-2fa1-11d2-883f-0016d3cca427?query=secret");

  const events = callsOf("track").map(([, event, payload]) => ({ event, payload }));
  assert.equal(events.length, 21);
  assert.deepEqual(
    events.map(({ event }) => event).sort(),
    [
      "consent_submitted",
      "exit_review_opened",
      "exit_review_submitted",
      "login_completed",
      "login_failed",
      "practice_abandoned",
      "practice_analysis_settled",
      "practice_blockage_started",
      "practice_blockage_submitted",
      "practice_dialogue_completed",
      "practice_dialogue_start_failed",
      "practice_dialogue_started",
      "practice_dialogue_turn_failed",
      "practice_dialogue_turn_sent",
      "practice_history_opened",
      "practice_prep_opened",
      "practice_result_viewed",
      "practice_session_created",
      "practice_upload_failed",
      "practice_video_selected",
      "screen_viewed",
    ].sort(),
  );

  const allowedKeys = {
    practice_prep_opened: ["entry"],
    practice_video_selected: ["is_reselect", "size_bucket"],
    practice_blockage_started: [],
    practice_blockage_submitted: ["has_detail", "kind", "sub_branch"],
    practice_upload_failed: ["reason_code", "stage"],
    practice_session_created: ["duration_bucket", "kind", "sub_branch"],
    practice_analysis_settled: ["error_code", "result", "wait_bucket"],
    practice_dialogue_started: ["kind", "sub_branch", "with_evidence"],
    practice_dialogue_start_failed: ["restart"],
    practice_dialogue_turn_sent: ["answer_length_bucket", "turn_index"],
    practice_dialogue_turn_failed: ["turn_index"],
    practice_dialogue_completed: ["ended_by", "report_type", "turn_count"],
    practice_result_viewed: ["report_type", "source", "turn_count"],
    practice_abandoned: ["mode", "pct_bucket", "turn_count"],
    practice_history_opened: ["age_days_bucket", "has_note", "status"],
    exit_review_opened: ["mode", "trigger"],
    exit_review_submitted: ["trigger"],
    login_completed: ["provider"],
    login_failed: ["provider", "reason_code"],
    consent_submitted: ["result"],
    screen_viewed: ["path"],
  };
  for (const { event, payload } of events) {
    assert.deepEqual(Object.keys(payload).sort(), allowedKeys[event], `${event} 속성이 계약과 다르다`);
  }

  const forbiddenKeys = new Set([
    "session",
    "session_id",
    "intent_id",
    "file_name",
    "email",
    "name",
    "text",
    "body",
    "query",
  ]);
  for (const { event, payload } of events) {
    for (const key of Object.keys(payload)) {
      assert.equal(forbiddenKeys.has(key), false, `${event} payload에 금지 키 ${key}가 있다`);
    }
    assert.equal(JSON.stringify(payload).includes(sensitiveText), false, `${event}에 원문이 남았다`);
  }
});
