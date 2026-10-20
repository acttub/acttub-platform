// account.guest — 동의 시트 등록부. 막힌 요청들은 시트 하나를 함께 기다리고, 시트가 떠 있던 시간은
// 요청 기한에서 빼도록 따로 센다.
import assert from "node:assert/strict";
import { mock, test } from "node:test";

import "./ts-module-loader.mjs";

const { askConsent, consentPromptElapsedMs, registerConsentPrompt, whenConsentPromptCloses } = await import(
  "../src/lib/api/v2/consent-prompt.ts"
);

const DOCUMENT = {
  id: "ai-analysis-document",
  type: "ai_analysis",
  version: "2026-10-01",
  title: "AI 분석 동의",
  body: "전문",
  required: true,
  published_at: "2026-10-01T00:00:00.000000Z",
};

function controlledPrompt() {
  const seen = [];
  let settle;
  const prompt = (documents) => {
    seen.push(documents.map((d) => d.type));
    return new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
  };
  return { prompt, seen, settle: () => settle };
}

test("account.guest: 시트가 등록되지 않은 화면에서는 묻지 않고 닫힌 것으로 답한다", async () => {
  assert.equal(whenConsentPromptCloses(), null);
  assert.equal(await askConsent([DOCUMENT]), "dismissed");
});

test("account.guest: 동시에 막힌 요청은 시트 하나를 함께 기다리고, 떠 있던 시간을 열린 동안에도 센다", async () => {
  mock.timers.enable({ apis: ["Date"], now: 10_000 });
  const { prompt, seen, settle } = controlledPrompt();
  const unregister = registerConsentPrompt(prompt);
  try {
    const first = askConsent([DOCUMENT]);
    const second = askConsent([{ ...DOCUMENT, type: "privacy" }]);
    assert.deepEqual(seen, [["ai_analysis"]]);

    assert.equal(consentPromptElapsedMs(10_400), 400);
    const closed = whenConsentPromptCloses();

    mock.timers.setTime(10_700);
    settle().resolve("decided");
    assert.deepEqual(await Promise.all([first, second, closed]), ["decided", "decided", undefined]);
    assert.equal(consentPromptElapsedMs(99_999), 700);
    assert.equal(whenConsentPromptCloses(), null);
  } finally {
    unregister();
    mock.timers.reset();
  }
});

test("account.guest: 시트가 실패로 끝나도 닫힘을 기다리던 쪽은 풀리고 다음 요청은 새 시트를 띄운다", async () => {
  const { prompt, seen, settle } = controlledPrompt();
  const unregister = registerConsentPrompt(prompt);
  try {
    const asked = askConsent([DOCUMENT]);
    const closed = whenConsentPromptCloses();
    settle().reject(new Error("시트를 그리지 못했다"));
    await assert.rejects(asked, { message: "시트를 그리지 못했다" });
    assert.equal(await closed, undefined);

    const again = askConsent([DOCUMENT]);
    settle().resolve("dismissed");
    assert.equal(await again, "dismissed");
    assert.deepEqual(seen, [["ai_analysis"], ["ai_analysis"]]);
  } finally {
    unregister();
  }
});

test("account.guest: 먼저 등록한 시트의 해제는 나중에 등록한 시트를 거두지 않는다", async () => {
  const unregisterOld = registerConsentPrompt(async () => "dismissed");
  const unregisterNew = registerConsentPrompt(async () => "decided");
  unregisterOld();
  assert.equal(await askConsent([DOCUMENT]), "decided");
  unregisterNew();
  assert.equal(await askConsent([DOCUMENT]), "dismissed");
});
