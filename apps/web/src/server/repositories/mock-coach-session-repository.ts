import type {
  CoachSessionDto,
  ConfirmationState,
  ObservationDto,
  PracticeUploadIntentDto,
  TurnDto,
} from "@/lib/api/types";

export type MockCoachSessionRecord = CoachSessionDto & {
  ownerId: string;
};

export type MockUploadIntentRecord = PracticeUploadIntentDto & {
  ownerId: string;
  status: "created" | "finalized";
  finalizedAt: string | null;
};

type UploadIntentRecord = {
  intent: PracticeUploadIntentDto;
  ownerId: string;
  finalizedAt: string | null;
  finalizedVideoUrl: string | null;
  finalizedDurationMs: number | null;
};

type RepositoryState = {
  sessions: Map<string, MockCoachSessionRecord>;
  uploadIntents: Map<string, MockUploadIntentRecord>;
};

const globalForRepository = globalThis as typeof globalThis & {
  __acttubMockCoachSessionRepository?: RepositoryState;
};

const repositoryState =
  globalForRepository.__acttubMockCoachSessionRepository ?? {
    sessions: new Map<string, MockCoachSessionRecord>(),
    uploadIntents: new Map<string, MockUploadIntentRecord>(),
  };

globalForRepository.__acttubMockCoachSessionRepository = repositoryState;

const cloneSession = (session: MockCoachSessionRecord): MockCoachSessionRecord =>
  structuredClone(session);

const cloneUploadIntent = (uploadIntent: MockUploadIntentRecord): MockUploadIntentRecord =>
  structuredClone(uploadIntent);

const publicSession = (session: MockCoachSessionRecord): CoachSessionDto => {
  const { ownerId: _ownerId, ...dto } = cloneSession(session);
  return dto;
};

export const mockCoachSessionRepository = {
  create(session: CoachSessionDto, ownerId: string): CoachSessionDto {
    repositoryState.sessions.set(session.id, cloneSession({ ...session, ownerId }));
    return publicSession(repositoryState.sessions.get(session.id)!);
  },

  findById(sessionId: string, ownerId: string): CoachSessionDto | null {
    const session = repositoryState.sessions.get(sessionId);
    return session && session.ownerId === ownerId && !session.hiddenAt ? publicSession(session) : null;
  },

  findByIdIncludingHidden(sessionId: string, ownerId: string): CoachSessionDto | null {
    const session = repositoryState.sessions.get(sessionId);
    return session && session.ownerId === ownerId ? publicSession(session) : null;
  },

  listVisible(ownerId: string): CoachSessionDto[] {
    return Array.from(repositoryState.sessions.values())
      .filter((session) => session.ownerId === ownerId && !session.hiddenAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(publicSession);
  },

  saveUploadIntent(uploadIntent: PracticeUploadIntentDto, ownerId: string): PracticeUploadIntentDto {
    repositoryState.uploadIntents.set(
      uploadIntent.uploadIntentId,
      cloneUploadIntent({ ...uploadIntent, ownerId, status: "created", finalizedAt: null }),
    );
    return structuredClone(uploadIntent);
  },

  findUploadIntent(uploadIntentId: string, ownerId: string): MockUploadIntentRecord | null {
    const uploadIntent = repositoryState.uploadIntents.get(uploadIntentId);
    return uploadIntent && uploadIntent.ownerId === ownerId ? cloneUploadIntent(uploadIntent) : null;
  },

  markUploadIntentFinalized(uploadIntentId: string, ownerId: string): PracticeUploadIntentDto | null {
    const uploadIntent = repositoryState.uploadIntents.get(uploadIntentId);
    if (!uploadIntent || uploadIntent.ownerId !== ownerId) {
      return null;
    }

    const updated = cloneUploadIntent({
      ...uploadIntent,
      status: "finalized",
      finalizedAt: new Date().toISOString(),
    });
    repositoryState.uploadIntents.set(uploadIntentId, updated);

    const { ownerId: _ownerId, status: _status, finalizedAt: _finalizedAt, ...dto } = updated;
    return dto;
  },

  update(session: CoachSessionDto, ownerId: string): CoachSessionDto {
    const existing = repositoryState.sessions.get(session.id);
    if (!existing || existing.ownerId !== ownerId) {
      throw new Error("Cannot update a session outside the current owner scope.");
    }

    const updatedSession = {
      ...session,
      ownerId,
      updatedAt: new Date().toISOString(),
    } satisfies MockCoachSessionRecord;

    repositoryState.sessions.set(updatedSession.id, cloneSession(updatedSession));
    return publicSession(updatedSession);
  },

  softHide(sessionId: string, ownerId: string): CoachSessionDto | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session || session.ownerId !== ownerId) {
      return null;
    }

    return this.update(
      {
        ...publicSession(session),
        hiddenAt: new Date().toISOString(),
      },
      ownerId,
    );
  },

  addTurn(sessionId: string, ownerId: string, turn: TurnDto): CoachSessionDto | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session || session.ownerId !== ownerId) {
      return null;
    }

    return this.update(
      {
        ...publicSession(session),
        turns: [...session.turns, turn],
      },
      ownerId,
    );
  },

  updateObservationState(
    sessionId: string,
    ownerId: string,
    observationId: string,
    confirmationState: ConfirmationState,
  ): CoachSessionDto | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session || session.ownerId !== ownerId) {
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
        ...publicSession(session),
        status: confirmationState === "accepted" ? "PROBE_LOOP" : session.status,
        observations,
      },
      ownerId,
    );
  },
};
