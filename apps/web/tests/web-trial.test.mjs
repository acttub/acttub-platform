// 웹 체험(가입 없이 써 보기, SOMA-834 3차): 체험 주소·들어온 길, 리딩 빠른 시작, 홈 체험 카드, 체험 띠와 앱 이어하기 카드(게스트만),
// 퍼널 이벤트(trial_*), 리딩 완료 화면의 앱 이어하기, 코칭 시작 화면의 질문 예시와 리딩 링크.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";
import { resetNavigation } from "./fixtures/features-next-shims.mjs";

const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { clearTokens, setMemberTokens, setTokens } = await import("../src/lib/auth/token-store.ts");
const { COACHING_TRIAL_PATH, READING_TRIAL_PATH, trialEntryFromSearch, trialHref } = await import("../src/features/trial/trial-paths.ts");
const quick = await import("../src/features/reading/quick-start.ts");
const ga = await import("../src/lib/analytics/ga.ts");
const { HomeTrialCards } = await import("../src/features/trial/home-trial-cards.tsx");
const { TrialBar } = await import("../src/features/trial/trial-bar.tsx");
const { AppHandoff } = await import("../src/features/trial/app-handoff.tsx");
const { CoachingExamples, CoachingIntroHeading, NoVideoReadingLink, COACHING_EXAMPLE_BUBBLES } = await import("../src/features/trial/coaching-intro.tsx");
const { DoneBody } = await import("../src/features/reading/screens/DoneBody.tsx");
const { SITE_NAV } = await import("../src/features/site/site-chrome.tsx");
const { GUEST_DAILY_LIMIT } = await import("../src/features/practice/guest-daily-limit.ts");

const events = [];
beforeEach(() => {
  events.length = 0;
  resetNavigation("/");
  clearTokens();
  window.history.replaceState(null, "", "/");
  window.gtag = (...args) => events.push(args);
  globalThis.window.gtag = window.gtag;
});
afterEach(() => {
  cleanup();
  clearTokens();
  delete window.gtag;
});

const guest = () => {
  clearTokens();
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
};
const member = () => {
  clearTokens();
  setMemberTokens({ access_token: "m-access", refresh_token: "m-refresh" }, { id: "u1", email: "a@b.c", name: "민" }, "kakao");
};
const sent = () => events.map(([, name, params]) => [name, params]);

test("체험 주소는 캠페인 값(UTM)을 그대로 싣고 from 으로 들어온 길을 더한다", () => {
  assert.equal(READING_TRIAL_PATH, "/reading/try");
  assert.equal(COACHING_TRIAL_PATH, "/practice/new");
  assert.equal(
    trialHref(READING_TRIAL_PATH, "home_card", "?utm_source=meta&utm_campaign=reading_a&fbclid=zzz&x=1"),
    "/reading/try?utm_source=meta&utm_campaign=reading_a&from=home_card",
  );
  assert.equal(trialHref(COACHING_TRIAL_PATH, "nav", ""), "/practice/new?from=nav");
  assert.equal(trialEntryFromSearch("?from=home_card&utm_source=meta"), "home_card");
  assert.equal(trialEntryFromSearch("?from=nav"), "nav");
  assert.equal(trialEntryFromSearch("?from=keyword_page"), "keyword_page");
  // 광고·검색 링크는 from 이 없고, 모르는 값도 광고·검색으로 곧장 들어온 것으로 본다.
  assert.equal(trialEntryFromSearch("?utm_source=meta"), "quick_start");
  assert.equal(trialEntryFromSearch("?from=evil"), "quick_start");
});

test("머리 메뉴는 대본 리딩·연기 코칭이 체험으로 가고 순서가 정해져 있다", () => {
  assert.deepEqual(
    SITE_NAV.map((item) => [item.label, item.href]),
    [
      ["대본 리딩", "/reading/try?from=nav"],
      ["연기 코칭", "/practice/new?from=nav"],
      ["챌린지", "/?intro=1#challenge"],
      ["요금", "/pricing"],
      ["블로그", "/blog"],
    ],
  );
});

