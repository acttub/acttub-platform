import type {
  CoachSessionDto,
  ConfirmationState,
  ObservationDto,
  PracticeUploadIntentDto,
  TurnDto,
} from "@/lib/api/types";

export type MockCoachSessionRecord = CoachSessionDto;

type UploadIntentRecord = {
  intent: PracticeUploadIntentDto;
  ownerId: string;
  finalizedAt: string | null;
  finalizedVideoUrl: string | null;
  finalizedDurationMs: number | null;
};

type RepositoryState = {
  sessions: Map<string, MockCoachSessionRecord>;
  sessionOwners: Map<string, string>;
  uploadIntents: Map<string, UploadIntentRecord>;
};

const globalForRepository = globalThis as typeof globalThis & {
  __acttubMockCoachSessionRepository?: RepositoryState;
};

const repositoryState =
  globalForRepository.__acttubMockCoachSessionRepository ?? {
    sessions: new Map<string, MockCoachSessionRecord>(),
    sessionOwners: new Map<string, string>(),
    uploadIntents: new Map<string, UploadIntentRecord>(),
  };

globalForRepository.__acttubMockCoachSessionRepository = repositoryState;

const cloneSession = (session: MockCoachSessionRecord): MockCoachSessionRecord =>
  structuredClone(session);

const cloneUploadIntentRecord = (record: UploadIntentRecord): UploadIntentRecord =>
  structuredClone(record);

const ownsSession = (sessionId: string, ownerId: string): boolean =>
  repositoryState.sessionOwners.get(sessionId) === ownerId;

const ownsUploadIntent = (uploadIntentId: string, ownerId: string): boolean =>
  repositoryState.uploadIntents.get(uploadIntentId)?.ownerId === ownerId;

export const mockCoachSessionRepository = {
  create(session: MockCoachSessionRecord, ownerId: string): MockCoachSessionRecord {
    repositoryState.sessions.set(session.id, cloneSession(session));
    repositoryState.sessionOwners.set(session.id, ownerId);
    return cloneSession(session);
  },

  findById(sessionId: string, ownerId: string): MockCoachSessionRecord | null {
    if (!ownsSession(sessionId, ownerId)) {
      return null;
    }

    const session = repositoryState.sessions.get(sessionId);
    return session && !session.hiddenAt && belongsToUser(session, userId) ? cloneSession(session) : null;
  },

  findByIdIncludingHidden(sessionId: string, ownerId: string): MockCoachSessionRecord | null {
    if (!ownsSession(sessionId, ownerId)) {
      return null;
    }

    const session = repositoryState.sessions.get(sessionId);
    return session && belongsToUser(session, userId) ? cloneSession(session) : null;
  },

  listVisible(ownerId: string): MockCoachSessionRecord[] {
    return Array.from(repositoryState.sessions.values())
      .filter((session) => ownsSession(session.id, ownerId) && !session.hiddenAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(cloneSession);
  },

  saveUploadIntent(uploadIntent: PracticeUploadIntentDto, ownerId: string): PracticeUploadIntentDto {
    repositoryState.uploadIntents.set(uploadIntent.uploadIntentId, {
      intent: structuredClone(uploadIntent),
      ownerId,
      finalizedAt: null,
      finalizedVideoUrl: null,
      finalizedDurationMs: null,
    });
    return structuredClone(uploadIntent);
  },

  findUploadIntent(uploadIntentId: string, ownerId: string): UploadIntentRecord | null {
    if (!ownsUploadIntent(uploadIntentId, ownerId)) {
      return null;
    }

    const record = repositoryState.uploadIntents.get(uploadIntentId);
    return record ? cloneUploadIntentRecord(record) : null;
  },

  finalizeUploadIntent(
    uploadIntentId: string,
    ownerId: string,
    details: { videoUrl: string; durationMs: number | null },
  ): UploadIntentRecord | null {
    if (!ownsUploadIntent(uploadIntentId, ownerId)) {
      return null;
    }

    const record = repositoryState.uploadIntents.get(uploadIntentId);
    if (!record) {
      return null;
    }

    const updatedRecord: UploadIntentRecord = {
      ...record,
      finalizedAt: new Date().toISOString(),
      finalizedVideoUrl: details.videoUrl,
      finalizedDurationMs: details.durationMs,
    };
    repositoryState.uploadIntents.set(uploadIntentId, cloneUploadIntentRecord(updatedRecord));
    return cloneUploadIntentRecord(updatedRecord);
  },

  update(session: MockCoachSessionRecord, ownerId: string): MockCoachSessionRecord | null {
    if (!ownsSession(session.id, ownerId)) {
      return null;
    }

    const updatedSession = {
      ...session,
      updatedAt: new Date().toISOString(),
    } satisfies MockCoachSessionRecord;

    repositoryState.sessions.set(updatedSession.id, cloneSession(updatedSession));
    return cloneSession(updatedSession);
  },

  softHide(sessionId: string, ownerId: string): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session || !ownsSession(sessionId, ownerId)) {
      return null;
    }

    return this.update(
      {
        ...session,
        hiddenAt: new Date().toISOString(),
      },
      ownerId,
    );
  },

  addTurn(sessionId: string, turn: TurnDto, ownerId: string): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session || !ownsSession(sessionId, ownerId)) {
      return null;
    }

    return this.update(
      {
        ...session,
        turns: [...session.turns, turn],
      },
      ownerId,
    );
  },

  updateObservationState(
    sessionId: string,
    userId: string,
    observationId: string,
    confirmationState: ConfirmationState,
    ownerId: string,
  ): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session || !ownsSession(sessionId, ownerId)) {
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

    return this.update(
      {
        ...session,
        status: confirmationState === "accepted" ? "PROBE_LOOP" : session.status,
        observations,
      },
      ownerId,
    );
  },
};
