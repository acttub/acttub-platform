import type {
  CoachSessionDto,
  ConfirmationState,
  ObservationDto,
  PracticeUploadIntentDto,
  TurnDto,
} from "@/lib/api/types";

export type MockCoachSessionRecord = CoachSessionDto;

type RepositoryState = {
  sessions: Map<string, MockCoachSessionRecord>;
  uploadIntents: Map<string, PracticeUploadIntentDto>;
};

const globalForRepository = globalThis as typeof globalThis & {
  __acttubMockCoachSessionRepository?: RepositoryState;
};

const repositoryState =
  globalForRepository.__acttubMockCoachSessionRepository ?? {
    sessions: new Map<string, MockCoachSessionRecord>(),
    uploadIntents: new Map<string, PracticeUploadIntentDto>(),
  };

globalForRepository.__acttubMockCoachSessionRepository = repositoryState;

const cloneSession = (session: MockCoachSessionRecord): MockCoachSessionRecord =>
  structuredClone(session);

export const mockCoachSessionRepository = {
  create(session: MockCoachSessionRecord): MockCoachSessionRecord {
    repositoryState.sessions.set(session.id, cloneSession(session));
    return cloneSession(session);
  },

  findById(sessionId: string): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    return session && !session.hiddenAt ? cloneSession(session) : null;
  },

  findByIdIncludingHidden(sessionId: string): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    return session ? cloneSession(session) : null;
  },

  listVisible(): MockCoachSessionRecord[] {
    return Array.from(repositoryState.sessions.values())
      .filter((session) => !session.hiddenAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(cloneSession);
  },

  saveUploadIntent(uploadIntent: PracticeUploadIntentDto): PracticeUploadIntentDto {
    repositoryState.uploadIntents.set(uploadIntent.uploadIntentId, structuredClone(uploadIntent));
    return structuredClone(uploadIntent);
  },

  findUploadIntent(uploadIntentId: string): PracticeUploadIntentDto | null {
    const uploadIntent = repositoryState.uploadIntents.get(uploadIntentId);
    return uploadIntent ? structuredClone(uploadIntent) : null;
  },

  update(session: MockCoachSessionRecord): MockCoachSessionRecord {
    const updatedSession = {
      ...session,
      updatedAt: new Date().toISOString(),
    } satisfies MockCoachSessionRecord;

    repositoryState.sessions.set(updatedSession.id, cloneSession(updatedSession));
    return cloneSession(updatedSession);
  },

  softHide(sessionId: string): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return this.update({
      ...session,
      hiddenAt: new Date().toISOString(),
    });
  },

  addTurn(sessionId: string, turn: TurnDto): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return this.update({
      ...session,
      turns: [...session.turns, turn],
    });
  },

  updateObservationState(
    sessionId: string,
    observationId: string,
    confirmationState: ConfirmationState,
  ): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    let found = false;
    const observations: ObservationDto[] = session.observations.map((observation) => {
      if (observation.id !== observationId) {
        return observation;
      }

      found = true;
      return {
        ...observation,
        confirmationState,
        blockedForQuestioning: confirmationState !== "accepted",
      };
    });

    if (!found) {
      return null;
    }

    return this.update({
      ...session,
      status: confirmationState === "accepted" ? "PROBE_LOOP" : session.status,
      observations,
    });
  },
};
