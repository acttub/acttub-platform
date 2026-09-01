import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  DIFFICULTY_CHOICES,
  PURPOSE_CHOICES,
  difficultySelection,
  toggleDifficultyChoice,
  togglePurposeChoice,
} = await import("../src/features/practice/prep-choices.ts");

test("같은 칩을 다시 탭하면 선택이 풀린다", () => {
  assert.equal(toggleDifficultyChoice(null, "emotion"), "emotion");
  assert.equal(toggleDifficultyChoice("emotion", "emotion"), null);
  assert.equal(toggleDifficultyChoice("emotion", "gaze"), "gaze");
  assert.equal(togglePurposeChoice(null, "audition"), "audition");
  assert.equal(togglePurposeChoice("audition", "audition"), null);
  assert.equal(togglePurposeChoice("audition", "regular"), "regular");
});

test("안 고른 어려움은 중립값으로, 고른 어려움은 문장 라벨을 detail로 완성한다", () => {
  assert.deepEqual(difficultySelection(null), {
    blockage_kind: "그 외",
    sub_branch: "그 외",
    blockage_detail: null,
  });
  assert.deepEqual(difficultySelection("movement"), {
    blockage_kind: "표현",
    sub_branch: "움직임",
    blockage_detail: "동작이 어색해요",
  });
});

test("선택지 라벨이 M4 레퍼런스 문안과 같다", () => {
  assert.deepEqual(
    DIFFICULTY_CHOICES.map((choice) => choice.label),
    ["감정이 안 올라와요", "시선이 흔들려요", "대사가 급해요", "상대 반응을 못 들어요", "동작이 어색해요"],
  );
  assert.deepEqual(
    PURPOSE_CHOICES.map((choice) => choice.label),
    ["입시 준비", "정기 촬영", "오디션 준비"],
  );
});