test("빠른 시작: 배역은 기본 윤서, ?role=taeo 면 태오, 반대 배역 주소를 준다", () => {
  assert.deepEqual([...quick.QUICK_START_ROLES], ["윤서", "태오"]);
  assert.equal(quick.quickStartRoleFromSearch(""), "윤서");
  assert.equal(quick.quickStartRoleFromSearch("?utm_source=meta"), "윤서");
  assert.equal(quick.quickStartRoleFromSearch("?role=taeo"), "태오");
  assert.equal(quick.quickStartRoleFromSearch("?role=태오"), "태오");
  assert.equal(quick.quickStartRoleFromSearch("?role=other"), "윤서");
  assert.equal(quick.otherQuickStartRole("윤서"), "태오");
  assert.equal(quick.quickStartPath("윤서"), "/reading/try");
  assert.equal(quick.quickStartPath("태오"), "/reading/try?role=taeo");
});

const sampleScript = {
  id: "script-sample",
  title: "옥상, 밤",
  roles: ["윤서", "태오"],
  lines: [
    { type: "dialogue", role: "윤서", text: "여기 있을 줄 알았어." },
    { type: "dialogue", role: "태오", text: "어떻게 알았어." },
  ],
  characters: [
    { id: "c-yoon", name: "윤서", voicePreset: null, voice: "F1" },
    { id: "c-teo", name: "태오", voicePreset: null, voice: "M1" },
  ],
  lineIds: ["l-0", "l-1"],
  lastSession: null,
};

test("빠른 시작 회차 요청은 고른 배역 하나, 읽어주기, 전체 구간이고 마이크 여부로 넘김·녹음이 정해진다", () => {
  assert.deepEqual(quick.quickStartRequest(sampleScript, "윤서", true), {
    my_character_ids: ["c-yoon"],
    mode: "read",
    start_line_id: "l-0",
    end_line_id: "l-1",
    advance: "silence",
    record: true,
  });
  const taeoNoMic = quick.quickStartRequest(sampleScript, "태오", false);
  assert.deepEqual([taeoNoMic.my_character_ids, taeoNoMic.advance, taeoNoMic.record], [["c-teo"], "manual", false]);
  assert.equal(quick.quickStartRequest({ ...sampleScript, characters: [] }, "윤서", true), null);
});

function memoryStore(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = String(v)), data };
}

test("예시 대본 준비: 기기에 든 같은 대본이면 서버를 부르지 않는다", async () => {
  const store = memoryStore({ [quick.SAMPLE_SCRIPT_KEY]: "script-sample" });
  const calls = [];
  const importDeps = { getScript: async () => calls.push("getScript"), startImport: async () => calls.push("startImport") };
  const stored = await quick.prepareSampleScript({ importDeps, store, cached: sampleScript });
  assert.equal(stored.id, "script-sample");
  assert.deepEqual(calls, []);
  assert.equal(quick.isSampleScript({ id: "script-sample" }, store), true);
  assert.equal(quick.isSampleScript({ id: "other" }, store), false);
  assert.equal(quick.isSampleScript({ id: "script-sample" }, null), false);
});

const serverDetail = (id) => ({
  id,
  title: "옥상, 밤",
  characters: [
    { id: "c-yoon", name: "윤서", order: 0, voice_preset: null, voice: "F1" },
    { id: "c-teo", name: "태오", order: 1, voice_preset: null, voice: "M1" },
  ],
  lines: [
    { id: "l-0", ordinal: 0, kind: "dialogue", character_id: "c-yoon", text: "여기 있을 줄 알았어." },
    { id: "l-1", ordinal: 1, kind: "dialogue", character_id: "c-teo", text: "어떻게 알았어." },
  ],
  last_session: null,
});

