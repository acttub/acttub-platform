// reading.memorization 글자 대조 — 한쪽이나 양쪽이 비었을 때.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { compare, similarity } = await import("../src/lib/reading/quiz/match.ts");

test("reading.match: 말한 것이 비어 있으면 원문과 하나도 닮지 않은 것으로 본다", () => {
  assert.equal(similarity("", "가나"), 0);
  assert.equal(similarity("...", "가나"), 0);
});

test("reading.match: 원문이 괄호 지문뿐이면 무엇을 말해도 닮지 않은 것으로 본다", () => {
  assert.equal(similarity("가나", "(웃으며)"), 0);
});

test("reading.match: 양쪽이 모두 비면 같은 것으로 본다", () => {
  assert.equal(similarity("(한숨)", "…"), 1);
});

test("reading.match: 문장부호만 말한 것은 대조하지 않고 미달로 돌려준다", () => {
  assert.deepEqual(compare("?!", "(한숨)"), { pass: false, closeness: 0 });
});

test("reading.match: 자모 14개 중 3개가 다르면 통과하고 4개가 다르면 미달이다", () => {
  assert.deepEqual(compare("가나다라마바사", "가나다라마바사"), { pass: true, closeness: 1 });
  const three = compare("가나다라머버서", "가나다라마바사");
  assert.equal(three.pass, true);
  assert.equal(Math.round(three.closeness * 1000) / 1000, 0.786);
  const four = compare("가나더라머버서", "가나다라마바사");
  assert.equal(four.pass, false);
  assert.equal(Math.round(four.closeness * 1000) / 1000, 0.714);
});

test("reading.match: 문장부호·말줄임표와 ㅋㅋ·ㅎㅎ 같은 낱자모 추임새는 대조에서 뺀다(SOMA-646)", () => {
  assert.equal(compare("진짜", "ㅋㅋㅋㅋ 진짜?!").pass, true);
  assert.equal(compare("고마워", "ㅎㅎ 고마워...").pass, true);
  assert.deepEqual(compare("ㅠㅠ", "여기"), { pass: false, closeness: 0 });
});
