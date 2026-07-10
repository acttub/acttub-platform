import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("detail reloads the persisted aggregate and retries only failed retryable reports", () => {
  const source = read("src/features/practice/pipeline/session-detail.tsx");
  assert.match(source, /getPipelinePracticeSession\(sessionId\)/);
  assert.match(source, /useEffect\(\(\) => \{[\s\S]*getPipelinePracticeSession\(sessionId\)/);
  assert.match(source, /filter\(\(run\) => run\.stage === "report"\)\.at\(-1\)/);
  assert.match(source, /latestReportRun\?\.status === "failed"[\s\S]*latestReportRun\.retryable/);
  assert.match(source, /session\?\.report === null/);
  assert.match(source, /retryPipelineReport\(sessionId\)/);
  assert.match(source, /"paused"/);
  assert.match(source, /"completed_without_report"/);
});

test("report renders exactly six canonical immutable sections with one fallback", () => {
  const source = read("src/features/practice/pipeline/report-view.tsx");
  const keys = ["oneLineSummary", "primaryReviewPoint", "confirmedEvidence", "actorDiscovery", "groundedEncouragement", "nextPracticeStep"];
  let cursor = -1;
  for (const key of keys) { const next = source.indexOf(`[\"${key}\"`, cursor + 1); assert.ok(next > cursor, `${key} is in canonical order`); cursor = next; }
  assert.equal((source.match(/REPORT_FALLBACK/g) ?? []).length, 2);
  assert.match(source, /section\.status === "not_confirmed" \|\| section\.content === null/);
  assert.doesNotMatch(source, /storagePath|clip/i);
});

test("private video keeps signed URLs in memory and seeks milliseconds as seconds", () => {
  const source = read("src/features/practice/pipeline/private-video.tsx");
  assert.match(source, /createPracticeSignedVideoUrl\(sessionId\)/);
  assert.match(source, /currentTime = startMs \/ 1000/);
  assert.match(source, /setSignedUrl\(result\.signedUrl\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|storagePath|clip/i);
});
