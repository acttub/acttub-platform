export const AUTH_CREDENTIAL_SCHEMA_VERSION = 1;
export const AUTH_CREDENTIAL_KEY = 'acttub.authCredentials';
export const LEGACY_ACCESS_KEY = 'acttub.accessToken';
export const LEGACY_REFRESH_KEY = 'acttub.refreshToken';
export const LEGACY_USER_KEY = 'acttub.authUser';

export type AuthCredentialUser = {
  id: string;
  email: string | null;
  status: 'active' | 'suspended';
};

export type AuthCredentialRecord = {
  schemaVersion: number;
  accessToken: string;
  refreshToken: string;
  user: AuthCredentialUser;
};

export type AuthCredentialStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  deleteItem: (key: string) => Promise<void>;
};

const ALL_KEYS = [
  AUTH_CREDENTIAL_KEY,
  LEGACY_ACCESS_KEY,
  LEGACY_REFRESH_KEY,
  LEGACY_USER_KEY,
] as const;
const LEGACY_KEYS = [
  LEGACY_ACCESS_KEY,
  LEGACY_REFRESH_KEY,
  LEGACY_USER_KEY,
] as const;

function isUser(value: unknown): value is AuthCredentialUser {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<AuthCredentialUser>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    (candidate.email === null || typeof candidate.email === 'string') &&
    (candidate.status === 'active' || candidate.status === 'suspended')
  );
}

function decodeBase64Url(value: string): string | null {
  if (!value || value.length % 4 === 1) return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let accumulator = 0;
  let bitCount = 0;
  let decoded = '';

  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return null;
    accumulator = (accumulator << 6) | digit;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      decoded += String.fromCharCode((accumulator >> bitCount) & 0xff);
      accumulator &= bitCount === 0 ? 0 : (1 << bitCount) - 1;
    }
  }
  return bitCount === 0 || accumulator === 0 ? decoded : null;
}

export function readJwtSubject(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const decodedPayload = decodeBase64Url(parts[1]);
    if (decodedPayload === null) return null;
    const payload = JSON.parse(decodedPayload) as unknown;
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const subject = (payload as { sub?: unknown }).sub;
    return typeof subject === 'string' && subject.length > 0 ? subject : null;
  } catch {
    return null;
  }
}

function parseUser(raw: string | null): AuthCredentialUser | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return isUser(value) ? value : null;
  } catch {
    return null;
  }
}

function parseRecord(raw: string): AuthCredentialRecord | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as Partial<AuthCredentialRecord>;
    if (
      candidate.schemaVersion !== AUTH_CREDENTIAL_SCHEMA_VERSION ||
      typeof candidate.accessToken !== 'string' ||
      candidate.accessToken.length === 0 ||
      typeof candidate.refreshToken !== 'string' ||
      candidate.refreshToken.length === 0 ||
      !isUser(candidate.user) ||
      readJwtSubject(candidate.accessToken) !== candidate.user.id
    ) {
      return null;
    }
    return candidate as AuthCredentialRecord;
  } catch {
    return null;
  }
}

export function createAuthCredentialStore(storage: AuthCredentialStorage) {
  async function removeKeys(keys: readonly string[]): Promise<void> {
    await Promise.allSettled(keys.map((key) => storage.deleteItem(key)));
  }

  async function clear(): Promise<void> {
    await removeKeys(ALL_KEYS);
  }

  async function save(
    accessToken: string,
    refreshToken: string,
    user: AuthCredentialUser,
  ): Promise<AuthCredentialRecord> {
    const record: AuthCredentialRecord = {
      schemaVersion: AUTH_CREDENTIAL_SCHEMA_VERSION,
      accessToken,
      refreshToken,
      user,
    };
    if (parseRecord(JSON.stringify(record)) === null) {
      throw new Error('유효한 인증 credential을 저장할 수 없습니다.');
    }
    await storage.setItem(AUTH_CREDENTIAL_KEY, JSON.stringify(record));
    await removeKeys(LEGACY_KEYS);
    return record;
  }

  async function load(): Promise<AuthCredentialRecord | null> {
    const stored = await storage.getItem(AUTH_CREDENTIAL_KEY);
    if (stored !== null) {
      const record = parseRecord(stored);
      if (record) return record;
      await clear();
      return null;
    }

    const [accessToken, refreshToken, storedUser] = await Promise.all([
      storage.getItem(LEGACY_ACCESS_KEY),
      storage.getItem(LEGACY_REFRESH_KEY),
      storage.getItem(LEGACY_USER_KEY),
    ]);
    if (accessToken === null && refreshToken === null && storedUser === null) return null;
    if (!accessToken || !refreshToken) {
      await clear();
      return null;
    }

    const subject = readJwtSubject(accessToken);
    const legacyUser = parseUser(storedUser);
    const user =
      legacyUser ??
      (subject
        ? {
            id: subject,
            email: null,
            status: 'active' as const,
          }
        : null);
    if (!user || subject !== user.id) {
      await clear();
      return null;
    }
    return save(accessToken, refreshToken, user);
  }

  return {
    clear,
    load,
    save,
  };
}
