export type SessionStatus =
  | "ANALYZING"
  | "OBSERVE_CONFIRM"
  | "PROBE_LOOP"
  | "INSIGHT"
  | "END";

export type AnalysisStatus = "pending" | "completed" | "failed";

export type ConfirmationState = "unasked" | "accepted" | "rejected" | "unsure";

export type TurnSpeaker = "actor" | "coach";

export type TurnState = "recorded" | "generated" | "blocked";

export type Medium = "youtube_url" | "upload_url" | "text_only";

export type ObservationDto = {
  id: string;
  takeId: string;
  timestampStartMs: number;
  timestampEndMs: number;
  observationText: string;
  confidence: number;
  confirmationState: ConfirmationState;
  blockedForQuestioning: boolean;
  createdAt: string;
};

export type TurnDto = {
  id: string;
  sessionId: string;
  speaker: TurnSpeaker;
  content: string;
  questionFocus: "observation_confirmation" | "missing_context" | "subtext_probe" | "summary_reflection";
  sourceObservationIds: string[];
  turnState: TurnState;
  createdAt: string;
};

export type TakeDto = {
  id: string;
  sessionId: string;
  videoUrl: string | null;
  durationMs: number | null;
  analysisStatus: AnalysisStatus;
  analysisError: string | null;
  createdAt: string;
};

export type CoachSessionDto = {
  id: string;
  status: SessionStatus;
  medium: Medium;
  genre: string;
  situation: string;
  characterContext: string;
  subtext: string;
  finalActorSentence: string | null;
  createdAt: string;
  updatedAt: string;
  take: TakeDto;
  observations: ObservationDto[];
  turns: TurnDto[];
};

export type CreateSessionRequest = {
  medium: Medium;
  genre: string;
  situation: string;
  characterContext: string;
  subtext?: string;
  videoUrl?: string;
  durationMs?: number;
};

export type CreateSessionResponse = {
  session: CoachSessionDto;
  firstQuestion: TurnDto;
};

export type GetSessionResponse = {
  session: CoachSessionDto;
};

export type CreateTurnRequest = {
  actorAnswer: string;
};

export type CreateTurnResponse = {
  actorTurn: TurnDto;
  coachTurn: TurnDto;
  session: CoachSessionDto;
};

export type UpdateObservationRequest = {
  confirmationState: ConfirmationState;
};

export type UpdateObservationResponse = {
  observation: ObservationDto;
  session: CoachSessionDto;
};

export type CreateSummaryRequest = {
  finalActorSentence: string;
};

export type CreateSummaryResponse = {
  session: CoachSessionDto;
  nextReflectionQuestion: string;
};

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: Record<string, string>;
  };
};
