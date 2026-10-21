// practice.note: 연습 노트 화면(PracticeReportCards)이 노트 갈래마다 무엇을 보이는가.
// 신형 노트의 순서·인용·폴백은 practice-note-v2.test.mjs 가 맡고, 여기서는 기존 갈래(분석·표현) 카드와
// 신형 노트의 빈 자리, 알 수 없는 응답을 본다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";

const { cleanup, render, screen, within } = await import("@testing-library/react");
const { PracticeReportCards } = await import("../src/features/practice/practice-report-cards.tsx");

afterEach(cleanup);

const draw = (report, groupTitle) =>
  render(react.createElement(PracticeReportCards, { report, groupTitle }));

/** 카드 제목(h3) 순서. 화면이 무엇을 어떤 순서로 보이는지가 여기 드러난다. */
const cardTitles = () => screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent);

/** 제목이 붙은 카드의 본문 글자. */
function cardBody(title) {
  const card = screen.getByRole("heading", { level: 3, name: title }).closest("article");
  assert.ok(card, title);
  return card;
}

function expressionReport(overrides = {}) {
  return {
    report_type: "expression",
    title: "붙잡는 마지막 대사",
    blocked_point: "마지막 대사에서 목소리가 작아져요",
    expression_core: "떠나는 사람을 붙잡는 힘",
    line_meaning: "가지 말라는 부탁",
    timing_reason: "상대가 문을 여는 순간",
    playable_action: "상대의 소매를 잡듯 말하기",
    effective_experiment: { instruction: "한 발 다가서며 말해 보기", tested: true },
    observed_change: "목소리가 끝까지 남았어요",
    next_take: "문 쪽으로 몸을 돌린 채 말해 보기",
    acting_trap: "울먹이기",
    actor_training: {
      title: "끝음 붙잡기",
      purpose: "말끝까지 숨을 남긴다",
      duration_minutes: 5,
      steps: ["숨을 크게 들이마신다", "  ", "마지막 음절을 길게 끈다"],
      focus: "배에 힘을 둔다",
      success_check: "끝음이 들린다",
      tested: false,
    },
    evidence: ["마지막 대사에서 시선이 내려갔다"],
    actor_words: ["붙잡고 싶었어요"],
    uncertainties: ["상대 배우의 반응은 영상에 없다"],
    source_handoff_ids: { analysis: null, expression: "h-2" },
    ...overrides,
  };
}

function analysisReport(overrides = {}) {
  return {
    report_type: "analysis",
    title: "기다리는 장면",
    actor_discovery: "상대를 기다리고 있었어요",
    line_meaning: "붙잡는 말",
    timing_reason: "떠나려는 순간",
    target_effect: "다시 앉게 하기",
    next_take: { direction: "문장을 짧게 끊어보기", tested: false },
    acting_caution: "서두르지 않기",
    evidence: ["마지막 대사", ""],
    uncertainties: [],
    source_handoff_id: "h-1",
    ...overrides,
  };
}

function noteV2(overrides = {}) {
  return {
    id: "n-1",
    format: "v2",
    kind: "action",
    title: "말끝이 흐려지는 순간",
    summary_quotes: [{ quote: "붙잡고 싶었어요", kind: "actor", source_ref: "actor-1" }],
    next_take: "말끝을 짧게 끊고 한 번 더 찍어 보기",
    actor_words: [],
    corrections: [],
    tags: [],
    fallback: false,
    report: null,
    source_revision: 9,
    created_at: "2026-09-21T03:00:00Z",
    ...overrides,
  };
}

test("표현 갈래 노트는 막힌 순간부터 열어 둔 부분까지 카드 순서대로 보인다", () => {
  draw(expressionReport());

  assert.equal(screen.getByRole("heading", { level: 2 }).textContent, "붙잡는 마지막 대사");
  assert.deepEqual(cardTitles(), [
    "막힌 순간",
    "표현의 중심",
    "이 말이 향하는 뜻",
    "그 순간에 나온 이유",
    "바로 해볼 행동",
    "직접 확인한 시도",
    "해보며 달라진 점",
    "다음 장면에서 해볼 것",
    "연습 방법 · 끝음 붙잡기",
    "장면에서 확인한 근거",
    "배우가 직접 남긴 말",
    "아직 열어 둔 부분",
  ]);
  assert.match(cardBody("직접 확인한 시도").textContent, /한 발 다가서며 말해 보기/);
  // 배우가 남긴 말은 인용이 아니라 항목 점으로 늘어놓는다. 근거는 인용으로 둔다.
  assert.equal(within(cardBody("배우가 직접 남긴 말")).getByRole("listitem").textContent, "· 붙잡고 싶었어요");
  assert.equal(within(cardBody("장면에서 확인한 근거")).getByRole("listitem").textContent, "마지막 대사에서 시선이 내려갔다");
});

test("표현 갈래의 연습 방법은 걸리는 시간과 빈 줄을 뺀 단계, 해보지 않은 제안 표시를 함께 보인다", () => {
  draw(expressionReport());

  const training = cardBody("연습 방법 · 끝음 붙잡기");
  assert.match(training.textContent, /5분/);
  assert.match(training.textContent, /아직 해보지 않은 제안/);
  assert.deepEqual(within(training).getAllByRole("listitem").map((item) => item.textContent), [
    "· 말끝까지 숨을 남긴다",
    "· 숨을 크게 들이마신다",
    "· 마지막 음절을 길게 끈다",
    "· 배에 힘을 둔다",
    "· 끝음이 들린다",
  ]);
});

