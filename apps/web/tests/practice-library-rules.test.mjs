// practice.library·record·start·resume·analyze — 화면의 순수 규칙: 보관함 표시(상태·사용처·재생 주소 만료·필터 라벨),
// 묶음 제목·회차·월별 묶기·최근 30일·숨김 문구·이어하기 문구, 게스트 하루 3회 안내, 장면 300자·막힘 서술 500자, 분석 상태 매핑.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  DELETE_BLOCKED_COPY,
  LIBRARY_FILTERS,
  libraryEmptyCopy,
  PURGED_COPY,
  usageLabel,
  videoPlaybackUrl,
  videoStatusLabel,
} = await import("../src/features/library/library.ts");
const {
  CONTINUE_NEW_VIDEO_LABEL,
  CONTINUE_SAME_VIDEO_LABEL,
  groupTitle,
  HIDE_GROUP_COPY,
  inProgressPracticeId,
  byMonth,
  monthLabel,
  railGroups,
  recent30,
  UNTITLED_MONTH,
} = await import("../src/features/practice/practice-groups.ts");
const { GUEST_DAILY_LIMIT, guestAnalysisNotice, guestAnalysisUsed, recordGuestAnalysis, kstDate } = await import(
  "../src/features/practice/guest-daily-limit.ts"
);
const { BLOCKAGE_NOTE_MAX, SCENE_FIELD_MAX, sceneContextTooLong } = await import("../src/features/practice/practice-setup-flow.ts");
const { analysisNotice, PARTIAL_NOTICE, sessionStatusOf } = await import("../src/features/practice/practice-analysis.ts");

test("practice.library: 필터는 전체·최근 7일·즐겨찾기 셋이고 빈 보관함은 예시 없이 빈 상태 문구를 보인다", () => {
  assert.deepEqual(LIBRARY_FILTERS.map((f) => [f.value, f.label]), [["all", "전체"], ["recent7", "최근 7일"], ["favorite", "즐겨찾기"]]);
  assert.equal(libraryEmptyCopy("all"), "아직 보관한 영상이 없어요. 새 연습에서 영상을 올리면 여기에 남아요.");
  assert.equal(libraryEmptyCopy("favorite"), "즐겨찾기한 영상이 없어요.");
  assert.equal(libraryEmptyCopy("recent7"), "최근 7일에 저장한 영상이 없어요.");
});

test("practice.library: 상세는 사용처(회차 n개 · 챌린지 참여작 n개)와 저장 상태를 보여 주고 파일만 파기한 영상은 재생할 수 없다고 말한다", () => {
  assert.equal(usageLabel({ practice_count: 2, entry_count: 0 }), "회차 2개 · 챌린지 참여작 0개");
  assert.equal(videoStatusLabel({ purged_at: null }), "보관함 저장");
  assert.equal(videoStatusLabel({ purged_at: "2026-09-21T04:00:00Z" }), PURGED_COPY);
  assert.equal(PURGED_COPY, "재생할 수 없어요");
  assert.equal(DELETE_BLOCKED_COPY, "회차나 챌린지에 쓰인 영상이라 지울 수 없어요. 파일만 파기할 수 있어요.");
});

test("practice.library: 서명 재생 주소는 만료 뒤 쓰지 않는다 — 다시 조회한다", () => {
  const v = { playback_url: "https://cdn/1", playback_expires_at: "2026-09-21T04:00:00Z", purged_at: null };
  assert.equal(videoPlaybackUrl(v, new Date("2026-09-21T03:59:00Z")), "https://cdn/1");
  assert.equal(videoPlaybackUrl(v, new Date("2026-09-21T04:00:01Z")), null);
  assert.equal(videoPlaybackUrl({ ...v, purged_at: "2026-09-21T02:00:00Z" }, new Date("2026-09-21T03:00:00Z")), null);
});

