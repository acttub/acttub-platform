// Pro 구독 안내(/pricing)와 해지·환불정책(/refund)이 함께 쓰는 조각. 두 페이지를 실제로 그려 상단 바가 어디로
// 돌아가는지, 그림 조각이 옆 문구가 약속하는 것과 같은 말을 하는지 본다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";
import "./fixtures/features-next-shims.mjs";

const { cleanup, render, screen, within } = await import("@testing-library/react");
const { default: PricingPage } = await import("../src/app/pricing/page.tsx");
const { default: RefundPage } = await import("../src/app/refund/page.tsx");

const h = react.createElement;

afterEach(cleanup);

/** 상단 바(첫 header)의 링크들: [접근 가능한 이름, 주소]. */
function topBarLinks() {
  const header = document.querySelector("header");
  return within(header).getAllByRole("link").map((link) => [link.getAttribute("aria-label") ?? link.textContent, link.getAttribute("href")]);
}

/** 그 문구를 머리말로 단 구역 전체. */
const sectionOf = (kicker) => screen.getByText(kicker).closest("section");

test("Pro 안내 상단 바는 로고와 「ACTTUB 홈」 둘 다 홈으로 돌아간다", () => {
  render(h(PricingPage));

  assert.deepEqual(topBarLinks(), [
    ["ACTTUB 홈", "/"],
    ["ACTTUB 홈", "/"],
  ]);
  assert.equal(within(document.querySelector("header")).getByRole("img", { name: "Acttub" }).tagName, "IMG");
});

test("환불정책 상단 바는 Pro 안내로 돌아가는 길을 준다", () => {
  render(h(RefundPage));

  assert.deepEqual(topBarLinks(), [
    ["ACTTUB 홈", "/"],
    ["ACTTUB Pro 구독 안내", "/pricing"],
  ]);
});

test("Pro 안내의 그림 조각은 옆 문구가 약속하는 것과 같은 말을 한다", () => {
  render(h(PricingPage));

  // 코칭 장면은 히어로와 코칭 구역 두 곳에 같은 대화를 보인다.
  assert.equal(screen.getAllByText("그때 인물은 무엇을 기다리고 있었나요?").length, 2);
  assert.equal(screen.getAllByText("질문 04 / 07").length, 2);

  // 리딩: 대본 개수 제한 없음, 발음·딕션 피드백은 Pro 전용으로 준비 중.
  const reading = sectionOf("Pro · 리딩");
  assert.equal(within(reading).getByText(/이 기능은 Pro 전용으로 준비 중이에요\./).tagName, "P");
  assert.equal(within(reading).getByText("개수 제한 없음").tagName, "SPAN");
  assert.equal(within(reading).getByText("발음·딕션 피드백").tagName, "P");
  assert.equal(within(reading).getByText("Pro 전용 · 준비 중").tagName, "SPAN");
  assert.equal(within(reading).getAllByText("반복 연습").length, 3);

  // 챌린지: 참여작과 댓글 두 자리에 Pro 배지.
  const badge = sectionOf("Pro · 챌린지");
  assert.equal(within(badge).getByText("챌린지 참여작").tagName, "P");
  assert.equal(within(badge).getByText("댓글").tagName, "P");
  assert.equal(within(badge).getAllByText("PRO").length, 2);
});