test("예시 대본 준비: 처음이면 예시 글을 서버가 나누게 맡기고 id 를 기억하며, 다음에는 그 id 로 다시 받는다", async () => {
  const store = memoryStore();
  const calls = [];
  const importDeps = {
    startImport: async (body) => {
      calls.push(["startImport", body.source ?? Object.keys(body).sort().join(",")]);
      return { import_id: "import-1", duplicate_script_id: null };
    },
    getImport: async () => ({ id: "import-1", status: "succeeded", progress: { done_lines: 0, total_lines: 0 }, script_id: "script-new", failure: null }),
    wait: async () => {},
    now: () => 0,
    getScript: async (id) => {
      calls.push(["getScript", id]);
      return serverDetail(id);
    },
  };
  const first = await quick.prepareSampleScript({ importDeps, store, cached: null });
  assert.equal(first.id, "script-new");
  assert.equal(store.data[quick.SAMPLE_SCRIPT_KEY], "script-new");
  assert.equal(calls[0][0], "startImport");
  assert.deepEqual(calls.at(-1), ["getScript", "script-new"]);

  calls.length = 0;
  const second = await quick.prepareSampleScript({ importDeps, store, cached: null });
  assert.equal(second.id, "script-new");
  assert.deepEqual(calls, [["getScript", "script-new"]]);
});

test("예시 대본 준비: 이미 같은 대본이 있다는 알림은 실패가 아니라 그 대본을 쓴다", async () => {
  const store = memoryStore();
  const importDeps = {
    startImport: async () => ({ import_id: "import-2", duplicate_script_id: "script-dup" }),
    getImport: async () => {
      throw new Error("폴링하지 않아야 한다");
    },
    wait: async () => {},
    now: () => 0,
    getScript: async (id) => serverDetail(id),
  };
  const stored = await quick.prepareSampleScript({ importDeps, store, cached: null });
  assert.equal(stored.id, "script-dup");
  assert.equal(store.data[quick.SAMPLE_SCRIPT_KEY], "script-dup");
});

test("예시 대본 준비: 서버가 못 나누면 오류로 끝난다", async () => {
  const importDeps = {
    startImport: async () => ({ import_id: "import-3", duplicate_script_id: null }),
    getImport: async () => ({ id: "import-3", status: "failed", progress: { done_lines: 0, total_lines: 0 }, script_id: null, failure: { code: "no_characters" } }),
    wait: async () => {},
    now: () => 0,
    getScript: async (id) => serverDetail(id),
  };
  await assert.rejects(quick.prepareSampleScript({ importDeps, store: memoryStore(), cached: null }), /sample_import_/);
});

test("홈 체험 카드: 리딩은 바로 시작, 코칭은 영상 올리기로 가고 UTM 이 이어진다", () => {
  window.history.replaceState(null, "", "/?utm_source=meta&utm_campaign=trial_a");
  render(react.createElement(HomeTrialCards));
  assert.ok(screen.getByText("상대역 리딩 해 보기"));
  assert.ok(screen.getByText("준비물 없음 · 3분"));
  assert.ok(screen.getByText("예시 대본이 들어 있어요. 상대역은 AI가 읽어요."));
  assert.ok(screen.getByText("연기 질문 받아 보기"));
  assert.ok(screen.getByText("연기 영상 하나"));
  assert.equal(
    screen.getByRole("link", { name: "바로 시작" }).getAttribute("href"),
    "/reading/try?utm_source=meta&utm_campaign=trial_a&from=home_card",
  );
  assert.equal(
    screen.getByRole("link", { name: "영상 올리기" }).getAttribute("href"),
    "/practice/new?utm_source=meta&utm_campaign=trial_a&from=home_card",
  );
  // 앱으로 하려면: 데스크톱은 QR 줄, 휴대폰은 스토어 배지.
  assert.ok(screen.getByText(/앱으로 하려면 휴대폰 카메라로 찍으세요/));
  assert.equal(screen.getAllByRole("img", { name: "앱 설치 QR 코드", hidden: true }).length, 1);
  assert.equal(window.document.querySelectorAll("a[data-app-download-store]").length, 2);
});