const group = (overrides = {}) => ({
  root_id: "p-1",
  title: null,
  ordinal_count: 2,
  last_conversation_at: "2026-09-20T10:00:00Z",
  tags: [],
  favorite: false,
  hidden_at: null,
  in_progress_practice_id: null,
  practices: [
    { id: "p-1", ordinal: 1, stage: "closed", created_at: "2026-09-01T10:00:00Z", situation: "면접 첫 인사", note_title: null, conversation_count: 3 },
    { id: "p-2", ordinal: 2, stage: "closed", created_at: "2026-09-20T10:00:00Z", situation: "면접 첫 인사", note_title: "담담함이 무너지는 순간", conversation_count: 5 },
  ],
  ...overrides,
});

test("practice.library: 묶음 제목은 마지막 회차 노트 제목, 없으면 상황 문장, 둘 다 없으면 \"제목 없는 연습\"", () => {
  assert.equal(groupTitle(group()), "담담함이 무너지는 순간");
  const noNote = group({ practices: group().practices.map((p) => ({ ...p, note_title: null })) });
  assert.equal(groupTitle(noNote), "면접 첫 인사");
  const bare = group({ practices: group().practices.map((p) => ({ ...p, note_title: null, situation: "" })) });
  assert.equal(groupTitle(bare), "제목 없는 연습");
  // 서버가 제목을 계산해 주면 그것을 쓴다.
  assert.equal(groupTitle(group({ title: "서버 제목" })), "서버 제목");
});

test("practice.library: 최근 30일 필터와 월별 묶기는 회차 시작 날짜(한국 시간) 기준이다", () => {
  const now = new Date("2026-09-21T10:00:00+09:00");
  const old = group({ root_id: "old", practices: [{ id: "o", ordinal: 1, stage: "closed", created_at: "2026-07-01T10:00:00Z", situation: "", note_title: null, conversation_count: 0 }] });
  assert.deepEqual(recent30([group(), old], now).map((g) => g.root_id), ["p-1"]);
  assert.equal(monthLabel("2026-08-31T15:30:00Z"), "2026년 9월");
  assert.equal(monthLabel("2026-08-31T14:30:00Z"), "2026년 8월");

  // 목록은 달마다 나뉘고, 묶음은 가장 최근 회차가 속한 달에 놓인다 — 6월에 시작해 9월에
  // 이어한 묶음을 6월에서 찾게 하지 않는다.
  const august = group({ root_id: "aug", practices: [{ id: "a", ordinal: 1, stage: "closed", created_at: "2026-08-10T10:00:00Z", situation: "지난달", note_title: null, conversation_count: 0 }] });
  const { finished } = railGroups([group(), august]);
  assert.deepEqual(
    byMonth(finished).map((section) => [section.label, section.groups.map((g) => g.rootId)]),
    [["2026년 9월", ["p-1"]], ["2026년 8월", ["aug"]]],
  );
  // 회차를 하나도 받지 못한 묶음도 자리를 잃지 않는다.
  const empty = { ...group({ root_id: "empty", practices: [] }) };
  assert.deepEqual(byMonth(railGroups([empty]).finished).map((s) => s.label), [UNTITLED_MONTH]);
});

test("practice.library: 목록은 진행 중 묶음과 지난 묶음으로 갈리고 숨긴 묶음은 빠지며, 숨김 문구는 실제 범위를 말한다", () => {
  const running = group({ root_id: "r", in_progress_practice_id: "p-9" });
  const hidden = group({ root_id: "h", hidden_at: "2026-09-21T00:00:00Z" });
  const rail = railGroups([group(), running, hidden]);
  assert.deepEqual(rail.running.map((g) => g.rootId), ["r"]);
  assert.deepEqual(rail.finished.map((g) => g.rootId), ["p-1"]);
  assert.deepEqual(rail.finished[0].practices.map((p) => p.ordinal), [1, 2]);
  assert.equal(rail.finished[0].title, "담담함이 무너지는 순간");
  assert.equal(HIDE_GROUP_COPY, "기록에서 숨겨요. 영상은 보관함에 남아요");
  assert.equal(inProgressPracticeId([group(), running], "r"), "p-9");
  assert.equal(inProgressPracticeId([group(), running], "p-1"), null);
  assert.equal(inProgressPracticeId([group(), running]), "p-9");
});

