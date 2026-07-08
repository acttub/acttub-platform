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

const belongsToUser = (record: { userId: string }, userId: string): boolean => record.userId === userId;

export const mockCoachSessionRepository = {
  create(session: MockCoachSessionRecord): MockCoachSessionRecord {
    repositoryState.sessions.set(session.id, cloneSession(session));
    return cloneSession(session);
  },

  findById(sessionId: string, userId: string): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    return session && !session.hiddenAt && belongsToUser(session, userId) ? cloneSession(session) : null;
  },

  findByIdIncludingHidden(sessionId: string, userId: string): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    return session && belongsToUser(session, userId) ? cloneSession(session) : null;
  },

  listVisible(userId: string): MockCoachSessionRecord[] {
    return Array.from(repositoryState.sessions.values())
      .filter((session) => !session.hiddenAt && belongsToUser(session, userId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(cloneSession);
  },

  saveUploadIntent(uploadIntent: PracticeUploadIntentDto): PracticeUploadIntentDto {
    repositoryState.uploadIntents.set(uploadIntent.uploadIntentId, structuredClone(uploadIntent));
    return structuredClone(uploadIntent);
  },

  findUploadIntent(uploadIntentId: string, userId: string): PracticeUploadIntentDto | null {
    const uploadIntent = repositoryState.uploadIntents.get(uploadIntentId);
    return uploadIntent && belongsToUser(uploadIntent, userId) ? structuredClone(uploadIntent) : null;
  },

  updateUploadIntent(uploadIntent: PracticeUploadIntentDto): PracticeUploadIntentDto {
    repositoryState.uploadIntents.set(uploadIntent.uploadIntentId, structuredClone(uploadIntent));
    return structuredClone(uploadIntent);
  },

  update(session: MockCoachSessionRecord): MockCoachSessionRecord {
    const updatedSession = {
      ...session,
      updatedAt: new Date().toISOString(),
    } satisfies MockCoachSessionRecord;

    repositoryState.sessions.set(updatedSession.id, cloneSession(updatedSession));
    return cloneSession(updatedSession);
  },

  softHide(sessionId: string, userId: string): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session || !belongsToUser(session, userId)) {
      return null;
    }

    return this.update({
      ...session,
      hiddenAt: new Date().toISOString(),
    });
  },

  addTurn(sessionId: string, userId: string, turn: TurnDto): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session || !belongsToUser(session, userId)) {
      return null;
    }

    return this.update({
      ...session,
      turns: [...session.turns, turn],
    });
  },

  updateObservationState(
    sessionId: string,
    userId: string,
    observationId: string,
    confirmationState: ConfirmationState,
  ): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session || !belongsToUser(session, userId)) {
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
