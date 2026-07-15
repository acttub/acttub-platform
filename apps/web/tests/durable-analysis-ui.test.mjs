import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("active analysis is restored and sequentially polled through the owner GET", () => {
  const client = read("src/lib/api/sessions.ts");
  const flow = read("src/features/practice/practice-flow.tsx");
  assert.match(client, /getPracticeSession\([^)]*signal/);
  assert.match(flow, /localStorage/);
  assert.match(flow, /active.*session.*id/i);
  assert.match(flow, /AbortController/);
  assert.match(flow, /visibilitychange/);
  assert.match(flow, /setTimeout/);
  assert.match(flow, /status\s*===\s*["']ANALYZING["']/);
  assert.match(flow, /operation\(["']start["']/);
});
