import { getStoredUser } from "../../lib/auth/token-store";

const PENDING_PRACTICE_UPLOAD_KEY = "acttub.pending_practice_upload";
const PENDING_PRACTICE_UPLOAD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type PendingPracticeUpload = {
  intentId: string;
  fileName: string;
  durationMs: number;
  situation: string;
  character: string;
  goal: string;
  savedAt: number;
};

function localStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function currentUserId(): string | null {
  return getStoredUser()?.id ?? null;
}

function isPendingPracticeUpload(value: unknown): value is PendingPracticeUpload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const upload = value as Record<string, unknown>;
  return (
    typeof upload.intentId === "string" &&
    upload.intentId.length > 0 &&
    typeof upload.fileName === "string" &&
    upload.fileName.length > 0 &&
    typeof upload.durationMs === "number" &&
    Number.isInteger(upload.durationMs) &&
    upload.durationMs > 0 &&
    typeof upload.situation === "string" &&
    upload.situation.trim().length > 0 &&
    typeof upload.character === "string" &&
    upload.character.trim().length > 0 &&
    typeof upload.goal === "string" &&
    upload.goal.trim().length > 0 &&
    typeof upload.savedAt === "number" &&
    Number.isFinite(upload.savedAt) &&
    upload.savedAt > 0
  );
}

function readAll(): Record<string, PendingPracticeUpload> {
  const store = localStorage();
  if (!store) return {};
  try {
    const raw = store.getItem(PENDING_PRACTICE_UPLOAD_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, PendingPracticeUpload] => isPendingPracticeUpload(entry[1]),
    );
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function writeAll(uploads: Record<string, PendingPracticeUpload>): void {
  const store = localStorage();
  if (!store) return;
  if (Object.keys(uploads).length === 0) {
    store.removeItem(PENDING_PRACTICE_UPLOAD_KEY);
    return;
  }
  store.setItem(PENDING_PRACTICE_UPLOAD_KEY, JSON.stringify(uploads));
}

export function savePendingPracticeUpload(upload: PendingPracticeUpload): void {
  const userId = currentUserId();
  if (!userId) return;
  try {
    const uploads = readAll();
    uploads[userId] = upload;
    writeAll(uploads);
  } catch {
    // 저장소를 사용할 수 없으면 현재 화면에서만 업로드 결과를 유지한다.
  }
}

export function getPendingPracticeUpload(): PendingPracticeUpload | null {
  const userId = currentUserId();
  if (!userId) return null;
  try {
    const upload = readAll()[userId];
    if (!upload || Date.now() - upload.savedAt > PENDING_PRACTICE_UPLOAD_MAX_AGE_MS) {
      clearPendingPracticeUpload();
      return null;
    }
    return upload;
  } catch {
    return null;
  }
}

export function clearPendingPracticeUpload(): void {
  const userId = currentUserId();
  if (!userId) return;
  try {
    const uploads = readAll();
    delete uploads[userId];
    writeAll(uploads);
  } catch {
    // 이미 비어 있는 것과 동일하게 취급한다.
  }
}