test("체험 띠: 게스트에게만 보이고, 앱 받기를 누르면 trial_app_click 이 bar 로 남는다", () => {
  guest();
  render(react.createElement(TrialBar, { feature: "reading" }));
  const bar = screen.getByRole("region", { name: "체험 안내" });
  assert.ok(within(bar).getByText("체험 중"));
  assert.ok(within(bar).getByText(/가입 없이 쓰고 있어요/));
  const link = within(bar).getByRole("link", { name: "앱 받기" });
  assert.equal(link.getAttribute("data-app-download"), "trial_bar");
  fireEvent.click(link);
  assert.deepEqual(sent(), [["trial_app_click", { feature: "reading", surface: "bar", transport_type: "beacon" }]]);
});

test("체험 띠: 회원에게는 그리지 않고, 쓰는 자리가 준 문구와 링크를 보인다", () => {
  member();
  const view = render(react.createElement(TrialBar, { feature: "coaching" }));
  assert.equal(screen.queryByRole("region", { name: "체험 안내" }), null);
  view.unmount();
  guest();
  render(
    react.createElement(TrialBar, {
      feature: "coaching",
      note: `가입 없이 ${GUEST_DAILY_LIMIT}번 받아 볼 수 있어요`,
      action: react.createElement("a", { href: "/reading/try?role=taeo" }, "태오로 읽기"),
    }),
  );
  assert.ok(screen.getByText(`가입 없이 ${GUEST_DAILY_LIMIT}번 받아 볼 수 있어요`, { exact: false }));
  assert.equal(screen.getByRole("link", { name: "태오로 읽기" }).getAttribute("href"), "/reading/try?role=taeo");
});

test("앱 이어하기 카드: 게스트에게만 보이고 서버가 실제로 옮기는 길(앱으로 옮기기)만 안내한다", () => {
  guest();
  render(react.createElement(AppHandoff, { feature: "reading", continueHref: "/reading" }));
  const card = screen.getByRole("region", { name: "앱에서 이어서 하기" });
  assert.ok(within(card).getByText(/내 대본으로 이어서 하려면/));
  assert.ok(within(card).getByText(/「앱으로 옮기기」 코드로 앱에 가져가요/));
  // 설치만 하면 따라간다는 말은 하지 않는다 — 로그인하거나 옮기기 코드를 넣어야 따라간다.
  assert.ok(within(card).getByText("iPhone · Android 무료"));
  assert.equal(within(card).getByRole("link", { name: "오늘 기록 앱으로 옮기기" }).getAttribute("href"), "/transfer");
  assert.equal(within(card).getByRole("link", { name: "웹에서 내 대본 넣기" }).getAttribute("href"), "/reading");
  assert.equal(within(card).getByRole("link", { name: "앱에서 이어서 하기" }).getAttribute("data-app-download"), "trial_done");
  assert.ok(within(card).getByRole("img", { name: "앱 설치 QR 코드" }));
  fireEvent.click(within(card).getByRole("link", { name: "앱에서 이어서 하기" }));
  assert.deepEqual(sent(), [["trial_app_click", { feature: "reading", surface: "done", transport_type: "beacon" }]]);
});

test("앱 이어하기 카드: 회원에게는 없고, 코칭용은 작은 모양에 코칭 문구다", () => {
  member();
  const view = render(react.createElement(AppHandoff, { feature: "reading" }));
  assert.equal(screen.queryByRole("region", { name: "앱에서 이어서 하기" }), null);
  view.unmount();
  guest();
  render(react.createElement(AppHandoff, { feature: "coaching", compact: true }));
  const card = screen.getByRole("region", { name: "앱에서 이어서 하기" });
  assert.ok(within(card).getByText(/영상을 올려 코치와 이야기하는 연습/));
  assert.equal(within(card).queryByRole("link", { name: "웹에서 내 대본 넣기" }), null);
});

