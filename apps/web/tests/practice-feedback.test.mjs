// practice.feedback — 이탈 설문의 규칙과 접수. 웹은 외부 폼 대신 같은 시트를 쓰고 서버에 먼저 저장한다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import "./guest-session-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const {
  FEEDBACK_BODY_MAX,
  FEEDBACK_CONTACT_MAX,
  feedbackScreen,
  normalizeBody,
  PRIVACY_NOTICE,
  validateFeedback,
} = await import("../src/features/workspace/exit-survey.ts");
const { claimExitSurvey, submitPracticeFeedback } = await import(
  "../src/lib/api/v2/practice-feedback.ts"
);

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stub(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      path: String(url),
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body) : null,
    });
    return handler(calls.length);
  };
  return calls;
}

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

test("practice.feedback: 대화 화면은 coach, 노트 화면은 report 로 간다", () => {
  assert.equal(feedbackScreen("chat"), "coach");
  assert.equal(feedbackScreen("note"), "report");
});

test("practice.feedback: 본문은 공백을 정리한 뒤 1~100자다", () => {
  assert.equal(FEEDBACK_BODY_MAX, 100);
  assert.equal(normalizeBody("  두   칸이   있었어요  "), "두 칸이 있었어요");
  assert.equal(normalizeBody("줄바꿈도\n\n한 칸으로"), "줄바꿈도 한 칸으로");

  assert.equal(validateFeedback({ body: "가".repeat(100), email: "", phone: "" }).ok, true);
  const tooLong = validateFeedback({ body: "가".repeat(101), email: "", phone: "" });
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.message, /100자/);
  // 공백만 적은 것은 보낼 것이 없다(건너뛰기와 다르다).
  const blank = validateFeedback({ body: "   ", email: "", phone: "" });
  assert.equal(blank.ok, false);
  assert.match(blank.message, /한 줄/);
});

test("practice.feedback: 연락처는 선택이고 각각 80자까지다", () => {
  assert.equal(FEEDBACK_CONTACT_MAX, 80);
  // 연락처 없이도 보낼 수 있다.
  const bare = validateFeedback({ body: "좋았어요", email: "", phone: "" });
  assert.equal(bare.ok, true);
  assert.equal(Object.hasOwn(bare.payload, "contact_email"), false);
  assert.equal(Object.hasOwn(bare.payload, "contact_phone"), false);

  const withContact = validateFeedback({ body: "좋았어요", email: " me@example.com ", phone: "010-0000-0000" });
  assert.equal(withContact.payload.contact_email, "me@example.com");
  assert.equal(withContact.payload.contact_phone, "010-0000-0000");

  const longEmail = validateFeedback({ body: "좋았어요", email: "a".repeat(81), phone: "" });
  assert.equal(longEmail.ok, false);
  assert.match(longEmail.message, /80자/);
});

test("practice.feedback: 화면 문구는 실제 수집 범위를 말한다", () => {
  assert.equal(PRIVACY_NOTICE, "답변은 서비스 개선에만 써요 · 이름은 보이지 않아요");
  // "이름은 남지 않아요"는 사실이 아니라 고쳤다.
  assert.doesNotMatch(PRIVACY_NOTICE, /남지 않아요/);
});

test("practice.feedback: 자동 노출은 서버가 선점한 기기에서만 뜬다", async () => {
  const calls = stub((n) => json({ asked_now: n === 1 }));

  assert.equal(await claimExitSurvey(), true);
  // 두 번째 기기(또는 두 번째 연습)는 선점하지 못해 뜨지 않는다.
  assert.equal(await claimExitSurvey(), false);
  assert.deepEqual(calls.map((c) => [c.path, c.method]), [
    ["/v2/me/practice-feedback/claim", "POST"],
    ["/v2/me/practice-feedback/claim", "POST"],
  ]);
});

test("practice.feedback: 선점을 못 물어보면 묻지 않는다 — 실패가 창을 띄우지 않는다", async () => {
  stub(() => json({ detail: "internal_server_error" }, 500));
  assert.equal(await claimExitSurvey(), false);
});

test("practice.feedback: 보내기는 화면·계기·본문을 싣고 같은 요청 id 로 한 행이 된다", async () => {
  const calls = stub(() => json({ id: "f-1" }, 201));

  const payload = validateFeedback({ body: "질문이 좋았어요", email: "", phone: "" });
  assert.equal(payload.ok, true);
  await submitPracticeFeedback(
    { practiceId: "practice-1", screen: "coach", trigger: "x", ...payload.payload },
    { requestId: "req-1" },
  );

  assert.deepEqual(calls[0], {
    path: "/v2/practice-feedback",
    method: "POST",
    body: {
      request_id: "req-1",
      practice_id: "practice-1",
      screen: "coach",
      trigger: "x",
      body: "질문이 좋았어요",
    },
  });
});

test("practice.feedback: 건너뛰기도 본문 없는 행으로 남는다", async () => {
  const calls = stub(() => json({ id: "f-2" }, 201));

  await submitPracticeFeedback(
    { practiceId: null, screen: "report", trigger: "leave" },
    { requestId: "req-2" },
  );

  assert.deepEqual(calls[0].body, {
    request_id: "req-2",
    practice_id: null,
    screen: "report",
    trigger: "leave",
  });
  // 본문 칸을 빈 문자열로 만들지 않는다 — 서버는 body 없음으로 dismissed 를 가린다.
  assert.equal(Object.hasOwn(calls[0].body, "body"), false);
});
