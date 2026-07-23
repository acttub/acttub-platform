export const ANALYSIS_SCHEMA_VERSION = 1;

const KEY_PREFIX = 'acttub.pendingAnalysis:';

export type PendingAnalysisRecord = {
  schemaVersion: number;
  owner: string;
  session_id: string;
};

export type PendingAnalysisHandle = {
  key: string;
  record: PendingAnalysisRecord;
};

export type PendingAnalysisStorage = {
  getAllKeys: () => Promise<readonly string[]>;
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

function isRecord(value: unknown): value is PendingAnalysisRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<PendingAnalysisRecord>;
  return (
    typeof candidate.schemaVersion === 'number' &&
    typeof candidate.owner === 'string' &&
    typeof candidate.session_id === 'string'
  );
}

function createKey(record: PendingAnalysisRecord, scope: string): string {
  return [
    KEY_PREFIX,
    encodeURIComponent(record.owner),
    ':',
    encodeURIComponent(scope),
    ':',
    encodeURIComponent(record.session_id),
  ].join('');
}

export function createPendingAnalysisStore(storage: PendingAnalysisStorage) {
  async function save(
    record: PendingAnalysisRecord,
    scope: string,
  ): Promise<PendingAnalysisHandle> {
    const handle = {
      key: createKey(record, scope),
      record,
    };
    await storage.setItem(handle.key, JSON.stringify(record));
    return handle;
  }

  async function remove(handle: PendingAnalysisHandle): Promise<void> {
    await storage.removeItem(handle.key);
  }

  async function loadForOwner(owner: string): Promise<PendingAnalysisHandle | null> {
    const keys = (await storage.getAllKeys()).filter((key) => key.startsWith(KEY_PREFIX));
    const current: PendingAnalysisHandle[] = [];
    const discard: string[] = [];

    for (const key of keys) {
      const raw = await storage.getItem(key);
      if (raw === null) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        discard.push(key);
        continue;
      }
      if (
        !isRecord(parsed) ||
        parsed.schemaVersion !== ANALYSIS_SCHEMA_VERSION ||
        parsed.owner !== owner
      ) {
        discard.push(key);
        continue;
      }
      current.push({ key, record: parsed });
    }

    current.sort((a, b) => b.key.localeCompare(a.key));
    discard.push(...current.slice(1).map(({ key }) => key));
    await Promise.all(discard.map((key) => storage.removeItem(key)));
    return current[0] ?? null;
  }

  return {
    save,
    remove,
    loadForOwner,
  };
}

export type BootstrapDecisionInput = {
  authStatus: 'loading' | 'signedIn' | 'signedOut';
  hasPendingConsents: boolean;
  recoveryStatus: 'loading' | 'ready';
  pending: PendingAnalysisHandle | null;
};

export type BootstrapRoute =
  | '/login'
  | '/consent'
  | '/(tabs)'
  | {
      pathname: '/analyzing';
      params: {
        recoveryKey: string;
        sessionId: string;
      };
    };

export function decideBootstrapRoute(input: BootstrapDecisionInput): BootstrapRoute | null {
  if (input.authStatus === 'loading' || input.recoveryStatus === 'loading') return null;
  if (input.authStatus === 'signedOut') return '/login';
  if (input.hasPendingConsents) return '/consent';
  if (input.pending) {
    return {
      pathname: '/analyzing',
      params: {
        recoveryKey: input.pending.key,
        sessionId: input.pending.record.session_id,
      },
    };
  }
  return '/(tabs)';
}
