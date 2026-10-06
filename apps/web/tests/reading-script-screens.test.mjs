// reading.script — 대본 넣기(D13) 화면과 그 위 대화상자가 보여 주는 말. 화면 껍데기(Page)는 next/link 를 끌어와
// Node 에서 그릴 수 없으므로 본문만 정적으로 그려 문구를 본다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { ImportDialogs, InputBody } = await import("../src/features/reading/screens/InputBody.tsx");
const { COPYRIGHT_NOTICE } = await import("../src/features/reading/script-list.ts");

const importer = (view) => ({ view, start: () => {}, retry: () => {}, agree: () => {}, close: () => {} });

function render(element) {
  // 정적 마크업의 글자만 본다. 태그 사이에 끊긴 문장은 없다.
  return renderToStaticMarkup(element).replace(/<[^>]+>/g, "");
}

const dialogText = (view) => render(React.createElement(ImportDialogs, { importer: importer(view), onOpen: () => {} }));
const inDialog = (dialog) => dialogText({ kind: "dialog", dialog, attempt: null });

test("reading.script: 웹 대본 넣기 화면(D13)에 네 길과 저작권 안내가 있고 기기에서 배역을 찾는다는 말은 없다", () => {
  const text = render(React.createElement(InputBody, { importer: importer({ kind: "idle" }), onOpen: () => {} }));
  assert.equal(text.includes("서버로 보내지 않아요"), false);
  assert.equal(text.includes("이 기기 안에서"), false);
  assert.equal(text.includes(COPYRIGHT_NOTICE), true);
  assert.equal(text.includes("TXT·DOCX·PDF·HWP · 50MB까지"), true);
  for (const entry of ["파일에서 열기", "붙여넣기", "직접 쓰기", "예시 대본 불러오기"]) assert.equal(text.includes(entry), true, entry);
});

test("reading.script: 나누는 중 대화상자(R2.11)는 서버가 준 진행 줄 수를 보이고, 아직 줄 수가 없으면 숫자 없이 뜬다", () => {
  assert.equal(dialogText({ kind: "splitting", progress: { doneLines: 24, totalLines: 1061 } }), "대본을 나누고 있어요배역과 대사를 찾는 중이에요.24 / 1,061줄");
  assert.equal(dialogText({ kind: "splitting", progress: null }), "대본을 나누고 있어요배역과 대사를 찾는 중이에요.");
  assert.equal(dialogText({ kind: "idle" }), "");
});

test("reading.script: 결과마다 앱 pen R2 장과 같은 뜻의 대화상자가 뜬다", () => {
  assert.equal(inDialog({ kind: "not_script" }), "대본이 아닌 것 같아요배역 이름과 대사가 있는 글이 필요해요.그래도 나누기다시 고르기");
  assert.equal(inDialog({ kind: "no_characters" }), "배역을 찾지 못했어요대본에 말하는 사람 이름이 있는지 확인하고 다시 넣어 주세요.확인");
  assert.equal(
    inDialog({ kind: "daily_limit" }),
    "오늘은 대본을 더 넣을 수 없어요대본은 하루 20번까지 나눌 수 있어요. 내일 다시 넣어 주세요.확인",
  );
  assert.equal(inDialog({ kind: "split_unavailable" }), "아직 웹에서는 내 대본을 넣을 수 없어요예시 대본으로 먼저 해 볼 수 있어요.확인");
  assert.equal(inDialog({ kind: "file_too_large" }), "파일을 읽지 못했어요파일이 너무 커요. 50MB까지 열 수 있어요.확인");
  assert.equal(
    inDialog({ kind: "file_unreadable" }),
    "파일을 읽지 못했어요대본을 읽지 못했어요. 스캔한 PDF이거나 지원하지 않는 형식일 수 있어요. 복사해서 붙여넣어 주세요.확인",
  );
  assert.equal(inDialog({ kind: "failed", message: "네트워크 연결을 확인하고 다시 시도해주세요." }), "저장하지 못했어요네트워크 연결을 확인하고 다시 시도해주세요.확인");
  assert.equal(inDialog({ kind: "duplicate", scriptId: "script-1" }), "이미 넣은 대본이에요내 대본에 같은 글이 있어요.새로 넣기그 대본 열기");
});

test("reading.script: 동의 대화상자(R2.14)는 무엇을 보내고 보관하는지 알리고, 동의를 저장하지 못했으면 그 까닭을 함께 보인다", () => {
  const body =
    "대본을 나누려면 동의가 필요해요동의해야 대본을 넣을 수 있어요.대본 글을 OpenAI로 보내 배역과 대사를 나눠요.넣은 파일은 대본과 함께 보관하고, 대본을 지우면 같이 지워요.자세히 보기";
  assert.equal(inDialog({ kind: "consent_required" }), `${body}동의하고 나누기취소`);
  assert.equal(inDialog({ kind: "consent_required", error: "회원만 할 수 있어요." }), `${body}회원만 할 수 있어요.동의하고 나누기취소`);
});
