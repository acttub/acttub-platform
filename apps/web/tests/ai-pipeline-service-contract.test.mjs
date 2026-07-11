import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(path.resolve(import.meta.dirname, "../src/server/ai-pipeline-service-core.js"), "utf8");
const compact = source.replace(/\s+/g, "");

test("terminal agent turns are committed through the append pipeline transaction", () => {
  const callAgent = compact.slice(compact.indexOf("constcallAgent"), compact.lastIndexOf("returnObject.freeze({"));
  assert.ok(callAgent.includes('completionStatus:invoked.done||String(invoked.transportResponse?.action)==="pause"?(invoked.reportReady?"completed":String(invoked.transportResponse?.action)==="pause"?"paused":"completed_without_report"):null'));
  assert.ok(callAgent.includes("deps.repository.appendPipelineTurn({"));
  assert.ok(callAgent.includes('completionReason:invoked.done||String(invoked.transportResponse?.action)==="pause"?invoked.completionReason:null'));
  assert.doesNotMatch(callAgent, /completeInterview\(\{/);
});

test("early insufficient evidence still uses the explicit completion RPC", () => {
  assert.ok(compact.includes('deps.repository.completeInterview({sessionId,userId,status:"completed_without_report",completionReason:"insufficient_confirmed_evidence",observationIds:[],answerTurnIds:[]}'));
  assert.ok(compact.includes('return{done:true,completionReason:"insufficient_confirmed_evidence",reportReady:false}'));
});

test("deletion cleanup uses the hidden session lookup and fail-closed storage/rows rollback path", () => {
  assert.match(compact, /deps\.coachSessionService\.getSessionIncludingHidden\(sessionId,userId\)/);
  assert.match(compact, /constcode=storageDeleted\?"DELETE_ROWS_FAILED":"DELETE_STORAGE_FAILED"/);
  assert.match(compact, /deps\.repository\.failDelete\(\{sessionId,userId,requestId,safeErrorCode:code\}\)/);
  assert.doesNotMatch(source, /fetch\(/);
});