test("연습 방법이 제목만 있으면 단계 목록 없이 제목과 시간만, 둘 다 비면 카드째 뺀다", () => {
  const emptyTraining = { title: "", purpose: "", duration_minutes: 3, steps: [" "], focus: "", success_check: "", tested: false };

  draw(expressionReport({ actor_training: { ...emptyTraining, title: "호흡 고르기" } }));
  const training = cardBody("연습 방법 · 호흡 고르기");
  assert.match(training.textContent, /3분/);
  assert.equal(within(training).queryByRole("list"), null);
  cleanup();

  draw(expressionReport({ actor_training: emptyTraining }));
  assert.equal(cardTitles().some((title) => title.startsWith("연습 방법")), false);
  assert.equal(cardTitles().includes("다음 장면에서 해볼 것"), true);
});

test("표현 갈래에서 비어 있는 칸과 공백뿐인 목록은 카드를 만들지 않는다", () => {
  draw(expressionReport({ observed_change: "   ", actor_words: ["", "  "], uncertainties: [] }));

  const titles = cardTitles();
  assert.equal(titles.includes("해보며 달라진 점"), false);
  assert.equal(titles.includes("배우가 직접 남긴 말"), false);
  assert.equal(titles.includes("아직 열어 둔 부분"), false);
  assert.equal(titles.includes("표현의 중심"), true);
  assert.equal(titles.includes("장면에서 확인한 근거"), true);
});

test("분석 갈래 노트는 배우의 발견부터 보이고, 다음 장면 제안에는 아직 해보지 않았다고 붙인다", () => {
  draw(analysisReport());

  assert.equal(screen.getByRole("heading", { level: 2 }).textContent, "기다리는 장면");
  assert.deepEqual(cardTitles(), [
    "배우가 발견한 것",
    "이 말이 향하는 뜻",
    "그 순간에 나온 이유",
    "상대에게 만들려는 변화",
    "다음 장면에서 해볼 것",
    "장면에서 확인한 근거",
  ]);
  assert.match(cardBody("다음 장면에서 해볼 것").textContent, /아직 해보지 않은 제안/);
  assert.doesNotMatch(cardBody("배우가 발견한 것").textContent, /아직 해보지 않은 제안/);
  assert.deepEqual(
    within(cardBody("장면에서 확인한 근거")).getAllByRole("listitem").map((item) => item.textContent),
    ["마지막 대사"],
  );
});

test("기존 갈래 표현 노트가 신형 봉투에 담겨 와도 표현 카드로 그린다", () => {
  draw(noteV2({ format: "legacy", kind: "expression", title: "봉투 제목", summary_quotes: [], report: expressionReport() }));

  assert.equal(screen.getByRole("heading", { level: 2 }).textContent, "붙잡는 마지막 대사");
  assert.equal(cardTitles()[0], "막힌 순간");
  assert.equal(screen.queryByText("이번 대화 요약"), null);
});

test("신형 노트에 인용이 없으면 그 자리에 그대로 남겼다고 말하고, 배우 문장이 있으면 따로 보인다", () => {
  draw(noteV2({ summary_quotes: [{ quote: "  ", kind: "actor", source_ref: "a" }], actor_words: ["놓치고 싶지 않아요"] }));

  assert.match(cardBody("이번 대화 요약").textContent, /오늘 나눈 이야기를 그대로 남겼어요\./);
  assert.deepEqual(cardTitles(), ["이번 대화 요약", "다음 촬영에서 해볼 것", "배우가 직접 남긴 말"]);
  assert.equal(within(cardBody("배우가 직접 남긴 말")).getByRole("listitem").textContent, "놓치고 싶지 않아요");
  cleanup();

  draw(noteV2());
  assert.deepEqual(cardTitles(), ["이번 대화 요약", "다음 촬영에서 해볼 것"]);
});

test("초점 없는 신형 노트는 화면에 넘겨받은 묶음 제목을 건다", () => {
  draw(noteV2({ kind: "record_only", title: null, next_take: null, summary_quotes: [] }), "면접 첫 인사");

  assert.equal(screen.getByRole("heading", { level: 2 }).textContent, "면접 첫 인사");
});

test("노트 봉투가 아닌 공개 노트 원문이 오면 다시 불러오라고 안내한다", () => {
  const publicNote = JSON.parse(readFileSync(new URL("./fixtures/practice-note.json", import.meta.url)));

  draw(publicNote);

  assert.equal(
    screen.getByText(/새로고침하면/).textContent,
    "새로고침하면 이 연습 노트를 다시 불러올 수 있어요.",
  );
  assert.equal(screen.queryByRole("heading", { level: 2 }), null);
});

test("신형 노트의 응원은 스펙의 고정 문구 전체를 보인다", () => {
  draw(noteV2());
  assert.equal(screen.getAllByRole("paragraph").at(-1).textContent, "오늘 촬영도 수고했어요. 다음 촬영도 응원할게요.");
});
