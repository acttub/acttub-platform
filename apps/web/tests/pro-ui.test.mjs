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


test("요금 안내는 공용 머리를 쓰고, 로고는 게스트도 소개 홈으로 간다", () => {
  render(h(PricingPage));

  const header = document.querySelector("header");
  assert.equal(within(header).getByRole("link", { name: "ACTTUB 홈" }).getAttribute("href"), "/?intro=1");
  assert.equal(within(header).getByRole("link", { name: "요금" }).getAttribute("aria-current"), "page");
});

test("환불정책 상단 바는 Pro 안내로 돌아가는 길을 준다", () => {
  render(h(RefundPage));

  assert.deepEqual(topBarLinks(), [
    ["ACTTUB 홈", "/"],
    ["ACTTUB Pro 구독 안내", "/pricing"],
  ]);
});

test("요금 안내는 무료와 Pro의 차이를 같은 말로 보인다", () => {
  render(h(PricingPage));

  const pro = screen.getByRole("heading", { name: "Pro" }).closest("section");
  assert.match(pro.textContent, /월 3,900원/);
  assert.match(pro.textContent, /발음 보고서 \(Pro 전용 · 준비 중\)/);
  assert.match(pro.textContent, /구독 표시이며 배우의 실력이나 자격을 인증하는 표시는 아니에요\./);
  const table = screen.getByRole("table");
  assert.deepEqual(
    within(table).getByRole("rowheader", { name: "AI 연기 코칭" }).closest("tr").textContent,
    "AI 연기 코칭하루 3회제한 없음",
  );
  assert.equal(within(table).getByRole("rowheader", { name: "리딩 대본 보관" }).closest("tr").textContent, "리딩 대본 보관3개제한 없음");
  // 코칭 고도화 세 가지(상위 모델·습관 기억·자세한 노트)는 Pro 혜택이다.
  assert.match(pro.textContent, /상위 AI 모델로 코칭/);
  assert.match(pro.textContent, /습관을 기억하는 코칭/);
  assert.match(pro.textContent, /더 자세한 코칭 노트/);
  assert.match(pro.textContent, /연습 중 광고 없음/);
});

test("환불정책은 이용한 날짜만큼 빼는 기준과 30일 예시 금액을 보인다", () => {
  render(h(RefundPage));

  const refund = screen.getByRole("heading", { name: "이용한 날짜만큼 빼고 환불해요" }).closest("section");
  assert.equal(within(refund).getByText("결제 후 7일 이내, 유료 기능을 쓰지 않았을 때").tagName, "DT");
  assert.equal(within(refund).getByText("전액 환불").tagName, "DD");
  assert.equal(within(refund).getByText("이용한 날짜만큼 빼고, 남은 금액의 10%를 더 빼고 환불").tagName, "DD");
  assert.equal(within(refund).getByText("이용한 날짜만큼 빼고, 남은 금액의 10%를 더해서 환불 (최대 결제금액까지)").tagName, "DD");
  assert.match(refund.textContent, /이 기준으로 계산한 환불액은 실제 결제금액을 넘지 않아요\./);
  assert.deepEqual(
    ["3,900원", "3,510원", "2,340원", "1,170원"].map((won) => within(refund).getByText(won).tagName),
    ["DD", "DD", "DD", "DD"],
  );

  // 예전 구간별 비율(80·60·40%)은 더 이상 보이지 않는다.
  assert.equal(screen.queryByText("80%"), null);
  assert.equal(screen.queryByText(/이용 시작 후 7일 이내는 100%/), null);
});

test("Pro 구독하기 바로 아래에 해지·환불 기준을 짧게 알리고 환불정책으로 보낸다", () => {
  render(h(PricingPage));

  const pro = screen.getByRole("heading", { name: "Pro" }).closest("section");
  assert.equal(within(pro).getByRole("link", { name: "Pro 구독하기" }).getAttribute("href"), "/pg-review");
  assert.match(pro.textContent, /이용한 뒤에는 이용한 날짜만큼 빼고 환불해요\./);
  assert.equal(screen.getByRole("link", { name: "해지·환불 정책 전문 →" }).getAttribute("href"), "/refund");
});

test("요금 안내는 11월 1일 결제 시작, 앱 연 구독, 고품질 목소리 Pro 혜택을 같은 말로 보인다(SOMA-818)", () => {
  render(h(PricingPage));

  assert.equal(screen.queryByText(/11월 시작을 준비/), null);
  assert.match(screen.getByRole("complementary", { name: "결제 시작 안내" }).textContent, /2026년 11월 1일부터 결제를 시작해요\./);
  const pro = screen.getByRole("heading", { name: "Pro" }).closest("section");
  assert.match(pro.textContent, /연 32,500원\(부가세 포함\) 연 구독/);
  assert.match(pro.textContent, /리딩 고품질 목소리/);
  const table = screen.getByRole("table");
  assert.equal(
    within(table).getByRole("rowheader", { name: "리딩 고품질 목소리" }).closest("tr").textContent,
    "리딩 고품질 목소리10월 31일까지 무료포함",
  );
  assert.equal(screen.queryByText(/딕션/), null);
});

test("환불정책은 앱 결제의 스토어 환불, 앱 전용 연 구독, 탈퇴와 스토어 해지가 별개임을 알린다(SOMA-818)", () => {
  render(h(RefundPage));

  assert.equal(screen.queryByText("판매 시작 전"), null);
  const app = screen.getByRole("heading", { name: "앱에서 결제한 구독은 스토어 절차를 따라요" }).closest("section");
  assert.match(app.textContent, /연 구독은 앱에서만 팔고/);
  assert.match(app.textContent, /회사는 Apple 결제를 직접 환불할 수 없어서/);
  assert.match(app.textContent, /Google Play가 허용하는 범위에서 회사가 처리해요/);
  assert.match(app.textContent, /회원을 탈퇴해도 스토어 구독은 해지되지 않아요/);
  assert.match(screen.getByRole("heading", { name: "자동결제 해지와 즉시 종료는 달라요" }).closest("section").textContent, /결제주기는 결제일부터 1개월\(다음 달 같은 날까지\)이에요\./);
});
