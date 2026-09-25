// reading.script — 대본 넣기 화면(D13)의 기기 쪽 규칙: 파일 크기 한도, 미지원 형식, 최근 대본 목록 카드의 표시.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { FILE_MAX_BYTES, FileTooLargeError, UnsupportedFileError, extractText } = await import(
  "../src/lib/reading/script/extract.ts"
);
const { COPYRIGHT_NOTICE, activityLabel, listHeadline, myCharactersLabel, statusChip } = await import(
  "../src/features/reading/script-list.ts"
);

test("reading.script: 20,000,001바이트 파일은 글자를 뽑지 않고 안내하며, 20,000,000바이트는 읽는다", async () => {
  assert.equal(FILE_MAX_BYTES, 20_000_000);
  const tooLarge = new File([new Uint8Array(FILE_MAX_BYTES + 1)], "긴대본.txt", { type: "text/plain" });
  await assert.rejects(extractText(tooLarge), (error) => error instanceof FileTooLargeError);
  assert.equal(new FileTooLargeError().message, "파일이 너무 커요(20MB까지). 텍스트를 복사해 붙여넣어 주세요.");

  const atLimit = new File([new Uint8Array(FILE_MAX_BYTES).fill(0x61)], "대본.txt", { type: "text/plain" });
  const text = await extractText(atLimit);
  assert.equal(text.length, FILE_MAX_BYTES);
});

test("reading.script: hwpx 는 미지원 안내다 (웹은 txt·pdf·docx·hwp 를 연다)", async () => {
  const hwpx = new File(["x"], "대본.hwpx");
  await assert.rejects(extractText(hwpx), (error) => error instanceof UnsupportedFileError && error.message.includes("hwpx"));
});

test("reading.script: 등록 화면의 저작권 안내 한 줄", () => {
  assert.equal(COPYRIGHT_NOTICE, "연습 목적으로만 보관하고 다른 사람에게 보여 주지 않아요.");
});

const card = (overrides = {}) => ({
  id: "script-1",
  title: "옥상, 밤",
  my_character_names: [],
  dialogue_count: 15,
  recording_count: 0,
  last_practiced_at: null,
  last_activity_at: "2026-09-21T03:00:00+09:00",
  status: "no_cast",
  updated_at: "2026-09-21T03:00:00+09:00",
  ...overrides,
});

test("reading.script: 목록 머리는 \"전체 N개 · 연습 중 M개\" 다", () => {
  assert.equal(listHeadline({ total_count: 3, in_progress_count: 1 }), "전체 3개 · 연습 중 1개");
});

test("reading.script: 상태 칩은 셋 — 열린 회차가 있으면 \"연습 중\", 마지막 회차가 완료면 \"연습 완료\", 그 밖은 \"배역 선택\"", () => {
  assert.deepEqual(statusChip(card({ status: "reading" })), { label: "연습 중", tone: "blue" });
  assert.deepEqual(statusChip(card({ status: "completed" })), { label: "연습 완료", tone: "neutral" });
  assert.deepEqual(statusChip(card({ status: "no_cast" })), { label: "배역 선택", tone: "neutral" });
});

test("reading.script: 카드의 내 배역은 마지막 회차의 배역이고 회차가 없으면 \"배역 미선택\" 이다", () => {
  assert.equal(myCharactersLabel(card()), "배역 미선택");
  assert.equal(myCharactersLabel(card({ my_character_names: ["윤서"] })), "윤서");
  assert.equal(myCharactersLabel(card({ my_character_names: ["윤서", "태오"] })), "윤서, 태오");
});

test("reading.script: 마지막 활동 날짜는 \"어제 연습\"·\"5월 25일 업로드\" 꼴이다", () => {
  // 보는 사람의 달력으로 센다. CI 는 UTC 라 시간대를 못박아 둔다.
  const now = new Date("2026-09-21T10:00:00+09:00");
  const seoul = "Asia/Seoul";
  assert.equal(activityLabel(card({ last_activity_at: "2026-09-21T03:00:00+09:00" }), now, seoul), "오늘 업로드");
  assert.equal(activityLabel(card({ last_activity_at: "2026-09-20T23:00:00+09:00" }), now, seoul), "어제 업로드");
  assert.equal(activityLabel(card({ last_activity_at: "2026-05-25T12:00:00+09:00" }), now, seoul), "5월 25일 업로드");
  assert.equal(activityLabel(card({ last_activity_at: "2025-12-31T12:00:00+09:00" }), now, seoul), "2025년 12월 31일 업로드");
  // 같은 순간도 달력이 다르면 다른 날이다(UTC 로는 아직 20일).
  assert.equal(activityLabel(card({ last_activity_at: "2026-09-21T03:00:00+09:00" }), now, "UTC"), "어제 업로드");
  // 회차가 있었던 대본(last_practiced_at)의 마지막 활동은 연습이다.
  assert.equal(activityLabel(card({ last_activity_at: "2026-09-20T23:00:00+09:00", last_practiced_at: "2026-09-20T23:00:00+09:00", status: "completed" }), now, seoul), "어제 연습");
  assert.equal(activityLabel(card({ last_activity_at: "2026-05-25T12:00:00+09:00", last_practiced_at: "2026-05-25T12:00:00+09:00", status: "reading" }), now, seoul), "5월 25일 연습");
});
