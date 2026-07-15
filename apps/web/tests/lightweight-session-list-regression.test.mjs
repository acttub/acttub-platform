import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import test from "node:test";
import {
  decodePracticeSessionListCursor,
  encodePracticeSessionListCursor,
  parsePracticeSessionListQuery,
} from "../src/server/services/practice-session-list-pagination.ts";
import { toPracticeSessionListItem } from "../src/lib/api/session-list-item.ts";

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("migrations 001 through 024 are immutable", () => {
  const expected = [
    "b48698fae7629c7b55f4171a7f3443a429ded0f2f47f08b7b8794d2b3208b04b","609fd5c1e12d9bf1e2d5ca7d847cef9d82302aceb63eb0890852fef3926405e3","f56e9afa06e44b2ec227f9c61527e2454dacf436d2956dc16cd8eedf71730899","fb345afce506086e4877300dd2ae7b4e4e1820a5797eb35d72e0697fa6f2ca36","e1fcbdac50bf81790de80b4e8b17dd1a1cde7df30f14704d769e35c09dc14fce","a9648afc32ad4876c069aaca9d1400123c9d8396532da99be7aa4c1ba7874dfc","05c05c0e89e52ffb9ab805fe176f7db8fab6a8feb5f87ff5bdf38acbb38b0619","d8d5305aaa64974553b8a6b65a0e0564a9c6b027d24d63813aef379d30906dff","52b3bb57ad2eefdb1a22f928489049b9657bb1bff30fa37c55cc3d6ece7c60ff","b57909e6ff63d3d564de35881a5c21cd46687bb5c1b3d1f5c0eabd98678dc89b","69d743df6fe9c3ebd1ddb56355c604e7f542ce1d204933bbdff08315153c2ee6","d9e77e881f8b15614fe549d54a396a753205587976c9489e818a9d5f8beba20d","a2b8b2054d98431397c37bc9605664d2bd98ae168be52bba7421d26f40a01092","d80d88cdeab177417650b3d2f3a71ee1129e605b3d4cfddf6a9e7b0bb496b629","c1158f65016becccf8bd0486fd7be952180fcfe35cc9966e4fdbeb622f6e7467","ac21aa2076373d72975d8d7a153ee60c9bac8652295bb411d099163361b77648","38ba9f1a9a4570b223c1e67cae2d7113943db761212bddc43216f5280488d896","04b472518355d2faea3f7d008b5ab4c4462210cf8cf05b302f61afcf0c9ca8ba","c07e05611205061c67bbfbb5394ecca03c0ad1abfa6f6842088b3e07456ae295","998d8f75e4e396986f898ca2ebfb80739cb36b50397e9eccc6cf80621037b854","955c68b96dc8a0ba1328b1ab51e658687e914239f12ae26f99a32e7ff3a2e1f8","fef83d8503b12f0bd2280aa528c88857cccd9773db5bbccff2c0e69605fbc146","8d6a96a68dbfb2f507b98888925ea35ab23642b6a05817c0ae9a4acdab0e0823","f84b54f2953615019a66d3df8be29532c36371b45dc1b119ce28327bf914a570",
  ];
  const dir = new URL("../../../supabase/migrations/", import.meta.url);
  const files = readdirSync(dir).filter((name) => /^(00[1-9]|01[0-9]|02[0-4])_/.test(name)).sort();
  assert.equal(files.length, 24);
  files.forEach((name, index) => assert.equal(createHash("sha256").update(readFileSync(new URL(name, dir))).digest("hex"), expected[index], name));
});

