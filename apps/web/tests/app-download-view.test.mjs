// /app 랜딩(인스타그램 프로필·검색광고가 가리키는 주소). 첫 화면의 리딩 시연이 저절로 돌고,
// 움직임 줄이기 설정이면 멈춰서 대사가 펼쳐진 장면을 보여 준다. 스크롤 아래 시연은 화면에
// 들어올 때만 돈다. 화면을 실제로 그려서 사용자가 보는 글자와 링크로 확인한다.
import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, mock, test } from "node:test";

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

const { act, cleanup, fireEvent, render, screen, within } = await import(
  "@testing-library/react"
);
const { default: AppDownloadView } = await import("../src/app/app/app-download-view.tsx");
const { default: AppDownloadPage, metadata: appPageMetadata } = await import(
  "../src/app/app/page.tsx"
);

/** 화면에 들어오고 나가는 것을 테스트가 직접 알린다. */
class FakeIntersectionObserver {
  static all = [];
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    FakeIntersectionObserver.all.push(this);
  }
  observe(target) {
    this.targets.push(target);
  }
  disconnect() {
    this.targets = [];
  }
}

function intersect(element, isIntersecting) {
  act(() => {
    for (const observer of FakeIntersectionObserver.all) {
      if (observer.targets.includes(element)) {
        observer.callback([{ target: element, isIntersecting }]);
      }
    }
  });
}

let reduceMotion = false;
let spoken;

