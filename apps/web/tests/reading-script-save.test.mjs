// reading.script — 서버 대본을 화면 모양으로 캐시해 지금 대본으로 드는 흐름.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

// storage 는 sessionStorage 를 쓴다. Node 에는 없으므로 가장 작은 것을 심는다.
const memory = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};

const { adoptScript } = await import("../src/features/reading/script-save.ts");
const { storage } = await import("../src/lib/reading/storage.ts");
const { toStoredScript } = await import("../src/lib/reading/script/from-server.ts");

function scriptDetail() {
  return {
    id: "script-1",
    title: "옥상, 밤",
    source: "paste",
    // 서버가 순서를 섞어 줘도 order·ordinal 로 세운다.
    characters: [
      { id: "c-2", name: "태오", order: 1, voice_preset: null, dialogue_count: 2 },
      { id: "c-1", name: "윤서", order: 0, voice_preset: null, dialogue_count: 2 },
    ],
    lines: [
      { id: "l-2", ordinal: 2, kind: "dialogue", character_id: "c-1", text: "여기 있을 줄 알았어.", dialogue_no: 1 },
      { id: "l-1", ordinal: 1, kind: "direction", character_id: null, text: "바람 소리.", dialogue_no: null },
      { id: "l-3", ordinal: 3, kind: "dialogue", character_id: "c-2", text: "어떻게 알았어.", dialogue_no: 2 },
      { id: "l-4", ordinal: 4, kind: "scene", character_id: null, text: "제2막", dialogue_no: null },
      { id: "l-5", ordinal: 5, kind: "dialogue", character_id: "c-1", text: "다음 거 언제야.", dialogue_no: 3 },
      { id: "l-6", ordinal: 6, kind: "dialogue", character_id: "c-2", text: "모레.", dialogue_no: 4 },
    ],
    recording_count: 0,
    open_session_id: null,
    last_session: null,
    created_at: "2026-09-21T03:00:00Z",
    updated_at: "2026-09-21T03:00:00Z",
  };
}

beforeEach(() => {
  memory.clear();
});

test("reading.script: 서버가 돌려준 대본은 배역 순서·줄 순서대로 화면 모양이 되고 줄·배역 id 를 함께 든다", () => {
  const stored = toStoredScript(scriptDetail());
  assert.equal(stored.id, "script-1");
  assert.equal(stored.title, "옥상, 밤");
  assert.deepEqual(stored.roles, ["윤서", "태오"]);
  assert.deepEqual(stored.characters, [{ id: "c-1", name: "윤서", voicePreset: null }, { id: "c-2", name: "태오", voicePreset: null }]);
  assert.equal(stored.lastSession, null);
  assert.deepEqual(stored.lines, [
    { type: "direction", text: "바람 소리." },
    { type: "dialogue", role: "윤서", text: "여기 있을 줄 알았어." },
    { type: "dialogue", role: "태오", text: "어떻게 알았어." },
    { type: "scene", text: "제2막" },
    { type: "dialogue", role: "윤서", text: "다음 거 언제야." },
    { type: "dialogue", role: "태오", text: "모레." },
  ]);
  assert.deepEqual(stored.lineIds, ["l-1", "l-2", "l-3", "l-4", "l-5", "l-6"]);
});

test("reading.script: 넣기가 끝난 서버 대본을 들면 지금 대본이 되고 이전 회차·결과는 버려진다", () => {
  storage.saveSession({ id: "s-old" });
  storage.saveStats({ mode: "read", elapsedMs: 1, lineCount: 1, myCharacterNames: [], lineResults: [] });

  const stored = adoptScript(scriptDetail());

  assert.equal(stored.id, "script-1");
  assert.deepEqual(storage.loadScript(), stored);
  assert.equal(storage.loadSession(), null);
  assert.equal(storage.loadStats(), null);
});
