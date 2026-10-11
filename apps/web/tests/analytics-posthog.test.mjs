import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import "./ts-module-loader.mjs";

import { sdk } from "./fixtures/posthog-js.mjs";

// SDK 자체의 네트워크·저장 동작이 아니라 우리 초기화 옵션과 payload만 본다. 모듈 경계에서
// SDK를 바꿔 끼우면 실제 코드가 무엇을 내보냈는지를 그대로 관찰할 수 있다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "posthog-js") {
      return { url: new URL("./fixtures/posthog-js.mjs", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const analytics = await import("../src/lib/analytics/posthog.ts");
const {
  setPostHogUser,
  startPostHog,
  stopPostHog,
  toAgeDaysBucket,
  toDurationBucket,
  toLengthBucket,
  toPctBucket,
  toSizeBucket,
  toWaitBucket,
  trackConsentSubmitted,
  trackExitReviewOpened,
  trackExitReviewSubmitted,
  trackPracticeAbandoned,
  trackPracticeAnalysisSettled,
  trackPracticeSceneSkipped,
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
  trackPracticeUploadProfiled,
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
  return sdk.calls.filter(([method]) => method === name);
}

/** 이 함수 안에서 SDK 밖으로 나간 이벤트 이름만. */
function deliveredDuring(run) {
  const before = sdk.delivered.length;
  run();
  return sdk.delivered.slice(before).map(({ event }) => event);
}

// 키 하나가 운영 스위치다. 비어 있을 때 SDK가 이벤트를 내부 큐에 쌓는 것조차 막는다.
test("키가 없으면 init도 capture도 하지 않는다", () => {
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  withFakeWindow("acttub.com", () => {
    startPostHog();
    trackPracticePrepOpened("new");
  });

  assert.equal(callsOf("init").length, 0);
  assert.equal(callsOf("capture").length, 0);
});

// opt-out 은 localStorage 에 남는다. 앞 페이지에서 끈 채 새로고침하면 SDK 는 꺼진 채 init 되므로,
// 켤 차례인 지금 풀지 않으면 동의한 게스트의 이벤트가 조용히 버려진다.
test("새로고침 뒤 opt-out 이 남아 있어도 켜면 opt-in 하고, $opt_in 이벤트는 보내지 않는다", () => {
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "test-key";
  sdk.optedOut = true;

  const delivered = deliveredDuring(() => {
    withFakeWindow("acttub.com", () => startPostHog());
    trackPracticePrepOpened("new");
  });

  assert.deepEqual(delivered, ["practice_prep_opened"]);
  assert.deepEqual(callsOf("opt_in_capturing"), [["opt_in_capturing", { captureEventName: false }]]);
});

// 여러 번 불려도 SDK 인스턴스는 하나여야 device_id 와 세션이 갈라지지 않는다.
test("키가 있으면 계약된 옵션으로 한 번만 초기화하고 설치 확인용 이벤트는 보내지 않는다", () => {
  const delivered = deliveredDuring(() => {
    withFakeWindow("acttub.com", () => startPostHog());
  });

  assert.deepEqual(delivered, []);
  assert.deepEqual(callsOf("init"), [
    [
      "init",
      "test-key",
      {
        api_host: "https://us.i.posthog.com",
        ui_host: "https://us.posthog.com",
        autocapture: true,
        capture_pageview: "history_change",
        session_recording: { maskAllInputs: false },
        disable_surveys: true,
        disable_product_tours: true,
        disable_conversations: true,
        advanced_disable_feature_flags: true,
        capture_exceptions: false,
        capture_heatmaps: false,
        capture_dead_clicks: false,
      },
    ],
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
  const before = callsOf("capture").length;
  trackScreenViewed(
    "/practice/1b4e28ba-2fa1-11d2-883f-0016d3cca427?session=secret#note",
  );
  const screen = callsOf("capture").slice(before).find(([, event]) => event === "screen_viewed");

  assert.ok(screen);
  assert.deepEqual(screen[2], { path: "/practice/<id>" });
});

// 이론 선택은 0.1.0 에서 준비 화면과 함께 사라졌다(practice.start). 옛 호출 모양이 남아 있어도
// 그 속성을 만들지 않는다.
test("practice_session_created는 theory_choice를 보내지 않는다", () => {
  sdk.calls.length = 0;

  trackPracticeSessionCreated(61_000, "분석", "대사 분석", false);

  const payloads = callsOf("capture")
    .filter(([, event]) => event === "practice_session_created")
    .map(([, , payload]) => payload);
  assert.equal(payloads.length, 1);
  assert.equal(Object.hasOwn(payloads[0], "theory_choice"), false);
  assert.equal(payloads[0].scene_skipped, false);
});

// 원문을 받는 래퍼에도 일부러 민감한 값을 넣는다. payload에는 분류·버킷만 남아야 한다.
test("20개 이벤트 래퍼가 계약 속성만 보내고 금지 키를 만들지 않는다", () => {
  sdk.calls.length = 0;
  const sensitiveText = "배우가 직접 쓴 비밀 장면과 답변";

  trackPracticePrepOpened("new");
  trackPracticeVideoSelected(12 * 1024 * 1024, true);
  trackPracticeSceneSkipped();
  trackPracticeBlockageSubmitted("분석", "대사 분석", sensitiveText);
  trackPracticeUploadFailed("put", { status: 503, message: sensitiveText });
  trackPracticeUploadProfiled({
    compressMs: 12_345.6,
    uploadMs: 6_789.4,
    originalBytes: 48 * 1024 * 1024,
    uploadedBytes: 9 * 1024 * 1024,
    wasCompressed: true,
    webcodecsSupported: true,
    videoDurationMs: 61_000,
  });
  trackPracticeSessionCreated(61_000, "분석", "대사 분석", true);
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
  trackConsentSubmitted("ok");
  trackScreenViewed("/practice/1b4e28ba-2fa1-11d2-883f-0016d3cca427?query=secret");

  const events = callsOf("capture").map(([, event, payload]) => ({ event, payload }));
  assert.equal(events.length, 20);
  assert.deepEqual(
    events.map(({ event }) => event).sort(),
    [
      "consent_submitted",
      "exit_review_opened",
      "exit_review_submitted",
      "practice_abandoned",
      "practice_analysis_settled",
      "practice_blockage_submitted",
      "practice_dialogue_completed",
      "practice_dialogue_start_failed",
      "practice_dialogue_started",
      "practice_dialogue_turn_failed",
      "practice_dialogue_turn_sent",
      "practice_history_opened",
      "practice_prep_opened",
      "practice_result_viewed",
      "practice_scene_skipped",
      "practice_session_created",
      "practice_upload_failed",
      "practice_upload_profiled",
      "practice_video_selected",
      "screen_viewed",
    ].sort(),
  );

  const allowedKeys = {
    practice_prep_opened: ["entry"],
    practice_video_selected: ["is_reselect", "size_bucket"],
    practice_scene_skipped: [],
    practice_blockage_submitted: ["has_detail", "kind", "sub_branch"],
    practice_upload_failed: ["reason_code", "stage"],
    practice_upload_profiled: [
      "compress_ms",
      "original_bytes",
      "upload_ms",
      "uploaded_bytes",
      "video_duration_ms",
      "was_compressed",
      "webcodecs_supported",
    ],
    practice_session_created: [
      "duration_bucket",
      "kind",
      "scene_skipped",
      "sub_branch",
    ],
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

// 결정 I-6: 끈다는 것은 실제 중단이다. 식별자만 지우면 이미 켜진 autocapture 와 화면 녹화는
// SDK 가 스스로 계속 보낸다. opt-out 상태에서는 SDK 가 capture 를 버리고 녹화를 시작하지 않는다.
test("계측 I-6: stopPostHog 는 SDK 를 opt-out 시키고 그 뒤의 이벤트를 보내지 않는다", () => {
  withFakeWindow("acttub.com", () => setPostHogUser("guest-1"));
  const optOutsBefore = callsOf("opt_out_capturing").length;

  const delivered = deliveredDuring(() => {
    stopPostHog();
    stopPostHog();
    trackScreenViewed("/home");
  });

  assert.deepEqual(delivered, []);
  assert.equal(sdk.optedOut, true);
  assert.equal(callsOf("opt_out_capturing").length, optOutsBefore + 1);
});

test("계측 I-6: 같은 게스트로 다시 켜면 opt-out 만 풀고 기기 식별은 끊지 않는다", () => {
  const deviceBefore = sdk.deviceId;
  sdk.calls.length = 0;

  withFakeWindow("acttub.com", () => {
    startPostHog();
    setPostHogUser("guest-1");
  });
  sdk.delivered.length = 0;
  trackScreenViewed("/home");

  assert.deepEqual(sdk.delivered, [
    { event: "screen_viewed", properties: { path: "/home" }, distinctId: "guest-1", deviceId: deviceBefore },
  ]);
  assert.deepEqual(
    sdk.calls.map(([name]) => name),
    ["opt_in_capturing", "capture"],
  );
});

// reset() 은 저장된 동의도 지운다. 그래서 순서는 reset → (필요하면) opt-in → identify 다.
test("계측 I-6: 다른 게스트로 켜지면 새 기기 id 로 끊고 그 게스트로 잇는다", () => {
  const deviceBefore = sdk.deviceId;

  stopPostHog();
  sdk.calls.length = 0;
  withFakeWindow("acttub.com", () => {
    startPostHog();
    setPostHogUser("guest-2");
  });
  sdk.delivered.length = 0;
  trackScreenViewed("/home");

  assert.deepEqual(sdk.delivered, [
    { event: "screen_viewed", properties: { path: "/home" }, distinctId: "guest-2", deviceId: deviceBefore + 1 },
  ]);
  assert.deepEqual(
    sdk.calls.map(([name]) => name),
    ["opt_in_capturing", "reset", "identify", "capture"],
  );
});

