// practice.feedback — 이탈 설문 시트의 창구와 동작. 웹은 외부 폼 대신 같은 시트를 쓴다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import "./guest-session-setup.mjs";
import { react, window } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { createRoot } = await import("react-dom/client");
const { ExitReviewModal } = await import("../src/features/workspace/exit-review.tsx");

const appRoot = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(appRoot, relative), "utf8");
const workspace = read("src/features/workspace/workspace-app.tsx");
const exitReview = read("src/features/workspace/exit-review.tsx");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** 접수 요청을 받아 적는 fetch. 무엇을 몇 번 보냈는지가 결과만큼이나 중요하다. */
function feedbackStub({ ok = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ path: String(url), body: init.body ? JSON.parse(init.body) : null });
    if (!ok) return new Response(JSON.stringify({ detail: "internal_server_error" }), { status: 500, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ id: "f-1" }), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

function openSheet({ trigger = "x", screen = "coach", practiceId = "practice-1" } = {}) {
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const closed = [];
  react.act(() =>
    root.render(
      react.createElement(ExitReviewModal, {
        trigger,
        screen,
        practiceId,
        onClose: () => closed.push(true),
      }),
    ),
  );
  const click = (label) => {
    const button = [...container.querySelectorAll("button")].find((node) => node.textContent === label);
    assert.ok(button, `${label} 버튼이 없다`);
    react.act(() => button.click());
  };
  const type = (selector, value) => {
    const field = container.querySelector(selector);
    assert.ok(field, `${selector} 가 없다`);
    react.act(() => {
      const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, "value").set;
      setter.call(field, value);
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  };
  return {
    closed,
    container,
    text: () => container.textContent,
    click,
    type,
    unmount() {
      react.act(() => root.unmount());
      container.remove();
    },
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

test("practice.feedback: 웹은 외부 폼을 띄우지 않는다", () => {
  // 소감은 서버에 먼저 저장된다(DB 정본, 시트는 복제본).
  assert.doesNotMatch(exitReview, /iframe|REVIEW_FORM_URL|postMessage/);
  assert.doesNotMatch(workspace, /REVIEW_FORM_URL/);
  assert.doesNotMatch(read("src/lib/config/env.ts"), /REVIEW_FORM_URL/);
  assert.match(exitReview, /submitPracticeFeedback/);
});

test("practice.feedback: 한 번만 묻기는 서버 선점으로 판정하고 옛 7일 규칙은 없다", () => {
  assert.match(exitReview, /claimExitSurvey\(\)/);
  assert.doesNotMatch(exitReview, /REVIEW_QUIET_MS|canAskAutomatically|acttub_review_done/);
});

test("practice.feedback: 오프라인에서는 새 자동 노출을 하지 않는다", () => {
  assert.match(exitReview, /navigator\.onLine === false/);
});

test("practice.feedback: 연습 화면을 떠나는 뒤로가기와 데스크톱 커서 이탈을 잡는다", () => {
  assert.match(exitReview, /window\.addEventListener\("popstate", onPopState\);/);
  assert.match(exitReview, /if \(!guardPushedRef\.current\) \{\s*\n\s*guardPushedRef\.current = true;/);
  assert.match(exitReview, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(exitReview, /if \(pointerFine\) document\.addEventListener\("mouseout", onMouseOut\);/);
});

test("practice.feedback: 대화가 시작된 뒤에만 묻고 화면 이름은 coach·report 로 간다", () => {
  assert.match(workspace, /const reviewArmed = view\.review\.armed;/);
  assert.match(workspace, /useExitReview\(reviewArmed, view\.review\.kind\)/);
  assert.match(workspace, /screen=\{feedbackScreen\(view\.review\.kind\)\}/);
  assert.match(workspace, /onClick=\{onFinish\}/);
  assert.doesNotMatch(workspace, /target="_blank"/);
});

test("practice.feedback: 시트는 수집 범위를 밝히고 연락처를 선택으로 받는다", () => {
  const sheet = openSheet();
  try {
    assert.match(sheet.text(), /답변은 서비스 개선에만 써요 · 이름은 보이지 않아요/);
    // 연락처 칸은 있되 비워 둔 채로 보낼 수 있다(선택).
    const placeholders = [...sheet.container.querySelectorAll("input")].map((node) => node.placeholder);
    assert.deepEqual(placeholders, ["이메일(선택)", "전화번호(선택)"]);
    assert.equal([...sheet.container.querySelectorAll("input")].some((node) => node.required), false);
  } finally {
    sheet.unmount();
  }
});

test("practice.feedback: 보내기는 화면·계기·본문을 접수하고 창을 닫는다", async () => {
  const calls = feedbackStub();
  const sheet = openSheet({ trigger: "x", screen: "coach" });
  try {
    sheet.type("textarea", "질문이 좋았어요");
    sheet.click("보내기");
    await settled();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/v2/practice-feedback");
    assert.equal(calls[0].body.screen, "coach");
    assert.equal(calls[0].body.trigger, "x");
    assert.equal(calls[0].body.body, "질문이 좋았어요");
    assert.equal(calls[0].body.practice_id, "practice-1");
    assert.deepEqual(sheet.closed, [true]);
  } finally {
    sheet.unmount();
  }
});

test("practice.feedback: 빈 소감은 보내지 않고 무엇이 필요한지 말한다", async () => {
  const calls = feedbackStub();
  const sheet = openSheet();
  try {
    sheet.type("textarea", "   ");
    sheet.click("보내기");
    await settled();

    assert.equal(calls.length, 0);
    assert.match(sheet.text(), /한 줄만 적어 주세요/);
    assert.deepEqual(sheet.closed, []);
  } finally {
    sheet.unmount();
  }
});

test("practice.feedback: 건너뛰기도 본문 없는 행으로 남기고 창을 닫는다", async () => {
  const calls = feedbackStub();
  const sheet = openSheet({ trigger: "leave", screen: "report" });
  try {
    sheet.click("건너뛰기");
    await settled();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.trigger, "leave");
    assert.equal(calls[0].body.screen, "report");
    assert.equal(Object.hasOwn(calls[0].body, "body"), false);
    assert.deepEqual(sheet.closed, [true]);
  } finally {
    sheet.unmount();
  }
});

test("practice.feedback: 접수가 실패해도 나가기를 막지 않는다", async () => {
  feedbackStub({ ok: false });
  const sheet = openSheet();
  try {
    sheet.type("textarea", "좋았어요");
    sheet.click("보내기");
    await settled();

    assert.deepEqual(sheet.closed, [true]);
  } finally {
    sheet.unmount();
  }
});

test("practice.feedback: 보내기와 건너뛰기가 둘 다 가지는 않는다", async () => {
  const calls = feedbackStub();
  const sheet = openSheet();
  try {
    sheet.type("textarea", "좋았어요");
    sheet.click("보내기");
    sheet.click("건너뛰기");
    await settled();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.body, "좋았어요");
  } finally {
    sheet.unmount();
  }
});
