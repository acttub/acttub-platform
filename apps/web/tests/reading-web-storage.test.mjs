// 리딩이 기기에 남기는 값 넷이 어느 브라우저 저장소의 어느 키에 들어가는가. 가이드·가리기·못 보낸 목소리는
// localStorage(기기에 오래 남긴다), 못 보낸 완료 저장은 sessionStorage(탭을 닫으면 버린다)다. 저장소가 막힌
// 환경(시크릿 등)에서는 읽기·쓰기가 죽지 않고 기본값으로 돌아간다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { window } from "./dom-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { guideSeen, markGuideSeen } = await import("../src/features/reading/session-copy.ts");
const { loadMask, saveMask } = await import("../src/lib/reading/session/mask.ts");
const { pendingVoicePresets, saveVoicePreset } = await import("../src/lib/reading/session/voice-presets.ts");
const { completionPending, resumeCompletionRetries, startCompletionRetry, _resetCompletion } = await import(
  "../src/lib/reading/session/completion.ts"
);

const failingUpdate = { update: async () => { throw new Error("offline"); } };
// 예약만 하고 돌리지 않는다 — 보내기 전 기기에 남은 값만 본다.
const idle = { send: async () => ({}), schedule: () => () => {} };
const body = { progress_seq: 7, complete: true, elapsed_ms: 5_000, line_results: [] };

/** 두 저장소의 모든 키·값. */
function snapshot() {
  const dump = (storage) => Object.fromEntries(Array.from({ length: storage.length }, (_, i) => storage.key(i)).map((k) => [k, storage.getItem(k)]));
  return { local: dump(window.localStorage), session: dump(window.sessionStorage) };
}

// jsdom 은 저장소를 window 자신의 속성으로 둔다. 막았다가 원래 속성으로 되돌린다.
const originals = Object.fromEntries(
  ["localStorage", "sessionStorage"].map((kind) => [kind, Object.getOwnPropertyDescriptor(window, kind)]),
);

function blockStorage() {
  for (const kind of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(window, kind, {
      configurable: true,
      get() {
        throw new window.DOMException("The operation is insecure.", "SecurityError");
      },
    });
  }
}

function unblockStorage() {
  for (const [kind, descriptor] of Object.entries(originals)) Object.defineProperty(window, kind, descriptor);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  _resetCompletion();
});

afterEach(() => {
  unblockStorage();
  _resetCompletion();
});

test("reading.session: 가이드 본 표시는 localStorage acttub.reading.guide_seen 에 \"1\" 로 남는다", () => {
  assert.equal(guideSeen(), false);
  markGuideSeen();
  assert.deepEqual(snapshot(), { local: { "acttub.reading.guide_seen": "1" }, session: {} });
  assert.equal(guideSeen(), true);

  window.localStorage.clear();
  window.sessionStorage.setItem("acttub.reading.guide_seen", "1");
  assert.equal(guideSeen(), false);
});

test("reading.session: 가리기는 localStorage acttub.reading.mask 에 대본별 JSON 으로 남는다", () => {
  saveMask("script-1", "hide_mine");
  saveMask("script-2", "hide_all");
  assert.deepEqual(snapshot(), {
    local: { "acttub.reading.mask": '{"script-1":"hide_mine","script-2":"hide_all"}' },
    session: {},
  });
  assert.equal(loadMask("script-1"), "hide_mine");

  window.localStorage.clear();
  window.sessionStorage.setItem("acttub.reading.mask", '{"script-1":"hide_mine"}');
  assert.equal(loadMask("script-1"), "show_all");
});

test("reading.cast: 못 보낸 목소리는 localStorage acttub.reading.pending_voices 에 대본별 JSON 으로 남는다", async () => {
  assert.equal(await saveVoicePreset("script-1", "c-nina", "M3", failingUpdate), false);
  assert.equal(await saveVoicePreset("script-1", "c-tre", null, failingUpdate), false);
  assert.deepEqual(snapshot(), {
    local: { "acttub.reading.pending_voices": '{"script-1":{"c-nina":"M3","c-tre":null}}' },
    session: {},
  });

  window.localStorage.clear();
  window.sessionStorage.setItem("acttub.reading.pending_voices", '{"script-1":{"c-nina":"M3"}}');
  assert.deepEqual(pendingVoicePresets("script-1"), {});
});

test("reading.session: 못 보낸 완료 저장은 sessionStorage reading.pending_completions 에 회차별 JSON 으로 남는다", () => {
  startCompletionRetry("session-1", body, idle);
  assert.deepEqual(snapshot(), {
    local: {},
    session: { "reading.pending_completions": JSON.stringify({ "session-1": body }) },
  });

  // 새 페이지 흉내: 메모리는 비우고 기기 값만 남긴다. localStorage 에 있는 값은 이어받지 않는다.
  _resetCompletion();
  window.localStorage.setItem("reading.pending_completions", JSON.stringify({ "session-2": body }));
  resumeCompletionRetries(idle);
  assert.equal(completionPending("session-2"), false);

  window.sessionStorage.setItem("reading.pending_completions", JSON.stringify({ "session-3": body }));
  resumeCompletionRetries(idle);
  assert.equal(completionPending("session-3"), true);
});

test("reading.session: 저장소가 막혀 있으면 읽기는 기본값, 쓰기는 조용히 넘어간다", async () => {
  blockStorage();
  assert.throws(() => window.localStorage, { name: "SecurityError" });

  assert.equal(guideSeen(), false);
  assert.doesNotThrow(() => markGuideSeen());

  assert.doesNotThrow(() => saveMask("script-1", "hide_all"));
  assert.equal(loadMask("script-1"), "show_all");

  assert.equal(await saveVoicePreset("script-1", "c-nina", "M3", failingUpdate), false);
  assert.deepEqual(pendingVoicePresets("script-1"), {});

  assert.doesNotThrow(() => startCompletionRetry("session-1", body, idle));
  assert.equal(completionPending("session-1"), true);
  assert.doesNotThrow(() => resumeCompletionRetries(idle));

  unblockStorage();
  assert.deepEqual(snapshot(), { local: {}, session: {} });
});
