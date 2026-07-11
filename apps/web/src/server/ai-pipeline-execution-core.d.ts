export interface AiPipelineCoreErrorLike extends Error { code: string; status: number; cause: unknown }
export declare class AiPipelineCoreError extends Error {
  readonly code: string;
  readonly status: number;
  readonly cause: unknown;
  constructor(code: string, status?: number, cause?: unknown);
}
export interface AgentClaimPayload {
  schemaVersion: string;
  sessionId: string;
  command: string;
  requestId: string;
  answer: string | null;
  observationId: string | null;
  expectedSubstantiveAnswerCount: number;
  expectedTotalConversationCount: number;
}
export interface InterviewProgress {
  substantiveAnswerCount: number;
  totalReportableActorCount: number;
  unknownCount: number;
  terminal: boolean;
}
export interface ClaimResult<TRun = unknown> { run: TRun; owned: boolean }
export interface CreateExecutionCoreArgs<TRun = unknown> {
  claimRun: () => Promise<ClaimResult<TRun>>;
  readRun: (runId: string) => Promise<ClaimResult<TRun> | null>;
  sleep?: (ms: number) => Promise<void>;
  waitAttempts?: number;
  waitDelayMs?: number;
}
export interface RunCallbacks<TRun = unknown, TResult = unknown> {
  claim?: () => Promise<ClaimResult<TRun>>;
  invoke: (run: TRun, claim: ClaimResult<TRun>) => Promise<TResult>;
  persist: (result: TResult, run: TRun, claim: ClaimResult<TRun>) => Promise<void>;
  replay: (run: TRun, claim: ClaimResult<TRun>) => TResult;
  recover: (error: unknown, run: TRun, claim: ClaimResult<TRun>) => Promise<TResult | null | undefined>;
  providerFailure?: (error: unknown, run: TRun, claim: ClaimResult<TRun>) => never | TResult | Promise<never | TResult>;
  persistenceFailure?: (error: unknown, run: TRun, claim: ClaimResult<TRun>) => never | TResult | Promise<never | TResult>;
}
export declare const buildAgentClaimPayload: (input: AgentClaimPayload) => AgentClaimPayload;
export declare const fingerprintAgentClaim: (payload: unknown) => string;
export declare const interviewProgress: (transcript: Array<{ role: string; kind: string }>) => InterviewProgress;
export declare const assertExpectedInterviewProgress: (input: { actual: InterviewProgress; expectedSubstantiveAnswerCount: number; expectedTotalConversationCount: number; fail?: (code: string) => never }) => void;
export declare const assertTerminalAtConversationLimit: (input: { actual: InterviewProgress; completionReason?: string | null; done?: boolean | null; reportReady?: boolean | null; fail?: (code: string) => never }) => void;
export declare const sanitizePublicAiPipelineAggregate: (value: unknown) => unknown;
export declare const createAiPipelineExecutionCore: <TRun = unknown>(args: CreateExecutionCoreArgs<TRun>) => {
  claimRun: () => Promise<ClaimResult<TRun>>;
  readRun: (runId: string) => Promise<ClaimResult<TRun> | null>;
  run: <TResult>(callbacks: RunCallbacks<TRun, TResult>) => Promise<TResult>;
};
