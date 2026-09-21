import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const readSource = (relativePath) =>
  readFileSync(path.join(appRoot, relativePath), "utf8");

const panel = () => readSource("src/features/memory/memory-panel.tsx");

/**
 * 코치가 기억하는 것 (SOMA-360).
 *
 * 이 화면은 **틀린 기억을 되돌릴 수 있는 유일한 자리**다. 코치가 연습마다 여기에
 * 쌓고 다음 연습에서 그걸 읽으므로(SOMA-358·359), 화면이 없거나 고칠 수 없으면
 * 잘못 적힌 내용이 이후 모든 대화의 전제로 굳는다.
 */

test("워크스페이스에서 기억 화면으로 들어가는 길이 있다", () => {
  const source = readSource("src/features/workspace/workspace-app.tsx");

  assert.match(source, /href="\/memory"/);
});

test("practice.memory: 네 칸을 보여주고 성별·나이 칸은 없다", () => {
  const source = panel();

  for (const field of ["goal", "blockage", "speech_self", "speech_actual"]) {
    assert.match(source, new RegExp(`field: "${field}"`), `${field} 칸이 없다`);
  }
  // 성별·나이는 프로필이 가진다(account.profile).
  assert.doesNotMatch(source, /field: "gender"|field: "age"/);
  assert.match(readSource("src/lib/api/v2/memory.ts"), /MEMORY_FIELDS = \[\s*"goal",/);
});

test("practice.memory: 웹 게스트에게는 프로필 편집 링크 대신 앱 이관 안내가 있다", () => {
  // 게스트에게는 프로필이 없다. 어디서 적을 수 있는지는 말해 준다.
  assert.match(panel(), /성별·나이는 앱으로 옮기면 프로필에서 적어요/);
  assert.match(panel(), /\{PROFILE_MOVE_NOTICE\}/);
});

test("practice.memory: 내가 적은 값임을 칸마다 보여준다", () => {
  // 내가 고친 칸은 코치가 덮지 않는다는 걸 알아야 고치는 의미가 생긴다.
  const source = panel();

  assert.match(source, /edited_by_me/);
  assert.match(source, /내가 적은 값/);
  assert.match(source, /코치가 적음/);
});

test("practice.memory: 갱신 시점을 사실대로 적는다", () => {
  // 실제로는 첫 확인 연습과 그 뒤 3회마다다(1·3·6·9…). "마칠 때마다"는 사실이 아니다.
  assert.doesNotMatch(panel(), /연습을 마칠 때마다/);
});

test("코치가 적은 칸은 근거가 된 연습으로 갈 수 있다", () => {
  // "이게 왜 이렇게 적혔지" 를 볼 수 있어야 고칠지 판단이 선다.
  const source = panel();

  assert.match(source, /source_practice_session_id/);
  assert.match(source, /\/home\?session=/); // 연습 화면이 세션을 여는 방식
});

test("고친 내용이 코치에게 우선한다고 화면에 적혀 있다", () => {
  assert.match(panel(), /고친 내용은 코치가 다시 바꾸지 않습니다/);
});

test("칸 하나씩도, 전부도 지울 수 있다", () => {
  const source = panel();

  assert.match(source, /deleteMemoryField/);
  assert.match(source, /deleteAllMemory/);
});

test("전부 지우기는 되돌릴 수 없다고 알리고 확인을 받는다", () => {
  const source = panel();

  assert.match(source, /window\.confirm/);
  assert.match(source, /되돌릴 수 없어요/);
});

test("불러오기에 실패하면 빈 상태와 구분해 알린다", () => {
  // 빈 화면으로 보이면 배우가 "코치가 아무것도 모르는구나" 로 잘못 읽는다.
  const source = panel();

  assert.match(source, /불러오지 못했어요/);
  assert.match(source, /role="alert"/);
});

test("기억이 하나도 없을 때 빈 화면을 설명한다", () => {
  // 대부분의 배우가 처음엔 여기다.
  assert.match(panel(), /아직 적힌 게 없어요/);
});

test("practice.memory: 저장 길이 상한이 서버와 같다(1,000자)", () => {
  const source = readSource("src/lib/api/v2/memory.ts");

  assert.match(source, /MEMORY_VALUE_MAX_LENGTH = 1000/);
  assert.match(panel(), /maxLength=\{MEMORY_VALUE_MAX_LENGTH\}/);
});

test("게스트 한 사람의 자료를 보는 화면이라 색인하지 않는다", () => {
  const source = readSource("src/app/memory/page.tsx");

  assert.match(source, /buildNoindexMetadata/);
});