beforeEach(() => {
  reduceMotion = false;
  spoken = [];
  FakeIntersectionObserver.all = [];
  globalThis.IntersectionObserver = FakeIntersectionObserver;
  window.matchMedia = (query) => ({
    matches: query === "(prefers-reduced-motion: reduce)" && reduceMotion,
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  window.speechSynthesis = {
    cancel: () => spoken.push("cancel"),
    speak: (utterance) => spoken.push(`${utterance.lang}:${utterance.text}`),
  };
  mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  window.setInterval = globalThis.setInterval;
  window.clearInterval = globalThis.clearInterval;
  window.setTimeout = globalThis.setTimeout;
  window.clearTimeout = globalThis.clearTimeout;
  Object.defineProperty(window.document, "hidden", { configurable: true, value: false });
});

afterEach(() => {
  cleanup();
  mock.timers.reset();
  delete globalThis.IntersectionObserver;
  delete window.speechSynthesis;
});

function tick(ms) {
  act(() => mock.timers.tick(ms));
}

function demo() {
  return within(screen.getByLabelText("대본 리딩 시연"));
}

test("첫 화면은 제목과 두 스토어 배지, 로그인 링크를 보여 준다", () => {
  render(react.createElement(AppDownloadView));

  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "혼자여도,대사는 오가요.");
  assert.equal(screen.getByRole("link", { name: "Acttub 홈" }).getAttribute("href"), "/");
  assert.equal(
    screen.getByRole("link", { name: "로그인" }).getAttribute("href"),
    "/login",
  );
  assert.deepEqual(
    screen
      .getAllByRole("link", { name: "App Store에서 다운로드" })
      .map((link) => link.getAttribute("href")),
    ["/go/ios/app_page", "/go/ios/app_page"],
  );
  assert.deepEqual(
    screen
      .getAllByRole("link", { name: "Google Play에서 다운로드" })
      .map((link) => link.getAttribute("href")),
    ["/go/android/app_page", "/go/android/app_page"],
  );
  assert.equal(screen.queryByRole("link", { name: /웹에서/ }), null);
  assert.deepEqual(
    screen.getAllByRole("link", { name: "안전 약속" }).map((link) => link.getAttribute("href")),
    ["/terms", "/terms"],
  );
  assert.equal(
    screen.getByRole("link", { name: "인스타그램" }).getAttribute("href"),
    "https://www.instagram.com/acttub_com/",
  );
  assert.deepEqual(
    screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    [
      "대본을 넣어요.",
      "상대와 맞춰 봐요.",
      "찍고 돌아봐요.",
      "독백",
      "입시 자유연기",
      "오디션·셀프테이프",
      "대사 외우기",
    ],
  );
});

test("리딩 시연은 1.8초마다 장면을 넘기고, 넷째 장면에서 다음 대사로 넘어간다", () => {
  render(react.createElement(AppDownloadView));
  const view = demo();

  assert.equal(view.getByText("자동 시연").textContent, "자동 시연");
  assert.equal(view.getByText("01 · 상대 대사를 들어요").textContent, "01 · 상대 대사를 들어요");
  assert.equal(view.getByText("잠시 뒤 내 차례예요").textContent, "잠시 뒤 내 차례예요");

  tick(1800);
  assert.equal(view.getByText("02 · 내 대사를 가려요").textContent, "02 · 내 대사를 가려요");
  tick(1800);
  assert.equal(view.getByText("03 · 막히면 펼쳐 봐요").textContent, "03 · 막히면 펼쳐 봐요");
  assert.equal(view.getByRole("button", { name: /내 대사를 가리고/ }).getAttribute("aria-expanded"), "true");
  assert.equal(view.getByText("왜 이제야 왔어?").textContent, "왜 이제야 왔어?");
  tick(1800);
  assert.equal(view.getByText("04 · 다음 대사를 들어요").textContent, "04 · 다음 대사를 들어요");
  assert.equal(view.getByText("그럼 왜 돌아온 건데?").textContent, "그럼 왜 돌아온 건데?");
});

test("탭이 가려져 있는 동안에는 시연이 넘어가지 않는다", () => {
  render(react.createElement(AppDownloadView));
  Object.defineProperty(window.document, "hidden", { configurable: true, value: true });

  tick(1800 * 3);

  assert.equal(demo().getByText("01 · 상대 대사를 들어요").textContent, "01 · 상대 대사를 들어요");
});

test("멈추기를 누르면 직접 조작으로 바뀌고, 가린 대사를 눌러 펼치고 다시 가린다", () => {
  render(react.createElement(AppDownloadView));
  const view = demo();

  fireEvent.click(view.getByRole("button", { name: "Ⅱ 시연 멈추기" }));
  assert.equal(view.getByText("직접 조작 중").textContent, "직접 조작 중");
  tick(1800 * 2);
  assert.equal(view.getByText("01 · 상대 대사를 들어요").textContent, "01 · 상대 대사를 들어요");

  const hidden = view.getByRole("button", { name: /내 대사를 가리고/ });
  fireEvent.click(hidden);
  assert.equal(hidden.getAttribute("aria-expanded"), "true");
  assert.equal(view.getByText("확인하고 다시 말해 봐요").textContent, "확인하고 다시 말해 봐요");

  fireEvent.click(hidden);
  assert.equal(hidden.getAttribute("aria-expanded"), "false");
  assert.equal(view.getByText("02 · 내 대사를 가려요").textContent, "02 · 내 대사를 가려요");

  fireEvent.click(view.getByRole("button", { name: "▶ 시연 이어 보기" }));
  assert.equal(view.getByText("자동 시연").textContent, "자동 시연");
});

test("상대 대사 듣기는 시연을 멈추고 지금 장면의 상대 대사를 한국어로 읽는다", () => {
  render(react.createElement(AppDownloadView));
  const view = demo();
  tick(1800 * 3);

  fireEvent.click(view.getByRole("button", { name: "상대 대사 듣기 ↗" }));

  assert.deepEqual(spoken, ["cancel", "ko-KR:그럼 왜 돌아온 건데?"]);
  assert.equal(view.getByText("직접 조작 중").textContent, "직접 조작 중");
  assert.equal(view.getByText("01 · 상대 대사를 들어요").textContent, "01 · 상대 대사를 들어요");
});

test("음성 합성이 없는 브라우저에서도 듣기를 누르면 장면만 바뀌고 멈추지 않는다", () => {
  delete window.speechSynthesis;
  render(react.createElement(AppDownloadView));
  const view = demo();
  tick(1800);

  fireEvent.click(view.getByRole("button", { name: "상대 대사 듣기 ↗" }));

  assert.deepEqual(spoken, []);
  assert.equal(view.getByText("01 · 상대 대사를 들어요").textContent, "01 · 상대 대사를 들어요");
});

test("움직임 줄이기면 자동 재생 없이 대사가 펼쳐진 장면에서 시작하고, 버튼으로 한 장면씩 넘긴다", () => {
  reduceMotion = true;
  render(react.createElement(AppDownloadView));
  const view = demo();

  assert.equal(view.getByText("리딩 시연").textContent, "리딩 시연");
  assert.equal(view.getByText("03 · 막히면 펼쳐 봐요").textContent, "03 · 막히면 펼쳐 봐요");
  tick(1800 * 2);
  assert.equal(view.getByText("03 · 막히면 펼쳐 봐요").textContent, "03 · 막히면 펼쳐 봐요");

  fireEvent.click(view.getByRole("button", { name: "다음 장면 보기" }));
  assert.equal(view.getByText("04 · 다음 대사를 들어요").textContent, "04 · 다음 대사를 들어요");

  // 스크롤 아래 두 시연도 움직이지 않고 마지막 모습으로 서 있다.
  assert.equal(screen.getByText("내 대사를 펼쳐 봐요").textContent, "내 대사를 펼쳐 봐요");
  assert.equal(screen.getByText("코치와 이야기해요 · 시연").textContent, "코치와 이야기해요 · 시연");
});

test("대본 예시는 화면에 들어온 동안에만 한 칸씩 넘어간다", () => {
  render(react.createElement(AppDownloadView));
  const reel = screen.getByText("대본 예시 · 내 역할: 지우").closest("div").parentElement;
  const caption = () => reel.firstElementChild.lastElementChild.textContent;

  tick(1600 * 2);
  assert.equal(caption(), "상대 대사를 읽고 있어요");

  intersect(reel, true);
  tick(1600 * 2);
  assert.equal(caption(), "내 대사를 가려요");
  tick(1600);
  assert.equal(caption(), "내 대사를 펼쳐 봐요");

  intersect(reel, false);
  tick(1600 * 3);
  assert.equal(caption(), "내 대사를 펼쳐 봐요");
});

test("코치 시연은 화면에 들어오면 영상을 올리고 말풍선을 이어 띄우며, 다시 보기로 처음부터 돈다", () => {
  render(react.createElement(AppDownloadView));
  const coach = screen.getByText("내 연습 영상").closest(".adl-coach");

  assert.equal(within(coach).getByText("영상을 올려요 · 시연").textContent, "영상을 올려요 · 시연");

  intersect(coach, true);
  tick(850);
  assert.equal(within(coach).getByText("코치와 이야기해요 · 시연").textContent, "코치와 이야기해요 · 시연");

  fireEvent.click(within(coach).getByRole("button", { name: "↻ 대화 다시 보기" }));
  tick(0);
  assert.equal(within(coach).getByText("영상을 올려요 · 시연").textContent, "영상을 올려요 · 시연");
  tick(850);
  assert.equal(within(coach).getByText("코치와 이야기해요 · 시연").textContent, "코치와 이야기해요 · 시연");
});

test("아래 고정 바는 첫 화면과 마지막 다운로드 구역이 둘 다 안 보일 때만 누를 수 있다", () => {
  render(react.createElement(AppDownloadView));
  const hero = window.document.getElementById("adl-hero");
  const end = window.document.getElementById("download");
  const start = () => screen.getByText("무료로 시작해요 ↗", { selector: "a" });

  assert.equal(start().getAttribute("tabindex"), "-1");
  assert.equal(start().parentElement.getAttribute("aria-hidden"), "true");

  intersect(hero, false);
  assert.equal(start().getAttribute("tabindex"), "0");
  assert.equal(start().parentElement.getAttribute("aria-hidden"), "false");
  assert.equal(start().getAttribute("href"), "#download");

  intersect(end, true);
  assert.equal(start().getAttribute("tabindex"), "-1");
});

test("주소의 UTM 이 바뀌면(뒤로 가기) 배지가 새 출처 칸과 캠페인으로 다시 걸린다", () => {
  render(react.createElement(AppDownloadView));

  act(() => {
    window.history.pushState(null, "", "/app?utm_source=instagram&utm_medium=paid_social");
    window.dispatchEvent(new window.PopStateEvent("popstate"));
  });

  assert.deepEqual(
    screen
      .getAllByRole("link", { name: "App Store에서 다운로드" })
      .map((link) => link.getAttribute("href")),
    [
      "/go/ios/app_page/instagram_ad?utm_source=instagram&utm_medium=paid_social",
      "/go/ios/app_page/instagram_ad?utm_source=instagram&utm_medium=paid_social",
    ],
  );
  window.history.replaceState(null, "", "/");
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
