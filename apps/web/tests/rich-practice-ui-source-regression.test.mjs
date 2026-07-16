import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const flow = readFileSync(
  path.join(appRoot, "src/features/practice/practice-flow.tsx"),
  "utf8",
);

test("home, new practice, and history entries render distinct product surfaces", () => {
  assert.match(flow, /entryInitialStep[\s\S]*home: "home"/);
  assert.match(flow, /entryInitialStep[\s\S]*new: "video"/);
  assert.match(flow, /entryInitialStep[\s\S]*history: "history"/);
  assert.match(flow, /step === "home"[\s\S]*<PracticeHome/);
  assert.match(flow, /step === "video"[\s\S]*<PracticeNewScreen/);
  assert.match(flow, /step === "history"[\s\S]*<PracticeHistoryScreen/);
});

test("practice surfaces keep the Acttub logo and blue visual language", () => {
  assert.match(flow, /function AppLogoMark/);
  assert.match(flow, /Acttub/);
  assert.match(flow, /#(?:2f6bff|3182f6|1b64da)/i);
});

test("new practice advances from video selection to a separate scene context screen", () => {
  assert.match(flow, /<VideoDropZone/);
  assert.match(flow, /setStep\("context"\)/);
  assert.match(flow, /<PracticeContextScreen/);
  assert.match(flow, /<SceneContextForm/);
});

test("history remains a dedicated surface with recent-practice cards", () => {
  assert.match(flow, /function PracticeHistoryScreen/);
  assert.match(flow, /function RecentPracticeSection/);
  assert.match(flow, /function PracticeHistoryCard/);
});

test("rich surfaces retain acting operations and persisted-session recovery", () => {
  assert.match(flow, /operation\(kind: "start" \| "restart"/);
  assert.match(flow, /operation: "retry_reply"/);
  assert.match(flow, /retryPracticeAnalysis/);
  assert.match(flow, /createPracticeReport/);
  assert.match(flow, /recoverPersistedSession/);
  assert.match(flow, /acting_session_expired/);
  assert.match(flow, /upstream_outcome_unknown/);
});

test("history loading failures do not block authenticated practice screens", () => {
  assert.match(flow, /await listPracticeSessions\(\)/);
  assert.match(flow, /catch \(reason\) \{[\s\S]*setHistoryError\(errorMessage\(reason\)\)/);
  assert.match(flow, /finally \{[\s\S]*setReady\(true\)/);
  assert.doesNotMatch(flow, /setHistory\(sessions\); setReady\(true\)/);
});
