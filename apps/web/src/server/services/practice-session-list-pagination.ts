export const DEFAULT_SESSION_LIST_LIMIT = 20;
export const MAX_SESSION_LIST_LIMIT = 50;
const MAX_CURSOR_LENGTH = 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type PracticeSessionListCursor = {
  v: 1;
  snapshotAt: string;
  createdAt: string;
  id: string;
};

export type PracticeSessionListQuery = {
  limit: number;
  cursor: PracticeSessionListCursor | null;
};

export class PracticeSessionListValidationError extends Error {
  readonly details: Record<string, string>;

  constructor(details: Record<string, string>) {
    super("Request validation failed");
    this.name = "PracticeSessionListValidationError";
    this.details = details;
  }
}

const invalid = (field: string, message: string): never => {
  throw new PracticeSessionListValidationError({ [field]: message });
};

const canonicalIso = (value: unknown, field: string): string => {
  if (typeof value !== "string") return invalid(field, "Must be an ISO timestamp.");
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value) {
    return invalid(field, "Must be a canonical ISO timestamp.");
  }
  return value;
};

export function encodePracticeSessionListCursor(
  cursor: Omit<PracticeSessionListCursor, "v">,
): string {
  const snapshotAt = canonicalIso(cursor.snapshotAt, "cursor");
  const createdAt = canonicalIso(cursor.createdAt, "cursor");
  if (createdAt > snapshotAt) invalid("cursor", "createdAt cannot exceed snapshotAt.");
  if (!UUID_PATTERN.test(cursor.id)) invalid("cursor", "id must be a canonical UUID.");
  return Buffer.from(JSON.stringify({ v: 1, snapshotAt, createdAt, id: cursor.id }), "utf8")
    .toString("base64url");
}

export function decodePracticeSessionListCursor(raw: string): PracticeSessionListCursor {
  if (!raw || raw.length > MAX_CURSOR_LENGTH || !BASE64URL_PATTERN.test(raw)) {
    return invalid("cursor", "Must be a canonical base64url cursor.");
  }
  let parsed: unknown;
  try {
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) invalid("cursor", "Must be canonical base64url.");
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return invalid("cursor", "Must contain valid UTF-8 JSON.");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    return invalid("cursor", "Must contain an object.");
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "createdAt,id,snapshotAt,v") {
    return invalid("cursor", "Contains missing or unsupported fields.");
  }
  if (record.v !== 1 || typeof record.id !== "string" || !UUID_PATTERN.test(record.id)) {
    return invalid("cursor", "Contains an invalid version or UUID.");
  }
  const snapshotAt = canonicalIso(record.snapshotAt, "cursor");
  const createdAt = canonicalIso(record.createdAt, "cursor");
  if (createdAt > snapshotAt) invalid("cursor", "createdAt cannot exceed snapshotAt.");
  return { v: 1, snapshotAt, createdAt, id: record.id };
}

export function parsePracticeSessionListQuery(searchParams: URLSearchParams): PracticeSessionListQuery | null {
  if ([...searchParams.keys()].length === 0) return null;
  const allowed = new Set(["view", "limit", "cursor"]);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1) {
      invalid(key, "Unsupported or duplicate query parameter.");
    }
    if (searchParams.get(key) === "") invalid(key, "Must not be empty.");
  }
  if (searchParams.get("view") !== "summary") invalid("view", "Must be summary.");
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit === null ? DEFAULT_SESSION_LIST_LIMIT : Number(rawLimit);
  if (rawLimit !== null && (!/^[1-9][0-9]*$/.test(rawLimit) || !Number.isInteger(limit) || limit > MAX_SESSION_LIST_LIMIT)) {
    invalid("limit", "Must be a canonical integer from 1 to 50.");
  }
  const rawCursor = searchParams.get("cursor");
  return { limit, cursor: rawCursor === null ? null : decodePracticeSessionListCursor(rawCursor) };
}
