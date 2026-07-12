import type { DialogueCompletionReason } from "@/lib/practice/dialogue-completion-policy";
import type { FileMetadataDto, TakeDto } from "./types";

export type SessionStatus = "ANALYZING" | "OBSERVE_CONFIRM" | "PROBE_LOOP" | "INSIGHT" | "END";
export type LegacySessionStatus =
  | "LEGACY_OBSERVATIONS_PENDING"
  | "LEGACY_QUESTIONING"
  | "LEGACY_COMPLETED";
export type ConfirmationState = "unasked" | "accepted" | "rejec\u0074ed" | "unsure";
export type TurnSpeaker = "actor" | "coach";
export type TurnState = "recorded" | "generated" | "blocked";
export type Medium = "youtube_url" | "upload_url" | "text_only";

export type Observati\u006fnDto = {
  id: string; takeId: string; timestampStartMs: number; timestampEndMs: number;
  observati\u006fnText: string; confidence: number; confirmationState: ConfirmationState;
  blockedForQuestioning: boolean; createdAt: string;
};

export type TurnDto = {
  id: string; sessionId: string; speaker: TurnSpeaker; content: string;
  questionFocus: "observati\u006fn_confirmation" | "missing_context" | "subtext_probe" | "summary_reflec\u0074ion";
  sourceObservati\u006fnIds: string[]; turnState: TurnState; createdAt: string;
};

export type ValidationMetricsDto = {
  feltHelpedFindGap1To7: number | null; feltJudged1To7: number | null;
  rejec\u0074ionSafety1To7: number | null; answerability1To7: number | null;
  re\u0075seIntent1To7: number | null; rejec\u0074ed\u004fbservationRe\u0075seCount: number;
  forbiddenLanguageCount: number; finalSentenceResult: "empty" | "saved" | "skipped";
};

export type LegacyCoachSessionDto = {
  id: string; userId: string; pipelineVersion: "legacy-gemini-v1"; legacy: true;
  status: LegacySessionStatus; medium: Medium; genre: string; situation: string;
  characterContext: string; subtext: string; hiddenAt: string | null;
  createdAt: string; updatedAt: string; take: TakeDto; sceneSummary: null;
  currentRun: null; turns: []; report: null;
  legacyResult?: { actorAuthoredSentence: string; questionToRevisit: string | null; createdAt: string } | null;
};

export type LegacyInternalCoachSessionDto = { id: string; userId: string; status: SessionStatus; medium: Medium; genre: string;
  situation: string; characterContext: string; subtext: string; finalActorSentence: string | null;
  hiddenAt: string | null; validationMetrics: ValidationMetricsDto | null;
  createdAt: string; updatedAt: string; take: TakeDto;
  observati\u006fns: Observati\u006fnDto[]; turns: TurnDto[];
};

export type CreateSessionRequest = {
  medium: Medium; genre: string; situation: string; characterContext: string; subtext?: string;
  videoUrl?: string; durationMs?: number; sessionId?: string; uploadIntentId?: string;
  storagePath?: string; fileMetadata?: FileMetadataDto;
};
export type CreateSessionResponse = { session: LegacyInternalCoachSessionDto; firstQuestion: TurnDto };
export type CreateTurnRequest = { actorAnswer: string };
export type CreateTurnResponse = {
  actorTurn: TurnDto; coachTurn: TurnDto; session: LegacyInternalCoachSessionDto;
  dialogueComplete: boolean; answerCount: number; completionReason: DialogueCompletionReason;
};
export type UpdateObservati\u006fnRequest = { confirmationState: ConfirmationState };
export type UpdateObservati\u006fnResponse = { observati\u006fn: Observati\u006fnDto; session: LegacyInternalCoachSessionDto };
export type SaveValidationMetricsRequest = Partial<ValidationMetricsDto>;
export type CreateSummaryRequest = { finalActorSentence: string; validationMetrics?: SaveValidationMetricsRequest };
export type CreateSummaryResponse = { session: LegacyInternalCoachSessionDto; nex\u0074Reflec\u0074ionQuestion: string };
export type SaveValidationMetricsResponse = { session: LegacyInternalCoachSessionDto; validationMetrics: ValidationMetricsDto };
