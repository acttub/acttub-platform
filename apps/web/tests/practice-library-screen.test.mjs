// practice.library — 보관함·보관함 영상 본문이 보여 주는 말. 껍데기는 next/link 를 끌어와 Node 에서 그릴 수 없어
// 본문만 정적으로 그린다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { LibraryListBody, LibraryVideoBody } = await import("../src/features/library/library-body.tsx");
const { DELETE_BLOCKED_COPY, libraryEmptyCopy } = await import("../src/features/library/library.ts");

const video = (overrides = {}) => ({
  id: "v-1",
  duration_ms: 72_000,
  byte_size: 1,
  content_type: "video/mp4",
  favorite: false,
  purged_at: null,
  created_at: "2026-09-21T03:00:00+09:00",
  usage: { practice_count: 0, entry_count: 0 },
  playback_url: null,
  playback_expires_at: null,
  ...overrides,
});
const noop = () => {};
const text = (html) => html.replace(/<[^>]+>/g, "");

test("practice.library: 빈 보관함은 예시 영상 없이 빈 상태 문구를 보인다", () => {
  const t = text(renderToStaticMarkup(React.createElement(LibraryListBody, { videos: [], filter: "all", onFilter: noop, loading: false, error: null, onToggleFavorite: noop })));
  assert.equal(t.includes(libraryEmptyCopy("all")), true);
  assert.equal(t.includes("예시"), false);
  for (const f of ["전체", "최근 7일", "즐겨찾기"]) assert.equal(t.includes(f), true, f);
});

test("practice.library: 목록 카드는 저장 상태와 사용처를 보이고 파일만 파기한 영상은 재생할 수 없다고 말한다", () => {
  const html = renderToStaticMarkup(
    React.createElement(LibraryListBody, { videos: [video(), video({ id: "v-2", purged_at: "2026-09-21T04:00:00Z", usage: { practice_count: 2, entry_count: 0 } })], filter: "all", onFilter: noop, loading: false, error: null, onToggleFavorite: noop }),
  );
  const t = text(html);
  assert.equal(t.includes("보관함 저장 · 회차 0개 · 챌린지 참여작 0개"), true);
  assert.equal(t.includes("재생할 수 없어요 · 회차 2개 · 챌린지 참여작 0개"), true);
  assert.match(html, /href="\/library\/v-1"/);
});

test("practice.library: 두 회차가 참조하는 영상의 상세는 \"회차 2개\" 를 보이고 삭제 대신 파일만 파기를 준다", () => {
  const referenced = video({ usage: { practice_count: 2, entry_count: 0 }, playback_url: "https://cdn/1", playback_expires_at: "2099-01-01T00:00:00Z" });
  const html = renderToStaticMarkup(
    React.createElement(LibraryVideoBody, { video: referenced, playbackUrl: "https://cdn/1", busy: false, error: null, onToggleFavorite: noop, onDelete: noop, onPurge: noop, onPlaybackExpired: noop }),
  );
  const t = text(html);
  assert.equal(t.includes("사용처 · 회차 2개 · 챌린지 참여작 0개"), true);
  assert.equal(t.includes(DELETE_BLOCKED_COPY), true);
  assert.equal(t.includes("파일만 파기"), true);
  assert.equal(t.includes("보관함에서 삭제"), false);
  assert.equal(t.includes("질문 코칭으로 보내기"), true);
  assert.match(html, /href="\/practice\/new\?video=v-1"/);

  const free = text(renderToStaticMarkup(React.createElement(LibraryVideoBody, { video: video(), playbackUrl: null, busy: false, error: null, onToggleFavorite: noop, onDelete: noop, onPurge: noop, onPlaybackExpired: noop })));
  assert.equal(free.includes("보관함에서 삭제"), true);
  assert.equal(free.includes("파일만 파기"), false);
});

test("practice.library: 파일만 파기한 영상의 상세는 재생 대신 \"재생할 수 없어요\" 만 보이고 코칭으로 보내지 않는다", () => {
  const purged = video({ purged_at: "2026-09-21T04:00:00Z", usage: { practice_count: 2, entry_count: 0 } });
  const t = text(renderToStaticMarkup(React.createElement(LibraryVideoBody, { video: purged, playbackUrl: null, busy: false, error: null, onToggleFavorite: noop, onDelete: noop, onPurge: noop, onPlaybackExpired: noop })));
  assert.equal(t.includes("재생할 수 없어요"), true);
  assert.equal(t.includes("질문 코칭으로 보내기"), false);
  assert.equal(t.includes("파일만 파기"), false);
});
