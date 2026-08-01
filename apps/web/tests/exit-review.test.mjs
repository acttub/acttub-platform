import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { test } from "node:test";

register("./ts-module-loader.mjs", import.meta.url);

const { canAskAutomatically, REVIEW_QUIET_MS } = await import(
  "../src/features/workspace/exit-review-policy.ts"
);

const appRoot = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(appRoot, relative), "utf8");
const workspace = read("src/features/workspace/workspace-app.tsx");
const exitReview = read("src/features/workspace/exit-review.tsx");

test("후기를 이미 남긴 사람에게는 자동으로 다시 묻지 않는다", () => {
  assert.equal(canAskAutomatically("1", null, 1_000), false);
  assert.equal(canAskAutomatically("1", String(1_000 - REVIEW_QUIET_MS * 5), 1_000), false);
});

test("한 번도 묻지 않았으면 묻는다", () => {
  assert.equal(canAskAutomatically(null, null, 1_000), true);
  assert.equal(canAskAutomatically(null, "", 1_000), true);
  assert.equal(canAskAutomatically(null, "이상한값", 1_000), true);
});

test("최근에 물어봤으면 조용히 두고, 기간이 지나면 다시 묻는다", () => {
  const now = REVIEW_QUIET_MS * 10;
  assert.equal(canAskAutomatically(null, String(now - 1), now), false);
  assert.equal(canAskAutomatically(null, String(now - REVIEW_QUIET_MS), now), true);
});

test("연습 화면을 떠나는 뒤로가기는 모두 잡는다", () => {
  // 밖으로 나가든 랜딩으로 돌아가든, 연습 화면에서 뒤로 가는 건 대개 "그만하겠다"다.
  // 어디로 가는지 가리지 않으므로 히스토리 위치를 따지는 코드가 남아 있으면 안 된다.
  assert.doesNotMatch(exitReview, /currentEntry|backLeavesSite/);
  assert.match(exitReview, /window\.addEventListener\("popstate", onPopState\);/);
});

test("감시용 히스토리 항목은 화면당 한 번만 쌓는다", () => {
  // 새 연습을 반복할 때마다 쌓으면 나갈 때 뒤로가기를 여러 번 눌러야 한다.
  assert.match(exitReview, /if \(!guardPushedRef\.current\) \{\s*\n\s*guardPushedRef\.current = true;/);
});

test("후기 창은 폼이 든 그 iframe 이 보낸 메시지만 받는다", () => {
  assert.match(exitReview, /event\.origin !== FORM_ORIGIN/);
  assert.match(exitReview, /event\.source !== frameRef\.current\.contentWindow/);
  assert.match(exitReview, /const FORM_ORIGIN = new URL\(REVIEW_FORM_URL\)\.origin;/);
});

test("후기 창을 어디서 열었는지 폼에 실어 보낸다", () => {
  assert.match(exitReview, /\?embed=1&src=exit-\$\{trigger\}/);
});

test("커서 이탈은 데스크톱에서만 건다", () => {
  assert.match(exitReview, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(exitReview, /if \(pointerFine\) document\.addEventListener\("mouseout", onMouseOut\);/);
});


test("대화가 시작된 뒤에만 후기를 묻는다", () => {
  assert.match(workspace, /const reviewArmed = mode === "chat" \|\| mode === "note";/);
});

test("연습 노트의 마치기도 새 창이 아니라 같은 후기 창을 연다", () => {
  assert.doesNotMatch(workspace, /REVIEW_FORM_URL/);
  assert.doesNotMatch(workspace, /target="_blank"/);
  assert.match(workspace, /onClick=\{onFinish\}/);
});

test("앱 안 이동인지 판단하려고 다른 화면에 손대지 않는다", () => {
  // 브라우저가 세어 주므로 랜딩·약관 같은 이동 지점을 건드릴 이유가 없다.
  assert.doesNotMatch(exitReview, /markPageInHistory|sessionStorage/);
});
