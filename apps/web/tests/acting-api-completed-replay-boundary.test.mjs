import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const service = readFileSync(new URL("../src/server/services/acting-coach-service.ts", import.meta.url), "utf8");
const sql = readFileSync(new URL("../../../supabase/migrations/011_acting_api_pipeline.sql", import.meta.url), "utf8");
test("completed replays return validated persisted public results", () => {
  assert.match(service, /requireCompletedResult<ActingCoachSessionDto>\(claim\.result, completedSessionKeys\)/);
  assert.match(service, /requireCompletedResult<ActingReportDto>\(claim\.result, completedReportKeys\)/);
  assert.match(service, /privateReplayKeys = new Set/);
  assert.match(service, /replayAnalysisSession[\s\S]*claim\.kind === "replay_completed"\) return ownedSession\(userId, sessionId\)/);
  assert.match(service, /replaySession[\s\S]*requireCompletedResult<ActingCoachSessionDto>\(claim\.result, completedSessionKeys\)/);
});
test("post-commit errors cannot persist contradictory failures", () => {
  assert.equal((service.match(/if \(localCommitStarted\) throw knownRepositoryError/g) ?? []).length, 3);
  assert.equal((service.match(/localCommitStarted = true;/g) ?? []).length, 3);
  assert.doesNotMatch(service, /runAnalysisClaim/);
});
test("completion RPCs persist database-built public DTOs", () => {
  assert.match(sql, /response_payload=public\.acttub_public_session_payload\(p_session_id,p_user_id\)/);
  assert.match(sql, /response_payload=public\.acttub_public_report_payload\(p_session_id,p_user_id\)/);
  assert.doesNotMatch(sql, /status='completed',response_payload=p_response_payload/);
});

test("completed session replay includes the normal mapper deliveryRetryable field", () => {
  assert.match(
    sql,
    /'deliveryRetryable',coalesce\(x\.delivery_retryable,false\)/,
  );
});