test("practice.resume: 웹의 이어하기 버튼 문구는 영상을 다시 쓰는지 드러낸다", () => {
  assert.equal(CONTINUE_SAME_VIDEO_LABEL, "같은 영상으로 이어하기");
  assert.equal(CONTINUE_NEW_VIDEO_LABEL, "새 영상으로 이어하기");
});

test("practice.start·resume: 게스트는 시작 전에 하루 3회 한도를 안내받고, 한도는 한국 시간 하루로 센다", () => {
  assert.equal(GUEST_DAILY_LIMIT, 3);
  assert.equal(kstDate(new Date("2026-09-21T14:59:00Z")), "2026-09-21");
  assert.equal(kstDate(new Date("2026-09-21T15:00:00Z")), "2026-09-22");
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const day = new Date("2026-09-21T10:00:00+09:00");
  assert.equal(guestAnalysisUsed(storage, day), 0);
  recordGuestAnalysis(storage, day);
  recordGuestAnalysis(storage, day);
  assert.equal(guestAnalysisUsed(storage, day), 2);
  assert.equal(guestAnalysisNotice(2), "게스트는 하루 3번까지 분석할 수 있어요. 오늘 1번 남았어요.");
  assert.equal(guestAnalysisNotice(3), "오늘은 세 번까지 분석할 수 있어요. 앱으로 옮기면 계속할 수 있어요.");
  // 자정(한국 시간)을 넘기면 다시 센다.
  assert.equal(guestAnalysisUsed(storage, new Date("2026-09-22T00:01:00+09:00")), 0);
});

test("practice.start: 상황·인물·목표는 각 300자, 막힘 서술은 500자까지다", () => {
  assert.equal(SCENE_FIELD_MAX, 300);
  assert.equal(BLOCKAGE_NOTE_MAX, 500);
  assert.equal(sceneContextTooLong({ situation: "가".repeat(300), characterContext: "", goal: "" }), false);
  assert.equal(sceneContextTooLong({ situation: "가".repeat(301), characterContext: "", goal: "" }), true);
});

test("practice.analyze: 회차 상태는 화면 상태로 매핑되고 부분 완료는 \"일부 구간은 보지 못했어요\" 를 보인다", () => {
  assert.equal(sessionStatusOf({ stage: "analyzing", job: { status: "pending", failure_reason: null }, analysis: null }), "analyzing");
  assert.equal(sessionStatusOf({ stage: "analyzing", job: { status: "running", failure_reason: null }, analysis: null }), "analyzing");
  assert.equal(sessionStatusOf({ stage: "conversing", job: { status: "succeeded", failure_reason: null }, analysis: { status: "ready" } }), "analyzed");
  assert.equal(sessionStatusOf({ stage: "conversing", job: { status: "succeeded", failure_reason: null }, analysis: { status: "partial" } }), "analyzed");
  assert.equal(sessionStatusOf({ stage: "closed", job: { status: "failed", failure_reason: "timeout" }, analysis: null }), "failed");
  assert.equal(sessionStatusOf({ stage: "closed", job: { status: "failed", failure_reason: "cancelled" }, analysis: null }), "failed");
  // 대화가 끝나 닫혔어도 분석 결과가 있으면 대화·노트를 볼 수 있다.
  assert.equal(sessionStatusOf({ stage: "closed", job: { status: "succeeded", failure_reason: null }, analysis: { status: "ready" } }), "analyzed");
  assert.equal(analysisNotice({ status: "partial" }), PARTIAL_NOTICE);
  assert.equal(PARTIAL_NOTICE, "일부 구간은 보지 못했어요");
  assert.equal(analysisNotice({ status: "ready" }), null);
  assert.equal(analysisNotice(null), null);
});
