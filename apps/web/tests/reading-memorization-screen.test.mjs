// reading.memorization·reading.session — 암기 화면과 완료 화면 본문이 보여 주는 말. 껍데기(Page)는 Node 에서 그릴 수 없어
// 본문만 정적으로 그린다. 점수·등급·칭찬·"틀렸어요" 문구가 없어야 한다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { MemorizationBody, MEMORIZED_BUTTON, NOT_YET_BUTTON, SHOW_MEMORIZED_TOGGLE } = await import("../src/features/reading/screens/MemorizationBody.tsx");
const { DoneBody, SAVING_COPY } = await import("../src/features/reading/screens/DoneBody.tsx");
const { createMemorizationSync } = await import("../src/lib/reading/memorization/sync.ts");
const { EMPTY_TARGETS_COPY } = await import("../src/lib/reading/memorization/targets.ts");

const script = {
  id: "script-1",
  title: "봄밤",
  roles: ["니나", "트레"],
  characters: [
    { id: "c-a", name: "니나", voicePreset: null },
    { id: "c-b", name: "트레", voicePreset: null },
  ],
  lines: [
    { type: "dialogue", role: "트레", text: "둘." },
    { type: "dialogue", role: "니나", text: "너 힘들면 항상 높은 데로 가잖아." },
    { type: "dialogue", role: "니나", text: "넷." },
  ],
  lineIds: ["l-0", "l-1", "l-2"],
  raw: "",
  openSessionId: null,
  lastSession: null,
};
const noop = () => {};
const text = (html) => html.replace(/<[^>]+>/g, "");

function render(entries, lineIds = null, roles = ["니나"]) {
  const sync = createMemorizationSync({ initial: entries, send: async (lineId, status) => ({ line_id: lineId, status, updated_at: "" }) });
  return renderToStaticMarkup(React.createElement(MemorizationBody, { script, roles, lineIds, sync, onRolesChange: noop, onBack: noop, onReading: noop }));
}

test("reading.memorization: 머리는 \"니나 역 · 암기하지 못한 대사 N개\", 진행은 \"외운 줄 K / 내 대사 N\", 바로 전 상대 대사와 네 모드·두 표시 버튼이 있다", () => {
  const html = render([{ line_id: "l-2", status: "memorized", updated_at: "" }]);
  const t = text(html);
  assert.equal(t.includes("니나 역 · 암기하지 못한 대사 1개"), true);
  assert.equal(t.includes("외운 줄 1 / 내 대사 2"), true);
  assert.equal(t.includes("트레둘."), true);
  for (const label of ["가리고 연습", "빈칸 연습", "첫 글자", "듣고 따라 하기", MEMORIZED_BUTTON, NOT_YET_BUTTON, SHOW_MEMORIZED_TOGGLE, "원문 듣기", "원문 보기"]) {
    assert.equal(t.includes(label), true, label);
  }
  // 가리고 연습이 기본이라 본문 글자가 보이지 않는다.
  assert.equal(t.includes("힘들면"), false);
  for (const banned of ["점수", "등급", "틀렸어요", "잘했어요", "정확도"]) assert.equal(t.includes(banned), false, banned);
});

test("reading.memorization: 모두 외웠으면 \"못 외운 대사가 없어요\" 와 리딩으로 가는 길이 보인다", () => {
  const t = text(render([{ line_id: "l-1", status: "memorized", updated_at: "" }, { line_id: "l-2", status: "memorized", updated_at: "" }]));
  assert.equal(t.includes(EMPTY_TARGETS_COPY), true);
  assert.equal(t.includes("리딩하러 가기"), true);
  assert.equal(t.includes("암기하지 못한 대사 0개"), true);
});

test("reading.memorization: 완료 화면의 다시 볼 대사로 들어오면 그 줄만 열고 외운 줄도 표시가 그대로다", () => {
  const t = text(render([{ line_id: "l-1", status: "memorized", updated_at: "" }], ["l-1"]));
  assert.equal(t.includes("암기하지 못한 대사 1개"), true);
  assert.equal(t.includes("외웠어요"), true);
  assert.equal(t.includes(SHOW_MEMORIZED_TOGGLE), false);
});

test("reading.session: 완료 저장이 끝나기 전에는 완료 화면이 \"저장 중\" 을 보이고, 다시 볼 대사에 \"전체보기\" 가 있다", () => {
  const stats = { mode: "read", elapsedMs: 1000, lineCount: 3, myCharacterNames: ["니나"], lineResults: [{ line_id: "l-1", outcome: "unmatched", misses: 1 }] };
  const html = renderToStaticMarkup(React.createElement(DoneBody, { script, stats, repeating: false, error: null, saving: true, onRepeat: noop, onChangeSetup: noop, onNewScript: noop, onDetail: noop, onReview: noop }));
  const t = text(html);
  assert.equal(t.includes(SAVING_COPY), true);
  assert.equal(t.includes("전체보기"), true);
  const done = text(renderToStaticMarkup(React.createElement(DoneBody, { script, stats, repeating: false, error: null, saving: false, onRepeat: noop, onChangeSetup: noop, onNewScript: noop, onDetail: noop })));
  assert.equal(done.includes(SAVING_COPY), false);
  assert.equal(done.includes("전체보기"), false);
});
