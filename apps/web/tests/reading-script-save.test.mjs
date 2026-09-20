// reading.script — 저장·열기 흐름. 초안을 서버에 저장하면 돌려받은 대본이 화면 모양으로 캐시되고 초안은 버려진다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

// storage 는 sessionStorage 를 쓴다. Node 에는 없으므로 가장 작은 것을 심는다.
const memory = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};

const { DraftRejectedError, openScript, saveScriptDraft } = await import("../src/features/reading/script-save.ts");
const { newDraft, updateDraft } = await import("../src/lib/reading/draft.ts");
const { storage } = await import("../src/lib/reading/storage.ts");
const { toStoredScript } = await import("../src/lib/reading/script/from-server.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

const RAW = "옥상, 밤\n\n(바람 소리.)\n윤서: 여기 있을 줄 알았어.\n태오: 어떻게 알았어.\n제2막\n윤서: 다음 거 언제야.\n태오: 모레.";

function scriptDetail() {
  return {
    id: "script-1",
    title: "옥상, 밤",
    source: "paste",
    raw_text: RAW,
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
  clearTokens();
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
});

test("reading.script: 서버가 돌려준 대본은 배역 순서·줄 순서대로 화면 모양이 되고 줄·배역 id 를 함께 든다", () => {
  const stored = toStoredScript(scriptDetail());
  assert.equal(stored.id, "script-1");
  assert.equal(stored.title, "옥상, 밤");
  assert.deepEqual(stored.roles, ["윤서", "태오"]);
  assert.deepEqual(stored.characters, [{ id: "c-1", name: "윤서" }, { id: "c-2", name: "태오" }]);
  assert.deepEqual(stored.lines, [
    { type: "direction", text: "바람 소리." },
    { type: "dialogue", role: "윤서", text: "여기 있을 줄 알았어." },
    { type: "dialogue", role: "태오", text: "어떻게 알았어." },
    { type: "scene", text: "제2막" },
    { type: "dialogue", role: "윤서", text: "다음 거 언제야." },
    { type: "dialogue", role: "태오", text: "모레." },
  ]);
  assert.deepEqual(stored.lineIds, ["l-1", "l-2", "l-3", "l-4", "l-5", "l-6"]);
  assert.equal(stored.raw, RAW);
});

test("reading.script: 초안을 저장하면 서버 대본이 지금 대본이 되고 초안과 이전 설정·결과는 버려진다", async () => {
  storage.saveSetup({ myRole: "옛배역", start: 0, end: 1, mode: "read", advanceMode: "manual" });
  storage.saveStats({ mode: "read", elapsedMs: 1, lineCount: 1 });
  const draft = newDraft(RAW, "paste");
  storage.saveDraft(draft);
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ route: `${init.method} ${url}`, body: JSON.parse(init.body) });
    return jsonResponse(scriptDetail(), 201);
  };

  const stored = await saveScriptDraft(draft, "55555555-5555-4555-8555-555555555555");

  assert.equal(requests.length, 1);
  assert.equal(requests[0].route, "POST /v2/reading/scripts");
  assert.equal(requests[0].body.request_id, "55555555-5555-4555-8555-555555555555");
  assert.equal(stored.id, "script-1");
  assert.deepEqual(storage.loadScript(), stored);
  assert.equal(storage.loadDraft(), null);
  assert.equal(storage.loadSetup(), null);
  assert.equal(storage.loadStats(), null);
});

test("reading.script: 배역 없는 초안은 서버에 보내지 않고 no_characters 로 막는다", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return jsonResponse(scriptDetail(), 201);
  };
  const draft = updateDraft(updateDraft(newDraft(RAW, "paste"), { exclude: "윤서" }), { exclude: "태오" });

  await assert.rejects(saveScriptDraft(draft, "66666666-6666-4666-8666-666666666666"), (error) => error instanceof DraftRejectedError && error.code === "no_characters");
  assert.equal(fetchCount, 0);
  assert.equal(new DraftRejectedError("no_characters").message, "배역이 하나도 없어요. 배역 이름을 적어 주세요.");
});

test("reading.script: 목록에서 고른 대본은 서버에서 받아 지금 대본이 되고 이전 설정·결과는 버려진다", async () => {
  storage.saveSetup({ myRole: "옛배역", start: 0, end: 1, mode: "read", advanceMode: "manual" });
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push(`${init.method ?? "GET"} ${url}`);
    return jsonResponse(scriptDetail());
  };

  const stored = await openScript("script-1");

  assert.deepEqual(requests, ["GET /v2/reading/scripts/script-1"]);
  assert.equal(stored.id, "script-1");
  assert.deepEqual(storage.loadScript(), stored);
  assert.equal(storage.loadSetup(), null);
});
