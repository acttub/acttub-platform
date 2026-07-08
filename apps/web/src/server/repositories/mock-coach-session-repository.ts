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

type RepositoryState = {
  sessions: Map<string, OwnedCoachSessionRecord>;
  uploadIntents: Map<string, OwnedUploadIntentRecord>;
};

const globalForRepository = globalThis as typeof globalThis & {
  __acttubMockCoachSessionRepository?: RepositoryState;
};

const repositoryState =
  globalForRepository.__acttubMockCoachSessionRepository ?? {
    sessions: new Map<string, OwnedCoachSessionRecord>(),
    uploadIntents: new Map<string, OwnedUploadIntentRecord>(),
  };

globalForRepository.__acttubMockCoachSessionRepository = repositoryState;

const stripSessionOwner = (session: OwnedCoachSessionRecord): MockCoachSessionRecord => {
  const { ownerUserId: _ownerUserId, ...dto } = session;
  return structuredClone(dto);
};

const stripUploadIntentOwner = (uploadIntent: OwnedUploadIntentRecord): PracticeUploadIntentDto => {
  const { ownerUserId: _ownerUserId, finalizedAt: _finalizedAt, ...dto } = uploadIntent;
  return structuredClone(dto);
};

const cloneUploadIntent = (uploadIntent: MockUploadIntentRecord): MockUploadIntentRecord =>
  structuredClone(uploadIntent);

const publicSession = (session: MockCoachSessionRecord): CoachSessionDto => {
  const { ownerId: _ownerId, ...dto } = cloneSession(session);
  return dto;
};

export const mockCoachSessionRepository = {
  create(session: MockCoachSessionRecord, ownerUserId: string): MockCoachSessionRecord {
    const ownedSession = { ...session, ownerUserId } satisfies OwnedCoachSessionRecord;
    repositoryState.sessions.set(session.id, structuredClone(ownedSession));
    return stripSessionOwner(ownedSession);
  },

  findByIdForOwner(sessionId: string, ownerUserId: string): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    return session && !session.hiddenAt && session.ownerUserId === ownerUserId ? stripSessionOwner(session) : null;
  },

  listVisibleForOwner(ownerUserId: string): MockCoachSessionRecord[] {
    return Array.from(repositoryState.sessions.values())
      .filter((session) => session.ownerUserId === ownerUserId && !session.hiddenAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(stripSessionOwner);
  },

  saveUploadIntent(uploadIntent: PracticeUploadIntentDto, ownerUserId: string): PracticeUploadIntentDto {
    const ownedUploadIntent = {
      ...uploadIntent,
      ownerUserId,
      finalizedAt: null,
    } satisfies OwnedUploadIntentRecord;
    repositoryState.uploadIntents.set(uploadIntent.uploadIntentId, structuredClone(ownedUploadIntent));
    return stripUploadIntentOwner(ownedUploadIntent);
  },

  findUploadIntentForOwner(uploadIntentId: string, ownerUserId: string): PracticeUploadIntentDto | null {
    const uploadIntent = repositoryState.uploadIntents.get(uploadIntentId);
    return uploadIntent && uploadIntent.ownerUserId === ownerUserId ? stripUploadIntentOwner(uploadIntent) : null;
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
    if (!existing || existing.ownerUserId !== ownerUserId) {
      throw new Error("Cannot update a session owned by another actor.");
    }

    const updatedSession = {
      ...session,
      ownerUserId,
      updatedAt: new Date().toISOString(),
    } satisfies OwnedCoachSessionRecord;

    repositoryState.sessions.set(updatedSession.id, structuredClone(updatedSession));
    return stripSessionOwner(updatedSession);
  },

  softHide(sessionId: string, ownerUserId: string): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session || session.ownerUserId !== ownerUserId) {
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

  addTurn(sessionId: string, ownerUserId: string, turn: TurnDto): MockCoachSessionRecord | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session || session.ownerUserId !== ownerUserId) {
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
  ): CoachSessionDto | null {
    const session = repositoryState.sessions.get(sessionId);
    if (!session || session.ownerUserId !== ownerUserId) {
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
        ...stripSessionOwner(session),
        status: confirmationState === "accepted" ? "PROBE_LOOP" : session.status,
        observations,
      },
      ownerUserId,
    );
  },
};
