// /app 랜딩(인스타그램 프로필·검색광고가 가리키는 주소). 사진·앱 화면 없이 글과 QR만 두는 구조다.
// 화면을 실제로 그려서 사용자가 보는 글자와 링크로 확인한다.
import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";

const pngModule = `data:text/javascript,${encodeURIComponent(
  'export default { src: "/_next/static/media/acttub-wordmark.png", width: 240, height: 48 };',
)}`;
const emptyModule = "data:text/javascript,export default {};";

// next/link·next/image 는 CJS 라 Node ESM 에서 default 가 한 겹 더 싸여 온다. 컴포넌트만 꺼내 준다.
const require = createRequire(import.meta.url);
function unwrapDefault(specifier) {
  const file = pathToFileURL(require.resolve(`${specifier}.js`)).href;
  return `data:text/javascript,${encodeURIComponent(
    `import m from ${JSON.stringify(file)}; export default m.default;`,
  )}`;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/link" || specifier === "next/image") {
      return { url: unwrapDefault(specifier), shortCircuit: true };
    }
    if (specifier.endsWith(".png")) return { url: pngModule, shortCircuit: true };
    if (specifier.endsWith(".css")) return { url: emptyModule, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// next/link 의 프리페치 경로가 브라우저 전역 self 를 읽는다.
globalThis.self = globalThis;

const { act, cleanup, render, screen } = await import(
  "@testing-library/react"
);
const { default: AppDownloadView } = await import("../src/app/app/app-download-view.tsx");
const { default: AppDownloadPage, metadata: appPageMetadata } = await import(
  "../src/app/app/page.tsx"
);


afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const hrefs = (links) => links.map((link) => link.getAttribute("href"));

test("첫 화면은 앱 아이콘·제목·QR 카드·두 스토어 배지를 보여 준다", () => {
  render(react.createElement(AppDownloadView));

  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "혼자 하는 연기 연습,앱에서 매일 이어 가요");
  assert.equal(screen.getByAltText("액터브 앱 아이콘").getAttribute("src") !== null, true);
  assert.ok(screen.getByText("액터브 · iPhone · Android 무료"));
  assert.ok(screen.getByText("상대역은 AI가 읽어 주고, 연기 영상은 코치가 보고 물어봐요."));
  assert.ok(screen.getByText("휴대폰 카메라로 찍으세요"));
  assert.ok(screen.getByText("설치 화면으로 바로 가요"));
  assert.ok(screen.getByAltText("앱 설치 QR 코드"));
  assert.deepEqual(hrefs(screen.getAllByRole("link", { name: "App Store에서 다운로드" })), ["/go/ios/app_page"]);
  assert.deepEqual(hrefs(screen.getAllByRole("link", { name: "Google Play에서 다운로드" })), ["/go/android/app_page"]);
});

test("공용 사이트 머리와 바닥을 쓰고 예전 시연·단계 블록은 없다", () => {
  render(react.createElement(AppDownloadView));

  assert.equal(screen.getByRole("link", { name: "ACTTUB 홈" }).getAttribute("href"), "/?intro=1");
  assert.ok(screen.getByRole("navigation", { name: "주요 메뉴" }));
  assert.ok(screen.getByRole("link", { name: "해지·환불 정책" }));
  assert.equal(screen.queryByText(/자동 시연|상대 대사 듣기|무료로 시작해요/), null);
  assert.equal(screen.queryAllByRole("heading", { level: 3 }).length, 0);
});

test("폰에서는 앱 받기 버튼 하나가 app_page 귀속 표식을 달고 있다", () => {
  render(react.createElement(AppDownloadView));

  const button = screen
    .getAllByRole("link", { name: "앱 받기" })
    .find((link) => link.getAttribute("data-app-download") === "app_page");
  assert.ok(button);
  assert.equal(button.getAttribute("href"), "/app");
});

test("체험 링크는 리딩·코칭으로 from=app_page 와 함께 간다", () => {
  render(react.createElement(AppDownloadView));

  assert.equal(
    screen.getByRole("link", { name: "웹에서 리딩 해 보기" }).getAttribute("href"),
    "/reading/try?from=app_page",
  );
  assert.deepEqual(hrefs(screen.getAllByRole("link", { name: "웹에서 먼저 해 보기" })), [
    "/reading/try?from=app_page",
    "/reading/try?from=app_page",
    "/practice/new?from=app_page",
  ]);
});

test("세 칸 소개와 무료 안내 한 줄이 있다", () => {
  render(react.createElement(AppDownloadView));

  assert.deepEqual(
    screen.getAllByRole("heading", { level: 2 }).filter((h) => /AI가 읽고|영상을 올리면|같은 대사를/.test(h.textContent)).length,
    3,
  );
  for (const kicker of ["대본 리딩", "연기 코칭", "대사 챌린지"]) {
    assert.ok(screen.getAllByText(kicker).length >= 1);
  }
  assert.ok(screen.getByText("무료로 쓸 수 있나요?"));
  assert.ok(screen.getByText(/더 쓰려면 Pro\(월 3,900원\)가 있어요/));
});

test("주소의 UTM 이 바뀌면(뒤로 가기) 배지와 체험 링크가 새 캠페인으로 다시 걸린다", () => {
  render(react.createElement(AppDownloadView));

  act(() => {
    window.history.pushState(null, "", "/app?utm_source=instagram&utm_medium=paid_social");
    window.dispatchEvent(new window.PopStateEvent("popstate"));
  });

  assert.deepEqual(hrefs(screen.getAllByRole("link", { name: "App Store에서 다운로드" })), [
    "/go/ios/app_page/instagram_ad?utm_source=instagram&utm_medium=paid_social",
  ]);
  assert.equal(
    screen.getByRole("link", { name: "웹에서 리딩 해 보기" }).getAttribute("href"),
    "/reading/try?utm_source=instagram&utm_medium=paid_social&from=app_page",
  );
});

test("/app 페이지는 앱과 운영사 구조화 데이터를 싣고 주소를 /app 으로 알린다", () => {
  const { container } = render(react.createElement(AppDownloadPage));

  const types = [...container.querySelectorAll('script[type="application/ld+json"]')].map(
    (script) => JSON.parse(script.textContent)["@type"],
  );
  assert.deepEqual(types, ["MobileApplication", "MobileApplication", "Organization"]);
  assert.equal(appPageMetadata.alternates.canonical, "/app");
  assert.equal(appPageMetadata.title, "AI 연기 코칭 앱 액터브 — iOS·Android 무료");
});
