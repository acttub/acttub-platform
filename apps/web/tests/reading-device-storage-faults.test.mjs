// 리딩이 기기 저장소에 남긴 값이 깨져 있거나(손상된 JSON) 저장소가 쓰기를 거절할 때(용량 초과 등) 화면이 죽지 않고
// 기본값·메모리만으로 이어 가는지 본다. 저장소 자체가 막힌 경우는 reading-web-storage.test.mjs 가 본다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { window } from "./dom-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";
// 브라우저에서 전역 sessionStorage 는 window.sessionStorage 다. storage.ts 는 전역 이름으로 읽는다.
globalThis.sessionStorage = window.sessionStorage;

const { storage } = await import("../src/lib/reading/storage.ts");
const { guideSeen, markGuideSeen } = await import("../src/features/reading/session-copy.ts");
const { loadMask, maskLabel, saveMask } = await import("../src/lib/reading/session/mask.ts");
const { pendingVoicePresets, retryPendingVoicePresets, saveVoicePreset } = await import(
  "../src/lib/reading/session/voice-presets.ts"
);
const { completionPending, resumeCompletionRetries, startCompletionRetry, _resetCompletion } = await import(
  "../src/lib/reading/session/completion.ts"
);

const proto = window.Storage.prototype;
const realSetItem = proto.setItem;
const realRemoveItem = proto.removeItem;

function rejectWrites() {
  const quota = () => {
    throw new window.DOMException("full", "QuotaExceededError");
  };
  proto.setItem = quota;
  proto.removeItem = quota;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  _resetCompletion();
});

afterEach(() => {
  proto.setItem = realSetItem;
  proto.removeItem = realRemoveItem;
  _resetCompletion();
});

test("reading.session: 저장된 값이 깨진 JSON 이면 대본·회차·가리기·목소리·완료 저장 모두 없는 것으로 읽는다", () => {
  for (const key of ["reading.script.v2", "reading.session", "reading.stats", "reading.run_prefs", "reading.memorize", "reading.pending_completions"]) {
    window.sessionStorage.setItem(key, "{broken");
  }
  for (const key of ["acttub.reading.mask", "acttub.reading.pending_voices"]) window.localStorage.setItem(key, "{broken");

  assert.equal(storage.loadScript(), null);
  assert.equal(storage.loadSession(), null);
  assert.equal(storage.loadStats(), null);
  assert.equal(storage.loadRunPrefs(), null);
  assert.equal(storage.loadMemorizeEntry(), null);
  assert.equal(loadMask("script-1"), "show_all");
  assert.deepEqual(pendingVoicePresets("script-1"), {});

  resumeCompletionRetries({ send: async () => ({}), schedule: () => () => {} });
  assert.equal(completionPending("session-1"), false);
});

test("reading.session: 저장소가 쓰기를 거절해도 저장 호출은 조용히 넘어가고 앞서 남은 값은 그대로다", () => {
  storage.saveRunPrefs({ partnerVoice: "text" });
  rejectWrites();

  assert.doesNotThrow(() => storage.saveRunPrefs({ partnerVoice: "device" }));
  assert.doesNotThrow(() => storage.saveRunPrefs(null));
  assert.deepEqual(storage.loadRunPrefs(), { partnerVoice: "text" });

  assert.doesNotThrow(() => saveMask("script-1", "hide_all"));
  assert.equal(loadMask("script-1"), "show_all");

  assert.doesNotThrow(() => markGuideSeen());
  assert.equal(guideSeen(), false);
});

test("reading.session: 가이드 본 표시를 읽다 저장소가 던지면 가이드를 다시 띄우지 않는다", () => {
  const realGetItem = proto.getItem;
  proto.getItem = () => {
    throw new window.DOMException("denied", "SecurityError");
  };
  try {
    assert.equal(guideSeen(), true);
  } finally {
    proto.getItem = realGetItem;
  }
});

test("reading.session: 완료 저장을 기기에 남기지 못해도 메모리에서는 저장 중으로 남고, 지우기도 죽지 않는다", () => {
  rejectWrites();
  startCompletionRetry("session-1", { progress_seq: 3, complete: true, elapsed_ms: 1_000, line_results: [] }, {
    send: async () => ({}),
    schedule: () => () => {},
  });
  assert.equal(completionPending("session-1"), true);
  assert.equal(window.sessionStorage.getItem("reading.pending_completions"), null);

  assert.doesNotThrow(() => _resetCompletion());
  assert.equal(completionPending("session-1"), false);
});

test("reading.cast: 목소리 저장소가 쓰기를 거절하면 못 보낸 목소리는 기기에 남지 않는다", async () => {
  rejectWrites();
  const saved = await saveVoicePreset("script-1", "c-nina", "M3", { update: async () => { throw new Error("offline"); } });
  assert.equal(saved, null);
  assert.deepEqual(pendingVoicePresets("script-1"), {});
});

test("reading.cast: 한 배역의 저장이 성공하면 그 배역만 못 보낸 목록에서 빠지고 다른 배역은 남는다", async () => {
  const offline = { update: async () => { throw new Error("offline"); } };
  await saveVoicePreset("script-1", "c-nina", "M3", offline);
  await saveVoicePreset("script-1", "c-kostya", "F1", offline);

  const sent = [];
  const saved = await saveVoicePreset("script-1", "c-nina", "M4", {
    update: async (id, body) => {
      sent.push([id, body]);
      return { id };
    },
  });

  assert.deepEqual(saved, { id: "script-1" });
  assert.deepEqual(sent, [["script-1", { characters: [{ id: "c-nina", voice_preset: "M4" }] }]]);
  assert.deepEqual(pendingVoicePresets("script-1"), { "c-kostya": "F1" });
});

test("reading.cast: 못 보낸 목소리를 다시 보내다 실패하면 false 를 주고 기록은 남긴다", async () => {
  await saveVoicePreset("script-1", "c-nina", null, { update: async () => { throw new Error("offline"); } });
  const sent = [];
  const ok = await retryPendingVoicePresets("script-1", {
    update: async (id, body) => {
      sent.push([id, body]);
      throw new Error("still offline");
    },
  });
  assert.equal(ok, false);
  assert.deepEqual(sent, [["script-1", { characters: [{ id: "c-nina", voice_preset: null }] }]]);
  assert.deepEqual(pendingVoicePresets("script-1"), { "c-nina": null });
});

test("reading.session: 가리기 이름은 아는 값에만 붙고 모르는 값이면 빈 글자다", () => {
  assert.equal(maskLabel("hide_mine"), "내 대사만 가리기");
  assert.equal(maskLabel("unknown"), "");
});