test("cursor and query parsing are strict and canonical", () => {
  const value = { snapshotAt: "2026-01-02T03:04:05.000Z", createdAt: "2026-01-01T03:04:05.000Z", id: "123e4567-e89b-42d3-a456-426614174000" };
  const cursor = encodePracticeSessionListCursor(value);
  assert.deepEqual(decodePracticeSessionListCursor(cursor), { v: 1, ...value });
  assert.deepEqual(parsePracticeSessionListQuery(new URLSearchParams("view=summary")), { limit: 20, cursor: null });
  assert.equal(parsePracticeSessionListQuery(new URLSearchParams("")), null);
  assert.equal(parsePracticeSessionListQuery(new URLSearchParams("view=summary&limit=1")).limit, 1);
  assert.equal(parsePracticeSessionListQuery(new URLSearchParams("view=summary&limit=50")).limit, 50);
  for (const query of [
    "view=summary&limit=01", "view=summary&limit=1.0", "view=summary&limit=+1",
    "view=summary&limit=0", "view=summary&limit=51", "limit=20",
    "view=summary&view=summary", "view=summary&cursor=bad=", "view=",
    "view=summary&unknown=1", "view=summary&limit=", "view=summary&cursor=",
  ]) {
    assert.throws(() => parsePracticeSessionListQuery(new URLSearchParams(query)), /Request validation failed/);
  }

  const encoded = (payload) => Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)).toString("base64url");
  for (const malformed of [
    `${cursor}=`, "not+base64", Buffer.from([0xff]).toString("base64url"), encoded("{"), encoded([]),
    encoded({ v: 1, snapshotAt: value.snapshotAt, createdAt: value.createdAt }),
    encoded({ v: 1, snapshotAt: value.snapshotAt, createdAt: value.createdAt, id: value.id, extra: true }),
    encoded({ v: 2, snapshotAt: value.snapshotAt, createdAt: value.createdAt, id: value.id }),
    encoded({ v: 1, snapshotAt: value.snapshotAt, createdAt: value.createdAt, id: value.id.toUpperCase() }),
    encoded({ v: 1, snapshotAt: "2026-01-02T03:04:05Z", createdAt: value.createdAt, id: value.id }),
    encoded({ v: 1, snapshotAt: value.snapshotAt, createdAt: "2026-01-03T03:04:05.000Z", id: value.id }),
    "a".repeat(1025),
  ]) assert.throws(() => decodePracticeSessionListCursor(malformed), /Request validation failed/);
});

test("full-session list mapping enforces Unicode DTO bounds and legacy title parity", () => {
  const base = { id: "123e4567-e89b-42d3-a456-426614174000", userId: "owner", hiddenAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  const legacy = toPracticeSessionListItem({ ...base, pipelineVersion: "legacy-gemini-v1", legacy: true, status: "LEGACY_COMPLETED", medium: "upload_url", genre: `  ${"한".repeat(2000)}  `, situation: "상황", characterContext: "인물", subtext: "의도", take: { id: "take", sessionId: base.id, videoUrl: null, durationMs: 1000, analysisStatus: "generated", analysisError: null, createdAt: base.createdAt }, sceneSummary: null, currentRun: null, turns: [], report: null, legacyResult: null });
  assert.equal(Array.from(legacy.title).length, 120);
  assert.equal(legacy.title, "한".repeat(120));
  const acting = toPracticeSessionListItem({ ...base, pipelineVersion: "acting-api-v1", legacy: false, status: "END", medium: "기타", genre: "기타", situation: "😀".repeat(2000), characterContext: "인물", subtext: "의도", take: { id: "take", durationMs: 1000, analysisStatus: "completed", analysisRetryable: false, analysisError: null, createdAt: base.createdAt }, sceneSummary: null, currentRun: null, turns: [], report: { headline: "나".repeat(2000), biggestProblem: { start: "", end: "", dimension: "", description: "" }, evidence: "", selfDiscovery: "", encouragement: "", nextStep: "", comparison: "", reportCount: 1 } });
  assert.equal(Array.from(acting.title).length, 120);
  assert.equal(Array.from(acting.preview ?? "").length, 240);
});

test("summary list remains additive and detail-on-click", () => {
  const route = read("apps/web/src/app/api/v1/practice-sessions/route.ts");
  const client = read("apps/web/src/lib/api/sessions.ts");
  const ui = read("apps/web/src/features/practice/practice-flow.tsx");
  assert.match(route, /parsePracticeSessionListQuery/);
  assert.match(route, /listSessions\(auth\.userId\)/);
  assert.match(route, /listSessionSummaries/);
  assert.match(client, /view=summary/);
  assert.match(ui, /getPracticeSession\(item\.id/);
  assert.match(ui, /더 보기/);
});

test("repository summary path is RPC-only and migration is bounded", () => {
  const repository = read("apps/web/src/server/repositories/supabase-coach-session-repository.ts");
  const migration = read("supabase/migrations/024_lightweight_session_list.sql");
  const summaryMethod = repository.slice(repository.indexOf("async listOwnedSessionSummaries"));
  assert.match(summaryMethod, /acttub_list_owned_practice_session_summaries/);
  assert.doesNotMatch(summaryMethod.split("async getOwnedVideoStorage")[0], /legacySessionSelect|actingSessionSelect|practice_turns\(\*\)/);
  assert.match(migration, /limit p_limit/i);
  assert.match(migration, /hidden_at is null/i);
  assert.match(migration, /grant execute[\s\S]*service_role/i);
});
