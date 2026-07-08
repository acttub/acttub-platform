import type {
  CoachSessionDto,
  ConfirmationState,
  ObservationDto,
  PracticeUploadIntentDto,
  TurnDto,
} from "@/lib/api/types";

type OwnedCoachSessionRecord = CoachSessionDto & { ownerUserId: string };
type OwnedUploadIntentRecord = PracticeUploadIntentDto & {
  ownerUserId: string;
  finalizedAt: string | null;
};

export type MockCoachSessionRecord = CoachSessionDto;

type UploadIntentRecord = PracticeUploadIntentDto & {
  ownerUserId: string;
  finalizedAt: string | null;
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

repositoryState.sessionOwners ??= new Map<string, string>();

globalForRepository.__acttubMockCoachSessionRepository = repositoryState;

const stripSessionOwner = (session: OwnedCoachSessionRecord): MockCoachSessionRecord => {
  const dto = structuredClone(session) as Partial<OwnedCoachSessionRecord>;
  delete dto.ownerUserId;
  return dto as MockCoachSessionRecord;
};

const stripUploadIntentOwner = (uploadIntent: OwnedUploadIntentRecord): PracticeUploadIntentDto => {
  const dto = structuredClone(uploadIntent) as Partial<OwnedUploadIntentRecord>;
  delete dto.ownerUserId;
  delete dto.finalizedAt;
  return dto as PracticeUploadIntentDto;
};

const cloneUploadIntent = (uploadIntent: MockUploadIntentRecord): MockUploadIntentRecord =>
  structuredClone(uploadIntent);

const publicSession = (session: MockCoachSessionRecord): CoachSessionDto => {
  const { ownerId: _ownerId, ...dto } = cloneSession(session);
  return dto;
};

export const mockCoachSessionRepository = {
  create(session: CoachSessionDto, ownerId: string): CoachSessionDto {
    repositoryState.sessions.set(
      session.id,
      cloneSession({ ...session, ownerId }),
    );
    return publicSession(repositoryState.sessions.get(session.id)!);
  },

  findById(sessionId: string, ownerUserId?: string): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    return session && session.ownerId === ownerId && !session.hiddenAt
      ? publicSession(session)
      : null;
  },

  findByIdIncludingHidden(
    sessionId: string,
    ownerId: string,
  ): CoachSessionDto | null {
    const session = repositoryState.sessions.get(sessionId);
    return session && session.ownerId === ownerId
      ? publicSession(session)
      : null;
  },

  listVisible(ownerUserId?: string): MockCoachSessionRecord[] {
    return Array.from(repositoryState.sessions.values())
      .filter((session) => !session.hiddenAt)
      .filter((session) => !ownerUserId || repositoryState.sessionOwners.get(session.id) === ownerUserId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(stripSessionOwner);
  },

  saveUploadIntent(
    uploadIntent: PracticeUploadIntentDto,
    ownerId: string,
  ): PracticeUploadIntentDto {
    repositoryState.uploadIntents.set(
      uploadIntent.uploadIntentId,
      cloneUploadIntent({
        ...uploadIntent,
        ownerId,
        status: "created",
        finalizedAt: null,
      }),
    );
    return structuredClone(uploadIntent);
  },

  findUploadIntent(
    uploadIntentId: string,
    ownerId: string,
  ): MockUploadIntentRecord | null {
    const uploadIntent = repositoryState.uploadIntents.get(uploadIntentId);
    return uploadIntent && uploadIntent.ownerId === ownerId
      ? cloneUploadIntent(uploadIntent)
      : null;
  },

  markUploadIntentFinalized(
    uploadIntentId: string,
    ownerId: string,
  ): PracticeUploadIntentDto | null {
    const uploadIntent = repositoryState.uploadIntents.get(uploadIntentId);
    if (!uploadIntent || uploadIntent.ownerUserId !== ownerUserId) {
      return null;
    }

    const finalizedIntent = {
      ...uploadIntent,
      finalizedAt: new Date().toISOString(),
    });
    repositoryState.uploadIntents.set(uploadIntentId, updated);

    const dto = cloneUploadIntent(updated);
    delete (dto as Partial<MockUploadIntentRecord>).ownerId;
    delete (dto as Partial<MockUploadIntentRecord>).status;
    delete (dto as Partial<MockUploadIntentRecord>).finalizedAt;
    return dto;
  },

  isUploadIntentFinalized(uploadIntentId: string, ownerUserId: string): boolean {
    const uploadIntent = repositoryState.uploadIntents.get(uploadIntentId);
    return Boolean(uploadIntent && uploadIntent.ownerUserId === ownerUserId && uploadIntent.finalizedAt);
  },

  markUploadIntentFinalized(uploadIntentId: string, ownerUserId: string): PracticeUploadIntentDto | null {
    const uploadIntent = repositoryState.uploadIntents.get(uploadIntentId);
    if (!uploadIntent || uploadIntent.ownerUserId !== ownerUserId) {
      return null;
    }

    const finalizedIntent = {
      ...uploadIntent,
      finalizedAt: new Date().toISOString(),
    } satisfies OwnedUploadIntentRecord;
    repositoryState.uploadIntents.set(uploadIntentId, structuredClone(finalizedIntent));
    return stripUploadIntentOwner(finalizedIntent);
  },

  update(session: MockCoachSessionRecord, ownerUserId: string): MockCoachSessionRecord {
    const existing = repositoryState.sessions.get(session.id);
    if (!existing || existing.ownerId !== ownerId) {
      throw new Error(
        "Cannot update a session outside the current owner scope.",
      );
    }

    const updatedSession = {
      ...session,
      ownerUserId,
      updatedAt: new Date().toISOString(),
    } satisfies OwnedCoachSessionRecord;

    repositoryState.sessions.set(
      updatedSession.id,
      cloneSession(updatedSession),
    );
    return publicSession(updatedSession);
  },

  softHide(sessionId: string, ownerUserId?: string): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session || (ownerUserId && repositoryState.sessionOwners.get(sessionId) !== ownerUserId)) {
      return null;
    }

    return this.update(
      {
        ...stripSessionOwner(session),
        hiddenAt: new Date().toISOString(),
      },
      ownerUserId,
    );
  },

  addTurn(
    sessionId: string,
    ownerId: string,
    turn: TurnDto,
  ): CoachSessionDto | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session || (ownerUserId && repositoryState.sessionOwners.get(sessionId) !== ownerUserId)) {
      return null;
    }

    return this.update(
      {
        ...stripSessionOwner(session),
        turns: [...session.turns, turn],
      },
      ownerUserId,
    );
  },

  updateObservationState(
    sessionId: string,
    ownerUserId: string,
    observationId: string,
    confirmationState: ConfirmationState,
    ownerUserId?: string,
  ): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session || (ownerUserId && repositoryState.sessionOwners.get(sessionId) !== ownerUserId)) {
      return null;
    }

    let found = false;
    const observations: ObservationDto[] = session.observations.map(
      (observation) => {
        if (observation.id !== observationId) {
          return observation;
        }

        found = true;
        return {
          ...observation,
          confirmationState,
          blockedForQuestioning: confirmationState !== "accepted",
        };
      },
    );

    if (!found) {
      return null;
    }

    return this.update(
      {
        ...publicSession(session),
        status:
          confirmationState === "accepted" ? "PROBE_LOOP" : session.status,
        observations,
      },
      ownerUserId,
    );
  },
};
