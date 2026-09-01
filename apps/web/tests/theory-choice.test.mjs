import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { THEORY_CHOICES, toggleTheoryChoice } = await import(
  "../src/features/practice/theory-choice.ts"
);

test("접근법은 하나만 고르고 같은 칩을 다시 누르면 코치 자동으로 돌아간다", () => {
  assert.equal(toggleTheoryChoice(null, "meisner"), "meisner");
  assert.equal(toggleTheoryChoice("meisner", "hagen"), "hagen");
  assert.equal(toggleTheoryChoice("hagen", "hagen"), null);
});

test("접근법 목록은 계약 예정 id, 이름 제목, 각도 설명을 가진다", () => {
  // 이름을 제목으로 앞세우는 것은 2026-08-30 최우영 결정 — 스펙 §3의
  // "이론 이름을 먼저 띄우지 않는다"를 화면에서 뒤집었다.
  // "상관없음"(none)은 2026-09-01 추가 — 은행 리소스가 아니라 명시적 "아무거나" 답이다.
  assert.deepEqual(THEORY_CHOICES, [
    { id: "stanislavski", label: "스타니슬랍스키", description: "장면에서 무엇을 하려는지부터 봐요" },
    { id: "hagen", label: "우타 하겐", description: "인물과 나 사이의 거리부터 봐요" },
    { id: "meisner", label: "마이즈너", description: "상대에게서 오는 것부터 봐요" },
    { id: "chubbuck", label: "이바나 처벅", description: "목표를 행동으로 옮기는 것부터 봐요" },
    { id: "chekhov", label: "미하일 체홉", description: "몸과 이미지부터 봐요" },
    { id: "none", label: "상관없음", description: "코치가 어울리는 쪽을 골라요" },
  ]);
});
