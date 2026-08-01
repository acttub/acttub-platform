import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const source = readFileSync(
  path.join(appRoot, "src/features/workspace/workspace-app.tsx"),
  "utf8",
);

test("워크스페이스 사이드바는 저장된 호칭을 먼저 쓰고 서버 값으로 갱신한다", () => {
  assert.match(source, /\bgetStoredDisplayName\b/);
  assert.match(source, /\bloadDisplayName\b/);
});

test("워크스페이스 사이드바에 이메일 기반 이름 생성 로직이 남아 있지 않다", () => {
  assert.doesNotMatch(source, /email\.split\("@"\)/);
  assert.doesNotMatch(source, /\bformatName\b/);
});

test("워크스페이스 사이드바는 호칭이 없을 때 배우를 표시한다", () => {
  assert.match(source, /const displayName = nickname \?\? "배우";/);
});
