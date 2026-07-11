import { fingerprintJson } from "./ai-pipeline-fingerprint.js";
import { countReportableActorTurns } from "./ai-pipeline-runtime-rules.js";

const defaultFail = (code) => {
  throw new AiPipelineCoreError(code);
};

const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class AiPipelineCoreError extends Error {
  constructor(code, status = 409, cause = null) {
    super(code);
    this.name = "AiPipelineCoreError";
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

export const buildAgentClaimPayload = ({ schemaVersion, sessionId, command, requestId, answer = null, observationId = null, expectedSubstantiveAnswerCount, expectedTotalConversationCount }) => ({
  schemaVersion,
  sessionId,
  command,
  requestId,
  answer,
  observationId,
  expectedSubstantiveAnswerCount,
  expectedTotalConversationCount,
});

export const fingerprintAgentClaim = (payload) => fingerprintJson(payload);

export const interviewProgress = (transcript) => {
  const reportableActorCount = countReportableActorTurns(transcript);
  const substantiveAnswerCount = transcript.filter((turn) => turn.role === "actor" && turn.kind === "answer").length;
  const unknownCount = transcript.filter((turn) => turn.role === "actor" && turn.kind === "unknown").length;
  return {
    substantiveAnswerCount,
    totalReportableActorCount: reportableActorCount,
    unknownCount,
    terminal: reportableActorCount >= 10,
  };
};

export const assertExpectedInterviewProgress = ({ actual, expectedSubstantiveAnswerCount, expectedTotalConversationCount, fail = defaultFail }) => {
  if (
    actual.substantiveAnswerCount !== expectedSubstantiveAnswerCount ||
    actual.totalReportableActorCount !== expectedTotalConversationCount
  ) {
    fail("invalid_progress");
  }
};

export const assertTerminalAtConversationLimit = ({ actual, completionReason = null, done = null, fail = defaultFail }) => {
  if (actual.totalReportableActorCount < 10) return;
  if (done !== true) fail("nonterminal_tenth_turn");
  if (completionReason === "hard_limit_report_ready") {
    return;
  }
  if (completionReason === "insufficient_interview_evidence") {
    return;
  }
  fail("invalid_completion_count");
};

export const sanitizePublicAiPipelineAggregate = (value) => {
  if (Array.isArray(value)) return value.map(sanitizePublicAiPipelineAggregate);
  if (!isPlainObject(value)) return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "requestPayloadFingerprint" || key === "responsePayload" || key === "updatedAt") continue;
    result[key] = sanitizePublicAiPipelineAggregate(entry);
  }
  return result;
};

export const createAiPipelineExecutionCore = ({ claimRun, readRun, sleep: sleepImpl = sleep, waitAttempts = 0, waitDelayMs = 0 }) => {
  const waitForTerminal = async (runId) => {
    let last = null;
    for (let attempt = 0; attempt <= waitAttempts; attempt += 1) {
      last = await readRun(runId);
      if (last.run.status === "completed" || last.run.status === "failed") return last;
      if (attempt < waitAttempts) await sleepImpl(waitDelayMs);
    }
    return last;
  };

  return {
    claimRun,
    readRun,
    async run({ claim, invoke, persist, replay, recover, providerFailure, persistenceFailure }) {
      const claimed = claim ? await claim() : await claimRun();
      const run = claimed.run;
      const tryRecover = async (error) => {
        if (recover) {
          const recovered = await recover(error, run, claimed);
          if (recovered !== null && recovered !== undefined) return recovered;
        }
        if (persistenceFailure) return persistenceFailure(error, run, claimed);
        throw error;
      };
      if (run.status === "completed") {
        try {
          return replay(run, claimed);
        } catch (error) {
          return tryRecover(error);
        }
      }
      if (!claimed.owned) {
        if (run.status === "running" && readRun) {
          const observed = await waitForTerminal(run.id);
          if (observed?.run.status === "completed") {
            try {
              return replay(observed.run, observed);
            } catch (error) {
              return tryRecover(error);
            }
          }
          if (observed?.run.status === "failed") throw new AiPipelineCoreError(observed.run.safeErrorCode ?? "AI_RUN_ALREADY_CLAIMED");
        }
        throw new AiPipelineCoreError("AI_RUN_ALREADY_CLAIMED");
      }
      if (run.status !== "running") throw new AiPipelineCoreError(run.status === "failed" ? (run.safeErrorCode ?? "AI_RUN_FAILED") : "AI_RUN_NOT_RUNNING");
      let invoked;
      try {
        invoked = await invoke(run, claimed);
      } catch (error) {
        if (providerFailure) return providerFailure(error, run, claimed);
        throw error;
      }
      try {
        await persist(invoked, run, claimed);
      } catch (error) {
        return tryRecover(error);
      }
      if (!readRun) return invoked;
      try {
        const committed = await readRun(run.id);
        if (committed?.run.status === "completed") {
          try {
            return replay(committed.run, committed);
          } catch (error) {
            return tryRecover(error);
          }
        }
      } catch (error) {
        return tryRecover(error);
      }
      return invoked;
    },
  };
};
