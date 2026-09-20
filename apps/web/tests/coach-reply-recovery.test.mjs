import assert from "node:assert/strict";
import { test } from "node:test";
import "./ts-module-loader.mjs";
const { ApiError, NetworkError } = await import("../src/lib/api/v2/errors.ts");
const { isClosedCoach, coachReplyError, recoverClosedCoach } = await import("../src/features/workspace/coach-reply-recovery.ts");

test("closed sessions are distinct from transport, rate limit and other conflicts", () => {
  assert.equal(isClosedCoach(new ApiError(409, "session is closed", "session is closed")), true);
  assert.equal(isClosedCoach(new ApiError(409, "request is still processing", null)), false);
  assert.equal(isClosedCoach(new NetworkError()), false);
  assert.match(coachReplyError(new NetworkError()), /연결/);
  assert.doesNotMatch(coachReplyError(new ApiError(500, "error", null)), /연결/);
  assert.match(coachReplyError(new ApiError(429, "rate", null)), /기다려/);
  assert.match(coachReplyError(new ApiError(502, "coach_response_unavailable", "coach_response_unavailable")), /입력한 답은 보관/);
});

test("a closed conversation locks immediately and restores the saved note without a model call", async () => {
  const events = [];
  const report = { report_type: "practice_note" };
  await recoverClosedCoach({
    isCurrent: () => true,
    close: () => events.push("closed"),
    load: async () => { events.push("load"); return { report }; },
    restore: (value) => { assert.equal(value, report); events.push("restored"); },
    unavailable: () => assert.fail("unexpected lookup failure"),
  });
  assert.deepEqual(events, ["closed", "load", "restored"]);
});

test("a failed note lookup leaves the chat closed and never asks for another answer", async () => {
  const events = [];
  await recoverClosedCoach({
    isCurrent: () => true, close: () => events.push("closed"),
    load: async () => { throw new NetworkError(); },
    restore: () => assert.fail("no report"), unavailable: () => events.push("note-unavailable"),
  });
  assert.deepEqual(events, ["closed", "note-unavailable"]);
});

test("a late note cannot replace a different practice session", async () => {
  let current = true;
  await recoverClosedCoach({
    isCurrent: () => current, close: () => {},
    load: async () => { current = false; return { report: { report_type: "practice_note" } }; },
    restore: () => assert.fail("stale note"), unavailable: () => assert.fail("stale error"),
  });
});
