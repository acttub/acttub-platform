// reading.script — 대본 넣기(D13)·확인(D16) 화면이 보여 주는 말. 화면 껍데기(Page)는 next/link 를 끌어와
// Node 에서 그릴 수 없으므로 본문만 정적으로 그려 문구를 본다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { InputBody } = await import("../src/features/reading/screens/InputBody.tsx");
const { NO_CHARACTERS_COPY, ScriptConfirmPanel } = await import("../src/features/reading/screens/ScriptConfirmPanel.tsx");
const { COPYRIGHT_NOTICE } = await import("../src/features/reading/script-list.ts");
const { newDraft, updateDraft } = await import("../src/lib/reading/draft.ts");

const idleSave = { save: async () => {}, saving: false, error: null };
const RAW = "제1막\n(바람 소리.)\n지수: 하나.\n민준: 둘.\n지수: 셋.\n민준: 넷.";

function render(element) {
  // 정적 마크업의 글자만 본다. 태그 사이에 끊긴 문장은 없다.
  return renderToStaticMarkup(element).replace(/<[^>]+>/g, "");
}

test("reading.script: 웹 대본 넣기 화면(D13)에 \"서버로 보내지 않아요\"·\"이 기기에만 저장돼요\"·\"어디로 가나요\" 가 없고 저작권 안내 한 줄이 있다", () => {
  const text = render(React.createElement(InputBody, { initialDraft: null, save: idleSave, onConfirm: () => {}, onOpen: () => {} }));
  assert.equal(text.includes("서버로 보내지 않아요"), false);
  assert.equal(text.includes("이 기기에만 저장돼요"), false);
  assert.equal(text.includes("어디로 가나요"), false);
  assert.equal(text.includes(COPYRIGHT_NOTICE), true);
  // 네 길이 다 있다.
  for (const entry of ["파일에서 열기", "붙여넣기", "직접 쓰기", "예시 대본 불러오기"]) assert.equal(text.includes(entry), true, entry);
});

test("reading.script: 확인 화면(D16)은 \"배역 N명 · 대사 N줄 · 지문 N개 · 장면 N개\" 와 배역 칩을 보여 준다", () => {
  const html = renderToStaticMarkup(React.createElement(ScriptConfirmPanel, { draft: newDraft(RAW, "paste"), onChange: () => {} }));
  const text = html.replace(/<[^>]+>/g, "");
  assert.equal(text.includes("배역 2명 · 대사 4줄 · 지문 1개 · 장면 1개"), true);
  assert.equal(text.includes("지수2줄"), true);
  assert.equal(text.includes("민준2줄"), true);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 2);
});

test("reading.script: 배역 하나를 빼면 배역 수가 줄고 그 칩은 눌리지 않은 상태로 남아 되살릴 수 있다", () => {
  const draft = updateDraft(newDraft(RAW, "paste"), { exclude: "민준" });
  const html = renderToStaticMarkup(React.createElement(ScriptConfirmPanel, { draft, onChange: () => {} }));
  const text = html.replace(/<[^>]+>/g, "");
  assert.equal(text.includes("배역 1명 · 대사 2줄 · 지문 3개 · 장면 1개"), true);
  assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 1);
});

test("reading.script: 배역이 하나도 안 잡히면 저장하지 않고 이름을 직접 적게 안내한다", () => {
  const text = render(React.createElement(ScriptConfirmPanel, { draft: newDraft("오늘은 아무도 오지 않았다.", "typed"), onChange: () => {} }));
  assert.equal(text.includes("배역 0명"), true);
  assert.equal(text.includes(NO_CHARACTERS_COPY), true);

  // 데스크톱 D13 의 저장 버튼도 배역이 없으면 잠긴다.
  const html = renderToStaticMarkup(
    React.createElement(InputBody, { initialDraft: newDraft("오늘은 아무도 오지 않았다.", "typed"), save: idleSave, onConfirm: () => {}, onOpen: () => {} }),
  );
  assert.match(html, /<button[^>]*disabled=""[^>]*>저장하고 배역 정하러 가기<\/button>/);
});
