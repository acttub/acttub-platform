import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  chooseBlockageKind,
  chooseBlockageSubBranch,
  completeBlockageFlow,
  initialBlockageFlowState,
  updateBlockageDetail,
} = await import("../src/features/practice/blockage-flow.ts");
const {
  buildPracticeSessionRequest,
  submitSceneContext,
} = await import("../src/features/practice/practice-setup-flow.ts");

test("장면 제출 뒤 막히는 지점을 고르고 그 값을 세션 생성 본문에 연결한다", () => {
  const scene = {
    situation: "  오랜 친구와 다시 만난다  ",
    characterContext: "  먼저 사과하고 싶은 인물  ",
    goal: "  관계를 되돌리고 싶다  ",
  };

  const contextSubmission = submitSceneContext(true, scene);
  assert.deepEqual(contextSubmission, { step: "blockage", error: null });

  const main = chooseBlockageKind(initialBlockageFlowState, "표현");
  const detail = chooseBlockageSubBranch(main, "표정");
  const written = updateBlockageDetail(detail, "  미안하다는 말에서 얼굴이 굳어요  ");
  const selection = completeBlockageFlow(written);
  assert.ok(selection);

  assert.deepEqual(buildPracticeSessionRequest("upload-intent-1", scene, selection), {
    upload_intent_id: "upload-intent-1",
    situation: "오랜 친구와 다시 만난다",
    character_context: "먼저 사과하고 싶은 인물",
    goal: "관계를 되돌리고 싶다",
    blockage_kind: "표현",
    sub_branch: "표정",
    blockage_detail: "미안하다는 말에서 얼굴이 굳어요",
  });

  const appRoot = path.resolve(import.meta.dirname, "..");
  const practiceFlow = readFileSync(
    path.join(appRoot, "src/features/practice/practice-flow.tsx"),
    "utf8",
  );
  assert.match(practiceFlow, /onSubmit=\{showBlockageSelection\}/);
  assert.match(
    practiceFlow,
    /if \(step === "blockage"\)[\s\S]*?<BlockageSelectionFlow/,
  );
  assert.match(
    practiceFlow,
    /onComplete=\{\(selection\) => void begin\(selection\)\}/,
  );
  assert.doesNotMatch(
    practiceFlow,
    /blockage_kind:\s*"그 외"|sub_branch:\s*"그 외"/,
  );
});
