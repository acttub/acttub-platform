import type {
  CoachSessionDto,
  ConfirmationState,
  ObservationDto,
  PracticeUploadIntentDto,
  TurnDto,
} from "@/lib/api/types";

export type MockCoachSessionRecord = CoachSessionDto;

type StoredUploadIntentRecord = PracticeUploadIntentDto & {
  finalizedVideoUrl?: string;
  finalizedDurationMs?: number | null;
  intent: PracticeUploadIntentDto;
};

type RepositoryState = {
  sessions: Map<string, MockCoachSessionRecord>;
  sessionOwners: Map<string, string>;
  uploadIntents: Map<string, StoredUploadIntentRecord>;
};

const globalForRepository = globalThis as typeof globalThis & {
  __acttubMockCoachSessionRepository?: Partial<RepositoryState>;
};

const repositoryState: RepositoryState = {
  sessions: globalForRepository.__acttubMockCoachSessionRepository?.sessions ?? new Map(),
  sessionOwners: globalForRepository.__acttubMockCoachSessionRepository?.sessionOwners ?? new Map(),
  uploadIntents: globalForRepository.__acttubMockCoachSessionRepository?.uploadIntents ?? new Map(),
};

globalForRepository.__acttubMockCoachSessionRepository = repositoryState;

const cloneSession = (session: MockCoachSessionRecord): MockCoachSessionRecord =>
  structuredClone(session);

const cloneUploadIntent = (uploadIntent: StoredUploadIntentRecord): StoredUploadIntentRecord =>
  structuredClone(uploadIntent);

const ownsSession = (sessionId: string, ownerId: string): boolean =>
  repositoryState.sessionOwners.get(sessionId) === ownerId;

const ownsUploadIntent = (uploadIntentId: string, ownerId: string): boolean =>
  repositoryState.uploadIntents.get(uploadIntentId)?.userId === ownerId;

export const mockCoachSessionRepository = {
  create(session: MockCoachSessionRecord, ownerUserId: string): MockCoachSessionRecord {
    repositoryState.sessions.set(session.id, cloneSession(session));
    repositoryState.sessionOwners.set(session.id, ownerUserId);
    return cloneSession(session);
  },

  findById(sessionId: string, userId: string): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session || session.hiddenAt) {
      return null;
    }
    if (!ownsSession(sessionId, userId)) {
      return null;
    }
    return cloneSession(session);
  },

  findByIdForOwner(sessionId: string, ownerUserId: string): MockCoachSessionRecord | null {
    return this.findById(sessionId, ownerUserId);
  },

  findByIdIncludingHidden(sessionId: string, ownerUserId?: string): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    if (ownerUserId && repositoryState.sessionOwners.get(sessionId) !== ownerUserId) {
      return null;
    }
    return cloneSession(session);
  },

  listVisible(userId: string): MockCoachSessionRecord[] {
    return Array.from(repositoryState.sessions.values())
      .filter((session) => session.userId === userId && !session.hiddenAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(cloneSession);
  },

  saveUploadIntent(
    uploadIntent: PracticeUploadIntentDto,
    ownerUserId: string,
  ): PracticeUploadIntentDto {
    const storedIntent: StoredUploadIntentRecord = {
      ...structuredClone(uploadIntent),
      userId: ownerUserId,
      intent: structuredClone(uploadIntent),
    };
    repositoryState.uploadIntents.set(uploadIntent.uploadIntentId, storedIntent);
    return structuredClone(uploadIntent);
  },

  findUploadIntent(
    uploadIntentId: string,
    ownerUserId?: string,
  ): StoredUploadIntentRecord | null {
    const uploadIntent = repositoryState.uploadIntents.get(uploadIntentId);
    if (!uploadIntent) {
      return null;
    }
    if (ownerUserId && uploadIntent.userId !== ownerUserId) {
      return null;
    }
    return cloneUploadIntent(uploadIntent);
  },

  updateUploadIntent(uploadIntent: StoredUploadIntentRecord): StoredUploadIntentRecord {
    const current = repositoryState.uploadIntents.get(uploadIntent.uploadIntentId);
    const updatedIntent: StoredUploadIntentRecord = {
      ...(current ?? uploadIntent),
      ...structuredClone(uploadIntent),
      intent: structuredClone(uploadIntent.intent ?? uploadIntent),
    };
    repositoryState.uploadIntents.set(uploadIntent.uploadIntentId, updatedIntent);
    return cloneUploadIntent(updatedIntent);
  },

  markUploadIntentFinalized(
    uploadIntentId: string,
    ownerUserId: string,
  ): PracticeUploadIntentDto | null {
    const uploadIntent = repositoryState.uploadIntents.get(uploadIntentId);
    if (!uploadIntent || uploadIntent.userId !== ownerUserId) {
      return null;
    }

    const finalizedIntent: StoredUploadIntentRecord = {
      ...uploadIntent,
      status: "finalized",
      finalizedAt: new Date().toISOString(),
      intent: {
        ...uploadIntent.intent,
        status: "finalized",
        finalizedAt: new Date().toISOString(),
      },
    };
    repositoryState.uploadIntents.set(uploadIntentId, finalizedIntent);
    return structuredClone(finalizedIntent.intent);
  },

  isUploadIntentFinalized(uploadIntentId: string, ownerUserId: string): boolean {
    const uploadIntent = repositoryState.uploadIntents.get(uploadIntentId);
    return Boolean(
      uploadIntent &&
        uploadIntent.userId === ownerUserId &&
        uploadIntent.status === "finalized" &&
        uploadIntent.finalizedAt,
    );
  },

  update(session: MockCoachSessionRecord, ownerUserId: string): MockCoachSessionRecord {
    const existing = repositoryState.sessions.get(session.id);
    if (!existing || repositoryState.sessionOwners.get(session.id) !== ownerUserId) {
      throw new Error("Cannot update a session outside the current owner scope.");
    }

    const updatedSession = {
      ...session,
      updatedAt: new Date().toISOString(),
    } satisfies MockCoachSessionRecord;

    repositoryState.sessions.set(updatedSession.id, cloneSession(updatedSession));
    return cloneSession(updatedSession);
  },

  softHide(sessionId: string, ownerUserId: string): MockCoachSessionRecord | null {
    const session = this.findById(sessionId, ownerUserId);
    if (!session) {
      return null;
    }

    return this.update(
      {
        ...session,
        hiddenAt: new Date().toISOString(),
      },
      ownerUserId,
    );
  },

  addTurn(
    sessionId: string,
    ownerUserId: string,
    turn: TurnDto,
  ): MockCoachSessionRecord | null {
    const session = this.findById(sessionId, ownerUserId);
    if (!session) {
      return null;
    }

    return this.update(
      {
        ...session,
        turns: [...session.turns, turn],
      },
      ownerUserId,
    );
  },

  updateObservationState(
    sessionId: string,
    userId: string,
    observationId: string,
    confirmationState: ConfirmationState,
    _legacyOwnerUserId?: string,
  ): MockCoachSessionRecord | null {
    const session = this.findById(sessionId, userId);
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

    if (!found) return null;

    return this.update(
      {
        ...session,
        status: confirmationState === "accepted" ? "PROBE_LOOP" : session.status,
        observations,
      },
      userId,
    );
  },
};
