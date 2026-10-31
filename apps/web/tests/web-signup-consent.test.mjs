// 웹 가입 동의(SOMA-834): 줄 구성, 선택 기본값, 모두 동의하기, 제출 결정, 내 계정 표시 규칙.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { buildDecisions, canSubmit, consentLines, lineChecked, signupFailureAction, toggleAll, toggleLine } = await import(
  "../src/features/auth/signup-consent.ts"
);
const { inquiryStatus, maskEmail, shortDate } = await import("../src/features/account/account-format.ts");

const doc = (id, type, required) => ({ id, type, version: "1", title: id, body: "본문", required, published_at: "2026-10-01T00:00:00Z" });
const DOCS = [
  doc("terms", "terms", true),
  doc("privacy", "privacy", true),
  doc("ai", "ai_analysis", true),
  doc("retention", "retention", false),
  doc("voice", "cloud_voice", false),
  doc("mail", "marketing_email", false),
  doc("push", "marketing_push", false),
];

test("동의는 네 줄이고 AI 분석은 개인정보 줄에, 광고성 정보는 한 줄에 묶인다", () => {
  const lines = consentLines(DOCS);
  assert.deepEqual(lines.map((l) => [l.label, l.required]), [
    ["만 14세 이상 · 이용약관", true],
    ["개인정보 처리 · AI 분석", true],
    ["탈퇴 후 영상·녹음 보관", false],
    ["혜택·이벤트 소식 받기", false],
  ]);
  assert.deepEqual(lines[1].documents.map((d) => d.id), ["privacy", "ai"]);
  assert.deepEqual(lines[3].documents.map((d) => d.id), ["mail", "push"]);
});

test("처음에는 아무것도 켜져 있지 않고, 필수만 켜면 가입할 수 있다. 선택은 거절로 보낸다", () => {
  const lines = consentLines(DOCS);
  let state = { choices: {}, ageConfirmed: false };
  assert.equal(canSubmit(DOCS, state.choices, state.ageConfirmed), false);
  assert.equal(lines.some((l) => lineChecked(l, state.choices, state.ageConfirmed)), false);
  state = toggleLine(lines[0], state.choices, state.ageConfirmed);
  state = toggleLine(lines[1], state.choices, state.ageConfirmed);
  assert.equal(canSubmit(DOCS, state.choices, state.ageConfirmed), true);
  const decisions = buildDecisions(DOCS, state.choices);
  assert.deepEqual(
    Object.fromEntries(decisions.map((d) => [d.document_id, d.action])),
    { terms: "granted", privacy: "granted", ai: "granted", retention: "declined", voice: "declined", mail: "declined", push: "declined" },
  );
});

test("만 14세 확인 없이는 제출할 수 없고, 모두 동의하기는 켜고 다시 누르면 끈다", () => {
  const lines = consentLines(DOCS);
  const on = toggleAll(lines, {}, false);
  assert.equal(on.ageConfirmed, true);
  assert.equal(canSubmit(DOCS, on.choices, on.ageConfirmed), true);
  assert.equal(canSubmit(DOCS, on.choices, false), false);
  const off = toggleAll(lines, on.choices, on.ageConfirmed);
  assert.deepEqual(off.choices, {});
  assert.equal(off.ageConfirmed, false);
});

test("가입 실패 중 토큰·문서가 낡은 것만 처음부터 다시 시킨다", () => {
  assert.equal(signupFailureAction({ code: "invalid_signup_token" }), "restart");
  assert.equal(signupFailureAction({ code: "consent_document_outdated" }), "restart");
  assert.equal(signupFailureAction(new Error("x")), "retry");
});

test("내 계정 표시: 이메일은 앞을 가리고, 문의 상태·날짜를 한국어로 보인다", () => {
  assert.equal(maskEmail("abcd@gmail.com"), "a••••@gmail.com");
  assert.equal(maskEmail(null), "없어요");
  assert.deepEqual(inquiryStatus("answered"), { label: "답변 완료", tone: "blue" });
  assert.equal(inquiryStatus("open").label, "확인 중");
  assert.equal(shortDate("2026-10-28T03:00:00Z"), "10월 28일");
});