const stats = { mode: "read", elapsedMs: 192_000, lineCount: 2, myCharacterNames: ["윤서"], lineResults: [], differentLines: [] };
const doneProps = {
  script: sampleScript,
  stats,
  repeating: false,
  error: null,
  onRepeat() {},
  onChangeSetup() {},
  onNewScript() {},
  onDetail() {},
};

test("리딩 완료: 게스트에게는 앱 이어하기 카드가 있고 회원에게는 없다", () => {
  guest();
  const view = render(react.createElement(DoneBody, doneProps));
  assert.ok(screen.getByRole("region", { name: "앱에서 이어서 하기" }));
  // 기존 완료 내용은 그대로다.
  assert.ok(screen.getByText("리딩을 마쳤어요"));
  assert.ok(screen.getByText("읽은 대사"));
  view.unmount();
  member();
  render(react.createElement(DoneBody, doneProps));
  assert.equal(screen.queryByRole("region", { name: "앱에서 이어서 하기" }), null);
  assert.ok(screen.getByText("리딩을 마쳤어요"));
});

test("코칭 시작 화면 안내: 제목, 질문 예시 셋과 예시라는 표시, 영상이 없으면 리딩으로 가는 링크", () => {
  window.history.replaceState(null, "", "/practice/new?utm_source=meta");
  render(
    react.createElement(
      "div",
      null,
      react.createElement(CoachingIntroHeading),
      react.createElement(CoachingExamples),
      react.createElement(NoVideoReadingLink),
    ),
  );
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "연기 영상을 올리면코치가 보고 물어봐요");
  const examples = screen.getByRole("region", { name: "이런 질문을 받아요" });
  assert.equal(within(examples).getAllByRole("listitem").length, 3);
  assert.deepEqual(
    within(examples).getAllByRole("listitem").map((li) => li.textContent),
    COACHING_EXAMPLE_BUBBLES.map((b) => b.text),
  );
  assert.ok(within(examples).getByText("실제 앱 대화를 옮긴 예시예요."));
  assert.equal(
    screen.getByRole("link", { name: "상대역 리딩부터 해 보기" }).getAttribute("href"),
    "/reading/try?utm_source=meta&from=coaching_link",
  );
});

test("체험 이벤트는 정해진 이름과 파라미터만 싣는다", () => {
  ga.trackTrialStart("reading", "quick_start");
  ga.trackTrialStart("coaching", "home_card");
  ga.trackTrialFirstPartnerLine();
  ga.trackTrialComplete("reading");
  ga.trackTrialComplete("coaching");
  ga.trackTrialAppClick("coaching", "home");
  assert.deepEqual(sent(), [
    ["trial_start", { feature: "reading", entry: "quick_start", transport_type: "beacon" }],
    ["trial_start", { feature: "coaching", entry: "home_card", transport_type: "beacon" }],
    ["trial_first_partner_line", { feature: "reading", transport_type: "beacon" }],
    ["trial_complete", { feature: "reading", transport_type: "beacon" }],
    ["trial_complete", { feature: "coaching", transport_type: "beacon" }],
    ["trial_app_click", { feature: "coaching", surface: "home", transport_type: "beacon" }],
  ]);
});

test("태그가 아직 없으면(동의 흐름 전) 오류 없이 지나가고 바로 보내지 않는다", () => {
  delete window.gtag;
  delete globalThis.window.gtag;
  assert.doesNotThrow(() => {
    ga.trackTrialStart("reading", "nav");
    ga.trackTrialComplete("coaching");
  });
  assert.deepEqual(events, []);
});

test("리딩으로 가는 사이트 링크는 일반 문서 이동으로 열어 교차 출처 격리를 받는다", async () => {
  const { needsDocumentNavigation } = await import("../src/features/site/site-link.tsx");
  assert.equal(needsDocumentNavigation("/reading/try?from=nav"), true);
  assert.equal(needsDocumentNavigation("/reading"), true);
  assert.equal(needsDocumentNavigation({ pathname: "/reading/run" }), true);
  assert.equal(needsDocumentNavigation("/practice/new?from=nav"), false);
  assert.equal(needsDocumentNavigation("/readings"), false);
});
