// /go/<os>/<surface>[/<source>]: 배지 클릭을 Cloudflare 가 센 뒤 스토어로 넘기는 중간 페이지. JS 가 안 돌아도
// 막다른 길이 되지 않게 "바로 이동하기" 링크가 같은 스토어 주소를 갖는다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import "./mount-probe.mjs";

const { cleanup, render, screen } = await import("@testing-library/react");
const goPage = await import("../src/app/go/[os]/[surface]/page.tsx");
const goSourcePage = await import("../src/app/go/[os]/[surface]/[source]/page.tsx");

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

async function renderGo(page, params, search = "") {
  window.history.replaceState(null, "", `/go/${params.os}/${params.surface}${search}`);
  render(await page.default({ params: Promise.resolve(params) }));
  return screen.getByRole("link", { name: "바로 이동하기" });
}

test("아이폰 배지는 App Store 캠페인 링크로, 캠페인 이름에 누른 자리를 싣는다", async () => {
  const link = await renderGo(goPage, { os: "ios", surface: "landing_hero" });

  assert.equal(screen.getByText("스토어로 이동 중이에요.").textContent, "스토어로 이동 중이에요.");
  assert.equal(
    link.getAttribute("href"),
    "https://apps.apple.com/app/apple-store/id6793056855?pt=127135371&ct=acttub_web_landing_hero&mt=8",
  );
});

test("안드로이드 배지는 지금 주소의 UTM 을 Google Play 설치 리퍼러로 넘긴다", async () => {
  const link = await renderGo(
    goSourcePage,
    { os: "android", surface: "app_page", source: "instagram_ad" },
    "?utm_source=instagram&utm_medium=paid_social&fbclid=abc",
  );

  assert.equal(
    link.getAttribute("href"),
    "https://play.google.com/store/apps/details?id=com.acttub.app&referrer=utm_source%3Dinstagram%26utm_medium%3Dpaid_social",
  );
});

test("정적 생성 주소는 두 기기 × 여덟 자리, 출처 칸이 붙으면 × 스무 출처다", () => {
  const plain = goPage.generateStaticParams();
  const withSource = goSourcePage.generateStaticParams();

  assert.equal(plain.length, 16);
  assert.deepEqual(plain[0], { os: "ios", surface: "landing_header" });
  assert.deepEqual(plain.at(-1), { os: "android", surface: "entry_share" });
  assert.equal(withSource.length, 320);
  assert.deepEqual(withSource[1], { os: "ios", surface: "landing_header", source: "naver_ad" });
  assert.equal(goPage.dynamicParams, false);
  assert.equal(goSourcePage.dynamicParams, false);
});
