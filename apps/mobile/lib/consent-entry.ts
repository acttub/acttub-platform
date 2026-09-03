import type {
  ConsentDocument,
  ConsentEntryResponse,
} from './api.ts';

export type ConsentEntryReader = {
  readEntry: () => Promise<ConsentEntryResponse>;
  readPending: () => Promise<{ documents: ConsentDocument[] }>;
};

export function consentPreferencesForEntry(
  entry: ConsentEntryResponse,
): Record<string, boolean> {
  return Object.fromEntries(
    entry.documents.map((document) => [
      document.id,
      document.current_decision === 'granted',
    ]),
  );
}

type ConsentEntryReadOptions = {
  fallbackDocuments?: ConsentDocument[];
};

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 404
  );
}

async function readWithFallback(
  reader: ConsentEntryReader,
  fallbackDocuments?: ConsentDocument[],
): Promise<ConsentEntryResponse> {
  try {
    return await reader.readEntry();
  } catch (error) {
    if (!isNotFound(error)) throw error;
    const documents =
      fallbackDocuments ?? (await reader.readPending()).documents;
    const undecidedDocuments = documents.map((document) => ({
      ...document,
      current_decision: null,
    }));
    return {
      entry_status:
        undecidedDocuments.length > 0 ? 'decision_required' : 'allowed',
      documents: undecidedDocuments,
      undecided_documents: undecidedDocuments,
    };
  }
}

export function createConsentEntrySession(reader: ConsentEntryReader) {
  let cachedEntry: Promise<ConsentEntryResponse> | null = null;

  function loadAndCache(
    fallbackDocuments?: ConsentDocument[],
  ): Promise<ConsentEntryResponse> {
    const response = readWithFallback(reader, fallbackDocuments).catch(
      (error: unknown) => {
        if (cachedEntry === response) cachedEntry = null;
        throw error;
      },
    );
    cachedEntry = response;
    return response;
  }

  function readOnce(
    options: ConsentEntryReadOptions = {},
  ): Promise<ConsentEntryResponse> {
    return cachedEntry ?? loadAndCache(options.fallbackDocuments);
  }

  function refresh(
    options: ConsentEntryReadOptions = {},
  ): Promise<ConsentEntryResponse> {
    return loadAndCache(options.fallbackDocuments);
  }

  function clear(): void {
    cachedEntry = null;
  }

  return { readOnce, refresh, clear };
}
